// ToolAdapter interface + registry — ported from src-tauri/src/adapters/mod.rs.

import type { Mechanism, Origin, Scope, ScopeCtx, ScanCtx, Status, ToolContent, ToolInstance, ToolKind } from '../model.js';

export interface ToolAdapter {
	kind: ToolKind;
	mechanism: Mechanism;
	scan(ctx: ScanCtx): ToolInstance[];
	setStatus(name: string, scope: Scope, status: Status, ctx: ScopeCtx): void;
	view(name: string): ToolContent;
}

import { SkillAdapter } from './skill.js';
import { PluginAdapter } from './plugin.js';

/**
 * Registry — skill first, plugin second (order matters for overview sort stability).
 * Ported from registry(); returns fresh instances.
 */
export function registry(): ToolAdapter[] {
	return [new SkillAdapter(), new PluginAdapter()];
}

export function adapterFor(kind: ToolKind): ToolAdapter | undefined {
	return registry().find((a) => a.kind === kind);
}

/** Re-exported for callers that only need the Origin type. */
export type { Origin };
