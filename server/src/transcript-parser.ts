// Transcript parser — ZCode session transcripts → normalized turns.
//
// Pure functions over file CONTENT (no fs access): the callers (sessions-reader,
// remote/entry mirror) read the file through the FsBackend and hand the text here,
// so parsing works identically on the local host and inside a remote exec.
//
// Two input formats (both JSONL, both read-only):
//   1. subagent transcript  agents/<sess>/agent_*/transcript.jsonl
//      Rich structure: turn_started (user input) / model_streaming deltas
//      (thinking + text) / tool_call_scheduled (full input) / turn_complete.
//   2. main-session rollout  rollout/model-io-<sess>.jsonl
//      response.text + toolCalls, with user inputs recovered from the sliding
//      -window tail of request.messages (no thinking in this format).
//
// Filtered: model_request (full-context resend each turn), model_streaming
// fragments (only accumulated deltas are kept). Retried turns that replay the
// same thinking/text are prefix-merged into the longest variant.
//
// Ported from the standalone Python ETL (case-log etl.py) whose logic was verified
// against real transcripts — behavior is intentionally identical.

/** One assistant intermediate step inside a turn: reasoning or plain text. */
export interface TranscriptStep {
	type: 'thinking' | 'text';
	text: string;
}

/** One tool invocation inside a turn (full input capped for display). */
export interface TranscriptToolCall {
	name: string;
	summary: string;
	input: string;
}

/** One conversation turn: user input → intermediate steps/tools → final response. */
export interface TranscriptTurn {
	ts: string | null;
	user: string;
	steps: TranscriptStep[];
	tools: TranscriptToolCall[];
	response: string;
	stats?: { toolCalls?: number; tokens?: number; durationMs?: number };
}

/** A parsed transcript plus source-level stats. */
export interface ParsedTranscript {
	turns: TranscriptTurn[];
	stats: { lines: number; firstTs: string | null; lastTs: string | null; toolCalls: number };
}

const TOOL_SUMMARY_KEYS = ['command', 'file_path', 'path', 'pattern', 'url', 'prompt', 'description', 'query', 'skill', 'code'] as const;

function clip(v: string, max: number): string {
	return v.length > max ? v.slice(0, max) + '…' : v;
}

/** Short one-line hint for a tool call (first interesting key, else JSON). */
export function toolSummary(name: string, inp: unknown): string {
	if (inp !== null && typeof inp === 'object') {
		const rec = inp as Record<string, unknown>;
		for (const k of TOOL_SUMMARY_KEYS) {
			if (k in rec) return clip(String(rec[k]).replace(/\n/g, ' '), 160);
		}
		try { return clip(JSON.stringify(inp), 160); } catch { return ''; }
	}
	if (inp === undefined || inp === null) return '';
	return clip(String(inp), 160);
}

/** Full tool input dump (capped at 2000 chars) for the expandable detail block. */
export function toolInputDump(inp: unknown): string {
	let v: string;
	try { v = JSON.stringify(inp) ?? ''; } catch { v = String(inp); }
	return clip(v, 2000);
}

/** Split file content into parseable JSON lines (bad lines skipped, like the ETL). */
function* jsonLines(text: string): Generator<Record<string, any>> {
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		try { yield JSON.parse(line) as Record<string, any>; } catch { /* skip */ }
	}
}

// ------------------------------------------------ 1. subagent transcript

/** transcript.jsonl → turns. See file header for the event model. */
export function parseAgentTranscript(text: string): ParsedTranscript {
	const turns: TranscriptTurn[] = [];
	let cur: TranscriptTurn | null = null;
	// assistantMessageId → step, plus first-seen order (JS objects keep string-key order).
	const am = new Map<string, { type: 'thinking' | 'text'; text: string }>();
	const tools = new Map<string, { name: string; summary: string; input: string; seq: number }>();
	let nLines = 0;
	let firstTs: string | null = null;
	let lastTs: string | null = null;

	function flush(): void {
		if (!cur) return;
		const steps: TranscriptStep[] = [];
		for (const s of am.values()) {
			const txt = s.text.trim();
			if (!txt) continue;
			// Merge retry replays: adjacent same-type steps that are prefixes of each
			// other → keep the longest (the retry's complete variant).
			const prev = steps[steps.length - 1];
			if (prev && prev.type === s.type && (txt.startsWith(prev.text) || prev.text.startsWith(txt))) {
				prev.text = txt.length > prev.text.length ? txt : prev.text;
			} else {
				steps.push({ type: s.type, text: txt });
			}
		}
		cur.steps = steps;
		cur.tools = [...tools.values()]
			.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
			.map((t) => ({ name: t.name, summary: t.summary, input: t.input }));
		turns.push(cur);
		cur = null;
		am.clear();
		tools.clear();
	}

	for (const j of jsonLines(text)) {
		nLines += 1;
		const t = j['type'] as string | undefined;
		const p = (j['payload'] ?? {}) as Record<string, any>;
		const ts = (j['timestamp'] ?? null) as string | null;
		if (ts) { if (firstTs === null) firstTs = ts; lastTs = ts; }
		const seq = (j['sequenceNumber'] ?? 0) as number;

		if (t === 'turn_started') {
			flush();
			cur = { ts, user: String(p['input'] ?? '').trim(), steps: [], tools: [], response: '' };
		} else if (cur) {
			// track sequence span (kept for future seq_range pointers)
		}

		if (t === 'model_streaming') {
			const kind = p['kind'] as string | undefined;
			const mid = p['assistantMessageId'] as string | undefined;
			if (mid === undefined) continue;
			const d = String(p['delta'] ?? '');
			if (kind === 'reasoning_start' || kind === 'text_start') {
				am.set(mid, { type: kind.startsWith('reasoning') ? 'thinking' : 'text', text: '' });
			} else if (kind === 'reasoning_delta' || kind === 'text_delta') {
				const s = am.get(mid);
				if (s) s.text += d;
			}
		} else if (t === 'tool_call_scheduled') {
			const cid = String(p['toolCallId'] ?? '');
			tools.set(cid, {
				name: String(p['toolName'] ?? ''),
				summary: toolSummary(String(p['toolName'] ?? ''), p['input']),
				input: toolInputDump(p['input']),
				seq,
			});
		} else if (t === 'turn_complete') {
			if (cur) {
				cur.response = String(p['response'] ?? '').trim();
				const u = (p['usage'] ?? {}) as Record<string, any>;
				cur.stats = {
					toolCalls: p['toolCallCount'] ?? undefined,
					tokens: u['totalTokens'] ?? undefined,
					durationMs: p['duration'] ?? undefined,
				};
			}
			flush();
		}
	}
	flush();

	return {
		turns,
		stats: { lines: nLines, firstTs, lastTs, toolCalls: turns.reduce((n, x) => n + x.tools.length, 0) },
	};
}

// ------------------------------------------------ 3. sqlite message+part store
//
// The DURABLE session store (db.sqlite `message` + `part` tables) — the authoritative
// source: unlike the rollout file it survives context compaction with full history,
// and unlike rollout it carries `reasoning` parts (thinking) for main sessions too.
// Every session in the DB has message rows (verified: 571/571).

/** Pre-joined message+part row as handed in by the reader's SQL. */
export interface SqliteMessageRow {
	/** message.sequence */
	ms: number;
	/** message.data JSON */
	md: string;
	/** part.data JSON (null when the message has no parts) */
	pd: string | null;
	/** part.sequence */
	ps: number;
}

/** Machine-injected user texts that must not open a reading turn. */
const USER_INJECTION_LEADS = [
	'<system-reminder>',
	'Caveat:',
	'The TodoWrite tool hasn\'t been used recently',
	'This session is being continued from a previous conversation',
];

function realUserTextFromPart(text: string): string | null {
	const lead = text.trimStart();
	if (!lead || USER_INJECTION_LEADS.some((p) => lead.startsWith(p))) return null;
	// Tool results are recorded as user messages with this framing — not real input.
	if (/^Called the \S+ tool with the following input/.test(lead)) return null;
	return text.trim();
}

/** ms epoch inside message.data.time.created → ISO; null when absent/invalid. */
function msgTs(md: Record<string, any>): string | null {
	const t = md?.time?.created;
	return typeof t === 'number' && t > 0 ? new Date(t).toISOString() : null;
}

/**
 * message+part rows (ordered by m.sequence, p.sequence) → turns.
 * Turn model: a real user text part opens a turn; assistant parts accumulate
 * (reasoning → thinking, text → text, tool → tool call). The LAST text of a turn
 * is its final response; earlier texts are intermediate steps. Consecutive
 * identical user texts are retry replays and never re-open a turn.
 */
export function parseSqliteMessages(rows: SqliteMessageRow[]): ParsedTranscript {
	const turns: TranscriptTurn[] = [];
	let cur: TranscriptTurn | null = null;
	let lastUser = '';
	let nLines = 0;
	let firstTs: string | null = null;
	let lastTs: string | null = null;

	function flush(): void {
		if (!cur) return;
		const steps: TranscriptStep[] = [];
		for (const s of cur.steps) {
			const txt = s.text.trim();
			if (!txt) continue;
			// prefix-merge replayed retries (same rule as the transcript parser)
			const prev = steps[steps.length - 1];
			if (prev && prev.type === s.type && (txt.startsWith(prev.text) || prev.text.startsWith(txt))) {
				prev.text = txt.length > prev.text.length ? txt : prev.text;
			} else {
				steps.push({ type: s.type, text: txt });
			}
		}
		// The last text step is the turn's final response; the rest stay as process.
		for (let i = steps.length - 1; i >= 0; i -= 1) {
			if (steps[i]!.type === 'text') {
				cur.response = steps[i]!.text;
				steps.splice(i, 1);
				break;
			}
		}
		cur.steps = steps;
		turns.push(cur);
		cur = null;
	}

	// Group rows into messages (rows arrive ordered by message.sequence, part.sequence).
	// cur is reassigned from the endMessage closure, so read it through a typed
	// accessor — TS control flow otherwise keeps the null from the initializer.
	function curTurn(): TranscriptTurn | null {
		return cur;
	}
	let ms = Number.NaN;
	let role = '';
	let ts: string | null = null;
	let userTexts: string[] = [];
	function endMessage(): void {
		if (role !== 'user') return;
		const txt = userTexts.map(realUserTextFromPart).filter((t): t is string => t !== null).join('\n').trim();
		userTexts = [];
		if (!txt) return;
		// Retry replay: the same user text re-sent (possibly extended). Same
		// prefix-merge rule as the steps — never re-open the turn, keep the longer
		// variant. (A user legitimately repeating the same text with no other
		// message in between folds together too — accepted, it's indistinguishable.)
		if (lastUser && (txt.startsWith(lastUser) || lastUser.startsWith(txt))) {
			if (txt.length > lastUser.length) {
				lastUser = txt;
				if (cur) cur.user = txt;
			}
			return;
		}
		lastUser = txt;
		flush();
		cur = { ts, user: txt, steps: [], tools: [], response: '' };
	}

	for (const row of rows) {
		nLines += 1;
		if (row.ms !== ms) {
			endMessage();
			ms = row.ms;
			let md: Record<string, any>;
			try { md = JSON.parse(row.md) as Record<string, any>; } catch { role = ''; ts = null; continue; }
			role = String(md['role'] ?? '');
			ts = msgTs(md);
			if (ts) { if (firstTs === null) firstTs = ts; lastTs = ts; }
		}
		if (!row.pd) continue;
		let pd: Record<string, any>;
		try { pd = JSON.parse(row.pd) as Record<string, any>; } catch { continue; }
		const type = pd['type'] as string | undefined;
		const turn = curTurn();

		if (role === 'user') {
			if (type === 'text') userTexts.push(String(pd['text'] ?? ''));
		} else if (role === 'assistant' && turn) {
			if (type === 'reasoning') {
				turn.steps.push({ type: 'thinking', text: String(pd['text'] ?? '') });
			} else if (type === 'text') {
				turn.steps.push({ type: 'text', text: String(pd['text'] ?? '') });
			} else if (type === 'tool') {
				const state = (pd['state'] ?? {}) as Record<string, any>;
				const name = String(pd['tool'] ?? '');
				turn.tools.push({ name, summary: toolSummary(name, state['input']), input: toolInputDump(state['input']) });
			}
			// step-start / step-finish / timeline: delimiters, skipped
		}
	}
	endMessage();
	flush();

	return {
		turns,
		stats: { lines: nLines, firstTs, lastTs, toolCalls: turns.reduce((n, x) => n + x.tools.length, 0) },
	};
}


// ------------------------------------------------ 4. main-session rollout (fallback)

/**
 * Extract a real user input from a request message; null for tool_result-shaped
 * messages and machine injections (<system-reminder> / Caveat:).
 */
function realUserText(m: Record<string, any>): string | null {
	if (m['role'] !== 'user') return null;
	const c = m['content'];
	let texts: string[];
	if (typeof c === 'string') texts = [c];
	else if (Array.isArray(c)) {
		texts = c.filter((b) => b && typeof b === 'object' && b['type'] === 'text').map((b) => String(b['text'] ?? ''));
	} else return null;
	texts = texts.filter((t) => {
		const lead = t.trimStart();
		return t.trim() !== '' && !lead.startsWith('<system-reminder>') && !lead.startsWith('Caveat:');
	});
	if (texts.length === 0) return null;
	return texts.join('\n').trim();
}

/** model-io-<sess>.jsonl → turns (no thinking in this format). */
export function parseRollout(text: string): ParsedTranscript {
	const turns: TranscriptTurn[] = [];
	let cur: TranscriptTurn | null = null;
	// Only a FIRST-SEEN user message opens a new turn — the sliding request window
	// re-sends earlier users every turn and must not re-split.
	const seenUsers = new Set<string>();
	let nLines = 0;
	let firstTs: string | null = null;
	let lastTs: string | null = null;

	for (const j of jsonLines(text)) {
		nLines += 1;
		const ts = (j['startedAt'] ?? null) as string | null;
		if (ts) { if (firstTs === null) firstTs = ts; lastTs = ts; }
		const req = (j['request'] ?? {}) as Record<string, any>;
		const users = ((req['messages'] ?? []) as Record<string, any>[]).map(realUserText).filter((u): u is string => !!u);
		const lastUser = users.length > 0 ? users[users.length - 1] : null;
		if (lastUser !== null && !seenUsers.has(lastUser)) {
			seenUsers.add(lastUser);
			cur = { ts, user: lastUser, steps: [], tools: [], response: '' };
			turns.push(cur);
		}
		if (cur === null) {
			cur = { ts, user: '', steps: [], tools: [], response: '' };
			turns.push(cur);
		}
		const resp = (j['response'] ?? {}) as Record<string, any>;
		const text2 = String(resp['text'] ?? '').trim();
		if (text2) {
			cur.steps.push({ type: 'text', text: text2 });
			cur.response = text2;
		}
		for (const tc of ((resp['toolCalls'] ?? []) as Record<string, any>[])) {
			cur.tools.push({
				name: String(tc['name'] ?? ''),
				summary: toolSummary(String(tc['name'] ?? ''), tc['input']),
				input: toolInputDump(tc['input']),
			});
		}
	}

	return {
		turns,
		stats: { lines: nLines, firstTs, lastTs, toolCalls: turns.reduce((n, x) => n + x.tools.length, 0) },
	};
}
