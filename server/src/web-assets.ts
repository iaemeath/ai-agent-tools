// Static web-asset serving — one module, two sources, chosen per environment:
//
//   1. SEA (single-executable) builds: `web/dist/**` (+ the remote-entry bundle) are
//      embedded into the exe as Node SEA assets. At startup this module serves the frontend
//      from RAM, extracts ccc-remote.mjs to a temp file, and points CCC_REMOTE_BUNDLE at it
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

/** The SEA API, present only inside a single-executable build (probed lazily). */
interface SeaModule {
	getAssetKeys(): string[];
	getAsset(key: string): ArrayBuffer;
}

/** Probe for the node:sea module — resolves inside a SEA exe, null everywhere else. */
function seaModule(): SeaModule | null {
	if (typeof require !== 'function') return null; // ESM/tsx runtime
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require('node:sea') as SeaModule;
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
	const sea = seaModule();
	if (sea) {
		const keys = new Set(sea.getAssetKeys().filter((k) => k.startsWith('web/')));
		if (keys.size > 0) {
			registerStatic(app, {
				has: (p) => keys.has(`web/${assetKeyOf(p)}`),
				read: (p) => Buffer.from(sea.getAsset(`web/${assetKeyOf(p)}`)),
				indexHtml: () => (keys.has('web/index.html')
					? Buffer.from(sea.getAsset('web/index.html')).toString('utf8')
					: ''),
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
 * resolution order checks CCC_REMOTE_BUNDLE first).
 */
function extractRemoteBundle(sea: SeaModule): void {
	try {
		if (!sea.getAssetKeys().includes('ccc-remote.mjs')) return;
		const code = Buffer.from(sea.getAsset('ccc-remote.mjs'));
		const tmp = path.join(os.tmpdir(), `ccc-remote-${process.pid}.mjs`);
		fs.writeFileSync(tmp, code);
		process.env['CCC_REMOTE_BUNDLE'] = tmp;
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
