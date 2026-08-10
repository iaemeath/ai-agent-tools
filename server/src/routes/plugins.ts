// Plugin routes — structured detail endpoint (profile-aware).
// The generic tool routes (/api/tools/*) stay for overview/status/content;
// this module adds a plugin-specific detail that returns typed fields.

import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { registry } from '../adapters/types.js';
import { profileOf } from '../profiles.js';
import type { PluginDetail } from '../model.js';

export const plugins = new Hono();

/** Text file extensions allowed for content preview (defense-in-depth: not strictly required). */
const TEXT_EXTENSIONS = new Set([
	'.md', '.json', '.txt', '.mjs', '.js', '.ts', '.vue', '.yaml', '.yml',
	'.xml', '.html', '.htm', '.css', '.scss', '.sh', '.py', '.java',
]);
/** Max file size for content preview (512 KB). */
const MAX_PREVIEW_BYTES = 512 * 1024;
/** Directory names hidden from the file browser (too noisy / huge). */
const HIDDEN_DIRS = new Set(['node_modules', '.git', '__pycache__']);

/** Resolve the install path of a plugin by name (used by both detail and open). */
function resolveInstallPath(name: string, project: string | null, profile: ReturnType<typeof profileOf>): string | null {
	const adapter = registry(profile).find((a) => a.kind === 'plugin');
	if (!adapter) return null;
	const detailFn = (adapter as { detail?: (n: string, p: string | null) => PluginDetail }).detail;
	if (!detailFn) return null;
	try {
		const detail = detailFn.call(adapter, name, project);
		return detail.installPath || null;
	} catch {
		return null;
	}
}

/**
 * GET /api/plugins/:name/detail?project=<path|null>&tool=<claude|zcode>
 * Returns structured plugin detail: metadata + per-scope status + component inventory.
 * `:name` is the full plugin id "name@marketplace" (URL-encoded).
 */
plugins.get('/:name/detail', (c) => {
	const name = decodeURIComponent(c.req.param('name'));
	const projectRaw = c.req.query('project');
	const project = !projectRaw || projectRaw === 'null' ? null : projectRaw;
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	const adapter = registry(profile).find((a) => a.kind === 'plugin');
	if (!adapter) return c.json({ error: 'plugin adapter not registered' }, 500);
	// The adapter is typed as ToolAdapter; cast to access detail().
	const detailFn = (adapter as { detail?: (n: string, p: string | null) => PluginDetail }).detail;
	if (!detailFn) return c.json({ error: 'detail not supported' }, 404);
	try {
		return c.json(detailFn.call(adapter, name, project));
	} catch (e) {
		return c.json({ error: (e as Error).message }, 404);
	}
});

/**
 * POST /api/plugins/:name/open — body: { project?, tool? }
 * Open the plugin's install directory in the OS file manager. Uses execFile (no shell)
 * to prevent command injection. The path is resolved server-side from the plugin name,
 * never trusted from the client.
 */
plugins.post('/:name/open', async (c) => {
	const name = decodeURIComponent(c.req.param('name'));
	const body = await c.req.json<{ project?: string | null; tool?: string }>().catch(() => ({}) as { project?: string | null; tool?: string });
	const project = !body.project || body.project === 'null' ? null : body.project;
	const profile = profileOf(body.tool ?? 'claude');
	const installPath = resolveInstallPath(name, project, profile);
	if (!installPath) return c.json({ error: 'plugin not found or has no install path' }, 404);

	return new Promise((resolve) => {
		// Open the directory directly (no /select, since installPath is a folder).
		// explorer.exe often exits non-zero even on success; treat spawn failure + stderr
		// as real errors, everything else as success.
		const child = execFile('explorer.exe', [installPath], (err, _stdout, stderr) => {
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

/**
 * Resolve a client-supplied relative `subpath` to an absolute path INSIDE the plugin's
 * installPath. Returns null if the plugin is unknown or the subpath escapes the root
 * (path traversal via `..` or absolute paths). This is the single security chokepoint
 * for the file-browser endpoints.
 */
function resolveSafePath(
	name: string,
	subpath: string | undefined,
	project: string | null,
	profile: ReturnType<typeof profileOf>,
): { absPath: string; installPath: string } | null {
	const installPath = resolveInstallPath(name, project, profile);
	if (!installPath) return null;
	const rel = (subpath ?? '').replace(/\\/g, '/').replace(/^\/+/, ''); // normalize, strip leading /
	if (!rel) return { absPath: installPath, installPath };
	// Reject absolute paths (Windows drive or POSIX root).
	if (/^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return null;
	const absPath = path.resolve(installPath, rel);
	// Containment check: resolved path must be the root or under it.
	if (absPath !== installPath && !absPath.startsWith(installPath + path.sep)) return null;
	return { absPath, installPath };
}

/**
 * GET /api/plugins/:name/files?subpath=&project=&tool=
 * List one directory level inside the plugin install path. Folders first, then files,
 * both alphabetical. node_modules / .git / __pycache__ are hidden.
 */
plugins.get('/:name/files', (c) => {
	const name = decodeURIComponent(c.req.param('name'));
	const projectRaw = c.req.query('project');
	const project = !projectRaw || projectRaw === 'null' ? null : projectRaw;
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	const resolved = resolveSafePath(name, c.req.query('subpath'), project, profile);
	if (!resolved) return c.json({ error: 'plugin not found or path outside install dir' }, 403);

	let stats: fs.Stats;
	try {
		stats = fs.statSync(resolved.absPath);
	} catch {
		return c.json({ error: 'path not found' }, 404);
	}
	if (!stats.isDirectory()) return c.json({ error: 'not a directory' }, 400);

	const entries: { name: string; isDir: boolean }[] = [];
	try {
		for (const e of fs.readdirSync(resolved.absPath, { withFileTypes: true })) {
			if (e.isDirectory()) {
				if (HIDDEN_DIRS.has(e.name)) continue;
				entries.push({ name: e.name, isDir: true });
			} else if (e.isFile()) {
				entries.push({ name: e.name, isDir: false });
			}
		}
	} catch {
		return c.json({ error: 'cannot read directory' }, 500);
	}
	// Folders first, then files; alphabetical within each group.
	entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
	return c.json({ entries, root: resolved.installPath });
});

/**
 * GET /api/plugins/:name/file-content?subpath=&project=&tool=
 * Read one text file's raw content. Binary files and files > 512 KB are rejected with a
 * friendly message. Path must be inside the plugin install dir (traversal-guarded).
 */
plugins.get('/:name/file-content', (c) => {
	const name = decodeURIComponent(c.req.param('name'));
	const projectRaw = c.req.query('project');
	const project = !projectRaw || projectRaw === 'null' ? null : projectRaw;
	const profile = profileOf(c.req.query('tool') ?? 'claude');
	const resolved = resolveSafePath(name, c.req.query('subpath'), project, profile);
	if (!resolved) return c.json({ error: 'plugin not found or path outside install dir' }, 403);

	let stats: fs.Stats;
	try {
		stats = fs.statSync(resolved.absPath);
	} catch {
		return c.json({ error: 'file not found' }, 404);
	}
	if (stats.isDirectory()) return c.json({ error: 'path is a directory' }, 400);
	if (stats.size > MAX_PREVIEW_BYTES) return c.json({ error: 'file too large (>512KB)' }, 413);

	const ext = path.extname(resolved.absPath).toLowerCase();
	if (!TEXT_EXTENSIONS.has(ext)) {
		return c.json({ error: 'binary or unsupported file type' }, 415);
	}
	try {
		const raw = fs.readFileSync(resolved.absPath, 'utf8');
		return c.json({ name: path.basename(resolved.absPath), raw, ext });
	} catch {
		return c.json({ error: 'cannot read file' }, 500);
	}
});
