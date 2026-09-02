// Skill usage reader — counts Skill-tool invocations across the tool's session
// transcripts, keyed by skill name ('plugin:skill' qualified or bare).
//
// ZCode-only for now (capability gap, same pattern as rules?): Claude Code's
// transcript layout is not modeled, so profiles WITHOUT a `transcripts` locator
// return { supported: false } and the UI hides usage badges entirely.
//
// Scans the two jsonl stores declared by the transcript locator:
//   <configRoot>/cli/rollout/model-io-<id>.jsonl                 — main-session model IO
//   <configRoot>/cli/agents/sess_<id>/agent_<id>/transcript.jsonl — subagent runs
//
// Line-level regex (not JSON.parse) on purpose: these are append-only streams
// where each LINE is a JSON object but the file as a whole is not; a cheap
// '"Skill"' substring pre-filter skips >99% of lines before the two
// order-tolerant patterns run (name-before-skill and skill-before-name).
//
// KNOWN LIMIT: rollout files ROTATE on context compaction and lose
// pre-compaction turns (see ARCHITECTURE.md), so counts are "history visible
// in surviving files", not all-time totals.

import path from 'node:path';
import { getFs } from './hosts/context.js';
import { configRoot } from './paths.js';
import type { ToolProfile } from './profiles.js';
import type { SkillUsage } from './model.js';

const CALL_AHEAD = /"name":\s*"Skill"[^}]*?"skill":\s*"([^"]+)"/g;
const CALL_BEHIND = /"skill":\s*"([^"]+)"[^}]*?"name":\s*"Skill"/g;

/** Count Skill-tool calls in one jsonl file into the shared map. */
async function countInFile(file: string, counts: Map<string, number>): Promise<void> {
	let raw: string;
	try {
		raw = await getFs().readFile(file);
	} catch {
		return; // unreadable → skip silently
	}
	for (const line of raw.split('\n')) {
		if (!line.includes('"Skill"')) continue;
		for (const m of line.matchAll(CALL_AHEAD)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
		for (const m of line.matchAll(CALL_BEHIND)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
	}
}

/**
 * All transcript jsonl files, derived from the profile's transcript locator:
 * rollout/model-io-<id>.jsonl + agents/sess_<id>/agent_<id>/transcript.jsonl.
 */
async function collectTranscriptFiles(profile: ToolProfile): Promise<string[]> {
	const fs = getFs();
	const root = configRoot(profile);
	const files: string[] = [];

	// Main-session rollouts.
	const rolloutDir = path.join(root, ...profile.transcripts!.rolloutRelative);
	for (const e of await fs.readDir(rolloutDir)) {
		if (e.isFile && e.name.startsWith('model-io-') && e.name.endsWith('.jsonl')) {
			files.push(path.join(rolloutDir, e.name));
		}
	}

	// Subagent transcripts: agents/<sess>/agent_<id>/transcript.jsonl (two dir levels).
	const agentsDir = path.join(root, ...profile.transcripts!.agentsRelative);
	for (const sess of await fs.readDir(agentsDir)) {
		if (!sess.isDirectory || !sess.name.startsWith('sess_')) continue;
		for (const agent of await fs.readDir(path.join(agentsDir, sess.name))) {
			if (!agent.isDirectory || !agent.name.startsWith('agent_')) continue;
			const transcript = path.join(agentsDir, sess.name, agent.name, 'transcript.jsonl');
			if (await fs.exists(transcript)) files.push(transcript);
		}
	}

	return files;
}

/** Aggregate Skill-tool invocation counts (see module comment for limits). */
export async function readSkillUsage(profile: ToolProfile): Promise<SkillUsage> {
	// Capability gap: no transcript locator modeled (Claude Code) → unsupported.
	if (!profile.transcripts) {
		return { supported: false, filesScanned: 0, totalCalls: 0, counts: {} };
	}
	const files = await collectTranscriptFiles(profile);
	const counts = new Map<string, number>();
	for (const f of files) await countInFile(f, counts);
	let totalCalls = 0;
	const out: Record<string, number> = {};
	for (const [k, v] of counts) {
		out[k] = v;
		totalCalls += v;
	}
	return { supported: true, filesScanned: files.length, totalCalls, counts: out };
}
