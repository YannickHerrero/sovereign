use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use anyhow::{ensure, Context, Result};
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
            let mut file = File::open(path)
                .with_context(|| format!("opening {}", path.display()))?;
            #[cfg(unix)]
            protect_config(&file, path)?;
            let mut raw = String::new();
            file.read_to_string(&mut raw)
                .with_context(|| format!("reading {}", path.display()))?;
            let mut config: Config =
                toml::from_str(&raw).with_context(|| format!("parsing {}", path.display()))?;
            ensure!(!config.token.trim().is_empty(), "config token must not be empty or whitespace");
            config.repos_root = expand_home(&config.repos_root);
            return Ok(config);
        }
        let config = Config::default();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Set the mode at creation time: never briefly expose the token via the umask.
        // create_new also prevents overwriting a config created by another process.
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(path)
            .with_context(|| format!("creating {}", path.display()))?;
        #[cfg(unix)]
        protect_config(&file, path)?;
        file.write_all(toml::to_string_pretty(&config)?.as_bytes())
            .with_context(|| format!("writing {}", path.display()))?;
        tracing::info!("created default config at {}", path.display());
        Ok(config)
    }
}

#[cfg(unix)]
fn protect_config(file: &File, path: &Path) -> Result<()> {
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
        .with_context(|| format!("restricting permissions on {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestConfig(PathBuf);

    impl TestConfig {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("sovereign-config-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir.join("config.toml"))
        }
    }

    impl Drop for TestConfig {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.0.parent().unwrap());
        }
    }

    #[test]
    fn default_listener_is_loopback_only() {
        assert_eq!(Config::default().listen, "127.0.0.1:7777");
    }

    #[test]
    fn rejects_empty_or_whitespace_tokens_without_replacing_them() {
        let path = TestConfig::new();
        for token in ["", " ", "\t\r\n", "\u{2003}"] {
            let config = Config { token: token.into(), ..Config::default() };
            let original = toml::to_string_pretty(&config).unwrap();
            std::fs::write(&path.0, &original).unwrap();
            let error = Config::load_or_create(&path.0).unwrap_err();
            assert!(error.to_string().contains("token must not be empty"));
            assert_eq!(std::fs::read_to_string(&path.0).unwrap(), original);
        }
    }

    #[test]
    fn accepts_an_existing_nonempty_token() {
        let path = TestConfig::new();
        let config = Config { token: "existing-test-token".into(), ..Config::default() };
        std::fs::write(&path.0, toml::to_string_pretty(&config).unwrap()).unwrap();
        assert_eq!(Config::load_or_create(&path.0).unwrap().token, config.token);
    }

    #[cfg(unix)]
    #[test]
    fn new_config_is_private_and_token_survives_reload() {
        let path = TestConfig::new();
        let config = Config::load_or_create(&path.0).unwrap();
        assert_eq!(std::fs::metadata(&path.0).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(config.token.len(), 48);
        assert_eq!(Config::load_or_create(&path.0).unwrap().token, config.token);
    }

    #[cfg(unix)]
    #[test]
    fn existing_config_permissions_are_restricted_without_rewriting() {
        let path = TestConfig::new();
        let config = Config { listen: "127.0.0.1:8888".into(), ..Config::default() };
        let original = toml::to_string_pretty(&config).unwrap();
        std::fs::write(&path.0, &original).unwrap();
        std::fs::set_permissions(&path.0, std::fs::Permissions::from_mode(0o644)).unwrap();
        let loaded = Config::load_or_create(&path.0).unwrap();
        assert_eq!(std::fs::metadata(&path.0).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(loaded.listen, config.listen);
        assert_eq!(loaded.token, config.token);
        assert_eq!(std::fs::read_to_string(&path.0).unwrap(), original);
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
