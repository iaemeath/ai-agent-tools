// Remote entry — Architecture C.
//
// Bundled by esbuild into one self-contained JS file, shipped to a remote host, and run
// under that host's OWN node via SSH exec. Because it executes natively on the target OS,
// getHostCtx() falls through to LOCAL_CONTEXT (the remote's os.homedir() + platform-native
// path module + node:fs), so every reader operates on the remote's OWN config at localhost
// speed with correct path semantics — no SFTP round-trip amplification, no /C:/ virtual-path
// mismatch, no POSIX-vs-cmd write gap (recursive mkdir/copy/remove are native node:fs here).
//
// Wire protocol: argv[2] = command name (a simple identifier); argv[3] = args as base64 JSON
// (base64 has no quotes/spaces/shell metachars, so it survives cmd.exe argv untouched);
// stdout = one JSON blob: { status: number, body: unknown }. The runner maps that directly
// onto c.json(body, status), so per-route status codes (404/409/413/…) survive the hop.
// stderr is diagnostics only and ignored.
//
// The command handlers MIRROR the local routes' logic (validation, whitelists, error codes)
// using the same shared readers — search for "mirror of" comments. When a local route's
// logic changes, its entry twin below must change with it.

import path from 'node:path';
import fsp from 'node:fs/promises';
import { overview } from '../scan.js';
import { profileOf } from '../profiles.js';
import { registry } from '../adapters/types.js';
import { listProjects, deleteProject } from '../projects-reader.js';
import { listInstructions, readInstruction } from '../instructions-reader.js';
import { listRules, readRule } from '../rules-reader.js';
import { listCommands, readCommand } from '../commands-reader.js';
import { listAgents, readAgent } from '../agents-reader.js';
import { listHooks } from '../hooks-reader.js';
import { listMcps } from '../mcp-reader.js';
import { listMcpTools } from '../mcp-tools.js';
import { readUser, writeText } from '../settings.js';
import { getFs } from '../hosts/context.js';
import { globalSkillsDir, projectSkillsDir } from '../paths.js';
import type { Scope, Status, ToolKind } from '../model.js';
import type { StatResult } from '../fs-backend/types.js';
import type { PluginDetail } from '../model.js';

/** Uniform command result — maps 1:1 onto the local route's c.json(body, status). */
interface RemoteResult {
	status: number;
	body: unknown;
}

const ok = (body: unknown): RemoteResult => ({ status: 200, body });
const err = (status: number, error: string): RemoteResult => ({ status, body: { error } });

/** Normalize a path for comparison (mirror of the normPath in every md route). */
function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ':');
}

type Args = Record<string, unknown>;

// ---------------------------------------------------------------- md resources
// instructions / rules / commands / agents share one list+read(+save) shape; only the
// reader differs. content/save re-derive the known-paths whitelist from list() and match
// via normPath exactly like the local routes (defense against arbitrary file read/write).

const MD_READERS = {
	instructions: { list: listInstructions, read: readInstruction, label: 'instruction' },
	rules: { list: listRules, read: readRule, label: 'rule' },
	commands: { list: listCommands, read: readCommand, label: 'command' },
	agents: { list: listAgents, read: readAgent, label: 'agent' },
} as const;
type MdResource = keyof typeof MD_READERS;

/** GET /content twin: whitelist + read one md file. */
async function mdContent(resource: MdResource, filePath: string, tool?: string): Promise<RemoteResult> {
	const r = MD_READERS[resource];
	const known = (await r.list(profileOf(tool ?? 'claude'))).map((i) => i.path);
	const match = known.find((p) => normPath(p) === normPath(filePath));
	if (!match) return err(404, `file not found or not a ${r.label} file`);
	const raw = await r.read(match);
	if (raw === null) return err(500, 'cannot read file');
	return ok({ path: match, raw });
}

/** POST /save twin: whitelist + backup + atomic write. */
async function mdSave(resource: MdResource, filePath: string, content: string, tool?: string): Promise<RemoteResult> {
	const r = MD_READERS[resource];
	const known = (await r.list(profileOf(tool ?? 'claude'))).map((i) => i.path);
	const match = known.find((p) => normPath(p) === normPath(filePath));
	if (!match) return err(404, `file not found or not a ${r.label} file`);
	try {
		await writeText(match, content);
	} catch (e) {
		return err(500, (e as Error).message);
	}
	return ok({ ok: true, path: match });
}

// ---------------------------------------------------------------- file browsers
// Shared constraints (mirror of the plugin/skill file-browser routes).

const TEXT_EXTENSIONS = new Set([
	'.md', '.json', '.txt', '.mjs', '.js', '.ts', '.vue', '.yaml', '.yml',
	'.xml', '.html', '.htm', '.css', '.scss', '.sh', '.py', '.java',
]);
const MAX_PREVIEW_BYTES = 512 * 1024;
const HIDDEN_DIRS = new Set(['node_modules', '.git', '__pycache__']);

/** Stat a path; null when missing (single round-trip on the remote's local disk). */
async function tryStat(p: string): Promise<StatResult | null> {
	try {
		return await getFs().stat(p);
	} catch {
		return null;
	}
}

/** List one directory level, folders-first alphabetical, hidden dirs filtered. */
async function listDirEntries(absPath: string): Promise<RemoteResult> {
	const stats = await tryStat(absPath);
	if (!stats) return err(404, 'path not found');
	if (!stats.isDirectory) return err(400, 'not a directory');
	const entries: { name: string; isDir: boolean }[] = [];
	try {
		for (const e of await getFs().readDir(absPath)) {
			if (e.isDirectory) {
				if (HIDDEN_DIRS.has(e.name)) continue;
				entries.push({ name: e.name, isDir: true });
			} else if (e.isFile) {
				entries.push({ name: e.name, isDir: false });
			}
		}
	} catch {
		return err(500, 'cannot read directory');
	}
	entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
	return ok({ entries });
}

/** Read one text file for preview: missing/dir/too-large/binary checks (mirror of routes). */
async function readPreviewFile(absPath: string): Promise<RemoteResult> {
	const stats = await tryStat(absPath);
	if (!stats) return err(404, 'file not found');
	if (stats.isDirectory) return err(400, 'path is a directory');
	if (stats.size > MAX_PREVIEW_BYTES) return err(413, 'file too large (>512KB)');
	const ext = path.extname(absPath).toLowerCase();
	if (!TEXT_EXTENSIONS.has(ext)) return err(415, 'binary or unsupported file type');
	try {
		const raw = await getFs().readFile(absPath);
		return ok({ name: path.basename(absPath), raw, ext });
	} catch {
		return err(500, 'cannot read file');
	}
}

/** Resolve a plugin's installPath via the plugin adapter's detail() (mirror of routes/plugins.ts). */
async function resolveInstallPath(name: string, project: string | null, tool?: string): Promise<string | null> {
	const adapter = registry(profileOf(tool ?? 'claude')).find((a) => a.kind === 'plugin');
	const detailFn = (adapter as { detail?: (n: string, p: string | null) => Promise<PluginDetail> }).detail;
	if (!adapter || !detailFn) return null;
	try {
		const detail = await detailFn.call(adapter, name, project);
		return detail.installPath || null;
	} catch {
		return null;
	}
}

/** Resolve + containment-check a subpath inside a root (mirror of resolveSafePath). */
function safeSubPath(rootRaw: string, subpath: string | undefined): string | null {
	const root = path.normalize(rootRaw);
	const rel = (subpath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
	if (!rel) return root;
	if (/^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return null;
	const abs = path.resolve(root, rel);
	if (abs !== root && !abs.startsWith(root + path.sep)) return null;
	return abs;
}

/** Reject names with separators/traversal (mirror of isValidName in routes/skills.ts). */
function isValidName(name: string): boolean {
	return name !== '' && !name.includes('/') && !name.includes('\\')
		&& !name.includes('..') && !name.includes('\0');
}

// ---------------------------------------------------------------- command registry

const COMMANDS: Record<string, (args: Args) => Promise<RemoteResult>> = {
	// ---- overview / tools (mirror of routes/tools.ts) ----
	overview: async (a) => ok(await overview(strOrNull(a.project), profileOf(str(a.tool, 'claude')))),
	'tools.detail': async (a) => {
		const kind = str(a.kind) as ToolKind;
		const adapter = registry(profileOf(str(a.tool, 'claude'))).find((x) => x.kind === kind);
		if (!adapter) return err(400, 'unsupported kind');
		const items = await adapter.scan({ project: strOrNull(a.project), profile: profileOf(str(a.tool, 'claude')) });
		const it = items.find((i) => i.name === a.name);
		if (!it) return err(404, 'not found');
		return ok(it.perScope);
	},
	'tools.content': async (a) => {
		const kind = str(a.kind) as ToolKind;
		const adapter = registry(profileOf(str(a.tool, 'claude'))).find((x) => x.kind === kind);
		if (!adapter) return err(400, 'unsupported kind');
		try {
			return ok(await adapter.view(str(a.name)));
		} catch (e) {
			return err(404, (e as Error).message);
		}
	},
	'tools.setStatus': async (a) => {
		const kind = str(a.kind) as ToolKind;
		const adapter = registry(profileOf(str(a.tool, 'claude'))).find((x) => x.kind === kind);
		if (!adapter) return err(400, 'unsupported kind');
		try {
			const profile = profileOf(str(a.tool, 'claude'));
			await adapter.setStatus(str(a.name), a.scope as Scope, a.status as Status, { project: strOrNull(a.project), profile });
		} catch (e) {
			return err(500, (e as Error).message);
		}
		return ok({ ok: true });
	},

	// ---- projects (mirror of routes/projects.ts) ----
	'projects.list': async (a) => ok(await listProjects(profileOf(str(a.tool, 'claude')))),
	'projects.delete': async (a) => {
		const done = await deleteProject(profileOf(str(a.tool, 'claude')), str(a.encoded));
		if (!done) return err(404, 'project not found or not removable');
		return ok({ ok: true });
	},

	// ---- markdown resources (mirror of routes/{instructions,rules,commands,agents}.ts) ----
	'md.list': async (a) => {
		const r = MD_READERS[a.resource as MdResource];
		if (!r) return err(400, 'unknown resource');
		return ok(await r.list(profileOf(str(a.tool, 'claude'))));
	},
	'md.content': async (a) => {
		const resource = str(a.resource);
		if (!(resource in MD_READERS)) return err(400, 'unknown resource');
		return mdContent(resource as MdResource, str(a.path), a.tool as string | undefined);
	},
	'md.save': async (a) => {
		const resource = str(a.resource);
		if (!(resource in MD_READERS)) return err(400, 'unknown resource');
		return mdSave(resource as MdResource, str(a.path), str(a.content, ''), a.tool as string | undefined);
	},

	// ---- hooks / mcps / settings (mirror of routes/{hooks,mcps,settings}.ts) ----
	'hooks.list': async (a) => ok(await listHooks(profileOf(str(a.tool, 'claude')))),
	'mcps.list': async (a) => ok(await listMcps(profileOf(str(a.tool, 'claude')))),
	'mcps.detail': async (a) => {
		const name = str(a.name, '');
		if (!name) return err(400, 'name is required');
		const project = strOrNull(a.project);
		const match = (await listMcps(profileOf(str(a.tool, 'claude')))).find(
			(s) => s.name === name && s.scope === a.scope && (s.project ?? null) === (project ?? null),
		);
		if (!match) return err(404, 'mcp server not found');
		return ok(match);
	},
	'mcps.tools': async (a) => {
		// Probe runs ON the remote (spawn/fetch originate there — semantically correct:
		// it tests what the remote tool would reach). Errors stay inline, like the local route.
		const name = str(a.name, '');
		if (!name) return err(400, 'name is required');
		const project = strOrNull(a.project);
		const match = (await listMcps(profileOf(str(a.tool, 'claude')))).find(
			(s) => s.name === name && s.scope === a.scope && (s.project ?? null) === (project ?? null),
		);
		if (!match) return err(404, 'mcp server not found');
		try {
			return ok({ tools: await listMcpTools(match) });
		} catch (e) {
			return ok({ tools: [], error: (e as Error).message });
		}
	},
	'settings.user': async (a) => ok(await readUser(profileOf(str(a.tool, 'claude')))),

	// ---- plugin file browser (mirror of routes/plugins.ts) ----
	'plugins.detail': async (a) => {
		const adapter = registry(profileOf(str(a.tool, 'claude'))).find((x) => x.kind === 'plugin');
		const detailFn = (adapter as { detail?: (n: string, p: string | null) => Promise<PluginDetail> }).detail;
		if (!adapter || !detailFn) return err(404, 'detail not supported');
		try {
			return ok(await detailFn.call(adapter, str(a.name), strOrNull(a.project)));
		} catch (e) {
			return err(404, (e as Error).message);
		}
	},
	'plugins.files': async (a) => {
		const root = await resolveInstallPath(str(a.name), strOrNull(a.project), a.tool as string | undefined);
		if (!root) return err(403, 'plugin not found or path outside install dir');
		const abs = safeSubPath(root, a.subpath as string | undefined);
		if (!abs) return err(403, 'plugin not found or path outside install dir');
		const res = await listDirEntries(abs);
		return res.status === 200 ? ok({ entries: (res.body as { entries: unknown }).entries, root }) : res;
	},
	'plugins.fileContent': async (a) => {
		const root = await resolveInstallPath(str(a.name), strOrNull(a.project), a.tool as string | undefined);
		if (!root) return err(403, 'plugin not found or path outside install dir');
		const abs = safeSubPath(root, a.subpath as string | undefined);
		if (!abs) return err(403, 'plugin not found or path outside install dir');
		return readPreviewFile(abs);
	},

	// ---- skill file browser + promote/delete (mirror of routes/skills.ts) ----
	'skills.files': async (a) => {
		const base = a.scope === 'project' && a.project ? projectSkillsDir(str(a.project), profileOf(str(a.tool, 'claude'))) : globalSkillsDir(profileOf(str(a.tool, 'claude')));
		const skillDir = path.join(base, str(a.name));
		if (!isValidName(str(a.name))) return err(404, 'skill not found');
		if (!(await tryStat(skillDir))?.isDirectory) return err(404, 'skill not found');
		const rel = (a.subpath as string | undefined ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
		if (/^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return err(403, 'path outside skill dir');
		const abs = rel ? path.resolve(skillDir, rel) : skillDir;
		if (abs !== skillDir && !abs.startsWith(skillDir + path.sep)) return err(403, 'path outside skill dir');
		const res = await listDirEntries(abs);
		return res.status === 200 ? ok({ entries: (res.body as { entries: unknown }).entries, root: skillDir }) : res;
	},
	'skills.fileContent': async (a) => {
		const base = a.scope === 'project' && a.project ? projectSkillsDir(str(a.project), profileOf(str(a.tool, 'claude'))) : globalSkillsDir(profileOf(str(a.tool, 'claude')));
		const skillDir = path.join(base, str(a.name));
		if (!isValidName(str(a.name))) return err(404, 'skill not found');
		if (!(await tryStat(skillDir))?.isDirectory) return err(404, 'skill not found');
		const rel = (a.subpath as string | undefined ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
		if (/^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return err(403, 'path outside skill dir');
		const abs = rel ? path.resolve(skillDir, rel) : skillDir;
		if (abs !== skillDir && !abs.startsWith(skillDir + path.sep)) return err(403, 'path outside skill dir');
		return readPreviewFile(abs);
	},
	'skills.promote': async (a) => {
		const profile = profileOf(str(a.tool, 'claude'));
		const name = str(a.name);
		const project = str(a.project);
		if (!isValidName(name)) return err(400, 'invalid skill name');
		const src = path.join(projectSkillsDir(project, profile), name);
		const dst = path.join(globalSkillsDir(profile), name);
		const srcStat = await tryStat(src);
		if (!srcStat?.isDirectory) return err(404, 'project skill not found');
		if (await getFs().exists(dst)) return err(409, 'a global skill with this name already exists');
		let projCanonical: string;
		let srcCanonical: string;
		try {
			projCanonical = await getFs().realpath(project);
			srcCanonical = await getFs().realpath(src);
		} catch (e) {
			return err(400, (e as Error).message);
		}
		const sep = path.sep;
		const contained = srcCanonical === projCanonical || srcCanonical.startsWith(projCanonical + sep);
		if (!contained) return err(400, 'skill path must be inside the project');
		try {
			await getFs().copy(srcCanonical, dst, { recursive: true });
			await getFs().remove(srcCanonical, { recursive: true });
		} catch (e) {
			return err(500, (e as Error).message);
		}
		return ok({ ok: true });
	},
	'skills.delete': async (a) => {
		const profile = profileOf(str(a.tool, 'claude'));
		const name = str(a.name);
		const isProject = a.scope === 'project';
		if (!isValidName(name)) return err(400, 'invalid skill name');
		if (isProject && !a.project) return err(400, 'project required for project scope');
		const base = isProject ? projectSkillsDir(str(a.project), profile) : globalSkillsDir(profile);
		const target = path.join(base, name);
		const targetStat = await tryStat(target);
		if (!targetStat?.isDirectory) return err(404, 'skill not found');
		let baseCanonical: string;
		let targetCanonical: string;
		try {
			baseCanonical = isProject ? await getFs().realpath(str(a.project)) : await getFs().realpath(base);
			targetCanonical = await getFs().realpath(target);
		} catch (e) {
			return err(400, (e as Error).message);
		}
		const sep = path.sep;
		const contained = targetCanonical === baseCanonical || targetCanonical.startsWith(baseCanonical + sep);
		if (!contained) return err(400, 'skill path must be inside its base');
		try {
			await getFs().remove(targetCanonical, { recursive: true });
		} catch (e) {
			return err(500, (e as Error).message);
		}
		return ok({ ok: true });
	},
};

// ---- tiny arg coercion helpers (args come from JSON, values are unknown) ----
function str(v: unknown, dflt = ''): string {
	return typeof v === 'string' ? v : dflt;
}
function strOrNull(v: unknown): string | null {
	return v == null || v === 'null' ? null : str(v);
}

const command = process.argv[2];
const handler = command ? COMMANDS[command] : undefined;
if (!handler) {
	process.stderr.write(`[ccc-remote] unknown command: ${command ?? '(none)'}\n`);
	process.exit(2);
}

try {
	// Args arrive two ways (runner picks by size): inline base64 (small) or "@<path>" pointing
	// at a JSON file uploaded over SFTP (large — cmd.exe caps the command line at ~8k chars,
	// and it does not forward stdin EOF to the child, so a file is the only reliable channel).
	const spec = process.argv[3] ?? '';
	let args: Args = {};
	if (spec.startsWith('@')) {
		args = JSON.parse(await fsp.readFile(spec.slice(1), 'utf8')) as Args;
	} else if (spec) {
		args = JSON.parse(Buffer.from(spec, 'base64').toString('utf8')) as Args;
	}
	const result = await handler(args);
	process.stdout.write(JSON.stringify(result));
} catch (e) {
	process.stderr.write(`[ccc-remote] ${command} failed: ${(e as Error).message}\n${(e as Error).stack ?? ''}\n`);
	process.exit(1);
}
