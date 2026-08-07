// PluginAdapter — ported from src-tauri/src/adapters/plugin.rs.
// Plugins are recorded in <configRoot>/plugins/installed_plugins.json; toggle key is
// enabledPlugins in settings (name@marketplace → boolean).

import fs from 'node:fs';
import { installedPluginsFile } from '../paths.js';
import { readProject, readUser, writeProject, writeUser } from '../settings.js';
import type { ToolProfile } from '../profiles.js';
import {
	type Mechanism, resolveEffective, type ScanCtx, type Scope, type ScopeCtx,
	type ScopeStatus, type Status, type ToolContent, type ToolInstance,
} from '../model.js';
import { readJsonKey, writeJsonKey, type JsonKeyEncoding } from '../mutations/jsonKey.js';
import type { ToolAdapter } from './types.js';

type Json = Record<string, unknown>;

interface InstallRecord {
	scope?: string;
	installPath: string;
	version?: string | null;
}

/** Read installed_plugins.json → map of name → records. Parse error → empty. */
function readInstalled(profile: ToolProfile): Map<string, InstallRecord[]> {
	const p = installedPluginsFile(profile);
	if (!fs.existsSync(p)) return new Map();
	try {
		const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as { plugins?: Record<string, InstallRecord[]> };
		const map = new Map<string, InstallRecord[]>();
		for (const [k, v] of Object.entries(parsed?.plugins ?? {})) {
			map.set(k, Array.isArray(v) ? v : []);
		}
		return map;
	} catch {
		return new Map();
	}
}

// enabledPlugins encoding: boolean (true=enabled, false=disabled). name-only/user-only collapse to true.
const PLUGIN_ENCODING: JsonKeyEncoding = { kind: 'boolean' };

/** enabledPlugins[name]: boolean → enabled/disabled; missing/non-boolean → inherited. Delegates to jsonKey. */
function readEnabled(settings: Json, name: string): Status {
	return readJsonKey(settings, 'enabledPlugins', name, PLUGIN_ENCODING);
}

/** Set enabledPlugins[name] boolean; 'inherited' removes the key. Delegates to jsonKey. */
function writeEnabled(settings: Json, name: string, status: Status): void {
	writeJsonKey(settings, 'enabledPlugins', name, status, PLUGIN_ENCODING);
}

export class PluginAdapter implements ToolAdapter {
	kind = 'plugin' as const;
	mechanism: Mechanism = 'nativeToggle';

	constructor(private readonly profile: ToolProfile) {}

	scan(ctx: ScanCtx): ToolInstance[] {
		const out: ToolInstance[] = [];
		const p = this.profile;
		const installed = readInstalled(p);
		for (const [full, records] of installed) {
			const rec = records[0];
			if (!rec) continue;
			const perScope = this.statuses(full, ctx.project);
			out.push({
				kind: 'plugin',
				name: full,
				description: rec.version ?? null,
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

	private statuses(name: string, project: string | null): ScopeStatus[] {
		const p = this.profile;
		let userStatus: Status = 'inherited';
		try { userStatus = readEnabled(readUser(p), name); } catch { /* inherited */ }
		const v: ScopeStatus[] = [{ scope: { level: 'user' }, status: userStatus }];
		if (project) {
			let prStatus: Status = 'inherited';
			try { prStatus = readEnabled(readProject(project, p), name); } catch { /* inherited */ }
			v.push({ scope: { level: 'project', path: project }, status: prStatus });
		}
		return v;
	}

	setStatus(name: string, scope: Scope, status: Status, _ctx: ScopeCtx): void {
		const p = this.profile;
		if (scope.level === 'user') {
			const s = readUser(p);
			writeEnabled(s, name, status);
			writeUser(p, s);
		} else {
			const s = readProject(scope.path, p);
			writeEnabled(s, name, status);
			writeProject(scope.path, p, s);
		}
	}

	view(name: string): ToolContent {
		const installed = readInstalled(this.profile);
		const rec = installed.get(name)?.[0];
		if (!rec) throw new Error(`plugin not found: ${name}`);
		const raw = `plugin ${name} installed at ${rec.installPath} (scope ${rec.scope ?? '?'})`;
		return { kind: 'plugin', name, raw };
	}
}
