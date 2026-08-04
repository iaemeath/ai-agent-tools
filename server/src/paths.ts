// Path helpers — ported from src-tauri/src/core/paths.rs.
// Uses os.homedir() instead of directories::BaseDirs.

import os from 'node:os';
import path from 'node:path';

export function homeDir(): string {
	return os.homedir();
}

/** ~/.claude/ */
export function claudeDir(): string {
	return path.join(homeDir(), '.claude');
}

/** ~/.claude.json (global mcpServers etc. — kept for parity, currently unused). */
export function claudeJson(): string {
	return path.join(homeDir(), '.claude.json');
}

/** User-level settings: ~/.claude/settings.json */
export function userSettings(): string {
	return path.join(claudeDir(), 'settings.json');
}

/** Project-level settings: {project}/.claude/settings.json */
export function projectSettings(project: string): string {
	return path.join(project, '.claude', 'settings.json');
}

/** Global skills: ~/.claude/skills/ */
export function globalSkillsDir(): string {
	return path.join(claudeDir(), 'skills');
}

/** Project skills: {project}/.claude/skills/ */
export function projectSkillsDir(project: string): string {
	return path.join(project, '.claude', 'skills');
}

/** ~/.claude/projects/ — Claude Code session history folders. */
export function projectsDir(): string {
	return path.join(claudeDir(), 'projects');
}

/** ~/.claude/plugins/installed_plugins.json */
export function installedPluginsFile(): string {
	return path.join(claudeDir(), 'plugins', 'installed_plugins.json');
}
