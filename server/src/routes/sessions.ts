// Session routes — list a project's sessions + read one session's full transcript.
// Read-only. Tools without a transcripts locator get a clean 400 the UI renders
// as an unsupported state (Phase A: ZCode only).

import { Hono } from 'hono';
import { profileOf } from '../profiles.js';
import { isValidSessionId, listSessions, readSession } from '../sessions-reader.js';
import { getHostCtx } from '../hosts/context.js';
import { sendRemote } from '../remote/runner.js';

export const sessions = new Hono();

/** GET /api/sessions?tool=&project=<encoded> — list sessions for one project. */
sessions.get('/', async (c) => {
	const tool = c.req.query('tool') ?? 'claude';
	const project = c.req.query('project');
	if (!project) return c.json({ error: 'missing project' }, 400);
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'sessions.list', { tool, project });
	}
	const profile = profileOf(tool);
	if (!profile.transcripts) return c.json({ error: 'unsupported', reason: 'this tool has no transcript support yet' }, 400);
	return c.json(await listSessions(profile, project));
});

/** GET /api/sessions/:id?tool= — read one session (main flow + subagent flows). */
sessions.get('/:id', async (c) => {
	const id = c.req.param('id');
	if (!isValidSessionId(id)) return c.json({ error: 'invalid session id' }, 400);
	const tool = c.req.query('tool') ?? 'claude';
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'sessions.read', { tool, id });
	}
	const profile = profileOf(tool);
	if (!profile.transcripts) return c.json({ error: 'unsupported', reason: 'this tool has no transcript support yet' }, 400);
	const read = await readSession(profile, id);
	if (!read) return c.json({ error: 'session not found or no transcript content' }, 404);
	return c.json(read);
});
