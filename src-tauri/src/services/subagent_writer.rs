use crate::db::models::SubAgent;
use anyhow::Result;
use directories::BaseDirs;
use std::path::Path;

/// Generate markdown content for a sub-agent (.claude/agents/name.md)
pub(crate) fn generate_subagent_markdown(subagent: &SubAgent) -> String {
    let mut frontmatter = String::from("---\n");

    frontmatter.push_str(&format!("name: {}\n", subagent.name));
    frontmatter.push_str(&format!("description: {}\n", subagent.description));

    if let Some(ref tools) = subagent.tools {
        if !tools.is_empty() {
            frontmatter.push_str(&format!("tools: {}\n", tools.join(", ")));
        }
    }

    if let Some(ref model) = subagent.model {
        if !model.is_empty() {
            frontmatter.push_str(&format!("model: {}\n", model));
        }
    }

    if let Some(ref permission_mode) = subagent.permission_mode {
        if !permission_mode.is_empty() {
            frontmatter.push_str(&format!("permissionMode: {}\n", permission_mode));
        }
    }

    if let Some(ref skills) = subagent.skills {
        if !skills.is_empty() {
            frontmatter.push_str(&format!("skills: {}\n", skills.join(", ")));
        }
    }

    if let Some(ref disallowed_tools) = subagent.disallowed_tools {
        if !disallowed_tools.is_empty() {
            frontmatter.push_str(&format!(
                "disallowedTools: {}\n",
                disallowed_tools.join(", ")
            ));
        }
    }

    if let Some(max_turns) = subagent.max_turns {
        frontmatter.push_str(&format!("maxTurns: {}\n", max_turns));
    }

    if let Some(ref memory) = subagent.memory {
        if !memory.is_empty() {
            frontmatter.push_str(&format!("memory: {}\n", memory));
        }
    }

    if let Some(background) = subagent.background {
        if background {
            frontmatter.push_str("background: true\n");
        }
    }

    if let Some(ref effort) = subagent.effort {
        if !effort.is_empty() {
            frontmatter.push_str(&format!("effort: {}\n", effort));
        }
    }

    if let Some(ref isolation) = subagent.isolation {
        if !isolation.is_empty() {
            frontmatter.push_str(&format!("isolation: {}\n", isolation));
        }
    }

    if let Some(ref initial_prompt) = subagent.initial_prompt {
        if !initial_prompt.is_empty() {
            frontmatter.push_str(&format!("initialPrompt: {}\n", initial_prompt));
        }
    }

    if let Some(ref tags) = subagent.tags {
        if !tags.is_empty() {
            frontmatter.push_str(&format!("tags: {}\n", serde_json::to_string(tags).unwrap()));
        }
    }

    frontmatter.push_str("---\n\n");
    format!("{}{}", frontmatter, subagent.content)
}

/// Write a sub-agent to {base_path}/.claude/agents/{name}.md
pub fn write_subagent_file(base_path: &Path, subagent: &SubAgent) -> Result<()> {
    let agents_dir = base_path.join(".claude").join("agents");
    std::fs::create_dir_all(&agents_dir)?;

    let file_path = agents_dir.join(format!("{}.md", subagent.name));
    crate::utils::backup::backup_file(&file_path)?;
    let content = generate_subagent_markdown(subagent);
    std::fs::write(file_path, content)?;

    Ok(())
}

/// Delete a sub-agent file from {base_path}/.claude/agents/{name}.md
pub fn delete_subagent_file(base_path: &Path, name: &str) -> Result<()> {
    let file_path = base_path
        .join(".claude")
        .join("agents")
        .join(format!("{}.md", name));
    if file_path.exists() {
        std::fs::remove_file(file_path)?;
    }
    Ok(())
}

/// Write a sub-agent to the global Claude config (~/.claude/agents/)
pub fn write_global_subagent(subagent: &SubAgent) -> Result<()> {
    let base_dirs =
        BaseDirs::new().ok_or_else(|| anyhow::anyhow!("Could not find home directory"))?;
    let home = base_dirs.home_dir();
    write_subagent_file(home, subagent)
}

/// Delete a sub-agent from the global Claude config (~/.claude/agents/)
pub fn delete_global_subagent(name: &str) -> Result<()> {
    let base_dirs =
        BaseDirs::new().ok_or_else(|| anyhow::anyhow!("Could not find home directory"))?;
    let home = base_dirs.home_dir();
    delete_subagent_file(home, name)
}

/// Write a sub-agent to a project's Claude config ({project}/.claude/agents/)
pub fn write_project_subagent(project_path: &Path, subagent: &SubAgent) -> Result<()> {
    write_subagent_file(project_path, subagent)
}

/// Delete a sub-agent from a project's Claude config ({project}/.claude/agents/)
pub fn delete_project_subagent(project_path: &Path, name: &str) -> Result<()> {
    delete_subagent_file(project_path, name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // =========================================================================
    // Helper functions to create test subagents
    // =========================================================================

    fn sample_full_subagent() -> SubAgent {
        SubAgent {
            id: 1,
            name: "code-reviewer".to_string(),
            description: "Reviews code for bugs and improvements".to_string(),
            content: "You are a code review expert. Analyze code for bugs, security issues, and best practices.".to_string(),
            tools: Some(vec!["Read".to_string(), "Grep".to_string(), "Glob".to_string()]),
            model: Some("sonnet".to_string()),
            permission_mode: Some("bypassPermissions".to_string()),
            skills: Some(vec!["lint".to_string(), "format".to_string()]),
            tags: Some(vec!["review".to_string(), "quality".to_string()]),
            source: "manual".to_string(),
            source_path: None,
            is_favorite: false,
            disallowed_tools: None,
            max_turns: None,
            memory: None,
            background: None,
            effort: None,
            isolation: None,
            hooks: None,
            mcp_servers: None,
            initial_prompt: None,
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
        }
    }

    fn sample_minimal_subagent() -> SubAgent {
        SubAgent {
            id: 2,
            name: "simple-agent".to_string(),
            description: "A simple agent".to_string(),
            content: "You are a helpful assistant.".to_string(),
            tools: None,
            model: None,
            permission_mode: None,
            skills: None,
            tags: None,
            source: "manual".to_string(),
            source_path: None,
            is_favorite: false,
            disallowed_tools: None,
            max_turns: None,
            memory: None,
            background: None,
            effort: None,
            isolation: None,
            hooks: None,
            mcp_servers: None,
            initial_prompt: None,
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
        }
    }

    // =========================================================================
    // generate_subagent_markdown tests
    // =========================================================================

    #[test]
    fn test_generate_subagent_markdown_full() {
        let subagent = sample_full_subagent();
        let md = generate_subagent_markdown(&subagent);

        assert!(md.starts_with("---\n"));
        assert!(md.contains("name: code-reviewer\n"));
        assert!(md.contains("description: Reviews code for bugs and improvements\n"));
        assert!(md.contains("tools: Read, Grep, Glob\n"));
        assert!(md.contains("model: sonnet\n"));
        assert!(md.contains("permissionMode: bypassPermissions\n"));
        assert!(md.contains("skills: lint, format\n"));
        assert!(md.contains("---\n\nYou are a code review expert."));
    }

    #[test]
    fn test_generate_subagent_markdown_minimal() {
        let subagent = sample_minimal_subagent();
        let md = generate_subagent_markdown(&subagent);

        assert!(md.contains("name: simple-agent\n"));
        assert!(md.contains("description: A simple agent\n"));
        assert!(!md.contains("tools:"));
        assert!(!md.contains("model:"));
        assert!(!md.contains("permissionMode:"));
        assert!(!md.contains("skills:"));
        assert!(md.contains("---\n\nYou are a helpful assistant."));
    }

    #[test]
    fn test_generate_subagent_markdown_emits_tags_as_json_array() {
        // Mirrors the rule_writer fix: `tags` is read from the DB via
        // `serde_json::from_str`, so if a scanner ever ingests a subagent
        // frontmatter the value must be valid JSON, not comma-joined.
        // Also pins against silent-drop: previously `subagent.tags` was not
        // written to frontmatter at all.
        let mut subagent = sample_minimal_subagent();
        subagent.tags = Some(vec!["review".to_string(), "quality".to_string()]);

        let md = generate_subagent_markdown(&subagent);

        assert!(md.contains("tags: [\"review\",\"quality\"]\n"));
    }

    #[test]
    fn test_generate_subagent_markdown_omits_empty_tags() {
        let mut subagent = sample_minimal_subagent();
        subagent.tags = Some(vec![]);

        let md = generate_subagent_markdown(&subagent);

        assert!(!md.contains("tags:"));
    }

    #[test]
    fn test_generate_subagent_markdown_empty_tools_skipped() {
        let mut subagent = sample_full_subagent();
        subagent.tools = Some(vec![]);
        let md = generate_subagent_markdown(&subagent);

        assert!(!md.contains("tools:"));
    }

    #[test]
    fn test_generate_subagent_markdown_empty_model_skipped() {
        let mut subagent = sample_full_subagent();
        subagent.model = Some("".to_string());
        let md = generate_subagent_markdown(&subagent);

        assert!(!md.contains("model:"));
    }

    #[test]
    fn test_generate_subagent_markdown_empty_permission_mode_skipped() {
        let mut subagent = sample_full_subagent();
        subagent.permission_mode = Some("".to_string());
        let md = generate_subagent_markdown(&subagent);

        assert!(!md.contains("permissionMode:"));
    }

    #[test]
    fn test_generate_subagent_markdown_empty_skills_skipped() {
        let mut subagent = sample_full_subagent();
        subagent.skills = Some(vec![]);
        let md = generate_subagent_markdown(&subagent);

        assert!(!md.contains("skills:"));
    }

    // =========================================================================
    // write_subagent_file tests
    // =========================================================================

    #[test]
    fn test_write_subagent_file_creates_correct_path() {
        let temp_dir = TempDir::new().unwrap();
        let subagent = sample_full_subagent();

        write_subagent_file(temp_dir.path(), &subagent).unwrap();

        let expected_path = temp_dir
            .path()
            .join(".claude")
            .join("agents")
            .join("code-reviewer.md");
        assert!(expected_path.exists());
    }

    #[test]
    fn test_write_subagent_file_content_matches() {
        let temp_dir = TempDir::new().unwrap();
        let subagent = sample_full_subagent();

        write_subagent_file(temp_dir.path(), &subagent).unwrap();

        let file_path = temp_dir
            .path()
            .join(".claude")
            .join("agents")
            .join("code-reviewer.md");
        let content = std::fs::read_to_string(file_path).unwrap();

        assert!(content.contains("name: code-reviewer"));
        assert!(content.contains("You are a code review expert."));
    }

    #[test]
    fn test_write_subagent_file_creates_directories() {
        let temp_dir = TempDir::new().unwrap();
        let subagent = sample_minimal_subagent();

        // Directory doesn't exist yet
        let agents_dir = temp_dir.path().join(".claude").join("agents");
        assert!(!agents_dir.exists());

        write_subagent_file(temp_dir.path(), &subagent).unwrap();

        assert!(agents_dir.exists());
    }

    // =========================================================================
    // delete_subagent_file tests
    // =========================================================================

    #[test]
    fn test_delete_subagent_file() {
        let temp_dir = TempDir::new().unwrap();
        let subagent = sample_full_subagent();

        // Write first
        write_subagent_file(temp_dir.path(), &subagent).unwrap();
        let file_path = temp_dir
            .path()
            .join(".claude")
            .join("agents")
            .join("code-reviewer.md");
        assert!(file_path.exists());

        // Delete
        delete_subagent_file(temp_dir.path(), &subagent.name).unwrap();
        assert!(!file_path.exists());
    }

    #[test]
    fn test_delete_nonexistent_subagent_succeeds() {
        let temp_dir = TempDir::new().unwrap();

        // Should not error when file doesn't exist
        let result = delete_subagent_file(temp_dir.path(), "nonexistent");
        assert!(result.is_ok());
    }

    #[test]
    fn test_write_project_subagent() {
        let temp_dir = TempDir::new().unwrap();
        let subagent = sample_full_subagent();

        write_project_subagent(temp_dir.path(), &subagent).unwrap();

        let expected_path = temp_dir
            .path()
            .join(".claude")
            .join("agents")
            .join("code-reviewer.md");
        assert!(expected_path.exists());
    }

    #[test]
    fn test_delete_project_subagent() {
        let temp_dir = TempDir::new().unwrap();
        let subagent = sample_full_subagent();

        write_project_subagent(temp_dir.path(), &subagent).unwrap();
        delete_project_subagent(temp_dir.path(), &subagent.name).unwrap();

        let file_path = temp_dir
            .path()
            .join(".claude")
            .join("agents")
            .join("code-reviewer.md");
        assert!(!file_path.exists());
    }
}
