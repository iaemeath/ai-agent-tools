<script lang="ts">
	import { onMount } from 'svelte';
	import { Header } from '$lib/components/layout';
	import { HookLibrary, HookForm } from '$lib/components/hooks';
	import { ConfirmDialog, ScopeBar } from '$lib/components/shared';
	import { hookLibrary, projectsStore, notifications } from '$lib/stores';
	import { i18n } from '$lib/i18n';
	import type { Hook, CreateHookRequest } from '$lib/types';
	import { User, FolderOpen } from 'lucide-svelte';

	let showAddHook = $state(false);
	let editingHook = $state<Hook | null>(null);
	let deletingHook = $state<Hook | null>(null);

	const hookScopes = $derived([
		{ key: 'user', label: i18n.t('scope.user'), description: i18n.t('scope.userDesc'), icon: User },
		{ key: 'project', label: i18n.t('scope.project'), description: i18n.t('scope.projectDesc'), icon: FolderOpen }
	]);

	onMount(async () => {
		await projectsStore.loadProjects();
		await hookLibrary.load();
		await hookLibrary.loadTemplates();
		await hookLibrary.seedTemplates();
		await hookLibrary.loadGlobalHooks();
		await hookLibrary.loadAllProjectHooks();
		if (projectsStore.selectedProjectPath) {
			await hookLibrary.setProjectPath(projectsStore.selectedProjectPath);
		}
	});

	async function handleRefresh() {
		await hookLibrary.load();
		await hookLibrary.loadGlobalHooks();
		if (projectsStore.selectedProjectPath) await hookLibrary.loadProjectHooks();
		await hookLibrary.loadAllProjectHooks();
		notifications.success(i18n.t('common.refreshed'));
	}

	function scopeCount(scope: string): number {
		if (scope === 'user') return hookLibrary.globalHooks.filter((g) => g.isEnabled).length;
		return hookLibrary.projectHooks.filter((p) => p.isEnabled).length;
	}

	async function handleCreateHook(values: CreateHookRequest) {
		try {
			await hookLibrary.create(values);
			showAddHook = false;
			notifications.success(i18n.t('hook.created'));
		} catch (err) {
			notifications.error(i18n.t('hook.createFailed'));
		}
	}

	async function handleUpdateHook(values: CreateHookRequest) {
		if (!editingHook) return;
		try {
			await hookLibrary.update(editingHook.id, values);
			editingHook = null;
			notifications.success(i18n.t('hook.updated'));
		} catch (err) {
			notifications.error(i18n.t('hook.updateFailed'));
		}
	}

	async function handleDeleteHook() {
		if (!deletingHook) return;
		try {
			await hookLibrary.delete(deletingHook.id);
			notifications.success(i18n.t('hook.deleted'));
		} catch (err) {
			notifications.error(i18n.t('hook.deleteFailed'));
		} finally {
			deletingHook = null;
		}
	}

	async function handleDuplicate(hook: Hook) {
		try {
			const newName = `${hook.name}-copy`;
			await hookLibrary.create({
				name: newName,
				description: hook.description,
				eventType: hook.eventType,
				matcher: hook.matcher,
				hookType: hook.hookType,
				command: hook.command,
				prompt: hook.prompt,
				timeout: hook.timeout,
				tags: hook.tags
			});
			notifications.success(i18n.t('hook.duplicated'));
		} catch (err) {
			notifications.error(i18n.t('hook.duplicateFailed'));
		}
	}
</script>

<Header
	title={i18n.t('page.hooks.title')}
	subtitle={i18n.t('page.hooks.subtitle')}
/>

<div class="flex-1 overflow-auto p-6">
	<ScopeBar
		projectPath={projectsStore.selectedProjectPath}
		projects={projectsStore.projects}
		selectedScope={hookLibrary.selectedScope}
		scopes={hookScopes}
		getCount={scopeCount}
		noProjectLabel={i18n.t('settings.scopeNoProject')}
		refreshLabel={i18n.t('common.refresh')}
		onProjectChange={(p) => hookLibrary.setProjectPath(p)}
		onScopeSelect={(s) => hookLibrary.setScope(s as 'user' | 'project')}
		onRefresh={handleRefresh}
	/>

	<HookLibrary
		onEdit={(hook) => (editingHook = hook)}
		onDelete={(hook) => (deletingHook = hook)}
		onDuplicate={handleDuplicate}
	/>
</div>

<!-- Add Hook Modal -->
{#if showAddHook}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div
			class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto"
		>
			<div class="p-6">
				<h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-6">{i18n.t('hook.addNew')}</h2>
				<HookForm
					templates={hookLibrary.templates}
					onSubmit={handleCreateHook}
					onCancel={() => (showAddHook = false)}
				/>
			</div>
		</div>
	</div>
{/if}

<!-- Edit Hook Modal -->
{#if editingHook}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div
			class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto"
		>
			<div class="p-6">
				<h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-6">{i18n.t('hook.editHook')}</h2>
				<HookForm
					initialValues={editingHook}
					templates={hookLibrary.templates}
					onSubmit={handleUpdateHook}
					onCancel={() => (editingHook = null)}
				/>
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={!!deletingHook}
	title={i18n.t('hook.deleteHook')}
	message={i18n.t('hook.deleteConfirm', { name: deletingHook?.name ?? '' })}
	confirmText={i18n.t('common.delete')}
	onConfirm={handleDeleteHook}
	onCancel={() => (deletingHook = null)}
/>

