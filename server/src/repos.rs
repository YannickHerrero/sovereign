use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Repo {
    pub name: String,
    pub path: PathBuf,
    pub is_git: bool,
    pub branch: Option<String>,
}

/// Every directory directly under `root`, sorted by name. Hidden directories are skipped.
pub fn list(root: &Path) -> std::io::Result<Vec<Repo>> {
    let mut repos: Vec<Repo> = std::fs::read_dir(root)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if name.starts_with('.') {
                return None;
            }
            let path = entry.path();
            let is_git = path.join(".git").exists();
            let branch = if is_git { current_branch(&path) } else { None };
            Some(Repo { name, path, is_git, branch })
        })
        .collect();
    repos.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(repos)
}

pub fn find(root: &Path, name: &str) -> Option<Repo> {
    if name.is_empty() || name.starts_with('.') || name.contains('/') {
        return None;
    }
    let path = root.join(name);
    if !path.is_dir() {
        return None;
    }
    let is_git = path.join(".git").exists();
    let branch = if is_git { current_branch(&path) } else { None };
    Some(Repo { name: name.to_string(), path, is_git, branch })
}

pub fn current_branch(repo: &Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(repo)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!branch.is_empty()).then_some(branch)
}
