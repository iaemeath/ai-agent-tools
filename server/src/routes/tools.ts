// Tool routes — ported from get_overview / get_tool_detail / set_tool_status / view_tool_content.

import { Hono } from 'hono';
import { adapterFor } from '../adapters/types.js';
import { overview } from '../scan.js';
import type { Scope, Status, ToolKind } from '../model.js';

export const tools = new Hono();

const KINDS: ToolKind[] = ['skill', 'plugin'];
function isKind(s: string): s is ToolKind {
	return KINDS.includes(s as ToolKind);
}

/** GET /api/tools/overview?project=<path|null> */
tools.get('/overview', (c) => {
	const raw = c.req.query('project');
	// "null" string or missing → overview mode (scan all projects).
	const project = !raw || raw === 'null' ? null : raw;
	return c.json(overview(project));
});

/** GET /api/tools/:kind/:name/detail?project= → per-scope status list. */
tools.get('/:kind/:name/detail', (c) => {
	const kind = c.req.param('kind');
	const name = c.req.param('name');
	const project = c.req.query('project') ?? null;
	if (!isKind(kind)) return c.json({ error: 'unsupported kind' }, 400);
	const a = adapterFor(kind);
	if (!a) return c.json({ error: 'unsupported kind' }, 400);
	const items = a.scan({ project });
	const it = items.find((i) => i.name === name);
	if (!it) return c.json({ error: 'not found' }, 404);
	return c.json(it.perScope);
});

/** POST /api/tools/status — body: { kind, name, scope, status, project }. */
tools.post('/status', async (c) => {
	const body = await c.req.json<{ kind: string; name: string; scope: Scope; status: Status; project: string | null }>();
	if (!isKind(body.kind)) return c.json({ error: 'unsupported kind' }, 400);
	const a = adapterFor(body.kind);
	if (!a) return c.json({ error: 'unsupported kind' }, 400);
	try {
		a.setStatus(body.name, body.scope, body.status, { project: body.project ?? null });
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true });
});

/** GET /api/tools/:kind/:name/content → raw tool content. */
tools.get('/:kind/:name/content', (c) => {
	const kind = c.req.param('kind');
	const name = c.req.param('name');
	if (!isKind(kind)) return c.json({ error: 'unsupported kind' }, 400);
	const a = adapterFor(kind);
	if (!a) return c.json({ error: 'unsupported kind' }, 400);
	try {
		return c.json(a.view(name));
	} catch (e) {
		return c.json({ error: (e as Error).message }, 404);
	}
});
