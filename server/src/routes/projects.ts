// Project routes — list + delete, delegating to the tool-agnostic projects-reader.

import { Hono } from 'hono';
import { profileOf } from '../profiles.js';
import { listProjects, deleteProject } from '../projects-reader.js';

export const projects = new Hono();

/** Reject bare folder names containing path separators or traversal. */
function isValidEncoded(encoded: string): boolean {
	return encoded !== '' && !encoded.includes('..') && !encoded.includes('\0');
}

/** GET /api/projects?tool=<claude|zcode> — list projects for the tool. */
projects.get('/', async (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	return c.json(await listProjects(profile));
});

/** DELETE /api/projects/:encoded?tool= — delete session history for one project. */
projects.delete('/:encoded', async (c) => {
	const encoded = decodeURIComponent(c.req.param('encoded'));
	if (!isValidEncoded(encoded)) return c.json({ error: 'invalid project id' }, 400);
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	const ok = await deleteProject(profile, encoded);
	if (!ok) return c.json({ error: 'project not found or not removable' }, 404);
	return c.json({ ok: true });
});
