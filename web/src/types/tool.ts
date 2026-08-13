// Ported 1:1 from the previous Svelte version (src/lib/types/tool.ts).
// These mirror the server's wire format exactly (camelCase, level-tagged scope union).

export type ToolId = 'claude' | 'zcode';
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
	originProject?: string;
	perScope: ScopeStatus[];
	effective: Status;
	/** Which tool this instance belongs to. */
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

export type ComponentKind = 'skill' | 'command' | 'agent' | 'hook' | 'mcp' | 'lsp' | 'monitor';

export interface PluginComponent {
	kind: ComponentKind;
	name: string;
	detail?: string;
}

export interface PluginDetail {
	kind: 'plugin';
	name: string;
	description: string | null;
	version: string | null;
	installPath: string;
	scope: string | null;
	profile: ToolId;
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

export interface InstructionInfo {
	scope: 'global' | 'project';
	path: string;
	lineCount: number;
	project?: string | null;
}

export interface RuleInfo {
	scope: 'global' | 'project';
	path: string;
	name: string;
	description?: string;
	lineCount: number;
	project?: string | null;
}

export interface CommandInfo {
	scope: 'global' | 'project';
	path: string;
	name: string;
	description?: string;
	lineCount: number;
	project?: string | null;
}

export interface AgentInfo {
	scope: 'global' | 'project';
	path: string;
	name: string;
	description?: string;
	lineCount: number;
	project?: string | null;
}

/** One hook entry, flattened from the nested hooks config tree (mirrors server HookInfo). */
export interface HookInfo {
	id: string;
	scope: 'global' | 'project';
	sourceFile: string;
	event: string;
	matcher: string;
	command: string;
	type: string;
	timeout?: number;
	statusMessage?: string;
	enabled: boolean;
	project?: string | null;
}

/** One MCP server entry (read-only view model, mirrors server McpServer). */
export interface McpServer {
	name: string;
	tool: ToolId;
	scope: 'user' | 'project';
	sourceFile: string;
	project?: string | null;
	transport: 'stdio' | 'sse' | 'http';
	type?: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	enabled?: boolean;
	timeoutMs?: number;
}
