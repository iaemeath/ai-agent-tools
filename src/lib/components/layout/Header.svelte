<script lang="ts">
	import { RefreshCw, Moon, Sun, Languages } from 'lucide-svelte';
	import { i18n } from '$lib/i18n';
	import type { Snippet } from 'svelte';

	let { title, subtitle, onRefresh, children }: { title: string; subtitle?: string; onRefresh?: () => void; children?: Snippet } = $props();
	let isDark = $state(true);
	let isRefreshing = $state(false);

	if (typeof document !== 'undefined') isDark = document.documentElement.classList.contains('dark');

	async function handleRefresh() {
		if (!onRefresh || isRefreshing) return;
		isRefreshing = true;
		try { await onRefresh(); } finally { isRefreshing = false; }
	}

	function toggleTheme() {
		isDark = !isDark;
		document.documentElement.classList.toggle('dark', isDark);
		try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch {}
	}
</script>

<header class="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6 dark:border-gray-700 dark:bg-gray-800">
	<div>
		<h1 class="text-xl font-semibold text-gray-900 dark:text-white">{title}</h1>
		{#if subtitle}<p class="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>{/if}
	</div>
	<div class="flex items-center gap-2">
		{#if children}{@render children()}{/if}
		<button onclick={() => i18n.setLocale(i18n.nextLocale)} class="btn btn-ghost text-xs font-medium" title={i18n.t('header.switchLanguage')}>
			<Languages class="h-4 w-4" />{i18n.currentLabel}
		</button>
		{#if onRefresh}
			<button onclick={handleRefresh} class="btn btn-ghost" title={i18n.t('header.refresh')} disabled={isRefreshing}>
				<RefreshCw class="h-4 w-4 {isRefreshing ? 'animate-spin' : ''}" />
			</button>
		{/if}
		<button onclick={toggleTheme} class="btn btn-ghost" title={i18n.t('header.toggleTheme')}>
			{#if isDark}<Sun class="h-4 w-4" />{:else}<Moon class="h-4 w-4" />{/if}
		</button>
	</div>
</header>