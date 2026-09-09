mod api;
mod config;
mod repos;

use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tracing_subscriber::EnvFilter;

use crate::config::Config;

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

    let listen = config.listen.clone();
    let state = Arc::new(api::AppState { config, started_at: Instant::now() });
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    tracing::info!("listening on {listen}");
    axum::serve(listener, api::router(state)).await?;
    Ok(())
}
