// Project-folder decode — ported from src-tauri/src/commands.rs decode_project_folder(),
// then profile-aware: Claude Code encodes the absolute cwd by replacing `/` with `-`,
// so `/home/user/my-project` → `-home-user-my-project`. On Windows the drive letter is
// preserved as a leading single-letter token, e.g. `D:\code` → `D--code`,
// `C:\Users\Admin` → `C--Users-Administrator`. ZCode has no such folder, so
// allProjectPaths returns [] for it (sessions live in SQLite).
//
// Because `-` is ambiguous (separator OR part of a real dir name), we greedily reconstruct
// by walking the real filesystem, matching the longest possible directory-name prefix at
// each step. On Windows we start from a detected drive root (`D:\`) instead of `/`.

import fs from 'node:fs';
import path from 'node:path';
import { projectsDir } from './paths.js';
import { DEFAULT_PROFILE, type ToolProfile } from './profiles.js';

export function decodeProjectFolder(name: string): string {
	if (name === '') return name;

	const tokens = name.split('-');

	// Windows drive detection: a leading single letter token followed by an empty token
	// (from "D--code" → tokens ['D','','code',...]). The drive root is `D:\`.
	// We only accept it if `D:\` really exists, to avoid misreading a posix path that
	// happens to start with a single-letter dir.
	let resolved = '/';
	let i = 0;
	if (tokens.length >= 2 && tokens[0].length === 1 && /^[a-zA-Z]$/.test(tokens[0]) && tokens[1] === '') {
		const driveRoot = `${tokens[0]}:\\`;
		if (fs.existsSync(driveRoot)) {
			resolved = driveRoot;
			i = 2; // consumed the drive letter + the empty separator token
		}
	} else if (!name.startsWith('-')) {
		// Not an encoded posix path (posix encoded paths start with '-', e.g. "-home-user").
		// Without a recognized drive prefix, there's nothing to decode.
		return name;
	} else {
		// Posix form: "-home-user" → drop the leading '-', body is after it.
		// (tokens[0] is '' here because the name starts with '-'.)
		i = 1; // skip the leading empty token
	}

	while (i < tokens.length) {
		if (tokens[i] === '') {
			// Skip empty tokens (from consecutive dashes).
			i += 1;
			continue;
		}
		let matched = false;
		// Greedy: try the longest possible join first.
		for (let take = tokens.length - i; take >= 1; take--) {
			const slice = tokens.slice(i, i + take);
			// Claude encodes both '/' and '_' as '-', so the real dir name could use
			// either separator. Try dash-join first (real '-'), then underscore-join.
			for (const candidate of [slice.join('-'), slice.join('_')]) {
				const probe = path.join(resolved, candidate);
				if (fs.existsSync(probe) && fs.statSync(probe).isDirectory()) {
					resolved = probe;
					i += take;
					matched = true;
					break;
				}
			}
			if (matched) break;
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
 * All known project filesystem paths (decoded from the tool's session-history folder names).
 * Only paths that successfully decode to a real path (path !== encoded) are returned.
 * Used by the skill scanner to discover project-scoped skills across all projects.
 *
 * Returns [] when the tool has no session-history dir (ZCode) — project discovery for
 * such tools needs a different mechanism (TODO).
 */
export function allProjectPaths(p: ToolProfile = DEFAULT_PROFILE): string[] {
	// Only the fs + dash-encoding source is walkable here. SQLite tools (ZCode) discover
	// projects through their DB; project-scoped skill scanning is Claude-only for now.
	const loc = p.projects;
	if (loc.source !== 'fs' || loc.encoding !== 'dash') return [];

	const dir = projectsDir(p);
	if (!dir || !fs.existsSync(dir)) return [];
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
