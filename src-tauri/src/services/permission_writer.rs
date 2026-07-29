use anyhow::Result;
use directories::BaseDirs;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Permission scope determines which settings file to read/write.
///
/// NOTE: This module previously held the "permission rules" feature
/// (allow/deny/ask/defaultMode/additionalDirectories management). That feature
/// has been removed. What remains is the **shared scope infrastructure**
/// (`PermissionScope` + `resolve_settings_path`) consumed by the settings layer
/// — `claude_settings`, hooks, plugins, and (future) skill overrides.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionScope {
    User,
    Project,
    Local,
}

/// Resolve the settings file path for a given scope.
pub fn resolve_settings_path(
    scope: &PermissionScope,
    project_path: Option<&Path>,
) -> Result<PathBuf> {
    match scope {
        PermissionScope::User => {
            let base_dirs =
                BaseDirs::new().ok_or_else(|| anyhow::anyhow!("Could not find home directory"))?;
            Ok(base_dirs.home_dir().join(".claude").join("settings.json"))
        }
        PermissionScope::Project => {
            let project = project_path
                .ok_or_else(|| anyhow::anyhow!("Project path required for project scope"))?;
            Ok(project.join(".claude").join("settings.json"))
        }
        PermissionScope::Local => {
            let project = project_path
                .ok_or_else(|| anyhow::anyhow!("Project path required for local scope"))?;
            Ok(project.join(".claude").join("settings.local.json"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_scope_serialization() {
        assert_eq!(
            serde_json::to_string(&PermissionScope::User).unwrap(),
            "\"user\""
        );
        assert_eq!(
            serde_json::to_string(&PermissionScope::Project).unwrap(),
            "\"project\""
        );
        assert_eq!(
            serde_json::to_string(&PermissionScope::Local).unwrap(),
            "\"local\""
        );
    }

    #[test]
    fn test_resolve_settings_path_project_requires_path() {
        let result = resolve_settings_path(&PermissionScope::Project, None);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Project path required"));
    }

    #[test]
    fn test_resolve_settings_path_local_requires_path() {
        assert!(resolve_settings_path(&PermissionScope::Local, None).is_err());
    }

    #[test]
    fn test_resolve_settings_path_project_with_path() {
        let dir = tempfile::tempdir().unwrap();
        let result = resolve_settings_path(&PermissionScope::Project, Some(dir.path()));
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.to_string_lossy().contains("settings.json"));
        assert!(path.to_string_lossy().contains(".claude"));
    }

    #[test]
    fn test_resolve_settings_path_local_with_path() {
        let dir = tempfile::tempdir().unwrap();
        let result = resolve_settings_path(&PermissionScope::Local, Some(dir.path()));
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.to_string_lossy().contains("settings.local.json"));
    }
}
