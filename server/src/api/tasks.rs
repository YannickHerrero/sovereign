use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;

use super::{ApiError, SharedState};
use crate::pi::session::{self, RunStatus, Turn};
use crate::repos;
use crate::store::{Task, TouchedFile};

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Working,
    Done,
    NoChanges,
    Failed,
    Pending,
}

#[derive(Serialize)]
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

#[derive(Serialize)]
pub struct TaskDetail {
    #[serde(flatten)]
    pub summary: TaskSummary,
    pub model: Option<String>,
    pub branch: Option<String>,
    pub touched_files: Vec<TouchedFile>,
    pub turns: Vec<Turn>,
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

pub async fn list(State(state): State<SharedState>) -> Json<Vec<TaskSummary>> {
    let mut tasks = state.store.all();
    tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Json(tasks.iter().map(|t| summarize(t, false)).collect())
}

pub async fn detail(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<TaskDetail>, ApiError> {
    let task = state.store.get(&id).ok_or_else(|| ApiError::not_found("unknown task"))?;
    let session_file = task.session_file.clone();
    let cwd = task.cwd.clone();
    let (session, branch) = tokio::task::spawn_blocking(move || {
        let session = if session_file.exists() {
            session::read(&session_file)
        } else {
            Ok(session::Session::default())
        };
        (session, repos::current_branch(&cwd))
    })
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;
    let session = session.map_err(|e| ApiError::internal(format!("reading session: {e}")))?;
    Ok(Json(TaskDetail {
        summary: summarize(&task, false),
        model: session.model,
        branch,
        touched_files: task.last_run.as_ref().map(|r| r.touched_files.clone()).unwrap_or_default(),
        turns: session.turns,
    }))
}
