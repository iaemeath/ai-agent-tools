<script lang="ts">
	import { Header } from '$lib/components/layout';
	import SettingsPluginsTab from '$lib/components/settings/tabs/SettingsPluginsTab.svelte';
	import { i18n } from '$lib/stores';
</script>

<Header
	title={i18n.t('settings.category.plugins')}
	subtitle={i18n.t('settings.subtitle.plugins')}
/>

<div class="flex-1 overflow-auto p-6">
	<SettingsPluginsTab />
</div>
