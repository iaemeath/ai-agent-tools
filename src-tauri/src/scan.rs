use crate::adapters::{registry, ScanCtx};
use crate::core::ToolOverview;
use anyhow::Result;

pub fn overview(project: Option<&str>) -> Result<ToolOverview> {
    let ctx = ScanCtx { project: project.map(|s| s.to_string()) };
    let mut items = Vec::new();
    for adapter in registry() {
        match adapter.scan(&ctx) {
            Ok(mut is) => items.append(&mut is),
            Err(e) => log::warn!("scan failed for {:?}: {}", adapter.kind(), e),
        }
    }
    // skills first, then by name
    items.sort_by(|a, b| a.kind.as_str().cmp(&b.kind.as_str()).then(a.name.cmp(&b.name)));
    Ok(ToolOverview { items })
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ToolKind;

    /// Live smoke test: scans the REAL ~/.claude config.
    #[test]
    fn live_scan_returns_tools() {
        let ov = overview(None).expect("scan should succeed");
        let skills = ov.items.iter().filter(|i| i.kind == ToolKind::Skill).count();
        let plugins = ov.items.iter().filter(|i| i.kind == ToolKind::Plugin).count();
        println!("live scan: {skills} skills, {plugins} plugins");
        assert!(skills + plugins > 0, "expected at least one skill or plugin");
    }
}
