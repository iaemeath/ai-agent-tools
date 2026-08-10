// ResourceLocator engine — tool-agnostic read/write primitives.
//
// The single place that "knows how to walk a nested JSON object" and "how to parse
// a plugin manifest regardless of array/map shape". Adapters call these with values
// taken from a ToolProfile's locator blocks; no tool-specific literals live here.
//
// Adding a new tool never touches this file — it only adds a profile entry.

import fs from 'node:fs';
import path from 'node:path';
import { configRoot } from './paths.js';
import type { PluginLocator, ToolProfile } from './profiles.js';
import { readJsonKey, writeJsonKey, type JsonKeyEncoding } from './mutations/jsonKey.js';
import type { Status } from './model.js';

type Json = Record<string, unknown>;

/** A normalized install record, regardless of on-disk array/map shape. */
export interface InstallRecord {
	scope?: string;
	installPath: string;
	version?: string | null;
}

/**
 * Walk a nested object along `keyPath` segments and return the leaf parent + final key.
 * When `create` is true, missing intermediate objects are auto-created (for writes);
 * when false, any missing/non-object middle node → null.
 */
function resolveNested(root: Json, keyPath: string[], create: boolean): { parent: Json; key: string } | null {
	if (keyPath.length === 0) return null;
	let cur: Json = root;
	for (let i = 0; i < keyPath.length - 1; i++) {
		const seg = keyPath[i];
		let next = cur[seg];
		if (!next || typeof next !== 'object' || Array.isArray(next)) {
			if (!create) return null;
			next = {};
			cur[seg] = next;
		}
		cur = next as Json;
	}
	return { parent: cur, key: keyPath[keyPath.length - 1] };
}

/**
 * Read a per-name toggle flag from settings JSON, walking `keyPath` to the map first.
 * Missing path or missing name → 'inherited'. Delegates leaf read to jsonKey.
 */
export function readFlag(encoding: JsonKeyEncoding, settings: Json, keyPath: string[], name: string): Status {
	const node = resolveNested(settings, keyPath, false);
	if (!node) return 'inherited';
	return readJsonKey(node.parent, node.key, name, encoding);
}

/**
 * Write a per-name toggle flag into settings JSON, walking `keyPath` (auto-creating
 * intermediate objects). 'inherited' removes the per-name key; empty map cleans up.
 * Delegates leaf write to jsonKey.
 */
export function writeFlag(encoding: JsonKeyEncoding, settings: Json, keyPath: string[], name: string, status: Status): void {
	const node = resolveNested(settings, keyPath, true);
	if (!node) return;
	writeJsonKey(node.parent, node.key, name, status, encoding);
}

/**
 * Read a plugin manifest and normalize it into `Map<fullName, InstallRecord[]>`,
 * regardless of whether the on-disk `plugins` collection is an array (ZCode) or an
 * object map (Claude). The shape + id field come from the profile locator, so this
 * function holds no tool-specific knowledge.
 */
export function readRegistry(profile: ToolProfile): Map<string, InstallRecord[]> {
	const loc: PluginLocator = profile.plugins;
	const file = path.join(configRoot(profile), ...loc.dirRelative, loc.manifestFile);
	if (!fs.existsSync(file)) return new Map();
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return new Map();
	}
	const raw = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
		? (parsed as Json)['plugins']
		: undefined;
	const map = new Map<string, InstallRecord[]>();

	if (loc.manifestIsArray) {
		// Array form: each element is a record; id comes from `manifestIdField`.
		const idField = loc.manifestIdField ?? 'id';
		if (!Array.isArray(raw)) return map;
		for (const item of raw) {
			if (!item || typeof item !== 'object') continue;
			const r = item as Record<string, unknown>;
			const id = typeof r[idField] === 'string' ? (r[idField] as string) : undefined;
			if (!id) continue;
			map.set(id, [{
				installPath: typeof r['installPath'] === 'string' ? r['installPath'] : '',
				version: typeof r['version'] === 'string' ? r['version'] : null,
				scope: typeof r['scope'] === 'string' ? r['scope'] : undefined,
			}]);
		}
	} else {
		// Map form: keys are the ids, values are arrays of records.
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return map;
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			map.set(k, Array.isArray(v) ? (v as InstallRecord[]) : []);
		}
	}
	return map;
}
