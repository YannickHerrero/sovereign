//! Owns the pi processes, one per task, and turns their raw RPC events into Sovereign events.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc};

use super::process::PiProcess;
use super::session::{self, RunStatus, Turn};
use crate::config::Config;
use crate::store::{LastRun, Store, Task, TouchedFile};
use crate::tasks::{summarize, TaskSummary};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerEvent {
    TaskUpsert { task: TaskSummary },
    TaskRemoved { id: String },
    RunEvent { task_id: String, event: RunEvent },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RunEvent {
    AgentStart,
    Status { text: String },
    TextDelta { delta: String },
    FileTouched { path: String },
    Settled { turn: Turn },
    Error { message: String },
    UiRequest { request: Value },
}

struct Agent {
    process: Arc<PiProcess>,
    streaming: Arc<AtomicBool>,
    last_activity: Arc<Mutex<Instant>>,
}

/// Text and files accumulated during the current run, used to build the final agent turn.
#[derive(Default)]
struct RunAcc {
    text: String,
    files: Vec<String>,
    status: RunStatus,
    at: u64,
}

pub struct Agents {
    config: Config,
    store: Arc<Store>,
    agents: Mutex<HashMap<String, Agent>>,
    runs: Mutex<HashMap<String, RunAcc>>,
    events: broadcast::Sender<ServerEvent>,
}

impl Agents {
    pub fn new(config: Config, store: Arc<Store>) -> Arc<Self> {
        let (events, _) = broadcast::channel(1024);
        let agents = Arc::new(Self {
            config,
            store,
            agents: Mutex::new(HashMap::new()),
            runs: Mutex::new(HashMap::new()),
            events,
        });
        tokio::spawn(agents.clone().reap_idle());
        agents
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ServerEvent> {
        self.events.subscribe()
    }

    pub fn is_working(&self, task_id: &str) -> bool {
        self.agents
            .lock()
            .unwrap()
            .get(task_id)
            .map(|a| a.streaming.load(Ordering::Relaxed))
            .unwrap_or(false)
    }

    pub fn working_count(&self) -> usize {
        self.agents.lock().unwrap().values().filter(|a| a.streaming.load(Ordering::Relaxed)).count()
    }

    pub fn summary(&self, task: &Task) -> TaskSummary {
        summarize(task, self.is_working(&task.id))
    }

    pub fn broadcast_task(&self, task: &Task) {
        let _ = self.events.send(ServerEvent::TaskUpsert { task: self.summary(task) });
    }

    pub fn broadcast_removed(&self, id: &str) {
        let _ = self.events.send(ServerEvent::TaskRemoved { id: id.to_string() });
    }

    /// Sends a user message to the task's pi, spawning it if needed. Queues as a follow-up
    /// when pi is already streaming.
    pub async fn prompt(self: &Arc<Self>, task: &Task, message: &str) -> Result<()> {
        let process = self.ensure_agent(task).await?;
        let streaming = self.is_working(&task.id);
        let command = if streaming {
            json!({ "type": "follow_up", "message": message })
        } else {
            json!({ "type": "prompt", "message": message })
        };
        process.command(command).await?;
        self.touch(&task.id);
        Ok(())
    }

    pub async fn abort(&self, task_id: &str) -> Result<()> {
        let process = self.process_of(task_id).ok_or_else(|| anyhow!("no agent running"))?;
        process.command(json!({ "type": "abort" })).await?;
        Ok(())
    }

    pub async fn rename(&self, task_id: &str, title: &str) {
        if let Some(process) = self.process_of(task_id) {
            if let Err(err) = process.command(json!({ "type": "set_session_name", "name": title })).await {
                tracing::warn!(task_id, "set_session_name failed: {err}");
            }
        }
    }

    pub async fn ui_response(&self, task_id: &str, response: Value) -> Result<()> {
        let process = self.process_of(task_id).ok_or_else(|| anyhow!("no agent running"))?;
        let mut response = response;
        response["type"] = Value::String("extension_ui_response".into());
        process.send_raw(&response).await
    }

    pub async fn stop(&self, task_id: &str) {
        let agent = self.agents.lock().unwrap().remove(task_id);
        if let Some(agent) = agent {
            agent.process.kill().await;
        }
        self.runs.lock().unwrap().remove(task_id);
    }

    fn process_of(&self, task_id: &str) -> Option<Arc<PiProcess>> {
        self.agents.lock().unwrap().get(task_id).map(|a| a.process.clone())
    }

    fn touch(&self, task_id: &str) {
        if let Some(agent) = self.agents.lock().unwrap().get(task_id) {
            *agent.last_activity.lock().unwrap() = Instant::now();
        }
    }

    async fn ensure_agent(self: &Arc<Self>, task: &Task) -> Result<Arc<PiProcess>> {
        if let Some(process) = self.process_of(&task.id) {
            return Ok(process);
        }
        let (tx, rx) = mpsc::channel(256);
        let args = vec![
            "--session-id".to_string(),
            task.session_id.clone(),
            "--name".to_string(),
            task.title.clone(),
        ];
        let process = PiProcess::spawn(&self.config.pi_bin, &task.cwd, &args, tx).await?;
        let agent = Agent {
            process: process.clone(),
            streaming: Arc::new(AtomicBool::new(false)),
            last_activity: Arc::new(Mutex::new(Instant::now())),
        };
        let streaming = agent.streaming.clone();
        let last_activity = agent.last_activity.clone();
        self.agents.lock().unwrap().insert(task.id.clone(), agent);

        if task.session_file.is_none() {
            self.record_session_file(&task.id, &process).await;
        }

        let manager = self.clone();
        let task_id = task.id.clone();
        tokio::spawn(async move {
            manager.pump(task_id, rx, streaming, last_activity).await;
        });
        Ok(process)
    }

    async fn record_session_file(&self, task_id: &str, process: &PiProcess) {
        let state = match process.command(json!({ "type": "get_state" })).await {
            Ok(state) => state,
            Err(err) => {
                tracing::warn!(task_id, "get_state failed: {err}");
                return;
            }
        };
        let Some(file) = state.get("sessionFile").and_then(Value::as_str) else { return };
        let file = std::path::PathBuf::from(file);
        let _ = self.store.update(task_id, |t| t.session_file = Some(file));
    }

    async fn pump(
        self: Arc<Self>,
        task_id: String,
        mut rx: mpsc::Receiver<Value>,
        streaming: Arc<AtomicBool>,
        last_activity: Arc<Mutex<Instant>>,
    ) {
        while let Some(event) = rx.recv().await {
            *last_activity.lock().unwrap() = Instant::now();
            self.handle(&task_id, event, &streaming).await;
        }
        // pi exited: whatever was running is over.
        tracing::info!(task_id, "pi process exited");
        let was_streaming = streaming.swap(false, Ordering::Relaxed);
        self.agents.lock().unwrap().remove(&task_id);
        if was_streaming {
            self.emit(&task_id, RunEvent::Error { message: "pi exited unexpectedly".into() });
            self.settle(&task_id, Some(RunStatus::Error)).await;
        }
    }

    async fn handle(&self, task_id: &str, event: Value, streaming: &AtomicBool) {
        let kind = event.get("type").and_then(Value::as_str).unwrap_or_default();
        match kind {
            "agent_start" => {
                streaming.store(true, Ordering::Relaxed);
                self.runs.lock().unwrap().insert(task_id.to_string(), RunAcc::default());
                self.emit(task_id, RunEvent::AgentStart);
                self.emit(task_id, RunEvent::Status { text: "Thinking…".into() });
                if let Some(task) = self.store.get(task_id) {
                    self.broadcast_task(&task);
                }
            }
            "message_update" => {
                let Some(delta) = event.get("assistantMessageEvent") else { return };
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        let text = delta.get("delta").and_then(Value::as_str).unwrap_or_default();
                        self.emit(task_id, RunEvent::TextDelta { delta: text.to_string() });
                    }
                    Some("thinking_start") => {
                        self.emit(task_id, RunEvent::Status { text: "Thinking…".into() });
                    }
                    _ => {}
                }
            }
            "message_end" => {
                let Some(message) = event.get("message") else { return };
                if message.get("role").and_then(Value::as_str) != Some("assistant") {
                    return;
                }
                let mut runs = self.runs.lock().unwrap();
                let acc = runs.entry(task_id.to_string()).or_default();
                acc.at = message.get("timestamp").and_then(Value::as_u64).unwrap_or(acc.at);
                if let Some(blocks) = message.get("content").and_then(Value::as_array) {
                    for block in blocks {
                        if block.get("type").and_then(Value::as_str) != Some("text") {
                            continue;
                        }
                        let text = block.get("text").and_then(Value::as_str).unwrap_or_default().trim();
                        if text.is_empty() {
                            continue;
                        }
                        if !acc.text.is_empty() {
                            acc.text.push_str("\n\n");
                        }
                        acc.text.push_str(text);
                    }
                }
                acc.status = match message.get("stopReason").and_then(Value::as_str) {
                    Some("error") => RunStatus::Error,
                    Some("aborted") => RunStatus::Aborted,
                    _ => RunStatus::Settled,
                };
                if acc.status == RunStatus::Error {
                    let text = message.get("errorMessage").and_then(Value::as_str).unwrap_or("model error");
                    let message = text.to_string();
                    drop(runs);
                    self.emit(task_id, RunEvent::Error { message });
                }
            }
            "tool_execution_start" => {
                let name = event.get("toolName").and_then(Value::as_str).unwrap_or("tool");
                let args = event.get("args");
                let path = args.and_then(|a| a.get("path")).and_then(Value::as_str);
                let status = match (name, path) {
                    ("bash", _) => "Running a command…".to_string(),
                    ("read", Some(p)) => format!("Reading {p}…"),
                    ("write", Some(p)) => format!("Writing {p}…"),
                    ("edit", Some(p)) => format!("Editing {p}…"),
                    (other, _) => format!("Running {other}…"),
                };
                self.emit(task_id, RunEvent::Status { text: status });
                if let Some(path) = session::touched_path(name, args) {
                    let mut runs = self.runs.lock().unwrap();
                    let acc = runs.entry(task_id.to_string()).or_default();
                    if !acc.files.contains(&path) {
                        acc.files.push(path.clone());
                        drop(runs);
                        self.emit(task_id, RunEvent::FileTouched { path });
                    }
                }
            }
            "tool_execution_end" => {
                self.emit(task_id, RunEvent::Status { text: "Thinking…".into() });
            }
            "agent_settled" => {
                streaming.store(false, Ordering::Relaxed);
                self.settle(task_id, None).await;
            }
            "extension_ui_request" => {
                self.emit(task_id, RunEvent::UiRequest { request: event });
            }
            "extension_error" => {
                let message = event.get("error").and_then(Value::as_str).unwrap_or("extension error");
                self.emit(task_id, RunEvent::Error { message: message.to_string() });
            }
            _ => {}
        }
    }

    /// Closes the current run: persists the outcome on the task and emits the final agent turn.
    async fn settle(&self, task_id: &str, forced: Option<RunStatus>) {
        let acc = self.runs.lock().unwrap().remove(task_id).unwrap_or_default();
        let status = forced.unwrap_or(acc.status);
        let touched_files = acc
            .files
            .iter()
            .map(|path| TouchedFile { path: path.clone(), plus: 0, minus: 0 })
            .collect();
        let now = crate::store::now_ms();
        let updated = self.store.update(task_id, |t| {
            t.updated_at = now;
            t.last_run = Some(LastRun { status, touched_files });
        });
        let turn = Turn::Agent {
            text: acc.text,
            files: acc.files,
            at: if acc.at > 0 { acc.at } else { now },
            status,
        };
        self.emit(task_id, RunEvent::Settled { turn });
        if let Ok(Some(task)) = updated {
            self.broadcast_task(&task);
        }
    }

    fn emit(&self, task_id: &str, event: RunEvent) {
        let _ = self.events.send(ServerEvent::RunEvent { task_id: task_id.to_string(), event });
    }

    /// Kills processes that have been idle longer than `idle_kill_secs`.
    async fn reap_idle(self: Arc<Self>) {
        let idle = Duration::from_secs(self.config.idle_kill_secs.max(30));
        let mut ticker = tokio::time::interval(Duration::from_secs(30));
        loop {
            ticker.tick().await;
            let stale: Vec<String> = self
                .agents
                .lock()
                .unwrap()
                .iter()
                .filter(|(_, a)| {
                    !a.streaming.load(Ordering::Relaxed)
                        && a.last_activity.lock().unwrap().elapsed() > idle
                })
                .map(|(id, _)| id.clone())
                .collect();
            for id in stale {
                tracing::info!(task_id = %id, "stopping idle pi process");
                self.stop(&id).await;
            }
        }
    }
}
