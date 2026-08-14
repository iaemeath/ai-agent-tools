// API client — replaces the Tauri `invoke(...)` calls with fetch.
// Mirrors the server's route table 1:1. Every method takes an optional `tool` so the
// same UI can target multiple AI tools (claude / zcode).
//
// Host targeting: getJson/postJson/del inject an `X-Host` header when the active host is
// not 'local', so all resource requests transparently hit the selected SSH host. Host-
// management methods pass { injectHost: false } because they operate on the LOCAL registry.

import type { AgentInfo, CommandInfo, HookInfo, InstructionInfo, McpServer, PluginDetail, ProjectInfo, RuleInfo, Scope, Status, ToolContent, ToolId, ToolOverview } from '../types/tool';
import { currentHost } from '../stores/host';

interface HostOpts {
	/** When false, skip the X-Host injection (host-management routes target the local registry). */
	injectHost?: boolean;
}

function hostHeaders(opts: HostOpts): Record<string, string> {
	const h: Record<string, string> = {};
	if (opts.injectHost !== false && currentHost.value !== 'local') h['X-Host'] = currentHost.value;
	return h;
}

async function getJson<T>(url: string, opts: HostOpts = {}): Promise<T> {
	const res = await fetch(url, { headers: hostHeaders(opts) });
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown, opts: HostOpts = {}): Promise<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...hostHeaders(opts) },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	return res.json() as Promise<T>;
}

async function del<T>(url: string, opts: HostOpts = {}): Promise<T> {
	const res = await fetch(url, { method: 'DELETE', headers: hostHeaders(opts) });
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	return res.json() as Promise<T>;
}

/** Build a query string suffix for the given tool (omitted for the default 'claude'). */
function toolQ(tool: ToolId | undefined): string {
	return tool && tool !== 'claude' ? `&tool=${tool}` : '';
}

export const api = {
	listProjects: (tool?: ToolId) =>
		getJson<ProjectInfo[]>(`/api/projects${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	getOverview: (project: string | null, tool?: ToolId) =>
		getJson<ToolOverview>(`/api/tools/overview?project=${encodeURIComponent(project ?? 'null')}${toolQ(tool)}`),
	getToolDetail: (kind: string, name: string, project: string | null, tool?: ToolId) =>
		getJson<{ scope: Scope; status: Status }[]>(
			`/api/tools/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/detail?project=${encodeURIComponent(project ?? 'null')}${toolQ(tool)}`,
		),
	setToolStatus: (p: { kind: string; name: string; scope: Scope; status: Status; project: string | null; tool?: ToolId }) =>
		postJson<{ ok: true }>('/api/tools/status', p),
	viewToolContent: (kind: string, name: string, tool?: ToolId) =>
		getJson<ToolContent>(`/api/tools/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/content${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	getPluginDetail: (name: string, project: string | null, tool?: ToolId) =>
		getJson<PluginDetail>(`/api/plugins/${encodeURIComponent(name)}/detail?project=${encodeURIComponent(project ?? 'null')}${toolQ(tool)}`),
	openPluginInExplorer: (name: string, project: string | null, tool?: ToolId) =>
		postJson<{ ok: true }>(`/api/plugins/${encodeURIComponent(name)}/open`, { project: project ?? null, tool }),
	deleteProject: (encoded: string, tool?: ToolId) =>
		del<{ ok: true }>(`/api/projects/${encodeURIComponent(encoded)}${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	promoteSkill: (name: string, project: string, tool?: ToolId) =>
		postJson<{ ok: true }>('/api/skills/promote', { name, project, tool }),
	deleteSkill: (p: { name: string; scope: 'user' | 'project'; project?: string; tool?: ToolId }) =>
		postJson<{ ok: true }>('/api/skills/delete', p),
	listSkillFiles: (name: string, scope: 'user' | 'project', subpath: string, project: string | null, tool?: ToolId) =>
		getJson<{ entries: { name: string; isDir: boolean }[]; root: string }>(
			`/api/skills/${encodeURIComponent(name)}/files?scope=${scope}&subpath=${encodeURIComponent(subpath)}${project ? `&project=${encodeURIComponent(project)}` : ''}${toolQ(tool)}`,
		),
	readSkillFile: (name: string, scope: 'user' | 'project', subpath: string, project: string | null, tool?: ToolId) =>
		getJson<{ name: string; raw: string; ext: string }>(
			`/api/skills/${encodeURIComponent(name)}/file-content?scope=${scope}&subpath=${encodeURIComponent(subpath)}${project ? `&project=${encodeURIComponent(project)}` : ''}${toolQ(tool)}`,
		),
	listInstructions: (tool?: ToolId) =>
		getJson<InstructionInfo[]>(`/api/instructions${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	readInstruction: (filePath: string, tool?: ToolId) =>
		getJson<{ path: string; raw: string }>(`/api/instructions/content?path=${encodeURIComponent(filePath)}${tool && tool !== 'claude' ? `&tool=${tool}` : ''}`),
	saveInstruction: (filePath: string, content: string, tool?: ToolId) =>
		postJson<{ ok: true; path: string }>('/api/instructions/save', { path: filePath, content, tool }),
	openInExplorer: (filePath: string, tool?: ToolId) =>
		postJson<{ ok: true }>('/api/instructions/open', { path: filePath, tool }),
	listRules: (tool?: ToolId) =>
		getJson<RuleInfo[]>(`/api/rules${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	readRule: (filePath: string, tool?: ToolId) =>
		getJson<{ path: string; raw: string }>(`/api/rules/content?path=${encodeURIComponent(filePath)}${tool && tool !== 'claude' ? `&tool=${tool}` : ''}`),
	saveRule: (filePath: string, content: string, tool?: ToolId) =>
		postJson<{ ok: true; path: string }>('/api/rules/save', { path: filePath, content, tool }),
	openRuleInExplorer: (filePath: string, tool?: ToolId) =>
		postJson<{ ok: true }>('/api/rules/open', { path: filePath, tool }),
	listCommands: (tool?: ToolId) =>
		getJson<CommandInfo[]>(`/api/commands${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	readCommand: (filePath: string, tool?: ToolId) =>
		getJson<{ path: string; raw: string }>(`/api/commands/content?path=${encodeURIComponent(filePath)}${tool && tool !== 'claude' ? `&tool=${tool}` : ''}`),
	saveCommand: (filePath: string, content: string, tool?: ToolId) =>
		postJson<{ ok: true; path: string }>('/api/commands/save', { path: filePath, content, tool }),
	openCommandInExplorer: (filePath: string, tool?: ToolId) =>
		postJson<{ ok: true }>(`/api/commands/open`, { path: filePath, tool }),
	listAgents: (tool?: ToolId) =>
		getJson<AgentInfo[]>(`/api/agents${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	readAgent: (filePath: string, tool?: ToolId) =>
		getJson<{ path: string; raw: string }>(`/api/agents/content?path=${encodeURIComponent(filePath)}${tool && tool !== 'claude' ? `&tool=${tool}` : ''}`),
	saveAgent: (filePath: string, content: string, tool?: ToolId) =>
		postJson<{ ok: true; path: string }>('/api/agents/save', { path: filePath, content, tool }),
	openAgentInExplorer: (filePath: string, tool?: ToolId) =>
		postJson<{ ok: true }>(`/api/agents/open`, { path: filePath, tool }),
	listHooks: (tool?: ToolId) =>
		getJson<HookInfo[]>(`/api/hooks${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	openHookSourceInExplorer: (sourceFile: string, tool?: ToolId) =>
		postJson<{ ok: true }>(`/api/hooks/open`, { sourceFile, tool }),
	listMcps: (tool?: ToolId) =>
		getJson<McpServer[]>(`/api/mcps${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	getMcpDetail: (name: string, scope: 'user' | 'project', project: string | null, tool?: ToolId) =>
		getJson<McpServer>(`/api/mcps/detail?name=${encodeURIComponent(name)}&scope=${scope}${project ? `&project=${encodeURIComponent(project)}` : ''}${toolQ(tool)}`),
	getMcpTools: (name: string, scope: 'user' | 'project', project: string | null, tool?: ToolId) =>
		getJson<{ tools: { name: string; description?: string }[]; error?: string }>(`/api/mcps/tools?name=${encodeURIComponent(name)}&scope=${scope}${project ? `&project=${encodeURIComponent(project)}` : ''}${toolQ(tool)}`),
	openMcpInExplorer: (sourceFile: string, tool?: ToolId) =>
		postJson<{ ok: true }>(`/api/mcps/open`, { sourceFile, tool }),
	listPluginFiles: (name: string, subpath: string, project: string | null, tool?: ToolId) =>
		getJson<{ entries: { name: string; isDir: boolean }[]; root: string }>(
			`/api/plugins/${encodeURIComponent(name)}/files?subpath=${encodeURIComponent(subpath)}&project=${encodeURIComponent(project ?? 'null')}${toolQ(tool)}`,
		),
	readPluginFile: (name: string, subpath: string, project: string | null, tool?: ToolId) =>
		getJson<{ name: string; raw: string; ext: string }>(
			`/api/plugins/${encodeURIComponent(name)}/file-content?subpath=${encodeURIComponent(subpath)}&project=${encodeURIComponent(project ?? 'null')}${toolQ(tool)}`,
		),
	getSettings: (tool?: ToolId) =>
		getJson<{ sourceFile: string; values: Record<string, unknown> }>(
			`/api/settings${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`,
		),

	// ---- Host management (always LOCAL — never inject X-Host) ----
	listHosts: () =>
		getJson<{ hosts: HostSummary[] }>('/api/hosts', { injectHost: false }),
	saveHost: (body: HostInput) =>
		postJson<{ id: string }>('/api/hosts', body, { injectHost: false }),
	testHost: (body: HostTestInput) =>
		postJson<{ ok: boolean; homeDir?: string; error?: string }>('/api/hosts/test', body, { injectHost: false }),
	deleteHost: (id: string) =>
		del<{ ok: true }>(`/api/hosts/${encodeURIComponent(id)}`, { injectHost: false }),
	disconnectHost: (id: string) =>
		postJson<{ ok: true }>(`/api/hosts/${encodeURIComponent(id)}/disconnect`, {}, { injectHost: false }),
};

// ---- Host types (mirror the server's safeView) ----
export interface HostSummary {
	id: string;
	name: string;
	host: string;
	port: number;
	userName: string;
	authMethod: 'password' | 'privateKey';
	privateKeyPath?: string;
	hasPassword: boolean;
	hasPassphrase: boolean;
	createdAt: string;
	status: 'connected' | 'connecting' | 'idle';
}
export interface HostInput {
	id?: string;
	name: string;
	host: string;
	port?: number;
	userName: string;
	authMethod: 'password' | 'privateKey';
	password?: string;
	privateKeyPath?: string;
	passphrase?: string;
}
export interface HostTestInput {
	host: string;
	port?: number;
	userName: string;
	authMethod: 'password' | 'privateKey';
	password?: string;
	privateKeyPath?: string;
	passphrase?: string;
}
