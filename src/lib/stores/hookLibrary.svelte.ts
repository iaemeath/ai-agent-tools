import { invoke } from '@tauri-apps/api/core';
import type {
	Hook,
	CreateHookRequest,
	GlobalHook,
	ProjectHook,
	HookEventType,
	Project
} from '$lib/types';
import { projectsStore } from './projects.svelte';

export type HookViewMode = 'all' | 'byScope';

type HookScope = 'user' | 'project';

export interface ProjectWithHooks {
	project: Project;
	hooks: ProjectHook[];
}

class HookLibraryState {
	hooks = $state<Hook[]>([]);
	templates = $state<Hook[]>([]);
	globalHooks = $state<GlobalHook[]>([]);
	projectHooks = $state<ProjectHook[]>([]);
	selectedScope = $state<HookScope>('user');
	projectsWithHooks = $state<ProjectWithHooks[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);
	searchQuery = $state('');
	eventFilter = $state<HookEventType | ''>('');
	viewMode = $state<HookViewMode>('all');

	// Hooks that are not assigned anywhere (unassigned)
	unassignedHooks = $derived.by(() => {
		const globalHookIds = new Set(this.globalHooks.map((gh) => gh.hookId));
		const projectHookIds = new Set(
			this.projectsWithHooks.flatMap((p) => p.hooks.map((ph) => ph.hookId))
		);
		return this.filteredHooks.filter(
			(h) => !globalHookIds.has(h.id) && !projectHookIds.has(h.id)
		);
	});

	filteredHooks = $derived.by(() => {
		let result = this.hooks;

		if (this.searchQuery) {
			const query = this.searchQuery.toLowerCase();
			result = result.filter(
				(h) =>
					h.name.toLowerCase().includes(query) ||
					h.description?.toLowerCase().includes(query) ||
					h.tags?.some((t) => t.toLowerCase().includes(query))
			);
		}

		if (this.eventFilter) {
			result = result.filter((h) => h.eventType === this.eventFilter);
		}

		return result;
	});

	// Hooks grouped by event type
	hooksByEventType = $derived.by(() => {
		const groups: Record<string, Hook[]> = {};
		for (const hook of this.filteredHooks) {
			if (!groups[hook.eventType]) {
				groups[hook.eventType] = [];
			}
			groups[hook.eventType].push(hook);
		}
		// Sort event types in a logical order (matches session lifecycle)
		const eventOrder = [
			'SessionStart',
			'UserPromptSubmit',
			'PreToolUse',
			'PermissionRequest',
			'PostToolUse',
			'Notification',
			'Stop',
			'SubagentStop',
			'PreCompact',
			'SessionEnd'
		];
		return eventOrder
			.filter((et) => groups[et]?.length > 0)
			.map((eventType) => ({ eventType, hooks: groups[eventType] }));
	});

	async load() {
		console.log('[hookLibrary] Loading hooks...');
		this.isLoading = true;
		this.error = null;
		try {
			this.hooks = await invoke<Hook[]>('get_all_hooks');
			console.log(`[hookLibrary] Loaded ${this.hooks.length} hooks`);
		} catch (e) {
			this.error = String(e);
			console.error('[hookLibrary] Failed to load hooks:', e);
		} finally {
			this.isLoading = false;
		}
	}

	async loadTemplates() {
		console.log('[hookLibrary] Loading hook templates...');
		try {
			this.templates = await invoke<Hook[]>('get_hook_templates');
			console.log(`[hookLibrary] Loaded ${this.templates.length} templates`);
		} catch (e) {
			console.error('[hookLibrary] Failed to load hook templates:', e);
		}
	}

	async seedTemplates() {
		console.log('[hookLibrary] Seeding hook templates...');
		try {
			await invoke('seed_hook_templates');
			await this.loadTemplates();
			console.log('[hookLibrary] Seeded hook templates');
		} catch (e) {
			console.error('[hookLibrary] Failed to seed hook templates:', e);
		}
	}

	async loadGlobalHooks() {
		console.log('[hookLibrary] Loading global hooks...');
		try {
			this.globalHooks = await invoke<GlobalHook[]>('get_global_hooks');
			console.log(`[hookLibrary] Loaded ${this.globalHooks.length} global hooks`);
		} catch (e) {
			console.error('[hookLibrary] Failed to load global hooks:', e);
		}
	}

	setScope(scope: HookScope) {
		this.selectedScope = scope;
	}

	get currentProjectId(): number | null {
		const project = projectsStore.projects.find((p) => p.path === projectsStore.selectedProjectPath);
		return project?.id ?? null;
	}

	async setProjectPath(path: string | null) {
		projectsStore.setSelectedProjectPath(path);
		if (!path) {
			this.selectedScope = 'user';
			this.projectHooks = [];
			return;
		}
		await this.loadProjectHooks();
	}

	async loadProjectHooks() {
		const projectId = this.currentProjectId;
		if (projectId == null) {
			this.projectHooks = [];
			return;
		}
		try {
			this.projectHooks = await this.getProjectHooks(projectId);
		} catch (e) {
			console.error('[hookLibrary] Failed to load project hooks:', e);
			this.projectHooks = [];
		}
	}

	async loadAllProjectHooks() {
		console.log('[hookLibrary] Loading all project hooks...');
		try {
			const projects = await invoke<Project[]>('get_all_projects');
			const projectsWithHooks: ProjectWithHooks[] = [];

			for (const project of projects) {
				const hooks = await invoke<ProjectHook[]>('get_project_hooks', {
					projectId: project.id
				});
				if (hooks.length > 0) {
					projectsWithHooks.push({ project, hooks });
				}
			}

			this.projectsWithHooks = projectsWithHooks;
			console.log(`[hookLibrary] Loaded hooks for ${projectsWithHooks.length} projects`);
		} catch (e) {
			console.error('[hookLibrary] Failed to load project hooks:', e);
		}
	}

	setViewMode(mode: HookViewMode) {
		this.viewMode = mode;
	}

	async create(request: CreateHookRequest): Promise<Hook> {
		console.log(`[hookLibrary] Creating hook: ${request.name}`);
		const hook = await invoke<Hook>('create_hook', { hook: request });
		this.hooks = [...this.hooks, hook];
		console.log(`[hookLibrary] Created hook id=${hook.id}`);
		return hook;
	}

	async createFromTemplate(templateId: number, name: string): Promise<Hook> {
		console.log(`[hookLibrary] Creating hook from template id=${templateId}: ${name}`);
		const hook = await invoke<Hook>('create_hook_from_template', { templateId, name });
		this.hooks = [...this.hooks, hook];
		console.log(`[hookLibrary] Created hook id=${hook.id} from template`);
		return hook;
	}

	async update(id: number, request: CreateHookRequest): Promise<Hook> {
		console.log(`[hookLibrary] Updating hook id=${id}: ${request.name}`);
		const hook = await invoke<Hook>('update_hook', { id, hook: request });
		this.hooks = this.hooks.map((h) => (h.id === id ? hook : h));
		console.log(`[hookLibrary] Updated hook id=${id}`);
		return hook;
	}

	async delete(id: number): Promise<void> {
		console.log(`[hookLibrary] Deleting hook id=${id}`);
		await invoke('delete_hook', { id });
		this.hooks = this.hooks.filter((h) => h.id !== id);
		console.log(`[hookLibrary] Deleted hook id=${id}`);
	}

	async addGlobalHook(hookId: number): Promise<void> {
		console.log(`[hookLibrary] Adding global hook id=${hookId}`);
		await invoke('add_global_hook', { hookId });
		await this.loadGlobalHooks();
	}

	async removeGlobalHook(hookId: number): Promise<void> {
		console.log(`[hookLibrary] Removing global hook id=${hookId}`);
		await invoke('remove_global_hook', { hookId });
		await this.loadGlobalHooks();
	}

	async toggleGlobalHook(id: number, enabled: boolean): Promise<void> {
		console.log(`[hookLibrary] Toggling global hook id=${id} enabled=${enabled}`);
		await invoke('toggle_global_hook', { id, enabled });
		await this.loadGlobalHooks();
	}

	async assignToProject(projectId: number, hookId: number): Promise<void> {
		console.log(`[hookLibrary] Assigning hook id=${hookId} to project id=${projectId}`);
		await invoke('assign_hook_to_project', { projectId, hookId });
		await this.loadProjectHooks();
	}

	async removeFromProject(projectId: number, hookId: number): Promise<void> {
		console.log(`[hookLibrary] Removing hook id=${hookId} from project id=${projectId}`);
		await invoke('remove_hook_from_project', { projectId, hookId });
		await this.loadProjectHooks();
	}

	async toggleProjectHook(assignmentId: number, enabled: boolean): Promise<void> {
		console.log(`[hookLibrary] Toggling project hook assignment id=${assignmentId} enabled=${enabled}`);
		await invoke('toggle_project_hook', { assignmentId, enabled });
		await this.loadProjectHooks();
	}

	async getProjectHooks(projectId: number): Promise<ProjectHook[]> {
		console.log(`[hookLibrary] Getting hooks for project id=${projectId}`);
		return await invoke<ProjectHook[]>('get_project_hooks', { projectId });
	}

	getHookById(id: number): Hook | undefined {
		return this.hooks.find((h) => h.id === id);
	}

	setSearch(query: string) {
		this.searchQuery = query;
	}

	setEventFilter(eventType: HookEventType | '') {
		this.eventFilter = eventType;
	}

	async duplicate(id: number, newName: string): Promise<Hook> {
		console.log(`[hookLibrary] Duplicating hook id=${id} with name '${newName}'`);
		const hook = await invoke<Hook>('duplicate_hook', { id, newName });
		this.hooks = [...this.hooks, hook];
		console.log(`[hookLibrary] Duplicated hook, new id=${hook.id}`);
		return hook;
	}
}

export const hookLibrary = new HookLibraryState();
