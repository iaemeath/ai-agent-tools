// caselog pull — the incremental row-level extraction shared by the LOCAL sync (reads
// this machine's zcode db directly) and the REMOTE mirror command (remote/entry.ts
// 'caselog.pull', where the same function runs on the target host inside the bundle).
//
// Chunk model: sessions with time_updated > watermark, oldest first, at most `limit`
// per chunk; each chunk carries the session/message/part rows for exactly those
// sessions. The caller loops until done=true (keeping any single JSON hop modest).
//
// All sessions are pulled — including task_type='subagent_child' — the reading layer
// folds children into their parent like sessions-reader does.

import { DatabaseSync } from 'node:sqlite';
import type { RawSessionRow } from './types.js';

export interface PullMessageRow {
	id: string;
	session_id: string;
	sequence: number;
	data: string;
}

export interface PullPartRow {
	id: string;
	message_id: string;
	session_id: string;
	sequence: number;
	data: string;
}

export interface PullChunk {
	sessions: RawSessionRow[];
	messages: PullMessageRow[];
	parts: PullPartRow[];
	/** Next watermark: max time_updated of the pulled sessions (unchanged when empty). */
	watermark: number;
	/** True when no further sessions exist above the watermark (loop terminator). */
	done: boolean;
}

export const PULL_SESSION_LIMIT = 20;
/** First-fill floor: sessions older than 90 days are not mirrored by default. */
export const FILL_SINCE_MS = 90 * 24 * 3600 * 1000;

/** Extract one incremental chunk from a zcode session db (read-only connection). */
export function pullChunk(db: DatabaseSync, watermark: number, limit = PULL_SESSION_LIMIT, sinceMs = 0): PullChunk {
	const wm0 = Math.max(watermark, sinceMs);
	const sessions = db.prepare(
		`SELECT id, title, task_type, parent_id, time_created, time_updated
		FROM session WHERE time_updated > ? ORDER BY time_updated LIMIT ?`,
	).all(wm0, limit) as unknown as RawSessionRow[];

	if (sessions.length === 0) {
		return { sessions: [], messages: [], parts: [], watermark: wm0, done: true };
	}

	const ids = sessions.map((s) => s.id);
	const ph = ids.map(() => '?').join(',');
	const messages = db.prepare(
		`SELECT id, session_id, sequence, data FROM message WHERE session_id IN (${ph})`,
	).all(...ids) as unknown as PullMessageRow[];
	const parts = db.prepare(
		`SELECT id, message_id, session_id, sequence, data FROM part WHERE session_id IN (${ph})`,
	).all(...ids) as unknown as PullPartRow[];

	// message rows may exist for sessions whose own row time_updated didn't move; include
	// them by pulling parts of the fetched messages regardless (parts are keyed by session).
	const wm = Math.max(wm0, ...sessions.map((s) => s.time_updated ?? 0));
	return { sessions, messages, parts, watermark: wm, done: sessions.length < limit };
}
