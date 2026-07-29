use serde::{Deserialize, Serialize};

/// Claude Code tool kinds this manager can toggle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    Skill,
    Plugin,
}

impl ToolKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Skill => "skill",
            Self::Plugin => "plugin",
        }
    }
}

/// Two-level scope model: user (global) + project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "level", rename_all = "lowercase")]
pub enum Scope {
    User,
    Project { path: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status { Enabled, Disabled, NameOnly, UserOnly, Inherited }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mechanism { NativeToggle }

/// Where a tool instance physically lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    /// ~/.claude/skills/ — global, inherited by all projects.
    Global,
    /// {project}/.claude/skills/ — lives inside one project only.
    Project,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInstance {
    pub kind: ToolKind,
    pub name: String,
    pub description: Option<String>,
    pub mechanism: Mechanism,
    pub origin: Origin,
    pub source_path: String,
    /// For project-origin instances, the owning project path (None for global).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_project: Option<String>,
    pub per_scope: Vec<ScopeStatus>,
    pub effective: Status,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeStatus { pub scope: Scope, pub status: Status }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOverview { pub items: Vec<ToolInstance> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolContent { pub kind: ToolKind, pub name: String, pub raw: String }

/// A discovered Claude Code project (one entry per directory under ~/.claude/projects/).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub encoded: String,
    pub session_count: u64,
    pub last_activity: Option<String>,
    pub has_settings: bool,
}

/// Resolve the effective status from a per-scope list.
///
/// Two-level model (user + project). Walks from the most specific scope
/// (project) outward to user; the first non-inherited status wins.
/// If everything is inherited, defaults to Enabled.
pub fn resolve_effective(scopes: &[ScopeStatus]) -> Status {
    scopes
        .iter()
        .rev()
        .find(|s| s.status != Status::Inherited)
        .map(|s| s.status)
        .unwrap_or(Status::Enabled)
}


