<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { Header } from '$lib/components/layout';
	import { ListToolbar } from '$lib/components/shared';
	import type { ToolbarOption } from '$lib/components/shared';
	import { i18n } from '$lib/i18n';
	import { ArrowUpCircle, ChevronDown, ChevronRight } from 'lucide-svelte';
	import type { ToolOverview, ToolInstance, ProjectInfo, Status } from '$lib/types/tool';

	let projects = $state<ProjectInfo[]>([]);
	let overview = $state<ToolOverview | null>(null);
	let errorMsg = $state<string | null>(null);
	let loading = $state(true);
	let toast = $state<string | null>(null);

	let selected = $state<string | null>(null);
	let search = $state('');
	let promoting = $state<string | null>(null);

	onMount(async () => {
		try { projects = await invoke<ProjectInfo[]>('list_projects'); } catch (_) { projects = []; }
		await reload(true);
	});

	const projectPath = $derived(selected && selected !== 'user' ? selected : null);
	const isUserScope = $derived(selected === 'user');
	const isAllScope = $derived(selected === null);

	const scopeOptions = $derived<ToolbarOption[]>([
		{ value: 'user', label: i18n.t('scope.userLabel'), icon: 'user' },
		...projects.map((p) => ({
			value: p.path,
			label: p.path.split('/').filter(Boolean).pop() ?? p.path,
			sublabel: p.path,
			icon: 'folder' as const
		}))
	]);

	async function reload(silent = false) {
		if (!silent) loading = true;
		errorMsg = null;
		try { overview = await invoke<ToolOverview>('get_overview', { project: projectPath }); }
		catch (e) { errorMsg = String(e); }
		finally { loading = false; }
	}

	async function onScopeChange(value: string | null) {
		selected = value;
		await reload(true);
	}

	const allSkills = $derived(overview?.items.filter((i) => i.kind === 'skill') ?? []);

	const skills = $derived(
		search.trim()
			? allSkills.filter((s) =>
				s.name.toLowerCase().includes(search.trim().toLowerCase()) ||
				(s.description ?? '').toLowerCase().includes(search.trim().toLowerCase()))
			: allSkills
	);

	const globalSkills = $derived(skills.filter((s) => s.origin === 'global'));
	const projectSkills = $derived(skills.filter((s) => s.origin === 'project'));

	// Group project skills by their owning project
	const projectGroups = $derived.by(() => {
		const map = new Map<string, ToolInstance[]>();
		for (const s of projectSkills) {
			const key = s.originProject ?? 'unknown';
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(s);
		}
		return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	});

	function scopeStatus(t: ToolInstance): Status {
		const level = isUserScope ? 'user' : projectPath ? 'project' : 'user';
		return t.perScope.find((s) => s.scope.level === level)?.status ?? 'inherited';
	}

	async function toggleScope(t: ToolInstance) {
		if (t.origin === 'project') return; // project-origin skills can't be toggled, only promoted
		const level = isUserScope || isAllScope ? 'user' : 'project';
		const cur = scopeStatus(t);
		const next: Status = cur === 'disabled' ? 'enabled' : 'disabled';
		const scopeArg = level === 'user'
			? { level: 'user' }
			: { level: 'project', path: projectPath! };
		try {
			await invoke('set_tool_status', { kind: 'skill', name: t.name, scope: scopeArg, status: next, project: projectPath });
			await reload(true);
		} catch (e) { errorMsg = String(e); }
	}

	async function promote(t: ToolInstance) {
		if (!t.originProject) return;
		promoting = t.name;
		try {
			await invoke('promote_skill', { name: t.name, project: t.originProject });
			toast = i18n.t('skill.promoted');
			await reload(true);
			setTimeout(() => (toast = null), 3000);
		} catch (e) { errorMsg = String(e); }
		finally { promoting = null; }
	}

	function basename(p: string): string {
		return p.split('/').filter(Boolean).pop() ?? p;
	}

</script>

<Header title={i18n.t('page.skills.title')} subtitle={i18n.t('page.skills.subtitle')} onRefresh={reload} />
<div class="flex-1 overflow-auto p-6">
	<ListToolbar
		{scopeOptions}
		bind:selected
		bind:search
		searchPlaceholder={i18n.t('scope.searchPlaceholder')}
		scopePlaceholder={i18n.t('scope.selectScope')}
		onScopeChange={onScopeChange}
	/>

	<div class="mb-5 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-xs text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300">
		{i18n.t('common.refresh')}: run <code class="rounded bg-white px-1 dark:bg-gray-800">{i18n.t('page.skills.reload')}</code> in your Claude session to apply changes.
	</div>

	{#if loading}
		<p class="text-sm text-gray-500">{i18n.t('common.loading')}</p>
	{:else if errorMsg}
		<div class="card text-sm text-red-600">{errorMsg}</div>
	{:else if skills.length === 0}
		<div class="card text-sm text-gray-500">No skills found.</div>
	{:else}
		<!-- Global skills section -->
		{#if globalSkills.length > 0}
			<section class="mb-6">
				<div class="mb-2 flex items-baseline gap-2">
					<h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">{i18n.t('skill.groupGlobal')}</h2>
					<span class="text-xs text-gray-400">({globalSkills.length}) {i18n.t('skill.groupGlobalDesc')}</span>
				</div>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each globalSkills as t (t.name)}
						{@const st = scopeStatus(t)}
						<div class="card flex flex-col gap-2">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<div class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{t.name}</div>
									<div class="truncate text-xs text-gray-500">{t.description ?? '—'}</div>
								</div>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-xs text-gray-400">{i18n.t('common.effective')}: <b>{i18n.t('status.' + t.effective)}</b></span>
								<button class="btn btn-primary text-xs" onclick={() => toggleScope(t)}>
									{st === 'disabled' ? i18n.t('common.enable') : i18n.t('common.disable')}
								</button>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Project skills sections (grouped by project) -->
		{#each projectGroups as [projPath, projSkillList] (projPath)}
			<section class="mb-6">
				<div class="mb-2 flex items-baseline gap-2">
					<h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
						{i18n.t('skill.groupProject')} — {basename(projPath)}
					</h2>
					<span class="text-xs text-gray-400">({projSkillList.length}) {i18n.t('skill.groupProjectDesc')}</span>
				</div>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each projSkillList as t (projPath + '/' + t.name)}
						<div class="card flex flex-col gap-2 border-primary-300 dark:border-primary-700">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<div class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{t.name}</div>
									<div class="truncate text-xs text-gray-500">{t.description ?? '—'}</div>
								</div>
							</div>
							<div class="flex items-center justify-between">
								<span class="break-all text-[10px] text-gray-400">{projPath}</span>
								<button
									class="btn btn-primary text-xs"
									title={i18n.t('skill.promoteConfirm')}
									onclick={() => promote(t)}
									disabled={promoting === t.name}
								>
									<ArrowUpCircle class="h-3.5 w-3.5" />
									{promoting === t.name ? i18n.t('skill.promoting') : i18n.t('skill.promote')}
								</button>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>

{#if toast}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-gray-700">
		{toast}
	</div>
{/if}
