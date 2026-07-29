use super::*;
use crate::core::{paths, settings_io, resolve_effective, Origin, Scope, ScopeStatus, Status, ToolContent, ToolInstance, ToolKind};
use anyhow::{anyhow, Result};
use serde_json::Value;

pub struct SkillAdapter;

impl ToolAdapter for SkillAdapter {
    fn kind(&self) -> ToolKind { ToolKind::Skill }
    fn mechanism(&self) -> Mechanism { Mechanism::NativeToggle }

    fn scan(&self, ctx: &ScanCtx) -> Result<Vec<ToolInstance>> {
        let mut out = Vec::new();

        // 1. Global skills: ~/.claude/skills/*
        let global_dir = paths::global_skills_dir()?;
        if global_dir.exists() {
            for entry in std::fs::read_dir(&global_dir)? {
                let entry = entry?;
                if !entry.file_type()?.is_dir() { continue; }
                let name = entry.file_name().to_string_lossy().to_string();
                let marker = entry.path().join("SKILL.md");
                if !marker.exists() { continue; }
                let scopes = self.statuses(&name, ctx.project.as_deref());
                let effective = resolve_effective(&scopes);
                out.push(ToolInstance {
                    kind: ToolKind::Skill,
                    name: name.clone(),
                    description: parse_description(&marker),
                    mechanism: Mechanism::NativeToggle,
                    origin: Origin::Global,
                    source_path: entry.path().to_string_lossy().to_string(),
                    origin_project: None,
                    per_scope: scopes,
                    effective,
                });
            }
        }

        // 2. Project skills.
        //    - If a specific project is selected, scan only that one.
        //    - If project is None (overview mode), scan ALL known projects.
        let project_paths: Vec<String> = match ctx.project.as_deref() {
            Some(p) => vec![p.to_string()],
            None => crate::commands::all_project_paths(),
        };

        for proj in project_paths {
            let proj_dir = match paths::project_skills_dir(&proj) {
                Ok(d) => d,
                Err(_) => continue,
            };
            if !proj_dir.exists() { continue; }
            let entries = match std::fs::read_dir(&proj_dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries {
                let entry = match entry { Ok(e) => e, Err(_) => continue };
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
                let name = entry.file_name().to_string_lossy().to_string();
                let marker = entry.path().join("SKILL.md");
                if !marker.exists() { continue; }
                // Skip if a global skill with the same name already exists.
                if out.iter().any(|i| i.kind == ToolKind::Skill && i.name == name && i.origin_project.as_deref() == Some(proj.as_str())) { continue; }
                out.push(ToolInstance {
                    kind: ToolKind::Skill,
                    name: name.clone(),
                    description: parse_description(&marker),
                    mechanism: Mechanism::NativeToggle,
                    origin: Origin::Project,
                    source_path: entry.path().to_string_lossy().to_string(),
                    origin_project: Some(proj.clone()),
                    per_scope: vec![ScopeStatus { scope: Scope::Project { path: proj.clone() }, status: Status::Enabled }],
                    effective: Status::Enabled,
                });
            }
        }

        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn status(&self, name: &str, scope: Scope, _ctx: &ScopeCtx) -> Result<Status> {
        let s = settings_for(&scope)?;
        Ok(read_override(&s, name))
    }

    fn set_status(&self, name: &str, scope: Scope, status: Status, _ctx: &ScopeCtx) -> Result<()> {
        match scope {
            Scope::User => {
                let mut s = settings_io::read_user()?;
                write_override(&mut s, name, status);
                settings_io::write_user(&s)?;
            }
            Scope::Project { ref path } => {
                let path = path.clone();
                let mut s = settings_io::read_project(&path)?;
                write_override(&mut s, name, status);
                settings_io::write_project(&path, &s)?;
            }
        }
        Ok(())
    }

    fn view(&self, name: &str) -> Result<ToolContent> {
        let p = paths::global_skills_dir()?.join(name).join("SKILL.md");
        let raw = std::fs::read_to_string(&p).map_err(|_| anyhow!("skill not found: {}", name))?;
        Ok(ToolContent { kind: ToolKind::Skill, name: name.to_string(), raw })
    }
}

impl SkillAdapter {
    fn statuses(&self, name: &str, project: Option<&str>) -> Vec<ScopeStatus> {
        let user = settings_io::read_user().map(|s| read_override(&s, name)).unwrap_or(Status::Inherited);
        let mut v = vec![ScopeStatus { scope: Scope::User, status: user }];
        if let Some(p) = project {
            let pr = settings_io::read_project(p).map(|s| read_override(&s, name)).unwrap_or(Status::Inherited);
            v.push(ScopeStatus { scope: Scope::Project { path: p.to_string() }, status: pr });
        }
        v
    }
}

fn settings_for(scope: &Scope) -> Result<Value> {
    match scope {
        Scope::User => settings_io::read_user(),
        Scope::Project { path } => settings_io::read_project(path),
    }
}

fn read_override(settings: &Value, name: &str) -> Status {
    let Some(obj) = settings.get("skillOverrides").and_then(Value::as_object) else {
        return Status::Inherited;
    };
    match obj.get(name) {
        Some(v) => match v.as_str() {
            Some("on") => Status::Enabled,
            Some("off") => Status::Disabled,
            Some("name-only") => Status::NameOnly,
            Some("user-only") => Status::UserOnly,
            _ => Status::Inherited,
        },
        None => Status::Inherited,
    }
}

fn write_override(settings: &mut Value, name: &str, status: Status) {
    let obj = settings.as_object_mut().expect("settings must be an object");
    let overrides = obj.entry("skillOverrides".to_string()).or_insert_with(|| Value::Object(serde_json::Map::new()));
    let map = overrides.as_object_mut().expect("skillOverrides must be an object");
    match status {
        Status::Enabled => { map.insert(name.to_string(), Value::String("on".into())); }
        Status::Disabled => { map.insert(name.to_string(), Value::String("off".into())); }
        Status::NameOnly => { map.insert(name.to_string(), Value::String("name-only".into())); }
        Status::UserOnly => { map.insert(name.to_string(), Value::String("user-only".into())); }
        Status::Inherited => { map.remove(name); }
    }
    if map.is_empty() { obj.remove("skillOverrides"); }
}

fn parse_description(marker: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(marker).ok()?;
    if !raw.starts_with("---") { return first_non_heading_line(&raw); }
    for line in raw.lines().skip(1) {
        if line.trim() == "---" { break; }
        if let Some(rest) = line.strip_prefix("description:") {
            let d = rest.trim().trim_matches(CH_QUOTE).to_string();
            if !d.is_empty() { return Some(d); }
        }
    }
    None
}

fn first_non_heading_line(raw: &str) -> Option<String> {
    raw.lines().find(|l| !l.is_empty() && !l.starts_with(CH_HASH)).map(|s| s.to_string())
}

const CH_QUOTE: char = '\u{22}';
const CH_HASH: char = '\u{23}';

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn read_override_maps_known_values() {
        let s = json!({ "skillOverrides": { "a": "on", "b": "off", "c": "name-only", "d": "user-only" } });
        assert_eq!(read_override(&s, "a"), Status::Enabled);
        assert_eq!(read_override(&s, "b"), Status::Disabled);
        assert_eq!(read_override(&s, "c"), Status::NameOnly);
        assert_eq!(read_override(&s, "d"), Status::UserOnly);
        assert_eq!(read_override(&s, "z"), Status::Inherited);
        assert_eq!(read_override(&json!({}), "a"), Status::Inherited);
    }

    #[test]
    fn write_override_roundtrip_and_cleanup() {
        let mut s = json!({ "other": 42 });
        write_override(&mut s, "a", Status::Disabled);
        assert_eq!(s["skillOverrides"]["a"], "off");
        assert_eq!(s["other"], 42, "other keys preserved");
        write_override(&mut s, "a", Status::Inherited);
        assert!(s.get("skillOverrides").is_none());
        assert_eq!(s["other"], 42);
    }
}
