//! Task views shared by the HTTP API and the WebSocket event stream.

use serde::Serialize;

use crate::pi::session::RunStatus;
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
    pub repo: String,
    pub title: String,
    pub pinned: bool,
    pub state: TaskState,
    pub plus: u32,
    pub minus: u32,
    pub created_at: u64,
    pub updated_at: u64,
}

pub fn summarize(task: &Task, working: bool) -> TaskSummary {
    let state = if working {
        TaskState::Working
    } else {
        match &task.last_run {
            None => TaskState::Pending,
            Some(run) => match run.status {
                RunStatus::Error | RunStatus::Aborted => TaskState::Failed,
                RunStatus::Settled if run.touched_files.is_empty() => TaskState::NoChanges,
                RunStatus::Settled => TaskState::Done,
            },
        }
    };
    let (plus, minus) = task
        .last_run
        .as_ref()
        .map(|r| r.touched_files.iter().fold((0, 0), |(p, m), f| (p + f.plus, m + f.minus)))
        .unwrap_or((0, 0));
    TaskSummary {
        id: task.id.clone(),
        repo: task.repo.clone(),
        title: task.title.clone(),
        pinned: task.pinned,
        state,
        plus,
        minus,
        created_at: task.created_at,
        updated_at: task.updated_at,
    }
}

/// Provisional title until pi generates one: the first line of the prompt, truncated.
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
