// Host middleware — binds a HostContext to each request based on the X-Host header
// (or ?host= query).
//
// 'local' / absent → LOCAL_CONTEXT is already the getHostCtx() fallback, so nothing is
// bound and behavior is identical to the pre-refactor server. Any other hostId → resolve
// a live SSH session from the pool and bind a remote context (homeDir + SshFs); every
// downstream reader then transparently operates on the remote host. A connection failure
// surfaces as 502 so the UI can show it instead of a per-reader 500.

import type { Context, Next } from 'hono';
import { runInHostCtx, type HostContext } from './context.js';
import { getSession } from './pool.js';
import { SshFs } from './ssh.js';

export async function hostMiddleware(c: Context, next: Next): Promise<Response | void> {
	const hostId = c.req.header('x-host') || c.req.query('host') || 'local';
	if (hostId === 'local') {
		// LOCAL_CONTEXT is the default — no binding needed.
		await next();
		return;
	}
	let session;
	try {
		session = await getSession(hostId);
	} catch (e) {
		return c.json({ error: `cannot connect to host "${hostId}": ${(e as Error).message}` }, 502);
	}
	const ctx: HostContext = {
		hostId,
		isRemote: true,
		homeDir: session.homeDir,
		fs: new SshFs(session),
	};
	// Bind the context for the whole downstream handler chain (ALS propagates across awaits).
	await runInHostCtx(ctx, () => next());
}
