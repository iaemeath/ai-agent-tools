// Projects reader — tool-agnostic project discovery engine.
//
// Reads a tool's project list according to its ProjectsLocator declaration:
//   - fs:     scan dash-encoded session-history folders (Claude Code)
//   - sqlite: query a session table for distinct directories (ZCode)
//
// Adding a new tool whose projects live somewhere else = add a new locator variant
// here + one branch in each function. Callers (routes, decode) stay unchanged.

import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configRoot, projectSettings, homeDir } from './paths.js';
import { decodeProjectFolder } from './decode.js';
import { getFs } from './hosts/context.js';
import type { ProjectsLocator, ToolProfile } from './profiles.js';
import type { ProjectInfo } from './model.js';

/**
 * List projects for a tool. Returns ProjectInfo[] sorted by lastActivity desc.
 * Each entry: { path, encoded, sessionCount, lastActivity, hasSettings }.
 *
 * The HOME directory itself is always excluded: when a tool runs with cwd=home,
 * session history records an entry whose path IS the home dir, and <home>/.<tool>/
 * is the GLOBAL config root — so treating home as a "project" double-counts every
 * global resource (skills/agents/commands/rules/hooks/instructions/mcps/settings)
 * as project-level and clutters the Projects page. Filtering once here keeps every
 * caller (Projects page + all resource readers + skills adapter) consistent.
 */
export async function listProjects(profile: ToolProfile): Promise<ProjectInfo[]> {
	const loc = profile.projects;
	const raw = loc.source === 'fs' ? await listFromFs(profile, loc) : await listFromSqlite(profile, loc);
	const home = path.resolve(homeDir()).toLowerCase();
	return raw.filter((p) => path.resolve(p.path).toLowerCase() !== home);
}

/** fs source: scan dash-encoded folders under configRoot/<dirRelative>. */
async function listFromFs(profile: ToolProfile, loc: Extract<ProjectsLocator, { source: 'fs' }>): Promise<ProjectInfo[]> {
	const dir = path.join(configRoot(profile), loc.dirRelative);
	if (!(await getFs().exists(dir))) return [];
	const out: ProjectInfo[] = [];
	for (const entry of await getFs().readDir(dir)) {
		if (!entry.isDirectory) continue;
		const encoded = entry.name;
		const folder = path.join(dir, encoded);
		const decoded = await decodeProjectFolder(encoded);

		let sessionCount = 0;
		let newestMtime: number | null = null;
		try {
			for (const f of await getFs().readDir(folder)) {
				if (!f.isFile || !f.name.endsWith('.jsonl')) continue;
				sessionCount += 1;
				try {
					const mt = (await getFs().stat(path.join(folder, f.name))).mtimeMs;
					if (newestMtime === null || mt > newestMtime) newestMtime = mt;
				} catch { /* skip */ }
			}
		} catch { /* skip */ }

		const hasSettings = await getFs().exists(projectSettings(decoded, profile));
		out.push({
			path: decoded,
			encoded,
			sessionCount,
			lastActivity: newestMtime === null ? null : new Date(newestMtime).toISOString(),
			hasSettings,
		});
	}
	out.sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
	return out;
}

/** sqlite source: query distinct directories + session counts + max activity time. */
async function listFromSqlite(profile: ToolProfile, loc: Extract<ProjectsLocator, { source: 'sqlite' }>): Promise<ProjectInfo[]> {
	const dbPath = path.join(configRoot(profile), ...loc.dbRelative);
	if (!(await getFs().exists(dbPath))) return [];
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
	} catch {
		return [];
	}
	try {
		// Safe identifier check — column/table names are injected into SQL.
		const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
		if (!ident.test(loc.table) || !ident.test(loc.pathColumn) || !ident.test(loc.timeColumn)) return [];
		const sql = `SELECT "${loc.pathColumn}" AS path, COUNT(*) AS cnt, MAX("${loc.timeColumn}") AS last
			FROM "${loc.table}" WHERE "${loc.pathColumn}" IS NOT NULL
			GROUP BY "${loc.pathColumn}" ORDER BY cnt DESC`;
		const rows = db.prepare(sql).all() as { path: string; cnt: number; last: number | null }[];
		const out: ProjectInfo[] = [];
		for (const r of rows) {
			// ZCode stores real paths directly; encoded = path for compatibility with the delete API.
			const hasSettings = await getFs().exists(projectSettings(r.path, profile));
			out.push({
				path: r.path,
				encoded: r.path,
				sessionCount: r.cnt,
				lastActivity: r.last === null ? null : new Date(r.last).toISOString(),
				hasSettings,
			});
		}
		out.sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
		return out;
	} finally {
		db.close();
	}
}

/**
 * Delete a project's session history.
 * - fs:     remove the encoded folder under configRoot/<dirRelative>/<encoded>.
 * - sqlite: delete rows where pathColumn = encoded (encoded IS the real path for sqlite).
 * Returns true if anything was removed.
 */
export async function deleteProject(profile: ToolProfile, encoded: string): Promise<boolean> {
	const loc = profile.projects;
	if (loc.source === 'fs') return deleteFromFs(profile, loc, encoded);
	return deleteFromSqlite(profile, loc, encoded);
}

async function deleteFromFs(profile: ToolProfile, loc: Extract<ProjectsLocator, { source: 'fs' }>, encoded: string): Promise<boolean> {
	const dir = path.join(configRoot(profile), loc.dirRelative);
	const target = path.join(dir, encoded);
	// Canonicalize + verify containment (defeats symlink tricks).
	let canonicalTarget: string;
	let canonicalBase: string;
	try {
		canonicalTarget = await getFs().realpath(target);
		canonicalBase = await getFs().realpath(dir);
	} catch {
		return false;
	}
	const sep = path.sep;
	const contained = canonicalTarget === canonicalBase || canonicalTarget.startsWith(canonicalBase + sep);
	if (!contained) return false;
	try {
		await getFs().remove(canonicalTarget, { recursive: true });
		return true;
	} catch {
		return false;
	}
}

async function deleteFromSqlite(profile: ToolProfile, loc: Extract<ProjectsLocator, { source: 'sqlite' }>, encoded: string): Promise<boolean> {
	const dbPath = path.join(configRoot(profile), ...loc.dbRelative);
	if (!(await getFs().exists(dbPath))) return false;
	// encoded is the real path for sqlite tools.
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(dbPath);
	} catch {
		return false;
	}
	try {
		const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
		if (!ident.test(loc.table) || !ident.test(loc.pathColumn)) return false;
		const sql = `DELETE FROM "${loc.table}" WHERE "${loc.pathColumn}" = ?`;
		const info = db.prepare(sql).run(encoded);
		return info.changes > 0;
	} finally {
		db.close();
	}
}
