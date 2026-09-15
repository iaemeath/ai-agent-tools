// data-dir — the app's own data home (~/.ai-tools): the hosts registry lives here.
// One-time rename from the pre-rename location (~/.ai-agent-tools/hosts.json) so
// existing installs keep their data. Best-effort:
// if a move fails we just fall back to a fresh dir (same spirit as the hosts registry's
// legacy ~/.ccc-ui migration).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let migrated = false;

/** The app's data root: ~/.ai-tools. Performs legacy-dir migration on first call. */
export function dataRoot(): string {
	const root = path.join(os.homedir(), '.ai-tools');
	if (!migrated) {
		migrated = true;
		try {
			fs.mkdirSync(root, { recursive: true });
			const home = os.homedir();
			// hosts registry file
			moveLegacy(path.join(home, '.ai-agent-tools', 'hosts.json'), path.join(root, 'hosts.json'));
		} catch {
			// best-effort — leave legacy dirs in place, start fresh
		}
	}
	return root;
}

/** Move a legacy file/dir into place when the target doesn't exist yet. Never deletes data.
 * Falls back to copy when rename fails (a stray handle on the old dir makes Windows
 * rename refuse) — the legacy copy is then removed best-effort; leaving it is harmless. */
function moveLegacy(from: string, to: string): void {
	try {
		if (!fs.existsSync(from) || fs.existsSync(to)) return;
		fs.mkdirSync(path.dirname(to), { recursive: true });
		try {
			fs.renameSync(from, to);
		} catch {
			fs.cpSync(from, to, { recursive: true });
			try { fs.rmSync(from, { recursive: true, force: true }); } catch { /* locked — keep legacy copy */ }
		}
	} catch {
		// best-effort — leave legacy item in place, start fresh
	}
}
