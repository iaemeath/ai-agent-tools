<script lang="ts">
	import type { SubAgent } from '$lib/types';
	import { subagentLibrary } from '$lib/stores';
	import SubAgentCard from './SubAgentCard.svelte';
	import { SearchBar } from '$lib/components/shared';
	import { Bot } from 'lucide-svelte';
	import { invoke } from '@tauri-apps/api/core';

	type Props = {
		onEdit?: (subagent: SubAgent) => void;
		onDelete?: (subagent: SubAgent) => void;
	};

	let { onEdit, onDelete }: Props = $props();

	async function handleFavoriteToggle(subagent: SubAgent, favorite: boolean) {
		try {
			await invoke('toggle_subagent_favorite', { id: subagent.id, favorite });
			subagentLibrary.updateSubAgent({ ...subagent, isFavorite: favorite });
		} catch (error) {
			console.error('Failed to toggle favorite:', error);
		}
	}

	function isSubAgentEnabled(subagent: SubAgent): boolean {
		if (subagentLibrary.selectedScope === 'user') {
			const row = subagentLibrary.globalSubAgents.find((g) => g.subagentId === subagent.id);
			return row?.isEnabled ?? false;
		}
		const row = subagentLibrary.projectSubAgents.find((p) => p.subagentId === subagent.id);
		return row?.isEnabled ?? false;
	}

	async function handleToggleEnable(subagent: SubAgent, enabled: boolean) {
		try {
			if (subagentLibrary.selectedScope === 'user') {
				const row = subagentLibrary.globalSubAgents.find((g) => g.subagentId === subagent.id);
				if (row) {
					await subagentLibrary.toggleGlobalSubAgent(row.id, enabled);
				} else if (enabled) {
					await subagentLibrary.addGlobalSubAgent(subagent.id);
				}
			} else {
				const projectId = subagentLibrary.currentProjectId;
				if (projectId == null) return;
				const row = subagentLibrary.projectSubAgents.find((p) => p.subagentId === subagent.id);
				if (row) {
					await subagentLibrary.toggleProjectSubAgent(row.id, enabled);
				} else if (enabled) {
					await subagentLibrary.assignToProject(projectId, subagent.id);
				}
			}
		} catch (e) {
			console.error('Failed to toggle sub-agent enable:', e);
		}
	}
</script>

<div class="space-y-4">
	<!-- Filters -->
	<div class="flex items-center gap-4">
		<div class="flex-1 max-w-sm">
			<SearchBar
				bind:value={subagentLibrary.searchQuery}
				placeholder="Search sub-agents..."
			/>
		</div>

		<div class="text-sm text-gray-500 dark:text-gray-400">
			{subagentLibrary.subagents.length} sub-agent{subagentLibrary.subagents.length !== 1 ? 's' : ''}
		</div>
	</div>

	<!-- SubAgent Grid -->
	{#if subagentLibrary.isLoading}
		<div class="flex items-center justify-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
		</div>
	{:else if subagentLibrary.filteredSubAgents.length === 0}
		<div class="text-center py-12">
			<Bot class="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
			{#if subagentLibrary.searchQuery}
				<h3 class="text-lg font-medium text-gray-900 dark:text-white">No matching sub-agents</h3>
				<p class="text-gray-500 dark:text-gray-400 mt-1">
					Try adjusting your search
				</p>
			{:else}
				<h3 class="text-lg font-medium text-gray-900 dark:text-white">No sub-agents in library</h3>
				<p class="text-gray-500 dark:text-gray-400 mt-1">
					Add your first custom sub-agent to get started
				</p>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each subagentLibrary.filteredSubAgents as subagent (subagent.id)}
				<SubAgentCard
					{subagent}
					{onEdit}
					{onDelete}
					enabled={isSubAgentEnabled(subagent)}
					onToggleEnable={handleToggleEnable}
					onFavoriteToggle={handleFavoriteToggle}
				/>
			{/each}
		</div>
	{/if}
</div>
