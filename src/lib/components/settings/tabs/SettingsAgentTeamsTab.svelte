<script lang="ts">
	import { ScopedSettingsWrapper } from '$lib/components/settings';
	import { AgentTeamEditor } from '$lib/components/agent-teams';
	import { claudeSettingsLibrary } from '$lib/stores';
	import type { ClaudeSettingsScope } from '$lib/types';

	function getSettingCount(scope: ClaudeSettingsScope): number {
		if (!claudeSettingsLibrary.settings) return 0;
		const s =
			scope === 'user'
				? claudeSettingsLibrary.settings.user
				: scope === 'project'
					? claudeSettingsLibrary.settings.project
					: claudeSettingsLibrary.settings.local;
		if (!s) return 0;
		let count = 0;
		if (s.teammateMode) count++;
		if (s.agentTeam?.enabled) count++;
		if (s.agentTeam?.members && s.agentTeam.members.length > 0) count++;
		return count;
	}
</script>

<ScopedSettingsWrapper {getSettingCount}>
	{#snippet children({ settings, save })}
		<AgentTeamEditor
			{settings}
			onsave={(s) => save(s, 'Agent team settings saved', 'Failed to save agent team settings')}
		/>
	{/snippet}
</ScopedSettingsWrapper>
