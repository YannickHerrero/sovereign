//! Model discovery and selection use pi's authenticated model registry, not a static list.
use std::path::Path;

use anyhow::Result;
use serde::Deserialize;
use serde_json::json;

pub use crate::agent::{Model, ModelList, ModelRef};
use tokio::sync::mpsc;

use super::process::PiProcess;

pub async fn list(process: &PiProcess) -> Result<ModelList> {
    #[derive(Deserialize)]
    struct Available { models: Vec<Model> }
    #[derive(Deserialize)]
    struct State { model: Option<Model> }
    let available: Available = serde_json::from_value(process.command(json!({"type": "get_available_models"})).await?)?;
    let state: State = serde_json::from_value(process.command(json!({"type": "get_state"})).await?)?;
    Ok(ModelList { models: available.models, current: state.model })
}

pub async fn set(process: &PiProcess, model: &ModelRef) -> Result<Model> {
    let result = process.command(json!({"type": "set_model", "provider": model.provider, "modelId": model.id})).await?;
    Ok(serde_json::from_value(result)?)
}

/// New tasks have no session yet. Probe in the repo context without creating a session file.
pub async fn discover(pi_bin: &str, cwd: &Path) -> Result<ModelList> {
    let (tx, mut rx) = mpsc::channel(256);
    let drain = tokio::spawn(async move { while rx.recv().await.is_some() {} });
    let result = async {
        let process = PiProcess::spawn(pi_bin, cwd, &["--no-session".into()], tx).await?;
        let result = list(&process).await;
        process.kill().await;
        result
    }.await;
    drain.abort();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn discovers_and_selects_using_rpc() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("sovereign-models-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("pi");
        std::fs::write(&script, include_str!("../../tests/fixtures/pi-models.sh")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let bin = script.to_str().unwrap();
        let available = discover(bin, &dir).await.unwrap();
        assert_eq!(available.models.len(), 2);
        assert_eq!(available.current.unwrap().provider, "test");
        assert_eq!(available.models[0].input, vec!["text", "image"]);

        let (tx, _rx) = mpsc::channel(16);
        let process = PiProcess::spawn(bin, &dir, &[], tx).await.unwrap();
        let selected = set(&process, &ModelRef { provider: "test".into(), id: "vision".into() }).await.unwrap();
        assert_eq!(selected.id, "vision");
        let error = set(&process, &ModelRef { provider: "missing".into(), id: "vision".into() }).await.unwrap_err();
        assert!(error.to_string().contains("Model not found"));
        process.kill().await;

        let store = std::sync::Arc::new(crate::store::Store::open(dir.join("tasks.json")).unwrap());
        let task = crate::store::Task {
            id: "task".into(), agent: Default::default(), repo: "repo".into(), cwd: dir.clone(),
            session_id: uuid::Uuid::new_v4().to_string(), session_file: None,
            title: "test".into(), pinned: false, created_at: 0, updated_at: 0,
            last_status: None, baseline: None, touched_files: vec![],
        };
        store.insert(task.clone()).unwrap();
        let config = crate::config::Config { pi_bin: bin.into(), ..Default::default() };
        let backend: std::sync::Arc<dyn crate::agent::Backend> = std::sync::Arc::new(crate::pi::adapter::PiBackend { bin: bin.into() });
        let agents = crate::agent::manager::Agents::new(config, store, vec![backend]);
        let mut events = agents.subscribe();
        let choice = ModelRef { provider: "test".into(), id: "vision".into() };
        agents.set_model(&task, &choice).await.unwrap();
        assert!(matches!(events.recv().await.unwrap(),
            crate::agent::manager::ServerEvent::RunEvent {
                event: crate::agent::manager::RunEvent::ModelChanged { .. }, ..
            }));
        std::fs::write(dir.join("working"), "").unwrap();
        let error = agents.set_model(&task, &choice).await.unwrap_err();
        assert!(error.to_string().contains("Wait for the agent"));
        agents.stop(&task.id).await;
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn model_identity_includes_provider() {
        let a: ModelRef = serde_json::from_value(json!({"provider":"a", "id":"same"})).unwrap();
        let b: ModelRef = serde_json::from_value(json!({"provider":"b", "id":"same"})).unwrap();
        assert_ne!(a, b);
        assert!(serde_json::from_value::<ModelRef>(json!({"id":"same"})).is_err());
    }
}
