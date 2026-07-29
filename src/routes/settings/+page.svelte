<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Header } from '$lib/components/layout';
	import { SETTINGS_CATEGORIES } from '$lib/components/settings';
	import { onboarding } from '$lib/stores/onboarding.svelte';
	import type { Component } from 'svelte';
	import { i18n, type TranslationKey } from '$lib/i18n';

	onMount(() => {
		onboarding.completeStep('explore-settings');
	});

	const scopedCategories = SETTINGS_CATEGORIES.filter(c => c.type === 'scoped');
	const standaloneCategories = SETTINGS_CATEGORIES.filter(c => c.type === 'standalone');

	const activeTab = $derived($page.url.searchParams.get('tab') ?? 'models');
	const activeCategory = $derived(SETTINGS_CATEGORIES.find(c => c.id === activeTab) ?? SETTINGS_CATEGORIES[0]);

	function switchTab(tabId: string) {
		goto(`/settings?tab=${tabId}`, { replaceState: true });
	}

	function handleTabKeydown(e: KeyboardEvent, categories: typeof SETTINGS_CATEGORIES) {
		const currentIndex = categories.findIndex(c => c.id === activeTab);
		if (currentIndex === -1) return;
		let nextIndex = -1;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			nextIndex = (currentIndex + 1) % categories.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			nextIndex = (currentIndex - 1 + categories.length) % categories.length;
		} else if (e.key === 'Home') {
			e.preventDefault();
			nextIndex = 0;
		} else if (e.key === 'End') {
			e.preventDefault();
			nextIndex = categories.length - 1;
		}
		if (nextIndex >= 0) {
			switchTab(categories[nextIndex].id);
		}
	}

	const TAB_SUBTITLES: Record<string, TranslationKey> = {
		'models': 'settings.subtitle.models',
		'security': 'settings.subtitle.security',
		'environment': 'settings.subtitle.environment',
		'interface': 'settings.subtitle.interface',
		'files': 'settings.subtitle.files',
		'session': 'settings.subtitle.session',
		'auto-mode': 'settings.subtitle.auto-mode',
		'authentication': 'settings.subtitle.authentication',
		'agent-teams': 'settings.subtitle.agent-teams',
		'mcp-approval': 'settings.subtitle.mcp-approval',
		'keybindings': 'settings.subtitle.keybindings'
	};

	// Lazy-load tab components — only the active tab's code is fetched
	const TAB_LOADERS: Record<string, () => Promise<{ default: Component }>> = {
		'models': () => import('$lib/components/settings/tabs/SettingsModelsTab.svelte'),
		'security': () => import('$lib/components/settings/tabs/SettingsSecurityTab.svelte'),
		'environment': () => import('$lib/components/settings/tabs/SettingsEnvironmentTab.svelte'),
		'interface': () => import('$lib/components/settings/tabs/SettingsInterfaceTab.svelte'),
		'files': () => import('$lib/components/settings/tabs/SettingsFilesTab.svelte'),
		'session': () => import('$lib/components/settings/tabs/SettingsSessionTab.svelte'),
		'auto-mode': () => import('$lib/components/settings/tabs/SettingsAutoModeTab.svelte'),
		'authentication': () => import('$lib/components/settings/tabs/SettingsAuthTab.svelte'),
		'agent-teams': () => import('$lib/components/settings/tabs/SettingsAgentTeamsTab.svelte'),
		'mcp-approval': () => import('$lib/components/settings/tabs/SettingsMcpApprovalTab.svelte'),
		'keybindings': () => import('$lib/components/settings/tabs/SettingsKeybindingsTab.svelte'),
	};

	const activeTabPromise = $derived(TAB_LOADERS[activeTab]?.());
</script>

<Header
	title={i18n.t('page.settings.title')}
	subtitle={i18n.t(TAB_SUBTITLES[activeTab] ?? 'page.settings.subtitle')}
/>

<div class="flex-1 overflow-hidden flex">
	<!-- Left Nav -->
	<nav aria-label="Settings categories" class="w-52 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 overflow-y-auto flex-shrink-0">
		<div class="p-3">
			<p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-3 mb-2">
				{i18n.t('settings.configuration')}
			</p>
			<div role="tablist" aria-label="Configuration settings" aria-orientation="vertical">
				{#each scopedCategories as category}
					{@const isActive = activeTab === category.id}
					<button
						role="tab"
						aria-selected={isActive}
						aria-controls="settings-tabpanel"
						id="tab-{category.id}"
						tabindex={isActive ? 0 : -1}
						onclick={() => switchTab(category.id)}
						onkeydown={(e) => handleTabKeydown(e, scopedCategories)}
						class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5
							{isActive
								? 'bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
								: 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'}"
					>
						<category.icon class="w-4 h-4 flex-shrink-0" aria-hidden="true" />
						{i18n.t(category.label)}
					</button>
				{/each}
			</div>

			<div class="border-t border-gray-200 dark:border-gray-700 my-3"></div>

			<p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-3 mb-2">
				{i18n.t('settings.other')}
			</p>
			<div role="tablist" aria-label="Other settings" aria-orientation="vertical">
				{#each standaloneCategories as category}
					{@const isActive = activeTab === category.id}
					<button
						role="tab"
						aria-selected={isActive}
						aria-controls="settings-tabpanel"
						id="tab-{category.id}"
						tabindex={isActive ? 0 : -1}
						onclick={() => switchTab(category.id)}
						onkeydown={(e) => handleTabKeydown(e, standaloneCategories)}
						class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5
							{isActive
								? 'bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
								: 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'}"
					>
						<category.icon class="w-4 h-4 flex-shrink-0" aria-hidden="true" />
						{i18n.t(category.label)}
					</button>
				{/each}
			</div>
		</div>
	</nav>

	<!-- Right Content Area -->
	<div id="settings-tabpanel" role="tabpanel" aria-labelledby="tab-{activeTab}" class="flex-1 overflow-auto p-6">
		{#if activeTabPromise}
			{#await activeTabPromise}
				<div class="flex items-center justify-center py-12" aria-label="Loading settings">
					<div class="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
				</div>
			{:then mod}
				<mod.default />
			{/await}
		{/if}
	</div>
</div>
