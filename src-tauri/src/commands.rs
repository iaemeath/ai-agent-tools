use crate::adapters::{adapter_for, ScopeCtx};
use crate::core::{ToolContent, ToolKind, ToolOverview, Scope, Status, ProjectInfo};
use crate::scan;
use anyhow::Result;
use std::path::PathBuf;
use std::time::SystemTime;

#[tauri::command]
pub fn get_overview(project: Option<String>) -> Result<ToolOverview, String> {
    scan::overview(project.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_tool_detail(kind: ToolKind, name: String, project: Option<String>) -> Result<Vec<crate::core::ScopeStatus>, String> {
    let a = adapter_for(kind).ok_or("unsupported kind")?;
    let ctx = ScopeCtx { project };
    let items = a.scan(&crate::adapters::ScanCtx { project: ctx.project.clone() }).map_err(|e| e.to_string())?;
    let it = items.into_iter().find(|i| i.name == name).ok_or("not found")?;
    Ok(it.per_scope)
}

#[tauri::command]
pub fn set_tool_status(kind: ToolKind, name: String, scope: Scope, status: Status, project: Option<String>) -> Result<(), String> {
    let a = adapter_for(kind).ok_or("unsupported kind")?;
    a.set_status(&name, scope, status, &ScopeCtx { project }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn view_tool_content(kind: ToolKind, name: String) -> Result<ToolContent, String> {
    let a = adapter_for(kind).ok_or("unsupported kind")?;
    a.view(&name).map_err(|e| e.to_string())
}

/// Decode a Claude Code projects folder name back into a filesystem path.
///
/// Claude encodes the absolute cwd by replacing every `/` with `-`, so
/// `/home/user/my-project` becomes `-home-user-my-project`. Because `-` is
/// ambiguous (it can be a separator *or* part of a real directory name), we
/// greedily reconstruct the path by walking the real filesystem from `/`,
/// matching the longest possible directory-name prefix at each step.
fn decode_project_folder(name: &str) -> String {
    if name.is_empty() || !name.starts_with('-') {
        return name.to_string();
    }
    let body = &name[1..];
    let tokens: Vec<&str> = body.split('-').collect();

    let mut resolved = PathBuf::from("/");
    let mut i = 0;
    while i < tokens.len() {
        if tokens[i].is_empty() {
            i += 1;
            continue;
        }
        let parent = resolved.clone();
        let mut matched = false;
        let max_take = tokens.len() - i;
        for take in (1..=max_take).rev() {
            let candidate: String = tokens[i..i + take].join("-");
            if parent.join(&candidate).is_dir() {
                resolved = parent.join(&candidate);
                i += take;
                matched = true;
                break;
            }
        }
        if !matched {
            resolved = parent.join(tokens[i]);
            i += 1;
        }
    }
    resolved.to_string_lossy().to_string()
}

/// Return all known project paths (decoded from ~/.claude/projects/ folder names).
/// Used by the skill scanner to discover project-scoped skills across all projects.
pub fn all_project_paths() -> Vec<String> {
    let projects_dir = match crate::core::paths::claude_dir().ok() {
        Some(d) => d.join("projects"),
        None => return Vec::new(),
    };
    let mut paths = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&projects_dir) {
        for entry in rd.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let encoded = entry.file_name().to_string_lossy().to_string();
                let path = decode_project_folder(&encoded);
                if !path.is_empty() && path != encoded {
                    paths.push(path);
                }
            }
        }
    }
    paths
}
/// Scan ~/.claude/projects/ and return one ProjectInfo per directory.
#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    let projects_dir = crate::core::paths::claude_dir()
        .map_err(|e| e.to_string())?
        .join("projects");

    let mut out: Vec<ProjectInfo> = Vec::new();

    let read_dir = match std::fs::read_dir(&projects_dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(out),
    };

    for entry in read_dir.flatten() {
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !ft.is_dir() {
            continue;
        }
        let encoded = entry.file_name().to_string_lossy().to_string();
        let dir = entry.path();
        let path = decode_project_folder(&encoded);

        let mut session_count: u64 = 0;
        let mut newest: Option<SystemTime> = None;
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for f in rd.flatten() {
                if f.file_name().to_string_lossy().ends_with(".jsonl") {
                    session_count += 1;
                    if let Ok(meta) = f.metadata() {
                        if let Ok(mt) = meta.modified() {
                            newest = Some(match newest {
                                Some(prev) if prev >= mt => prev,
                                _ => mt,
                            });
                        }
                    }
                }
            }
        }

        let last_activity = newest.and_then(|t| {
            let dur = t.duration_since(std::time::UNIX_EPOCH).ok()?;
            Some(format_iso(dur.as_secs(), dur.subsec_nanos()))
        });

        let has_settings = PathBuf::from(&path).join(".claude").join("settings.json").exists();

        out.push(ProjectInfo {
            path,
            encoded,
            session_count,
            last_activity,
            has_settings,
        });
    }

    out.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));
    Ok(out)
}

/// Delete a project's Claude Code session history (~/.claude/projects/{encoded}).
/// Only removes the session folder — never touches the real project directory.
#[tauri::command]
pub fn delete_project(encoded: String) -> Result<(), String> {
    // `encoded` must be a bare folder name: no separators, traversal, or nulls.
    if encoded.is_empty()
        || encoded.contains('/')
        || encoded.contains('\\')
        || encoded.contains("..")
        || encoded.contains('\0')
    {
        return Err("invalid project id".into());
    }
    let projects_dir = crate::core::paths::claude_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    let target = projects_dir.join(&encoded);
    // Canonicalize both and verify containment to defeat any symlink tricks.
    let canonical_target = target.canonicalize().map_err(|e| e.to_string())?;
    let canonical_base = projects_dir.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_base) {
        return Err("invalid project id".into());
    }
    std::fs::remove_dir_all(&canonical_target).map_err(|e| e.to_string())
}

/// Promote a project-level skill to global (user) scope.
///
/// Copies `{project}/.claude/skills/{name}/` → `~/.claude/skills/{name}/`.
/// Refuses to overwrite if a global skill with the same name already exists.
#[tauri::command]
pub fn promote_skill(name: String, project: String) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") || name.contains('\0') {
        return Err("invalid skill name".into());
    }
    let src = crate::core::paths::project_skills_dir(&project)
        .map_err(|e| e.to_string())?
        .join(&name);
    let dst = crate::core::paths::global_skills_dir()
        .map_err(|e| e.to_string())?
        .join(&name);

    if !src.is_dir() {
        return Err("project skill not found".into());
    }
    if dst.exists() {
        return Err("a global skill with this name already exists".into());
    }

    // Canonicalize project to verify it's a real directory.
    let proj_canonical = std::path::PathBuf::from(&project).canonicalize().map_err(|e| e.to_string())?;
    let src_canonical = src.canonicalize().map_err(|e| e.to_string())?;
    if !src_canonical.starts_with(&proj_canonical) {
        return Err("skill path must be inside the project".into());
    }

    copy_dir_recursive(&src_canonical, &dst)?;
    // Remove the project-level original now that it lives globally.
    std::fs::remove_dir_all(&src_canonical).map_err(|e| e.to_string())?;
    Ok(())
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
/// Format a Unix timestamp (secs + nanos) as an ISO-8601 UTC string.
fn format_iso(secs: u64, nanos: u32) -> String {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, d, h, m, s, nanos / 1_000_000
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_simple_paths() {
        assert_eq!(decode_project_folder("/home/iaemeath/code"), "/home/iaemeath/code");
        assert_eq!(decode_project_folder(""), "");
        assert_eq!(decode_project_folder("foo"), "foo");
    }
}




