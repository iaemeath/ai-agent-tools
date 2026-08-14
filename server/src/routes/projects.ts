// Project routes — list + delete, delegating to the tool-agnostic projects-reader.

import { Hono } from 'hono';
import { profileOf } from '../profiles.js';
import { listProjects, deleteProject } from '../projects-reader.js';
import { getHostCtx } from '../hosts/context.js';
import { sendRemote } from '../remote/runner.js';

export const projects = new Hono();

/** Reject bare folder names containing path separators or traversal. */
function isValidEncoded(encoded: string): boolean {
	return encoded !== '' && !encoded.includes('..') && !encoded.includes('\0');
}

/** GET /api/projects?tool=<claude|zcode> — list projects for the tool. */
projects.get('/', async (c) => {
	const tool = c.req.query('tool') ?? 'claude';
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'projects.list', { tool });
	}
	return c.json(await listProjects(profileOf(tool)));
});

/** DELETE /api/projects/:encoded?tool= — delete session history for one project. */
projects.delete('/:encoded', async (c) => {
	const encoded = decodeURIComponent(c.req.param('encoded'));
	if (!isValidEncoded(encoded)) return c.json({ error: 'invalid project id' }, 400);
	const tool = c.req.query('tool') ?? 'claude';
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'projects.delete', { encoded, tool });
	}
	const ok = await deleteProject(profileOf(tool), encoded);
	if (!ok) return c.json({ error: 'project not found or not removable' }, 404);
	return c.json({ ok: true });
});
