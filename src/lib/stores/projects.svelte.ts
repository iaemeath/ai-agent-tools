import { invoke } from '@tauri-apps/api/core';
import type { Project, CreateProjectRequest, GlobalMcp } from '$lib/types';

class ProjectsState {
	projects = $state<Project[]>([]);
	globalMcps = $state<GlobalMcp[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);

	async loadProjects() {
		console.log('[projectsStore] Loading projects...');
		this.isLoading = true;
		this.error = null;
		try {
			this.projects = await invoke<Project[]>('get_all_projects');
			console.log(`[projectsStore] Loaded ${this.projects.length} projects`);
		} catch (e) {
			this.error = String(e);
			console.error('[projectsStore] Failed to load projects:', e);
		} finally {
			this.isLoading = false;
		}
	}

	async loadGlobalMcps() {
		console.log('[projectsStore] Loading global MCPs...');
		try {
			this.globalMcps = await invoke<GlobalMcp[]>('get_global_mcps');
			console.log(`[projectsStore] Loaded ${this.globalMcps.length} global MCPs`);
		} catch (e) {
			console.error('[projectsStore] Failed to load global MCPs:', e);
		}
	}

	async addProject(request: CreateProjectRequest): Promise<Project> {
		console.log(`[projectsStore] Adding project: ${request.name} at ${request.path}`);
		const project = await invoke<Project>('add_project', { project: request });
		this.projects = [...this.projects, project];
		console.log(`[projectsStore] Added project id=${project.id}`);
		return project;
	}

	async removeProject(id: number): Promise<void> {
		console.log(`[projectsStore] Removing project id=${id}`);
		await invoke('remove_project', { id });
		this.projects = this.projects.filter((p) => p.id !== id);
		console.log(`[projectsStore] Removed project id=${id}`);
	}

	async browseForProject(): Promise<string | null> {
		console.log('[projectsStore] Opening folder browser...');
		return await invoke<string | null>('browse_for_project');
	}

	async assignMcpToProject(projectId: number, mcpId: number): Promise<void> {
		console.log(`[projectsStore] Assigning MCP id=${mcpId} to project id=${projectId}`);
		await invoke('assign_mcp_to_project', { projectId, mcpId });
		await this.loadProjects(); // Reload to get updated assignments
	}

	async removeMcpFromProject(projectId: number, mcpId: number): Promise<void> {
		console.log(`[projectsStore] Removing MCP id=${mcpId} from project id=${projectId}`);
		await invoke('remove_mcp_from_project', { projectId, mcpId });
		await this.loadProjects();
	}

	async toggleProjectMcp(assignmentId: number, enabled: boolean): Promise<void> {
		console.log(`[projectsStore] Toggling project MCP assignment id=${assignmentId} enabled=${enabled}`);
		await invoke('toggle_project_mcp', { assignmentId, enabled });
		await this.loadProjects();
	}

	async syncProjectConfig(projectId: number): Promise<void> {
		console.log(`[projectsStore] Syncing config for project id=${projectId}`);
		await invoke('sync_project_config', { projectId });
		console.log(`[projectsStore] Synced config for project id=${projectId}`);
	}

	async addGlobalMcp(mcpId: number): Promise<void> {
		console.log(`[projectsStore] Adding global MCP id=${mcpId}`);
		await invoke('add_global_mcp', { mcpId });
		await this.loadGlobalMcps();
	}

	async removeGlobalMcp(mcpId: number): Promise<void> {
		console.log(`[projectsStore] Removing global MCP id=${mcpId}`);
		await invoke('remove_global_mcp', { mcpId });
		await this.loadGlobalMcps();
	}

	async toggleGlobalMcp(id: number, enabled: boolean): Promise<void> {
		console.log(`[projectsStore] Toggling global MCP id=${id} enabled=${enabled}`);
		await invoke('toggle_global_mcp_assignment', { id, enabled });
		await this.loadGlobalMcps();
	}

	async syncGlobalConfig(): Promise<void> {
		console.log('[projectsStore] Syncing global config...');
		await invoke('sync_global_config');
		console.log('[projectsStore] Synced global config');
	}

	async toggleFavorite(id: number, favorite: boolean): Promise<void> {
		console.log(`[projectsStore] Toggling favorite for project id=${id} favorite=${favorite}`);
		await invoke('toggle_project_favorite', { id, favorite });
		// Update local state
		this.projects = this.projects.map((p) => (p.id === id ? { ...p, isFavorite: favorite } : p));
	}

	getProjectById(id: number): Project | undefined {
		return this.projects.find((p) => p.id === id);
	}

	// Get projects sorted by favorites first, then by name
	get sortedProjects(): Project[] {
		return [...this.projects].sort((a, b) => {
			if (a.isFavorite !== b.isFavorite) {
				return a.isFavorite ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});
	}
}

export const projectsStore = new ProjectsState();
