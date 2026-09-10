//! pi as a Sovereign backend: spawns `pi --mode rpc` and translates its events into
//! `RunSignal`s. Everything pi-specific about the protocol lives here.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::image::ImageContent;
use super::models;
use super::process::PiProcess;
use super::session;
use super::title;
use crate::agent::{AgentKind, AgentProcess, Backend, Model, ModelList, ModelRef, RunSignal, RunStatus, Session};
use anyhow::{bail, Context};
use crate::store::Task;

pub struct PiBackend {
    pub bin: String,
}

#[async_trait]
impl Backend for PiBackend {
    fn kind(&self) -> AgentKind {
        AgentKind::Pi
    }

    async fn probe(&self) -> Result<()> {
        let output = tokio::process::Command::new(&self.bin)
            .arg("--version")
            .output()
            .await
            .with_context(|| format!("running {} --version", self.bin))?;
        if !output.status.success() {
            bail!("{} --version exited with {}", self.bin, output.status);
        }
        Ok(())
    }

    async fn spawn(&self, task: &Task, signals: mpsc::Sender<RunSignal>) -> Result<Arc<dyn AgentProcess>> {
        let mut args = if let Some(file) = task.session_file.as_ref().filter(|file| file.exists()) {
            vec!["--session".to_string(), file.to_string_lossy().into_owned()]
        } else {
            vec!["--session-id".to_string(), task.session_id.clone()]
        };
        args.extend(["--name".to_string(), task.title.clone()]);
        let (tx, rx) = mpsc::channel(256);
        let process = PiProcess::spawn(&self.bin, &task.cwd, &args, tx).await?;
        tokio::spawn(translate(rx, signals));
        Ok(Arc::new(PiAgent { process }))
    }

    fn read_transcript(&self, path: &Path) -> Result<Session> {
        session::read(path)
    }

    async fn discover_models(&self, cwd: &Path) -> Result<ModelList> {
        models::discover(&self.bin, cwd).await.map(tag)
    }

    async fn generate_title(&self, message: &str) -> Result<String> {
        title::generate(&self.bin, message).await
    }
}

pub struct PiAgent {
    process: Arc<PiProcess>,
}

#[async_trait]
impl AgentProcess for PiAgent {
    async fn prompt(&self, message: &str, images: &[ImageContent]) -> Result<()> {
        let command = json!({ "type": "prompt", "message": message, "images": images });
        // Rejections (bad streaming behavior, unknown session) come back at once; a slow answer
        // means an extension command is running and the prompt was accepted.
        self.process.command_within(command, std::time::Duration::from_secs(3)).await?;
        Ok(())
    }

    async fn steer(&self, message: &str, images: &[ImageContent]) -> Result<()> {
        self.process.command(json!({ "type": "steer", "message": message, "images": images })).await?;
        Ok(())
    }

    async fn abort(&self) -> Result<()> {
        self.process.command(json!({ "type": "abort" })).await?;
        Ok(())
    }

    async fn is_streaming(&self) -> Result<bool> {
        let state = self.process.command(json!({ "type": "get_state" })).await?;
        Ok(state.get("isStreaming").and_then(Value::as_bool) == Some(true))
    }

    async fn list_models(&self) -> Result<ModelList> {
        models::list(&self.process).await.map(tag)
    }

    async fn set_model(&self, model: &ModelRef) -> Result<Model> {
        models::set(&self.process, model).await.map(|mut m| {
            m.agent = AgentKind::Pi;
            m
        })
    }

    async fn set_name(&self, name: &str) -> Result<()> {
        self.process.command(json!({ "type": "set_session_name", "name": name })).await?;
        Ok(())
    }

    async fn respond(&self, mut response: Value) -> Result<()> {
        response["type"] = Value::String("extension_ui_response".into());
        self.process.send_raw(&response).await
    }

    async fn session_file(&self) -> Option<PathBuf> {
        let state = self.process.command(json!({ "type": "get_state" })).await.ok()?;
        state.get("sessionFile").and_then(Value::as_str).map(PathBuf::from)
    }

    async fn kill(&self) {
        self.process.kill().await;
    }
}

/// pi's registry knows nothing about Sovereign agents: stamp its models as pi's.
fn tag(mut list: ModelList) -> ModelList {
    for model in &mut list.models {
        model.agent = AgentKind::Pi;
    }
    if let Some(current) = &mut list.current {
        current.agent = AgentKind::Pi;
    }
    list
}

/// Maps raw pi RPC events onto run signals until pi's stdout closes.
async fn translate(mut rx: mpsc::Receiver<Value>, signals: mpsc::Sender<RunSignal>) {
    while let Some(event) = rx.recv().await {
        for signal in signals_for(&event) {
            if signals.send(signal).await.is_err() {
                return;
            }
        }
    }
}

fn signals_for(event: &Value) -> Vec<RunSignal> {
    let kind = event.get("type").and_then(Value::as_str).unwrap_or_default();
    match kind {
        "agent_start" => vec![RunSignal::Start, RunSignal::Status("Thinking…".into())],
        "message_update" => {
            let Some(delta) = event.get("assistantMessageEvent") else { return vec![] };
            match delta.get("type").and_then(Value::as_str) {
                Some("text_delta") => {
                    let text = delta.get("delta").and_then(Value::as_str).unwrap_or_default();
                    vec![RunSignal::TextDelta(text.to_string())]
                }
                Some("thinking_start") => vec![RunSignal::Status("Thinking…".into())],
                _ => vec![],
            }
        }
        "message_end" => {
            let Some(message) = event.get("message") else { return vec![] };
            if message.get("role").and_then(Value::as_str) != Some("assistant") {
                return vec![];
            }
            let text = message
                .get("content")
                .and_then(Value::as_array)
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                        .filter_map(|b| b.get("text").and_then(Value::as_str))
                        .map(str::trim)
                        .filter(|t| !t.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n\n")
                })
                .unwrap_or_default();
            let status = match message.get("stopReason").and_then(Value::as_str) {
                Some("error") => RunStatus::Error,
                Some("aborted") => RunStatus::Aborted,
                _ => RunStatus::Settled,
            };
            let error = (status == RunStatus::Error)
                .then(|| message.get("errorMessage").and_then(Value::as_str).unwrap_or("model error").to_string());
            vec![RunSignal::AssistantMessage {
                text,
                at: message.get("timestamp").and_then(Value::as_u64).unwrap_or(0),
                status,
                error,
            }]
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
            let mut out = vec![RunSignal::Status(status)];
            if let Some(path) = session::touched_path(name, args) {
                out.push(RunSignal::FileTouched(path));
            }
            out
        }
        "tool_execution_end" => vec![RunSignal::Status("Thinking…".into())],
        "agent_settled" => vec![RunSignal::Settled],
        "extension_ui_request" => vec![RunSignal::Request(event.clone())],
        "extension_error" => {
            let message = event.get("error").and_then(Value::as_str).unwrap_or("extension error");
            vec![RunSignal::Error(message.to_string())]
        }
        _ => vec![],
    }
}
