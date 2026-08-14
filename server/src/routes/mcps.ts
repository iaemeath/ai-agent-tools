// MCP routes — read-only list + detail + live tool probe + open-in-explorer.

import { Hono } from 'hono';
import { profileOf } from '../profiles.js';
import { listMcps } from '../mcp-reader.js';
import { listMcpTools } from '../mcp-tools.js';
import { revealInExplorer } from '../explorer.js';
import { getHostCtx } from '../hosts/context.js';
import { sendRemote } from '../remote/runner.js';
import type { McpServer } from '../model.js';

export const mcps = new Hono();

/** Find one server by name + scope (+ project when project-scoped). */
function findServer(all: McpServer[], name: string, scope: string, project: string | null): McpServer | undefined {
	return all.find(
		(s) => s.name === name && s.scope === scope && (s.project ?? null) === (project ?? null),
	);
}

/** GET /api/mcps?tool= — list all MCP servers (user-level + project-level). */
mcps.get('/', async (c) => {
	const tool = c.req.query('tool') ?? 'claude';
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'mcps.list', { tool });
	}
	return c.json(await listMcps(profileOf(tool)));
});

/**
 * GET /api/mcps/detail?tool=&name=&scope=&project=
 * Return the full config of one server. `project` is required for project-scoped servers.
 */
mcps.get('/detail', async (c) => {
	const tool = c.req.query('tool') ?? 'claude';
	const name = c.req.query('name') ?? '';
	const scope = c.req.query('scope') ?? 'user';
	const project = c.req.query('project') ? decodeURIComponent(c.req.query('project')!) : null;
	if (!name) return c.json({ error: 'name is required' }, 400);
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'mcps.detail', { name, scope, project, tool });
	}
	const match = findServer(await listMcps(profileOf(tool)), name, scope, project);
	if (!match) return c.json({ error: 'mcp server not found' }, 404);
	return c.json(match);
});

/**
 * GET /api/mcps/tools?tool=&name=&scope=&project=
 * Live-probe one server: connect (stdio/http/sse), run the MCP handshake, and return
 * the tools it exposes (`{name, description}`). Always responds 200 — a connection
 * failure comes back as `{ tools: [], error: "…" }` so the UI can show it inline
 * rather than treating it as a transport-level error. On a remote host the probe runs
 * THERE (spawn/fetch originate from the remote — semantically what the remote tool sees).
 */
mcps.get('/tools', async (c) => {
	const tool = c.req.query('tool') ?? 'claude';
	const name = c.req.query('name') ?? '';
	const scope = c.req.query('scope') ?? 'user';
	const project = c.req.query('project') ? decodeURIComponent(c.req.query('project')!) : null;
	if (!name) return c.json({ error: 'name is required' }, 400);
	if (getHostCtx().isRemote) {
		return sendRemote(c, 'mcps.tools', { name, scope, project, tool });
	}
	const match = findServer(await listMcps(profileOf(tool)), name, scope, project);
	if (!match) return c.json({ error: 'mcp server not found' }, 404);
	try {
		const tools = await listMcpTools(match);
		return c.json({ tools });
	} catch (e) {
		return c.json({ tools: [], error: (e as Error).message });
	}
});

/**
 * POST /api/mcps/open — body: { sourceFile, tool }
 * Open the config file in the OS file manager, selected. The path must match a known
 * MCP source file. explorer.exe is spawned via execFile (no shell) — no injection.
 */
mcps.post('/open', async (c) => {
	const body = await c.req.json<{ sourceFile: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const requested = body.sourceFile ?? '';
	// Whitelist: the requested path must be one of the known MCP source files.
	const known = new Set((await listMcps(profile)).map((s) => s.sourceFile));
	if (!known.has(requested)) {
		return c.json({ error: 'not a known MCP config file' }, 404);
	}
	return revealInExplorer(c, requested);
});
