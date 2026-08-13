// Instruction routes — read-only list + content + open-in-explorer.

import { Hono } from 'hono';
import { profileOf } from '../profiles.js';
import { listInstructions, readInstruction } from '../instructions-reader.js';
import { writeText } from '../settings.js';
import { revealInExplorer } from '../explorer.js';

export const instructions = new Hono();

/** Normalize a path for comparison: forward slashes + lowercase drive letter on Windows. */
function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ':');
}

/** GET /api/instructions?tool= — list global + project instruction files. */
instructions.get('/', (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	return c.json(listInstructions(profile));
});

/**
 * GET /api/instructions/content?path=<encoded>&tool=
 * Read one instruction file's raw content. The path must match a file returned
 * by listInstructions for this tool (defense against arbitrary file reads).
 */
instructions.get('/content', (c) => {
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	const requested = c.req.query('path') ?? '';
	// Allow the path to be encoded (encodeURIComponent on the client side).
	const decoded = decodeURIComponent(requested);
	// Validate: the requested path must be one of the known instruction files.
	// Compare with normalized separators (front-slash vs back-slash on Windows).
	const known = listInstructions(profile).map((i) => i.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not an instruction file' }, 404);
	const raw = readInstruction(match);
	if (raw === null) return c.json({ error: 'cannot read file' }, 500);
	return c.json({ path: match, raw });
});

/**
 * POST /api/instructions/open — body: { path, tool }
 * Open the file's containing folder in the OS file manager, with the file selected.
 * Windows: `explorer /select,"path"`. Path must be a known instruction file.
 * Uses execFile (no shell) to prevent command injection.
 */
instructions.post('/open', async (c) => {
	const body = await c.req.json<{ path: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const decoded = decodeURIComponent(body.path ?? '');
	const known = listInstructions(profile).map((i) => i.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not an instruction file' }, 404);
	return revealInExplorer(c, match);
});

/**
 * POST /api/instructions/save — body: { path, content, tool? }
 * Write edited content back to an instruction file. The path must be a known
 * instruction file for this tool (same whitelist check as /content and /open),
 * and the file is backed up to .bak before overwriting (same SSOT-safe mechanism
 * as settings.json writes).
 */
instructions.post('/save', async (c) => {
	const body = await c.req.json<{ path: string; content: string; tool?: string }>();
	const profile = profileOf(body.tool ?? 'claude');
	const decoded = decodeURIComponent(body.path ?? '');
	const known = listInstructions(profile).map((i) => i.path);
	const match = known.find((p) => normPath(p) === normPath(decoded));
	if (!match) return c.json({ error: 'file not found or not an instruction file' }, 404);
	try {
		writeText(match, body.content ?? '');
	} catch (e) {
		return c.json({ error: (e as Error).message }, 500);
	}
	return c.json({ ok: true, path: match });
});
