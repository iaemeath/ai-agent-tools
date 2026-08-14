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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distExe = path.join(root, 'dist-exe');
const webDist = path.join(root, 'web', 'dist');
const esbuildBin = path.join(root, 'node_modules', '.bin', `esbuild${process.platform === 'win32' ? '.cmd' : ''}`);

function run(cmd, args, opts = {}) {
	console.log(`+ ${path.basename(cmd)} ${args.join(' ')}`);
	execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
}

fs.rmSync(distExe, { recursive: true, force: true });
fs.mkdirSync(distExe, { recursive: true });

// 1. Frontend (vue-tsc --noEmit + vite build via the workspace script).
run('npm', ['-w', 'web', 'run', 'build']);

// 2. Server bundle → CJS (SEA entry must be CommonJS; esbuild flattens the ESM graph).
run(esbuildBin, [
	'server/src/index.ts',
	'--bundle', '--platform=node', '--format=cjs', '--target=es2022',
	'--outfile', 'dist-exe/server.cjs',
	'--log-level=warning',
]);

// 3. Remote-entry bundle → ESM (executed by the remote host's own node; NOT part of the exe
//    code — embedded as an asset and extracted to a temp file at runtime).
run(esbuildBin, [
	'server/src/remote/entry.ts',
	'--bundle', '--platform=node', '--format=esm', '--target=es2022',
	'--outfile', 'dist-exe/ccc-remote.mjs',
	'--log-level=warning',
]);

// 4. SEA config + blob. Assets: every web/dist file keyed "web/<relative>" (the web-assets
//    module serves them under that prefix), plus the remote bundle at the root key.
const assets = {};
for (const f of walk(webDist)) {
	assets[path.relative(root, f).replaceAll('\\', '/')] = `web/${path.relative(webDist, f).replaceAll('\\', '/')}`;
}
assets['dist-exe/ccc-remote.mjs'] = 'ccc-remote.mjs';
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
const exeName = 'ai-agent-tools.exe';
const exePath = path.join(distExe, exeName);
fs.copyFileSync(process.execPath, exePath);
run('npx', ['postject', exePath, 'NODE_SEA_BLOB', path.join(distExe, 'sea-prep.blob'),
	'--sentinel', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);

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
