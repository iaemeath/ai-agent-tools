// RemoteRunner — Architecture C runtime, runs on the LOCAL server.
//
// For remote-host requests, instead of doing N sequential SFTP round-trips (catastrophically
// slow over a VPN — a full overview measured ~29s), we bundle the readers into one JS file,
// ship it once to the remote (cached by content hash), and `node`-exec it there. The bundle
// reads the remote's OWN files at localhost speed (~0.5s) and returns one JSON blob. The cost
// model flips from O(file-ops × RTT) to O(1 exec per request).
//
// Bundle is built to MEMORY (esbuild write:false) — no on-disk artifact to gitignore. It is
// uploaded to <remote-home>/.ccc-ui/ccc-remote.<hash>.mjs; the hash is part of the filename
// so a changed bundle never collides with a stale remote copy, and an unchanged bundle is
// skipped (stat hit → no re-upload) across reconnects.

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getSession, type SshSession } from '../hosts/pool.js';
import { getHostCtx } from '../hosts/context.js';

/** Uniform command result from the remote entry — maps onto c.json(body, status). */
export interface RemoteResult {
	status: number;
	body: unknown;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(__dirname, 'entry.ts');
const REMOTE_DIR_NAME = '.ccc-ui';

let bundleCode = '';
let bundleHash = '';
/** `${hostId}:${hash}` combos known to already be present on the remote (skip re-stat). */
const uploaded = new Set<string>();

/** Build the remote bundle once (memoized for the process lifetime). Returns code + short hash. */
async function getBundle(): Promise<{ code: string; hash: string }> {
	if (bundleHash) return { code: bundleCode, hash: bundleHash };
	const res = await build({
		entryPoints: [ENTRY],
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'es2022',
		write: false,
		logLevel: 'silent',
	});
	bundleCode = res.outputFiles[0].text;
	bundleHash = crypto.createHash('sha256').update(bundleCode).digest('hex').slice(0, 16);
	return { code: bundleCode, hash: bundleHash };
}

/**
 * Convert an SFTP virtual path (/C:/Users/...) to a Windows path (C:\Users\...) for cmd exec.
 * Falls back to a blanket slash→backslash replace when the drive-prefix shape isn't matched.
 */
function sftpToWin(p: string): string {
	const m = p.match(/^\/([A-Za-z]):\/(.*)$/);
	if (m) return `${m[1]}:\\${m[2].replace(/\//g, '\\')}`;
	return p.replace(/\//g, '\\');
}

/** Ensure the bundle exists at the remote path. Single-level mkdir is SFTP-native (no POSIX
 *  exec) so it is reliable on Windows targets; existing dir errors are ignored. Also prunes
 *  bundles left by older code versions (different hashes) and any leftover temp args files. */
async function ensureBundle(session: SshSession, remoteFile: string, code: string): Promise<void> {
	const sftp = session.sftp;
	const dir = remoteFile.slice(0, remoteFile.lastIndexOf('/'));
	await new Promise<void>((res) => sftp.mkdir(dir, () => res())); // ignore "already exists"
	const present = await new Promise<boolean>((res) => sftp.stat(remoteFile, (e) => res(!e)));
	if (!present) {
		await new Promise<void>((res, rej) => sftp.writeFile(remoteFile, code, (e) => (e ? rej(e) : res())));
	}
	// Best-effort housekeeping: keep only THIS bundle; drop stale ccc-remote.<hash>.mjs from
	// earlier code versions and orphaned args-*.json temp files (e.g. if an exec died mid-run).
	const keep = remoteFile.slice(remoteFile.lastIndexOf('/') + 1);
	sftp.readdir(dir, (err, entries) => {
		if (err) return;
		for (const e of entries as { filename: string }[]) {
			const n = e.filename;
			if (n === keep) continue;
			if (/^ccc-remote\.[0-9a-f]+\.mjs$/.test(n) || /^args-.*\.json$/.test(n)) {
				sftp.unlink(`${dir}/${n}`, () => undefined);
			}
		}
	});
}

/** Run a command on the remote and collect stdout/stderr/exit. Args travel in argv (base64). */
function run(
	session: SshSession,
	cmd: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		session.client.exec(cmd, (err, stream) => {
			if (err) return reject(err);
			let stdout = '';
			let stderr = '';
			stream.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
			stream.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
			stream.on('close', (code: number | null) => resolve({ stdout, stderr, code }));
		});
	});
}

/** Args above this (base64 length) go via an SFTP-uploaded JSON file: cmd.exe caps the
 *  command line at ~8k chars, and it does not forward stdin EOF to the child process. */
const ARG_INLINE_MAX = 4000;

/**
 * Execute a command on the remote host and return its { status, body } result.
 * Throws on non-zero exit or non-JSON stdout (sendRemote maps that to 502). The bundle is
 * uploaded once per content hash and reused across all subsequent calls for that host.
 * Small args travel inline as base64 argv (no quotes/spaces → cmd-safe); large args (e.g.
 * file contents for save endpoints) are uploaded as a temp JSON file over SFTP and passed
 * as "@<path>" — one extra round-trip, immune to the cmd line-length cap.
 */
export async function execRemote(hostId: string, command: string, args: unknown): Promise<RemoteResult> {
	const session = await getSession(hostId);
	const { code, hash } = await getBundle();
	const key = `${hostId}:${hash}`;
	const remoteFile = `${session.homeDir}/${REMOTE_DIR_NAME}/ccc-remote.${hash}.mjs`;
	if (!uploaded.has(key)) {
		await ensureBundle(session, remoteFile, code);
		uploaded.add(key);
	}
	const winPath = sftpToWin(remoteFile);
	const json = JSON.stringify(args ?? {});
	const argB64 = Buffer.from(json, 'utf8').toString('base64');
	let argSpec: string;
	let tmpFile: string | null = null;
	if (argB64.length <= ARG_INLINE_MAX) {
		argSpec = `"${argB64}"`;
	} else {
		tmpFile = `${session.homeDir}/${REMOTE_DIR_NAME}/args-${crypto.randomUUID()}.json`;
		await new Promise<void>((res, rej) =>
			session.sftp.writeFile(tmpFile!, json, 'utf8', (e) => (e ? rej(e) : res())));
		argSpec = `"@${sftpToWin(tmpFile)}"`;
	}
	try {
		const { stdout, stderr, code: exit } = await run(session, `node "${winPath}" ${command} ${argSpec}`);
		if (exit !== 0) {
			throw new Error(`remote "${command}" exited ${exit}: ${stderr.slice(0, 500) || '(no stderr)'}`);
		}
		try {
			return JSON.parse(stdout) as RemoteResult;
		} catch {
			throw new Error(`remote "${command}" returned non-JSON stdout (${stdout.length}b): ${stdout.slice(0, 300)}`);
		}
	} finally {
		if (tmpFile) {
			// Best-effort cleanup of the temp args file.
			session.sftp.unlink(tmpFile, () => undefined);
		}
	}
}

/**
 * Route-side helper: run a command on the request's remote host and turn the result into a
 * Response. Per-route status codes (404/409/413/…) pass through; transport failures (SSH
 * error, non-JSON output) become 502. Local routes call this inside `if (isRemote)`.
 */
export async function sendRemote(c: Context, command: string, args: unknown): Promise<Response> {
	try {
		const r = await execRemote(getHostCtx().hostId, command, args);
		return c.json(r.body, r.status as ContentfulStatusCode);
	} catch (e) {
		return c.json({ error: `remote ${command} failed: ${(e as Error).message}` }, 502);
	}
}
