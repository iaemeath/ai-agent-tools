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
// Directory scan + frontmatter parse live in the shared markdown-resource module.

import { globalRulesDir, projectRulesDir } from './paths.js';
import { listProjects } from './projects-reader.js';
import { scanMarkdownDir, parseFrontmatterField, countLines, readFileText, dedupeByKey } from './markdown-resource.js';
import type { ToolProfile } from './profiles.js';
import type { RuleInfo } from './model.js';

export async function listRules(profile: ToolProfile): Promise<RuleInfo[]> {
	// Tool has no rules support → empty (capability gap, e.g. ZCode).
	if (!profile.rules) return [];

	const out: RuleInfo[] = [];

	// 1. Global rule files.
	const gDir = globalRulesDir(profile);
	if (gDir) await scanMarkdownDir(gDir, 'global', null, out, makeRuleInfo);

	// 2. Project-level rule files (uses listProjects, NOT allProjectPaths —
	//    listProjects supports both fs (Claude) and sqlite (ZCode)).
	for (const proj of await listProjects(profile)) {
		const pDir = projectRulesDir(proj.path, profile);
		if (pDir) await scanMarkdownDir(pDir, 'project', proj.path, out, makeRuleInfo);
	}

	return dedupeByKey(out, (r) => r.path);
}

async function makeRuleInfo(fullPath: string, name: string, scope: 'global' | 'project', project: string | null): Promise<RuleInfo> {
	return {
		scope,
		path: fullPath,
		name,
		description: await parseFrontmatterField(fullPath, 'description'),
		lineCount: await countLines(fullPath),
		project,
	};
}

export function readRule(filePath: string): Promise<string | null> {
	return readFileText(filePath);
}
