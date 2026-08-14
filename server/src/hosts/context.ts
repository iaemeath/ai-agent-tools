// Host context — the per-request "which machine are we talking to" binding.
//
// The whole server used to assume `os.homedir()` + node:fs on the LOCAL box. Remote SSH
// support breaks both assumptions: home is the remote $HOME, and I/O is SFTP. Rather than
// thread a context object through ~34 function signatures (15 path helpers + 19 readers),
// we bind it once per request via AsyncLocalStorage and let every helper read it back
// through getHostCtx()/getFs().
//
// Until the host middleware (added in stage 2) sets a remote context, getHostCtx() returns
// the LOCAL_CONTEXT below — so behavior is identical to the pre-refactor local-only server.

import { AsyncLocalStorage } from 'node:async_hooks';
import os from 'node:os';
import { localFs } from '../fs-backend/local.js';
import type { FsBackend } from '../fs-backend/types.js';

/** Everything a reader needs to know about the host it is operating on. */
export interface HostContext {
	/** Stable id ('local' for the machine running the server; registry id otherwise). */
	hostId: string;
	/** True when operating on a remote SSH host (gates explorer.exe, etc.). */
	isRemote: boolean;
	/** HOME dir to resolve tool config paths against. Local = os.homedir(); remote = sftp realpath('.'). */
	homeDir: string;
	/** The swappable I/O backend for this host. */
	fs: FsBackend;
}

const storage = new AsyncLocalStorage<HostContext>();

/** The local machine's context — the fall-through when no remote context is bound. */
const LOCAL_CONTEXT: HostContext = {
	hostId: 'local',
	isRemote: false,
	homeDir: os.homedir(),
	fs: localFs,
};

/**
 * The host context for the current async request. Always defined: returns LOCAL_CONTEXT
 * when no host middleware has bound a remote context (the common local-only case).
 */
export function getHostCtx(): HostContext {
	return storage.getStore() ?? LOCAL_CONTEXT;
}

/** Convenience: the FsBackend for the current request's host. */
export function getFs(): FsBackend {
	return getHostCtx().fs;
}

/**
 * Bind a host context for the duration of `fn` (used by the request middleware to scope
 * a remote connection to a single HTTP request).
	 */
export function runInHostCtx<T>(ctx: HostContext, fn: () => T): T {
	return storage.run(ctx, fn);
}
