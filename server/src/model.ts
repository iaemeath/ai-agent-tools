// Data model — ported 1:1 from src-tauri/src/core/model.rs, then generalized for
// multi-tool support (profile field on ctx/instance). JSON wire format is camelCase
// (Rust used #[serde(rename_all = "camelCase")]), so TS fields are already aligned.

import type { ToolId, ToolProfile } from './profiles.js';

export type ToolKind = 'skill' | 'plugin';
export type Status = 'enabled' | 'disabled' | 'name-only' | 'user-only' | 'inherited';
export type Mechanism = 'nativeToggle';
export type Origin = 'global' | 'project';
export type Scope =
	| { level: 'user' }
	| { level: 'project'; path: string };

export interface ScopeStatus {
	scope: Scope;
	status: Status;
}

export interface ToolInstance {
	kind: ToolKind;
	name: string;
	description: string | null;
	mechanism: Mechanism;
	origin: Origin;
	sourcePath: string;
	/** Omitted entirely when None (Rust skip_serializing_if = "Option::is_none"). */
	originProject?: string;
	perScope: ScopeStatus[];
	effective: Status;
	/** Which tool this instance belongs to (lets the UI group by tool). */
	profile: ToolId;
}

export interface ToolOverview {
	items: ToolInstance[];
}

export interface ToolContent {
	kind: ToolKind;
	name: string;
	raw: string;
}

/** Structured component inventory item for plugin detail. */
export interface PluginComponent {
	kind: 'skill' | 'command' | 'agent' | 'hook' | 'mcp' | 'lsp' | 'monitor';
	name: string;
	/** One-line summary, e.g. skill description or MCP server command. */
	detail?: string;
}

/** Structured plugin detail — returned by the dedicated plugin detail endpoint. */
export interface PluginDetail {
	kind: 'plugin';
	name: string;
	description: string | null;
	version: string | null;
	installPath: string;
	scope: string | null;
	/** Which tool profile this plugin belongs to. */
	profile: ToolId;
	/** Per-scope enable status, same shape as ToolInstance.perScope. */
	perScope: ScopeStatus[];
	effective: Status;
	components: PluginComponent[];
}

export interface ProjectInfo {
	path: string;
	encoded: string;
	sessionCount: number;
	lastActivity: string | null;
	hasSettings: boolean;
}

/** One instruction file entry (global or project-level). */
export interface InstructionInfo {
	/** 'global' = under configRoot; 'project' = inside a project dir. */
	scope: 'global' | 'project';
	/** Full filesystem path to the file. */
	path: string;
	/** Line count of the file (0 if empty/unreadable). */
	lineCount: number;
	/** For project scope: the project directory. null for global. */
	project?: string | null;
}

/**
 * One MCP server entry, normalized across Claude Code / ZCode (read-only view model).
 * User-level servers come from the tool's user config file; project-level from a
 * per-project config file. `transport` is inferred when the tool omits an explicit type.
 */
export interface McpServer {
	/** Server name (the key in mcpServers / mcp.servers). */
	name: string;
	/** Which tool profile this server belongs to. */
	tool: ToolId;
	/** 'user' = user-level config; 'project' = a per-project config file. */
	scope: 'user' | 'project';
	/** Absolute path of the config file this entry was read from. */
	sourceFile: string;
	/** For project scope: the project directory. null for user scope. */
	project?: string | null;
	/** Normalized transport. Inferred from type/command/url when not explicit. */
	transport: 'stdio' | 'sse' | 'http';
	/** Raw `type` field as written by the tool (may differ from inferred transport). */
	type?: string;
	// stdio fields:
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	// http/sse fields:
	url?: string;
	headers?: Record<string, string>;
	// ZCode-only optional fields:
	enabled?: boolean;
	timeoutMs?: number;
}

export interface ScanCtx {
	/** null = overview mode (scan all projects). */
	project: string | null;
	/** Which tool's filesystem layout to scan. */
	profile: ToolProfile;
}
export interface ScopeCtx {
	project: string | null;
	/** Which tool's filesystem layout to target. */
	profile: ToolProfile;
}

/**
 * Resolve effective status from a per-scope list.
 * Two-level model (user + project). Walks from the MOST specific scope
 * (project — last in the list) outward to user; first non-inherited wins.
 * If everything is inherited (or list empty), defaults to 'enabled'.
 *
 * Ported from resolve_effective() — note the Rust .rev() iterator.
 */
export function resolveEffective(scopes: ScopeStatus[]): Status {
	for (let i = scopes.length - 1; i >= 0; i--) {
		if (scopes[i].status !== 'inherited') return scopes[i].status;
	}
	return 'enabled';
}
