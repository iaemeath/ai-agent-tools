<script lang="ts">
	import ScopeBar from './ScopeBar.svelte';
	import { i18n } from '$lib/i18n';
	import type { ToolInstance, Status } from '$lib/types/tool';

	let { tool, onToggleUser }: { tool: ToolInstance; onToggleUser?: (t: ToolInstance) => void | Promise<void> } = $props();
	const reloadHint = (k: string) => (k === 'skill' ? i18n.t('page.skills.reload') : i18n.t('page.plugins.reload'));
</script>

<div class="card flex flex-col gap-2">
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<div class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{tool.name}</div>
			<div class="truncate text-xs text-gray-500">{tool.description ?? '—'}</div>
		</div>
		<span class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-400">{tool.kind}</span>
	</div>
	<ScopeBar perScope={tool.perScope} />
	<div class="flex items-center justify-between">
		<span class="text-xs text-gray-400">{i18n.t('common.effective')}: <b>{tool.effective}</b></span>
		{#if onToggleUser}
			<button class="btn btn-primary text-xs" onclick={() => onToggleUser?.(tool)}>
				{tool.effective === "disabled" ? i18n.t("common.enable") + " (user)" : i18n.t("common.disable") + " (user)"}
			</button>
		{/if}
	</div>
	<div class="text-[10px] text-gray-400">live: run <code class="rounded bg-gray-100 px-1 dark:bg-gray-700">{reloadHint(tool.kind)}</code> in your session</div>
</div>