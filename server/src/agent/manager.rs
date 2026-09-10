//! Owns one agent process per task, whatever the backend, and turns run signals into task
//! state (git baseline, touched files, turns) and WebSocket events.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use serde::Serialize;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc};

use super::{AgentKind, AgentProcess, Backend, Model, ModelList, ModelRef, RunSignal, RunStatus, Session, Turn};
use crate::config::Config;
use crate::git;
use crate::pi::image::ImageContent;
use crate::store::{Baseline, Store, Task, TouchedFile};
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
    ModelChanged { model: Model },
}

struct Agent {
    process: Arc<dyn AgentProcess>,
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
    /// Change counts since the task baseline when this run started.
    run_start: Option<git::Counts>,
}

pub struct Agents {
    config: Config,
    store: Arc<Store>,
    backends: HashMap<AgentKind, Arc<dyn Backend>>,
    agents: Mutex<HashMap<String, Agent>>,
    runs: Mutex<HashMap<String, RunAcc>>,
    events: broadcast::Sender<ServerEvent>,
}

impl Agents {
    pub fn new(config: Config, store: Arc<Store>, backends: Vec<Arc<dyn Backend>>) -> Arc<Self> {
        let (events, _) = broadcast::channel(1024);
        let agents = Arc::new(Self {
            config,
            store,
            backends: backends.into_iter().map(|b| (b.kind(), b)).collect(),
            agents: Mutex::new(HashMap::new()),
            runs: Mutex::new(HashMap::new()),
            events,
        });
        tokio::spawn(agents.clone().reap_idle());
        agents
    }

    pub fn kinds(&self) -> Vec<AgentKind> {
        let mut kinds: Vec<AgentKind> = self.backends.keys().copied().collect();
        kinds.sort_by_key(|k| *k as u8);
        kinds
    }

    /// Models offered by every configured backend, for a task that does not exist yet.
    /// `current` is the default agent's current model.
    pub async fn discover_models(&self, cwd: &std::path::Path) -> Result<ModelList> {
        let mut models = Vec::new();
        let mut current = None;
        let mut failures = Vec::new();
        for kind in self.kinds() {
            match self.backends[&kind].discover_models(cwd).await {
                Ok(list) => {
                    if kind == AgentKind::default() {
                        current = list.current;
                    }
                    models.extend(list.models);
                }
                Err(err) => failures.push(format!("{kind:?}: {err}")),
            }
        }
        if models.is_empty() && !failures.is_empty() {
            return Err(anyhow!(failures.join("; ")));
        }
        Ok(ModelList { models, current })
    }

    pub fn backend(&self, kind: AgentKind) -> Result<Arc<dyn Backend>> {
        self.backends.get(&kind).cloned().ok_or_else(|| anyhow!("agent {kind:?} is not configured on this machine"))
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

    /// Reads the task transcript from disk without touching any process.
    pub fn transcript(&self, task: &Task) -> Result<Session> {
        match task.session_file.as_ref().filter(|f| f.exists()) {
            Some(file) => self.backend(task.agent)?.read_transcript(file),
            None => Ok(Session::default()),
        }
    }

    pub async fn generate_title(&self, kind: AgentKind, message: &str) -> Result<String> {
        self.backend(kind)?.generate_title(message).await
    }

    /// Sends a user message to the task's agent, spawning it if needed. Queued when a run is
    /// already in progress.
    pub async fn prompt(self: &Arc<Self>, task: &Task, message: &str, images: &[ImageContent]) -> Result<()> {
        let process = self.ensure_agent(task).await?;
        let queued = self.is_working(&task.id);
        process.prompt(message, images, queued).await?;
        self.touch(&task.id);
        Ok(())
    }

    pub async fn models(self: &Arc<Self>, task: &Task) -> Result<ModelList> {
        let process = self.ensure_agent(task).await?;
        let result = process.list_models().await;
        self.touch(&task.id);
        result
    }

    pub async fn set_model(self: &Arc<Self>, task: &Task, model: &ModelRef) -> Result<Model> {
        let process = self.ensure_agent(task).await?;
        // Do not switch underneath an in-flight LLM request.
        if process.is_streaming().await? {
            return Err(anyhow!("Wait for the agent to finish or stop it before changing model"));
        }
        let model = process.set_model(model).await?;
        self.touch(&task.id);
        self.emit(&task.id, RunEvent::ModelChanged { model: model.clone() });
        Ok(model)
    }

    pub async fn abort(&self, task_id: &str) -> Result<()> {
        let process = self.process_of(task_id).ok_or_else(|| anyhow!("no agent running"))?;
        process.abort().await
    }

    pub async fn rename(&self, task_id: &str, title: &str) {
        if let Some(process) = self.process_of(task_id) {
            if let Err(err) = process.set_name(title).await {
                tracing::warn!(task_id, "renaming the session failed: {err}");
            }
        }
    }

    pub async fn ui_response(&self, task_id: &str, response: Value) -> Result<()> {
        let process = self.process_of(task_id).ok_or_else(|| anyhow!("no agent running"))?;
        process.respond(response).await
    }

    pub async fn stop(&self, task_id: &str) {
        let agent = self.agents.lock().unwrap().remove(task_id);
        if let Some(agent) = agent {
            agent.process.kill().await;
        }
        self.runs.lock().unwrap().remove(task_id);
    }

    fn process_of(&self, task_id: &str) -> Option<Arc<dyn AgentProcess>> {
        self.agents.lock().unwrap().get(task_id).map(|a| a.process.clone())
    }

    fn touch(&self, task_id: &str) {
        if let Some(agent) = self.agents.lock().unwrap().get(task_id) {
            *agent.last_activity.lock().unwrap() = Instant::now();
        }
    }

    async fn ensure_agent(self: &Arc<Self>, task: &Task) -> Result<Arc<dyn AgentProcess>> {
        if let Some(process) = self.process_of(&task.id) {
            return Ok(process);
        }
        let (tx, rx) = mpsc::channel(256);
        let process = self.backend(task.agent)?.spawn(task, tx).await?;
        let agent = Agent {
            process: process.clone(),
            streaming: Arc::new(AtomicBool::new(false)),
            last_activity: Arc::new(Mutex::new(Instant::now())),
        };
        let streaming = agent.streaming.clone();
        let last_activity = agent.last_activity.clone();
        self.agents.lock().unwrap().insert(task.id.clone(), agent);

        if task.session_file.is_none() {
            if let Some(file) = process.session_file().await {
                let _ = self.store.update(&task.id, |t| t.session_file = Some(file));
            }
        }

        let manager = self.clone();
        let task_id = task.id.clone();
        tokio::spawn(async move {
            manager.pump(task_id, rx, streaming, last_activity).await;
        });
        Ok(process)
    }

    async fn pump(
        self: Arc<Self>,
        task_id: String,
        mut rx: mpsc::Receiver<RunSignal>,
        streaming: Arc<AtomicBool>,
        last_activity: Arc<Mutex<Instant>>,
    ) {
        while let Some(signal) = rx.recv().await {
            *last_activity.lock().unwrap() = Instant::now();
            self.handle(&task_id, signal, &streaming).await;
        }
        // The process exited: whatever was running is over.
        tracing::info!(task_id, "agent process exited");
        let was_streaming = streaming.swap(false, Ordering::Relaxed);
        self.agents.lock().unwrap().remove(&task_id);
        if was_streaming {
            self.emit(&task_id, RunEvent::Error { message: "the agent exited unexpectedly".into() });
            self.settle(&task_id, Some(RunStatus::Error)).await;
        }
    }

    async fn handle(&self, task_id: &str, signal: RunSignal, streaming: &AtomicBool) {
        match signal {
            RunSignal::Start => {
                streaming.store(true, Ordering::Relaxed);
                let run_start = self.ensure_baseline(task_id).await;
                let acc = RunAcc { run_start, ..RunAcc::default() };
                self.runs.lock().unwrap().insert(task_id.to_string(), acc);
                self.emit(task_id, RunEvent::AgentStart);
                if let Some(task) = self.store.get(task_id) {
                    self.broadcast_task(&task);
                }
            }
            RunSignal::Status(text) => self.emit(task_id, RunEvent::Status { text }),
            RunSignal::TextDelta(delta) => self.emit(task_id, RunEvent::TextDelta { delta }),
            RunSignal::FileTouched(path) => {
                let mut runs = self.runs.lock().unwrap();
                let acc = runs.entry(task_id.to_string()).or_default();
                if !acc.files.contains(&path) {
                    acc.files.push(path.clone());
                    drop(runs);
                    self.emit(task_id, RunEvent::FileTouched { path });
                }
            }
            RunSignal::AssistantMessage { text, at, status, error } => {
                {
                    let mut runs = self.runs.lock().unwrap();
                    let acc = runs.entry(task_id.to_string()).or_default();
                    if at > 0 {
                        acc.at = at;
                    }
                    if !text.is_empty() {
                        if !acc.text.is_empty() {
                            acc.text.push_str("\n\n");
                        }
                        acc.text.push_str(&text);
                    }
                    acc.status = status;
                }
                if let Some(message) = error {
                    self.emit(task_id, RunEvent::Error { message });
                }
            }
            RunSignal::Settled => {
                streaming.store(false, Ordering::Relaxed);
                self.settle(task_id, None).await;
            }
            RunSignal::Request(request) => self.emit(task_id, RunEvent::UiRequest { request }),
            RunSignal::Error(message) => self.emit(task_id, RunEvent::Error { message }),
        }
    }

    /// Closes the current run: persists the outcome on the task and emits the final agent turn.
    async fn settle(&self, task_id: &str, forced: Option<RunStatus>) {
        let acc = self.runs.lock().unwrap().remove(task_id).unwrap_or_default();
        let status = forced.unwrap_or(acc.status);
        let baseline = self.store.get(task_id).and_then(|t| t.baseline);
        let after = match &baseline {
            Some(b) => self.counts_since(task_id, b.head.clone()).await,
            None => None,
        };
        // Not a git repo: fall back to the files the agent's own tools named.
        let fallback = || acc.files.iter().map(|p| TouchedFile { path: p.clone(), plus: 0, minus: 0 }).collect();
        let (task_files, run_files): (Vec<TouchedFile>, Vec<String>) = match (&baseline, &after, &acc.run_start) {
            (Some(b), Some(after), Some(start)) => (
                git::touched(&b.files, after),
                git::touched(start, after).into_iter().map(|f| f.path).collect(),
            ),
            (Some(b), Some(after), None) => {
                let files = git::touched(&b.files, after);
                let paths = files.iter().map(|f| f.path.clone()).collect();
                (files, paths)
            }
            _ => (fallback(), acc.files.clone()),
        };
        let now = crate::store::now_ms();
        let updated = self.store.update(task_id, |t| {
            t.updated_at = now;
            t.last_status = Some(status);
            t.touched_files = task_files;
        });
        let turn = Turn::Agent {
            text: acc.text,
            files: run_files,
            at: if acc.at > 0 { acc.at } else { now },
            status,
        };
        self.emit(task_id, RunEvent::Settled { turn });
        if let Ok(Some(task)) = updated {
            self.broadcast_task(&task);
        }
    }

    /// Captures the task baseline on the first run, then returns the current counts since it.
    async fn ensure_baseline(&self, task_id: &str) -> Option<git::Counts> {
        let task = self.store.get(task_id)?;
        if let Some(baseline) = task.baseline {
            return self.counts_since(task_id, baseline.head).await;
        }
        let cwd = task.cwd;
        let snapshot = tokio::task::spawn_blocking(move || git::snapshot(&cwd)).await.ok().flatten()?;
        let files = snapshot.files.clone();
        let baseline = Baseline { head: snapshot.head, files: snapshot.files };
        let _ = self.store.update(task_id, |t| t.baseline = Some(baseline));
        Some(files)
    }

    async fn counts_since(&self, task_id: &str, base: Option<String>) -> Option<git::Counts> {
        let cwd = self.store.get(task_id)?.cwd;
        tokio::task::spawn_blocking(move || git::counts_since(&cwd, base.as_deref())).await.ok().flatten()
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
                tracing::info!(task_id = %id, "stopping idle agent process");
                self.stop(&id).await;
            }
        }
    }
}
