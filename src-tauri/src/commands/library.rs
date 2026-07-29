use crate::commands::{mcp, settings};
use crate::paths;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// One entry in the canonical library (`~/.claude/library/<kind>/`).
/// - skills/agents: `path` is the item dir (marker file inside).
/// - rules/commands: `path` is the `.md` file; `content` is body (rules) or raw (commands).
/// - mcp/hooks: `path` is the `.json` file; `content` is the raw JSON text.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub content: String,
    pub paths_filter: Vec<String>,
}

/// A layer a library item is deployed into.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub scope: String,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
}

fn check_kind(kind: &str) -> Result<(), String> {
    if matches!(
        kind,
        "skills" | "agents" | "rules" | "commands" | "mcp" | "hooks"
    ) {
        Ok(())
    } else {
        Err(format!("invalid library kind: {kind}"))
    }
}

fn is_dir_kind(kind: &str) -> bool {
    matches!(kind, "skills" | "agents")
}

fn is_json_kind(kind: &str) -> bool {
    matches!(kind, "mcp" | "hooks")
}

fn marker_for_kind(kind: &str) -> &'static str {
    match kind {
        "skills" => "SKILL.md",
        "agents" => "AGENT.md",
        _ => "",
    }
}

/// How a kind reaches a CC config layer.
fn deploy_mechanism(kind: &str) -> &'static str {
    match kind {
        "mcp" | "hooks" => "copy",
        _ => "symlink",
    }
}

/// Canonical path of the library item for `kind`/`name`.
fn library_item_path(kind: &str, name: &str) -> Result<PathBuf, String> {
    let dir = paths::library_kind_dir(kind)?;
    let safe = paths::sanitize_component(name)?;
    Ok(if is_dir_kind(kind) {
        dir.join(safe)
    } else if is_json_kind(kind) {
        dir.join(format!("{safe}.json"))
    } else {
        // rules / commands: flat markdown
        dir.join(format!("{safe}.md"))
    })
}

/// Filename of the deployed symlink for a symlink-kind inside a target layer dir.
fn entry_name(kind: &str, name: &str) -> Result<String, String> {
    let safe = paths::sanitize_component(name)?.to_string();
    Ok(if is_dir_kind(kind) {
        safe
    } else {
        format!("{safe}.md")
    })
}

/// Resolve the target `<kind>` directory for a symlink deploy scope.
fn target_kind_dir(kind: &str, scope: &str, project_path: Option<&str>) -> Result<PathBuf, String> {
    match (kind, scope) {
        ("skills", "global") => Ok(paths::global_skills_dir()),
        ("agents", "global") => Ok(paths::global_agents_dir()),
        ("rules", "global") => Ok(paths::global_rules_dir()),
        ("commands", "global") => Ok(paths::global_commands_dir()),
        (_, "project") => {
            let pp = project_path.ok_or("project_path required for project scope")?;
            Ok(PathBuf::from(pp).join(".claude").join(kind))
        }
        _ => Err(format!("invalid kind/scope: {kind}/{scope}")),
    }
}

#[cfg(unix)]
fn make_symlink(target: &Path, link: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, link)
        .map_err(|e| format!("failed to link {} -> {}: {e}", link.display(), target.display()))
}

#[cfg(not(unix))]
fn make_symlink(_target: &Path, _link: &Path) -> Result<(), String> {
    Err("symlink deploy is only implemented for Unix (Linux/macOS)".to_string())
}

fn read_json_value(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("failed to parse JSON {}: {e}", path.display()))
}

fn require_valid_scope(scope: &str) -> Result<(), String> {
    if matches!(scope, "global" | "project") {
        Ok(())
    } else {
        Err(format!("invalid scope: {scope}"))
    }
}

#[tauri::command]
pub fn list_library(kind: String) -> Result<Vec<LibraryItem>, String> {
    check_kind(&kind)?;
    let dir = paths::library_kind_dir(&kind)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut items = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("failed to read library dir: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read entry: {e}"))?;
        if is_dir_kind(&kind) {
            if entry.file_type().is_ok_and(|ft| ft.is_dir()) {
                let name = entry.file_name().to_string_lossy().to_string();
                let marker_path = entry.path().join(marker_for_kind(&kind));
                let content = fs::read_to_string(&marker_path).unwrap_or_default();
                items.push(LibraryItem {
                    kind: kind.clone(),
                    name,
                    path: entry.path().to_string_lossy().to_string(),
                    content,
                    paths_filter: vec![],
                });
            }
        } else if is_json_kind(&kind) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json")
                && entry.file_type().is_ok_and(|ft| ft.is_file())
            {
                let content = fs::read_to_string(&path).unwrap_or_default();
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                items.push(LibraryItem {
                    kind: kind.clone(),
                    name,
                    path: path.to_string_lossy().to_string(),
                    content,
                    paths_filter: vec![],
                });
            }
        } else {
            // rules / commands: flat *.md
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md")
                && entry.file_type().is_ok_and(|ft| ft.is_file())
            {
                let raw = fs::read_to_string(&path).unwrap_or_default();
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if kind == "rules" {
                    let (paths_filter, body) = crate::commands::rules::parse_rule_frontmatter(&raw);
                    items.push(LibraryItem {
                        kind: kind.clone(),
                        name,
                        path: path.to_string_lossy().to_string(),
                        content: body,
                        paths_filter,
                    });
                } else {
                    // commands: raw content (incl. frontmatter)
                    items.push(LibraryItem {
                        kind: kind.clone(),
                        name,
                        path: path.to_string_lossy().to_string(),
                        content: raw,
                        paths_filter: vec![],
                    });
                }
            }
        }
    }

    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

#[tauri::command]
pub fn write_library_item(
    kind: String,
    name: String,
    content: String,
    paths_filter: Option<Vec<String>>,
) -> Result<(), String> {
    check_kind(&kind)?;
    let dir = paths::library_kind_dir(&kind)?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create library dir: {e}"))?;
    let safe = paths::sanitize_component(&name)?;

    if is_dir_kind(&kind) {
        let item_dir = dir.join(safe);
        fs::create_dir_all(&item_dir)
            .map_err(|e| format!("failed to create item dir: {e}"))?;
        fs::write(item_dir.join(marker_for_kind(&kind)), content)
            .map_err(|e| format!("failed to write item: {e}"))
    } else if is_json_kind(&kind) {
        fs::write(dir.join(format!("{safe}.json")), content)
            .map_err(|e| format!("failed to write item: {e}"))
    } else if kind == "rules" {
        let mut output = String::new();
        if let Some(pf) = &paths_filter {
            if !pf.is_empty() {
                output.push_str("---\npaths:\n");
                for p in pf {
                    output.push_str(&format!("  - \"{p}\"\n"));
                }
                output.push_str("---\n\n");
            }
        }
        output.push_str(&content);
        fs::write(dir.join(format!("{safe}.md")), output)
            .map_err(|e| format!("failed to write rule: {e}"))
    } else {
        // commands: raw markdown
        fs::write(dir.join(format!("{safe}.md")), content)
            .map_err(|e| format!("failed to write command: {e}"))
    }
}

#[tauri::command]
pub fn delete_library_item(kind: String, name: String) -> Result<(), String> {
    check_kind(&kind)?;
    let path = library_item_path(&kind, &name)?;
    match fs::symlink_metadata(&path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() || meta.is_file() {
                fs::remove_file(&path).map_err(|e| format!("failed to delete: {e}"))
            } else {
                fs::remove_dir_all(&path).map_err(|e| format!("failed to delete: {e}"))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("failed to stat {}: {e}", path.display())),
    }
}

// ── Deploy ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn deploy_library_item(
    kind: String,
    name: String,
    scope: String,
    project_path: Option<String>,
) -> Result<(), String> {
    check_kind(&kind)?;
    require_valid_scope(&scope)?;
    let source = library_item_path(&kind, &name)?;
    if !source.exists() {
        return Err(format!("library item not found: {}", source.display()));
    }
    match deploy_mechanism(&kind) {
        "symlink" => deploy_via_symlink(&kind, &name, &scope, project_path.as_deref()),
        "copy" => match kind.as_str() {
            "mcp" => mcp_deploy(&name, &scope, project_path.as_deref()),
            "hooks" => hooks_deploy(&name, &scope, project_path.as_deref()),
            _ => unreachable!(),
        },
        _ => unreachable!(),
    }
}

#[tauri::command]
pub fn undeploy_library_item(
    kind: String,
    name: String,
    scope: String,
    project_path: Option<String>,
) -> Result<(), String> {
    check_kind(&kind)?;
    require_valid_scope(&scope)?;
    match deploy_mechanism(&kind) {
        "symlink" => undeploy_via_symlink(&kind, &name, &scope, project_path.as_deref()),
        "copy" => match kind.as_str() {
            "mcp" => mcp_undeploy(&name, &scope, project_path.as_deref()),
            "hooks" => hooks_undeploy(&name, &scope, project_path.as_deref()),
            _ => unreachable!(),
        },
        _ => unreachable!(),
    }
}

#[tauri::command]
pub fn list_deployments(kind: String, name: String) -> Result<Vec<Deployment>, String> {
    check_kind(&kind)?;
    match deploy_mechanism(&kind) {
        "symlink" => list_symlink_deployments(&kind, &name),
        "copy" => match kind.as_str() {
            "mcp" => list_mcp_deployments(&name),
            "hooks" => list_hooks_deployments(&name),
            _ => unreachable!(),
        },
        _ => unreachable!(),
    }
}

// ── Symlink mechanism (skills/agents/rules/commands) ─────────────────────────

fn deploy_via_symlink(
    kind: &str,
    name: &str,
    scope: &str,
    project_path: Option<&str>,
) -> Result<(), String> {
    let source = library_item_path(kind, name)?;
    let target_dir = target_kind_dir(kind, scope, project_path)?;
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("failed to create target dir: {e}"))?;
    let link = target_dir.join(entry_name(kind, name)?);

    if let Ok(meta) = fs::symlink_metadata(&link) {
        if meta.file_type().is_symlink() {
            let existing = fs::read_link(&link).unwrap_or_default();
            let same = existing == source
                || fs::canonicalize(&existing).ok() == fs::canonicalize(&source).ok();
            if same {
                return Ok(());
            }
            return Err(format!(
                "target already linked to a different source: {} -> {}",
                link.display(),
                existing.display()
            ));
        }
        return Err(format!(
            "target already exists (not a symlink): {}",
            link.display()
        ));
    }
    make_symlink(&source, &link)
}

fn undeploy_via_symlink(
    kind: &str,
    name: &str,
    scope: &str,
    project_path: Option<&str>,
) -> Result<(), String> {
    let target_dir = target_kind_dir(kind, scope, project_path)?;
    let link = target_dir.join(entry_name(kind, name)?);
    match fs::symlink_metadata(&link) {
        Ok(meta) if meta.file_type().is_symlink() => {
            fs::remove_file(&link).map_err(|e| format!("failed to remove link: {e}"))
        }
        Ok(_) => Err(format!(
            "target is not a symlink — refusing to delete a real entry: {}",
            link.display()
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("failed to stat {}: {e}", link.display())),
    }
}

fn list_symlink_deployments(kind: &str, name: &str) -> Result<Vec<Deployment>, String> {
    let source = library_item_path(kind, name)?;
    let source_canon = fs::canonicalize(&source).ok();
    let entry = entry_name(kind, name)?;
    let mut deployments = Vec::new();

    let gdir = target_kind_dir(kind, "global", None)?;
    push_if_linked(&gdir, &entry, &source, &source_canon, &mut deployments, "global", None, None);

    for p in crate::commands::projects::list_all_projects()? {
        let pdir = PathBuf::from(&p.path).join(".claude").join(kind);
        push_if_linked(
            &pdir, &entry, &source, &source_canon, &mut deployments,
            "project", Some(&p.path), Some(&p.name),
        );
    }
    Ok(deployments)
}

fn push_if_linked(
    dir: &Path,
    entry: &str,
    source: &Path,
    source_canon: &Option<PathBuf>,
    out: &mut Vec<Deployment>,
    scope: &str,
    project_path: Option<&str>,
    project_name: Option<&str>,
) {
    if !dir.exists() {
        return;
    }
    let link = dir.join(entry);
    let Ok(meta) = fs::symlink_metadata(&link) else {
        return;
    };
    if !meta.file_type().is_symlink() {
        return;
    }
    let target = fs::read_link(&link).unwrap_or_default();
    let target_canon = fs::canonicalize(&target).ok();
    let matches = target == *source
        || source_canon.as_deref() == target_canon.as_deref()
        || target_canon.as_deref() == Some(source);
    if matches {
        out.push(Deployment {
            scope: scope.to_string(),
            project_path: project_path.map(|s| s.to_string()),
            project_name: project_name.map(|s| s.to_string()),
        });
    }
}

// ── Copy mechanism: MCP (reuses mcp::upsert/delete) ──────────────────────────

fn mcp_deploy(name: &str, scope: &str, project_path: Option<&str>) -> Result<(), String> {
    let config = read_json_value(&library_item_path("mcp", name)?)?;
    match scope {
        "global" => mcp::upsert_mcp_server("global".to_string(), None, name.to_string(), config),
        "project" => {
            let pp = project_path.ok_or("project_path required for project scope")?;
            mcp::upsert_mcp_server(
                "mcp-local".to_string(),
                Some(pp.to_string()),
                name.to_string(),
                config,
            )
        }
        _ => Err(format!("invalid scope: {scope}")),
    }
}

fn mcp_undeploy(name: &str, scope: &str, project_path: Option<&str>) -> Result<(), String> {
    match scope {
        "global" => mcp::delete_mcp_server("global".to_string(), None, name.to_string()),
        "project" => {
            let pp = project_path.ok_or("project_path required for project scope")?;
            mcp::delete_mcp_server(
                "mcp-local".to_string(),
                Some(pp.to_string()),
                name.to_string(),
            )
        }
        _ => Err(format!("invalid scope: {scope}")),
    }
}

fn list_mcp_deployments(name: &str) -> Result<Vec<Deployment>, String> {
    let mut out = Vec::new();
    if let Ok(servers) = mcp::list_mcp_servers("global".to_string(), None) {
        if servers.as_object().is_some_and(|o| o.contains_key(name)) {
            out.push(Deployment {
                scope: "global".into(),
                project_path: None,
                project_name: None,
            });
        }
    }
    for p in crate::commands::projects::list_all_projects()? {
        if let Ok(servers) =
            mcp::list_mcp_servers("mcp-local".to_string(), Some(p.path.clone()))
        {
            if servers.as_object().is_some_and(|o| o.contains_key(name)) {
                out.push(Deployment {
                    scope: "project".into(),
                    project_path: Some(p.path.clone()),
                    project_name: Some(p.name.clone()),
                });
            }
        }
    }
    Ok(out)
}

// ── Copy mechanism: hooks (merge into settings.json hooks) ───────────────────

/// Read the library hook definition: `{ "event": "...", "config": {...} }`.
fn read_hook_def(name: &str) -> Result<(String, Value), String> {
    let lib = read_json_value(&library_item_path("hooks", name)?)?;
    let event = lib
        .get("event")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "hook library item missing string 'event'".to_string())?
        .to_string();
    let config = lib
        .get("config")
        .cloned()
        .ok_or_else(|| "hook library item missing 'config'".to_string())?;
    Ok((event, config))
}

fn settings_scope_for(scope: &str, project_path: Option<&str>) -> Result<(String, Option<String>), String> {
    match scope {
        "global" => Ok(("global".to_string(), None)),
        "project" => {
            let pp = project_path.ok_or("project_path required for project scope")?;
            Ok(("project".to_string(), Some(pp.to_string())))
        }
        _ => Err(format!("invalid scope: {scope}")),
    }
}

fn hooks_deploy(name: &str, scope: &str, project_path: Option<&str>) -> Result<(), String> {
    let (event, config) = read_hook_def(name)?;
    let (settings_scope, pp) = settings_scope_for(scope, project_path)?;

    let mut s = settings::read_settings(settings_scope.clone(), pp.clone())?;
    {
        let obj = s.as_object_mut().ok_or("settings is not an object")?;
        let hooks = obj
            .entry("hooks".to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        let hooks_obj = hooks
            .as_object_mut()
            .ok_or("settings 'hooks' is not an object")?;
        let arr = hooks_obj
            .entry(event)
            .or_insert_with(|| Value::Array(vec![]));
        let arr_obj = arr.as_array_mut().ok_or("hooks[event] is not an array")?;
        if !arr_obj.iter().any(|c| c == &config) {
            arr_obj.push(config);
        }
    }
    settings::write_settings(settings_scope, pp, s)
}

fn hooks_undeploy(name: &str, scope: &str, project_path: Option<&str>) -> Result<(), String> {
    let (event, config) = read_hook_def(name)?;
    let (settings_scope, pp) = settings_scope_for(scope, project_path)?;

    let mut s = settings::read_settings(settings_scope.clone(), pp.clone())?;
    let mut remove_hooks = false;
    {
        if let Some(hooks) = s.as_object_mut().and_then(|o| o.get_mut("hooks")) {
            if let Some(hooks_obj) = hooks.as_object_mut() {
                if let Some(arr) = hooks_obj.get_mut(&event).and_then(|v| v.as_array_mut()) {
                    arr.retain(|c| c != &config);
                    if arr.is_empty() {
                        hooks_obj.remove(&event);
                    }
                }
                if hooks_obj.is_empty() {
                    remove_hooks = true;
                }
            }
        }
    }
    if remove_hooks {
        if let Some(obj) = s.as_object_mut() {
            obj.remove("hooks");
        }
    }
    settings::write_settings(settings_scope, pp, s)
}

fn list_hooks_deployments(name: &str) -> Result<Vec<Deployment>, String> {
    let def = read_hook_def(name);
    let mut out = Vec::new();
    let check = |s: &Value| -> bool {
        match &def {
            Ok((event, config)) => s
                .get("hooks")
                .and_then(|h| h.get(event))
                .and_then(|a| a.as_array())
                .is_some_and(|arr| arr.iter().any(|c| c == config)),
            Err(_) => false,
        }
    };

    if let Ok(s) = settings::read_settings("global".to_string(), None) {
        if check(&s) {
            out.push(Deployment {
                scope: "global".into(),
                project_path: None,
                project_name: None,
            });
        }
    }
    for p in crate::commands::projects::list_all_projects()? {
        if let Ok(s) = settings::read_settings("project".to_string(), Some(p.path.clone())) {
            if check(&s) {
                out.push(Deployment {
                    scope: "project".into(),
                    project_path: Some(p.path.clone()),
                    project_name: Some(p.name.clone()),
                });
            }
        }
    }
    Ok(out)
}
