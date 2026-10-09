// PluginAdapter — ported from src-tauri/src/adapters/plugin.rs.
// Plugins are recorded in <configRoot>/plugins/installed_plugins.json; toggle key is
// enabledPlugins in settings (name@marketplace → boolean).

import path from 'node:path';
import { readProject, readUser, writeProject, writeUser } from '../settings.js';
import { configRoot } from '../paths.js';
import { parse as parseYaml } from 'yaml';
import type { ToolProfile } from '../profiles.js';
import {
	type ComponentKind, type Mechanism, type PluginComponent, type PluginDetail, type PluginSkillGroup, resolveEffective,
	type ScanCtx, type Scope, type ScopeCtx, type ScopeStatus, type Status,
	type ToolContent, type ToolInstance,
} from '../model.js';
import { readRegistry, readFlag, writeFlag, type InstallRecord } from '../locator.js';
import { parseFrontmatterField } from '../markdown-resource.js';
import { getFs } from '../hosts/context.js';
import type { ToolAdapter } from './types.js';

type Json = Record<string, unknown>;

interface PluginManifest {
	description?: string;
	version?: string;
}

/** Read a plugin's description from its own manifest (.claude-plugin/plugin.json). */
async function readDescription(installPath: string): Promise<string | null> {
	const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
	try {
		const m = JSON.parse(await getFs().readFile(manifestPath)) as PluginManifest;
		return m.description?.trim() || null;
	} catch {
		return null;
	}
}

/** Read the full manifest object (for component listing). */
async function readManifest(installPath: string): Promise<Record<string, unknown> | null> {
	const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
	try {
		const m = JSON.parse(await getFs().readFile(manifestPath));
		return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** List skill directory names present under {installPath}/skills/. */
async function listSkillDirs(installPath: string): Promise<string[]> {
	const dir = path.join(installPath, 'skills');
	try {
		return (await getFs().readDir(dir)).filter((e) => e.isDirectory).map((e) => e.name);
	} catch {
		return [];
	}
}

/** Parse a SKILL.md description (front-matter, supporting folded >- / literal | block scalars).
 *  Exported for SkillAdapter — both card surfaces must agree on this one parser
 *  (official-standard fields only: name + description; version/… keys are ignored). */
export async function parseSkillDescription(skillMd: string): Promise<string | undefined> {
	let raw: string;
	try {
		raw = await getFs().readFile(skillMd);
	} catch {
		return undefined;
	}
	if (!raw.startsWith('---')) {
		for (const line of raw.split(/\r?\n/)) {
			if (line === '' || line.startsWith('#')) continue;
			return line.trim() || undefined;
		}
		return undefined;
	}
	// /\r?\n/: Windows-authored SKILL.md (CRLF) must parse identically — a trailing
	// \r would otherwise break the `(.*)$` field regex and null the description.
	const lines = raw.split(/\r?\n/).slice(1);
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === '---') break;
		const m = lines[i].match(/^description:\s*(.*)$/);
		if (!m) continue;
		const inline = m[1].trim();
		if (inline && !/^[>|]/.test(inline)) {
			return inline.replace(/^"+|"+$/g, '') || undefined;
		}
		const collected: string[] = [];
		for (let j = i + 1; j < lines.length; j++) {
			const ln = lines[j];
			if (ln.trim() === '---') break;
			if (ln.startsWith(' ') || ln.startsWith('\t')) collected.push(ln.trim());
			else if (ln.trim() === '') continue;
			else break;
		}
		return collected.join(' ') || undefined;
	}
	return undefined;
}

/** List *.md filenames (without extension) directly under dir/. [] if dir missing. */
async function listMdFiles(dir: string): Promise<string[]> {
	try {
		return (await getFs().readDir(dir))
			.filter((e) => e.isFile && e.name.toLowerCase().endsWith('.md'))
			.map((e) => e.name.replace(/\.md$/i, ''));
	} catch {
		return [];
	}
}

/** List subdirectory names directly under dir/. [] if dir missing. */
async function listSubdirs(dir: string): Promise<string[]> {
	try {
		return (await getFs().readDir(dir)).filter((e) => e.isDirectory).map((e) => e.name);
	} catch {
		return [];
	}
}

/**
 * Read <installPath>/hooks/hooks.json and return the event names present in it.
 * Real plugins keep hook bindings in this single config file, not as per-hook
 * manifest fields. [] if the file is missing/unparseable.
 */
async function listHookEvents(installPath: string): Promise<string[]> {
	const f = path.join(installPath, 'hooks', 'hooks.json');
	try {
		const j = JSON.parse(await getFs().readFile(f)) as unknown;
		const h = (j && typeof j === 'object' && !Array.isArray(j) && 'hooks' in (j as Record<string, unknown>))
			? (j as Record<string, unknown>)['hooks']
			: j;
		if (h && typeof h === 'object' && !Array.isArray(h)) {
			return Object.keys(h as Record<string, unknown>);
		}
	} catch { /* missing or unparseable */ }
	return [];
}

/** Extract names from one manifest field (array of strings/{name}, object keys, or string). */
function collectManifestNames(manifest: Record<string, unknown> | null, key: string, into: Set<string>): void {
	if (!manifest) return;
	const v = manifest[key];
	if (!v) return;
	if (Array.isArray(v)) {
		for (const item of v) {
			if (typeof item === 'string') into.add(item.replace(/^\.?\//, ''));
			else if (item && typeof item === 'object') {
				const n = (item as Record<string, unknown>)['name'];
				if (typeof n === 'string') into.add(n);
			}
		}
	} else if (v && typeof v === 'object') {
		for (const name of Object.keys(v as Record<string, unknown>)) into.add(name);
	} else if (typeof v === 'string') {
		into.add(v.replace(/^\.?\//, ''));
	}
}

/**
 * Line-parse a FLAT preset.yml (top-level `name:` / `description:` keys) — DSH preset
 * metadata without pulling in a YAML dependency. Quoted values are unquoted; nested
 * keys are ignored (preset.yml keeps its metadata at the top level).
 */
async function readPresetMeta(dir: string): Promise<{ name: string | null; description: string | null }> {
	try {
		const raw = await getFs().readFile(path.join(dir, 'preset.yml'));
		let name: string | null = null;
		let description: string | null = null;
		for (const line of raw.split('\n')) {
			const m = /^(name|description):\s*(.*)$/.exec(line);
			if (!m) continue;
			const v = m[2].trim().replace(/^["']+|["']+$/g, '');
			if (!v) continue;
			if (m[1] === 'name' && !name) name = v;
			if (m[1] === 'description' && !description) description = v;
		}
		return { name, description };
	} catch {
		return { name: null, description: null };
	}
}

type YamlRow = { id?: unknown; name?: unknown; disabled?: unknown; config?: unknown };

/** Parse agent.cordis.yml into top-level plugin rows; null when absent/unparseable.
 *  `!!js` tagged values (e.g. `disabled: !!js process.platform === 'win32'`) are NEVER
 *  evaluated — the expression is pre-stripped to null before parsing. */
async function readComposition(dir: string): Promise<YamlRow[] | null> {
	try {
		const raw = await getFs().readFile(path.join(dir, 'agent.cordis.yml'));
		const cleaned = raw.replace(/([ \t])!!js[^\n]*/g, '$1null');
		const parsed = parseYaml(cleaned) as unknown;
		return Array.isArray(parsed) ? (parsed as YamlRow[]) : null;
	} catch {
		return null;
	}
}

/** Classify a composition row by its plugin package name (heuristic, unknown → tool). */
function dshKindOf(pkg: string): ComponentKind {
	if (pkg === 'cordis:group') return 'group';
	if (pkg.includes('persona')) return 'persona';
	if (pkg.includes('subagent') || pkg.includes('workflow') || pkg.includes('ralph')) return 'agent';
	if (pkg.includes('command')) return 'command';
	if (pkg.startsWith('dsh-tool')) return 'tool';
	if (pkg.includes('skill')) return 'skill';
	return 'tool';
}

/**
 * DSH composition rows → PluginComponent[] (Phase B). Group rows (cordis:group)
 * become their own 分组 card AND their children are flattened into kind-classified
 * cards. Row config is pretty-printed into configJson for the level-2 JSON view.
 */
async function buildDshComponents(dir: string): Promise<PluginComponent[]> {
	const rows = await readComposition(dir);
	if (!rows) return [];
	const out: PluginComponent[] = [];
	const visit = (row: YamlRow, groupLabel: string | null): void => {
		if (!row || typeof row !== 'object') return;
		const id = typeof row['id'] === 'string' ? row['id'] : '';
		if (!id) return;
		const pkg = typeof row['name'] === 'string' ? row['name'] : '';
		const disabled = row['disabled'] === true;
		const isGroup = pkg === 'cordis:group';
		const kind = isGroup ? 'group' : dshKindOf(pkg);
		const config = row['config'];
		const detailBits: string[] = [];
		if (groupLabel) detailBits.push(`[${groupLabel}]`);
		if (pkg) detailBits.push(pkg);
		if (disabled) detailBits.push('（已禁用）');
		if (isGroup) {
			const children = Array.isArray(config) ? config.length : 0;
			detailBits.push(`分组 · ${children} 个子行`);
		}
		const pretty = config !== undefined && config !== null
			? JSON.stringify(config, null, 2)
			: undefined;
		out.push({
			kind,
			name: id,
			detail: detailBits.join(' · '),
			configJson: pretty,
		});
		if (isGroup && Array.isArray(config)) {
			for (const child of config as YamlRow[]) visit(child, id);
		}
	};
	for (const row of rows) visit(row, null);
	return out;
}

/**
 * Build a structured component inventory. Components are discovered BOTH from the
 * manifest (.claude-plugin/plugin.json fields) AND from the standard directory
 * layout most plugins actually use on disk:
 *   - skills/<name>/        (subdir with SKILL.md)
 *   - commands/<name>.md    (one slash command per .md file)
 *   - agents/<name>.md      (one subagent per .md file)
 *   - mcp/<name>/           (one MCP server per subdir)
 *   - hooks/hooks.json      (one component per event present)
 * Results are filtered by `supported` (capability gap: e.g. ZCode ignores plugin agents).
 */
async function buildComponents(installPath: string, manifest: Record<string, unknown> | null, supported: readonly PluginComponent['kind'][]): Promise<PluginComponent[]> {
	const out: PluginComponent[] = [];
	const sup = new Set(supported);

	if (sup.has('skill')) {
		const names = new Set<string>();
		collectManifestNames(manifest, 'skills', names);
		for (const dir of await listSkillDirs(installPath)) names.add(dir);
		for (const name of [...names].sort()) {
			out.push({ kind: 'skill', name, detail: await parseSkillDescription(path.join(installPath, 'skills', name, 'SKILL.md')) });
		}
	}
	if (sup.has('command')) {
		const names = new Set<string>();
		collectManifestNames(manifest, 'commands', names);
		for (const f of await listMdFiles(path.join(installPath, 'commands'))) names.add(f);
		for (const name of [...names].sort()) {
			out.push({ kind: 'command', name, detail: await parseFrontmatterField(path.join(installPath, 'commands', name + '.md'), 'description') });
		}
	}
	if (sup.has('agent')) {
		const names = new Set<string>();
		collectManifestNames(manifest, 'agents', names);
		for (const f of await listMdFiles(path.join(installPath, 'agents'))) names.add(f);
		for (const name of [...names].sort()) {
			out.push({ kind: 'agent', name, detail: await parseFrontmatterField(path.join(installPath, 'agents', name + '.md'), 'description') });
		}
	}
	if (sup.has('mcp')) {
		const names = new Set<string>();
		collectManifestNames(manifest, 'mcpServers', names);
		for (const d of await listSubdirs(path.join(installPath, 'mcp'))) names.add(d);
		for (const name of [...names].sort()) {
			out.push({ kind: 'mcp', name });
		}
	}
	if (sup.has('hook')) {
		const events = new Set<string>();
		if (manifest && manifest['hooks'] && typeof manifest['hooks'] === 'object' && !Array.isArray(manifest['hooks'])) {
			for (const ev of Object.keys(manifest['hooks'] as Record<string, unknown>)) events.add(ev);
		}
		for (const ev of await listHookEvents(installPath)) events.add(ev);
		for (const name of [...events].sort()) {
			out.push({ kind: 'hook', name });
		}
	}
	if (sup.has('lsp')) {
		const names = new Set<string>();
		collectManifestNames(manifest, 'lspServers', names);
		for (const name of [...names].sort()) {
			out.push({ kind: 'lsp', name });
		}
	}

	return out;
}

export class PluginAdapter implements ToolAdapter {
	kind = 'plugin' as const;
	mechanism: Mechanism = 'nativeToggle';

	constructor(private readonly profile: ToolProfile) {}

	async scan(ctx: ScanCtx): Promise<ToolInstance[]> {
		const out: ToolInstance[] = [];
		const p = this.profile;
		// DSH: presets (.agent-presets/<id>/preset.yml) are the "plugins" — always
		// enabled (mounted by choice), no toggle registry.
		if (p.id === 'dsh') {
			const root = path.join(configRoot(p), ...p.plugins.dirRelative);
			if (await getFs().exists(root)) {
				for (const entry of await getFs().readDir(root)) {
					if (!entry.isDirectory) continue;
					const dir = path.join(root, entry.name);
					const meta = await readPresetMeta(dir);
					out.push({
						kind: 'plugin',
						name: entry.name,
						description: meta.description ?? meta.name ?? null,
						mechanism: 'nativeToggle',
						origin: 'global',
						sourcePath: dir,
						perScope: [{ scope: { level: 'user' }, status: 'enabled' }],
						effective: 'enabled',
						profile: p.id,
					});
				}
			}
			out.sort((a, b) => a.name.localeCompare(b.name));
			return out;
		}
		const installed = await readRegistry(p);
		for (const [full, records] of installed) {
			const rec = records[0];
			if (!rec) continue;
			const perScope = await this.statuses(full, ctx.project);
			// Prefer the manifest description; fall back to version; then null.
			const manifestDesc = await readDescription(rec.installPath);
			const description = manifestDesc ?? (rec.version ? `v${rec.version}` : null);
			out.push({
				kind: 'plugin',
				name: full,
				description,
				mechanism: 'nativeToggle',
				origin: 'global',
				sourcePath: rec.installPath,
				perScope,
				effective: resolveEffective(perScope),
				profile: p.id,
			});
		}
		out.sort((a, b) => a.name.localeCompare(b.name));
		return out;
	}

	private async statuses(name: string, project: string | null): Promise<ScopeStatus[]> {
		const p = this.profile;
		// DSH presets are always enabled (mounted by choice) — no registry to read.
		if (p.id === 'dsh') {
			const v: ScopeStatus[] = [{ scope: { level: 'user' }, status: 'enabled' }];
			if (project) v.push({ scope: { level: 'project', path: project }, status: 'enabled' });
			return v;
		}
		const enc = p.plugins.enabledEncoding;
		const kp = p.plugins.enabledKeyPath;
		let userStatus: Status = 'inherited';
		try { userStatus = readFlag(enc, await readUser(p), kp, name); } catch { /* inherited */ }
		const v: ScopeStatus[] = [{ scope: { level: 'user' }, status: userStatus }];
		if (project) {
			let prStatus: Status = 'inherited';
			try { prStatus = readFlag(enc, await readProject(project, p), kp, name); } catch { /* inherited */ }
			v.push({ scope: { level: 'project', path: project }, status: prStatus });
		}
		return v;
	}

	async setStatus(name: string, scope: Scope, status: Status, _ctx: ScopeCtx): Promise<void> {
		const p = this.profile;
		if (p.id === 'dsh') throw new Error('DSH 预设为只读（启停由组合挂载决定）');
		const enc = p.plugins.enabledEncoding;
		const kp = p.plugins.enabledKeyPath;
		if (scope.level === 'user') {
			const s = await readUser(p);
			writeFlag(enc, s, kp, name, status);
			await writeUser(p, s);
		} else {
			const s = await readProject(scope.path, p);
			writeFlag(enc, s, kp, name, status);
			await writeProject(scope.path, p, s);
		}
	}

	async view(name: string): Promise<ToolContent> {
		const installed = await readRegistry(this.profile);
		const rec = installed.get(name)?.[0];
		if (!rec) throw new Error(`plugin not found: ${name}`);
		const raw = `plugin ${name} installed at ${rec.installPath} (scope ${rec.scope ?? '?'})`;
		return { kind: 'plugin', name, raw };
	}

	/**
	 * Structured detail: manifest metadata + per-scope status + component inventory.
	 * Unlike view() (a text blob), this returns typed fields for structured rendering.
	 */
	async detail(name: string, project: string | null): Promise<PluginDetail> {
		const p = this.profile;
		// DSH preset detail — Phase A: metadata only, no component parsing.
		if (p.id === 'dsh') {
			const dir = path.join(configRoot(p), ...p.plugins.dirRelative, name);
			if (!(await getFs().exists(dir))) throw new Error(`preset not found: ${name}`);
			const meta = await readPresetMeta(dir);
			const perScope: ScopeStatus[] = [{ scope: { level: 'user' }, status: 'enabled' }];
			return {
				kind: 'plugin',
				name,
				description: meta.description ?? meta.name ?? null,
				version: null,
				installPath: dir,
				scope: null,
				profile: p.id,
				perScope,
				effective: resolveEffective(perScope),
				components: await buildDshComponents(dir),
			};
		}
		const installed = await readRegistry(p);
		const rec = installed.get(name)?.[0];
		if (!rec) throw new Error(`plugin not found: ${name}`);
		const manifest = await readManifest(rec.installPath);
		const description = (manifest && typeof manifest['description'] === 'string')
			? manifest['description'].trim() || null
			: (rec.version ? `v${rec.version}` : null);
		const perScope = await this.statuses(name, project);
		return {
			kind: 'plugin',
			name,
			description,
			version: rec.version ?? null,
			installPath: rec.installPath,
			scope: rec.scope ?? null,
			profile: this.profile.id,
			perScope,
			effective: resolveEffective(perScope),
			components: await buildComponents(rec.installPath, manifest, this.profile.plugins.supportedComponents),
		};
	}
}

/**
 * Skills provided by installed plugins, one group per plugin — feeds the Skills
 * page's "from plugins" section. One aggregate call (not N per-plugin requests)
 * so the remote-exec path stays O(1) SSH execs. Groups with zero skills are
 * omitted; a disabled plugin still lists (its skills just don't load).
 */
export async function listPluginSkillGroups(profile: ToolProfile, project: string | null): Promise<PluginSkillGroup[]> {
	const adapter = new PluginAdapter(profile);
	const out: PluginSkillGroup[] = [];
	for (const inst of await adapter.scan({ project, profile })) {
		const detail = await adapter.detail(inst.name, project);
		const skills = detail.components
			.filter((cpt) => cpt.kind === 'skill')
			.map((cpt) => ({ name: cpt.name, description: cpt.detail ?? null }));
		if (skills.length > 0) out.push({ plugin: inst.name, effective: inst.effective, skills });
	}
	out.sort((a, b) => a.plugin.localeCompare(b.plugin));
	return out;
}
