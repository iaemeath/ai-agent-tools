<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { Header } from '$lib/components/layout';
	import { ToolCard } from '$lib/components/shared';
	import { i18n } from '$lib/i18n';
	import type { ToolOverview, ToolInstance, Status } from '$lib/types/tool';

	let overview = $state<ToolOverview | null>(null);
	let errorMsg = $state<string | null>(null);
	let loading = $state(true);

	onMount(() => { reload(); });

	async function reload() {
		loading = true; errorMsg = null;
		try { overview = await invoke<ToolOverview>('get_overview', { project: null }); }
		catch (e) { errorMsg = String(e); }
		finally { loading = false; }
	}

	const plugins = $derived(overview?.items.filter((i) => i.kind === 'plugin') ?? []);

	async function toggleUser(t: ToolInstance) {
		const cur = t.perScope.find((s) => s.scope.level === 'user')?.status ?? 'inherited';
		const next: Status = cur === 'disabled' ? 'enabled' : 'disabled';
		try {
			await invoke('set_tool_status', { kind: t.kind, name: t.name, scope: { level: 'user' }, status: next, project: null });
			await reload();
		} catch (e) { errorMsg = String(e); }
	}
</script>

<Header title={i18n.t('page.plugins.title')} subtitle={i18n.t('page.plugins.subtitle')} onRefresh={reload} />
<div class="flex-1 overflow-auto p-6">
	<div class="mb-4 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-xs text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300">
		{i18n.t('common.refresh')}: run <code class="rounded bg-white px-1 dark:bg-gray-800">{i18n.t('page.plugins.reload')}</code> in your Claude session to apply changes.
	</div>

	{#if loading}
		<p class="text-sm text-gray-500">{i18n.t('common.loading')}</p>
	{:else if errorMsg}
		<div class="card text-sm text-red-600">{errorMsg}</div>
	{:else if plugins.length === 0}
		<div class="card text-sm text-gray-500">No plugins found.</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each plugins as t (t.name)}
				<ToolCard tool={t} onToggleUser={toggleUser} />
			{/each}
		</div>
	{/if}
</div>
