//! Working-tree change tracking. A run's touched files are the difference between two
//! snapshots taken before and after it. Both count changes since the *pre-run* HEAD, so work
//! that pi commits during the run is still attributed to it.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::store::TouchedFile;

/// Added/removed line counts per path, untracked files included.
pub type Counts = BTreeMap<String, (u32, u32)>;

#[derive(Debug, Clone)]
pub struct Snapshot {
    /// HEAD commit at snapshot time, or None for an unborn branch.
    pub head: Option<String>,
    pub files: Counts,
}

pub fn snapshot(repo: &Path) -> Option<Snapshot> {
    let head = git(repo, &["rev-parse", "--verify", "-q", "HEAD"]).map(|s| s.trim().to_string());
    let files = counts_since(repo, head.as_deref())?;
    Some(Snapshot { head, files })
}

/// Line counts of the working tree relative to `base` (or to an empty tree when None).
pub fn counts_since(repo: &Path, base: Option<&str>) -> Option<Counts> {
    let mut counts = Counts::new();
    if let Some(base) = base {
        let numstat = git(repo, &["diff", "--numstat", base, "--"])?;
        for line in numstat.lines() {
            let mut parts = line.splitn(3, '\t');
            let (Some(plus), Some(minus), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
                continue;
            };
            // Binary files report "-" for both counts.
            counts.insert(path.to_string(), (plus.parse().unwrap_or(0), minus.parse().unwrap_or(0)));
        }
    } else {
        // No commit yet: every tracked file counts as added.
        for path in git(repo, &["ls-files"])?.lines().filter(|l| !l.is_empty()) {
            counts.insert(path.to_string(), (line_count(repo, path), 0));
        }
    }
    let untracked = git(repo, &["ls-files", "--others", "--exclude-standard"])?;
    for path in untracked.lines().filter(|l| !l.is_empty()) {
        counts.insert(path.to_string(), (line_count(repo, path), 0));
    }
    Some(counts)
}

/// Files whose change counts moved between the two snapshots.
pub fn touched(before: &Counts, after: &Counts) -> Vec<TouchedFile> {
    after
        .iter()
        .filter_map(|(path, &(plus, minus))| {
            let (base_plus, base_minus) = before.get(path).copied().unwrap_or((0, 0));
            if (plus, minus) == (base_plus, base_minus) {
                return None;
            }
            Some(TouchedFile {
                path: path.clone(),
                plus: plus.saturating_sub(base_plus),
                minus: minus.saturating_sub(base_minus),
            })
        })
        .collect()
}

#[derive(Debug, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub plus: u32,
    pub minus: u32,
    pub patch: String,
}

/// Unified diff of each file from `base` to the working tree. Files unknown to `base` are
/// shown as full additions.
pub fn diffs(repo: &Path, base: Option<&str>, files: &[TouchedFile]) -> Vec<FileDiff> {
    files
        .iter()
        .map(|file| {
            let in_base = base
                .map(|b| git(repo, &["cat-file", "-e", &format!("{b}:{}", file.path)]).is_some())
                .unwrap_or(false);
            let patch = if in_base {
                git(repo, &["diff", base.unwrap_or("HEAD"), "--", &file.path]).unwrap_or_default()
            } else {
                // `git diff --no-index` exits 1 when files differ, so read output regardless.
                Command::new("git")
                    .args(["diff", "--no-index", "--", "/dev/null", &file.path])
                    .current_dir(repo)
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
                    .unwrap_or_default()
            };
            FileDiff { path: file.path.clone(), plus: file.plus, minus: file.minus, patch }
        })
        .collect()
}

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Current text of a working-tree file, for expanding diff context. Rejects binaries and
/// files over 2 MiB; None when the file no longer exists.
pub fn read_text(repo: &Path, path: &str) -> Result<Option<String>, String> {
    let full = repo.join(path);
    let Ok(meta) = std::fs::metadata(&full) else { return Ok(None) };
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err("file is larger than 2 MiB".into());
    }
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return Err("binary file".into());
    }
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

fn line_count(repo: &Path, path: &str) -> u32 {
    std::fs::read_to_string(repo.join(path)).map(|s| s.lines().count() as u32).unwrap_or(0)
}

fn git(repo: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).current_dir(repo).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn touched_reports_only_moved_counts() {
        let before = Counts::from([("a".to_string(), (2, 1)), ("b".to_string(), (5, 0))]);
        let after = Counts::from([
            ("a".to_string(), (2, 1)),
            ("b".to_string(), (7, 3)),
            ("c".to_string(), (4, 0)),
        ]);
        let touched = touched(&before, &after);
        assert_eq!(
            touched,
            vec![
                TouchedFile { path: "b".into(), plus: 2, minus: 3 },
                TouchedFile { path: "c".into(), plus: 4, minus: 0 },
            ]
        );
    }

    #[test]
    fn counts_include_commits_made_after_base() {
        let dir = std::env::temp_dir().join(format!("sovereign-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| {
            let status = Command::new("git")
                .args(["-c", "user.email=t@t", "-c", "user.name=t"])
                .args(args)
                .current_dir(&dir)
                .status()
                .unwrap();
            assert!(status.success(), "git {args:?}");
        };
        run(&["init", "-q"]);
        std::fs::write(dir.join("a.txt"), "1\n").unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-q", "-m", "init"]);
        let before = snapshot(&dir).unwrap();

        std::fs::write(dir.join("a.txt"), "1\n2\n").unwrap();
        run(&["commit", "-q", "-am", "agent commit"]);
        std::fs::write(dir.join("new.txt"), "x\ny\n").unwrap();

        let after = counts_since(&dir, before.head.as_deref()).unwrap();
        let touched = touched(&before.files, &after);
        assert_eq!(
            touched,
            vec![
                TouchedFile { path: "a.txt".into(), plus: 1, minus: 0 },
                TouchedFile { path: "new.txt".into(), plus: 2, minus: 0 },
            ]
        );
        let diffs = diffs(&dir, before.head.as_deref(), &touched);
        assert!(diffs[0].patch.contains("+2"));
        assert!(diffs[1].patch.contains("+y"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
