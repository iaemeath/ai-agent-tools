// Rules reader — tool-agnostic discovery of rule files (*.md in a directory).
//
// Rules are Claude Code only (ZCode has no rules mechanism). They live in a
// directory as multiple .md files, unlike instructions (single file per scope).
// When profile.rules is undefined (tool has no rules support), listRules
// returns an empty array.
//
//   - global:   <configRoot>/<dirName>/*.md            (e.g. ~/.claude/rules/*.md)
//   - project:  <projectDir>/<projectPrefix>/<dirName>/*.md
//
// They have no toggle — this module is read-only (list + read content).

import fs from 'node:fs';
import path from 'node:path';
import { globalRulesDir, projectRulesDir } from './paths.js';
import { listProjects } from './projects-reader.js';
import type { ToolProfile } from './profiles.js';
import type { RuleInfo } from './model.js';

export function listRules(profile: ToolProfile): RuleInfo[] {
	// Tool has no rules support → empty (capability gap, e.g. ZCode).
	if (!profile.rules) return [];

	const out: RuleInfo[] = [];

	// 1. Global rule files.
	const gDir = globalRulesDir(profile);
	if (gDir) collectRuleFiles(gDir, 'global', null, out);

	// 2. Project-level rule files (uses listProjects, NOT allProjectPaths —
	//    listProjects supports both fs (Claude) and sqlite (ZCode)).
	for (const proj of listProjects(profile)) {
		const pDir = projectRulesDir(proj.path, profile);
		if (pDir) collectRuleFiles(pDir, 'project', proj.path, out);
	}

	return out;
}

/** Scan a directory for *.md files and append RuleInfo entries. */
function collectRuleFiles(dir: string, scope: 'global' | 'project', project: string | null, out: RuleInfo[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return; // dir does not exist or unreadable — skip gracefully
	}
	for (const e of entries) {
		if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue;
		const fullPath = path.join(dir, e.name);
		out.push({
			scope,
			path: fullPath,
			name: e.name,
			description: parseDescription(fullPath),
			lineCount: countLines(fullPath),
			project,
		});
	}
}

export function readRule(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, 'utf8');
	} catch {
		return null;
	}
}

/**
 * Extract the `description` field from a YAML frontmatter block (if present).
 * Supports inline values and folded/literal block scalars (>- / |).
 */
function parseDescription(filePath: string): string | undefined {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch {
		return undefined;
	}
	if (!raw.startsWith('---')) return undefined;
	const lines = raw.split('\n').slice(1);
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === '---') break;
		const m = lines[i].match(/^description:\s*(.*)$/);
		if (!m) continue;
		const inline = m[1].trim();
		// Inline value (not a block scalar indicator).
		if (inline && !/^[>|]/.test(inline)) {
			return inline.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '') || undefined;
		}
		// Folded/literal block scalar: collect following indented lines.
		const collected: string[] = [];
		for (let j = i + 1; j < lines.length; j++) {
			const ln = lines[j];
			if (ln.trim() === '---') break;
			if (ln.startsWith(' ') || ln.startsWith('\t')) collected.push(ln.trim());
			else if (ln.trim() === '') continue;
			else break;
		}
		return collected.join(' ') || undefined;
	}
	return undefined;
}

function countLines(p: string): number {
	try {
		return fs.readFileSync(p, 'utf8').split('\n').length;
	} catch {
		return 0;
	}
}
