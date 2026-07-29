<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { Header } from '$lib/components/layout';
	import { McpLibrary, McpForm, McpTestModal } from '$lib/components/mcp';
	import { ConfirmDialog, ScopeBar } from '$lib/components/shared';
	import { mcpLibrary, projectsStore, notifications } from '$lib/stores';
	import { i18n } from '$lib/i18n';
	import type { Mcp, GatewayMcp } from '$lib/types';
	import { User, FolderOpen } from 'lucide-svelte';

	let showAddMcp = $state(false);
	let editingMcp = $state<Mcp | null>(null);
	let deletingMcp = $state<Mcp | null>(null);
	let testingMcp = $state<Mcp | null>(null);
	let gatewayMcpIds = $state<Set<number>>(new Set());

	const mcpScopes = $derived([
		{ key: 'user', label: i18n.t('scope.user'), description: i18n.t('scope.userDesc'), icon: User },
		{ key: 'project', label: i18n.t('scope.project'), description: i18n.t('scope.projectDesc'), icon: FolderOpen }
	]);

	onMount(async () => {
		await projectsStore.loadProjects();
		await projectsStore.loadGlobalMcps();
		await loadGatewayMcps();
	});

	async function handleRefresh() {
		await mcpLibrary.load();
		await projectsStore.loadGlobalMcps();
		await projectsStore.loadProjects();
		notifications.success(i18n.t('common.refreshed'));
	}

	async function handleProjectChange(path: string | null) {
		projectsStore.setSelectedProjectPath(path);
		await projectsStore.loadProjects();
	}

	function scopeCount(scope: string): number {
		if (scope === 'user') return projectsStore.globalMcps.filter((g) => g.isEnabled).length;
		const project = projectsStore.projects.find((p) => p.path === projectsStore.selectedProjectPath);
		return project?.assignedMcps.filter((a) => a.isEnabled).length ?? 0;
	}

	async function loadGatewayMcps() {
		try {
			const gatewayMcps = await invoke<GatewayMcp[]>('get_gateway_mcps');
			gatewayMcpIds = new Set(gatewayMcps.map(gm => gm.mcpId));
		} catch (err) {
			console.error('Failed to load gateway MCPs:', err);
		}
	}

	async function handleGatewayToggle(mcp: Mcp, enabled: boolean) {
		try {
			if (enabled) {
				await invoke('add_mcp_to_gateway', { mcpId: mcp.id });
				gatewayMcpIds = new Set([...gatewayMcpIds, mcp.id]);
				notifications.success(i18n.t('mcp.addedToGateway', { name: mcp.name }));
			} else {
				await invoke('remove_mcp_from_gateway', { mcpId: mcp.id });
				const newIds = new Set(gatewayMcpIds);
				newIds.delete(mcp.id);
				gatewayMcpIds = newIds;
				notifications.success(i18n.t('mcp.removedFromGateway', { name: mcp.name }));
			}
		} catch (err) {
			notifications.error(enabled ? i18n.t('mcp.addToGatewayFailed') : i18n.t('mcp.removeFromGatewayFailed'));
			console.error('Gateway toggle error:', err);
		}
	}

	async function handleCreateMcp(values: any) {
		try {
			await mcpLibrary.create(values);
			showAddMcp = false;
			notifications.success(i18n.t('mcp.created'));
		} catch (err) {
			notifications.error(i18n.t('mcp.createFailed'));
		}
	}

	async function handleUpdateMcp(values: any) {
		if (!editingMcp) return;
		try {
			await mcpLibrary.update(editingMcp.id, values);
			editingMcp = null;
			notifications.success(i18n.t('mcp.updated'));
		} catch (err) {
			notifications.error(i18n.t('mcp.updateFailed'));
		}
	}

	async function handleDeleteMcp() {
		if (!deletingMcp) return;
		try {
			await mcpLibrary.delete(deletingMcp.id);
			notifications.success(i18n.t('mcp.deleted'));
		} catch (err) {
			notifications.error(i18n.t('mcp.deleteFailed'));
		} finally {
			deletingMcp = null;
		}
	}

	async function handleDuplicateMcp(mcp: Mcp) {
		try {
			await mcpLibrary.duplicate(mcp.id);
			notifications.success(i18n.t('mcp.duplicated'));
		} catch (err) {
			notifications.error(i18n.t('mcp.duplicateFailed'));
		}
	}
</script>

<Header
	title={i18n.t('page.library.title')}
	subtitle={i18n.t('page.library.subtitle')}
/>

<div class="flex-1 overflow-auto p-6">
	<ScopeBar
		projectPath={projectsStore.selectedProjectPath}
		projects={projectsStore.projects}
		selectedScope={mcpLibrary.selectedScope}
		scopes={mcpScopes}
		getCount={scopeCount}
		noProjectLabel={i18n.t('settings.scopeNoProject')}
		refreshLabel={i18n.t('common.refresh')}
		onProjectChange={handleProjectChange}
		onScopeSelect={(s) => mcpLibrary.setScope(s as 'user' | 'project')}
		onRefresh={handleRefresh}
	/>

	<McpLibrary
		onEdit={(mcp) => (editingMcp = mcp)}
		onDelete={(mcp) => (deletingMcp = mcp)}
		onDuplicate={handleDuplicateMcp}
		onTest={(mcp) => (testingMcp = mcp)}
		showGatewayToggle={true}
		{gatewayMcpIds}
		onGatewayToggle={handleGatewayToggle}
	/>
</div>

<!-- Add MCP Modal -->
{#if showAddMcp}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto">
			<div class="p-6">
				<h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-6">{i18n.t('mcp.addNew')}</h2>
				<McpForm onSubmit={handleCreateMcp} onCancel={() => (showAddMcp = false)} />
			</div>
		</div>
	</div>
{/if}

<!-- Edit MCP Modal -->
{#if editingMcp}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto">
			<div class="p-6">
				<h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-6">{i18n.t('mcp.editMcp')}</h2>
				<McpForm
					initialValues={editingMcp}
					onSubmit={handleUpdateMcp}
					onCancel={() => (editingMcp = null)}
				/>
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={!!deletingMcp}
	title={i18n.t('mcp.deleteMcp')}
	message={i18n.t('mcp.deleteConfirm', { name: deletingMcp?.name ?? '' })}
	confirmText={i18n.t('common.delete')}
	onConfirm={handleDeleteMcp}
	onCancel={() => (deletingMcp = null)}
/>

<!-- Test MCP Modal -->
{#if testingMcp}
	<McpTestModal mcp={testingMcp} onClose={() => (testingMcp = null)} />
{/if}
