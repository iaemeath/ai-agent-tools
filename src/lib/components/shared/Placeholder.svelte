<script lang="ts">
	import { i18n } from '$lib/i18n';
	let { kind }: { kind?: string } = $props();
</script>

<div class="card mx-auto mt-10 max-w-md text-center">
	<div class="mb-2 text-3xl">🚧</div>
	<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">{i18n.t('page.placeholder.title')}</h2>
	<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{i18n.t('page.placeholder.subtitle')}</p>
	{#if kind}<p class="mt-3 text-xs uppercase tracking-wide text-gray-400">{kind}</p>{/if}
</div>
