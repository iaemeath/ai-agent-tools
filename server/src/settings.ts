// Settings JSON read/write — ported from src-tauri/src/core/settings_io.rs + backup.rs.
// Key-preserving (SSOT-safe): writes the whole object, callers edit in place.
// Write format is pretty (2-space) with a trailing newline, matching serde_pretty + "\n".

import path from 'node:path';
import { projectSettings, userSettings } from './paths.js';
import { DEFAULT_PROFILE, type ToolProfile } from './profiles.js';
import { getFs } from './hosts/context.js';

type Json = Record<string, unknown>;

/**
 * Read a settings file as a JSON object. Missing file or parse error → {}.
 * (Rust swallowed errors and returned {} — never throws.)
 */
export async function read(p: string): Promise<Json> {
	if (!(await getFs().exists(p))) return {};
	try {
		const raw = await getFs().readFile(p);
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Json)
			: {};
	} catch {
		return {};
	}
}

/**
 * Backup a file before overwriting: copies to `<name>.<ext>.bak` (e.g. settings.json →
 * settings.json.bak). Overwrites any existing backup (keeps exactly 1). Missing file → no-op.
 * Copy failure is logged and swallowed (never blocks the write).
 */
export async function backupFile(p: string): Promise<void> {
	if (!(await getFs().exists(p))) return;
	const parsed = path.parse(p);
	const bakName = parsed.ext ? `${parsed.name}${parsed.ext}.bak` : `${parsed.base}.bak`;
	const bakPath = path.join(parsed.dir, bakName);
	try {
		await getFs().copyFile(p, bakPath);
	} catch (e) {
		console.warn(`[backup] failed to back up ${p}: ${(e as Error).message}`);
	}
}

/**
 * Write a settings object: mkdir -p parent, back up, pretty-print (2-space) + trailing "\n".
 * Uses atomicWrite (tmp+rename) so a crash mid-write never leaves a truncated settings.json.
 */
export async function write(p: string, value: Json): Promise<void> {
	const parent = path.dirname(p);
	await getFs().mkdir(parent, { recursive: true });
	await backupFile(p);
	await getFs().atomicWrite(p, JSON.stringify(value, null, 2) + '\n');
}

/**
 * Write a plain-text file (for editing raw markdown, etc.): mkdir -p parent, back up, write utf8.
 * Unlike write() this does NOT JSON-stringify — content is written verbatim. Atomic (tmp+rename).
 */
export async function writeText(p: string, content: string): Promise<void> {
	await getFs().mkdir(path.dirname(p), { recursive: true });
	await backupFile(p);
	await getFs().atomicWrite(p, content);
}

export async function readUser(p: ToolProfile = DEFAULT_PROFILE): Promise<Json> {
	return read(userSettings(p));
}
export async function writeUser(p: ToolProfile, v: Json): Promise<void> {
	await write(userSettings(p), v);
}
export async function readProject(project: string, p: ToolProfile = DEFAULT_PROFILE): Promise<Json> {
	return read(projectSettings(project, p));
}
export async function writeProject(project: string, p: ToolProfile, v: Json): Promise<void> {
	await write(projectSettings(project, p), v);
}
