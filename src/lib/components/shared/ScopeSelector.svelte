<script lang="ts">
	import { Search, X, ChevronDown, FolderOpen } from 'lucide-svelte';
	import type { ProjectInfo } from '$lib/types/tool';
	import UserIcon from 'lucide-svelte/icons/user';

	export interface ScopeOption {
		value: string;
		label: string;
		sublabel?: string;
		count?: number;
	}

	type Props = {
		scopeOptions: ScopeOption[];
		selected?: string | null;
		search?: string;
		placeholder?: string;
		onScopeChange?: (value: string | null) => void;
	};

	let {
		scopeOptions,
		selected = $bindable(null),
		search = $bindable(''),
		placeholder = '',
		onScopeChange
	}: Props = $props();

	let open = $state(false);
	let containerEl: HTMLDivElement | null = $state(null);

	const selectedOption = $derived(scopeOptions.find((o) => o.value === selected) ?? null);
	const filtered = $derived(
		search.trim()
			? scopeOptions.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
			: scopeOptions
	);

	function pick(value: string) {
		selected = value;
		open = false;
		onScopeChange?.(selected);
	}

	function clearScope(e: MouseEvent) {
		e.stopPropagation();
		selected = null;
		open = false;
		onScopeChange?.(null);
	}


	function handleClickOutside(e: MouseEvent) {
		if (containerEl && !containerEl.contains(e.target as Node)) {
			open = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="mb-5 flex flex-wrap items-center gap-3">
	<!-- Search box -->
	<div class="relative min-w-[180px] flex-1">
		<Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
		<input
			type="text"
			bind:value={search}
			placeholder="Search skills…"
			class="input pl-9 pr-3 text-sm"
		/>
	</div>

	<!-- Clearable scope dropdown -->
	<div class="relative" bind:this={containerEl}>
		<div
			role="button"
			tabindex="0"
			onclick={() => (open = !open)}
			onkeydown={(e) => e.key === 'Enter' && (open = !open)}
			class="input flex min-w-[160px] cursor-pointer select-none items-center justify-between gap-2 py-2 text-sm"
		>
			<span class="flex min-w-0 items-center gap-2">
				{#if selectedOption}
					{#if selectedOption.value === 'user'}
						<UserIcon class="h-4 w-4 shrink-0 text-primary-500" />
					{:else}
						<FolderOpen class="h-4 w-4 shrink-0 text-primary-500" />
					{/if}
					<span class="truncate">{selectedOption.label}</span>
					<button
						type="button"
						onclick={clearScope}
						class="ml-0.5 rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-600"
						title="Clear"
						aria-label="Clear scope"
					>
						<X class="h-3.5 w-3.5" />
					</button>
				{:else}
					<span class="text-gray-400">{placeholder}</span>
				{/if}
			</span>
			<ChevronDown class="h-4 w-4 shrink-0 text-gray-400" />
		</div>

		{#if open}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
				{#each filtered as opt (opt.value)}
					<button
						type="button"
						onclick={() => pick(opt.value)}
						class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700
							{selected === opt.value ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'}"
					>
						{#if opt.value === 'user'}
							<UserIcon class="h-4 w-4 shrink-0 text-gray-400" />
						{:else}
							<FolderOpen class="h-4 w-4 shrink-0 text-gray-400" />
						{/if}
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{opt.label}</span>
							{#if opt.sublabel}
								<span class="block truncate text-xs text-gray-400">{opt.sublabel}</span>
							{/if}
						</span>
						{#if opt.count !== undefined && opt.count > 0}
							<span class="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">{opt.count}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

</div>



