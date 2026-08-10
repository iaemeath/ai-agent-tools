// MCP routes — read-only list + detail + open-in-explorer.

import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { profileOf } from '../profiles.js';
import { listMcps } from '../mcp-reader.js';
import type { McpServer } from '../model.js';

export const mcps = new Hono();

/** Find one server by name + scope (+ project when project-scoped). */
function findServer(all: McpServer[], name: string, scope: string, project: string | null): McpServer | undefined {
	return all.find(
		(s) => s.name === name && s.scope === scope && (s.project ?? null) === (project ?? null),
	);
}

/** GET /api/mcps?tool= — list all MCP servers (user-level + project-level). */
mcps.get('/', (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	return c.json(listMcps(profile));
});

/**
 * GET /api/mcps/detail?tool=&name=&scope=&project=
 * Return the full config of one server. `project` is required for project-scoped servers.
 */
mcps.get('/detail', (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	const name = c.req.query('name') ?? '';
	const scope = c.req.query('scope') ?? 'user';
	const project = c.req.query('project') ? decodeURIComponent(c.req.query('project')!) : null;
	if (!name) return c.json({ error: 'name is required' }, 400);
	const match = findServer(listMcps(profile), name, scope, project);
	if (!match) return c.json({ error: 'mcp server not found' }, 404);
	return c.json(match);
});

/**
 * POST /api/mcps/open — body: { sourceFile, tool }
 * Open the config file in the OS file manager, selected. Uses execFile (no shell) to
 * prevent command injection. The path must match a known MCP source file.
 */
mcps.post('/open', async (c) => {
	const body = await c.req.json<{ sourceFile: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const requested = body.sourceFile ?? '';
	// Whitelist: the requested path must be one of the known MCP source files.
	const known = new Set(listMcps(profile).map((s) => s.sourceFile));
	if (!known.has(requested)) {
		return c.json({ error: 'not a known MCP config file' }, 404);
	}

	return new Promise((resolve) => {
		// explorer.exe often exits non-zero even on success; treat spawn failure (ENOENT)
		// and stderr as real errors, everything else as success.
		const child = execFile('explorer.exe', [`/select,${requested}`], (err, _stdout, stderr) => {
			if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
				resolve(c.json({ error: 'explorer.exe not found' }, 500));
			} else if (stderr) {
				resolve(c.json({ error: stderr }, 500));
			} else {
				resolve(c.json({ ok: true }));
			}
		});
		child.on('error', () => resolve(c.json({ error: 'failed to spawn explorer' }, 500)));
	});
});
