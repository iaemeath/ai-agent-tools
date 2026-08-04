// Project-folder decode — ported from src-tauri/src/commands.rs decode_project_folder().
//
// Claude Code encodes the absolute cwd as a folder name by replacing every `/` with `-`,
// so `/home/user/my-project` → `-home-user-my-project`. Because `-` is ambiguous (separator
// OR part of a real dir name), we greedily reconstruct by walking the real filesystem from
// `/`, matching the longest possible directory-name prefix at each step.

import fs from 'node:fs';
import path from 'node:path';
import { projectsDir } from './paths.js';

export function decodeProjectFolder(name: string): string {
	// Not encoded (empty or doesn't start with '-') → return as-is.
	if (name === '' || !name.startsWith('-')) return name;

	const body = name.slice(1);
	const tokens = body.split('-');

	let resolved = '/';
	let i = 0;
	while (i < tokens.length) {
		if (tokens[i] === '') {
			// Skip empty tokens (from consecutive dashes).
			i += 1;
			continue;
		}
		let matched = false;
		// Greedy: try the longest possible join first.
		for (let take = tokens.length - i; take >= 1; take--) {
			const candidate = tokens.slice(i, i + take).join('-');
			const probe = path.join(resolved, candidate);
			if (fs.existsSync(probe) && fs.statSync(probe).isDirectory()) {
				resolved = probe;
				i += take;
				matched = true;
				break;
			}
		}
		if (!matched) {
			// Even a dangling token advances by 1 (preserve original fallback behavior).
			resolved = path.join(resolved, tokens[i]);
			i += 1;
		}
	}
	return resolved;
}

/**
 * All known project filesystem paths (decoded from ~/.claude/projects/ folder names).
 * Only paths that successfully decode to a real path (path !== encoded) are returned.
 * Used by the skill scanner to discover project-scoped skills across all projects.
 */
export function allProjectPaths(): string[] {
	const dir = projectsDir();
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const encoded = entry.name;
		const decoded = decodeProjectFolder(encoded);
		if (decoded !== '' && decoded !== encoded) {
			out.push(decoded);
		}
	}
	return out;
}
