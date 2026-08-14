// SSH connection pool — manages live ssh2 Client+SFTP sessions per host.
//
// getSession(hostId) returns a shared, reusable session (created on demand). Concurrent
// callers for the same host await the same in-flight connect. Sessions carry the resolved
// remote $HOME (sftp realpath('.'')) so paths.ts can resolve tool config dirs remotely.
//
// Recursive filesystem ops (mkdir -p / rm -rf / cp -r) have no native SFTP primitive, so
// SshSession.exec runs them over the SSH channel directly — POSIX only (Linux/macOS hosts).

import { Client } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';
import fsp from 'node:fs/promises';
import { getHost, type HostRecord } from './registry.js';
import { decryptOpt } from './secrets.js';

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number | null;
}

/** A live SSH session: the raw client, its SFTP channel, and the remote $HOME. */
export class SshSession {
	constructor(
		public readonly client: Client,
		public readonly sftp: SFTPWrapper,
		public readonly homeDir: string,
	) {}

	/** Run a shell command over the SSH channel; collects stdout/stderr/exit code. */
	exec(cmd: string): Promise<ExecResult> {
		return new Promise((resolve, reject) => {
			this.client.exec(cmd, (err, stream) => {
				if (err) return reject(err);
				let stdout = '';
				let stderr = '';
				let exitCode: number | null = null;
				stream.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
				stream.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
				stream.on('exit', (code: number | null) => { exitCode = code; });
				stream.on('close', () => resolve({ stdout, stderr, code: exitCode }));
			});
		});
	}

	close(): void {
		try { this.sftp.end(); } catch { /* ignore */ }
		try { this.client.end(); } catch { /* ignore */ }
	}
}

/** Decrypt secrets + read the key file, yielding ssh2 connect credentials. */
async function buildAuth(rec: HostRecord): Promise<{ password?: string; privateKey?: Buffer; passphrase?: string }> {
	if (rec.authMethod === 'password') {
		return { password: decryptOpt(rec.passwordEnc) };
	}
	const auth: { privateKey?: Buffer; passphrase?: string } = {};
	if (rec.privateKeyPath) {
		auth.privateKey = await fsp.readFile(rec.privateKeyPath);
	}
	const pass = decryptOpt(rec.passphraseEnc);
	if (pass) auth.passphrase = pass;
	return auth;
}

/** Open a brand-new SSH+SFTP session and resolve the remote $HOME. Throws on failure. */
async function openSession(rec: HostRecord): Promise<SshSession> {
	const auth = await buildAuth(rec);
	const client = new Client();
	await new Promise<void>((resolve, reject) => {
		client.once('ready', () => resolve());
		client.once('error', (err: Error) => reject(err));
		client.connect({
			host: rec.host,
			port: rec.port,
			username: rec.userName,
			password: auth.password,
			privateKey: auth.privateKey,
			passphrase: auth.passphrase,
			readyTimeout: 15000,
			keepaliveInterval: 30000,
		});
	});
	const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
		client.sftp((err, s) => (err ? reject(err) : resolve(s)));
	});
	const homeDir = await new Promise<string>((resolve, reject) => {
		sftp.realpath('.', (err, abs) => (err ? reject(err) : resolve(abs)));
	});
	return new SshSession(client, sftp, homeDir);
}

interface PoolEntry {
	session: SshSession | null;
	connecting: Promise<SshSession> | null;
	lastUsed: number;
}

const pool = new Map<string, PoolEntry>();

/**
 * Get-or-create a live session for a host. Concurrent callers for the same hostId share
 * one in-flight connect; once open, the session is reused until evicted.
 */
export async function getSession(hostId: string): Promise<SshSession> {
	const existing = pool.get(hostId);
	// 1. Live session present → reuse.
	if (existing?.session) {
		existing.lastUsed = Date.now();
		return existing.session;
	}
	// 2. In-flight connect → await it (dedupes concurrent first-time callers).
	if (existing?.connecting) {
		return existing.connecting;
	}
	// 3. Start a fresh connect.
	const rec = await getHost(hostId);
	if (!rec) throw new Error(`unknown host: ${hostId}`);
	const connecting = (async () => {
		try {
			const session = await openSession(rec);
			const e = pool.get(hostId);
			if (e) { e.session = session; e.connecting = null; e.lastUsed = Date.now(); }
			return session;
		} catch (err) {
			const e = pool.get(hostId);
			if (e) e.connecting = null;
			throw err;
		}
	})();
	pool.set(hostId, { session: null, connecting, lastUsed: Date.now() });
	return connecting;
}

/** Drop a host's cached session (on auth change, explicit disconnect, or stale error). */
export function evictSession(hostId: string): void {
	const entry = pool.get(hostId);
	if (entry?.session) entry.session.close();
	pool.delete(hostId);
}

/** Pool status for all known hosts (for the /api/hosts status view). */
export function poolStatus(): Record<string, 'connected' | 'connecting' | 'idle'> {
	const out: Record<string, 'connected' | 'connecting' | 'idle'> = {};
	for (const [id, e] of pool) {
		out[id] = e.session ? 'connected' : e.connecting ? 'connecting' : 'idle';
	}
	return out;
}

/** One-shot connection test (does NOT cache). Used by the "test connection" route. */
export async function testConnection(rec: HostRecord): Promise<{ ok: boolean; homeDir?: string; error?: string }> {
	try {
		const session = await openSession(rec);
		const homeDir = session.homeDir;
		session.close();
		return { ok: true, homeDir };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
