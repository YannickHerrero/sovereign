mod api;
mod config;
mod pi;
mod repos;
mod store;

use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
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
    let store = Store::open(store_path)?;
    let listen = config.listen.clone();
    let state = Arc::new(api::AppState { config, store, started_at: Instant::now() });
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    tracing::info!("listening on {listen}");
    axum::serve(listener, api::router(state)).await?;
    Ok(())
}
