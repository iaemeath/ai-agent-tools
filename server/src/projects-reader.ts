// Projects reader — tool-agnostic project discovery engine.
//
// Reads a tool's project list according to its ProjectsLocator declaration:
//   - fs:     scan dash-encoded session-history folders (Claude Code)
//   - sqlite: query a session table for distinct directories (ZCode)
//
// Adding a new tool whose projects live somewhere else = add a new locator variant
// here + one branch in each function. Callers (routes, decode) stay unchanged.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configRoot } from './paths.js';
import { projectSettings, homeDir } from './paths.js';
import { decodeProjectFolder } from './decode.js';
import type { ProjectsLocator, ToolProfile } from './profiles.js';
import type { ProjectInfo } from './model.js';

type Json = Record<string, unknown>;

/** Read a settings file as JSON; missing/parse error → {}. */
function readJson(p: string): Json {
	if (!fs.existsSync(p)) return {};
	try {
		const v = JSON.parse(fs.readFileSync(p, 'utf8'));
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
	} catch {
		return {};
	}
}

/**
 * List projects for a tool. Returns ProjectInfo[] sorted by lastActivity desc.
 * Each entry: { path, encoded, sessionCount, lastActivity, hasSettings }.
 */
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
export function listProjects(profile: ToolProfile): ProjectInfo[] {
	const loc = profile.projects;
	const raw = loc.source === 'fs' ? listFromFs(profile, loc) : listFromSqlite(profile, loc);
	const home = path.resolve(homeDir()).toLowerCase();
	return raw.filter((p) => path.resolve(p.path).toLowerCase() !== home);
}

/** fs source: scan dash-encoded folders under configRoot/<dirRelative>. */
function listFromFs(profile: ToolProfile, loc: Extract<ProjectsLocator, { source: 'fs' }>): ProjectInfo[] {
	const dir = path.join(configRoot(profile), loc.dirRelative);
	if (!fs.existsSync(dir)) return [];
	const out: ProjectInfo[] = [];
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

		const hasSettings = fs.existsSync(projectSettings(decoded, profile));
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
function listFromSqlite(profile: ToolProfile, loc: Extract<ProjectsLocator, { source: 'sqlite' }>): ProjectInfo[] {
	const dbPath = path.join(configRoot(profile), ...loc.dbRelative);
	if (!fs.existsSync(dbPath)) return [];
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
			const hasSettings = fs.existsSync(projectSettings(r.path, profile));
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
export function deleteProject(profile: ToolProfile, encoded: string): boolean {
	const loc = profile.projects;
	if (loc.source === 'fs') return deleteFromFs(profile, loc, encoded);
	return deleteFromSqlite(profile, loc, encoded);
}

function deleteFromFs(profile: ToolProfile, loc: Extract<ProjectsLocator, { source: 'fs' }>, encoded: string): boolean {
	const dir = path.join(configRoot(profile), loc.dirRelative);
	const target = path.join(dir, encoded);
	// Canonicalize + verify containment (defeats symlink tricks).
	let canonicalTarget: string;
	let canonicalBase: string;
	try {
		canonicalTarget = fs.realpathSync(target);
		canonicalBase = fs.realpathSync(dir);
	} catch {
		return false;
	}
	const sep = path.sep;
	const contained = canonicalTarget === canonicalBase || canonicalTarget.startsWith(canonicalBase + sep);
	if (!contained) return false;
	try {
		fs.rmSync(canonicalTarget, { recursive: true });
		return true;
	} catch {
		return false;
	}
}

function deleteFromSqlite(profile: ToolProfile, loc: Extract<ProjectsLocator, { source: 'sqlite' }>, encoded: string): boolean {
	const dbPath = path.join(configRoot(profile), ...loc.dbRelative);
	if (!fs.existsSync(dbPath)) return false;
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
