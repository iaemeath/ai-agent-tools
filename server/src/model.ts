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

export interface ProjectInfo {
	path: string;
	encoded: string;
	sessionCount: number;
	lastActivity: string | null;
	hasSettings: boolean;
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
