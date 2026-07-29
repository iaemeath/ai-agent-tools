<script lang="ts">
	import type { Project, ProjectSkill, ProjectSubAgent } from '$lib/types';
	import { projectsStore, skillLibrary, subagentLibrary } from '$lib/stores';
	import { i18n } from '$lib/i18n';
	import ProjectCard from './ProjectCard.svelte';
	import { SearchBar, LoadingSpinner, EmptyState } from '$lib/components/shared';
	import { FolderOpen, Plus } from 'lucide-svelte';

	type Props = {
		onAddProject?: () => void;
		onRemoveProject?: (project: Project) => void;
	};

	let { onAddProject, onRemoveProject }: Props = $props();

	let searchQuery = $state('');

	// Batch-loaded project data to avoid N+1 IPC calls from each card
	let projectSkillsMap = $state<Map<number, ProjectSkill[]>>(new Map());
	let projectAgentsMap = $state<Map<number, ProjectSubAgent[]>>(new Map());

	// Batch load all project skills/agents when projects change
	$effect(() => {
		const projects = projectsStore.projects;
		if (projects.length === 0) return;
		Promise.all(
			projects.map(async (p) => {
				const [skills, agents] = await Promise.all([
					skillLibrary.getProjectSkills(p.id),
					subagentLibrary.getProjectSubAgents(p.id)
				]);
				return { id: p.id, skills, agents };
			})
		).then((results) => {
			const skillsMap = new Map<number, ProjectSkill[]>();
			const agentsMap = new Map<number, ProjectSubAgent[]>();
			for (const r of results) {
				skillsMap.set(r.id, r.skills);
				agentsMap.set(r.id, r.agents);
			}
			projectSkillsMap = skillsMap;
			projectAgentsMap = agentsMap;
		});
	});

	// Filter projects based on search query
	let filteredProjects = $derived(
		searchQuery.trim()
			? projectsStore.sortedProjects.filter((project) => {
					const query = searchQuery.toLowerCase();
					return (
						project.name.toLowerCase().includes(query) ||
						project.path.toLowerCase().includes(query)
					);
				})
			: projectsStore.sortedProjects
	);

	async function handleFavoriteToggle(project: Project, favorite: boolean) {
		await projectsStore.toggleFavorite(project.id, favorite);
	}
</script>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h3 class="text-lg font-semibold text-gray-900 dark:text-white">{i18n.t('project.list.title')}</h3>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				{i18n.t('project.list.subtitle')}
			</p>
		</div>
		{#if onAddProject}
			<button onclick={onAddProject} class="btn btn-primary">
				<Plus class="w-4 h-4 mr-2" />
				{i18n.t('project.list.add')}
			</button>
		{/if}
	</div>

	<!-- Search Bar -->
	{#if projectsStore.projects.length > 0}
		<div class="max-w-md">
			<SearchBar bind:value={searchQuery} placeholder={i18n.t('project.list.search')} />
		</div>
	{/if}

	<!-- Project List -->
	{#if projectsStore.isLoading}
		<LoadingSpinner />
	{:else if projectsStore.projects.length === 0}
		<div class="card">
			<EmptyState icon={FolderOpen} title={i18n.t('project.list.emptyTitle')} description={i18n.t('project.list.emptyDesc')}>
				{#if onAddProject}
					<button onclick={onAddProject} class="btn btn-primary">
						<Plus class="w-4 h-4 mr-2" />
						{i18n.t('project.list.addFirst')}
					</button>
				{/if}
			</EmptyState>
		</div>
	{:else if filteredProjects.length === 0}
		<div class="card">
			<EmptyState icon={FolderOpen} title={i18n.t('project.list.noMatchTitle')} description={i18n.t('project.list.noMatchDesc', { query: searchQuery })} />
		</div>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
			{#each filteredProjects as project (project.id)}
				<ProjectCard
					{project}
					preloadedSkills={projectSkillsMap.get(project.id)}
					preloadedAgents={projectAgentsMap.get(project.id)}
					onRemove={onRemoveProject}
					onFavoriteToggle={handleFavoriteToggle}
				/>
			{/each}
		</div>
	{/if}
</div>
