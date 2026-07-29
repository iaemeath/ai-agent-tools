use crate::paths;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

/// A Claude Code slash command — a flat `~/.claude/commands/<name>.md` file
/// (markdown, optional YAML frontmatter like `description`/`argument-hint`).
#[derive(Serialize)]
pub struct CommandInfo {
    pub name: String,
    pub path: String,
    pub scope: String,
    pub content: String, // raw file content including any frontmatter
}

fn commands_dir_for_scope(scope: &str, project_path: Option<&str>) -> Result<PathBuf, String> {
    match scope {
        "global" => Ok(paths::global_commands_dir()),
        "project" => {
            let pp = project_path.ok_or("project_path required")?;
            Ok(PathBuf::from(pp).join(".claude").join("commands"))
        }
        _ => Err(format!("invalid scope: {scope}")),
    }
}

#[tauri::command]
pub fn list_commands(scope: String, project_path: Option<String>) -> Result<Vec<CommandInfo>, String> {
    let dir = commands_dir_for_scope(&scope, project_path.as_deref())?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut items = Vec::new();

    fn walk(dir: &PathBuf, scope: &str, items: &mut Vec<CommandInfo>) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|e| format!("failed to read dir: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("failed to read entry: {e}"))?;
            let path = entry.path();
            if path.is_dir() {
                walk(&path, scope, items)?;
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let content = fs::read_to_string(&path).unwrap_or_default();
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                items.push(CommandInfo {
                    name,
                    path: path.to_string_lossy().to_string(),
                    scope: scope.to_string(),
                    content,
                });
            }
        }
        Ok(())
    }

    walk(&dir, &scope, &mut items)?;
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

#[tauri::command]
pub fn write_command(
    scope: String,
    project_path: Option<String>,
    name: String,
    content: String,
) -> Result<(), String> {
    let dir = commands_dir_for_scope(&scope, project_path.as_deref())?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create commands dir: {e}"))?;
    let path = dir.join(format!("{}.md", paths::sanitize_component(&name)?));
    fs::write(&path, content).map_err(|e| format!("failed to write command: {e}"))
}

#[tauri::command]
pub fn delete_command(
    scope: String,
    project_path: Option<String>,
    name: String,
) -> Result<(), String> {
    let dir = commands_dir_for_scope(&scope, project_path.as_deref())?;
    let path = dir.join(format!("{}.md", paths::sanitize_component(&name)?));
    match fs::symlink_metadata(&path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() || meta.is_file() {
                fs::remove_file(&path).map_err(|e| format!("failed to delete: {e}"))
            } else {
                fs::remove_dir_all(&path).map_err(|e| format!("failed to delete: {e}"))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("failed to stat: {e}")),
    }
}
