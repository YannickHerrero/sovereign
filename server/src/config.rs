use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub name: String,
    pub listen: String,
    pub token: String,
    pub repos_root: PathBuf,
    pub pi_bin: String,
    pub idle_kill_secs: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            name: hostname(),
            listen: "127.0.0.1:7777".into(),
            token: random_token(),
            repos_root: home().join("dev"),
            pi_bin: "pi".into(),
            idle_kill_secs: 600,
        }
    }
}

impl Config {
    pub fn path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| home().join(".config"))
            .join("sovereign")
            .join("config.toml")
    }

    /// Loads the config file, writing a fresh default one on first run.
    pub fn load_or_create(path: &Path) -> Result<Self> {
        if path.exists() {
            let raw = std::fs::read_to_string(path)
                .with_context(|| format!("reading {}", path.display()))?;
            let mut config: Config =
                toml::from_str(&raw).with_context(|| format!("parsing {}", path.display()))?;
            config.repos_root = expand_home(&config.repos_root);
            return Ok(config);
        }
        let config = Config::default();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, toml::to_string_pretty(&config)?)
            .with_context(|| format!("writing {}", path.display()))?;
        tracing::info!("created default config at {}", path.display());
        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_listener_is_loopback_only() {
        assert_eq!(Config::default().listen, "127.0.0.1:7777");
    }
}

fn home() -> PathBuf {
    dirs::home_dir().expect("home directory")
}

fn hostname() -> String {
    std::fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "workspace".into())
}

fn random_token() -> String {
    let bytes: [u8; 24] = rand::random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn expand_home(path: &Path) -> PathBuf {
    match path.strip_prefix("~") {
        Ok(rest) => home().join(rest),
        Err(_) => path.to_path_buf(),
    }
}
