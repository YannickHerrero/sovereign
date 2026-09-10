//! Reader for Claude Code session files (`~/.claude/projects/<cwd>/<id>.jsonl`).
//!
//! Entries are linked by `uuid` / `parentUuid`; the chain also runs through `attachment` and
//! `system` entries, so every entry with a uuid is indexed and only `user` / `assistant` ones
//! become turns. The format is internal to Claude Code: unknown entries and fields are ignored.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::Value;

use crate::agent::{RunStatus, Session, Turn};
use crate::pi::image::ImageContent;

const INTERRUPT_MARKER: &str = "[Request interrupted by user";

pub fn read(path: &Path) -> Result<Session> {
    let raw = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    Ok(parse(&raw))
}

pub fn parse(raw: &str) -> Session {
    let mut session = Session::default();
    let mut by_uuid: HashMap<String, Value> = HashMap::new();
    let mut last_uuid: Option<String> = None;

    for line in raw.split('\n') {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(line) else { continue };
        if entry.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        if session.cwd.is_none() {
            session.cwd = entry.get("cwd").and_then(Value::as_str).map(String::from);
        }
        if let Some(uuid) = entry.get("uuid").and_then(Value::as_str) {
            last_uuid = Some(uuid.to_string());
            by_uuid.insert(uuid.to_string(), entry);
        }
    }

    // Claude Code appends in order, so the last linked entry is the active leaf.
    let mut branch = Vec::new();
    let mut cursor = last_uuid;
    while let Some(id) = cursor {
        match by_uuid.remove(&id) {
            Some(entry) => {
                cursor = entry.get("parentUuid").and_then(Value::as_str).map(String::from);
                branch.push(entry);
            }
            None => break,
        }
    }
    branch.reverse();

    let mut agent: Option<AgentAcc> = None;
    for entry in &branch {
        let Some(message) = entry.get("message") else { continue };
        let at = entry.get("timestamp").and_then(Value::as_str).map(parse_rfc3339_ms).unwrap_or(0);
        match entry.get("type").and_then(Value::as_str) {
            Some("user") => {
                let content = message.get("content");
                if is_tool_result(content) {
                    continue;
                }
                let text = content_text(content);
                if text.starts_with(INTERRUPT_MARKER) {
                    if let Some(acc) = agent.as_mut() {
                        acc.status = RunStatus::Aborted;
                    }
                    continue;
                }
                if let Some(acc) = agent.take() {
                    session.turns.push(acc.finish());
                }
                session.turns.push(Turn::User { text, at, images: images(content) });
            }
            Some("assistant") => {
                if let Some(model) = message.get("model").and_then(Value::as_str) {
                    session.model = Some(model.to_string());
                }
                let acc = agent.get_or_insert_with(|| AgentAcc::new(at));
                acc.at = at;
                acc.push(message);
            }
            _ => {}
        }
    }
    if let Some(acc) = agent.take() {
        session.turns.push(acc.finish());
    }
    session
}

struct AgentAcc {
    text: String,
    files: Vec<String>,
    at: u64,
    status: RunStatus,
}

impl AgentAcc {
    fn new(at: u64) -> Self {
        Self { text: String::new(), files: Vec::new(), at, status: RunStatus::Settled }
    }

    fn push(&mut self, message: &Value) {
        let Some(blocks) = message.get("content").and_then(Value::as_array) else { return };
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let text = block.get("text").and_then(Value::as_str).unwrap_or_default().trim();
                    if !text.is_empty() {
                        if !self.text.is_empty() {
                            self.text.push_str("\n\n");
                        }
                        self.text.push_str(text);
                    }
                }
                Some("tool_use") => {
                    let name = block.get("name").and_then(Value::as_str).unwrap_or_default();
                    if matches!(name, "Write" | "Edit" | "MultiEdit" | "NotebookEdit") {
                        if let Some(path) = block.pointer("/input/file_path").and_then(Value::as_str) {
                            if !self.files.contains(&path.to_string()) {
                                self.files.push(path.to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn finish(self) -> Turn {
        Turn::Agent { text: self.text, files: self.files, at: self.at, status: self.status }
    }
}

fn is_tool_result(content: Option<&Value>) -> bool {
    content
        .and_then(Value::as_array)
        .map(|blocks| blocks.iter().all(|b| b.get("type").and_then(Value::as_str) == Some("tool_result")))
        .unwrap_or(false)
}

fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn images(content: Option<&Value>) -> Vec<ImageContent> {
    content
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("image"))
                .filter_map(|b| {
                    let source = b.get("source")?;
                    Some(ImageContent {
                        data: source.get("data")?.as_str()?.to_string(),
                        mime_type: source.get("media_type")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parses `YYYY-MM-DDTHH:MM:SS[.fff]Z` into Unix milliseconds; anything else yields 0.
fn parse_rfc3339_ms(s: &str) -> u64 {
    let s = s.trim_end_matches('Z');
    let (date, time) = match s.split_once('T') {
        Some(parts) => parts,
        None => return 0,
    };
    let mut d = date.split('-').filter_map(|p| p.parse::<i64>().ok());
    let (Some(y), Some(m), Some(day)) = (d.next(), d.next(), d.next()) else { return 0 };
    let (hms, frac) = time.split_once('.').unwrap_or((time, ""));
    let mut t = hms.split(':').filter_map(|p| p.parse::<i64>().ok());
    let (Some(h), Some(min), Some(sec)) = (t.next(), t.next(), t.next()) else { return 0 };
    let millis: i64 = format!("{:0<3}", frac).chars().take(3).collect::<String>().parse().unwrap_or(0);
    // Days from civil (Howard Hinnant's algorithm).
    let (y, m) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86400 + h * 3600 + min * 60 + sec;
    if secs < 0 { 0 } else { (secs * 1000 + millis) as u64 }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"type":"permission-mode","permissionMode":"bypassPermissions","sessionId":"s"}
{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"do it"},"uuid":"u1","timestamp":"2026-09-09T08:46:53.857Z","cwd":"/repo","sessionId":"s"}
{"parentUuid":"u1","isSidechain":false,"type":"assistant","message":{"model":"claude-sonnet-5","role":"assistant","content":[{"type":"thinking","thinking":"hm"}]},"uuid":"a1","timestamp":"2026-09-09T08:46:59.563Z"}
{"parentUuid":"a1","isSidechain":false,"type":"assistant","message":{"model":"claude-sonnet-5","role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"/repo/a.txt","content":"1"}}]},"uuid":"a2","timestamp":"2026-09-09T08:47:01.281Z"}
{"parentUuid":"a2","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]},"uuid":"u2","timestamp":"2026-09-09T08:47:01.296Z","toolUseResult":{}}
{"parentUuid":"u2","isSidechain":true,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"subagent noise"}]},"uuid":"side","timestamp":"2026-09-09T08:47:02.000Z"}
{"parentUuid":"u2","isSidechain":false,"type":"attachment","attachment":{"type":"x"},"uuid":"att1","timestamp":"2026-09-09T08:47:02.500Z"}
{"parentUuid":"att1","isSidechain":false,"type":"assistant","message":{"model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"done"}]},"uuid":"a3","timestamp":"2026-09-09T08:47:03.000Z"}
{"parentUuid":"a3","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"again"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}}]},"uuid":"u3","timestamp":"2026-09-09T08:48:00.000Z"}
{"parentUuid":"u3","isSidechain":false,"type":"assistant","message":{"model":"claude-sonnet-5","role":"assistant","content":[{"type":"text","text":"partial"}]},"uuid":"a4","timestamp":"2026-09-09T08:48:01.000Z"}
{"parentUuid":"a4","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]},"uuid":"u4","timestamp":"2026-09-09T08:48:02.000Z"}
{"type":"last-prompt","lastPrompt":"again","leafUuid":"u4","sessionId":"s"}
{"type":"ai-title","aiTitle":"Ignored title","sessionId":"s"}
"#;

    #[test]
    fn groups_entries_into_turns_and_skips_sidechains() {
        let session = parse(SAMPLE);
        assert_eq!(session.cwd.as_deref(), Some("/repo"));
        assert_eq!(session.model.as_deref(), Some("claude-sonnet-5"));
        assert_eq!(session.name, None);
        assert_eq!(session.turns.len(), 4);
        assert!(matches!(&session.turns[0], Turn::User { text, at, .. } if text == "do it" && *at == 1788943613857));
        assert!(matches!(&session.turns[1], Turn::Agent { text, files, status: RunStatus::Settled, .. }
            if text == "done" && files == &vec!["/repo/a.txt".to_string()]));
        assert!(matches!(&session.turns[2], Turn::User { text, images, .. } if text == "again" && images.len() == 1));
        assert!(matches!(&session.turns[3], Turn::Agent { text, status: RunStatus::Aborted, .. } if text == "partial"));
    }

    #[test]
    fn parses_timestamps() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00.000Z"), 0);
        assert_eq!(parse_rfc3339_ms("2026-09-09T08:46:53.857Z"), 1788943613857);
        assert_eq!(parse_rfc3339_ms("garbage"), 0);
    }
}
