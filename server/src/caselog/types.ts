// caselog types — module-contained (deliberately NOT in model.ts: the caselog module
// keeps its own boundary so it can be lifted out of ai-agent-tools wholesale; see
// docs/caselog/case-log-v2-design v3.3.md §2).

import type { TranscriptTurn } from '../transcript-parser.js';

/** One session row as stored in every raw/<host>.sqlite mirror. */
export interface RawSessionRow {
	id: string;
	title: string | null;
	task_type: string | null;
	parent_id: string | null;
	time_created: number | null;
	time_updated: number | null;
}

/** Session listing entry across the raw mirrors (host-tagged). */
export interface RawSessionSummary extends RawSessionRow {
	host: string;
	hasTranscript: boolean;
}

/** One parsed conversation flow (main or subagent) inside a caselog session read. */
export interface CaselogFlow {
	id: string;
	kind: 'main' | 'subagent';
	description: string;
	startedAt: string | null;
	turns: TranscriptTurn[];
	stats: { firstTs: string | null; lastTs: string | null; toolCalls: number };
}

/** Full session read: index row + main flow + subagent flows (mirrors SessionRead). */
export interface CaselogSessionRead {
	host: string;
	session: Omit<RawSessionRow, 'id'> & { id: string };
	main: CaselogFlow | null;
	subagents: CaselogFlow[];
}

/** Provenance pointer row (scenario_sessions) — where a scenario came from. */
export interface ScenarioPointer {
	host: string;
	sessionId: string;
	agentId: string;
	seqRange: string;
	notedAt: string;
}

/** Scenario record as served to the UI (knowledge.db scenarios + pointers). */
export interface Scenario {
	id: string;
	title: string;
	keywords: string;
	content: string;
	category: string;
	source: string;
	editedCount: number;
	editedAt: string | null;
	createdAt: string;
	updatedAt: string;
	pointers: ScenarioPointer[];
}

/** Review outcome entry (review_log). */
export interface ReviewEntry {
	scenarioId: string;
	reviewedAt: string;
	outcome: 'remembered' | 'forgotten' | 'conflict';
	recalledNote: string;
	note: string;
}
