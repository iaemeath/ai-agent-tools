use super::*;
use crate::core::{paths, settings_io, resolve_effective};
use anyhow::{anyhow, Result};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct InstallRecord {
    #[serde(rename = "scope")] _scope: String,
    #[serde(rename = "installPath")] install_path: String,
    #[serde(default)] version: Option<String>,
}

pub struct PluginAdapter;

impl ToolAdapter for PluginAdapter {
    fn kind(&self) -> ToolKind { ToolKind::Plugin }
    fn mechanism(&self) -> Mechanism { Mechanism::NativeToggle }

    fn scan(&self, ctx: &ScanCtx) -> Result<Vec<ToolInstance>> {
        let mut out = Vec::new();
        let installed = read_installed()?;
        for (full, records) in installed {
            let Some(rec) = records.into_iter().next() else { continue; };
            let scopes = statuses(&full, ctx.project.as_deref());
            let effective = resolve_effective(&scopes);
            out.push(ToolInstance {
                kind: ToolKind::Plugin,
                name: full.clone(),
                description: rec.version,
                mechanism: Mechanism::NativeToggle,
                origin: Origin::Global,
                source_path: rec.install_path,
                origin_project: None,
                per_scope: scopes,
                effective,
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn status(&self, name: &str, scope: Scope, _ctx: &ScopeCtx) -> Result<Status> {
        let s = settings_for(&scope)?;
        Ok(read_enabled(&s, name))
    }

    fn set_status(&self, name: &str, scope: Scope, status: Status, _ctx: &ScopeCtx) -> Result<()> {
        match scope {
            Scope::User => {
                let mut s = settings_io::read_user()?;
                write_enabled(&mut s, name, status);
                settings_io::write_user(&s)?;
            }
            Scope::Project { ref path } => {
                let path = path.clone();
                let mut s = settings_io::read_project(&path)?;
                write_enabled(&mut s, name, status);
                settings_io::write_project(&path, &s)?;
            }
        }
        Ok(())
    }

    fn view(&self, name: &str) -> Result<ToolContent> {
        let installed = read_installed()?;
        let rec = installed.get(name).and_then(|r| r.first()).ok_or_else(|| anyhow!("plugin not found: {}", name))?;
        let raw = format!("plugin {} installed at {} (scope {})", name, rec.install_path, rec._scope);
        Ok(ToolContent { kind: ToolKind::Plugin, name: name.to_string(), raw })
    }
}

fn settings_for(scope: &Scope) -> Result<Value> {
    match scope {
        Scope::User => settings_io::read_user(),
        Scope::Project { path } => settings_io::read_project(path),
    }
}

fn statuses(full: &str, project: Option<&str>) -> Vec<ScopeStatus> {
    let user = settings_io::read_user().map(|s| read_enabled(&s, full)).unwrap_or(Status::Inherited);
    let mut v = vec![ScopeStatus { scope: Scope::User, status: user }];
    if let Some(p) = project {
        let pr = settings_io::read_project(p).map(|s| read_enabled(&s, full)).unwrap_or(Status::Inherited);
        v.push(ScopeStatus { scope: Scope::Project { path: p.to_string() }, status: pr });
    }
    v
}

fn read_enabled(settings: &Value, name: &str) -> Status {
    match settings.get("enabledPlugins").and_then(|e| e.get(name)) {
        Some(v) if v.is_boolean() => { if v.as_bool().unwrap() { Status::Enabled } else { Status::Disabled } }
        _ => Status::Inherited,
    }
}

fn write_enabled(settings: &mut Value, name: &str, status: Status) {
    let obj = settings.as_object_mut().expect("settings must be an object");
    let ep = obj.entry("enabledPlugins".to_string()).or_insert_with(|| Value::Object(serde_json::Map::new()));
    let map = ep.as_object_mut().expect("enabledPlugins must be an object");
    match status {
        Status::Enabled | Status::NameOnly | Status::UserOnly => { map.insert(name.to_string(), Value::Bool(true)); }
        Status::Disabled => { map.insert(name.to_string(), Value::Bool(false)); }
        Status::Inherited => { map.remove(name); }
    }
    if map.is_empty() { obj.remove("enabledPlugins"); }
}

fn read_installed() -> Result<std::collections::BTreeMap<String, Vec<InstallRecord>>> {
    #[derive(Deserialize)]
    struct InstalledFile { plugins: std::collections::BTreeMap<String, Vec<InstallRecord>> }
    let p = paths::claude_dir()?.join("plugins").join("installed_plugins.json");
    if !p.exists() { return Ok(Default::default()); }
    let raw = std::fs::read_to_string(&p)?;
    let parsed: InstalledFile = serde_json::from_str(&raw).unwrap_or(InstalledFile { plugins: Default::default() });
    Ok(parsed.plugins)
}

