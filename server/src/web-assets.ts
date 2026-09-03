// Static web-asset serving — one module, two sources, chosen per environment:
//
//   1. SEA (single-executable) builds: `web/dist/**` (+ the remote-entry bundle) are
//      embedded into the exe as Node SEA assets. At startup this module serves the frontend
//      from RAM, extracts ai-agent-remote.mjs to a temp file, and points AI_AGENT_REMOTE_BUNDLE at it
//      — the exe needs no files beside it.
//   2. Repo/node layout: files come from the web/dist folder on disk (dev builds,
//      `npm start` after `npm run build`).
//
// Both paths produce the same routes: dist files with correct MIME + an SPA fallback
// (any non-API path → index.html). When NEITHER source is available (vite dev on :5173
// proxying /api), nothing is registered.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';

/** MIME types the Vue build emits (vite hashes filenames; extension is the key). */
const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.map': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.webmanifest': 'application/manifest+json',
};

function contentType(file: string): string {
	return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Normalize a request path to a dist-relative key ('/assets/x.js' → 'assets/x.js'). */
function assetKeyOf(urlPath: string): string {
	return urlPath.replace(/^\/+/, '').replace(/\?.*$/, '');
}

/**
 * The SEA API, present only inside a single-executable build (probed lazily).
 * Node ≤22 exposed getAssetKeys() for enumeration; Node 24 removed it, leaving
 * only isSea/getAsset/getRawAsset — so asset presence is probed per key instead
 * (getAsset throws on a missing key; see tryAsset).
 */
interface SeaModule {
	isSea?(): boolean;
	getAssetKeys?(): string[];
	getAsset(key: string): ArrayBuffer;
}

/** Probe for the node:sea module — resolves ONLY inside a SEA exe, null everywhere else. */
function seaModule(): SeaModule | null {
	if (typeof require !== 'function') return null; // ESM/tsx runtime
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const m = require('node:sea') as SeaModule;
		// Node ≥23: require succeeds even in plain node — trust the isSea() flag.
		if (typeof m.isSea === 'function') return m.isSea() ? m : null;
		// Node 22 legacy: no isSea, but the module only loads inside a SEA build.
		return typeof m.getAssetKeys === 'function' ? m : null;
	} catch {
		return null;
	}
}

/** Read one SEA asset; null when the key is not embedded (getAsset throws). */
function tryAsset(sea: SeaModule, key: string): Buffer | null {
	try {
		return Buffer.from(sea.getAsset(key));
	} catch {
		return null;
	}
}

/** True only inside the single-exe build (gates exe-only behavior like auto-open-browser). */
export function isSeaExe(): boolean {
	return seaModule() !== null;
}

/**
 * Register static-frontend routes on the app. Resolution order:
 * SEA assets (exe) → web/dist folder (repo). No source → no routes (vite dev).
 */
export function serveWebDist(app: Hono, distDir: string): void {
	// ---- Source 1: SEA-embedded assets (single-exe build) ----
	// No key enumeration (Node 24 dropped getAssetKeys) — index.html doubles as
	// the "assets are embedded" probe, and per-file presence goes through tryAsset.
	const sea = seaModule();
	if (sea) {
		const index = tryAsset(sea, 'web/index.html');
		if (index !== null) {
			registerStatic(app, {
				has: (p) => p !== '/' && tryAsset(sea, `web/${assetKeyOf(p)}`) !== null,
				read: (p) => tryAsset(sea, `web/${assetKeyOf(p)}`)!,
				indexHtml: () => index.toString('utf8'),
				source: 'sea-assets',
			});
			extractRemoteBundle(sea);
			return;
		}
	}

	// ---- Source 2: web/dist on disk (repo layout) ----
	const indexFile = path.join(distDir, 'index.html');
	if (fs.existsSync(indexFile)) {
		registerStatic(app, {
			has: (p) => {
				const rel = assetKeyOf(p);
				if (rel === '') return false;
				const abs = path.resolve(distDir, rel);
				// Containment: reject traversal before touching the disk.
				if (abs !== distDir && !abs.startsWith(distDir + path.sep)) return false;
				return fs.existsSync(abs) && fs.statSync(abs).isFile();
			},
			read: (p) => fs.readFileSync(path.resolve(distDir, assetKeyOf(p))),
			indexHtml: () => fs.readFileSync(indexFile, 'utf8'),
			source: `disk:${distDir}`,
		});
	}
}

/**
 * Inside a SEA exe there is no filesystem path to the embedded remote-entry bundle, so
 * extract it to a temp file once and point the remote runner at it via env var (its
 * resolution order checks AI_AGENT_REMOTE_BUNDLE first).
 */
function extractRemoteBundle(sea: SeaModule): void {
	try {
		const code = tryAsset(sea, 'ai-agent-remote.mjs');
		if (!code) return;
		const tmp = path.join(os.tmpdir(), `ai-agent-remote-${process.pid}.mjs`);
		fs.writeFileSync(tmp, code);
		process.env['AI_AGENT_REMOTE_BUNDLE'] = tmp;
	} catch (e) {
		console.warn(`[web] failed to extract remote bundle: ${(e as Error).message}`);
	}
}

interface StaticSource {
	has(urlPath: string): boolean;
	read(urlPath: string): Buffer;
	indexHtml(): string;
	source: string;
}

/** Wire one static source onto the app: file routes with MIME + SPA fallback. */
function registerStatic(app: Hono, src: StaticSource): void {
	console.log(`[web] serving frontend from ${src.source}`);
	app.get('*', (c) => {
		const p = c.req.path;
		if (p !== '/' && src.has(p)) {
			const buf = src.read(p);
			return c.body(new Uint8Array(buf), 200, { 'Content-Type': contentType(p) });
		}
		// SPA fallback: any non-file path → index.html (client router takes over).
		const html = src.indexHtml();
		if (!html) return c.notFound();
		return c.html(html);
	});
}
