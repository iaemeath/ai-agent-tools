// Sessions reader — session-history listing + full-session reading (read-only).
//
// Tool-agnostic entry points (listSessions / readSession) that dispatch on the
// profile's TranscriptLocator. Two modeled layouts:
//   zcode-transcripts — the sqlite session table (already located by the projects
//   locator) is the INDEX; turn CONTENT comes from two sibling stores:
//     rollout/model-io-<sessionId>.jsonl            main-session model IO
//     agents/<sessionId>/agent_*/transcript.jsonl   subagent runs (with thinking)
//   claude-jsonl — <configRoot>/projects/<dash-encoded-cwd>/<session-uuid>.jsonl
//   holds the whole conversation per session (index title = ai-title lines; Task
//   subagents are inline isSidechain lines, parsed into a merged sidechain flow).
//
// All file access goes through the FsBackend (getFs), and parsing is delegated to
// the pure transcript-parser — so the remote-exec mirror works unchanged.

import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { configRoot } from './paths.js';
import { decodeProjectFolder } from './decode.js';
import { getFs } from './hosts/context.js';
import { parseAgentTranscript, parseClaudeTranscript, parseRollout, parseSqliteMessages } from './transcript-parser.js';
import type { ToolProfile, TranscriptLocator } from './profiles.js';
import type { SessionFlow, SessionRead, SessionSummary } from './model.js';

/** Session ids we accept from clients: zcode "sess_*" or a bare UUID (claude) — defeats traversal. */
const SESSION_ID_RE = /^(sess_[A-Za-z0-9_-]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export function isValidSessionId(id: string): boolean {
	return SESSION_ID_RE.test(id);
}

/** ms-epoch (sqlite) → ISO string; null for null/invalid. */
function msToIso(ms: unknown): string | null {
	if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
	return new Date(ms).toISOString();
}

/** List a project's top-level sessions (subagent children are folded into the read view). */
export async function listSessions(profile: ToolProfile, projectPath: string): Promise<SessionSummary[]> {
	const loc = profile.transcripts;
	if (!loc) return [];
	if (loc.source === 'claude-jsonl') return listClaudeSessions(profile, loc, projectPath);
	if (loc.source === 'dsh-zstd') return listDshSessions(profile, loc, projectPath);
	if (loc.source !== 'zcode-transcripts') return [];
	const proj = profile.projects;
	if (proj.source !== 'sqlite') return [];
	const dbPath = path.join(configRoot(profile), ...proj.dbRelative);
	if (!(await getFs().exists(dbPath))) return [];

	let db: DatabaseSync;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
	} catch {
		return [];
	}
	try {
		const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
		if (!ident.test(proj.table) || !ident.test(proj.pathColumn)) return [];
		// Everything user-facing is listed (interactive / fork / selection_side_chat);
		// only subagent_child rows are folded into their parent's reading view.
		const sql = `SELECT id, title, task_type, parent_id, time_created, time_updated
			FROM "${proj.table}" WHERE "${proj.pathColumn}" = ? AND (task_type IS NULL OR task_type != 'subagent_child')
			ORDER BY time_updated DESC`;
		const rows = db.prepare(sql).all(projectPath) as {
			id: string; title: string | null; task_type: string | null; parent_id: string | null;
			time_created: number | null; time_updated: number | null;
		}[];
		const out: SessionSummary[] = [];
		for (const r of rows) {
			if (!isValidSessionId(r.id)) continue;
			out.push({
				id: r.id,
				title: r.title,
				taskType: r.task_type,
				parentId: r.parent_id,
				timeCreated: msToIso(r.time_created),
				timeUpdated: msToIso(r.time_updated),
				hasTranscript: await sessionHasTranscript(profile, r.id),
			});
		}
		return out;
	} finally {
		db.close();
	}
}

/** True when any transcript content exists: sqlite message rows, rollout file, or agents dir. */
async function sessionHasTranscript(profile: ToolProfile, sessionId: string): Promise<boolean> {
	const loc = profile.transcripts;
	if (!loc || loc.source !== 'zcode-transcripts') return false;
	if (await sessionMessageCount(profile, sessionId) > 0) return true;
	const fs = getFs();
	if (await fs.exists(rolloutPath(profile, loc, sessionId))) return true;
	return await fs.exists(path.join(configRoot(profile), ...loc.agentsRelative, sessionId));
}

/** Row count in the durable message store for one session (0 when unreadable). */
async function sessionMessageCount(profile: ToolProfile, sessionId: string): Promise<number> {
	const proj = profile.projects;
	if (proj.source !== 'sqlite') return 0;
	const dbPath = path.join(configRoot(profile), ...proj.dbRelative);
	if (!(await getFs().exists(dbPath))) return 0;
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
	} catch {
		return 0;
	}
	try {
		const r = db.prepare('SELECT COUNT(*) AS c FROM message WHERE session_id = ?').get(sessionId) as { c: number };
		return r.c;
	} catch {
		return 0;
	} finally {
		db.close();
	}
}

function rolloutPath(profile: ToolProfile, loc: Extract<TranscriptLocator, { source: 'zcode-transcripts' }>, sessionId: string): string {
	return path.join(configRoot(profile), ...loc.rolloutRelative, `model-io-${sessionId}.jsonl`);
}

/**
 * Parse one session's durable message+part rows into a flow. The PRIMARY source:
 * survives compaction and carries thinking for main sessions. Null when the
 * session has no message rows or none parse into turns.
 */
async function readSqliteFlow(profile: ToolProfile, sessionId: string): Promise<SessionFlow | null> {
	const proj = profile.projects;
	if (proj.source !== 'sqlite') return null;
	const dbPath = path.join(configRoot(profile), ...proj.dbRelative);
	if (!(await getFs().exists(dbPath))) return null;
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
	} catch {
		return null;
	}
	try {
		const rows = db.prepare(
			`SELECT m.sequence AS ms, m.data AS md, p.data AS pd, p.sequence AS ps
			FROM message m LEFT JOIN part p ON p.message_id = m.id
			WHERE m.session_id = ? ORDER BY m.sequence, p.sequence`,
		).all(sessionId) as { ms: number; md: string; pd: string | null; ps: number }[];
		const parsed = parseSqliteMessages(rows);
		if (parsed.turns.length === 0) return null;
		return {
			id: `${sessionId}__main`,
			kind: 'main',
			description: parsed.turns[0]?.user?.slice(0, 60) ?? '',
			sourcePath: dbPath,
			turns: parsed.turns,
			stats: parsed.stats,
		};
	} finally {
		db.close();
	}
}

/** The sqlite index row for one session id, as a SessionSummary (no transcript check). */
async function sessionRow(profile: ToolProfile, sessionId: string): Promise<SessionSummary | null> {
	const proj = profile.projects;
	if (proj.source !== 'sqlite') return null;
	const dbPath = path.join(configRoot(profile), ...proj.dbRelative);
	if (!(await getFs().exists(dbPath))) return null;
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
	} catch {
		return null;
	}
	try {
		const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
		if (!ident.test(proj.table)) return null;
		const r = db.prepare(
			`SELECT id, title, task_type, parent_id, time_created, time_updated FROM "${proj.table}" WHERE id = ?`,
		).get(sessionId) as {
			id: string; title: string | null; task_type: string | null; parent_id: string | null;
			time_created: number | null; time_updated: number | null;
		} | undefined;
		if (!r) return null;
		return {
			id: r.id,
			title: r.title,
			taskType: r.task_type,
			parentId: r.parent_id,
			timeCreated: msToIso(r.time_created),
			timeUpdated: msToIso(r.time_updated),
			hasTranscript: await sessionHasTranscript(profile, r.id),
		};
	} finally {
		db.close();
	}
}

/**
 * Read one session end-to-end: index row + main flow (rollout) + subagent flows.
 * Returns null when the session has no transcript content on disk at all.
 */
export async function readSession(profile: ToolProfile, sessionId: string): Promise<SessionRead | null> {
	const loc = profile.transcripts;
	if (!loc) return null;
	if (loc.source === 'claude-jsonl') return readClaudeSession(profile, loc, sessionId);
	if (loc.source !== 'zcode-transcripts') return null;
	if (!isValidSessionId(sessionId)) return null;

	// Index row for the header (works for every task type, not just listed ones).
	const summary = (await sessionRow(profile, sessionId))
		?? { id: sessionId, title: null, taskType: null, parentId: null, timeCreated: null, timeUpdated: null, hasTranscript: false };

	const main = (await readSqliteFlow(profile, sessionId))
		?? (await readRolloutFlow(profile, sessionId));
	const subagents = await readSubagentFlows(profile, sessionId);
	if (!main && subagents.length === 0) return null;
	return { session: summary, main, subagents };
}

/** Rollout fallback for main flows when the sqlite store has nothing (legacy). */
async function readRolloutFlow(profile: ToolProfile, sessionId: string): Promise<SessionFlow | null> {
	const file = rolloutPath(profile, profile.transcripts as Extract<TranscriptLocator, { source: 'zcode-transcripts' }>, sessionId);
	if (!(await getFs().exists(file))) return null;
	let text: string;
	try {
		text = await getFs().readFile(file);
	} catch {
		return null;
	}
	const parsed = parseRollout(text);
	if (parsed.turns.length === 0) return null;
	return {
		id: `${sessionId}__main`,
		kind: 'main',
		description: parsed.turns[0]?.user?.slice(0, 60) ?? '',
		sourcePath: file,
		turns: parsed.turns,
		stats: parsed.stats,
	};
}

/**
 * Subagent flows for a session. PRIMARY: child session rows (parent_id = this
 * session, task_type='subagent_child') parsed from the sqlite message store.
 * FALLBACK: agents/<sessionId>/agent_<id>/transcript.jsonl dirs not already covered
 * by a child row (older data).
 */
async function readSubagentFlows(profile: ToolProfile, sessionId: string): Promise<SessionFlow[]> {
	const out: SessionFlow[] = [];
	const coveredAgentUuids = new Set<string>();

	for (const child of await subagentChildren(profile, sessionId)) {
		const flow = await readSqliteFlow(profile, child.id);
		if (flow) {
			// child ids look like sess_subagent_agent_<uuid> — remember for the dir fallback
			const m = /^sess_subagent_agent_(.+)$/.exec(child.id);
			if (m) coveredAgentUuids.add(m[1]!);
			out.push({
				...flow,
				id: `${sessionId}__${child.id.slice(0, 24)}`,
				kind: 'subagent' as const,
				description: child.title || flow.description,
				startedAt: msToIso(child.timeCreated),
			});
		}
	}

	const loc = profile.transcripts;
	if (!loc || loc.source !== 'zcode-transcripts') return out;
	const sessDir = path.join(configRoot(profile), ...loc.agentsRelative, sessionId);
	if (!(await getFs().exists(sessDir))) return out;
	const fs = getFs();
	for (const entry of await fs.readDir(sessDir)) {
		if (!entry.isDirectory || !entry.name.startsWith('agent_')) continue;
		if (coveredAgentUuids.has(entry.name.slice('agent_'.length))) continue;
		const transcript = path.join(sessDir, entry.name, 'transcript.jsonl');
		try {
			if (!(await fs.exists(transcript))) continue;
			const parsed = parseAgentTranscript(await fs.readFile(transcript));
			if (parsed.turns.length === 0) continue;
			out.push({
				id: `${sessionId}__${entry.name.slice(0, 18)}`,
				kind: 'subagent',
				description: await agentDescription(path.join(sessDir, entry.name)),
				sourcePath: transcript,
				startedAt: parsed.stats.firstTs,
				turns: parsed.turns,
				stats: parsed.stats,
			});
		} catch { /* unreadable agent dir — skip */ }
	}
	return out;
}

/** Child subagent sessions of one parent session, oldest first. */
async function subagentChildren(profile: ToolProfile, sessionId: string): Promise<{ id: string; title: string | null; timeCreated: number | null }[]> {
	const proj = profile.projects;
	if (proj.source !== 'sqlite') return [];
	const dbPath = path.join(configRoot(profile), ...proj.dbRelative);
	if (!(await getFs().exists(dbPath))) return [];
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
	} catch {
		return [];
	}
	try {
		return db.prepare(
			`SELECT id, title, time_created AS timeCreated FROM session
			WHERE parent_id = ? AND task_type = 'subagent_child' ORDER BY time_created`,
		).all(sessionId) as { id: string; title: string | null; timeCreated: number | null }[];
	} finally {
		db.close();
	}
}

/* ==================== dsh-zstd: ~/.dsh/sessions/<encoded>/session-<uuid>/session.v3.jsonl.zstd ==================== */

/**
 * Decompress a DSH multi-frame zstd stream — each frame holds ONE jsonl event line.
 * Uses Node 24's built-in zlib zstd (experimental). Bad frames are skipped, never fatal.
 */
function dshDecompress(buf: Buffer): string {
	const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
	const offsets: number[] = [];
	for (let i = 0; i + 4 <= buf.length; i++) {
		if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i);
	}
	const parts: string[] = [];
	for (let f = 0; f < offsets.length; f++) {
		const end = f + 1 < offsets.length ? offsets[f + 1] : buf.length;
		try {
			parts.push(zlib.zstdDecompressSync(buf.subarray(offsets[f], end)).toString('utf8'));
		} catch { /* skip bad frame */ }
	}
	return parts.join('');
}

/** Best-effort session title: the LAST session/title event's data.title. */
function dshTitle(text: string): string | null {
	let title: string | null = null;
	for (const line of text.split('\n')) {
		if (!line.includes('session/title')) continue;
		try {
			const j = JSON.parse(line) as { type?: string; data?: { title?: unknown } };
			if (j.type === 'session/title' && typeof j.data?.title === 'string' && j.data.title.trim()) {
				title = j.data.title.trim();
			}
		} catch { /* skip */ }
	}
	return title;
}

/** DSH session list: one summary per session-<uuid>/ dir, newest mtime first. */
async function listDshSessions(profile: ToolProfile, loc: Extract<TranscriptLocator, { source: 'dsh-zstd' }>, project: string): Promise<SessionSummary[]> {
	const fs = getFs();
	const folder = path.join(configRoot(profile), loc.dirRelative, project);
	if (!(await fs.exists(folder))) return [];
	const out: SessionSummary[] = [];
	for (const entry of await fs.readDir(folder)) {
		if (!entry.isDirectory || !entry.name.startsWith('session-')) continue;
		const id = entry.name.slice('session-'.length);
		if (!isValidSessionId(id)) continue;
		const zfile = path.join(folder, entry.name, 'session.v3.jsonl.zstd');
		if (!(await fs.exists(zfile))) continue;
		let title: string | null = null;
		let timeUpdated: string | null = null;
		try {
			title = dshTitle(dshDecompress(await fs.readFileBytes(zfile)));
		} catch { /* unreadable — list without title */ }
		try {
			timeUpdated = new Date((await fs.stat(zfile)).mtimeMs).toISOString();
		} catch { /* ignore */ }
		out.push({
			id,
			title,
			taskType: null,
			parentId: null,
			timeCreated: null,
			timeUpdated,
			hasTranscript: true,
		});
	}
	out.sort((a, b) => (b.timeUpdated ?? '').localeCompare(a.timeUpdated ?? ''));
	return out;
}

/** metadata.json description next to a subagent transcript, when present. */
async function agentDescription(agentDir: string): Promise<string> {
	try {
		const meta = path.join(agentDir, 'metadata.json');
		if (!(await getFs().exists(meta))) return '';
		const j = JSON.parse(await getFs().readFile(meta)) as { description?: string };
		return typeof j.description === 'string' ? j.description : '';
	} catch {
		return '';
	}
}

/* ==================== claude-jsonl: ~/.claude/projects/<encoded>/<uuid>.jsonl ==================== */

/**
 * Resolve the encoded project folder for a list request. The UI passes the encoded
 * folder name (Projects page navigates with p.encoded); a decoded real path is also
 * accepted by matching decodeProjectFolder() (lossy decode → best-effort).
 */
async function claudeProjectFolder(profile: ToolProfile, loc: Extract<TranscriptLocator, { source: 'claude-jsonl' }>, project: string): Promise<string | null> {
	const fs = getFs();
	const root = path.join(configRoot(profile), loc.dirRelative);
	if (!(await fs.exists(root))) return null;
	const direct = path.join(root, project);
	if (await fs.exists(direct)) return direct;
	for (const entry of await fs.readDir(root)) {
		if (!entry.isDirectory) continue;
		if ((await decodeProjectFolder(entry.name)) === project) return path.join(root, entry.name);
	}
	return null;
}

/** Claude session list: one summary per <session-uuid>.jsonl, newest activity first. */
async function listClaudeSessions(profile: ToolProfile, loc: Extract<TranscriptLocator, { source: 'claude-jsonl' }>, project: string): Promise<SessionSummary[]> {
	const folder = await claudeProjectFolder(profile, loc, project);
	if (!folder) return [];
	const fs = getFs();
	const out: SessionSummary[] = [];
	for (const entry of await fs.readDir(folder)) {
		if (!entry.isFile || !entry.name.endsWith('.jsonl')) continue;
		const id = entry.name.slice(0, -'.jsonl'.length);
		if (!isValidSessionId(id)) continue;
		const file = path.join(folder, entry.name);
		let parsed;
		try {
			parsed = parseClaudeTranscript(await fs.readFile(file));
		} catch {
			continue; // unreadable transcript — skip, never fail the whole list
		}
		out.push({
			id,
			title: parsed.title,
			taskType: null,
			parentId: null,
			timeCreated: parsed.main.stats.firstTs ?? parsed.sidechain.stats.firstTs,
			timeUpdated: parsed.main.stats.lastTs ?? parsed.sidechain.stats.lastTs,
			hasTranscript: parsed.main.turns.length > 0 || parsed.sidechain.turns.length > 0,
		});
	}
	out.sort((a, b) => (b.timeUpdated ?? '').localeCompare(a.timeUpdated ?? ''));
	return out;
}

/**
 * Read one Claude session: locate <encoded>/<id>.jsonl across project folders,
 * parse main flow + merged Task-sidechain flow (no per-agent grouping key exists
 * in this format, so inline subagent content surfaces as one subagent flow).
 */
async function readClaudeSession(profile: ToolProfile, loc: Extract<TranscriptLocator, { source: 'claude-jsonl' }>, sessionId: string): Promise<SessionRead | null> {
	if (!isValidSessionId(sessionId)) return null;
	const fs = getFs();
	const root = path.join(configRoot(profile), loc.dirRelative);
	if (!(await fs.exists(root))) return null;
	for (const entry of await fs.readDir(root)) {
		if (!entry.isDirectory) continue;
		const file = path.join(root, entry.name, `${sessionId}.jsonl`);
		if (!(await fs.exists(file))) continue;
		let parsed;
		try {
			parsed = parseClaudeTranscript(await fs.readFile(file));
		} catch {
			return null;
		}
		if (parsed.main.turns.length === 0 && parsed.sidechain.turns.length === 0) return null;
		const summary: SessionSummary = {
			id: sessionId,
			title: parsed.title,
			taskType: null,
			parentId: null,
			timeCreated: parsed.main.stats.firstTs ?? parsed.sidechain.stats.firstTs,
			timeUpdated: parsed.main.stats.lastTs ?? parsed.sidechain.stats.lastTs,
			hasTranscript: true,
		};
		const main: SessionFlow | null = parsed.main.turns.length
			? {
				id: `${sessionId}__main`,
				kind: 'main',
				description: parsed.main.turns[0]?.user.slice(0, 60) ?? '',
				sourcePath: file,
				turns: parsed.main.turns,
				stats: parsed.main.stats,
			}
			: null;
		const subagents: SessionFlow[] = parsed.sidechain.turns.length
			? [{
				id: `${sessionId}__sidechain`,
				kind: 'subagent',
				description: 'Task 子代理（内联合并）',
				sourcePath: file,
				startedAt: parsed.sidechain.stats.firstTs,
				turns: parsed.sidechain.turns,
				stats: parsed.sidechain.stats,
			}]
			: [];
		return { session: summary, main, subagents };
	}
	return null;
}
