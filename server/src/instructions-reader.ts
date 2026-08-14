// Instructions reader — tool-agnostic discovery of instruction files
// (CLAUDE.md for Claude Code, AGENTS.md for ZCode).
//
// Instructions live in two layers:
//   - global:   <configRoot>/<fileName>           (e.g. ~/.claude/CLAUDE.md)
//   - project:  <projectDir>/<fileName>           (e.g. D:/code/CLAUDE.md)
//
// They have no toggle — this module is read-only (list + read content).

import path from 'node:path';
import { configRoot } from './paths.js';
import { listProjects } from './projects-reader.js';
import { countLines } from './markdown-resource.js';
import { getFs } from './hosts/context.js';
import type { ToolProfile } from './profiles.js';
import type { InstructionInfo } from './model.js';

/** True when the path exists and is a regular file (single stat; absent → false). */
async function isFile(p: string): Promise<boolean> {
	try {
		return (await getFs().stat(p)).isFile;
	} catch {
		return false;
	}
}

/**
 * List all instruction files for a tool: the global one + one per known project
 * that actually has the file on disk. Returns [] when none exist.
 */
export async function listInstructions(profile: ToolProfile): Promise<InstructionInfo[]> {
	const fileName = profile.instructions.fileName;
	const out: InstructionInfo[] = [];

	// 1. Global instruction file under configRoot.
	const globalPath = path.join(configRoot(profile), fileName);
	if (await isFile(globalPath)) {
		out.push({ scope: 'global', path: globalPath, lineCount: await countLines(globalPath), project: null });
	}

	// 2. Project-level instruction files (use the unified project discovery,
	//    which supports both fs folders and SQLite — so ZCode projects are found too).
	for (const proj of await listProjects(profile)) {
		const p = path.join(proj.path, fileName);
		if (await isFile(p)) {
			out.push({ scope: 'project', path: p, lineCount: await countLines(p), project: proj.path });
		}
	}

	return out;
}

/**
 * Read the raw content of one instruction file. Returns null if the file
 * does not exist or cannot be read.
 */
export async function readInstruction(filePath: string): Promise<string | null> {
	try {
		return await getFs().readFile(filePath);
	} catch {
		return null;
	}
}
