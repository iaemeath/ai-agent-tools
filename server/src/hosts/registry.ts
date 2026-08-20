// Host registry — the persisted list of configured remote SSH hosts.
//
// Stored at ~/.ai-agent-tools/hosts.json. This is the MAIN machine's own bookkeeping file,
// NOT a remote config — so it uses node:fs/promises directly (never the FsBackend/SSH path),
// and is therefore unaffected by which host a request is operating on.
// A legacy ~/.ccc-ui/hosts.json (pre-rename) is migrated once on first read.

import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** One configured remote SSH host. Secrets are stored encrypted (see secrets.ts). */
export interface HostRecord {
	id: string;
	name: string;
	host: string;
	port: number;
	userName: string;
	authMethod: 'password' | 'privateKey';
	/** Encrypted password (authMethod='password'). */
	passwordEnc?: string;
	/** Path to the private key file on the LOCAL machine (authMethod='privateKey'). */
	privateKeyPath?: string;
	/** Encrypted passphrase for the private key, when it is protected. */
	passphraseEnc?: string;
	createdAt: string;
}

const HOSTS_DIR = path.join(os.homedir(), '.ai-agent-tools');
const HOSTS_FILE = path.join(HOSTS_DIR, 'hosts.json');
const LEGACY_HOSTS_FILE = path.join(os.homedir(), '.ccc-ui', 'hosts.json');

let migrated = false;
/**
 * One-time best-effort migration from the pre-rename location (~/.ccc-ui/hosts.json).
 * Copies (never deletes) the legacy file when the new one doesn't exist yet. Secrets stay
 * decryptable because the APP_SALT in secrets.ts was deliberately kept unchanged.
 */
async function migrateLegacy(): Promise<void> {
	if (migrated) return;
	migrated = true;
	try {
		await fsp.access(HOSTS_FILE);
		return; // new file already exists — nothing to migrate
	} catch { /* new file absent — try legacy */ }
	try {
		const legacy = await fsp.readFile(LEGACY_HOSTS_FILE, 'utf8');
		await fsp.mkdir(HOSTS_DIR, { recursive: true });
		await fsp.writeFile(HOSTS_FILE, legacy, 'utf8');
	} catch { /* no legacy file either — fresh start */ }
}

/** Read the whole registry; missing/corrupt file → empty list (never throws). */
async function readAll(): Promise<HostRecord[]> {
	await migrateLegacy();
	try {
		const raw = await fsp.readFile(HOSTS_FILE, 'utf8');
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as HostRecord[]) : [];
	} catch {
		return [];
	}
}

async function writeAll(hosts: HostRecord[]): Promise<void> {
	await fsp.mkdir(HOSTS_DIR, { recursive: true });
	await fsp.writeFile(HOSTS_FILE, JSON.stringify(hosts, null, 2) + '\n', 'utf8');
}

export async function listHosts(): Promise<HostRecord[]> {
	return readAll();
}

export async function getHost(id: string): Promise<HostRecord | undefined> {
	return (await readAll()).find((h) => h.id === id);
}

/** Insert (new id) or update (existing id) a host. Returns the stored record. */
export async function upsertHost(input: Omit<HostRecord, 'id' | 'createdAt'> & { id?: string }): Promise<HostRecord> {
	const hosts = await readAll();
	const now = new Date().toISOString();
	let rec: HostRecord;
	if (input.id) {
		const idx = hosts.findIndex((h) => h.id === input.id);
		if (idx === -1) throw new Error(`host not found: ${input.id}`);
		rec = { ...hosts[idx], ...input, id: input.id, createdAt: hosts[idx].createdAt } as HostRecord;
		hosts[idx] = rec;
	} else {
		rec = { ...input, id: randomUUID(), createdAt: now } as HostRecord;
		hosts.push(rec);
	}
	await writeAll(hosts);
	return rec;
}

export async function deleteHost(id: string): Promise<boolean> {
	const hosts = await readAll();
	const next = hosts.filter((h) => h.id !== id);
	if (next.length === hosts.length) return false;
	await writeAll(next);
	return true;
}
