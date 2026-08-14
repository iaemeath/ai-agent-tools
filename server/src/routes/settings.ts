// Settings routes — read-only view of the tool's user-level settings.json / config.json.
//
// Returns the raw settings object with sensitive values (API keys / tokens / passwords)
// masked so they can be safely displayed in the UI without leaking credentials.
// Excludes sections already managed by dedicated pages (skills, plugins enabled map, mcp servers).

import { Hono } from 'hono';
import { readUser } from '../settings.js';
import { profileOf } from '../profiles.js';
import { getHostCtx } from '../hosts/context.js';
import { execRemote } from '../remote/runner.js';

export const settings = new Hono();

/** Key names (case-insensitive, substring match) whose values look like secrets. */
const SECRET_PATTERNS = ['token', 'key', 'secret', 'password', 'pwd', 'auth'];

/** Mask a string value: show first 4 + last 4 chars, hide the middle. Short values → all masked. */
function maskValue(v: string): string {
	if (v.length <= 8) return '****';
	return v.slice(0, 4) + '****' + v.slice(-4);
}

/** Recursively mask secret-like values in an object/array. Non-secret values pass through. */
function maskSecrets(obj: unknown): unknown {
	if (typeof obj === 'string') return obj;
	if (obj === null || typeof obj !== 'object') return obj;
	if (Array.isArray(obj)) return obj.map(maskSecrets);
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
		const lower = k.toLowerCase();
		const isSecret = SECRET_PATTERNS.some((p) => lower.includes(p));
		if (isSecret && typeof v === 'string') {
			out[k] = maskValue(v);
		} else {
			out[k] = maskSecrets(v);
		}
	}
	return out;
}

/**
 * GET /api/settings?tool=
 * Returns the user-level settings object with secrets masked, excluding keys managed by
 * dedicated pages (enabledPlugins shown in PluginsView, skillOverrides shown in SkillsView,
 * mcp/mcpServers shown in MCPsView). Returns {} if the file doesn't exist.
 */
settings.get('/', async (c) => {
	const tool = c.req.query('tool') ?? 'claude';
	// Remote: fetch the RAW user settings from the remote host (one exec), then apply the
	// exact same filter+mask locally — secrets are masked before anything reaches the browser.
	let raw: Record<string, unknown>;
	if (getHostCtx().isRemote) {
		try {
			const r = await execRemote(getHostCtx().hostId, 'settings.user', { tool });
			raw = (r.status === 200 ? r.body : {}) as Record<string, unknown>;
		} catch {
			return c.json({ error: 'remote settings read failed' }, 502);
		}
	} else {
		raw = (await readUser(profileOf(tool))) as Record<string, unknown>;
	}
	if (!raw || typeof raw !== 'object') return c.json({});

	// Keys already managed by dedicated pages — don't duplicate them here.
	const MANAGED_KEYS = new Set(['enabledPlugins', 'skillOverrides', 'skills', 'plugins', 'mcp', 'mcpServers']);

	const filtered: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (!MANAGED_KEYS.has(k)) filtered[k] = v;
	}
	return c.json({ sourceFile: 'user-settings', values: maskSecrets(filtered) });
});
