// Skill routes — ported from src-tauri/src/commands.rs promote_skill.
// promote = copy {project}/<prefix>/skills/{name}/ → ~/<configDir>/skills/{name}/, then remove source.

import path from 'node:path';
import { Hono } from 'hono';
import { globalSkillsDir, projectSkillsDir } from '../paths.js';
import { profileOf } from '../profiles.js';
import { getFs, getHostCtx } from '../hosts/context.js';
import { sendRemote } from '../remote/runner.js';
import type { StatResult } from '../fs-backend/types.js';

export const skills = new Hono();

/** Reject names containing path separators or traversal (project path is NOT name-checked). */
function isValidName(name: string): boolean {
	return name !== '' && !name.includes('/') && !name.includes('\\')
		&& !name.includes('..') && !name.includes('\0');
}

/** Stat a path; null if it does not exist (single round-trip). */
async function tryStat(p: string): Promise<StatResult | null> {
	try {
		return await getFs().stat(p);
	} catch {
		return null;
	}
}

/** POST /api/skills/promote — body: { name, project, tool? }. */
skills.post('/promote', async (c) => {
	const { name, project, tool } = await c.req.json<{ name: string; project: string; tool?: string }>();
	if (!isValidName(name)) return c.json({ error: 'invalid skill name' }, 400);
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'skills.promote', { name, project, tool });
	}
	const profile = profileOf(tool ?? 'claude');

	const src = path.join(projectSkillsDir(project, profile), name);
	const dst = path.join(globalSkillsDir(profile), name);

	const srcStat = await tryStat(src);
	if (!srcStat?.isDirectory) {
		return c.json({ error: 'project skill not found' }, 404);
	}
	if (await getFs().exists(dst)) {
		return c.json({ error: 'a global skill with this name already exists' }, 409);
	}

	// Canonicalize and verify src is contained inside project (defeats crafted project strings).
	let projCanonical: string;
	let srcCanonical: string;
	try {
		projCanonical = await getFs().realpath(project);
		srcCanonical = await getFs().realpath(src);
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
	const sep = path.sep;
	const contained = srcCanonical === projCanonical
		|| srcCanonical.startsWith(projCanonical + sep);
	if (!contained) return c.json({ error: 'skill path must be inside the project' }, 400);

	try {
		await getFs().copy(srcCanonical, dst, { recursive: true });
		await getFs().remove(srcCanonical, { recursive: true });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true });
});

/**
 * POST /api/skills/delete — body: { name, scope: 'user' | 'project', project?, tool? }.
 * Removes the skill directory from disk. Global → ~/<configDir>/skills/<name>;
 * project → {project}/<prefix>/skills/<name> (with canonicalize containment check).
 */
skills.post('/delete', async (c) => {
	const body = await c.req.json<{ name: string; scope: 'user' | 'project'; project?: string; tool?: string }>();
	const { name, scope, project } = body;
	if (!isValidName(name)) return c.json({ error: 'invalid skill name' }, 400);
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'skills.delete', body);
	}
	const profile = profileOf(body.tool ?? 'claude');

	const isProject = scope === 'project';
	if (isProject && !project) return c.json({ error: 'project required for project scope' }, 400);

	const base = isProject ? projectSkillsDir(project!, profile) : globalSkillsDir(profile);
	const target = path.join(base, name);

	const targetStat = await tryStat(target);
	if (!targetStat?.isDirectory) {
		return c.json({ error: 'skill not found' }, 404);
	}

	// Canonicalize and verify target is contained inside its base dir.
	let baseCanonical: string;
	let targetCanonical: string;
	try {
		baseCanonical = isProject ? await getFs().realpath(project!) : await getFs().realpath(base);
		targetCanonical = await getFs().realpath(target);
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
	const sep = path.sep;
	const contained = targetCanonical === baseCanonical
		|| targetCanonical.startsWith(baseCanonical + sep);
	if (!contained) return c.json({ error: 'skill path must be inside its base' }, 400);

	try {
		await getFs().remove(targetCanonical, { recursive: true });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true });
});

// ---- File browser endpoints (read-only, for skill detail view) ----

const SKILL_TEXT_EXTENSIONS = new Set([
	'.md', '.json', '.txt', '.mjs', '.js', '.ts', '.vue', '.yaml', '.yml',
	'.xml', '.html', '.htm', '.css', '.scss', '.sh', '.py', '.java',
]);
const SKILL_MAX_PREVIEW = 512 * 1024;
const SKILL_HIDDEN_DIRS = new Set(['node_modules', '.git', '__pycache__']);

/** Resolve a skill's root directory by name + scope (+ project). Returns null if not found. */
async function resolveSkillDir(name: string, scope: 'user' | 'project', project: string | null, profile: ReturnType<typeof profileOf>): Promise<string | null> {
	if (!isValidName(name)) return null;
	const base = scope === 'project' && project ? projectSkillsDir(project, profile) : globalSkillsDir(profile);
	const dir = path.join(base, name);
	const st = await tryStat(dir);
	if (!st?.isDirectory) return null;
	return dir;
}

/** Resolve + validate a subpath inside the skill dir (traversal guard). */
function resolveSkillPath(skillDir: string, subpath: string | undefined): string | null {
	const rel = (subpath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
	if (!rel) return skillDir;
	if (/^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return null;
	const abs = path.resolve(skillDir, rel);
	if (abs !== skillDir && !abs.startsWith(skillDir + path.sep)) return null;
	return abs;
}

/**
 * GET /api/skills/:name/files?scope=&project=&subpath=&tool=
 * List one directory level inside a skill dir.
 */
skills.get('/:name/files', async (c) => {
	const name = decodeURIComponent(c.req.param('name'));
	const scope = (c.req.query('scope') ?? 'user') as 'user' | 'project';
	const project = c.req.query('project') ? decodeURIComponent(c.req.query('project')!) : null;
	const tool = c.req.query('tool') ?? 'claude';
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'skills.files', { name, scope, project, subpath: c.req.query('subpath'), tool });
	}
	const profile = profileOf(tool);
	const skillDir = await resolveSkillDir(name, scope, project, profile);
	if (!skillDir) return c.json({ error: 'skill not found' }, 404);
	const abs = resolveSkillPath(skillDir, c.req.query('subpath'));
	if (!abs) return c.json({ error: 'path outside skill dir' }, 403);

	let stats: StatResult;
	try { stats = await getFs().stat(abs); } catch { return c.json({ error: 'path not found' }, 404); }
	if (!stats.isDirectory) return c.json({ error: 'not a directory' }, 400);

	const entries: { name: string; isDir: boolean }[] = [];
	try {
		for (const e of await getFs().readDir(abs)) {
			if (e.isDirectory) {
				if (SKILL_HIDDEN_DIRS.has(e.name)) continue;
				entries.push({ name: e.name, isDir: true });
			} else if (e.isFile) {
				entries.push({ name: e.name, isDir: false });
			}
		}
	} catch { return c.json({ error: 'cannot read directory' }, 500); }
	entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
	return c.json({ entries, root: skillDir });
});

/**
 * GET /api/skills/:name/file-content?scope=&project=&subpath=&tool=
 * Read one text file inside a skill dir.
 */
skills.get('/:name/file-content', async (c) => {
	const name = decodeURIComponent(c.req.param('name'));
	const scope = (c.req.query('scope') ?? 'user') as 'user' | 'project';
	const project = c.req.query('project') ? decodeURIComponent(c.req.query('project')!) : null;
	const tool = c.req.query('tool') ?? 'claude';
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'skills.fileContent', { name, scope, project, subpath: c.req.query('subpath'), tool });
	}
	const profile = profileOf(tool);
	const skillDir = await resolveSkillDir(name, scope, project, profile);
	if (!skillDir) return c.json({ error: 'skill not found' }, 404);
	const abs = resolveSkillPath(skillDir, c.req.query('subpath'));
	if (!abs) return c.json({ error: 'path outside skill dir' }, 403);

	let stats: StatResult;
	try { stats = await getFs().stat(abs); } catch { return c.json({ error: 'file not found' }, 404); }
	if (stats.isDirectory) return c.json({ error: 'path is a directory' }, 400);
	if (stats.size > SKILL_MAX_PREVIEW) return c.json({ error: 'file too large (>512KB)' }, 413);
	const ext = path.extname(abs).toLowerCase();
	if (!SKILL_TEXT_EXTENSIONS.has(ext)) return c.json({ error: 'binary or unsupported file type' }, 415);
	try {
		const raw = await getFs().readFile(abs);
		return c.json({ name: path.basename(abs), raw, ext });
	} catch { return c.json({ error: 'cannot read file' }, 500); }
});
