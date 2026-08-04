// Project routes — ported from src-tauri/src/commands.rs list_projects / delete_project.

import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { decodeProjectFolder } from '../decode.js';
import { projectsDir } from '../paths.js';
import type { ProjectInfo } from '../model.js';

export const projects = new Hono();

/** Reject bare folder names containing path separators or traversal. */
function isValidEncoded(encoded: string): boolean {
	return encoded !== '' && !encoded.includes('/') && !encoded.includes('\\')
		&& !encoded.includes('..') && !encoded.includes('\0');
}

/** GET /api/projects — list all Claude Code projects (decoded from ~/.claude/projects/). */
projects.get('/', (c) => {
	const dir = projectsDir();
	const out: ProjectInfo[] = [];
	if (!fs.existsSync(dir)) return c.json(out);

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const encoded = entry.name;
		const folder = path.join(dir, encoded);
		const decoded = decodeProjectFolder(encoded);

		let sessionCount = 0;
		let newestMtime: number | null = null;
		try {
			for (const f of fs.readdirSync(folder, { withFileTypes: true })) {
				if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
				sessionCount += 1;
				try {
					const mt = fs.statSync(path.join(folder, f.name)).mtimeMs;
					if (newestMtime === null || mt > newestMtime) newestMtime = mt;
				} catch { /* skip */ }
			}
		} catch { /* skip */ }

		const hasSettings = fs.existsSync(path.join(decoded, '.claude', 'settings.json'));
		out.push({
			path: decoded,
			encoded,
			sessionCount,
			lastActivity: newestMtime === null ? null : new Date(newestMtime).toISOString(),
			hasSettings,
		});
	}

	// Sort by lastActivity descending; null/empty last.
	out.sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
	return c.json(out);
});

/** DELETE /api/projects/:encoded — delete session history folder only (never the real project). */
projects.delete('/:encoded', (c) => {
	const encoded = c.req.param('encoded');
	if (!isValidEncoded(encoded)) return c.json({ error: 'invalid project id' }, 400);

	const dir = projectsDir();
	const target = path.join(dir, encoded);

	// Canonicalize both and verify containment (defeats symlink tricks).
	let canonicalTarget: string;
	let canonicalBase: string;
	try {
		canonicalTarget = fs.realpathSync(target);
		canonicalBase = fs.realpathSync(dir);
	} catch {
		return c.json({ error: 'invalid project id' }, 400);
	}
	const sep = path.sep;
	const contained = canonicalTarget === canonicalBase
		|| canonicalTarget.startsWith(canonicalBase + sep);
	if (!contained) return c.json({ error: 'invalid project id' }, 400);

	try {
		fs.rmSync(canonicalTarget, { recursive: true });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true });
});
