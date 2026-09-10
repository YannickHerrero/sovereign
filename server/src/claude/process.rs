//! One headless Claude Code child: `claude -p` with stream-json on both stdin and stdout.
//! User messages and control requests go in as JSON lines; events come out the same way.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot};

const CONTROL_TIMEOUT: Duration = Duration::from_secs(30);

pub struct ClaudeProcess {
    child: Mutex<Option<Child>>,
    stdin: tokio::sync::Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    next_id: AtomicU64,
}

impl ClaudeProcess {
    /// Spawns Claude Code in `cwd`, fully autonomous (no permission prompts). Every stdout line
    /// that is not a control response is forwarded to `events`; the channel closes on exit.
    pub async fn spawn(
        bin: &str,
        cwd: &Path,
        args: &[String],
        events: mpsc::Sender<Value>,
    ) -> Result<std::sync::Arc<Self>> {
        let mut child = Command::new(bin)
            .args([
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--permission-mode",
                "bypassPermissions",
            ])
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("spawning {bin} in {}", cwd.display()))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("claude stdin unavailable"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("claude stdout unavailable"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("claude stderr unavailable"))?;

        let process = std::sync::Arc::new(Self {
            child: Mutex::new(Some(child)),
            stdin: tokio::sync::Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        });

        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(target: "claude", "{line}");
            }
        });

        let reader = process.clone();
        tokio::spawn(async move {
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
                        tracing::debug!(target: "claude", "non-json stdout line: {text}");
                        continue;
                    }
                };
                if value.get("type").and_then(Value::as_str) == Some("control_response") {
                    let id = value
                        .pointer("/response/request_id")
                        .and_then(Value::as_str)
                        .map(String::from);
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

    /// Sends a control request (interrupt, set_model, …) and waits for its response.
    pub async fn control(&self, request: Value) -> Result<Value> {
        let id = format!("sov-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        let envelope = json!({ "type": "control_request", "request_id": id, "request": request });
        if let Err(err) = self.send(&envelope).await {
            self.pending.lock().unwrap().remove(&id);
            return Err(err);
        }
        let response = match tokio::time::timeout(CONTROL_TIMEOUT, rx).await {
            Ok(Ok(v)) => v,
            Ok(Err(_)) => bail!("claude exited before answering"),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                bail!("claude did not answer within {}s", CONTROL_TIMEOUT.as_secs());
            }
        };
        match response.pointer("/response/subtype").and_then(Value::as_str) {
            Some("success") => Ok(response.pointer("/response/response").cloned().unwrap_or(Value::Null)),
            _ => {
                let error = response.pointer("/response/error").and_then(Value::as_str).unwrap_or("unknown error");
                bail!("claude rejected the request: {error}")
            }
        }
    }

    /// Writes one JSON line to stdin (user messages, control responses).
    pub async fn send(&self, value: &Value) -> Result<()> {
        let mut line = serde_json::to_string(value)?;
        line.push('\n');
        self.stdin.lock().await.write_all(line.as_bytes()).await.context("writing to claude stdin")
    }

    pub async fn kill(&self) {
        let child = self.child.lock().unwrap().take();
        if let Some(mut child) = child {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }
}
