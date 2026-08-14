// FsBackend — the pluggable file-system abstraction behind every reader.
//
// Why this exists: historically every reader called `node:fs` *Sync methods directly,
// which hard-bound the whole server to the LOCAL machine. To support remote hosts over
// SSH, the actual I/O must be swappable. FsBackend is that swappable surface: LocalFs
// wraps node:fs/promises, SshFs wraps ssh2's SFTP. Readers obtain the backend for the
// current request via `getFs()` (see hosts/context.ts), so they never name node:fs again.
//
// Method set is exactly the union of what the readers used to do with node:fs — no more,
// no less — so the migration is mechanical and behavior-preserving.

/** A directory entry, shape-compatible with what readers need from readdirSync(withFileTypes). */
export interface DirentLike {
	name: string;
	isFile: boolean;
	isDirectory: boolean;
}

/** Subset of fs.Stat that the readers actually consume. */
export interface StatResult {
	isFile: boolean;
	isDirectory: boolean;
	mtimeMs: number;
	size: number;
}

/**
 * The file-system operations every reader needs. All async because SshFs (ssh2) is
 * inherently async — there is no synchronous SFTP. LocalFs uses node:fs/promises so the
 * two implementations share one shape.
 */
export interface FsBackend {
	/** Does the path exist (file or directory)? Never throws. */
	exists(path: string): Promise<boolean>;
	/** Read a file as utf8 text. Rejects if missing/unreadable (caller decides tolerance). */
	readFile(path: string): Promise<string>;
	/** Write text to a path (utf8). Parent dirs must already exist. */
	writeFile(path: string, data: string): Promise<void>;
	/**
	 * Atomic write: write to a temp file in the same directory, then rename onto the target.
	 * Guarantees the target is never left half-written (crash-safe). Implementations must
	 * keep the temp file on the same volume as the target so rename is atomic.
	 */
	atomicWrite(path: string, data: string): Promise<void>;
	/** Stat a path. Rejects if missing (caller decides tolerance). */
	stat(path: string): Promise<StatResult>;
	/** List directory entries with file/dir flags. Empty array if dir missing/unreadable. */
	readDir(path: string): Promise<DirentLike[]>;
	/** Make a directory (recursive when requested). */
	mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
	/** Remove a file or directory tree (recursive when requested). */
	remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
	/** Copy a file or directory tree (recursive when requested). */
	copy(src: string, dest: string, opts?: { recursive?: boolean }): Promise<void>;
	/** Copy a single file. */
	copyFile(src: string, dest: string): Promise<void>;
	/** Resolve a (possibly relative/symlinked) path to its absolute canonical form. */
	realpath(path: string): Promise<string>;
}
