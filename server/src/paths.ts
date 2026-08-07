// Path helpers — every path is derived from a ToolProfile so the codebase is tool-agnostic.
// Ported from src-tauri/src/core/paths.rs, then generalized for multi-tool support.

import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PROFILE, type ToolProfile } from './profiles.js';

export function homeDir(): string {
	return os.homedir();
}

/** Root config dir of the given tool (e.g. ~/.claude, ~/.zcode). */
export function configRoot(p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(homeDir(), p.configDir);
}

/** User-level settings file (e.g. ~/.claude/settings.json, ~/.zcode/cli/config.json). */
export function userSettings(p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(configRoot(p), ...p.settingsFile);
}

/** Project-level settings file (e.g. {project}/.claude/settings.json). */
export function projectSettings(project: string, p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(project, p.projectPrefix, ...p.settingsFile);
}

/** Global skills dir (e.g. ~/.claude/skills/). */
export function globalSkillsDir(p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(configRoot(p), 'skills');
}

/** Project skills dir (e.g. {project}/.claude/skills/). */
export function projectSkillsDir(project: string, p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(project, p.projectPrefix, 'skills');
}

/**
 * Session-history dir (e.g. ~/.claude/projects/), or null if the tool has none.
 * ZCode indexes sessions in SQLite and has no equivalent folder.
 */
export function projectsDir(p: ToolProfile = DEFAULT_PROFILE): string | null {
	return p.projectsDirRelative ? path.join(configRoot(p), p.projectsDirRelative) : null;
}

/** installed_plugins.json location (e.g. ~/.claude/plugins/installed_plugins.json). */
export function installedPluginsFile(p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(configRoot(p), 'plugins', 'installed_plugins.json');
}
