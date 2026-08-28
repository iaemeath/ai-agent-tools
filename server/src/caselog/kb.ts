// caselog kb — knowledge.db (scenarios / scenario_sessions / review_log) + the notes/
// MD store. Scenario writes are the human-confirmed single write channel (R5/C2);
// the AI-post polish stage is a later addition and will only ever produce CANDIDATES
// — this file is where confirm lands. Notes are a separate capture channel (v3.3 §1)
// with deliberately no paste gate: excerpting session content is the point there.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { KB_ROOT, notesDir } from './raw-store.js';
import type { ReviewEntry, Scenario, ScenarioPointer } from './types.js';

export interface ScenarioInput {
	title: string;
	keywords: string;
	content: string;
	category: string;
	pointers: Omit<ScenarioPointer, 'notedAt'>[];
}

function kbPath(): string {
	return path.join(KB_ROOT, 'knowledge.db');
}

function openKb(): DatabaseSync {
	fs.mkdirSync(KB_ROOT, { recursive: true });
	const db = new DatabaseSync(kbPath());
	db.exec(`
		CREATE TABLE IF NOT EXISTS scenarios (
			id TEXT PRIMARY KEY, uuid TEXT, title TEXT NOT NULL, keywords TEXT DEFAULT '',
			content TEXT DEFAULT '', category TEXT DEFAULT '', source TEXT DEFAULT 'manual',
			edited_count INTEGER DEFAULT 0, edited_at TEXT,
			created_at TEXT, updated_at TEXT, deleted_at TEXT);
		CREATE TABLE IF NOT EXISTS scenario_sessions (
			scenario_id TEXT, host TEXT, session_id TEXT, agent_id TEXT DEFAULT '',
			seq_range TEXT DEFAULT '', noted_at TEXT);
		CREATE TABLE IF NOT EXISTS review_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT, scenario_id TEXT, reviewed_at TEXT,
			outcome TEXT, recalled_note TEXT DEFAULT '', note TEXT DEFAULT '');
	`);
	return db;
}

function loadPointers(db: DatabaseSync, scenarioId: string): ScenarioPointer[] {
	return (db.prepare(
		'SELECT host, session_id AS sessionId, agent_id AS agentId, seq_range AS seqRange, noted_at AS notedAt ' +
		'FROM scenario_sessions WHERE scenario_id = ? ORDER BY noted_at',
	).all(scenarioId) as unknown) as ScenarioPointer[];
}

/** Save a scenario (human-confirm write point). Also used for edits via id. */
export function saveScenario(input: ScenarioInput, id?: string): Scenario {
	const db = openKb();
	try {
		const now = new Date().toISOString();
		const sid = id ?? crypto.randomUUID();
		const tx = db.prepare('BEGIN');
		tx.run();
		try {
			if (id) {
				db.prepare(
					'UPDATE scenarios SET title=?, keywords=?, content=?, category=?, ' +
					'edited_count=edited_count+1, edited_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL',
				).run(input.title, input.keywords, input.content, input.category, now, now, id);
				db.prepare('DELETE FROM scenario_sessions WHERE scenario_id = ?').run(id);
			} else {
				db.prepare(
					'INSERT INTO scenarios(id, uuid, title, keywords, content, category, source, created_at, updated_at) ' +
					'VALUES(?,?,?,?,?,?,?, ?, ?)',
				).run(sid, crypto.randomUUID(), input.title, input.keywords, input.content, input.category, 'manual', now, now);
			}
			const upP = db.prepare(
				'INSERT INTO scenario_sessions(scenario_id, host, session_id, agent_id, seq_range, noted_at) VALUES(?,?,?,?,?,?)');
			for (const p of input.pointers) {
				upP.run(sid, p.host, p.sessionId, p.agentId, p.seqRange, now);
			}
			db.prepare('COMMIT').run();
		} catch (e) {
			db.prepare('ROLLBACK').run();
			throw e;
		}
		return getScenario(sid)!;
	} finally {
		db.close();
	}
}

export function getScenario(id: string): Scenario | null {
	const db = openKb();
	try {
		const r = db.prepare('SELECT * FROM scenarios WHERE id = ? AND deleted_at IS NULL').get(id) as Record<string, unknown> | undefined;
		if (!r) return null;
		return { ...toScenario(r), pointers: loadPointers(db, id) };
	} finally {
		db.close();
	}
}

function toScenario(r: Record<string, unknown>): Scenario {
	return {
		id: String(r['id']),
		title: String(r['title'] ?? ''),
		keywords: String(r['keywords'] ?? ''),
		content: String(r['content'] ?? ''),
		category: String(r['category'] ?? ''),
		source: String(r['source'] ?? 'manual'),
		editedCount: Number(r['edited_count'] ?? 0),
		editedAt: (r['edited_at'] as string | null) ?? null,
		createdAt: String(r['created_at'] ?? ''),
		updatedAt: String(r['updated_at'] ?? ''),
		pointers: [],
	};
}

export function listScenarios(): Scenario[] {
	const db = openKb();
	try {
		const rows = db.prepare(
			'SELECT * FROM scenarios WHERE deleted_at IS NULL ORDER BY created_at DESC',
		).all() as unknown as Record<string, unknown>[];
		return rows.map((r) => ({ ...toScenario(r), pointers: loadPointers(db, String(r['id'])) }));
	} finally {
		db.close();
	}
}

export function softDeleteScenario(id: string): boolean {
	const db = openKb();
	try {
		const r = db.prepare('UPDATE scenarios SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
			.run(new Date().toISOString(), id);
		return r.changes > 0;
	} finally {
		db.close();
	}
}

export function logReview(entry: ReviewEntry): void {
	const db = openKb();
	try {
		db.prepare(
			'INSERT INTO review_log(scenario_id, reviewed_at, outcome, recalled_note, note) VALUES(?,?,?,?,?)',
		).run(entry.scenarioId, entry.reviewedAt, entry.outcome, entry.recalledNote, entry.note);
	} finally {
		db.close();
	}
}

// ------------------------------------------------ notes (capture channel → Obsidian)

const NOTE_NAME_RE = /^[\w\-\u4e00-\u9fa5][\w\-.\u4e00-\u9fa5]{0,79}$/;

export function isValidNoteName(name: string): boolean {
	return NOTE_NAME_RE.test(name) && !name.includes('..');
}

export function listNotes(): { name: string; size: number; mtime: string }[] {
	fs.mkdirSync(notesDir(), { recursive: true });
	return fs.readdirSync(notesDir())
		.filter((n) => n.toLowerCase().endsWith('.md'))
		.map((n) => {
			const st = fs.statSync(path.join(notesDir(), n));
			return { name: n, size: st.size, mtime: new Date(st.mtimeMs).toISOString() };
		})
		.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function readNote(name: string): string | null {
	if (!isValidNoteName(name)) return null;
	const file = path.join(notesDir(), name);
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export function saveNote(name: string, content: string): boolean {
	if (!isValidNoteName(name)) return false;
	fs.mkdirSync(notesDir(), { recursive: true });
	fs.writeFileSync(path.join(notesDir(), name), content, 'utf8');
	return true;
}

export function deleteNote(name: string): boolean {
	if (!isValidNoteName(name)) return false;
	const file = path.join(notesDir(), name);
	if (!fs.existsSync(file)) return false;
	fs.unlinkSync(file);
	return true;
}

/**
 * Export notes to the configured Obsidian vault dir (CASELOG_OBSIDIAN_DIR). Copies the
 * given note, or every note when name is omitted. Returns copied file paths; empty
 * array when the vault dir is not configured or missing.
 */
export function exportNotes(name?: string): string[] {
	const vault = process.env['CASELOG_OBSIDIAN_DIR'];
	if (!vault || !fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) return [];
	const src = name ? [name] : listNotes().map((n) => n.name);
	const copied: string[] = [];
	for (const n of src) {
		if (!isValidNoteName(n)) continue;
		const from = path.join(notesDir(), n);
		if (!fs.existsSync(from)) continue;
		const to = path.join(vault, n);
		fs.copyFileSync(from, to);
		copied.push(to);
	}
	return copied;
}
