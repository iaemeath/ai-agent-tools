// Agents reader — tool-agnostic discovery of standalone subagent files
// (*.md in a directory). Both Claude Code and ZCode support standalone agents;
// when profile.agents is undefined (no support), listAgents returns [].
//
//   - global:   <configRoot>/<dirName>/*.md            (e.g. ~/.claude/agents/*.md)
//   - project:  <projectDir>/<projectPrefix>/<dirName>/*.md
//
// Read-only (list + read content); agents have no toggle. Directory scan +
// frontmatter parse live in the shared markdown-resource module.
//
// IMPORTANT: ZCode also has ~/.zcode/cli/agents/ which holds RUNTIME session
// state (sess_<uuid>/agent_<uuid>/…), NOT agent definitions. This reader only
// scans ~/.zcode/agents/ (profile.agents.dirName under configRoot), never cli/.

import { globalAgentsDir, projectAgentsDir } from './paths.js';
import { listProjects } from './projects-reader.js';
import { scanMarkdownDir, parseFrontmatterField, countLines, readFileText, dedupeByKey } from './markdown-resource.js';
import type { ToolProfile } from './profiles.js';
import type { AgentInfo } from './model.js';

export function listAgents(profile: ToolProfile): AgentInfo[] {
	// Tool has no standalone-agents support → empty.
	if (!profile.agents) return [];

	const out: AgentInfo[] = [];

	// 1. Global agent files.
	const gDir = globalAgentsDir(profile);
	if (gDir) scanMarkdownDir(gDir, 'global', null, out, makeAgentInfo);

	// 2. Project-level agent files (uses listProjects, NOT allProjectPaths —
	//    listProjects supports both fs (Claude) and sqlite (ZCode)).
	for (const proj of listProjects(profile)) {
		const pDir = projectAgentsDir(proj.path, profile);
		if (pDir) scanMarkdownDir(pDir, 'project', proj.path, out, makeAgentInfo);
	}

	return dedupeByKey(out, (r) => r.path);
}

function makeAgentInfo(fullPath: string, name: string, scope: 'global' | 'project', project: string | null): AgentInfo {
	return {
		scope,
		path: fullPath,
		name,
		description: parseFrontmatterField(fullPath, 'description'),
		lineCount: countLines(fullPath),
		project,
	};
}

export function readAgent(filePath: string): string | null {
	return readFileText(filePath);
}
