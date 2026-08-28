// caselog sync — pull sessions from each device into the local raw mirrors.
//
// LOCAL host ('local'): open this machine's zcode db read-only and pullChunk directly.
// REMOTE hosts: execRemote('caselog.pull') — the shared pullChunk runs on the target
// host inside the ai-agent-remote bundle (mirror in remote/entry.ts), returning one
// JSON chunk per hop; loop until done. Chunked by session count so any single JSON
// hop stays modest even on the 90-day first fill.

import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { configRoot } from '../paths.js';
import { profileOf } from '../profiles.js';
import { listHosts } from '../hosts/registry.js';
import { execRemote } from '../remote/runner.js';
import { FILL_SINCE_MS, pullChunk, type PullChunk } from './pull.js';
import { applyPull, getWatermark, openRaw, setWatermark } from './raw-store.js';

export interface SyncResult {
	host: string;
	ok: boolean;
	sessions: number;
	error?: string;
}

/** This machine's zcode session db (the 'local' source of the reading layer). */
export function zcodeDbPath(): string {
	const proj = profileOf('zcode').projects;
	return path.join(configRoot(profileOf('zcode')), ...(proj.source === 'sqlite' ? proj.dbRelative : ['cli', 'db', 'db.sqlite']));
}

/** Pull one host's new sessions into its mirror, looping chunks until done. */
async function syncHostLoop(hostId: string, next: (watermark: number, floor: number) => Promise<PullChunk>): Promise<SyncResult> {
	const db = openRaw(hostId, true)!;
	try {
		let wm = getWatermark(db);
		// First fill floor: skip sessions older than 90 days (v3.2 §3) instead of
		// mirroring the whole history on the very first sync.
		const floor = wm === 0 ? Date.now() - FILL_SINCE_MS : 0;
		let n = 0;
		for (;;) {
			const chunk = await next(wm, floor);
			if (chunk.sessions.length === 0) break;
			applyPull(db, chunk);
			n += chunk.sessions.length;
			if (chunk.watermark > wm) wm = chunk.watermark;
			setWatermark(db, wm);
			if (chunk.done) break;
		}
		return { host: hostId, ok: true, sessions: n };
	} finally {
		db.close();
	}
}

async function syncLocal(): Promise<SyncResult> {
	try {
		if (!fs.existsSync(zcodeDbPath())) return { host: 'local', ok: false, sessions: 0, error: 'zcode db not found' };
		const src = new DatabaseSync(zcodeDbPath(), { readOnly: true });
		try {
			return await syncHostLoop('local', async (wm, floor) => pullChunk(src, wm, undefined, floor));
		} finally {
			src.close();
		}
	} catch (e) {
		return { host: 'local', ok: false, sessions: 0, error: (e as Error).message };
	}
}

async function syncRemote(hostId: string): Promise<SyncResult> {
	try {
		return await syncHostLoop(hostId, async (wm, floor) => {
			const r = await execRemote(hostId, 'caselog.pull', { watermark: wm, sinceMs: floor });
			return r.body as PullChunk;
		});
	} catch (e) {
		return { host: hostId, ok: false, sessions: 0, error: (e as Error).message };
	}
}

/** Sync one host or everything (local machine + all registered SSH hosts). */
export async function syncAll(host?: string): Promise<SyncResult[]> {
	if (host === 'local') return [await syncLocal()];
	if (host) return [await syncRemote(host)];
	const results = [await syncLocal()];
	for (const rec of await listHosts()) {
		results.push(await syncRemote(rec.id));
	}
	return results;
}
