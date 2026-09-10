//! Task views shared by the HTTP API and the WebSocket event stream.

use serde::Serialize;

use crate::agent::RunStatus;
use crate::store::Task;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Working,
    Done,
    NoChanges,
    Failed,
    Pending,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskSummary {
    pub id: String,
    pub agent: crate::agent::AgentKind,
    pub repo: String,
    pub title: String,
    pub pinned: bool,
    pub state: TaskState,
    pub plus: u32,
    pub minus: u32,
    pub created_at: u64,
    pub updated_at: u64,
    /// The task finished a run the user has not opened since.
    pub unread: bool,
}

pub fn summarize(task: &Task, working: bool) -> TaskSummary {
    let state = if working {
        TaskState::Working
    } else {
        match task.last_status {
            None => TaskState::Pending,
            Some(RunStatus::Error | RunStatus::Aborted | RunStatus::Interrupted) => TaskState::Failed,
            Some(RunStatus::Settled) if task.touched_files.is_empty() => TaskState::NoChanges,
            Some(RunStatus::Settled) => TaskState::Done,
        }
    };
    let (plus, minus) = task.touched_files.iter().fold((0, 0), |(p, m), f| (p + f.plus, m + f.minus));
    TaskSummary {
        id: task.id.clone(),
        agent: task.agent,
        repo: task.repo.clone(),
        title: task.title.clone(),
        pinned: task.pinned,
        state,
        plus,
        minus,
        created_at: task.created_at,
        updated_at: task.updated_at,
        unread: task.updated_at > task.seen_at,
    }
}

/// Provisional title until the task's harness generates one: the first line of the prompt, truncated.
pub fn provisional_title(message: &str) -> String {
    const MAX: usize = 60;
    let line = message.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    if line.chars().count() <= MAX {
        return line.to_string();
    }
    let cut: String = line.chars().take(MAX).collect();
    let cut = cut.rsplit_once(' ').map(|(head, _)| head).unwrap_or(&cut);
    format!("{cut}…")
}
