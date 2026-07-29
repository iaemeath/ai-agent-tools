<script lang="ts">
	import type { ScopeStatus } from '../../types/tool';
	let { perScope }: { perScope: ScopeStatus[] } = $props();

	const label = (s: ScopeStatus["scope"]): string =>
		s.level === "user" ? "user" : "project";
	const cls = (st: ScopeStatus["status"]): string =>
		st === "enabled" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
			: st === "disabled" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
			: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400";
</script>
<div class="flex flex-wrap gap-1">
	{#each perScope as ss (ss.scope.level + (ss.scope.level === "user" ? "" : ss.scope.path))}
		<span class="rounded px-1.5 py-0.5 text-[10px] font-medium {cls(ss.status)}">
			{label(ss.scope)}: {ss.status}
		</span>
	{/each}
</div>
