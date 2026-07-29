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
		try { overview = await invoke<ToolOverview>("get_overview", { project: null }); }
		catch (e) { errorMsg = String(e); }
		finally { loading = false; }
	}

	async function toggleUser(t: ToolInstance) {
		const cur = t.perScope.find((s) => s.scope.level === "user")?.status ?? "inherited";
		const next: Status = cur === "disabled" ? "enabled" : "disabled";
		try { await invoke("set_tool_status", { kind: t.kind, name: t.name, scope: { level: "user" }, status: next, project: null }); await reload(); }
		catch (e) { errorMsg = String(e); }
	}
</script>

<Header title={i18n.t("page.dashboard.title")} subtitle={i18n.t("page.dashboard.subtitle")} onRefresh={reload} />
<div class="flex-1 overflow-auto p-6">
	{#if loading}
		<p class="text-sm text-gray-500">{i18n.t("common.loading")}</p>
	{:else if errorMsg}
		<div class="card text-sm text-red-600">{errorMsg}</div>
	{:else if !overview || overview.items.length === 0}
		<div class="card text-sm text-gray-500">No skills or plugins found.</div>
	{:else}
		<div class="mb-3 text-xs text-gray-400">
			{overview.items.filter((i) => i.kind === "skill").length} {i18n.t("nav.skills")} ·
			{overview.items.filter((i) => i.kind === "plugin").length} {i18n.t("nav.plugins")}
		</div>
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each overview.items as t (t.kind + "/" + t.name)}
				<ToolCard tool={t} onToggleUser={toggleUser} />
			{/each}
		</div>
	{/if}
</div>