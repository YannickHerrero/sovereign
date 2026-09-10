use std::sync::Arc;
use std::time::Instant;

use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use tower_http::cors::{Any, CorsLayer};

use crate::config::Config;
use crate::repos;
use crate::agent::manager::Agents;
use crate::store::Store;

mod models;
mod tasks;
mod ws;

pub struct AppState {
    pub config: Config,
    pub store: Arc<Store>,
    pub agents: Arc<Agents>,
    pub started_at: Instant,
}

pub type SharedState = Arc<AppState>;

pub fn router(state: SharedState) -> Router {
    let api = Router::new()
        .route("/workspace", get(workspace))
        .route("/repos", get(list_repos))
        .route("/models", get(models::list))
        .route("/tasks", get(tasks::list).post(tasks::create))
        .route("/tasks/{id}", get(tasks::detail).patch(tasks::patch).delete(tasks::delete))
        .route("/tasks/{id}/prompt", post(tasks::prompt))
        .route("/tasks/{id}/models", get(tasks::models))
        .route("/tasks/{id}/model", post(tasks::set_model))
        .route("/tasks/{id}/abort", post(tasks::abort))
        .route("/tasks/{id}/diff", get(tasks::diff))
        .route("/tasks/{id}/ui-response", post(tasks::ui_response))
        .route("/ws", get(ws::upgrade))
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), require_token))
        .with_state(state);

    Router::new()
        .nest("/api", api)
        .merge(crate::assets::router())
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
}

async fn require_token(State(state): State<SharedState>, req: Request, next: Next) -> Response {
    let header_token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let query_token = req.uri().query().and_then(|q| {
        q.split('&')
            .find_map(|pair| pair.strip_prefix("token="))
    });
    let presented = header_token.or(query_token);
    if presented == Some(state.config.token.as_str()) {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, "invalid token").into_response()
    }
}

#[derive(Serialize)]
struct Workspace {
    name: String,
    version: &'static str,
    uptime_secs: u64,
    agents_running: usize,
    /// Coding agents whose binaries answered on this machine.
    agents: Vec<crate::agent::AgentKind>,
}

async fn workspace(State(state): State<SharedState>) -> Json<Workspace> {
    Json(Workspace {
        name: state.config.name.clone(),
        version: env!("CARGO_PKG_VERSION"),
        uptime_secs: state.started_at.elapsed().as_secs(),
        agents_running: state.agents.working_count(),
        agents: state.agents.kinds(),
    })
}

async fn list_repos(State(state): State<SharedState>) -> Result<Json<Vec<repos::Repo>>, ApiError> {
    let root = state.config.repos_root.clone();
    let repos = tokio::task::spawn_blocking(move || repos::list(&root))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?
        .map_err(|e| ApiError::internal(format!("listing repos: {e}")))?;
    Ok(Json(repos))
}

pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn internal(message: impl Into<String>) -> Self {
        Self { status: StatusCode::INTERNAL_SERVER_ERROR, message: message.into() }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self { status: StatusCode::NOT_FOUND, message: message.into() }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self { status: StatusCode::BAD_REQUEST, message: message.into() }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        tracing::warn!(status = %self.status, "{}", self.message);
        (self.status, Json(serde_json::json!({ "error": self.message }))).into_response()
    }
}
