// Tool profiles — the single source of truth for per-tool filesystem layout.
//
// Each AI coding tool (Claude Code, ZCode, …) stores its config under a different
// directory and uses different key paths / file formats. A ToolProfile captures all
// those differences as DECLARATIONS so paths.ts / adapters / locator.ts can stay
// tool-agnostic: they read the profile and derive everything from it.
//
// Adding a new tool = adding one entry to PROFILES. No engine/adapter changes.
//
// The per-resource differences (skills dir, plugin manifest format, enabled-key
// nesting) live under `skills` and `plugins` as self-contained locator blocks,
// each carrying its own file path, key path, and value encoding.

import type { JsonKeyEncoding } from './mutations/jsonKey.js';

/** Supported tool identifiers. */
export type ToolId = 'claude' | 'zcode';

/** Locator for the skill resource: where skills live + how their toggle map encodes. */
export interface SkillLocator {
	/** Directory name under configRoot / projectPrefix (e.g. 'skills'). */
	dirName: string;
	/** Marker filename inside each skill dir (e.g. 'SKILL.md'). */
	marker: string;
	/** Key path from settings JSON root to the per-name override map (e.g. ['skillOverrides']). */
	overridesKeyPath: string[];
	/** Value encoding for the override map. */
	overridesEncoding: JsonKeyEncoding;
}

/** Locator for the plugin resource: manifest file + enabled-key nesting + format. */
export interface PluginLocator {
	/** Path segments from configRoot to the plugins dir (e.g. ['plugins'], ['cli','plugins']). */
	dirRelative: string[];
	/** Manifest filename inside the plugins dir (e.g. 'installed_plugins.json'). */
	manifestFile: string;
	/**
	 * How the manifest's `plugins` collection is keyed.
	 * - Claude: object map { "name@mp": [records] } → isArray=false, idField=null (key IS the id).
	 * - ZCode:  array of objects [ {id, installPath, ...} ]      → isArray=true,  idField='id'.
	 */
	manifestIsArray: boolean;
	/** When manifestIsArray, the record field carrying the id ("name@mp"); null for map form. */
	manifestIdField: string | null;
	/** Key path from settings JSON root to the enabled map (e.g. ['enabledPlugins'], ['plugins','enabledPlugins']). */
	enabledKeyPath: string[];
	/** Value encoding for the enabled map. */
	enabledEncoding: JsonKeyEncoding;
}

/**
 * How a tool discovers projects (each project = a cwd the tool has run in).
 * - fs:     Claude Code — session-history folders under configRoot, names dash-encoded.
 * - sqlite: ZCode       — a SQLite DB with a `session` table carrying a real `directory` column.
 */
export type ProjectsLocator =
	| { source: 'fs'; dirRelative: string; encoding: 'dash' }
	| { source: 'sqlite'; dbRelative: string[]; table: string; pathColumn: string; timeColumn: string };

/**
 * Locator for the MCP (Model Context Protocol) server resource.
 * MCP servers are read-only in this UI (list + detail view). Each tool stores its
 * user-level and project-level server maps at different paths and under different keys:
 *
 * - Claude:  user map in `~/.claude.json` (home file, NOT under .claude/) at top-level `mcpServers`;
 *            project map in `<proj>/.mcp.json` at `mcpServers`.
 * - ZCode:   user map in `~/.zcode/cli/config.json` at nested `mcp.servers`;
 *            project map in `<proj>/.zcode/config.json` at `mcp.servers`.
 */
export interface McpLocator {
	/** Path segments from HOME (not configRoot) to the user-level config file. */
	userFile: string[];
	/** Key path from the user-level JSON root to the server map. */
	userKeyPath: string[];
	/** Project-level config filename (e.g. '.mcp.json', 'config.json'). */
	projectFile: string;
	/** Directory under a project root holding the project-level file (e.g. '.', '.zcode'). */
	projectDir: string;
	/** Key path from the project-level JSON root to the server map. */
	projectKeyPath: string[];
}

/**
 * Filesystem + config layout of one AI tool's config.
 */
export interface ToolProfile {
	/** Tool identifier (also stored on ToolInstance so the UI can group by tool). */
	id: ToolId;
	/** Human-readable name for the UI selector. */
	label: string;
	/** Directory name under home (e.g. '.claude', '.zcode'). */
	configDir: string;
	/** Directory name under a project root (e.g. '.claude', '.zcode'). */
	projectPrefix: string;
	/**
	 * Path segments from configDir to the settings JSON file.
	 * Array form because ZCode nests it ('cli/config.json') while Claude is flat.
	 */
	settingsFile: string[];
	/** Project/session-history discovery locator (filesystem folders OR sqlite DB). */
	projects: ProjectsLocator;
	/** Skill resource locator. */
	skills: SkillLocator;
	/** Plugin resource locator. */
	plugins: PluginLocator;
	/** Instruction-file locator (global CLAUDE.md / AGENTS.md + project-level). */
	instructions: { fileName: string };
	/** MCP server locator (read-only: list + detail). */
	mcps: McpLocator;
}

/** Boolean encoding shared by all plugin enabled maps. */
const PLUGIN_BOOL: JsonKeyEncoding = { kind: 'boolean' };

/** String encoding shared by all skill override maps (on/off/name-only/user-only). */
const SKILL_STR: JsonKeyEncoding = {
	kind: 'string',
	toNative: { enabled: 'on', disabled: 'off', 'name-only': 'name-only', 'user-only': 'user-only', inherited: undefined },
	fromNative: { on: 'enabled', off: 'disabled', 'name-only': 'name-only', 'user-only': 'user-only' },
};

export const PROFILES: Record<ToolId, ToolProfile> = {
	claude: {
		id: 'claude',
		label: 'Claude Code',
		configDir: '.claude',
		projectPrefix: '.claude',
		settingsFile: ['settings.json'],
		projects: { source: 'fs', dirRelative: 'projects', encoding: 'dash' },
		skills: {
			dirName: 'skills',
			marker: 'SKILL.md',
			overridesKeyPath: ['skillOverrides'],
			overridesEncoding: SKILL_STR,
		},
		plugins: {
			dirRelative: ['plugins'],
			manifestFile: 'installed_plugins.json',
			manifestIsArray: false,
			manifestIdField: null,
			enabledKeyPath: ['enabledPlugins'],
			enabledEncoding: PLUGIN_BOOL,
		},
		instructions: { fileName: 'CLAUDE.md' },
		// MCP: user-level map lives in ~/.claude.json (home file, not under .claude/),
		// project-level in <proj>/.mcp.json. Both keyed by top-level `mcpServers`.
		mcps: {
			userFile: ['.claude.json'],
			userKeyPath: ['mcpServers'],
			projectFile: '.mcp.json',
			projectDir: '.',
			projectKeyPath: ['mcpServers'],
		},
	},
	zcode: {
		id: 'zcode',
		label: 'ZCode',
		configDir: '.zcode',
		projectPrefix: '.zcode',
		settingsFile: ['cli', 'config.json'],
		projects: {
			source: 'sqlite',
			dbRelative: ['cli', 'db', 'db.sqlite'],
			table: 'session',
			pathColumn: 'directory',
			timeColumn: 'time_updated',
		},
		skills: {
			dirName: 'skills',
			marker: 'SKILL.md',
			overridesKeyPath: ['skills', 'skillOverrides'],
			overridesEncoding: SKILL_STR,
		},
		plugins: {
			dirRelative: ['cli', 'plugins'],
			manifestFile: 'installed_plugins.json',
			manifestIsArray: true,
			manifestIdField: 'id',
			enabledKeyPath: ['plugins', 'enabledPlugins'],
			enabledEncoding: PLUGIN_BOOL,
		},
		instructions: { fileName: 'AGENTS.md' },
		// MCP: user-level map in ~/.zcode/cli/config.json at nested `mcp.servers`,
		// project-level in <proj>/.zcode/config.json at the same nested key.
		mcps: {
			userFile: ['.zcode', 'cli', 'config.json'],
			userKeyPath: ['mcp', 'servers'],
			projectFile: 'config.json',
			projectDir: '.zcode',
			projectKeyPath: ['mcp', 'servers'],
		},
	},
};

/** Default profile used when a caller doesn't specify one (preserves legacy behavior). */
export const DEFAULT_PROFILE: ToolProfile = PROFILES.claude;

/** Resolve a profile by id; unknown ids fall back to the default. */
export function profileOf(id: string): ToolProfile {
	return PROFILES[id as ToolId] ?? DEFAULT_PROFILE;
}
