#![allow(dead_code)]
use anyhow::{anyhow, Result};
use std::path::PathBuf;

/// Home directory (~).
pub fn home_dir() -> Result<PathBuf> {
    let bd = directories::BaseDirs::new().ok_or_else(|| anyhow!("no home directory"))?;
    Ok(bd.home_dir().to_path_buf())
}

/// ~/.claude/  (global skills/agents/commands/rules)
pub fn claude_dir() -> Result<PathBuf> { Ok(home_dir()?.join(".claude")) }

/// ~/.claude.json  (global mcpServers etc.)
pub fn claude_json() -> Result<PathBuf> { Ok(home_dir()?.join(".claude.json")) }

/// User-level settings.json: ~/.claude/settings.json
pub fn user_settings() -> Result<PathBuf> { Ok(claude_dir()?.join("settings.json")) }

/// Project-level settings.json: {project}/.claude/settings.json
pub fn project_settings(project: &str) -> Result<PathBuf> {
    Ok(PathBuf::from(project).join(".claude").join("settings.json"))
}

/// Global skills directory: ~/.claude/skills/
pub fn global_skills_dir() -> Result<PathBuf> { Ok(claude_dir()?.join("skills")) }

/// Project-level skills directory: {project}/.claude/skills/
pub fn project_skills_dir(project: &str) -> Result<PathBuf> {
    Ok(PathBuf::from(project).join(".claude").join("skills"))
}

/// Canonical library for deploy-axis tools: ~/.claude/library/{kind}/
pub fn library_kind_dir(kind: &str) -> Result<PathBuf> { Ok(claude_dir()?.join("library").join(kind)) }

/// Sanitize a name for use as a single path component.
pub fn sanitize_component(name: &str) -> Result<String> {
    let clean: String = name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if clean.is_empty() { return Err(anyhow!("invalid name")); }
    Ok(clean)
}
