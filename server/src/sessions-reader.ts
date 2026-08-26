// Sessions reader — session-history listing + full-session reading (read-only).
//
// Tool-agnostic entry points (listSessions / readSession) that dispatch on the
// profile's TranscriptLocator. Currently one modeled layout:
//   zcode-transcripts — the sqlite session table (already located by the projects
//   locator) is the INDEX; turn CONTENT comes from two sibling stores:
//     rollout/model-io-<sessionId>.jsonl            main-session model IO
//     agents/<sessionId>/agent_*/transcript.jsonl   subagent runs (with thinking)
//
// All file access goes through the FsBackend (getFs), and parsing is delegated to
// the pure transcript-parser — so the remote-exec mirror works unchanged.

import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configRoot } from './paths.js';
import { getFs } from './hosts/context.js';
import { parseAgentTranscript, parseRollout, parseSqliteMessages } from './transcript-parser.js';
import type { ToolProfile } from './profiles.js';
import type { SessionFlow, SessionRead, SessionSummary } from './model.js';

/** Session ids we accept from clients: sess_ + uuid-ish chars incl. underscore (defeats traversal). */
const SESSION_ID_RE = /^sess_[A-Za-z0-9_-]+$/;

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
	if (!loc || loc.source !== 'zcode-transcripts') return [];
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
	if (await fs.exists(rolloutPath(profile, sessionId))) return true;
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

function rolloutPath(profile: ToolProfile, sessionId: string): string {
	const loc = profile.transcripts!;
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
	if (!loc || loc.source !== 'zcode-transcripts') return null;
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
	const file = rolloutPath(profile, sessionId);
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

	const loc = profile.transcripts!;
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
