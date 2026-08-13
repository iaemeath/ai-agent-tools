// Agent routes — read-only list + content + open-in-explorer.
// Mirrors routes/rules.ts security model: /content and /open re-derive the
// known-paths whitelist from listAgents(profile) and match via normPath,
// so an attacker-supplied path can never read/open a file outside the agents dirs.

import { Hono } from 'hono';
import { profileOf } from '../profiles.js';
import { listAgents, readAgent } from '../agents-reader.js';
import { writeText } from '../settings.js';
import { revealInExplorer } from '../explorer.js';

export const agents = new Hono();

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ':');
}

/** GET /api/agents?tool= — list global + project agent files. */
agents.get('/', (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	return c.json(listAgents(profile));
});

/** GET /api/agents/content?path=<encoded>&tool= */
agents.get('/content', (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	const requested = c.req.query('path') ?? '';
	const decoded = decodeURIComponent(requested);
	const known = listAgents(profile).map((r) => r.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not an agent file' }, 404);
	const raw = readAgent(match);
	if (raw === null) return c.json({ error: 'cannot read file' }, 500);
	return c.json({ path: match, raw });
});

/** POST /api/agents/open — body: { path, tool } */
agents.post('/open', async (c) => {
	const body = await c.req.json<{ path: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const decoded = decodeURIComponent(body.path ?? '');
	const known = listAgents(profile).map((r) => r.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not an agent file' }, 404);
	return revealInExplorer(c, match);
});

/** POST /api/agents/save — body: { path, content, tool? }. Whitelist + .bak backup (same as instructions). */
agents.post('/save', async (c) => {
	const body = await c.req.json<{ path: string; content: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const decoded = decodeURIComponent(body.path ?? '');
	const known = listAgents(profile).map((r) => r.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not an agent file' }, 404);
	try {
		writeText(match, body.content ?? '');
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true, path: match });
});
