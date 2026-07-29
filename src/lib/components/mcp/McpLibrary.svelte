<script lang="ts">
	import type { Mcp } from '$lib/types';
	import { mcpLibrary, projectsStore } from '$lib/stores';
	import McpCard from './McpCard.svelte';
	import { SearchBar, LoadingSpinner, EmptyState } from '$lib/components/shared';
	import { Plug, Globe, Server, Package } from 'lucide-svelte';
	import { invoke } from '@tauri-apps/api/core';

	type Props = {
		onEdit?: (mcp: Mcp) => void;
		onDelete?: (mcp: Mcp) => void;
		onDuplicate?: (mcp: Mcp) => void;
		onTest?: (mcp: Mcp) => void;
		showGatewayToggle?: boolean;
		gatewayMcpIds?: Set<number>;
		onGatewayToggle?: (mcp: Mcp, enabled: boolean) => void;
	};

	let { onEdit, onDelete, onDuplicate, onTest, showGatewayToggle = false, gatewayMcpIds = new Set(), onGatewayToggle }: Props = $props();

	async function handleFavoriteToggle(mcp: Mcp, favorite: boolean) {
		try {
			await invoke('toggle_mcp_favorite', { id: mcp.id, favorite });
			mcpLibrary.updateMcp({ ...mcp, isFavorite: favorite });
		} catch (error) {
			console.error('Failed to toggle favorite:', error);
		}
	}

	function isMcpEnabled(mcp: Mcp): boolean {
		if (mcpLibrary.selectedScope === 'user') {
			const row = projectsStore.globalMcps.find((g) => g.mcpId === mcp.id);
			return row?.isEnabled ?? false;
		}
		const project = projectsStore.projects.find((p) => p.path === projectsStore.selectedProjectPath);
		const row = project?.assignedMcps.find((a) => a.mcpId === mcp.id);
		return row?.isEnabled ?? false;
	}

	async function handleToggleEnable(mcp: Mcp, enabled: boolean) {
		try {
			if (mcpLibrary.selectedScope === 'user') {
				const row = projectsStore.globalMcps.find((g) => g.mcpId === mcp.id);
				if (row) {
					await projectsStore.toggleGlobalMcp(row.id, enabled);
				} else if (enabled) {
					await projectsStore.addGlobalMcp(mcp.id);
				}
			} else {
				const project = projectsStore.projects.find((p) => p.path === projectsStore.selectedProjectPath);
				if (!project) return;
				const row = project.assignedMcps.find((a) => a.mcpId === mcp.id);
				if (row) {
					await projectsStore.toggleProjectMcp(row.id, enabled);
				} else if (enabled) {
					await projectsStore.assignMcpToProject(project.id, mcp.id);
				}
			}
		} catch (e) {
			console.error('Failed to toggle MCP enable:', e);
		}
	}

	const typeFilters: { value: 'all' | 'stdio' | 'sse' | 'http'; label: string; icon: typeof Package }[] = [
		{ value: 'all', label: 'All', icon: Package },
		{ value: 'stdio', label: 'stdio', icon: Plug },
		{ value: 'sse', label: 'SSE', icon: Globe },
		{ value: 'http', label: 'HTTP', icon: Server }
	];
</script>

<div class="space-y-4">
	<!-- Filters -->
	<div class="flex items-center gap-4">
		<div class="flex-1 max-w-sm">
			<SearchBar
				bind:value={mcpLibrary.searchQuery}
				placeholder="Search MCPs..."
			/>
		</div>

		<div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
			{#each typeFilters as filter}
				<button
					onclick={() => mcpLibrary.setTypeFilter(filter.value)}
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
						{mcpLibrary.selectedType === filter.value
							? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
							: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}"
				>
					<svelte:component this={filter.icon} class="w-3.5 h-3.5" />
					{filter.label}
					<span class="text-xs text-gray-400">
						{filter.value === 'all' ? mcpLibrary.mcpCount.total : mcpLibrary.mcpCount[filter.value]}
					</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- MCP Grid -->
	{#if mcpLibrary.isLoading}
		<LoadingSpinner />
	{:else if mcpLibrary.filteredMcps.length === 0}
		{#if mcpLibrary.searchQuery || mcpLibrary.selectedType !== 'all'}
			<EmptyState icon={Package} title="No matching MCPs" description="Try adjusting your search or filters" />
		{:else}
			<EmptyState icon={Package} title="No MCPs in library" description="Add your first MCP to get started" />
		{/if}
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each mcpLibrary.filteredMcps as mcp (mcp.id)}
				<McpCard
					{mcp}
					{onEdit}
					{onDelete}
					{onDuplicate}
					{onTest}
					{showGatewayToggle}
					isInGateway={gatewayMcpIds.has(mcp.id)}
					enabled={isMcpEnabled(mcp)}
					onToggleEnable={handleToggleEnable}
					{onGatewayToggle}
					onFavoriteToggle={handleFavoriteToggle}
				/>
			{/each}
		</div>
	{/if}
</div>
