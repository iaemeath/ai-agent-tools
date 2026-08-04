// PluginAdapter — ported from src-tauri/src/adapters/plugin.rs.
// Plugins are recorded in ~/.claude/plugins/installed_plugins.json; toggle key is
// enabledPlugins in settings.json (name@marketplace → boolean).

import fs from 'node:fs';
import { installedPluginsFile } from '../paths.js';
import { readProject, readUser, writeProject, writeUser } from '../settings.js';
import {
	type Mechanism, resolveEffective, type ScanCtx, type Scope, type ScopeCtx,
	type ScopeStatus, type Status, type ToolContent, type ToolInstance,
} from '../model.js';
import type { ToolAdapter } from './types.js';

type Json = Record<string, unknown>;

interface InstallRecord {
	scope?: string;
	installPath: string;
	version?: string | null;
}

/** Read ~/.claude/plugins/installed_plugins.json → map of name → records. Parse error → empty. */
function readInstalled(): Map<string, InstallRecord[]> {
	const p = installedPluginsFile();
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

/** enabledPlugins[name]: boolean → enabled/disabled; missing/non-boolean → inherited. */
function readEnabled(settings: Json, name: string): Status {
	const ep = settings['enabledPlugins'];
	if (!ep || typeof ep !== 'object' || Array.isArray(ep)) return 'inherited';
	const v = (ep as Json)[name];
	if (typeof v !== 'boolean') return 'inherited';
	return v ? 'enabled' : 'disabled';
}

/** Set enabledPlugins[name] boolean; 'inherited' removes the key; empty map removes the key. */
function writeEnabled(settings: Json, name: string, status: Status): void {
	let map = settings['enabledPlugins'];
	if (!map || typeof map !== 'object' || Array.isArray(map)) {
		map = {};
		settings['enabledPlugins'] = map;
	}
	const m = map as Record<string, unknown>;
	// NativeToggle can't express name-only/user-only; they collapse to enabled (true).
	if (status === 'enabled' || status === 'name-only' || status === 'user-only') {
		m[name] = true;
	} else if (status === 'disabled') {
		m[name] = false;
	} else {
		delete m[name];
	}
	if (Object.keys(m).length === 0) delete settings['enabledPlugins'];
}

export class PluginAdapter implements ToolAdapter {
	kind = 'plugin' as const;
	mechanism: Mechanism = 'nativeToggle';

	scan(ctx: ScanCtx): ToolInstance[] {
		const out: ToolInstance[] = [];
		const installed = readInstalled();
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
			});
		}
		out.sort((a, b) => a.name.localeCompare(b.name));
		return out;
	}

	private statuses(name: string, project: string | null): ScopeStatus[] {
		let userStatus: Status = 'inherited';
		try { userStatus = readEnabled(readUser(), name); } catch { /* inherited */ }
		const v: ScopeStatus[] = [{ scope: { level: 'user' }, status: userStatus }];
		if (project) {
			let prStatus: Status = 'inherited';
			try { prStatus = readEnabled(readProject(project), name); } catch { /* inherited */ }
			v.push({ scope: { level: 'project', path: project }, status: prStatus });
		}
		return v;
	}

	setStatus(name: string, scope: Scope, status: Status, _ctx: ScopeCtx): void {
		if (scope.level === 'user') {
			const s = readUser();
			writeEnabled(s, name, status);
			writeUser(s);
		} else {
			const s = readProject(scope.path);
			writeEnabled(s, name, status);
			writeProject(scope.path, s);
		}
	}

	view(name: string): ToolContent {
		const installed = readInstalled();
		const rec = installed.get(name)?.[0];
		if (!rec) throw new Error(`plugin not found: ${name}`);
		const raw = `plugin ${name} installed at ${rec.installPath} (scope ${rec.scope ?? '?'})`;
		return { kind: 'plugin', name, raw };
	}
}
