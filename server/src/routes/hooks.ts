// Hook routes — read-only list + open-source-file.
//
// Hooks are config entries inside settings JSON, not standalone files, so there
// is no /content endpoint (unlike rules/commands/agents). /open reveals the
// containing settings file in the file manager. Security model mirrors the other
// read-only resources: /open re-derives the known source-file set from
// listHooks(profile) and matches via normPath, so an attacker-supplied path can
// never open a file outside the hooks config files.

import { Hono } from 'hono';
import { profileOf } from '../profiles.js';
import { listHooks } from '../hooks-reader.js';
import { revealInExplorer } from '../explorer.js';

export const hooks = new Hono();

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ':');
}

/** GET /api/hooks?tool= — list all hooks (global + project), flattened. */
hooks.get('/', async (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	return c.json(await listHooks(profile));
});

/** POST /api/hooks/open — body: { sourceFile, tool } — reveal the settings file. */
hooks.post('/open', async (c) => {
	const body = await c.req.json<{ sourceFile: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const decoded = decodeURIComponent(body.sourceFile ?? '');
	// Whitelist: dedupe the source files that actually carry hooks.
	const known = [...new Set((await listHooks(profile)).map((h) => h.sourceFile))];
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not a hooks config file' }, 404);
	return revealInExplorer(c, match);
});
