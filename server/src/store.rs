//! Task metadata persisted as a single JSON file, rewritten atomically on every change.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::agent::{AgentKind, RunStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    /// Which coding agent runs this task; tasks created before the field existed are pi's.
    #[serde(default)]
    pub agent: AgentKind,
    pub repo: String,
    pub cwd: PathBuf,
    pub session_id: String,
    pub session_file: Option<PathBuf>,
    pub title: String,
    pub pinned: bool,
    pub created_at: u64,
    pub updated_at: u64,
    /// Outcome of the most recent run; None until the first run settles.
    pub last_status: Option<RunStatus>,
    /// Repo state before the task's first run. Files touched by the task are measured from it,
    /// so pi's own commits are included.
    pub baseline: Option<Baseline>,
    pub touched_files: Vec<TouchedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Baseline {
    pub head: Option<String>,
    pub files: BTreeMap<String, (u32, u32)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TouchedFile {
    pub path: String,
    pub plus: u32,
    pub minus: u32,
}

pub struct Store {
    path: PathBuf,
    tasks: Mutex<Vec<Task>>,
}

impl Store {
    pub fn default_path() -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| dirs::home_dir().expect("home directory").join(".local/share"))
            .join("sovereign")
            .join("tasks.json")
    }

    pub fn open(path: PathBuf) -> Result<Self> {
        let tasks = if path.exists() {
            let raw = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
            serde_json::from_str(&raw).with_context(|| format!("parsing {}", path.display()))?
        } else {
            Vec::new()
        };
        Ok(Self { path, tasks: Mutex::new(tasks) })
    }

    pub fn all(&self) -> Vec<Task> {
        self.tasks.lock().unwrap().clone()
    }

    pub fn get(&self, id: &str) -> Option<Task> {
        self.tasks.lock().unwrap().iter().find(|t| t.id == id).cloned()
    }

    pub fn insert(&self, task: Task) -> Result<()> {
        let mut tasks = self.tasks.lock().unwrap();
        tasks.push(task);
        self.persist(&tasks)
    }

    /// Applies `f` to the task and persists. Returns the updated task, or None if unknown.
    pub fn update(&self, id: &str, f: impl FnOnce(&mut Task)) -> Result<Option<Task>> {
        let mut tasks = self.tasks.lock().unwrap();
        let Some(task) = tasks.iter_mut().find(|t| t.id == id) else { return Ok(None) };
        f(task);
        let updated = task.clone();
        self.persist(&tasks)?;
        Ok(Some(updated))
    }

    pub fn remove(&self, id: &str) -> Result<Option<Task>> {
        let mut tasks = self.tasks.lock().unwrap();
        let Some(pos) = tasks.iter().position(|t| t.id == id) else { return Ok(None) };
        let removed = tasks.remove(pos);
        self.persist(&tasks)?;
        Ok(Some(removed))
    }

    fn persist(&self, tasks: &[Task]) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(tasks)?)?;
        std::fs::rename(&tmp, &self.path).with_context(|| format!("writing {}", self.path.display()))
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
