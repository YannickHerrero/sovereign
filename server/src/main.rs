mod agent;
mod api;
mod assets;
mod claude;
mod config;
mod git;
mod pi;
mod repos;
mod store;
mod tasks;

use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::agent::manager::Agents;
use crate::claude::adapter::ClaudeBackend;
use crate::pi::adapter::PiBackend;
use crate::store::Store;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config_path = std::env::var_os("SOVEREIGN_CONFIG")
        .map(Into::into)
        .unwrap_or_else(Config::path);
    let config = Config::load_or_create(&config_path)?;
    tracing::info!(name = %config.name, repos_root = %config.repos_root.display(), "starting");

    let store_path = std::env::var_os("SOVEREIGN_STORE")
        .map(Into::into)
        .unwrap_or_else(Store::default_path);
    let store = Arc::new(Store::open(store_path)?);
    let candidates: Vec<Arc<dyn agent::Backend>> = vec![
        Arc::new(PiBackend { bin: config.pi_bin.clone() }),
        Arc::new(ClaudeBackend { bin: config.claude.bin.clone(), models: config.claude.models.clone() }),
    ];
    let mut backends = Vec::new();
    for backend in candidates {
        match backend.probe().await {
            Ok(()) => backends.push(backend),
            Err(err) => tracing::warn!("agent {:?} unavailable: {err:#}", backend.kind()),
        }
    }
    anyhow::ensure!(!backends.is_empty(), "no coding agent found: install pi or Claude Code");
    let agents = Agents::new(config.clone(), store.clone(), backends);
    agents.recover_interrupted().await;
    let listen = config.listen.clone();
    let state = Arc::new(api::AppState { config, store, agents, started_at: Instant::now() });
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    tracing::info!("listening on {listen}");
    axum::serve(listener, api::router(state)).await?;
    Ok(())
}
