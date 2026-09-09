//! One `pi --mode rpc` child process: JSONL commands on stdin, responses and events on stdout.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

pub struct PiProcess {
    child: Mutex<Option<Child>>,
    stdin: tokio::sync::Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    next_id: AtomicU64,
}

impl PiProcess {
    /// Spawns pi in `cwd`. Every non-response line from stdout is forwarded to `events`;
    /// the channel closes when the process exits.
    pub async fn spawn(
        pi_bin: &str,
        cwd: &Path,
        args: &[String],
        events: mpsc::Sender<Value>,
    ) -> Result<std::sync::Arc<Self>> {
        let mut child = Command::new(pi_bin)
            .arg("--mode")
            .arg("rpc")
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("spawning {pi_bin} in {}", cwd.display()))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("pi stdin unavailable"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("pi stdout unavailable"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("pi stderr unavailable"))?;

        let process = std::sync::Arc::new(Self {
            child: Mutex::new(Some(child)),
            stdin: tokio::sync::Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        });

        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(target: "pi", "{line}");
            }
        });

        let reader = process.clone();
        tokio::spawn(async move {
            // Split on '\n' only: pi's protocol forbids treating other separators as newlines.
            let mut lines = BufReader::new(stdout).split(b'\n');
            while let Ok(Some(raw)) = lines.next_segment().await {
                let text = String::from_utf8_lossy(&raw);
                let text = text.trim_end_matches('\r');
                if text.is_empty() {
                    continue;
                }
                let value: Value = match serde_json::from_str(text) {
                    Ok(v) => v,
                    Err(_) => {
                        tracing::debug!(target: "pi", "non-json stdout line: {text}");
                        continue;
                    }
                };
                if value.get("type").and_then(Value::as_str) == Some("response") {
                    let id = value.get("id").and_then(Value::as_str).map(String::from);
                    if let Some(tx) = id.and_then(|id| reader.pending.lock().unwrap().remove(&id)) {
                        let _ = tx.send(value);
                    }
                    continue;
                }
                if events.send(value).await.is_err() {
                    break;
                }
            }
        });

        Ok(process)
    }

    /// Sends a command and waits for its correlated response. Errors if pi reports failure.
    pub async fn command(&self, mut command: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        command["id"] = Value::String(id.clone());
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);

        let mut line = serde_json::to_string(&command)?;
        line.push('\n');
        {
            let mut stdin = self.stdin.lock().await;
            if let Err(err) = stdin.write_all(line.as_bytes()).await {
                self.pending.lock().unwrap().remove(&id);
                return Err(err).context("writing to pi stdin");
            }
        }

        let response = match tokio::time::timeout(COMMAND_TIMEOUT, rx).await {
            Ok(Ok(v)) => v,
            Ok(Err(_)) => bail!("pi exited before answering"),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                bail!("pi did not answer within {}s", COMMAND_TIMEOUT.as_secs());
            }
        };
        if response.get("success").and_then(Value::as_bool) == Some(true) {
            Ok(response.get("data").cloned().unwrap_or(Value::Null))
        } else {
            let error = response.get("error").and_then(Value::as_str).unwrap_or("unknown error");
            bail!("pi rejected {}: {error}", command["type"].as_str().unwrap_or("command"))
        }
    }

    /// Sends a raw line without waiting for a response (used for extension UI responses).
    pub async fn send_raw(&self, value: &Value) -> Result<()> {
        let mut line = serde_json::to_string(value)?;
        line.push('\n');
        self.stdin.lock().await.write_all(line.as_bytes()).await.context("writing to pi stdin")
    }

    pub async fn kill(&self) {
        let child = self.child.lock().unwrap().take();
        if let Some(mut child) = child {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }
}
