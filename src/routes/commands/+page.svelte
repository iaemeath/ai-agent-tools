<script lang="ts">
	import { onMount } from 'svelte';
	import { Header } from '$lib/components/layout';
	import { CommandLibrary, CommandForm } from '$lib/components/commands';
	import { ConfirmDialog, ScopeBar } from '$lib/components/shared';
	import { commandLibrary, projectsStore, notifications } from '$lib/stores';
	import { i18n } from '$lib/i18n';
	import type { Command } from '$lib/types';
	import { User, FolderOpen } from 'lucide-svelte';

	let showAddCommand = $state(false);
	let editingCommand = $state<Command | null>(null);
	let deletingCommand = $state<Command | null>(null);

	const commandScopes = $derived([
		{ key: 'user', label: i18n.t('scope.user'), description: i18n.t('scope.userDesc'), icon: User },
		{ key: 'project', label: i18n.t('scope.project'), description: i18n.t('scope.projectDesc'), icon: FolderOpen }
	]);

	onMount(async () => {
		await projectsStore.loadProjects();
		await commandLibrary.load();
		await commandLibrary.loadGlobalCommands();
		if (projectsStore.selectedProjectPath) {
			await commandLibrary.setProjectPath(projectsStore.selectedProjectPath);
		}
	});

	async function handleRefresh() {
		await commandLibrary.load();
		await commandLibrary.loadGlobalCommands();
		if (projectsStore.selectedProjectPath) await commandLibrary.loadProjectCommands();
		notifications.success(i18n.t('common.refreshed'));
	}

	function scopeCount(scope: string): number {
		if (scope === 'user') return commandLibrary.globalCommands.filter((g) => g.isEnabled).length;
		return commandLibrary.projectCommands.filter((p) => p.isEnabled).length;
	}

	async function handleCreateCommand(values: any) {
		try {
			await commandLibrary.create(values);
			showAddCommand = false;
			notifications.success(i18n.t('command.created'));
		} catch (err) {
			notifications.error(i18n.t('command.createFailed'));
		}
	}

	async function handleUpdateCommand(values: any) {
		if (!editingCommand) return;
		try {
			await commandLibrary.update(editingCommand.id, values);
			editingCommand = null;
			notifications.success(i18n.t('command.updated'));
		} catch (err) {
			notifications.error(i18n.t('command.updateFailed'));
		}
	}

	async function handleDeleteCommand() {
		if (!deletingCommand) return;
		try {
			await commandLibrary.delete(deletingCommand.id);
			notifications.success(i18n.t('command.deleted'));
		} catch (err) {
			notifications.error(i18n.t('command.deleteFailed'));
		} finally {
			deletingCommand = null;
		}
	}
</script>

<Header
	title={i18n.t('page.commands.title')}
	subtitle={i18n.t('page.commands.subtitle')}
/>

<div class="flex-1 overflow-auto p-6">
	<ScopeBar
		projectPath={projectsStore.selectedProjectPath}
		projects={projectsStore.projects}
		selectedScope={commandLibrary.selectedScope}
		scopes={commandScopes}
		getCount={scopeCount}
		noProjectLabel={i18n.t('settings.scopeNoProject')}
		refreshLabel={i18n.t('common.refresh')}
		onProjectChange={(p) => commandLibrary.setProjectPath(p)}
		onScopeSelect={(s) => commandLibrary.setScope(s as 'user' | 'project')}
		onRefresh={handleRefresh}
	/>

	<CommandLibrary
		onEdit={(command) => (editingCommand = command)}
		onDelete={(command) => (deletingCommand = command)}
	/>
</div>

<!-- Add Command Modal -->
{#if showAddCommand}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto">
			<div class="p-6">
				<h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-6">{i18n.t('command.addNew')}</h2>
				<CommandForm onSubmit={handleCreateCommand} onCancel={() => (showAddCommand = false)} />
			</div>
		</div>
	</div>
{/if}

<!-- Edit Command Modal -->
{#if editingCommand}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto">
			<div class="p-6">
				<h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-6">{i18n.t('command.editCommand')}</h2>
				<CommandForm
					initialValues={editingCommand}
					onSubmit={handleUpdateCommand}
					onCancel={() => (editingCommand = null)}
				/>
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={!!deletingCommand}
	title={i18n.t('command.deleteCommand')}
	message={i18n.t('command.deleteConfirm', { name: deletingCommand?.name ?? '' })}
	confirmText={i18n.t('common.delete')}
	onConfirm={handleDeleteCommand}
	onCancel={() => (deletingCommand = null)}
/>
