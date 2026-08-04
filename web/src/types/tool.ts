// Ported 1:1 from the previous Svelte version (src/lib/types/tool.ts).
// These mirror the server's wire format exactly (camelCase, level-tagged scope union).

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
}
export interface ToolOverview {
	items: ToolInstance[];
}
export interface ToolContent {
	kind: ToolKind;
	name: string;
	raw: string;
}
export interface ProjectInfo {
	path: string;
	encoded: string;
	sessionCount: number;
	lastActivity: string | null;
	hasSettings: boolean;
}
