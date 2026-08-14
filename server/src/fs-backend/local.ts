// LocalFs — FsBackend backed by node:fs/promises.
//
// The default backend for the machine running the server. Every method is async (the
// shared FsBackend contract requires it, since SshFs is inherently async); the local
// performance cost is negligible for a single-user config tool, and it lets readers be
// written once against getFs() with no knowledge of whether they hit a disk or an SSH link.

import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DirentLike, FsBackend, StatResult } from './types.js';

export class LocalFs implements FsBackend {
	async exists(p: string): Promise<boolean> {
		try {
			await fsp.access(p);
			return true;
		} catch {
			return false;
		}
	}

	async readFile(p: string): Promise<string> {
		return fsp.readFile(p, 'utf8');
	}

	async writeFile(p: string, data: string): Promise<void> {
		await fsp.writeFile(p, data, 'utf8');
	}

	/**
	 * Crash-safe write: stage into a temp file beside the target, then rename. The temp
	 * lives in the same directory (hence same volume) so the rename is atomic on POSIX
	 * and an overwrite-rename on Windows. A crash between write and rename leaves only
	 * the temp behind — the target is never truncated.
	 */
	async atomicWrite(p: string, data: string): Promise<void> {
		const dir = path.dirname(p);
		const base = path.basename(p);
		const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
		await fsp.writeFile(tmp, data, 'utf8');
		await fsp.rename(tmp, p);
	}

	async stat(p: string): Promise<StatResult> {
		const s = await fsp.stat(p);
		return { isFile: s.isFile(), isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs, size: s.size };
	}

	async readDir(p: string): Promise<DirentLike[]> {
		const entries = await fsp.readdir(p, { withFileTypes: true });
		return entries.map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() }));
	}

	async mkdir(p: string, opts?: { recursive?: boolean }): Promise<void> {
		await fsp.mkdir(p, opts);
	}

	async remove(p: string, opts?: { recursive?: boolean }): Promise<void> {
		await fsp.rm(p, opts);
	}

	async copy(src: string, dest: string, opts?: { recursive?: boolean }): Promise<void> {
		// node fs.cp options use 'recursive'; LocalFs mirrors the FsBackend option name.
		await fsp.cp(src, dest, opts);
	}

	async copyFile(src: string, dest: string): Promise<void> {
		await fsp.copyFile(src, dest);
	}

	async realpath(p: string): Promise<string> {
		return fsp.realpath(p);
	}
}

/** Shared singleton — the local host never needs more than one. */
export const localFs = new LocalFs();
