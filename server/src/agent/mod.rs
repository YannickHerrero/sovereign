//! Backend-neutral view of a coding agent: the transcript shape the UI renders, the model
//! identity used for selection, and the traits a backend (pi, Claude Code) implements.

pub mod manager;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::mpsc;

use crate::pi::image::ImageContent;
use crate::store::Task;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    #[default]
    Pi,
    Claude,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    #[default]
    Settled,
    Error,
    Aborted,
    /// The server stopped while the agent was working.
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum Turn {
    User {
        text: String,
        at: u64,
        #[serde(default)]
        images: Vec<ImageContent>,
    },
    Agent {
        text: String,
        files: Vec<String>,
        at: u64,
        status: RunStatus,
    },
}

/// A user message held by the server until the current run ends.
#[derive(Debug, Clone, Serialize)]
pub struct QueuedMessage {
    pub id: String,
    pub text: String,
    pub images: Vec<ImageContent>,
    pub at: u64,
}

/// A transcript read from a backend's session file.
#[derive(Debug, Default)]
pub struct Session {
    pub cwd: Option<String>,
    pub name: Option<String>,
    pub model: Option<String>,
    pub turns: Vec<Turn>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct ModelRef {
    /// Which agent serves the model; absent in older clients, which only knew pi.
    #[serde(default)]
    pub agent: AgentKind,
    pub provider: String,
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Model {
    #[serde(default)]
    pub agent: AgentKind,
    pub provider: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub input: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModelList {
    pub models: Vec<Model>,
    pub current: Option<Model>,
}

/// What a running agent reports, already translated out of the backend's own protocol.
#[derive(Debug, Clone)]
pub enum RunSignal {
    /// A run (one user prompt and everything it triggers) begins.
    Start,
    /// Human-readable progress shown on the working line.
    Status(String),
    TextDelta(String),
    /// A file the agent's own tools wrote; git remains the source of truth for stats.
    FileTouched(String),
    /// One complete assistant message of the run.
    AssistantMessage { text: String, at: u64, status: RunStatus, error: Option<String> },
    /// The run is over, including retries and queued follow-ups.
    Settled,
    /// The agent needs an answer from the user; payload is backend-specific and echoed back.
    Request(Value),
    Error(String),
}

/// A live agent process attached to one task.
#[async_trait]
pub trait AgentProcess: Send + Sync {
    /// Sends a user message; the caller guarantees no run is in progress.
    async fn prompt(&self, message: &str, images: &[ImageContent]) -> Result<()>;
    /// Injects a message into the current run, before the agent's next model call.
    async fn steer(&self, message: &str, images: &[ImageContent]) -> Result<()>;
    async fn abort(&self) -> Result<()>;
    async fn is_streaming(&self) -> Result<bool>;
    async fn list_models(&self) -> Result<ModelList>;
    async fn set_model(&self, model: &ModelRef) -> Result<Model>;
    async fn set_name(&self, name: &str) -> Result<()>;
    /// Answers a `RunSignal::Request`.
    async fn respond(&self, response: Value) -> Result<()>;
    /// Where the backend persists this session, once known.
    async fn session_file(&self) -> Option<PathBuf>;
    async fn kill(&self);
}

#[async_trait]
pub trait Backend: Send + Sync {
    fn kind(&self) -> AgentKind;
    /// Checks that the agent's binary runs on this machine.
    async fn probe(&self) -> Result<()>;
    /// Starts (or resumes) the agent for `task`; signals flow until the process exits.
    async fn spawn(&self, task: &Task, signals: mpsc::Sender<RunSignal>) -> Result<Arc<dyn AgentProcess>>;
    fn read_transcript(&self, path: &Path) -> Result<Session>;
    /// Where the transcript of `task` lives right now, if it exists. Backends that move
    /// transcripts around override the recorded path.
    fn locate_session(&self, task: &Task) -> Option<PathBuf> {
        task.session_file.clone().filter(|file| file.exists())
    }
    /// Models available on this machine for a task that has no session yet.
    async fn discover_models(&self, cwd: &Path) -> Result<ModelList>;
    async fn generate_title(&self, message: &str) -> Result<String>;
}
