// Skill routes — ported from src-tauri/src/commands.rs promote_skill.
// promote = copy {project}/.claude/skills/{name}/ → ~/.claude/skills/{name}/, then remove source.

import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { globalSkillsDir, projectSkillsDir } from '../paths.js';

export const skills = new Hono();

/** Reject names containing path separators or traversal (project path is NOT name-checked). */
function isValidName(name: string): boolean {
	return name !== '' && !name.includes('/') && !name.includes('\\')
		&& !name.includes('..') && !name.includes('\0');
}

/** POST /api/skills/promote — body: { name, project }. */
skills.post('/promote', async (c) => {
	const { name, project } = await c.req.json<{ name: string; project: string }>();
	if (!isValidName(name)) return c.json({ error: 'invalid skill name' }, 400);

	const src = path.join(projectSkillsDir(project), name);
	const dst = path.join(globalSkillsDir(), name);

	if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
		return c.json({ error: 'project skill not found' }, 404);
	}
	if (fs.existsSync(dst)) {
		return c.json({ error: 'a global skill with this name already exists' }, 409);
	}

	// Canonicalize and verify src is contained inside project (defeats crafted project strings).
	let projCanonical: string;
	let srcCanonical: string;
	try {
		projCanonical = fs.realpathSync(project);
		srcCanonical = fs.realpathSync(src);
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
	const sep = path.sep;
	const contained = srcCanonical === projCanonical
		|| srcCanonical.startsWith(projCanonical + sep);
	if (!contained) return c.json({ error: 'skill path must be inside the project' }, 400);

	try {
		fs.cpSync(srcCanonical, dst, { recursive: true });
		fs.rmSync(srcCanonical, { recursive: true });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true });
});

/**
 * POST /api/skills/delete — body: { name, scope: 'user' | 'project', project? }.
 * Removes the skill directory from disk. Global → ~/.claude/skills/<name>;
 * project → {project}/.claude/skills/<name> (with canonicalize containment check).
 */
skills.post('/delete', async (c) => {
	const { name, scope, project } = await c.req.json<{ name: string; scope: 'user' | 'project'; project?: string }>();
	if (!isValidName(name)) return c.json({ error: 'invalid skill name' }, 400);

	const isProject = scope === 'project';
	if (isProject && !project) return c.json({ error: 'project required for project scope' }, 400);

	const base = isProject ? projectSkillsDir(project!) : globalSkillsDir();
	const target = path.join(base, name);

	if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
		return c.json({ error: 'skill not found' }, 404);
	}

	// Canonicalize and verify target is contained inside its base dir.
	let baseCanonical: string;
	let targetCanonical: string;
	try {
		baseCanonical = isProject ? fs.realpathSync(project!) : fs.realpathSync(base);
		targetCanonical = fs.realpathSync(target);
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
	const sep = path.sep;
	const contained = targetCanonical === baseCanonical
		|| targetCanonical.startsWith(baseCanonical + sep);
	if (!contained) return c.json({ error: 'skill path must be inside its base' }, 400);

	try {
		fs.rmSync(targetCanonical, { recursive: true });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true });
});
