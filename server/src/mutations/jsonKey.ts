// jsonKey mutation — the "modify a per-name switch inside a settings JSON object" primitive.
//
// Used by A-class tools (skill → skillOverrides, plugin → enabledPlugins): the only difference
// is the key name and the value encoding. This module owns the key-preserving read/write logic;
// adapters no longer carry their own override readers/writers — they delegate here.
//
// Keeping it standalone means a future adapter (e.g. a hypothetical toggle-able mcp allow-list)
// can reuse the exact same primitive instead of duplicating logic.

import type { Status } from '../model.js';

type Json = Record<string, unknown>;

/** Value-encoding style for the per-name key. */
export type JsonKeyEncoding =
	| { kind: 'string'; /** on/off-style values */ toNative: Record<Status, string | undefined>; fromNative: Record<string, Status> }
	| { kind: 'boolean' };

/** Read settings[key][name]; unknown/missing → 'inherited'. */
export function readJsonKey(settings: Json, key: string, name: string, enc: JsonKeyEncoding): Status {
	const map = settings[key];
	if (!map || typeof map !== 'object' || Array.isArray(map)) return 'inherited';
	const v = (map as Json)[name];
	if (enc.kind === 'boolean') {
		return typeof v === 'boolean' ? (v ? 'enabled' : 'disabled') : 'inherited';
	}
	if (typeof v !== 'string') return 'inherited';
	return enc.fromNative[v] ?? 'inherited';
}

/**
 * Set settings[key][name] (or remove it for 'inherited'). Preserves every other top-level key.
 * Cleans up: if the map is empty, removes the whole key.
 */
export function writeJsonKey(settings: Json, key: string, name: string, status: Status, enc: JsonKeyEncoding): void {
	let map = settings[key];
	if (!map || typeof map !== 'object' || Array.isArray(map)) {
		map = {};
		settings[key] = map;
	}
	const m = map as Record<string, unknown>;
	if (enc.kind === 'boolean') {
		// Booleans can't express name-only/user-only — they collapse to enabled (true).
		if (status === 'enabled' || status === 'name-only' || status === 'user-only') {
			m[name] = true;
		} else if (status === 'disabled') {
			m[name] = false;
		} else {
			delete m[name];
		}
	} else {
		const native = enc.toNative[status];
		if (native === undefined) {
			delete m[name];
		} else {
			m[name] = native;
		}
	}
	if (Object.keys(m).length === 0) delete settings[key];
}
