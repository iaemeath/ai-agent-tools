// SshFs — FsBackend backed by an ssh2 SFTP channel + exec.
//
// File-level ops (read/write/stat/readdir/rename/realpath) use SFTP directly. Recursive
// ops (mkdir -p / rm -rf / cp -r) have no SFTP primitive, so they run as shell commands
// over the SSH channel — POSIX only (Linux/macOS remote hosts; Windows SSH targets are
// out of scope for v1). All exec arguments pass through shquote() to neutralize injection.

import path from 'node:path';
import type { Stats } from 'ssh2';
import type { DirentLike, FsBackend, StatResult } from '../fs-backend/types.js';
import type { SshSession } from './pool.js';

export class SshFs implements FsBackend {
	constructor(private readonly session: SshSession) {}

	/** Promisify an ssh2 callback-style call. */
	private p<T>(run: (cb: (err: Error | null | undefined, val: T) => void) => void): Promise<T> {
		return new Promise((resolve, reject) => {
			run((err, val) => (err ? reject(err) : resolve(val)));
		});
	}

	async exists(p: string): Promise<boolean> {
		try { await this.stat(p); return true; } catch { return false; }
	}

	async readFile(p: string): Promise<string> {
		// @types/ssh2's readFile overloads always yield Buffer (no encoding→string overload);
		// decode to utf8 here so callers get a string as the FsBackend contract requires.
		const buf = await this.p<Buffer>((cb) => this.session.sftp.readFile(p, cb));
		return buf.toString('utf8');
	}

	async writeFile(p: string, data: string): Promise<void> {
		await this.p<void>((cb) => this.session.sftp.writeFile(p, data, 'utf8', cb));
	}

	async atomicWrite(p: string, data: string): Promise<void> {
		// tmp in the same remote dir (same volume) → rename is atomic.
		const dir = path.posix.dirname(p);
		const base = path.posix.basename(p);
		const tmp = `${dir}/.${base}.${process.pid}.${Date.now()}.tmp`;
		await this.writeFile(tmp, data);
		await this.p<void>((cb) => this.session.sftp.rename(tmp, p, cb));
	}

	async stat(p: string): Promise<StatResult> {
		const s = await this.p<Stats>((cb) => this.session.sftp.stat(p, cb));
		// ssh2 Stats.mtime is a UNIX-seconds number (SSH attrs); convert to epoch ms.
		return { isFile: s.isFile(), isDirectory: s.isDirectory(), mtimeMs: s.mtime * 1000, size: s.size };
	}

	async readDir(p: string): Promise<DirentLike[]> {
		const entries = await this.p<{ filename: string; attrs: Stats }[]>((cb) => this.session.sftp.readdir(p, cb));
		return entries.map((e) => ({ name: e.filename, isFile: e.attrs.isFile(), isDirectory: e.attrs.isDirectory() }));
	}

	async mkdir(p: string, opts?: { recursive?: boolean }): Promise<void> {
		if (opts?.recursive) {
			const res = await this.session.exec(`mkdir -p ${shquote(p)}`);
			if (res.code !== 0) throw new Error(`mkdir -p failed: ${res.stderr || res.stdout}`);
		} else {
			await this.p<void>((cb) => this.session.sftp.mkdir(p, cb));
		}
	}

	async remove(p: string, opts?: { recursive?: boolean }): Promise<void> {
		if (opts?.recursive) {
			const res = await this.session.exec(`rm -rf ${shquote(p)}`);
			if (res.code !== 0) throw new Error(`rm -rf failed: ${res.stderr || res.stdout}`);
		} else {
			// Single target: try rmdir (directory) first, fall back to unlink (file).
			await this.p<void>((cb) => this.session.sftp.rmdir(p, cb)).catch(() =>
				this.p<void>((cb) => this.session.sftp.unlink(p, cb)),
			);
		}
	}

	async copy(src: string, dest: string, opts?: { recursive?: boolean }): Promise<void> {
		const parts = ['cp'];
		if (opts?.recursive) parts.push('-r');
		parts.push(shquote(src), shquote(dest));
		const res = await this.session.exec(parts.join(' '));
		if (res.code !== 0) throw new Error(`cp failed: ${res.stderr || res.stdout}`);
	}

	async copyFile(src: string, dest: string): Promise<void> {
		// SFTP has no copy; use a single-file `cp` (no -r).
		const res = await this.session.exec(`cp ${shquote(src)} ${shquote(dest)}`);
		if (res.code !== 0) {
			// Fallback (e.g. exec disabled): read+write over SFTP.
			const data = await this.readFile(src);
			await this.writeFile(dest, data);
		}
	}

	async realpath(p: string): Promise<string> {
		return this.p<string>((cb) => this.session.sftp.realpath(p, cb));
	}
}

/** POSIX single-quote wrapping: '…' with any embedded ' escaped as '\'' . */
function shquote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}
