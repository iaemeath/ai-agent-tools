// API client — replaces the Tauri `invoke(...)` calls with fetch.
// Mirrors the server's route table 1:1. Every method takes an optional `tool` so the
// same UI can target multiple AI tools (claude / zcode).

import type { InstructionInfo, McpServer, PluginDetail, ProjectInfo, RuleInfo, Scope, Status, ToolContent, ToolId, ToolOverview } from '../types/tool';

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	return res.json() as Promise<T>;
}

async function del<T>(url: string): Promise<T> {
	const res = await fetch(url, { method: 'DELETE' });
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
	openInExplorer: (filePath: string, tool?: ToolId) =>
		postJson<{ ok: true }>('/api/instructions/open', { path: filePath, tool }),
	listRules: (tool?: ToolId) =>
		getJson<RuleInfo[]>(`/api/rules${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	readRule: (filePath: string, tool?: ToolId) =>
		getJson<{ path: string; raw: string }>(`/api/rules/content?path=${encodeURIComponent(filePath)}${tool && tool !== 'claude' ? `&tool=${tool}` : ''}`),
	openRuleInExplorer: (filePath: string, tool?: ToolId) =>
		postJson<{ ok: true }>('/api/rules/open', { path: filePath, tool }),
	listMcps: (tool?: ToolId) =>
		getJson<McpServer[]>(`/api/mcps${tool && tool !== 'claude' ? `?tool=${tool}` : ''}`),
	getMcpDetail: (name: string, scope: 'user' | 'project', project: string | null, tool?: ToolId) =>
		getJson<McpServer>(`/api/mcps/detail?name=${encodeURIComponent(name)}&scope=${scope}${project ? `&project=${encodeURIComponent(project)}` : ''}${toolQ(tool)}`),
	openMcpInExplorer: (sourceFile: string, tool?: ToolId) =>
		postJson<{ ok: true }>('/api/mcps/open', { sourceFile, tool }),
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
};
