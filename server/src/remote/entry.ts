// Remote entry — Architecture C.
//
// Bundled by esbuild into one self-contained JS file, shipped to a remote host, and run
// under that host's OWN node via SSH exec. Because it executes natively on the target OS,
// getHostCtx() falls through to LOCAL_CONTEXT (the remote's os.homedir() + platform-native
// path module + node:fs), so every reader operates on the remote's OWN config at localhost
// speed with correct path semantics — no SFTP round-trip amplification, no /C:/ virtual-path
// mismatch, no POSIX-vs-cmd write gap.
//
// Wire protocol: argv[2] = command name (a simple identifier); argv[3] = args as base64 JSON
// (base64 has no quotes/spaces/shell metachars, so it passes through cmd.exe argv untouched);
// stdout = one JSON blob (the result). Anything on stderr is diagnostics only (e.g. node's
// experimental-feature warnings) and is ignored by the runner's JSON parse.

import { overview } from '../scan.js';
import { profileOf } from '../profiles.js';

interface OverviewArgs {
	/** null = overview mode (scan all projects). */
	project: string | null;
	/** Profile id ('claude' default). */
	tool?: string;
}

// Command registry — add one entry per remote-capable endpoint. Each handler runs entirely
// on the remote against its own filesystem via the shared readers.
const COMMANDS: Record<string, (args: OverviewArgs) => Promise<unknown>> = {
	overview: async (args) => overview(args.project, profileOf(args.tool ?? 'claude')),
};

const command = process.argv[2];
const handler = command ? COMMANDS[command] : undefined;
if (!handler) {
	process.stderr.write(`[ccc-remote] unknown command: ${command ?? '(none)'}\n`);
	process.exit(2);
}

try {
	const b64 = process.argv[3] ?? '';
	const args = b64 ? (JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as OverviewArgs) : ({} as OverviewArgs);
	const result = await handler(args);
	process.stdout.write(JSON.stringify(result ?? null));
} catch (e) {
	process.stderr.write(`[ccc-remote] ${command} failed: ${(e as Error).message}\n${(e as Error).stack ?? ''}\n`);
	process.exit(1);
}
