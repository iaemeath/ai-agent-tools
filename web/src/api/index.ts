// API client — replaces the Tauri `invoke(...)` calls with fetch.
// Mirrors the server's route table 1:1.

import type { ProjectInfo, Scope, Status, ToolContent, ToolOverview } from '../types/tool';

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

export const api = {
	listProjects: () => getJson<ProjectInfo[]>('/api/projects'),
	getOverview: (project: string | null) =>
		getJson<ToolOverview>(`/api/tools/overview?project=${encodeURIComponent(project ?? 'null')}`),
	getToolDetail: (kind: string, name: string, project: string | null) =>
		getJson<{ scope: Scope; status: Status }[]>(
			`/api/tools/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/detail?project=${encodeURIComponent(project ?? 'null')}`,
		),
	setToolStatus: (p: { kind: string; name: string; scope: Scope; status: Status; project: string | null }) =>
		postJson<{ ok: true }>('/api/tools/status', p),
	viewToolContent: (kind: string, name: string) =>
		getJson<ToolContent>(`/api/tools/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/content`),
	deleteProject: (encoded: string) =>
		del<{ ok: true }>(`/api/projects/${encodeURIComponent(encoded)}`),
	promoteSkill: (name: string, project: string) =>
		postJson<{ ok: true }>('/api/skills/promote', { name, project }),
	deleteSkill: (p: { name: string; scope: 'user' | 'project'; project?: string }) =>
		postJson<{ ok: true }>('/api/skills/delete', p),
};
