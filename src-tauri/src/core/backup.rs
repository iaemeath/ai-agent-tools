use anyhow::Result;
use std::path::Path;

/// Copy `path` to `path.bak` if it exists. Ignores missing files.
pub fn backup_file(path: &Path) -> Result<()> {
    if !path.exists() { return Ok(()); }
    let bak = path.with_extension(format!(
        "{}bak",
        path.extension().map(|e| format!("{}.", e.to_string_lossy())).unwrap_or_default()
    ));
    if let Err(e) = std::fs::copy(path, &bak) {
        log::warn!("backup failed for {}: {}", path.display(), e);
    }
    Ok(())
}