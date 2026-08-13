// Shared explorer.exe spawn — used by every read-only resource route's /open
// endpoint (rules/commands/agents/hooks/instructions/mcps/plugins).
//
// Centralizing this does two things:
//   1. Removes 7 copies of the same spawn + error-handling boilerplate.
//   2. Fixes the Hono typing: the previous inline `new Promise((resolve) => …
//      resolve(c.json(…)))` form made TS infer Promise<void>, so every
//      resolve(c.json(…)) was a type error (28 across the codebase). Returning
//      Promise<Response> from one place makes the handlers typecheck cleanly.

import { execFile } from 'node:child_process';
import type { Context } from 'hono';

/**
 * Reveal a path in the Windows file manager via explorer.exe. `select=true`
 * (default) opens the containing folder with the file highlighted; `select=false`
 * opens the directory itself. Invoked through execFile (no shell) so the path is
 * a process arg, never interpolated into a command string — no injection surface.
 *
 * explorer.exe often exits non-zero even on success, so only a real spawn failure
 * (ENOENT), a stderr message, or a spawn error is treated as an error.
 */
export function revealInExplorer(c: Context, absPath: string, select = true): Promise<Response> {
	const args = select ? [`/select,${absPath}`] : [absPath];
	return new Promise<Response>((resolve) => {
		const child = execFile('explorer.exe', args, (err, _stdout, stderr) => {
			if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
				resolve(c.json({ error: 'explorer.exe not found' }, 500));
			} else if (stderr) {
				resolve(c.json({ error: stderr }, 500));
			} else {
				resolve(c.json({ ok: true }));
			}
		});
		child.on('error', () => resolve(c.json({ error: 'failed to spawn explorer' }, 500)));
	});
}
