<script lang="ts">
	import type { Project } from '$lib/types';
	import { RefreshCw, FolderOpen, User } from 'lucide-svelte';

	export interface ScopeBarItem {
		key: string;
		label: string;
		description: string;
		icon: typeof User;
	}

	type Props = {
		projectPath: string | null;
		projects: Project[];
		selectedScope: string;
		scopes: ScopeBarItem[];
		getCount?: (scope: string) => number;
		noProjectLabel?: string;
		refreshLabel?: string;
		onProjectChange: (path: string | null) => void;
		onScopeSelect: (scope: string) => void;
		onRefresh?: () => void;
	};

	let {
		projectPath,
		projects,
		selectedScope,
		scopes,
		getCount,
		noProjectLabel = '',
		refreshLabel = 'Refresh',
		onProjectChange,
		onScopeSelect,
		onRefresh
	}: Props = $props();

	function handleProjectChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		onProjectChange(target.value || null);
	}
</script>

<div class="flex flex-wrap items-center gap-4 mb-6">
	<div class="flex items-center gap-2">
		<FolderOpen class="w-4 h-4 text-gray-500 dark:text-gray-400" />
		<select value={projectPath ?? ''} onchange={handleProjectChange} class="input text-sm">
			<option value="">{noProjectLabel}</option>
			{#each projects as project (project.path)}
				<option value={project.path}>{project.name}</option>
			{/each}
		</select>
	</div>

	<div class="flex-1 min-w-[300px]">
		<div class="flex gap-1 bg-gray-100 dark:bg-gray-700/50 rounded-lg p-1">
			{#each scopes as { key, icon, label, description } (key)}
				{@const isDisabled = key !== 'user' && !projectPath}
				{@const isActive = selectedScope === key}
				{@const count = getCount?.(key) ?? 0}
				{@const Icon = icon}
				<button
					onclick={() => onScopeSelect(key)}
					disabled={isDisabled}
					class="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1
						{isActive
						? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
						: isDisabled
							? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
							: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}"
					title={description}
				>
					<Icon class="w-4 h-4" />
					{label}
					{#if count > 0}
						<span
							class="ml-1 px-1.5 py-0.5 text-xs rounded-full
								{isActive
								? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
								: 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}"
						>
							{count}
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	{#if onRefresh}
		<div class="flex items-center gap-2">
			<button onclick={onRefresh} class="btn btn-ghost" title={refreshLabel}>
				<RefreshCw class="w-4 h-4" />
			</button>
		</div>
	{/if}
</div>
