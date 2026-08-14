// Tool routes — ported from get_overview / get_tool_detail / set_tool_status / view_tool_content.

import { Hono } from 'hono';
import { adapterFor } from '../adapters/types.js';
import { overview } from '../scan.js';
import { profileOf } from '../profiles.js';
import { getHostCtx } from '../hosts/context.js';
import { execRemote } from '../remote/runner.js';
import type { Scope, Status, ToolKind, ToolOverview } from '../model.js';

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
	const ctx = getHostCtx();
	// Remote host: run the scan on the remote itself (one exec) instead of N SFTP round-trips.
	if (ctx.isRemote) {
		try {
			return c.json(await execRemote<ToolOverview>(ctx.hostId, 'overview', { project, tool }));
		} catch (e) {
			return c.json({ error: `remote overview failed: ${(e as Error).message}` }, 502);
		}
	}
	const profile = profileParam(tool);
	return c.json(await overview(project, profile));
});

/** GET /api/tools/:kind/:name/detail?project=&tool= → per-scope status list. */
tools.get('/:kind/:name/detail', async (c) => {
	const kind = c.req.param('kind');
	const name = c.req.param('name');
	const project = c.req.query('project') ?? null;
	const profile = profileParam(c.req.query('tool'));
	if (!isKind(kind)) return c.json({ error: 'unsupported kind' }, 400);
	const a = adapterFor(kind, profile);
	if (!a) return c.json({ error: 'unsupported kind' }, 400);
	const items = await a.scan({ project, profile });
	const it = items.find((i) => i.name === name);
	if (!it) return c.json({ error: 'not found' }, 404);
	return c.json(it.perScope);
});

/** POST /api/tools/status — body: { kind, name, scope, status, project, tool }. */
tools.post('/status', async (c) => {
	const body = await c.req.json<{ kind: string; name: string; scope: Scope; status: Status; project: string | null; tool?: string }>();
	const profile = profileParam(body.tool);
	if (!isKind(body.kind)) return c.json({ error: 'unsupported kind' }, 400);
	const a = adapterFor(body.kind, profile);
	if (!a) return c.json({ error: 'unsupported kind' }, 400);
	try {
		await a.setStatus(body.name, body.scope, body.status, { project: body.project ?? null, profile });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true });
});

/** GET /api/tools/:kind/:name/content?tool= → raw tool content. */
tools.get('/:kind/:name/content', async (c) => {
	const kind = c.req.param('kind');
	const name = c.req.param('name');
	const profile = profileParam(c.req.query('tool'));
	if (!isKind(kind)) return c.json({ error: 'unsupported kind' }, 400);
	const a = adapterFor(kind, profile);
	if (!a) return c.json({ error: 'unsupported kind' }, 400);
	try {
		return c.json(await a.view(name));
	} catch (e) {
		return c.json({ error: (e as Error).message }, 404);
	}
});
