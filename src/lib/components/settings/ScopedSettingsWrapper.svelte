<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { claudeSettingsLibrary, projectsStore, notifications, i18n } from '$lib/stores';
	import { ScopeBar } from '$lib/components/shared';
	import type { ClaudeSettings, ClaudeSettingsScope } from '$lib/types';
	import { CLAUDE_SETTINGS_SCOPE_LABELS } from '$lib/types';
	import { FolderOpen, User, FileText } from 'lucide-svelte';

	type Props = {
		getSettingCount: (scope: ClaudeSettingsScope) => number;
		children: Snippet<
			[
				{
					settings: ClaudeSettings;
					save: (settings: ClaudeSettings, successMsg: string, errorMsg: string) => Promise<void>;
				}
			]
		>;
	};

	let { getSettingCount, children }: Props = $props();

	onMount(async () => {
		await projectsStore.loadProjects();
		if (projectsStore.selectedProjectPath) {
			claudeSettingsLibrary.setProjectPath(projectsStore.selectedProjectPath);
		}
		await claudeSettingsLibrary.load();
	});

	function handleProjectChange(path: string | null) {
		claudeSettingsLibrary.setProjectPath(path);
		claudeSettingsLibrary.load();
	}

	async function handleRefresh() {
		await claudeSettingsLibrary.load();
		notifications.success('Settings refreshed');
	}

	async function save(settings: ClaudeSettings, successMsg: string, errorMsg: string) {
		try {
			await claudeSettingsLibrary.save(settings);
			notifications.success(successMsg);
		} catch (err) {
			notifications.error(errorMsg);
		}
	}

	const settingsScopes = [
		{ key: 'user', label: CLAUDE_SETTINGS_SCOPE_LABELS.user.label, description: CLAUDE_SETTINGS_SCOPE_LABELS.user.description, icon: User },
		{ key: 'project', label: CLAUDE_SETTINGS_SCOPE_LABELS.project.label, description: CLAUDE_SETTINGS_SCOPE_LABELS.project.description, icon: FolderOpen },
		{ key: 'local', label: CLAUDE_SETTINGS_SCOPE_LABELS.local.label, description: CLAUDE_SETTINGS_SCOPE_LABELS.local.description, icon: FileText }
	];
</script>

<ScopeBar
	projectPath={projectsStore.selectedProjectPath}
	projects={projectsStore.projects}
	selectedScope={claudeSettingsLibrary.selectedScope}
	scopes={settingsScopes}
	getCount={(s) => getSettingCount(s as ClaudeSettingsScope)}
	noProjectLabel={i18n.t('settings.scopeNoProject')}
	refreshLabel="Refresh from settings files"
	onProjectChange={handleProjectChange}
	onScopeSelect={(s) => claudeSettingsLibrary.setScope(s as ClaudeSettingsScope)}
	onRefresh={handleRefresh}
/>

{#if claudeSettingsLibrary.isLoading}
	<div class="flex items-center justify-center py-20">
		<div
			class="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full"
		></div>
	</div>
{:else if claudeSettingsLibrary.error}
	<div
		class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400"
	>
		{claudeSettingsLibrary.error}
	</div>
{:else if claudeSettingsLibrary.currentScopeSettings}
	{@render children({ settings: claudeSettingsLibrary.currentScopeSettings, save })}
{:else}
	<div class="text-center py-20 text-gray-400 dark:text-gray-500">
		<p>Select a scope to view settings</p>
	</div>
{/if}
