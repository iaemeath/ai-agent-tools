// Path helpers — every path is derived from a ToolProfile so the codebase is tool-agnostic.
// No tool-specific string literals live here: 'skills', 'installed_plugins.json', etc.
// all come from the profile's locator blocks.

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

/** Global skills dir (e.g. ~/.claude/skills/). Dir name comes from the profile locator. */
export function globalSkillsDir(p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(configRoot(p), p.skills.dirName);
}

/** Project skills dir (e.g. {project}/.claude/skills/). Dir name comes from the profile locator. */
export function projectSkillsDir(project: string, p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(project, p.projectPrefix, p.skills.dirName);
}

/**
 * Session-history dir for fs-based tools (e.g. ~/.claude/projects/), or null for
 * sqlite-based tools (ZCode) that have no such folder. Skill scanning uses this to
 * discover project-scoped skills across all known projects.
 */
export function projectsDir(p: ToolProfile = DEFAULT_PROFILE): string | null {
	const loc = p.projects;
	return loc.source === 'fs' ? path.join(configRoot(p), loc.dirRelative) : null;
}

/** installed_plugins.json location. Path segments + filename come from the profile locator. */
export function installedPluginsFile(p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(configRoot(p), ...p.plugins.dirRelative, p.plugins.manifestFile);
}

/**
 * User-level MCP config file. NB: joined from HOME, not configRoot — Claude keeps its
 * user-level MCP map in ~/.claude.json (a home file), not under ~/.claude/.
 */
export function userMcpFile(p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(homeDir(), ...p.mcps.userFile);
}

/** Project-level MCP config file (e.g. <proj>/.mcp.json, <proj>/.zcode/config.json). */
export function projectMcpFile(project: string, p: ToolProfile = DEFAULT_PROFILE): string {
	return path.join(project, p.mcps.projectDir, p.mcps.projectFile);
}
