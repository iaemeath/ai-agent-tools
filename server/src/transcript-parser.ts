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

/** One assistant intermediate step inside a turn: reasoning, plain text, or a non-text marker. */
export interface TranscriptStep {
	type: 'thinking' | 'text' | 'compaction' | 'file';
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

/** One-line description for a compaction / file marker part (rendered as a turn separator). */
function markerText(type: 'compaction' | 'file', pd: Record<string, any>): string {
	if (type === 'compaction') {
		const trigger = String(pd['trigger'] ?? 'manual');
		const tokens = pd['preCompactTokenCount'];
		const bits = [trigger === 'auto' ? '自动' : trigger === 'manual' ? '手动' : trigger];
		if (typeof tokens === 'number' && tokens > 0) bits.push(`压缩前 ${tokens} tokens`);
		return `上下文压缩（${bits.join(' · ')}）`;
	}
	const mime = String(pd['mime'] ?? '');
	const img = ((pd['metadata'] ?? {}) as Record<string, any>)['image'] ?? {};
	const dim = typeof img['width'] === 'number' && typeof img['height'] === 'number'
		? ` · ${img['width']}×${img['height']}`
		: '';
	return `${mime.startsWith('image/') ? '图片' : '文件'}产物 ${mime}${dim}`;
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
		}
		// Compaction / file markers ride on either role's messages (compaction fires
		// mid-turn; file parts mostly ride tool-result user messages) — surface both
		// as turn markers. step-start / step-finish / timeline: delimiters, skipped.
		if (turn && (type === 'compaction' || type === 'file')) {
			turn.steps.push({ type, text: markerText(type, pd) });
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

	return {
		turns,
		stats: { lines: nLines, firstTs, lastTs, toolCalls: turns.reduce((n, x) => n + x.tools.length, 0) },
	};
}


// ------------------------------------------------ 5. Claude Code session jsonl
//
// ~/.claude/projects/<dash-encoded-cwd>/<session-uuid>.jsonl — one JSON object per
// line, the whole conversation (main + inline Task subagents) in ONE file:
//   user/assistant lines carry message.content (string or block array) and are the
//   only turn content; system/attachment lines are notices (skipped); the rest are
//   metadata (ai-title / last-prompt / mode / permission-mode / cost-state /
//   file-history-* / atis-latch) — skipped except ai-title, whose `aiTitle` field
//   (last occurrence wins) names the session.
// Block types: assistant {thinking (text in `thinking`, NOT `text`), text, tool_use};
// user {text, tool_result} — tool_result blocks never open or populate a turn.
// isSidechain:true lines belong to Task-subagent runs → parsed into a separate
// sidechain transcript (no per-agent grouping key exists in this format).

/** Parsed Claude session file: main flow + merged subagent (sidechain) flow + title. */
export interface ParsedClaudeTranscript {
	main: ParsedTranscript;
	sidechain: ParsedTranscript;
	/** Last ai-title.aiTitle in the file; null when absent. */
	title: string | null;
}

/** User-text openings that are machine injections, not real input. */
const CLAUDE_USER_SKIP_PREFIXES = [
	'<system-reminder>',
	'Caveat:',
	'This session is being continued from a previous conversation',
	'The TodoWrite tool hasn\'t been used recently',
];

/** Per-accumulator turn builder (one instance for main, one for sidechain). */
interface ClaudeAcc {
	transcript: ParsedTranscript;
	cur: TranscriptTurn | null;
	lastUser: string;
	firstTs: string | null;
	lastTs: string | null;
	nLines: number;
}

function claudeAcc(): ClaudeAcc {
	return { transcript: { turns: [], stats: { lines: 0, firstTs: null, lastTs: null, toolCalls: 0 } }, cur: null, lastUser: '', firstTs: null, lastTs: null, nLines: 0 };
}

/** Assemble the current turn (steps de-noise + last-text-as-response), zcode-parser semantics. */
function claudeFlush(acc: ClaudeAcc): void {
	const cur = acc.cur;
	if (!cur) return;
	const steps: TranscriptStep[] = [];
	for (const s of cur.steps) {
		const txt = s.text.trim();
		if (!txt) continue;
		const prev = steps[steps.length - 1];
		if (prev && prev.type === s.type && (txt.startsWith(prev.text) || prev.text.startsWith(txt))) {
			prev.text = txt.length > prev.text.length ? txt : prev.text;
		} else {
			steps.push({ type: s.type, text: txt });
		}
	}
	for (let i = steps.length - 1; i >= 0; i -= 1) {
		if (steps[i]!.type === 'text') {
			cur.response = steps[i]!.text;
			steps.splice(i, 1);
			break;
		}
	}
	cur.steps = steps;
	acc.transcript.turns.push(cur);
	acc.cur = null;
}

/** User text from one content piece → normalized turn opener, or null to skip. */
function claudeUserPiece(piece: string): string | null {
	const lead = piece.trimStart();
	if (!lead) return null;
	if (CLAUDE_USER_SKIP_PREFIXES.some((p) => lead.startsWith(p))) return null;
	// Slash-command wrapper: collapse the tag noise to "/name args" (real user action).
	const cmd = /<command-name>\s*(\/[^\s<]+)\s*<\/command-name>/.exec(piece);
	if (cmd) {
		const args = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/.exec(piece);
		return args && args[1] ? `${cmd[1]} ${args[1]}`.trim() : cmd[1];
	}
	if (lead.startsWith('<local-command-stdout>') || lead.startsWith('<local-command-stderr>')) return null;
	if (/^Called the \S+ tool with the following input/.test(lead)) return null;
	return piece.trim();
}

/** Parse one Claude session file's content (see block comment for the line model). */
export function parseClaudeTranscript(text: string): ParsedClaudeTranscript {
	const main = claudeAcc();
	const side = claudeAcc();
	let title: string | null = null;

	for (const j of jsonLines(text)) {
		const acc = j['isSidechain'] === true ? side : main;
		acc.nLines += 1;
		const t = j['type'] as string | undefined;
		const ts = (j['timestamp'] ?? null) as string | null;
		if (ts) { if (acc.firstTs === null) acc.firstTs = ts; acc.lastTs = ts; }

		if (t === 'ai-title') {
			const v = j['aiTitle'];
			if (typeof v === 'string' && v.trim()) title = v.trim();
			continue;
		}
		if (t !== 'user' && t !== 'assistant') continue;
		const msg = (j['message'] ?? {}) as Record<string, any>;
		const content = msg['content'];

		if (t === 'user') {
			const pieces: string[] = [];
			if (typeof content === 'string') pieces.push(content);
			else if (Array.isArray(content)) {
				for (const b of content) {
					if (b && typeof b === 'object' && b['type'] === 'text' && typeof b['text'] === 'string') pieces.push(b['text']);
					// tool_result blocks: delivery receipts for a previous tool_use — never content.
				}
			}
			const txt = pieces.map(claudeUserPiece).filter((x): x is string => x !== null).join('\n').trim();
			if (!txt) continue;
			// Retry replay: same prefix-merge rule as the sqlite parser.
			if (acc.lastUser && (txt.startsWith(acc.lastUser) || acc.lastUser.startsWith(txt))) {
				if (txt.length > acc.lastUser.length) { acc.lastUser = txt; if (acc.cur) acc.cur.user = txt; }
				continue;
			}
			acc.lastUser = txt;
			claudeFlush(acc);
			acc.cur = { ts, user: txt, steps: [], tools: [], response: '' };
			continue;
		}

		// assistant — only meaningful inside an open turn.
		const turn = acc.cur;
		if (!turn || !Array.isArray(content)) continue;
		for (const b of content) {
			if (!b || typeof b !== 'object') continue;
			if (b['type'] === 'thinking') {
				turn.steps.push({ type: 'thinking', text: String(b['thinking'] ?? '') });
			} else if (b['type'] === 'text') {
				turn.steps.push({ type: 'text', text: String(b['text'] ?? '') });
			} else if (b['type'] === 'tool_use') {
				const name = String(b['name'] ?? '');
				turn.tools.push({ name, summary: toolSummary(name, b['input']), input: toolInputDump(b['input']) });
			}
		}
	}
	claudeFlush(main);
	claudeFlush(side);
	for (const acc of [main, side]) {
		acc.transcript.stats = {
			lines: acc.nLines,
			firstTs: acc.firstTs,
			lastTs: acc.lastTs,
			toolCalls: acc.transcript.turns.reduce((n, x) => n + x.tools.length, 0),
		};
	}
	return { main: main.transcript, sidechain: side.transcript, title };
}
