// SkillAdapter — ported from src-tauri/src/adapters/skill.rs.
// Skills live in <configRoot>/skills/<name>/ (global) or {project}/<prefix>/skills/<name>/ (project).
// Toggle key: skillOverrides in settings (on/off/name-only/user-only).

import fs from 'node:fs';
import path from 'node:path';
import { readProject, readUser, writeProject, writeUser } from '../settings.js';
import { globalSkillsDir, projectSkillsDir } from '../paths.js';
import { allProjectPaths } from '../decode.js';
import { DEFAULT_PROFILE, type ToolProfile } from '../profiles.js';
import {
	type Mechanism, type Origin, resolveEffective, type ScanCtx, type Scope, type ScopeCtx,
	type ScopeStatus, type Status, type ToolContent, type ToolInstance,
} from '../model.js';
import { readFlag, writeFlag } from '../locator.js';
import type { ToolAdapter } from './types.js';

type Json = Record<string, unknown>;

/** Read skillOverrides[name] for the given profile; unknown/missing → 'inherited'. */
export function readOverride(settings: Json, name: string, p: ToolProfile = DEFAULT_PROFILE): Status {
	return readFlag(p.skills.overridesEncoding, settings, p.skills.overridesKeyPath, name);
}

/** Set skillOverrides[name] for the given profile; 'inherited' removes the key. */
export function writeOverride(settings: Json, name: string, status: Status, p: ToolProfile = DEFAULT_PROFILE): void {
	writeFlag(p.skills.overridesEncoding, settings, p.skills.overridesKeyPath, name, status);
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

	constructor(private readonly profile: ToolProfile) {}

	scan(ctx: ScanCtx): ToolInstance[] {
		const out: ToolInstance[] = [];
		const p = this.profile;

		// 1. Global skills: <configRoot>/skills/*
		const globalDir = globalSkillsDir(p);
		if (fs.existsSync(globalDir)) {
			for (const entry of fs.readdirSync(globalDir, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const name = entry.name;
				const marker = path.join(globalDir, name, p.skills.marker);
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
					profile: p.id,
				});
			}
		}

		// 2. Project skills. Specific project → just that one; null → all known projects.
		const projectPaths = ctx.project ? [ctx.project] : allProjectPaths(p);
		for (const proj of projectPaths) {
			const projDir = projectSkillsDir(proj, p);
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
				const marker = path.join(projDir, name, p.skills.marker);
				if (!fs.existsSync(marker)) continue;
				// Skip if a global skill with the same name already exists (global shadows project).
				if (out.some((i) => i.kind === 'skill' && i.origin === 'global' && i.name === name)) continue;
				const scope: Scope = { level: 'project', path: proj };
				// Project-origin skill: read project-level override (default inherited → enabled).
			let prStatus: Status = 'inherited';
			try { prStatus = readOverride(readProject(proj, p), name, p); } catch { /* default inherited */ }
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
					profile: p.id,
				});
			}
		}

		out.sort((a, b) => a.name.localeCompare(b.name));
		return out;
	}

	/** Build per-scope status list: [user, ...project?]. Order matters for resolveEffective. */
	private statuses(name: string, project: string | null): ScopeStatus[] {
		const p = this.profile;
		let userStatus: Status = 'inherited';
		try { userStatus = readOverride(readUser(p), name, p); } catch { /* default inherited */ }
		const v: ScopeStatus[] = [{ scope: { level: 'user' }, status: userStatus }];
		if (project) {
			let prStatus: Status = 'inherited';
			try { prStatus = readOverride(readProject(project, p), name, p); } catch { /* default inherited */ }
			v.push({ scope: { level: 'project', path: project }, status: prStatus });
		}
		return v;
	}

	setStatus(name: string, scope: Scope, status: Status, _ctx: ScopeCtx): void {
		const p = this.profile;
		if (scope.level === 'user') {
			const s = readUser(p);
			writeOverride(s, name, status, p);
			writeUser(p, s);
		} else {
			const s = readProject(scope.path, p);
			writeOverride(s, name, status, p);
			writeProject(scope.path, p, s);
		}
	}

	view(name: string): ToolContent {
		const p = this.profile;
		const fp = path.join(globalSkillsDir(p), name, p.skills.marker);
		const raw = fs.readFileSync(fp, 'utf8'); // throws → caller maps to 404/error
		return { kind: 'skill', name, raw };
	}
}
