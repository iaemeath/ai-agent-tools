#![allow(dead_code)]
use super::paths;
use anyhow::Result;
use serde_json::{json, Value};
use std::path::Path;

/// Read a settings file as a JSON object (empty object if missing/invalid).
pub fn read(path: &Path) -> Value {
    if path.exists() {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| json!({}))
    } else {
        json!({})
    }
}

/// Write a settings object, preserving formatting and parent dirs. Backs up first.
pub fn write(path: &Path, value: &Value) -> Result<()> {
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    crate::core::backup::backup_file(path)?;
    let s = serde_json::to_string_pretty(value)?;
    std::fs::write(path, s + "\n")?;
    Ok(())
}

/// Read a top-level object key as a clone.
pub fn get_key(settings: &Value, key: &str) -> Option<Value> {
    settings.get(key).cloned()
}

/// Set a top-level object key, preserving every other key (SSOT-safe).
pub fn set_key(settings: &mut Value, key: &str, value: Value) {
    if let Some(obj) = settings.as_object_mut() {
        obj.insert(key.to_string(), value);
    }
}

/// Remove a top-level object key if present.
pub fn remove_key(settings: &mut Value, key: &str) {
    if let Some(obj) = settings.as_object_mut() {
        obj.remove(key);
    }
}

/// Convenience: user-level settings object.
pub fn read_user() -> Result<Value> { Ok(read(&paths::user_settings()?)) }
pub fn write_user(v: &Value) -> Result<()> { write(&paths::user_settings()?, v) }

pub fn read_project(project: &str) -> Result<Value> { Ok(read(&paths::project_settings(project)?)) }
pub fn write_project(project: &str, v: &Value) -> Result<()> {
    write(&paths::project_settings(project)?, v)
}
