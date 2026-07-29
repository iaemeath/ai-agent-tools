use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize)]
pub struct ProjectInfo {
    pub hash: String,
    pub path: String,
    pub has_memory: bool,
    pub exists: bool,
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    let projects_dir = paths::projects_dir();

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();

    let entries = std::fs::read_dir(&projects_dir)
        .map_err(|e| format!("failed to read projects dir: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read entry: {e}"))?;
        let file_name = entry.file_name().to_string_lossy().to_string();

        if entry.file_type().is_ok_and(|ft| ft.is_dir()) {
            let resolved_path = paths::project_hash_to_path(&file_name);
            let memory_dir = paths::memory_dir(&file_name);
            let exists = std::path::Path::new(&resolved_path).is_dir();

            projects.push(ProjectInfo {
                hash: file_name,
                path: resolved_path,
                has_memory: memory_dir.exists(),
                exists,
            });
        }
    }

    // Sort: existing projects first, then alphabetically
    projects.sort_by(|a, b| {
        b.exists.cmp(&a.exists).then(a.path.cmp(&b.path))
    });

    Ok(projects)
}

// ── Managed projects: scan + user registry (lean Projects page) ─────────────

/// A project the user can deploy library resources into. `source` is
/// `"scanned"` (discovered under `~/.claude/projects/`) or `"registered"`
/// (a custom path the user added on the Projects page).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProject {
    pub path: String,
    pub name: String,
    pub source: String,
    pub exists: bool,
    pub has_memory: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct RegistryFile {
    #[serde(default)]
    projects: Vec<RegistryProject>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RegistryProject {
    path: String,
    name: String,
}

fn read_registry() -> RegistryFile {
    let p = paths::projects_registry_path();
    fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_registry(reg: &RegistryFile) -> Result<(), String> {
    let p = paths::projects_registry_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create registry dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(reg)
        .map_err(|e| format!("failed to serialize registry: {e}"))?;
    fs::write(&p, json).map_err(|e| format!("failed to write registry: {e}"))
}

fn basename(p: &str) -> String {
    std::path::Path::new(p)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| p.to_string())
}

/// All deploy-target projects: scanned (`~/.claude/projects/`) plus the user's
/// custom-registered paths, de-duplicated by path.
#[tauri::command]
pub fn list_all_projects() -> Result<Vec<ManagedProject>, String> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<ManagedProject> = Vec::new();

    for pi in list_projects()? {
        seen.insert(pi.path.clone());
        out.push(ManagedProject {
            name: basename(&pi.path),
            path: pi.path,
            source: "scanned".to_string(),
            exists: pi.exists,
            has_memory: pi.has_memory,
        });
    }

    for rp in read_registry().projects {
        if seen.insert(rp.path.clone()) {
            let exists = std::path::Path::new(&rp.path).is_dir();
            out.push(ManagedProject {
                name: if rp.name.is_empty() { basename(&rp.path) } else { rp.name },
                path: rp.path,
                source: "registered".to_string(),
                exists,
                has_memory: false,
            });
        }
    }

    out.sort_by(|a, b| b.exists.cmp(&a.exists).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

/// Register a custom project path (a folder the user wants to deploy into,
/// even if CC hasn't created a `~/.claude/projects/<hash>` for it). Only writes
/// the registry; does not touch `~/.claude/` or create any files on disk.
#[tauri::command]
pub fn add_project(path: String) -> Result<ManagedProject, String> {
    let p = path.trim().to_string();
    if p.is_empty() {
        return Err("empty project path".into());
    }
    let mut reg = read_registry();
    if !reg.projects.iter().any(|x| x.path == p) {
        reg.projects.push(RegistryProject {
            name: basename(&p),
            path: p.clone(),
        });
        write_registry(&reg)?;
    }
    let exists = std::path::Path::new(&p).is_dir();
    Ok(ManagedProject {
        name: basename(&p),
        path: p,
        source: "registered".to_string(),
        exists,
        has_memory: false,
    })
}

/// Remove a custom-registered project path from the registry only. Does NOT
/// delete the folder, CC's `~/.claude/projects/<hash>`, or any deployed
/// symlinks. Scanned projects reappear on the next scan; calls for paths not
/// in the registry are a no-op.
#[tauri::command]
pub fn remove_project(path: String) -> Result<(), String> {
    let mut reg = read_registry();
    let before = reg.projects.len();
    reg.projects.retain(|x| x.path != path);
    if reg.projects.len() != before {
        write_registry(&reg)?;
    }
    Ok(())
}

/// Open a folder in the platform's file manager (xdg-open / open / explorer).
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("empty path".into());
    }
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd)
        .arg(p)
        .spawn()
        .map_err(|e| format!("failed to open folder: {e}"))?;
    Ok(())
}
