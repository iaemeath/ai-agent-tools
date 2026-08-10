// MCP reader — read-only discovery of MCP servers across tools.
//
// MCP servers are declared in each tool's config as a name → config map:
//   - Claude user-level:   ~/.claude.json           → mcpServers
//   - Claude project:      <proj>/.mcp.json          → mcpServers
//   - ZCode  user-level:   ~/.zcode/cli/config.json  → mcp.servers
//   - ZCode  project:      <proj>/.zcode/config.json → mcp.servers
//
// This module is read-only (list only). No toggle, no edit — the on/off and edit
// mechanisms differ too widely across tools to unify (ZCode has `enabled`, Claude
// has project-block arrays, Codex has none), so they are intentionally out of scope.

import fs from 'node:fs';
import { userMcpFile, projectMcpFile } from './paths.js';
import { listProjects } from './projects-reader.js';
import type { ToolProfile, ToolId } from './profiles.js';
import type { McpServer } from './model.js';

/** Read+parse a JSON file; return null if missing, empty, or unparseable. */
function readJson(filePath: string): Record<string, unknown> | null {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		if (!raw.trim()) return null;
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * Walk `keyPath` segments into a nested object and return the leaf node, or null
 * if any segment is missing or non-object. Does NOT auto-create (read-only).
 */
function dive(root: Record<string, unknown>, keyPath: string[]): Record<string, unknown> | null {
	let cur: unknown = root;
	for (const seg of keyPath) {
		if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
		cur = (cur as Record<string, unknown>)[seg];
	}
	if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
	return cur as Record<string, unknown>;
}

/** Coerce an unknown value to a string->string record (for env/headers maps). */
function toStringRecord(v: unknown): Record<string, string> | undefined {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
	const out: Record<string, string> = {};
	for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
		out[k] = typeof val === 'string' ? val : String(val);
	}
	return out;
}

/** Coerce to string[] (for args). */
function toStringArray(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	return v.map((x) => (typeof x === 'string' ? x : String(x)));
}

/**
 * Infer the transport from a raw server entry.
 * Rule: explicit `type` wins; otherwise `command` present → stdio, `url` present → http.
 */
function inferTransport(entry: Record<string, unknown>): 'stdio' | 'sse' | 'http' {
	const t = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
	if (t === 'stdio' || t === 'sse' || t === 'http') return t;
	// ZCode legacy: "remote" → "http"
	if (t === 'remote') return 'http';
	if (typeof entry.command === 'string') return 'stdio';
	if (typeof entry.url === 'string') return 'http';
	return 'stdio'; // safe default
}

/** Build a normalized McpServer from a raw config entry. */
function buildServer(
	name: string,
	entry: Record<string, unknown>,
	tool: ToolId,
	scope: 'user' | 'project',
	sourceFile: string,
	project: string | null,
): McpServer {
	const transport = inferTransport(entry);
	return {
		name,
		tool,
		scope,
		sourceFile,
		project,
		transport,
		type: typeof entry.type === 'string' ? entry.type : undefined,
		command: typeof entry.command === 'string' ? entry.command : undefined,
		args: toStringArray(entry.args),
		env: toStringRecord(entry.env),
		url: typeof entry.url === 'string' ? entry.url : undefined,
		headers: toStringRecord(entry.headers),
		enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
		timeoutMs: typeof entry.timeoutMs === 'number' ? entry.timeoutMs : undefined,
	};
}

/** Collect servers from one config file, appending to `out`. */
function collectFromFile(
	filePath: string,
	keyPath: string[],
	tool: ToolId,
	scope: 'user' | 'project',
	project: string | null,
	out: McpServer[],
): void {
	const root = readJson(filePath);
	if (!root) return;
	const map = dive(root, keyPath);
	if (!map) return;
	for (const [name, raw] of Object.entries(map)) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
		out.push(buildServer(name, raw as Record<string, unknown>, tool, scope, filePath, project));
	}
}

/**
 * List all MCP servers for a tool: user-level + one entry per known project that has a
 * project-level config file. Returns [] when none exist. Read-only — never writes.
 */
export function listMcps(profile: ToolProfile): McpServer[] {
	const out: McpServer[] = [];

	// 1. User-level servers.
	collectFromFile(userMcpFile(profile), profile.mcps.userKeyPath, profile.id, 'user', null, out);

	// 2. Project-level servers (use unified project discovery: fs folders OR sqlite rows).
	for (const proj of listProjects(profile)) {
		collectFromFile(projectMcpFile(proj.path, profile), profile.mcps.projectKeyPath, profile.id, 'project', proj.path, out);
	}

	return out;
}
