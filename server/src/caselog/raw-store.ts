// caselog raw store — per-host session mirrors under <KB_ROOT>/raw/<hostId>.sqlite.
// KB_ROOT defaults to <dataRoot>/caselog (i.e. ~/.ai-tools/caselog; wholesale-migrated
// from the pre-rename ~/.knowledge by data-dir.ts), CASELOG_KB_ROOT env overrides.
//
// Each mirror holds a subset of the source db (session / message / part rows plus a
// meta table for the sync watermark). Sessions are upserted whole (a session's row set
// changes on compaction/append, so no row-level diff). The reading layer parses rows
// through the shared transcript-parser, identical to sessions-reader's sqlite path.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseSqliteMessages, type ParsedTranscript } from '../transcript-parser.js';
import { dataRoot } from '../data-dir.js';
import type { CaselogFlow, CaselogSessionRead, RawHostStat, RawProjectStat, RawSessionRow, RawSessionSummary } from './types.js';

export const KB_ROOT = process.env['CASELOG_KB_ROOT'] ?? path.join(dataRoot(), 'caselog');

function rawDir(): string {
	return path.join(KB_ROOT, 'raw');
}

export function notesDir(): string {
	return path.join(KB_ROOT, 'notes');
}

/** Filesystem-safe host id ([a-z0-9-]) — raw files are named after it. */
export function isValidHostId(id: string): boolean {
	return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

export function rawPath(hostId: string): string {
	return path.join(rawDir(), `${hostId}.sqlite`);
}

/** Open (and schema-ensure) a host mirror; null when absent and create=false. */
export function openRaw(hostId: string, create = false): DatabaseSync | null {
	const file = rawPath(hostId);
	if (!create && !fs.existsSync(file)) return null;
	fs.mkdirSync(rawDir(), { recursive: true });
	const db = new DatabaseSync(file);
	db.exec(`
		CREATE TABLE IF NOT EXISTS session (
			id TEXT PRIMARY KEY, title TEXT, task_type TEXT, parent_id TEXT,
			project TEXT, time_created INTEGER, time_updated INTEGER);
		CREATE TABLE IF NOT EXISTS message (
			id TEXT PRIMARY KEY, session_id TEXT, sequence INTEGER, data TEXT);
		CREATE TABLE IF NOT EXISTS part (
			id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, sequence INTEGER, data TEXT);
		CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id);
		CREATE INDEX IF NOT EXISTS idx_part_session ON part(session_id);
		CREATE INDEX IF NOT EXISTS idx_part_message ON part(message_id);
		CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
	`);
	// mirrors created before the project column existed: plain ALTER ADD + reset the sync
	// watermark so the next sync re-pulls (within the 90-day floor) and backfills project
	const cols = db.prepare("SELECT name FROM pragma_table_info('session')").all() as { name: string }[];
	if (!cols.some((c) => c.name === 'project')) {
		db.exec('ALTER TABLE session ADD COLUMN project TEXT');
		db.prepare("DELETE FROM meta WHERE k = 'watermark'").run();
	}
	return db;
}

export function getWatermark(db: DatabaseSync): number {
	const r = db.prepare('SELECT v FROM meta WHERE k = ?').get('watermark') as { v: string } | undefined;
	return r ? Number(r.v) || 0 : 0;
}

export function setWatermark(db: DatabaseSync, wm: number): void {
	db.prepare(
		'INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
	).run('watermark', String(wm));
}

/** Upsert one pull chunk into the host mirror (whole-session replace per touched session). */
export function applyPull(
	db: DatabaseSync,
	chunk: { sessions: RawSessionRow[]; messages: { id: string; session_id: string; sequence: number; data: string }[]; parts: { id: string; message_id: string; session_id: string; sequence: number; data: string }[] },
): void {
	const tx = db.prepare('BEGIN');
	tx.run();
	try {
		const upS = db.prepare(
			'INSERT INTO session(id, title, task_type, parent_id, project, time_created, time_updated) VALUES(?,?,?,?,?,?,?) ' +
			'ON CONFLICT(id) DO UPDATE SET title=excluded.title, task_type=excluded.task_type, ' +
			'parent_id=excluded.parent_id, project=excluded.project, time_created=excluded.time_created, time_updated=excluded.time_updated');
		const delM = db.prepare('DELETE FROM message WHERE session_id = ?');
		const delP = db.prepare('DELETE FROM part WHERE session_id = ?');
		const upM = db.prepare('INSERT OR REPLACE INTO message(id, session_id, sequence, data) VALUES(?,?,?,?)');
		const upP = db.prepare('INSERT OR REPLACE INTO part(id, message_id, session_id, sequence, data) VALUES(?,?,?,?,?)');
		for (const s of chunk.sessions) {
			upS.run(s.id, s.title, s.task_type, s.parent_id, s.project ?? null, s.time_created, s.time_updated);
			// whole-session replace: compaction may have deleted rows we'd otherwise keep
			delM.run(s.id);
			delP.run(s.id);
		}
		for (const m of chunk.messages) upM.run(m.id, m.session_id, m.sequence, m.data);
		for (const p of chunk.parts) upP.run(p.id, p.message_id, p.session_id, p.sequence, p.data);
		db.prepare('COMMIT').run();
	} catch (e) {
		db.prepare('ROLLBACK').run();
		throw e;
	}
}

/** Host ids that have a mirror on disk. */
export function mirroredHosts(): string[] {
	if (!fs.existsSync(rawDir())) return [];
	return fs.readdirSync(rawDir())
		.filter((n) => n.endsWith('.sqlite'))
		.map((n) => n.slice(0, -'.sqlite'.length));
}

function msToIso(ms: number | null | undefined): string | null {
	return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null;
}

function toSummary(host: string, r: RawSessionRow & { mc: number }): RawSessionSummary {
	return { host, id: r.id, title: r.title, task_type: r.task_type, parent_id: r.parent_id, project: r.project ?? null, time_created: r.time_created, time_updated: r.time_updated, hasTranscript: r.mc > 0 };
}

/** List sessions across mirrors (or one host, optionally one project). Subagent children folded. */
export function listRawSessions(host?: string, project?: string): RawSessionSummary[] {
	const hosts = host ? [host] : mirroredHosts();
	const out: RawSessionSummary[] = [];
	for (const h of hosts) {
		if (!isValidHostId(h)) continue;
		const db = openRaw(h);
		if (!db) continue;
		try {
			const rows = db.prepare(
				`SELECT s.id, s.title, s.task_type, s.parent_id, s.project, s.time_created, s.time_updated,
				(SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS mc
				FROM session s
				WHERE (s.task_type IS NULL OR s.task_type != 'subagent_child') AND (? IS NULL OR s.project = ?)
				ORDER BY s.time_updated DESC`,
			).all(project ?? null, project ?? null) as unknown as (RawSessionRow & { mc: number })[];
			for (const r of rows) out.push(toSummary(h, r));
		} finally {
			db.close();
		}
	}
	out.sort((a, b) => (b.time_updated ?? 0) - (a.time_updated ?? 0));
	return out;
}

/** Data-tab overview: per-host → per-project session counts + today's new (local midnight). */
export function hostStats(): RawHostStat[] {
	const startOfToday = new Date();
	startOfToday.setHours(0, 0, 0, 0);
	const todayMs = startOfToday.getTime();
	const out: RawHostStat[] = [];
	for (const h of mirroredHosts()) {
		if (!isValidHostId(h)) continue;
		const db = openRaw(h);
		if (!db) continue;
		try {
			const rows = db.prepare(
				`SELECT project, COUNT(*) AS total,
				SUM(CASE WHEN time_created >= ? THEN 1 ELSE 0 END) AS today
				FROM session WHERE task_type IS NULL OR task_type != 'subagent_child'
				GROUP BY project ORDER BY total DESC`,
			).all(todayMs) as unknown as { project: string | null; total: number; today: number | null }[];
			const projects: RawProjectStat[] = rows.map((r) => ({
				project: r.project ?? '(unknown)',
				total: r.total,
				today: r.today ?? 0,
			}));
			out.push({
				host: h,
				projects,
				total: projects.reduce((n, p) => n + p.total, 0),
				today: projects.reduce((n, p) => n + p.today, 0),
			});
		} finally {
			db.close();
		}
	}
	return out;
}

/** Parse one session's message+part rows from a mirror into a flow (null when empty). */
function flowFromRows(db: DatabaseSync, sessionId: string, kind: 'main' | 'subagent', description: string, startedAt: string | null): CaselogFlow | null {
	const rows = db.prepare(
		`SELECT m.sequence AS ms, m.data AS md, p.data AS pd, p.sequence AS ps
		FROM message m LEFT JOIN part p ON p.message_id = m.id
		WHERE m.session_id = ? ORDER BY m.sequence, p.sequence`,
	).all(sessionId) as { ms: number; md: string; pd: string | null; ps: number }[];
	const parsed: ParsedTranscript = parseSqliteMessages(rows);
	if (parsed.turns.length === 0) return null;
	return {
		id: `${sessionId}__${kind}`,
		kind,
		description,
		startedAt,
		turns: parsed.turns,
		stats: parsed.stats,
	};
}

/** Read one session from a mirror: index row + main flow + subagent child flows. */
export function readRawSession(host: string, sessionId: string): CaselogSessionRead | null {
	if (!isValidHostId(host)) return null;
	const db = openRaw(host);
	if (!db) return null;
	try {
		const row = db.prepare(
			'SELECT id, title, task_type, parent_id, project, time_created, time_updated FROM session WHERE id = ?',
		).get(sessionId) as RawSessionRow | undefined;
		if (!row) return null;
		const main = flowFromRows(db, sessionId, 'main', row.title ?? '', msToIso(row.time_created));
		const children = db.prepare(
			`SELECT id, title, time_created FROM session
			WHERE parent_id = ? AND task_type = 'subagent_child' ORDER BY time_created`,
		).all(sessionId) as { id: string; title: string | null; time_created: number | null }[];
		const subagents: CaselogFlow[] = [];
		for (const c of children) {
			const flow = flowFromRows(db, c.id, 'subagent', c.title ?? '', msToIso(c.time_created));
			if (flow) subagents.push(flow);
		}
		if (!main && subagents.length === 0) return null;
		return { host, session: row, main, subagents };
	} finally {
		db.close();
	}
}
