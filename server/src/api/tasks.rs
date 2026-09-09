use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{ApiError, SharedState};
use crate::git;
use crate::pi::{image::{self, ImageContent}, session, session::Turn, title};
use crate::pi::models::{Model, ModelList, ModelRef};
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
        touched_files: task.touched_files.clone(),
        turns: session.turns,
    }))
}

#[derive(Deserialize)]
pub struct CreateTask {
    repo: String,
    message: String,
    model: Option<ModelRef>,
    #[serde(default)]
    images: Vec<ImageContent>,
}

pub async fn create(
    State(state): State<SharedState>,
    Json(body): Json<CreateTask>,
) -> Result<(StatusCode, Json<TaskSummary>), ApiError> {
    let message = body.message.trim().to_string();
    image::validate(&body.images).map_err(ApiError::bad_request)?;
    if message.is_empty() && body.images.is_empty() {
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
        title: provisional_title(if message.is_empty() { "Image" } else { &message }),
        pinned: false,
        created_at: now,
        updated_at: now,
        last_status: None,
        baseline: None,
        touched_files: Vec::new(),
    };
    state.store.insert(task.clone()).map_err(|e| ApiError::internal(e.to_string()))?;
    state.agents.broadcast_task(&task);

    if let Some(model) = &body.model {
        if let Err(err) = state.agents.set_model(&task, model).await {
            state.agents.stop(&task.id).await;
            state.store.remove(&task.id).map_err(|e| ApiError::internal(e.to_string()))?;
            state.agents.broadcast_removed(&task.id);
            return Err(ApiError::bad_request(format!("selecting model: {err}")));
        }
    }
    if let Err(err) = state.agents.prompt(&task, &message, &body.images).await {
        return Err(ApiError::internal(format!("starting pi: {err}")));
    }
    if !message.is_empty() {
        tokio::spawn(generate_title(state.clone(), task.id.clone(), message));
    }
    let task = state.store.get(&task.id).unwrap_or(task);
    Ok((StatusCode::CREATED, Json(state.agents.summary(&task))))
}

pub async fn models(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<ModelList>, ApiError> {
    let task = load(&state, &id)?;
    state.agents.models(&task).await.map(Json)
        .map_err(|e| ApiError::internal(format!("listing pi models: {e}")))
}

pub async fn set_model(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(model): Json<ModelRef>,
) -> Result<Json<Model>, ApiError> {
    let task = load(&state, &id)?;
    state.agents.set_model(&task, &model).await.map(Json)
        .map_err(|e| ApiError::bad_request(format!("selecting model: {e}")))
}

#[derive(Deserialize)]
pub struct Prompt {
    message: String,
    #[serde(default)]
    images: Vec<ImageContent>,
}

pub async fn prompt(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(body): Json<Prompt>,
) -> Result<StatusCode, ApiError> {
    let message = body.message.trim();
    image::validate(&body.images).map_err(ApiError::bad_request)?;
    if message.is_empty() && body.images.is_empty() {
        return Err(ApiError::bad_request("message is empty"));
    }
    let task = load(&state, &id)?;
    state
        .agents
        .prompt(&task, message, &body.images)
        .await
        .map_err(|e| ApiError::internal(format!("sending prompt: {e}")))?;
    Ok(StatusCode::ACCEPTED)
}

/// Replaces the provisional title with one written by pi, unless the user renamed the task first.
async fn generate_title(state: SharedState, task_id: String, message: String) {
    let provisional = provisional_title(&message);
    let title = match title::generate(&state.config.pi_bin, &message).await {
        Ok(title) => title,
        Err(err) => {
            tracing::warn!(task_id, "title generation failed: {err}");
            return;
        }
    };
    let updated = state.store.update(&task_id, |t| {
        if t.title == provisional {
            t.title = title.clone();
        }
    });
    if let Ok(Some(task)) = updated {
        if task.title == title {
            state.agents.rename(&task_id, &title).await;
            state.agents.broadcast_task(&task);
        }
    }
}

#[derive(Serialize)]
pub struct DiffResponse {
    files: Vec<git::FileDiff>,
}

pub async fn diff(State(state): State<SharedState>, Path(id): Path<String>) -> Result<Json<DiffResponse>, ApiError> {
    let task = load(&state, &id)?;
    let base = task.baseline.and_then(|b| b.head);
    let files = task.touched_files;
    let cwd = task.cwd;
    let files = tokio::task::spawn_blocking(move || git::diffs(&cwd, base.as_deref(), &files))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(DiffResponse { files }))
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
