<script lang="ts">
	import type { Skill } from '$lib/types';
	import { skillLibrary, notifications } from '$lib/stores';
	import SkillCard from './SkillCard.svelte';
	import { SearchBar } from '$lib/components/shared';
	import { Sparkles } from 'lucide-svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { i18n } from '$lib/i18n';

	type Props = {
		onEdit?: (skill: Skill) => void;
		onDelete?: (skill: Skill) => void;
	};

	let { onEdit, onDelete }: Props = $props();

	async function handleFavoriteToggle(skill: Skill, favorite: boolean) {
		try {
			await invoke('toggle_skill_favorite', { id: skill.id, favorite });
			skillLibrary.updateSkill({ ...skill, isFavorite: favorite });
		} catch (error) {
			console.error('Failed to toggle favorite:', error);
		}
	}

	function isSkillEnabled(skill: Skill): boolean {
		if (skillLibrary.selectedScope === 'user') {
			const row = skillLibrary.globalSkills.find((g) => g.skillId === skill.id);
			return row?.isEnabled ?? false;
		}
		const row = skillLibrary.projectSkills.find((p) => p.skillId === skill.id);
		return row?.isEnabled ?? false;
	}

	async function handleToggleEnable(skill: Skill, enabled: boolean) {
		try {
			if (skillLibrary.selectedScope === 'user') {
				const row = skillLibrary.globalSkills.find((g) => g.skillId === skill.id);
				if (row) {
					await skillLibrary.toggleGlobalSkill(row.id, enabled);
				} else if (enabled) {
					await skillLibrary.addGlobalSkill(skill.id);
				}
			} else {
				const projectId = skillLibrary.currentProjectId;
				if (projectId == null) return;
				const row = skillLibrary.projectSkills.find((p) => p.skillId === skill.id);
				if (row) {
					await skillLibrary.toggleProjectSkill(row.id, enabled);
				} else if (enabled) {
					await skillLibrary.assignToProject(projectId, skill.id);
				}
			}
		} catch (e) {
			console.error('Failed to toggle skill enable:', e);
			notifications.error(i18n.t('skill.updateFailed'));
		}
	}
</script>

<div class="space-y-4">
	<!-- Filters -->
	<div class="flex items-center gap-4">
		<div class="flex-1 max-w-sm">
			<SearchBar
				bind:value={skillLibrary.searchQuery}
				placeholder={i18n.t('skillLib.searchPlaceholder')}
			/>
		</div>

		<div class="text-sm text-gray-500 dark:text-gray-400">
			{skillLibrary.skills.length} skill{skillLibrary.skills.length !== 1 ? 's' : ''}
		</div>
	</div>

	<!-- Skill Grid -->
	{#if skillLibrary.isLoading}
		<div class="flex items-center justify-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
		</div>
	{:else if skillLibrary.filteredSkills.length === 0}
		<div class="text-center py-12">
			<Sparkles class="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
			{#if skillLibrary.searchQuery}
				<h3 class="text-lg font-medium text-gray-900 dark:text-white">{i18n.t('skillLib.noMatching')}</h3>
				<p class="text-gray-500 dark:text-gray-400 mt-1">
					{i18n.t('skillLib.tryAdjusting')}
				</p>
			{:else}
				<h3 class="text-lg font-medium text-gray-900 dark:text-white">{i18n.t('skillLib.noSkills')}</h3>
				<p class="text-gray-500 dark:text-gray-400 mt-1">
					{i18n.t('skillLib.addFirst')}
				</p>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each skillLibrary.filteredSkills as skill (skill.id)}
				<SkillCard
					{skill}
					{onEdit}
					{onDelete}
					enabled={isSkillEnabled(skill)}
					onToggleEnable={handleToggleEnable}
					onFavoriteToggle={handleFavoriteToggle}
				/>
			{/each}
		</div>
	{/if}
</div>
