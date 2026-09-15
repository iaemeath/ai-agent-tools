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

/** Skills provided by one installed plugin (Skills page "from plugins" section). */
export interface PluginSkillGroup {
	plugin: string;
	effective: Status;
	skills: { name: string; description: string | null }[];
}

/** Skill invocation counts across session transcripts (Skills page usage badges). */
export interface SkillUsage {
	supported: boolean;
	filesScanned: number;
	totalCalls: number;
	counts: Record<string, number>;
}
export interface ProjectInfo {
	path: string;
	encoded: string;
	sessionCount: number;
	lastActivity: string | null;
	hasSettings: boolean;
}

// ---- Session reading (mirror of server model.ts + transcript-parser.ts) ----

export interface TranscriptStep {
	type: 'thinking' | 'text';
	text: string;
}

export interface TranscriptToolCall {
	name: string;
	summary: string;
	input: string;
}

export interface TranscriptTurn {
	ts: string | null;
	user: string;
	steps: TranscriptStep[];
	tools: TranscriptToolCall[];
	response: string;
	stats?: { toolCalls?: number; tokens?: number; durationMs?: number };
}

export interface SessionSummary {
	id: string;
	title: string | null;
	taskType: string | null;
	parentId: string | null;
	timeCreated: string | null;
	timeUpdated: string | null;
	hasTranscript: boolean;
}

export interface SessionFlow {
	id: string;
	kind: 'main' | 'subagent';
	description: string;
	sourcePath: string;
	/** When this flow began (ISO). Subagents: spawn time — interleaves into main turns. */
	startedAt?: string | null;
	turns: TranscriptTurn[];
	stats: { lines: number; firstTs: string | null; lastTs: string | null; toolCalls: number };
}

export interface SessionRead {
	session: SessionSummary;
	main: SessionFlow | null;
	subagents: SessionFlow[];
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
