// ccc-ui server entry — Hono app serving /api/* and (in production) the Vue build.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plugins } from './routes/plugins.js';
import { projects } from './routes/projects.js';
import { instructions } from './routes/instructions.js';
import { rules } from './routes/rules.js';
import { commands } from './routes/commands.js';
import { agents } from './routes/agents.js';
import { hooks } from './routes/hooks.js';
import { mcps } from './routes/mcps.js';
import { settings } from './routes/settings.js';
import { skills } from './routes/skills.js';
import { tools } from './routes/tools.js';
import { hosts } from './routes/hosts.js';
import { hostMiddleware } from './hosts/middleware.js';
import { serveWebDist } from './web-assets.js';

// SEA/CJS note: esbuild compiles `import.meta.url` to undefined in CJS output, so the
// fileURLToPath call throws inside the exe — fall back to the bundle's native __dirname
// (the dist-exe folder; web/dist is irrelevant there because SEA assets take priority).
function here(): string {
	try {
		return path.dirname(fileURLToPath(import.meta.url));
	} catch {
		return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
	}
}

const app = new Hono();

// API
app.get('/api/health', (c) => c.json({ ok: true }));

// Bind per-request host context (local machine vs SSH remote) for all API routes below.
// X-Host header or ?host= selects the target host; defaults to 'local' (zero-effect).
app.use('/api/*', hostMiddleware);

app.route('/api/hosts', hosts);
app.route('/api/tools', tools);
app.route('/api/plugins', plugins);
app.route('/api/projects', projects);
app.route('/api/skills', skills);
app.route('/api/instructions', instructions);
app.route('/api/rules', rules);
app.route('/api/commands', commands);
app.route('/api/agents', agents);
app.route('/api/hooks', hooks);
app.route('/api/mcps', mcps);
app.route('/api/settings', settings);

// Static frontend (production). In dev, Vite serves the frontend on :5173 and proxies /api here.
// web-assets resolves files from SEA-embedded assets (single-exe builds) or the web/dist
// folder (repo layout); when neither is present it registers nothing (dev + vite proxy).
serveWebDist(app, path.resolve(here(), '../../web/dist'));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, ({ port }) => {
	console.log(`ccc-ui server: http://localhost:${port}  (api at /api/*)`);
});
