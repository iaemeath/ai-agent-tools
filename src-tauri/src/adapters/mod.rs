pub mod plugin;
pub mod skill;

use crate::core::*;
use anyhow::Result;

#[derive(Debug, Clone)]
pub struct ScopeCtx { pub project: Option<String> }

#[derive(Debug, Clone)]
pub struct ScanCtx { pub project: Option<String> }

/// Per-tool-kind behavior. skill + plugin are both NativeToggle: global real +
/// native per-scope on/off, reloadable in-session (reload-skills / reload-plugins).
pub trait ToolAdapter: Send + Sync {
    fn kind(&self) -> ToolKind;
    fn mechanism(&self) -> Mechanism { Mechanism::NativeToggle }
    fn scan(&self, ctx: &ScanCtx) -> Result<Vec<ToolInstance>>;
    fn status(&self, name: &str, scope: Scope, ctx: &ScopeCtx) -> Result<Status>;
    fn set_status(&self, name: &str, scope: Scope, status: Status, ctx: &ScopeCtx) -> Result<()>;
    fn view(&self, name: &str) -> Result<ToolContent>;
}

pub fn registry() -> Vec<Box<dyn ToolAdapter>> {
    vec![Box::new(skill::SkillAdapter), Box::new(plugin::PluginAdapter)]
}

pub fn adapter_for(kind: ToolKind) -> Option<Box<dyn ToolAdapter>> {
    registry().into_iter().find(|a| a.kind() == kind)
}
