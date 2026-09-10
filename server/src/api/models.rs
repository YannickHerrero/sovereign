use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;

use super::{ApiError, SharedState};
use crate::agent::ModelList;
use crate::repos;

#[derive(Deserialize)]
pub struct ModelQuery {
    repo: String,
}

pub async fn list(
    State(state): State<SharedState>,
    Query(query): Query<ModelQuery>,
) -> Result<Json<ModelList>, ApiError> {
    let repo = repos::find(&state.config.repos_root, &query.repo)
        .ok_or_else(|| ApiError::bad_request("unknown repo"))?;
    state.agents.discover_models(&repo.path).await
        .map(Json)
        .map_err(|e| ApiError::internal(format!("listing models: {e}")))
}
