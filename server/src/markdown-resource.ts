// Shared helpers for directory-based markdown resources (rules / commands / agents).
//
// These three resources share the exact same shape: a directory of *.md files,
// optional YAML frontmatter, global + per-project scope, read-only. The only
// per-resource difference is the typed Info interface they populate, so this
// module owns the directory scan + frontmatter parse + line count, and each
// reader supplies its own `makeInfo` to map a found file into its Info type.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Scan one directory for *.md files and append an Info entry per file via
 * `makeInfo`. Non-existent / unreadable dirs are skipped gracefully (no throw).
 */
export function scanMarkdownDir<T>(
	dir: string,
	scope: 'global' | 'project',
	project: string | null,
	out: T[],
	makeInfo: (fullPath: string, name: string, scope: 'global' | 'project', project: string | null) => T,
): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return; // dir does not exist or unreadable — skip gracefully
	}
	for (const e of entries) {
		if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue;
		const fullPath = path.join(dir, e.name);
		out.push(makeInfo(fullPath, e.name, scope, project));
	}
}

/**
 * Extract a single field from a YAML frontmatter block (if present).
 * Supports inline values and folded/literal block scalars (>- / |).
 * Used by readers to pull `description` (and could pull any other field).
 */
export function parseFrontmatterField(filePath: string, field: string): string | undefined {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch {
		return undefined;
	}
	if (!raw.startsWith('---')) return undefined;
	const lines = raw.split('\n').slice(1);
	const re = new RegExp(`^${field}:\\s*(.*)$`);
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === '---') break;
		const m = lines[i].match(re);
		if (!m) continue;
		const inline = m[1].trim();
		// Inline value (not a block scalar indicator).
		if (inline && !/^[>|]/.test(inline)) {
			return inline.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '') || undefined;
		}
		// Folded/literal block scalar: collect following indented lines.
		const collected: string[] = [];
		for (let j = i + 1; j < lines.length; j++) {
			const ln = lines[j];
			if (ln.trim() === '---') break;
			if (ln.startsWith(' ') || ln.startsWith('\t')) collected.push(ln.trim());
			else if (ln.trim() === '') continue;
			else break;
		}
		return collected.join(' ') || undefined;
	}
	return undefined;
}

/** Line count of a file (0 if empty/unreadable). */
export function countLines(p: string): number {
	try {
		return fs.readFileSync(p, 'utf8').split('\n').length;
	} catch {
		return 0;
	}
}

/** Read a file's text content (utf8), or null if unreadable. */
export function readFileText(p: string): string | null {
	try {
		return fs.readFileSync(p, 'utf8');
	} catch {
		return null;
	}
}

/**
 * Remove entries with duplicate keys, keeping the first occurrence.
 *
 * The markdown/config readers scan the global dir first, then each project's dir.
 * When the HOME directory itself appears as a "project" in session history (e.g.
 * Claude's `C--Users-Administrator` folder), its `<home>/.<tool>/<dir>` IS the global
 * dir — so the same files get collected twice (once as global, once as that project).
 * Deduping by file path (or hook id) collapses the duplicate, keeping the
 * first-seen (global) entry so the item isn't wrongly shown under a project group.
 */
export function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of items) {
		const key = keyOf(item);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}
