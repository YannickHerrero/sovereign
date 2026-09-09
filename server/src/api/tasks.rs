use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{ApiError, SharedState};
use crate::pi::session::{self, Turn};
use crate::repos;
use crate::store::{now_ms, Task, TouchedFile};
use crate::tasks::{provisional_title, TaskSummary};

#[derive(Serialize)]
pub struct TaskDetail {
    #[serde(flatten)]
    pub summary: TaskSummary,
    pub model: Option<String>,
    pub branch: Option<String>,
    pub touched_files: Vec<TouchedFile>,
    pub turns: Vec<Turn>,
}

pub async fn list(State(state): State<SharedState>) -> Json<Vec<TaskSummary>> {
    let mut tasks = state.store.all();
    tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Json(tasks.iter().map(|t| state.agents.summary(t)).collect())
}

pub async fn detail(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<TaskDetail>, ApiError> {
    let task = load(&state, &id)?;
    let session_file = task.session_file.clone();
    let cwd = task.cwd.clone();
    let (session, branch) = tokio::task::spawn_blocking(move || {
        let session = match session_file {
            Some(file) if file.exists() => session::read(&file),
            _ => Ok(session::Session::default()),
        };
        (session, repos::current_branch(&cwd))
    })
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;
    let session = session.map_err(|e| ApiError::internal(format!("reading session: {e}")))?;
    Ok(Json(TaskDetail {
        summary: state.agents.summary(&task),
        model: session.model,
        branch,
        touched_files: task.last_run.as_ref().map(|r| r.touched_files.clone()).unwrap_or_default(),
        turns: session.turns,
    }))
}

#[derive(Deserialize)]
pub struct CreateTask {
    repo: String,
    message: String,
}

pub async fn create(
    State(state): State<SharedState>,
    Json(body): Json<CreateTask>,
) -> Result<(StatusCode, Json<TaskSummary>), ApiError> {
    let message = body.message.trim().to_string();
    if message.is_empty() {
        return Err(ApiError::bad_request("message is empty"));
    }
    let repo = repos::find(&state.config.repos_root, &body.repo)
        .ok_or_else(|| ApiError::bad_request("unknown repo"))?;
    let now = now_ms();
    let task = Task {
        id: uuid::Uuid::new_v4().to_string(),
        repo: repo.name,
        cwd: repo.path,
        session_id: uuid::Uuid::new_v4().to_string(),
        session_file: None,
        title: provisional_title(&message),
        pinned: false,
        created_at: now,
        updated_at: now,
        last_run: None,
    };
    state.store.insert(task.clone()).map_err(|e| ApiError::internal(e.to_string()))?;
    state.agents.broadcast_task(&task);

    if let Err(err) = state.agents.prompt(&task, &message).await {
        return Err(ApiError::internal(format!("starting pi: {err}")));
    }
    let task = state.store.get(&task.id).unwrap_or(task);
    Ok((StatusCode::CREATED, Json(state.agents.summary(&task))))
}

#[derive(Deserialize)]
pub struct Prompt {
    message: String,
}

pub async fn prompt(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(body): Json<Prompt>,
) -> Result<StatusCode, ApiError> {
    let message = body.message.trim();
    if message.is_empty() {
        return Err(ApiError::bad_request("message is empty"));
    }
    let task = load(&state, &id)?;
    state
        .agents
        .prompt(&task, message)
        .await
        .map_err(|e| ApiError::internal(format!("sending prompt: {e}")))?;
    Ok(StatusCode::ACCEPTED)
}

pub async fn abort(State(state): State<SharedState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    load(&state, &id)?;
    state.agents.abort(&id).await.map_err(|e| ApiError::bad_request(e.to_string()))?;
    Ok(StatusCode::ACCEPTED)
}

#[derive(Deserialize)]
pub struct Patch {
    pinned: Option<bool>,
    title: Option<String>,
}

pub async fn patch(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(body): Json<Patch>,
) -> Result<Json<TaskSummary>, ApiError> {
    let title = body.title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    let updated = state
        .store
        .update(&id, |t| {
            if let Some(pinned) = body.pinned {
                t.pinned = pinned;
            }
            if let Some(title) = &title {
                t.title = title.clone();
            }
        })
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("unknown task"))?;
    if let Some(title) = &title {
        state.agents.rename(&id, title).await;
    }
    state.agents.broadcast_task(&updated);
    Ok(Json(state.agents.summary(&updated)))
}

pub async fn delete(State(state): State<SharedState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    state.agents.stop(&id).await;
    state
        .store
        .remove(&id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("unknown task"))?;
    state.agents.broadcast_removed(&id);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn ui_response(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<StatusCode, ApiError> {
    load(&state, &id)?;
    state.agents.ui_response(&id, body).await.map_err(|e| ApiError::bad_request(e.to_string()))?;
    Ok(StatusCode::ACCEPTED)
}

fn load(state: &SharedState, id: &str) -> Result<Task, ApiError> {
    state.store.get(id).ok_or_else(|| ApiError::not_found("unknown task"))
}
