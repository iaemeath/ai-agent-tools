// Command routes — read-only list + content + open-in-explorer.
// Mirrors routes/rules.ts security model: /content and /open re-derive the
// known-paths whitelist from listCommands(profile) and match via normPath,
// so an attacker-supplied path can never read/open a file outside the commands dirs.

import { Hono } from 'hono';
import { profileOf } from '../profiles.js';
import { listCommands, readCommand } from '../commands-reader.js';
import { writeText } from '../settings.js';
import { revealInExplorer } from '../explorer.js';
import { getHostCtx } from '../hosts/context.js';
import { sendRemote } from '../remote/runner.js';

export const commands = new Hono();

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ':');
}

/** GET /api/commands?tool= — list global + project command files. */
commands.get('/', async (c) => {
	const tool = c.req.query('tool') ?? 'claude';
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'md.list', { resource: 'commands', tool });
	}
	return c.json(await listCommands(profileOf(tool)));
});

/** GET /api/commands/content?path=<encoded>&tool= */
commands.get('/content', async (c) => {
	const tool = c.req.query('tool') ?? 'claude';
	const decoded = decodeURIComponent(c.req.query('path') ?? '');
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'md.content', { resource: 'commands', path: decoded, tool });
	}
	const profile = profileOf(tool);
	const known = (await listCommands(profile)).map((r) => r.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not a command file' }, 404);
	const raw = await readCommand(match);
	if (raw === null) return c.json({ error: 'cannot read file' }, 500);
	return c.json({ path: match, raw });
});

/** POST /api/commands/open — body: { path, tool } */
commands.post('/open', async (c) => {
	const body = await c.req.json<{ path: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const decoded = decodeURIComponent(body.path ?? '');
	const known = (await listCommands(profile)).map((r) => r.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not a command file' }, 404);
	return revealInExplorer(c, match);
});

/** POST /api/commands/save — body: { path, content, tool? }. Whitelist + .bak backup (same as instructions). */
commands.post('/save', async (c) => {
	const body = await c.req.json<{ path: string; content: string; tool?: string }>();
	const tool = body.tool ?? 'claude';
	const decoded = decodeURIComponent(body.path ?? '');
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'md.save', { resource: 'commands', path: decoded, content: body.content ?? '', tool });
	}
	const profile = profileOf(tool);
	const known = (await listCommands(profile)).map((r) => r.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not a command file' }, 404);
	try {
		await writeText(match, body.content ?? '');
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true, path: match });
});
