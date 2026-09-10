//! Reader for pi session files (JSONL, format v3).
//!
//! Entries form a tree linked by `id`/`parentId`. pi appends the active leaf last, so the
//! active branch is recovered by walking parents up from the final entry.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;

pub use crate::agent::{RunStatus, Session, Turn};

#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "type")]
    kind: String,
    id: Option<String>,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
    #[serde(flatten)]
    rest: Value,
}

pub fn read(path: &Path) -> Result<Session> {
    let raw = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    parse(&raw)
}

pub fn parse(raw: &str) -> Result<Session> {
    let mut session = Session::default();
    let mut by_id: HashMap<String, Entry> = HashMap::new();
    let mut last_id: Option<String> = None;

    for line in raw.split('\n') {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let entry: Entry = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(err) => {
                tracing::debug!("skipping unparsable session line: {err}");
                continue;
            }
        };
        if entry.kind == "session" {
            session.cwd = entry.rest.get("cwd").and_then(Value::as_str).map(String::from);
            continue;
        }
        if let Some(id) = &entry.id {
            last_id = Some(id.clone());
            by_id.insert(id.clone(), entry);
        }
    }

    let mut branch = Vec::new();
    let mut cursor = last_id;
    while let Some(id) = cursor {
        match by_id.remove(&id) {
            Some(entry) => {
                cursor = entry.parent_id.clone();
                branch.push(entry);
            }
            None => break,
        }
    }
    branch.reverse();

    let mut agent: Option<AgentAcc> = None;
    for entry in &branch {
        match entry.kind.as_str() {
            "session_info" => {
                session.name = entry.rest.get("name").and_then(Value::as_str).map(String::from);
            }
            "model_change" => {
                session.model = entry.rest.get("modelId").and_then(Value::as_str).map(String::from);
            }
            "message" => {
                let Some(message) = entry.rest.get("message") else { continue };
                let role = message.get("role").and_then(Value::as_str).unwrap_or_default();
                let at = message.get("timestamp").and_then(Value::as_u64).unwrap_or(0);
                match role {
                    "user" => {
                        if let Some(acc) = agent.take() {
                            session.turns.push(acc.finish());
                        }
                        let images = message.get("content").and_then(Value::as_array)
                            .map(|blocks| blocks.iter()
                                .filter(|b| b.get("type").and_then(Value::as_str) == Some("image"))
                                .filter_map(|b| serde_json::from_value(b.clone()).ok())
                                .collect()).unwrap_or_default();
                        session.turns.push(Turn::User { text: content_text(message.get("content")), at, images });
                    }
                    "assistant" => {
                        let acc = agent.get_or_insert_with(|| AgentAcc::new(at));
                        acc.at = at;
                        acc.push_assistant(message);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    if let Some(acc) = agent.take() {
        session.turns.push(acc.finish());
    }
    Ok(session)
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

    fn push_assistant(&mut self, message: &Value) {
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
                Some("toolCall") => {
                    let name = block.get("name").and_then(Value::as_str).unwrap_or_default();
                    if let Some(path) = touched_path(name, block.get("arguments")) {
                        if !self.files.contains(&path) {
                            self.files.push(path);
                        }
                    }
                }
                _ => {}
            }
        }
        self.status = match message.get("stopReason").and_then(Value::as_str) {
            Some("error") => RunStatus::Error,
            Some("aborted") => RunStatus::Aborted,
            _ => RunStatus::Settled,
        };
    }

    fn finish(self) -> Turn {
        Turn::Agent { text: self.text, files: self.files, at: self.at, status: self.status }
    }
}

/// Path written by a file-mutating tool call, if any.
pub fn touched_path(tool_name: &str, arguments: Option<&Value>) -> Option<String> {
    if !matches!(tool_name, "write" | "edit") {
        return None;
    }
    arguments?.get("path")?.as_str().map(String::from)
}

/// User content is either a plain string or an array of text/image blocks.
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

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"type":"session","version":3,"id":"s1","timestamp":"t","cwd":"/repo"}
{"type":"session_info","id":"a","parentId":null,"timestamp":"t","name":"rpc test"}
{"type":"model_change","id":"b","parentId":"a","timestamp":"t","provider":"p","modelId":"m1"}
{"type":"message","id":"c","parentId":"b","timestamp":"t","message":{"role":"user","content":[{"type":"text","text":"do it"}],"timestamp":1}}
{"type":"message","id":"d","parentId":"c","timestamp":"t","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hm"},{"type":"toolCall","id":"x","name":"write","arguments":{"path":"a.txt","content":"1"}}],"stopReason":"toolUse","timestamp":2}}
{"type":"message","id":"e","parentId":"d","timestamp":"t","message":{"role":"toolResult","toolCallId":"x","toolName":"write","content":[{"type":"text","text":"ok"}],"isError":false,"timestamp":3}}
{"type":"message","id":"f","parentId":"e","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"stop","timestamp":4}}
{"type":"message","id":"g","parentId":"f","timestamp":"t","message":{"role":"user","content":"again","timestamp":5}}
{"type":"message","id":"h","parentId":"g","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"nope"}],"stopReason":"aborted","timestamp":6}}
"#;

    #[test]
    fn groups_messages_into_turns() {
        let session = parse(SAMPLE).unwrap();
        assert_eq!(session.cwd.as_deref(), Some("/repo"));
        assert_eq!(session.name.as_deref(), Some("rpc test"));
        assert_eq!(session.model.as_deref(), Some("m1"));
        assert_eq!(
            session.turns,
            vec![
                Turn::User { text: "do it".into(), at: 1, images: vec![] },
                Turn::Agent {
                    text: "done".into(),
                    files: vec!["a.txt".into()],
                    at: 4,
                    status: RunStatus::Settled
                },
                Turn::User { text: "again".into(), at: 5, images: vec![] },
                Turn::Agent { text: "nope".into(), files: vec![], at: 6, status: RunStatus::Aborted },
            ]
        );
    }

    #[test]
    fn preserves_user_images_in_history() {
        let raw = r#"{"type":"message","id":"a","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"Check this"},{"type":"image","mimeType":"image/png","data":"YQ=="}],"timestamp":1}}"#;
        let session = parse(raw).unwrap();
        assert_eq!(session.turns, vec![Turn::User {
            text: "Check this".into(), at: 1,
            images: vec![super::super::image::ImageContent { data: "YQ==".into(), mime_type: "image/png".into() }],
        }]);
        let image_only = raw.replace("{\"type\":\"text\",\"text\":\"Check this\"},", "");
        assert!(matches!(&parse(&image_only).unwrap().turns[0], Turn::User { text, images, .. } if text.is_empty() && images.len() == 1));
    }

    #[test]
    fn follows_the_active_branch_only() {
        // A second child of "c" appended last becomes the leaf; "d".."h" are an abandoned branch.
        let raw = format!(
            "{SAMPLE}{}\n",
            r#"{"type":"message","id":"z","parentId":"c","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"alt"}],"stopReason":"stop","timestamp":9}}"#
        );
        let session = parse(&raw).unwrap();
        assert_eq!(session.turns.len(), 2);
        assert!(matches!(&session.turns[1], Turn::Agent { text, .. } if text == "alt"));
    }
}
