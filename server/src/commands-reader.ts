// Commands reader — tool-agnostic discovery of custom slash command files
// (*.md in a directory). Both Claude Code and ZCode support commands; when
// profile.commands is undefined (no support), listCommands returns [].
//
//   - global:   <configRoot>/<dirName>/*.md            (e.g. ~/.claude/commands/*.md)
//   - project:  <projectDir>/<projectPrefix>/<dirName>/*.md
//
// Read-only (list + read content); commands have no toggle. Directory scan +
// frontmatter parse live in the shared markdown-resource module.

import { globalCommandsDir, projectCommandsDir } from './paths.js';
import { listProjects } from './projects-reader.js';
import { scanMarkdownDir, parseFrontmatterField, countLines, readFileText, dedupeByKey } from './markdown-resource.js';
import type { ToolProfile } from './profiles.js';
import type { CommandInfo } from './model.js';

export function listCommands(profile: ToolProfile): CommandInfo[] {
	// Tool has no commands support → empty.
	if (!profile.commands) return [];

	const out: CommandInfo[] = [];

	// 1. Global command files.
	const gDir = globalCommandsDir(profile);
	if (gDir) scanMarkdownDir(gDir, 'global', null, out, makeCommandInfo);

	// 2. Project-level command files (uses listProjects, NOT allProjectPaths —
	//    listProjects supports both fs (Claude) and sqlite (ZCode)).
	for (const proj of listProjects(profile)) {
		const pDir = projectCommandsDir(proj.path, profile);
		if (pDir) scanMarkdownDir(pDir, 'project', proj.path, out, makeCommandInfo);
	}

	return dedupeByKey(out, (r) => r.path);
}

function makeCommandInfo(fullPath: string, name: string, scope: 'global' | 'project', project: string | null): CommandInfo {
	return {
		scope,
		path: fullPath,
		name,
		description: parseFrontmatterField(fullPath, 'description'),
		lineCount: countLines(fullPath),
		project,
	};
}

export function readCommand(filePath: string): string | null {
	return readFileText(filePath);
}
