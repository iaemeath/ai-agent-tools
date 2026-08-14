// Tool routes — ported from get_overview / get_tool_detail / set_tool_status / view_tool_content.

import { Hono } from 'hono';
import { adapterFor } from '../adapters/types.js';
import { overview } from '../scan.js';
import { profileOf } from '../profiles.js';
import { getHostCtx } from '../hosts/context.js';
import { sendRemote } from '../remote/runner.js';
import type { Scope, Status, ToolKind } from '../model.js';

export const tools = new Hono();

const KINDS: ToolKind[] = ['skill', 'plugin'];
function isKind(s: string): s is ToolKind {
	return KINDS.includes(s as ToolKind);
}

/** Resolve ?tool= into a profile (defaults to claude). */
function profileParam(tool: string | undefined) {
	return profileOf(tool ?? 'claude');
}

/** GET /api/tools/overview?project=<path|null>&tool=<claude|zcode> */
tools.get('/overview', async (c) => {
	const raw = c.req.query('project');
	// "null" string or missing → overview mode (scan all projects).
	const project = !raw || raw === 'null' ? null : raw;
	const tool = c.req.query('tool');
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'overview', { project, tool });
	}
	const profile = profileParam(tool);
	return c.json(await overview(project, profile));
});

/** GET /api/tools/:kind/:name/detail?project=&tool= → per-scope status list. */
tools.get('/:kind/:name/detail', async (c) => {
	const kind = c.req.param('kind');
	const name = c.req.param('name');
	const project = c.req.query('project') ?? null;
	const tool = c.req.query('tool');
	if (!isKind(kind)) return c.json({ error: 'unsupported kind' }, 400);
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'tools.detail', { kind, name, project, tool });
	}
	const a = adapterFor(kind, profileParam(tool));
	if (!a) return c.json({ error: 'unsupported kind' }, 400);
	const items = await a.scan({ project, profile: profileParam(tool) });
	const it = items.find((i) => i.name === name);
	if (!it) return c.json({ error: 'not found' }, 404);
	return c.json(it.perScope);
});

/** POST /api/tools/status — body: { kind, name, scope, status, project, tool }. */
tools.post('/status', async (c) => {
	const body = await c.req.json<{ kind: string; name: string; scope: Scope; status: Status; project: string | null; tool?: string }>();
	if (!isKind(body.kind)) return c.json({ error: 'unsupported kind' }, 400);
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'tools.setStatus', body);
	}
	const a = adapterFor(body.kind, profileParam(body.tool));
	if (!a) return c.json({ error: 'unsupported kind' }, 400);
	try {
		await a.setStatus(body.name, body.scope, body.status, { project: body.project ?? null, profile: profileParam(body.tool) });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true });
});

/** GET /api/tools/:kind/:name/content?tool= → raw tool content. */
tools.get('/:kind/:name/content', async (c) => {
	const kind = c.req.param('kind');
	const name = c.req.param('name');
	const tool = c.req.query('tool');
	if (!isKind(kind)) return c.json({ error: 'unsupported kind' }, 400);
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'tools.content', { kind, name, tool });
	}
	const a = adapterFor(kind, profileParam(tool));
	if (!a) return c.json({ error: 'unsupported kind' }, 400);
	try {
		return c.json(await a.view(name));
	} catch (e) {
		return c.json({ error: (e as Error).message }, 404);
	}
});
