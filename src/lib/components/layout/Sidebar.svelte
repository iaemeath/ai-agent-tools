<script lang="ts">
	import { page } from '$app/stores';
	import { Sparkles, Plug, Library, Zap, Bot, Terminal, BookOpen, FolderOpen, ScrollText, Settings } from 'lucide-svelte';
	import { i18n } from '$lib/i18n';
	import type { TranslationKey } from '$lib/i18n';

	interface NavItem { href: string; label: TranslationKey; icon: typeof Plug; }
	interface NavGroup { label: TranslationKey; items: NavItem[]; }

	const navGroups: NavGroup[] = [
		{
			label: 'nav.core',
			items: [
				{ href: '/projects', label: 'nav.projects', icon: FolderOpen },
				{ href: '/instructions', label: 'nav.instructions', icon: ScrollText },
				{ href: '/rules', label: 'nav.rules', icon: BookOpen }
			]
		},
		{
			label: 'nav.tools',
			items: [
				{ href: '/skills', label: 'nav.skills', icon: Sparkles },
				{ href: '/mcps', label: 'nav.mcps', icon: Library },
				{ href: '/hooks', label: 'nav.hooks', icon: Zap },
				{ href: '/agents', label: 'nav.agents', icon: Bot },
				{ href: '/commands', label: 'nav.commands', icon: Terminal },
				{ href: '/plugins', label: 'nav.plugins', icon: Plug }
			]
		}
	];

	const isSettingsActive = $derived($page.url.pathname === '/settings' || $page.url.pathname.startsWith('/settings/'));
</script>

<aside class="flex w-56 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
	<div class="flex items-center gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
		<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700">
			<Plug class="h-5 w-5 text-white" />
		</div>
		<div class="overflow-hidden">
			<h1 class="whitespace-nowrap font-semibold text-gray-900 dark:text-white">{i18n.t('app.name')}</h1>
			<p class="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">{i18n.t('app.tagline')}</p>
		</div>
	</div>

	<nav class="flex-1 overflow-y-auto p-3">
		{#each navGroups as group, gi}
			{#if gi > 0}<div class="mt-3"></div>{/if}
			<p class="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{i18n.t(group.label)}</p>
			<div class="space-y-0.5">
				{#each group.items as item}
					{@const isActive = $page.url.pathname === item.href || $page.url.pathname.startsWith(item.href + '/')}
					<a href={item.href} class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
						{isActive ? "bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300" : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50"}">
						<item.icon class="h-5 w-5 shrink-0" />
						<span class="whitespace-nowrap">{i18n.t(item.label)}</span>
					</a>
				{/each}
			</div>
		{/each}
	</nav>

	<div class="border-t border-gray-200 p-3 dark:border-gray-700">
		<a href="/settings" class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
			{isSettingsActive ? "bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300" : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50"}">
			<Settings class="h-5 w-5 shrink-0" />
			<span>{i18n.t('nav.settings')}</span>
		</a>
	</div>
</aside>
