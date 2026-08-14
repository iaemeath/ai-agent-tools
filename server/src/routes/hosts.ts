// Host routes — manage the SSH host registry + test connections + pool status.
//
// These routes operate on the MAIN machine's own ~/.ccc-ui/hosts.json and the connection
// pool — they are NOT affected by the host middleware (hostId defaults to 'local', and
// even a remote X-Host is irrelevant since these never read remote config).

import { Hono } from 'hono';
import { listHosts, upsertHost, deleteHost, type HostRecord } from '../hosts/registry.js';
import { testConnection, poolStatus, evictSession } from '../hosts/pool.js';
import { encryptOpt } from '../hosts/secrets.js';

export const hosts = new Hono();

/** A host record with secrets stripped + live connection status added (for the UI). */
function safeView(h: HostRecord, status: 'connected' | 'connecting' | 'idle') {
	return {
		id: h.id,
		name: h.name,
		host: h.host,
		port: h.port,
		userName: h.userName,
		authMethod: h.authMethod,
		privateKeyPath: h.privateKeyPath,
		hasPassword: !!h.passwordEnc,
		hasPassphrase: !!h.passphraseEnc,
		createdAt: h.createdAt,
		status,
	};
}

/** GET /api/hosts — list all configured hosts (secrets never leave the server). */
hosts.get('/', async (c) => {
	const list = await listHosts();
	const status = poolStatus();
	return c.json({ hosts: list.map((h) => safeView(h, status[h.id] ?? 'idle')) });
});

/** POST /api/hosts — create or update a host. password/passphrase are plaintext in, encrypted at rest. */
hosts.post('/', async (c) => {
	const body = await c.req.json<{
		id?: string; name: string; host: string; port?: number; userName: string;
		authMethod: 'password' | 'privateKey'; password?: string; privateKeyPath?: string; passphrase?: string;
	}>();
	if (!body.name || !body.host || !body.userName) return c.json({ error: 'name, host, userName are required' }, 400);
	const saved = await upsertHost({
		id: body.id,
		name: body.name,
		host: body.host,
		port: body.port ?? 22,
		userName: body.userName,
		authMethod: body.authMethod,
		passwordEnc: encryptOpt(body.password),
		privateKeyPath: body.privateKeyPath,
		passphraseEnc: encryptOpt(body.passphrase),
	});
	// Credentials may have changed for an existing host → drop any cached session.
	if (body.id) evictSession(body.id);
	return c.json({ id: saved.id });
});

/** POST /api/hosts/test — test a connection WITHOUT saving. Returns { ok, homeDir?, error? }. */
hosts.post('/test', async (c) => {
	const body = await c.req.json<{
		host: string; port?: number; userName: string; authMethod: 'password' | 'privateKey';
		password?: string; privateKeyPath?: string; passphrase?: string;
	}>();
	if (!body.host || !body.userName) return c.json({ error: 'host, userName required' }, 400);
	const res = await testConnection({
		id: 'test', name: 'test', host: body.host, port: body.port ?? 22, userName: body.userName,
		authMethod: body.authMethod,
		passwordEnc: encryptOpt(body.password),
		privateKeyPath: body.privateKeyPath,
		passphraseEnc: encryptOpt(body.passphrase),
		createdAt: new Date().toISOString(),
	});
	return c.json(res);
});

/** DELETE /api/hosts/:id — remove a host and drop its cached session. */
hosts.delete('/:id', async (c) => {
	const id = c.req.param('id');
	evictSession(id);
	const ok = await deleteHost(id);
	if (!ok) return c.json({ error: 'host not found' }, 404);
	return c.json({ ok: true });
});

/** POST /api/hosts/:id/disconnect — drop the cached session (next request reconnects). */
hosts.post('/:id/disconnect', async (c) => {
	evictSession(c.req.param('id'));
	return c.json({ ok: true });
});
