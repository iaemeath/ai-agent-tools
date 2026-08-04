// Settings JSON read/write — ported from src-tauri/src/core/settings_io.rs + backup.rs.
// Key-preserving (SSOT-safe): writes the whole object, callers edit in place.
// Write format is pretty (2-space) with a trailing newline, matching serde_pretty + "\n".

import fs from 'node:fs';
import path from 'node:path';
import { projectSettings, userSettings } from './paths.js';

type Json = Record<string, unknown>;

/**
 * Read a settings file as a JSON object. Missing file or parse error → {}.
 * (Rust swallowed errors and returned {} — never throws.)
 */
export function read(p: string): Json {
	if (!fs.existsSync(p)) return {};
	try {
		const raw = fs.readFileSync(p, 'utf8');
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
export function backupFile(p: string): void {
	if (!fs.existsSync(p)) return;
	const parsed = path.parse(p);
	const bakName = parsed.ext ? `${parsed.name}${parsed.ext}.bak` : `${parsed.base}.bak`;
	const bakPath = path.join(parsed.dir, bakName);
	try {
		fs.copyFileSync(p, bakPath);
	} catch (e) {
		console.warn(`[backup] failed to back up ${p}: ${(e as Error).message}`);
	}
}

/**
 * Write a settings object: mkdir -p parent, back up, pretty-print (2-space) + trailing "\n".
 */
export function write(p: string, value: Json): void {
	const parent = path.dirname(p);
	fs.mkdirSync(parent, { recursive: true });
	backupFile(p);
	fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function readUser(): Json {
	return read(userSettings());
}
export function writeUser(v: Json): void {
	write(userSettings(), v);
}
export function readProject(project: string): Json {
	return read(projectSettings(project));
}
export function writeProject(project: string, v: Json): void {
	write(projectSettings(project), v);
}
