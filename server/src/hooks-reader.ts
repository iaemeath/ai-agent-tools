// Hooks reader — flattens the nested hooks JSON config tree into a flat HookInfo[].
//
// Unlike skills/commands/agents (directories of *.md), hooks are NOT files: they
// live as a nested JSON structure inside the tool's settings file(s). One hook's
// identity is positional {sourceFile → event → matcherGroup idx → hook idx}.
//
// Both Claude Code and ZCode support hooks, but their schemas differ — declared
// in profile.hooks and normalized away here so callers see one HookInfo shape:
//
//   Claude:  settings.json + settings.local.json (localSettingsFile sibling),
//            hooks.<Event>: [{ matcher, hooks: [{ type, command, timeout?, statusMessage? }] }]
//            (no global enable flag)
//   ZCode:   cli/config.json only,
//            hooks.events.<Event>: [...]   (extra 'events' wrapper),
//            hooks.enabled: bool           (global kill-switch)
//
//   - global:  <userSettings> (+ <localSettingsFile> sibling when configured)
//   - project: <projectSettings> (+ local sibling) for each listProjects() entry
//
// Read-only (list); hooks have no toggle in this UI. Uses settings.read() so a
// missing/unparseable file yields {} (never throws).

import path from 'node:path';
import { configRoot, projectSettings, userSettings } from './paths.js';
import { listProjects } from './projects-reader.js';
import { read } from './settings.js';
import { dedupeByKey } from './markdown-resource.js';
import type { ToolProfile } from './profiles.js';
import type { HookInfo } from './model.js';

/** Walk a key path into a nested object; returns undefined if any step misses. */
function dive(obj: unknown, keyPath: string[]): unknown {
	let cur: unknown = obj;
	for (const k of keyPath) {
		if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
			cur = (cur as Record<string, unknown>)[k];
		} else {
			return undefined;
		}
	}
	return cur;
}

/**
 * Absolute paths of the settings file(s) that may hold hooks for a given scope.
 * Claude adds the settings.local.json sibling; ZCode has a single file.
 */
function hookSourceFiles(profile: ToolProfile, scope: 'global' | 'project', project: string | null): string[] {
	const main = scope === 'global' ? userSettings(profile) : projectSettings(project!, profile);
	const files = [main];
	if (profile.hooks?.localSettingsFile) {
		const baseDir = scope === 'global' ? configRoot(profile) : path.join(project!, profile.projectPrefix);
		files.push(path.join(baseDir, profile.hooks.localSettingsFile));
	}
	return files;
}

export function listHooks(profile: ToolProfile): HookInfo[] {
	// Tool has no hooks support → empty.
	if (!profile.hooks) return [];

	const out: HookInfo[] = [];

	// 1. Global hooks (user-level settings file(s)).
	for (const file of hookSourceFiles(profile, 'global', null)) {
		collectFromFile(file, 'global', null, profile, out);
	}

	// 2. Project-level hooks (uses listProjects — supports fs Claude + sqlite ZCode).
	for (const proj of listProjects(profile)) {
		for (const file of hookSourceFiles(profile, 'project', proj.path)) {
			collectFromFile(file, 'project', proj.path, profile, out);
		}
	}

	// Dedupe: the home dir can appear as a "project", making its settings file
	// collide with the global one (same hooks collected twice under different
	// scopes). The composite id (which embeds sourceFile) collapses the duplicate.
	return dedupeByKey(out, (h) => h.id);
}

/**
 * Read one settings file, dive to its events map, and flatten every hook entry.
 * Missing file / no hooks key / malformed structure → contributes nothing.
 */
function collectFromFile(
	sourceFile: string,
	scope: 'global' | 'project',
	project: string | null,
	profile: ToolProfile,
	out: HookInfo[],
): void {
	const settings = read(sourceFile);
	const { eventsKeyPath, enabledKeyPath } = profile.hooks!;

	// Global enabled flag (ZCode only). Default true when absent.
	const enabledRaw = enabledKeyPath ? dive(settings, enabledKeyPath) : true;
	const enabled = enabledRaw !== false; // only an explicit false disables

	const eventsMap = dive(settings, eventsKeyPath);
	if (!eventsMap || typeof eventsMap !== 'object' || Array.isArray(eventsMap)) return;

	for (const [event, groups] of Object.entries(eventsMap as Record<string, unknown>)) {
		if (!Array.isArray(groups)) continue;
		groups.forEach((group, matcherIdx) => {
			if (!group || typeof group !== 'object' || Array.isArray(group)) return;
			const g = group as Record<string, unknown>;
			const matcher = typeof g.matcher === 'string' ? g.matcher : '*';
			const hooks = Array.isArray(g.hooks) ? g.hooks : [];
			hooks.forEach((hook, hookIdx) => {
				if (!hook || typeof hook !== 'object' || Array.isArray(hook)) return;
				const h = hook as Record<string, unknown>;
				const command = typeof h.command === 'string' ? h.command : '';
				if (!command) return; // a hook with no command is meaningless; skip
				out.push({
					id: `${scope}::${sourceFile}::${event}::${matcherIdx}::${hookIdx}`,
					scope,
					sourceFile,
					event,
					matcher,
					command,
					type: typeof h.type === 'string' ? h.type : 'command',
					timeout: typeof h.timeout === 'number' ? h.timeout : undefined,
					statusMessage: typeof h.statusMessage === 'string' ? h.statusMessage : undefined,
					enabled,
					project,
				});
			});
		});
	}
}
