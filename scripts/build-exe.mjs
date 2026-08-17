// build-exe — produce a single-file Windows executable (Node SEA).
//
// Pipeline:
//   1. vite build                                  → web/dist
//   2. esbuild server/src/index.ts  → dist-exe/server.cjs   (SEA requires a CJS entry)
//   3. esbuild server/src/remote/entry.ts → dist-exe/ccc-remote.mjs (runs on remote hosts)
//   4. sea-config.json: main=server.cjs, assets = web/dist/** (keyed "web/<rel>") +
//      ccc-remote.mjs                              → dist-exe/sea-prep.blob
//   5. copy node.exe → dist-exe/ai-agent-tools.exe, postject-inject the blob
//
// Requirements: Node 22+ (node:sea assets), postject (devDependency).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distExe = path.join(root, 'dist-exe');
const webDist = path.join(root, 'web', 'dist');

function run(cmd, args, opts = {}) {
	console.log(`+ ${path.basename(cmd)} ${args.join(' ')}`);
	if (process.platform === 'win32') {
		// npm/npx resolve to .cmd shims and Node (>=18.20) refuses to spawn .cmd/.bat
		// without a shell — route through cmd.exe. Quote ONLY paths containing spaces
		// (cmd /s double-quote stripping mangles an always-quoted bare name like npm).
		const cmdLine = cmd.includes(' ') ? `"${cmd}"` : cmd;
		execFileSync(cmdLine, args, { stdio: 'inherit', cwd: root, shell: true, ...opts });
	} else {
		execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
	}
}

fs.rmSync(distExe, { recursive: true, force: true });
fs.mkdirSync(distExe, { recursive: true });

// 1. Frontend (vue-tsc --noEmit + vite build via the workspace script).
run('npm', ['-w', 'web', 'run', 'build']);

// 2. Server bundle → CJS (SEA entry must be CommonJS; esbuild flattens the ESM graph).
//    JS API, not the CLI: esbuild 0.28's CLI only accepts --flag=value (space form errors),
//    and the API sidesteps cmd.exe quoting entirely.
console.log('+ esbuild server/src/index.ts → dist-exe/server.cjs');
await build({
	entryPoints: [path.join(root, 'server/src/index.ts')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'es2022',
	outfile: path.join(distExe, 'server.cjs'),
	logLevel: 'warning',
});

// 3. Remote-entry bundle → ESM (executed by the remote host's own node; NOT part of the exe
//    code — embedded as an asset and extracted to a temp file at runtime).
console.log('+ esbuild server/src/remote/entry.ts → dist-exe/ccc-remote.mjs');
await build({
	entryPoints: [path.join(root, 'server/src/remote/entry.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'es2022',
	outfile: path.join(distExe, 'ccc-remote.mjs'),
	logLevel: 'warning',
});

// 4. SEA config + blob. Assets mapping is { <key-inside-exe>: <on-disk-path> } — every
// web/dist file keyed "web/<relative>" (the web-assets module serves that prefix), plus
// the remote bundle at the root key.
const assets = {};
for (const f of walk(webDist)) {
	assets[`web/${path.relative(webDist, f).replaceAll('\\', '/')}`] = path.relative(root, f).replaceAll('\\', '/');
}
assets['ccc-remote.mjs'] = 'dist-exe/ccc-remote.mjs';
const seaConfig = {
	main: path.join(distExe, 'server.cjs'),
	output: path.join(distExe, 'sea-prep.blob'),
	disableExperimentalSEAWarning: true,
	useCodeCache: true,
	assets,
};
fs.writeFileSync(path.join(distExe, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
run(process.execPath, ['--experimental-sea-config', path.join(distExe, 'sea-config.json')]);

// 5. Copy node.exe as the exe shell and inject the blob.
//    postject has no .bin shim in this install — invoke its CLI through node directly.
const exeName = 'ai-agent-tools.exe';
const exePath = path.join(distExe, exeName);
fs.copyFileSync(process.execPath, exePath);
run(process.execPath, [path.join(root, 'node_modules/postject/dist/cli.js'),
	exePath, 'NODE_SEA_BLOB', path.join(distExe, 'sea-prep.blob'),
	// Node SEA requires exactly this fuse value; postject alpha.6 spells the flag
	// --sentinel-fuse (older docs say --sentinel — that option does not exist here).
	'--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);

console.log(`\nOK → ${exePath} (${(fs.statSync(exePath).size / 1024 / 1024).toFixed(1)} MB)`);

/** Recursively list files under dir. */
function walk(dir) {
	const out = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}
