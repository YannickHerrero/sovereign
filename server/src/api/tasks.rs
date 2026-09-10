use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{ApiError, SharedState};
use crate::git;
use crate::agent::{AgentKind, Model, ModelList, ModelRef, Turn};
use crate::pi::image::{self, ImageContent};
use crate::repos;
use crate::store::{now_ms, Task, TouchedFile};
use crate::tasks::{provisional_title, TaskSummary};

#[derive(Serialize)]
pub struct TaskDetail {
    #[serde(flatten)]
    pub summary: TaskSummary,
    pub agent: AgentKind,
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
    let agents = state.agents.clone();
    let blocking_task = task.clone();
    let (session, branch) = tokio::task::spawn_blocking(move || {
        (agents.transcript(&blocking_task), repos::current_branch(&blocking_task.cwd))
    })
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;
    let session = session.map_err(|e| ApiError::internal(format!("reading session: {e}")))?;
    Ok(Json(TaskDetail {
        summary: state.agents.summary(&task),
        agent: task.agent,
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
    #[serde(default)]
    agent: AgentKind,
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
    // The chosen model decides the agent; `agent` alone is enough when no model is picked.
    let agent = body.model.as_ref().map(|m| m.agent).unwrap_or(body.agent);
    state.agents.backend(agent).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let task = Task {
        id: uuid::Uuid::new_v4().to_string(),
        agent,
        repo: repo.name,
        cwd: repo.path,
        session_id: uuid::Uuid::new_v4().to_string(),
        session_file: None,
        title: provisional_title(if message.is_empty() { "Image" } else { &message }),
        pinned: false,
        created_at: now,
        updated_at: now,
        last_status: None,
        running: false,
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
        return Err(ApiError::internal(format!("starting the agent: {err}")));
    }
    if !message.is_empty() {
        tokio::spawn(generate_title(state.clone(), task.id.clone(), task.agent, message));
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
        .map_err(|e| ApiError::internal(format!("listing models: {e}")))
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
async fn generate_title(state: SharedState, task_id: String, agent: crate::agent::AgentKind, message: String) {
    let provisional = provisional_title(&message);
    let title = match state.agents.generate_title(agent, &message).await {
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

#[derive(Deserialize, Default)]
pub struct DiffQuery {
    /// Only this file's patch.
    path: Option<String>,
    /// Stats only, with empty patches: the client fetches patches file by file.
    #[serde(default)]
    summary: bool,
}

pub async fn diff(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<DiffQuery>,
) -> Result<Json<DiffResponse>, ApiError> {
    let task = load(&state, &id)?;
    let mut files = task.touched_files;
    if let Some(path) = &query.path {
        files.retain(|f| &f.path == path);
        if files.is_empty() {
            return Err(ApiError::not_found("file is not part of this task's changes"));
        }
    }
    if query.summary {
        let files = files
            .into_iter()
            .map(|f| git::FileDiff { path: f.path, plus: f.plus, minus: f.minus, patch: String::new() })
            .collect();
        return Ok(Json(DiffResponse { files }));
    }
    let base = task.baseline.and_then(|b| b.head);
    let cwd = task.cwd;
    let files = tokio::task::spawn_blocking(move || git::diffs(&cwd, base.as_deref(), &files))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(DiffResponse { files }))
}

#[derive(Deserialize)]
pub struct FileQuery {
    path: String,
}

/// Working-tree text of one touched file, used by the diff view to expand context.
pub async fn file(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<FileQuery>,
) -> Result<String, ApiError> {
    let task = load(&state, &id)?;
    if !task.touched_files.iter().any(|f| f.path == query.path) {
        return Err(ApiError::not_found("file is not part of this task's changes"));
    }
    let cwd = task.cwd;
    let text = tokio::task::spawn_blocking(move || git::read_text(&cwd, &query.path))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?
        .map_err(ApiError::bad_request)?;
    text.ok_or_else(|| ApiError::not_found("file no longer exists in the working tree"))
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
