// Rule routes — read-only list + content + open-in-explorer.
// Mirrors routes/instructions.ts security model: /content and /open re-derive
// the known-paths whitelist from listRules(profile) and match via normPath,
// so an attacker-supplied path can never read/open a file outside the rules dirs.

import { Hono } from 'hono';
import { profileOf } from '../profiles.js';
import { listRules, readRule } from '../rules-reader.js';
import { writeText } from '../settings.js';
import { revealInExplorer } from '../explorer.js';

export const rules = new Hono();

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ':');
}

/** GET /api/rules?tool= — list global + project rule files. */
rules.get('/', async (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	return c.json(await listRules(profile));
});

/** GET /api/rules/content?path=<encoded>&tool= */
rules.get('/content', async (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	const requested = c.req.query('path') ?? '';
	const decoded = decodeURIComponent(requested);
	const known = (await listRules(profile)).map((r) => r.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not a rule file' }, 404);
	const raw = await readRule(match);
	if (raw === null) return c.json({ error: 'cannot read file' }, 500);
	return c.json({ path: match, raw });
});

/** POST /api/rules/open — body: { path, tool } */
rules.post('/open', async (c) => {
	const body = await c.req.json<{ path: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const decoded = decodeURIComponent(body.path ?? '');
	const known = (await listRules(profile)).map((r) => r.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not a rule file' }, 404);
	return revealInExplorer(c, match);
});

/** POST /api/rules/save — body: { path, content, tool? }. Whitelist + .bak backup (same as instructions). */
rules.post('/save', async (c) => {
	const body = await c.req.json<{ path: string; content: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const decoded = decodeURIComponent(body.path ?? '');
	const known = (await listRules(profile)).map((r) => r.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not a rule file' }, 404);
	try {
		await writeText(match, body.content ?? '');
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true, path: match });
});
