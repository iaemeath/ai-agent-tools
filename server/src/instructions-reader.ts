// Instructions reader — tool-agnostic discovery of instruction files
// (CLAUDE.md for Claude Code, AGENTS.md for ZCode).
//
// Instructions live in two layers:
//   - global:   <configRoot>/<fileName>           (e.g. ~/.claude/CLAUDE.md)
//   - project:  <projectDir>/<fileName>           (e.g. D:/code/CLAUDE.md)
//
// They have no toggle — this module is read-only (list + read content).

import fs from 'node:fs';
import path from 'node:path';
import { configRoot } from './paths.js';
import { listProjects } from './projects-reader.js';
import type { ToolProfile } from './profiles.js';
import type { InstructionInfo } from './model.js';

/**
 * List all instruction files for a tool: the global one + one per known project
 * that actually has the file on disk. Returns [] when none exist.
 */
export function listInstructions(profile: ToolProfile): InstructionInfo[] {
	const fileName = profile.instructions.fileName;
	const out: InstructionInfo[] = [];

	// 1. Global instruction file under configRoot.
	const globalPath = path.join(configRoot(profile), fileName);
	if (fs.existsSync(globalPath) && fs.statSync(globalPath).isFile()) {
		out.push({ scope: 'global', path: globalPath, lineCount: countLines(globalPath), project: null });
	}

	// 2. Project-level instruction files (use the unified project discovery,
	//    which supports both fs folders and SQLite — so ZCode projects are found too).
	for (const proj of listProjects(profile)) {
		const p = path.join(proj.path, fileName);
		if (fs.existsSync(p) && fs.statSync(p).isFile()) {
			out.push({ scope: 'project', path: p, lineCount: countLines(p), project: proj.path });
		}
	}

	return out;
}

/**
 * Read the raw content of one instruction file. Returns null if the file
 * does not exist or cannot be read.
 */
export function readInstruction(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, 'utf8');
	} catch {
		return null;
	}
}

function countLines(p: string): number {
	try {
		const raw = fs.readFileSync(p, 'utf8');
		return raw.split('\n').length;
	} catch {
		return 0;
	}
}
