// ccc-ui server entry — Hono app serving /api/* and (in production) the Vue build.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projects } from './routes/projects.js';
import { skills } from './routes/skills.js';
import { tools } from './routes/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../../web/dist');

const app = new Hono();

// API
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/tools', tools);
app.route('/api/projects', projects);
app.route('/api/skills', skills);

// Static frontend (production). In dev, Vite serves the frontend on :5173 and proxies /api here.
if (fs.existsSync(webDist)) {
	app.use('/*', serveStatic({ root: webDist, rewriteRequestPath: () => '/index.html' }));
	// SPA fallback: any non-API, non-file route → index.html
	app.get('*', (c) => c.html(fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, ({ port }) => {
	console.log(`ccc-ui server: http://localhost:${port}  (api at /api/*)`);
	if (!fs.existsSync(webDist)) {
		console.log('  (web/dist not built — run "npm run build", or use vite dev at :5173 with /api proxy)');
	}
});
