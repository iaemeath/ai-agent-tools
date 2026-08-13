// Settings JSON read/write — ported from src-tauri/src/core/settings_io.rs + backup.rs.
// Key-preserving (SSOT-safe): writes the whole object, callers edit in place.
// Write format is pretty (2-space) with a trailing newline, matching serde_pretty + "\n".

import fs from 'node:fs';
import path from 'node:path';
import { projectSettings, userSettings } from './paths.js';
import { DEFAULT_PROFILE, type ToolProfile } from './profiles.js';

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

/**
 * Write a plain-text file (for editing raw markdown, etc.): mkdir -p parent, back up, write utf8.
 * Unlike write() this does NOT JSON-stringify — content is written verbatim.
 */
export function writeText(p: string, content: string): void {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	backupFile(p);
	fs.writeFileSync(p, content, 'utf8');
}

export function readUser(p: ToolProfile = DEFAULT_PROFILE): Json {
	return read(userSettings(p));
}
export function writeUser(p: ToolProfile, v: Json): void {
	write(userSettings(p), v);
}
export function readProject(project: string, p: ToolProfile = DEFAULT_PROFILE): Json {
	return read(projectSettings(project, p));
}
export function writeProject(project: string, p: ToolProfile, v: Json): void {
	write(projectSettings(project, p), v);
}
