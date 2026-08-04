// SkillAdapter — ported from src-tauri/src/adapters/skill.rs.
// Skills live in ~/.claude/skills/<name>/ (global) or {project}/.claude/skills/<name>/ (project).
// Toggle key: skillOverrides in settings.json (on/off/name-only/user-only).

import fs from 'node:fs';
import path from 'node:path';
import { readProject, readUser, writeProject, writeUser } from '../settings.js';
import { globalSkillsDir, projectSkillsDir } from '../paths.js';
import { allProjectPaths } from '../decode.js';
import {
	type Mechanism, type Origin, resolveEffective, type ScanCtx, type Scope, type ScopeCtx,
	type ScopeStatus, type Status, type ToolContent, type ToolInstance,
} from '../model.js';
import type { ToolAdapter } from './types.js';

type Json = Record<string, unknown>;

/** Read skillOverrides[name]; unknown/missing → 'inherited'. */
export function readOverride(settings: Json, name: string): Status {
	const overrides = settings['skillOverrides'];
	if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return 'inherited';
	const v = (overrides as Json)[name];
	if (typeof v !== 'string') return 'inherited';
	switch (v) {
		case 'on': return 'enabled';
		case 'off': return 'disabled';
		case 'name-only': return 'name-only';
		case 'user-only': return 'user-only';
		default: return 'inherited';
	}
}

/**
 * Set skillOverrides[name] (or remove it for 'inherited'). Preserves every other top-level key.
 * Cleans up: if the map is empty, removes the whole skillOverrides key.
 */
export function writeOverride(settings: Json, name: string, status: Status): void {
	let map = settings['skillOverrides'];
	if (!map || typeof map !== 'object' || Array.isArray(map)) {
		map = {};
		settings['skillOverrides'] = map;
	}
	const m = map as Record<string, unknown>;
	switch (status) {
		case 'enabled': m[name] = 'on'; break;
		case 'disabled': m[name] = 'off'; break;
		case 'name-only': m[name] = 'name-only'; break;
		case 'user-only': m[name] = 'user-only'; break;
		case 'inherited': delete m[name]; break;
	}
	if (Object.keys(m).length === 0) delete settings['skillOverrides'];
}

/** Parse a SKILL.md front-matter description: (trimmed, quotes stripped) or first non-heading line. */
function parseDescription(marker: string): string | null {
	let raw: string;
	try {
		raw = fs.readFileSync(marker, 'utf8');
	} catch {
		return null;
	}
	if (!raw.startsWith('---')) return firstNonHeadingLine(raw);
	// Front matter: scan lines after the opening --- until the closing --- line.
	for (const line of raw.split('\n').slice(1)) {
		if (line.trim() === '---') break;
		const m = line.match(/^description:\s*(.*)$/);
		if (m) {
			// trim_matches('"'): strip leading/trailing " chars only.
			const cleaned = m[1].trim().replace(/^"+|"+$/g, '');
			if (cleaned !== '') return cleaned;
		}
	}
	return null;
}

function firstNonHeadingLine(raw: string): string | null {
	for (const line of raw.split('\n')) {
		if (line === '' || line.startsWith('#')) continue;
		return line;
	}
	return null;
}

export class SkillAdapter implements ToolAdapter {
	kind = 'skill' as const;
	mechanism: Mechanism = 'nativeToggle';

	scan(ctx: ScanCtx): ToolInstance[] {
		const out: ToolInstance[] = [];

		// 1. Global skills: ~/.claude/skills/*
		const globalDir = globalSkillsDir();
		if (fs.existsSync(globalDir)) {
			for (const entry of fs.readdirSync(globalDir, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const name = entry.name;
				const marker = path.join(globalDir, name, 'SKILL.md');
				if (!fs.existsSync(marker)) continue;
				const perScope = this.statuses(name, ctx.project);
				out.push({
					kind: 'skill',
					name,
					description: parseDescription(marker),
					mechanism: 'nativeToggle',
					origin: 'global',
					sourcePath: path.join(globalDir, name),
					perScope,
					effective: resolveEffective(perScope),
				});
			}
		}

		// 2. Project skills. Specific project → just that one; null → all known projects.
		const projectPaths = ctx.project ? [ctx.project] : allProjectPaths();
		for (const proj of projectPaths) {
			const projDir = projectSkillsDir(proj);
			if (!fs.existsSync(projDir)) continue;
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(projDir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const name = entry.name;
				const marker = path.join(projDir, name, 'SKILL.md');
				if (!fs.existsSync(marker)) continue;
				// Skip if a global skill with the same name already exists (global shadows project).
				if (out.some((i) => i.kind === 'skill' && i.origin === 'global' && i.name === name)) continue;
				const scope: Scope = { level: 'project', path: proj };
				// Project-origin skill: read project-level override (default inherited → enabled).
				let prStatus: Status = 'inherited';
				try { prStatus = readOverride(readProject(proj), name); } catch { /* default inherited */ }
				const perScope: ScopeStatus[] = [{ scope, status: prStatus }];
				out.push({
					kind: 'skill',
					name,
					description: parseDescription(marker),
					mechanism: 'nativeToggle',
					origin: 'project',
					sourcePath: path.join(projDir, name),
					originProject: proj,
					perScope,
					effective: resolveEffective(perScope),
				});
			}
		}

		out.sort((a, b) => a.name.localeCompare(b.name));
		return out;
	}

	/** Build per-scope status list: [user, ...project?]. Order matters for resolveEffective. */
	private statuses(name: string, project: string | null): ScopeStatus[] {
		let userStatus: Status = 'inherited';
		try { userStatus = readOverride(readUser(), name); } catch { /* default inherited */ }
		const v: ScopeStatus[] = [{ scope: { level: 'user' }, status: userStatus }];
		if (project) {
			let prStatus: Status = 'inherited';
			try { prStatus = readOverride(readProject(project), name); } catch { /* default inherited */ }
			v.push({ scope: { level: 'project', path: project }, status: prStatus });
		}
		return v;
	}

	setStatus(name: string, scope: Scope, status: Status, _ctx: ScopeCtx): void {
		if (scope.level === 'user') {
			const s = readUser();
			writeOverride(s, name, status);
			writeUser(s);
		} else {
			const s = readProject(scope.path);
			writeOverride(s, name, status);
			writeProject(scope.path, s);
		}
	}

	view(name: string): ToolContent {
		const p = path.join(globalSkillsDir(), name, 'SKILL.md');
		const raw = fs.readFileSync(p, 'utf8'); // throws → caller maps to 404/error
		return { kind: 'skill', name, raw };
	}
}
