// ToolAdapter interface + registry — ported from src-tauri/src/adapters/mod.rs.
// Adapters are stateless; a fresh pair is created per profile so paths resolve correctly.

import type { Mechanism, Origin, Scope, ScopeCtx, ScanCtx, Status, ToolContent, ToolInstance, ToolKind } from '../model.js';
import type { ToolProfile } from '../profiles.js';

export interface ToolAdapter {
	kind: ToolKind;
	mechanism: Mechanism;
	scan(ctx: ScanCtx): Promise<ToolInstance[]>;
	setStatus(name: string, scope: Scope, status: Status, ctx: ScopeCtx): Promise<void>;
	view(name: string): Promise<ToolContent>;
}

import { SkillAdapter } from './skill.js';
import { PluginAdapter } from './plugin.js';

/**
 * Registry — skill first, plugin second (order matters for overview sort stability).
 * Each adapter is constructed with the profile it should scan/write against.
 */
export function registry(profile: ToolProfile): ToolAdapter[] {
	return [new SkillAdapter(profile), new PluginAdapter(profile)];
}

export function adapterFor(kind: ToolKind, profile: ToolProfile): ToolAdapter | undefined {
	return registry(profile).find((a) => a.kind === kind);
}

/** Re-exported for callers that only need the Origin type. */
export type { Origin };
