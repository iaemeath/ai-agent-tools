// caselog routes — the personal review workbench (reading layer / scenarios / notes).
// Deliberately NOT host-scoped like the tool-config routes: caselog data lives on THIS
// machine (~/.knowledge) regardless of the X-Host header, and the SSH hosts are data
// SOURCES (via sync), not targets. See docs/caselog/case-log-v2-design v3.3.md.

import { Hono } from 'hono';
import { listHosts } from '../hosts/registry.js';
import { isValidHostId, listRawSessions, mirroredHosts, readRawSession } from '../caselog/raw-store.js';
import { syncAll } from '../caselog/sync.js';
import { deleteNote, exportNotes, isValidNoteName, listNotes, readNote, saveNote, saveScenario, softDeleteScenario, listScenarios, type ScenarioInput } from '../caselog/kb.js';

export const caselog = new Hono();

/** GET /api/caselog/hosts — syncable sources: local + registered SSH hosts + existing mirrors. */
caselog.get('/hosts', async (c) => {
	const registered = (await listHosts()).map((h) => h.id).filter(isValidHostId);
	const extra = mirroredHosts().filter((h) => h !== 'local' && !registered.includes(h));
	return c.json({ hosts: ['local', ...registered, ...extra] });
});

/** POST /api/caselog/sync — pull new sessions from one host ('local' | hostId) or all. */
caselog.post('/sync', async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const host = typeof body['host'] === 'string' && body['host'] !== 'all' ? body['host'] : undefined;
	if (host && host !== 'local' && !isValidHostId(host)) return c.json({ error: 'invalid host id' }, 400);
	return c.json({ results: await syncAll(host) });
});

/** GET /api/caselog/sessions?host= — sessions across mirrors (all hosts when omitted). */
caselog.get('/sessions', (c) => {
	const host = c.req.query('host') || undefined;
	if (host && !isValidHostId(host)) return c.json({ error: 'invalid host id' }, 400);
	return c.json(listRawSessions(host));
});

/** GET /api/caselog/sessions/:id?host= — full session read from a mirror. */
caselog.get('/sessions/:id', (c) => {
	const host = c.req.query('host') || '';
	const id = c.req.param('id');
	if (!isValidHostId(host)) return c.json({ error: 'invalid host id' }, 400);
	const read = readRawSession(host, id);
	if (!read) return c.json({ error: 'session not found or no transcript content' }, 404);
	return c.json(read);
});

// ------------------------------------------------ scenarios (consolidation channel)

caselog.get('/scenarios', (c) => c.json(listScenarios()));

caselog.post('/scenarios', async (c) => {
	const body = await c.req.json().catch(() => null) as ScenarioInput | null;
	if (!body || typeof body['title'] !== 'string' || !body['title'].trim()) {
		return c.json({ error: 'title is required' }, 400);
	}
	return c.json(saveScenario({
		title: body['title'].trim(),
		keywords: String(body['keywords'] ?? ''),
		content: String(body['content'] ?? ''),
		category: String(body['category'] ?? ''),
		pointers: Array.isArray(body['pointers']) ? body['pointers'] : [],
	}));
});

caselog.patch('/scenarios/:id', async (c) => {
	const body = await c.req.json().catch(() => null) as ScenarioInput | null;
	if (!body || typeof body['title'] !== 'string' || !body['title'].trim()) {
		return c.json({ error: 'title is required' }, 400);
	}
	const saved = saveScenario({
		title: body['title'].trim(),
		keywords: String(body['keywords'] ?? ''),
		content: String(body['content'] ?? ''),
		category: String(body['category'] ?? ''),
		pointers: Array.isArray(body['pointers']) ? body['pointers'] : [],
	}, c.req.param('id'));
	if (!saved) return c.json({ error: 'scenario not found' }, 404);
	return c.json(saved);
});

caselog.delete('/scenarios/:id', (c) => {
	return softDeleteScenario(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'scenario not found' }, 404);
});

// ------------------------------------------------ notes (capture channel → Obsidian)

caselog.get('/notes', (c) => c.json(listNotes()));

caselog.get('/notes/:name', (c) => {
	const raw = readNote(c.req.param('name'));
	return raw === null ? c.json({ error: 'note not found' }, 404) : c.json({ name: c.req.param('name'), raw });
});

caselog.put('/notes/:name', async (c) => {
	const name = c.req.param('name');
	const body = await c.req.json().catch(() => null) as { content?: string } | null;
	if (!isValidNoteName(name)) return c.json({ error: 'invalid note name' }, 400);
	if (!body || typeof body['content'] !== 'string') return c.json({ error: 'content is required' }, 400);
	return saveNote(name, body['content']) ? c.json({ ok: true, name }) : c.json({ error: 'invalid note name' }, 400);
});

caselog.delete('/notes/:name', (c) => {
	return deleteNote(c.req.param('name')) ? c.json({ ok: true }) : c.json({ error: 'note not found' }, 404);
});

/** POST /api/caselog/notes/export {name?} — copy to the Obsidian vault (env-configured). */
caselog.post('/notes/export', async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const copied = exportNotes(typeof body['name'] === 'string' ? body['name'] : undefined);
	if (copied.length === 0 && !process.env['CASELOG_OBSIDIAN_DIR']) {
		return c.json({ error: 'CASELOG_OBSIDIAN_DIR not configured' }, 400);
	}
	return c.json({ copied });
});
