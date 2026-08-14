// SkillAdapter — ported from src-tauri/src/adapters/skill.rs.
// Skills live in <configRoot>/skills/<name>/ (global) or {project}/<prefix>/skills/<name>/ (project).
// Toggle key: skillOverrides in settings (on/off/name-only/user-only).

import path from 'node:path';
import { readProject, readUser, writeProject, writeUser } from '../settings.js';
import { globalSkillsDir, projectSkillsDir } from '../paths.js';
import { listProjects } from '../projects-reader.js';
import { DEFAULT_PROFILE, type ToolProfile } from '../profiles.js';
import {
	type Mechanism, type Origin, resolveEffective, type ScanCtx, type Scope, type ScopeCtx,
	type ScopeStatus, type Status, type ToolContent, type ToolInstance,
} from '../model.js';
import { readFlag, writeFlag } from '../locator.js';
import { getFs } from '../hosts/context.js';
import type { DirentLike } from '../fs-backend/types.js';
import type { ToolAdapter } from './types.js';

type Json = Record<string, unknown>;

/** Read skillOverrides[name] for the given profile; unknown/missing → 'inherited'. Pure in-memory. */
export function readOverride(settings: Json, name: string, p: ToolProfile = DEFAULT_PROFILE): Status {
	return readFlag(p.skills.overridesEncoding, settings, p.skills.overridesKeyPath, name);
}

/** Set skillOverrides[name] for the given profile; 'inherited' removes the key. Pure in-memory. */
export function writeOverride(settings: Json, name: string, status: Status, p: ToolProfile = DEFAULT_PROFILE): void {
	writeFlag(p.skills.overridesEncoding, settings, p.skills.overridesKeyPath, name, status);
}

/** Parse a SKILL.md front-matter description: (trimmed, quotes stripped) or first non-heading line. */
async function parseDescription(marker: string): Promise<string | null> {
	let raw: string;
	try {
		raw = await getFs().readFile(marker);
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

	async scan(ctx: ScanCtx): Promise<ToolInstance[]> {
		const out: ToolInstance[] = [];
		const p = this.profile;

		// 1. Global skills: <configRoot>/skills/*
		const globalDir = globalSkillsDir(p);
		if (await getFs().exists(globalDir)) {
			for (const entry of await getFs().readDir(globalDir)) {
				if (!entry.isDirectory) continue;
				const name = entry.name;
				const marker = path.join(globalDir, name, p.skills.marker);
				if (!(await getFs().exists(marker))) continue;
				const perScope = await this.statuses(name, ctx.project);
				out.push({
					kind: 'skill',
					name,
					description: await parseDescription(marker),
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
		// Uses listProjects (supports fs Claude + sqlite ZCode), NOT the legacy
		// allProjectPaths which was Claude-fs-only and hid project skills under ZCode.
		const projectPaths = ctx.project ? [ctx.project] : (await listProjects(p)).map((pr) => pr.path);
		for (const proj of projectPaths) {
			const projDir = projectSkillsDir(proj, p);
			if (!(await getFs().exists(projDir))) continue;
			let entries: DirentLike[];
			try {
				entries = await getFs().readDir(projDir);
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (!entry.isDirectory) continue;
				const name = entry.name;
				const marker = path.join(projDir, name, p.skills.marker);
				if (!(await getFs().exists(marker))) continue;
				// Skip if a global skill with the same name already exists (global shadows project).
				if (out.some((i) => i.kind === 'skill' && i.origin === 'global' && i.name === name)) continue;
				const scope: Scope = { level: 'project', path: proj };
				// Project-origin skill: read project-level override (default inherited → enabled).
				let prStatus: Status = 'inherited';
				try { prStatus = readOverride(await readProject(proj, p), name, p); } catch { /* default inherited */ }
				const perScope: ScopeStatus[] = [{ scope, status: prStatus }];
				out.push({
					kind: 'skill',
					name,
					description: await parseDescription(marker),
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
	private async statuses(name: string, project: string | null): Promise<ScopeStatus[]> {
		const p = this.profile;
		let userStatus: Status = 'inherited';
		try { userStatus = readOverride(await readUser(p), name, p); } catch { /* default inherited */ }
		const v: ScopeStatus[] = [{ scope: { level: 'user' }, status: userStatus }];
		if (project) {
			let prStatus: Status = 'inherited';
			try { prStatus = readOverride(await readProject(project, p), name, p); } catch { /* default inherited */ }
			v.push({ scope: { level: 'project', path: project }, status: prStatus });
		}
		return v;
	}

	async setStatus(name: string, scope: Scope, status: Status, _ctx: ScopeCtx): Promise<void> {
		const p = this.profile;
		if (scope.level === 'user') {
			const s = await readUser(p);
			writeOverride(s, name, status, p);
			await writeUser(p, s);
		} else {
			const s = await readProject(scope.path, p);
			writeOverride(s, name, status, p);
			await writeProject(scope.path, p, s);
		}
	}

	async view(name: string): Promise<ToolContent> {
		const p = this.profile;
		const fp = path.join(globalSkillsDir(p), name, p.skills.marker);
		const raw = await getFs().readFile(fp); // throws → caller maps to 404/error
		return { kind: 'skill', name, raw };
	}
}
