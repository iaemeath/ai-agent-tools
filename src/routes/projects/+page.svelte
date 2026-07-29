<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { Header } from '$lib/components/layout';
	import { i18n } from '$lib/i18n';
	import { FolderOpen, FileText, MessageSquare, Clock, Trash2, X } from 'lucide-svelte';
	import type { ProjectInfo } from '$lib/types/tool';

	let projects = $state<ProjectInfo[]>([]);
	let errorMsg = $state<string | null>(null);
	let loading = $state(true);
	let pendingDelete = $state<string | null>(null);
	let deleting = $state(false);

	onMount(() => { reload(); });

	async function reload() {
		loading = true; errorMsg = null; pendingDelete = null;
		try { projects = await invoke<ProjectInfo[]>('list_projects'); }
		catch (e) { errorMsg = String(e); }
		finally { loading = false; }
	}

	function basename(path: string): string {
		const parts = path.split('/').filter(Boolean);
		return parts.length ? parts[parts.length - 1] : path;
	}

	function relativeTime(iso: string | null): string {
		if (!iso) return i18n.t('common.unknown');
		const then = new Date(iso).getTime();
		if (Number.isNaN(then)) return i18n.t('common.unknown');
		const diff = Date.now() - then;
		const min = Math.floor(diff / 60000);
		if (min < 1) return '< 1m';
		if (min < 60) return min + 'm';
		const hr = Math.floor(min / 60);
		if (hr < 24) return hr + 'h';
		const day = Math.floor(hr / 24);
		if (day < 30) return day + 'd';
		const mon = Math.floor(day / 30);
		if (mon < 12) return mon + 'mo';
		return Math.floor(mon / 12) + 'y';
	}

	async function confirmDelete(encoded: string) {
		deleting = true;
		try {
			await invoke('delete_project', { encoded });
			await reload();
		} catch (e) {
			errorMsg = String(e);
		} finally {
			deleting = false;
			pendingDelete = null;
		}
	}
</script>

<Header title={i18n.t('page.projects.title')} subtitle={i18n.t('page.projects.subtitle')} onRefresh={reload} />
<div class="flex-1 overflow-auto p-6">
	{#if loading}
		<p class="text-sm text-gray-500">{i18n.t('common.loading')}</p>
	{:else if errorMsg}
		<div class="card text-sm text-red-600">{errorMsg}</div>
	{:else if projects.length === 0}
		<div class="card text-sm text-gray-500">{i18n.t('page.projects.empty')}</div>
	{:else}
		<div class="grid gap-3 lg:grid-cols-2">
			{#each projects as p (p.encoded)}
				{@const isPending = pendingDelete === p.encoded}
				<div class="card flex flex-col gap-2">
					<div class="flex items-start gap-3">
						<div class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/40">
							<FolderOpen class="h-5 w-5 text-primary-600 dark:text-primary-400" />
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{basename(p.path)}</p>
							<p class="mt-0.5 break-all text-xs text-gray-500 dark:text-gray-400">{p.path}</p>
						</div>
						{#if isPending}
							<div class="flex shrink-0 items-center gap-1">
								<button
									class="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
									onclick={() => confirmDelete(p.encoded)}
									disabled={deleting}
								>
									{deleting ? i18n.t('page.projects.deleting') : i18n.t('common.delete')}
								</button>
								<button
									class="btn btn-ghost p-1.5"
									title={i18n.t('common.cancel')}
									onclick={() => (pendingDelete = null)}
									disabled={deleting}
								>
									<X class="h-4 w-4" />
								</button>
							</div>
						{:else}
							<button
								class="btn btn-ghost shrink-0 p-1.5 text-gray-400 hover:text-red-600"
								title={i18n.t('page.projects.confirmDelete')}
								onclick={() => (pendingDelete = p.encoded)}
							>
								<Trash2 class="h-4 w-4" />
							</button>
						{/if}
					</div>
					{#if isPending}
						<p class="text-xs text-red-600 dark:text-red-400">{i18n.t('page.projects.confirmDelete')}</p>
					{/if}
					<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
						<span class="inline-flex items-center gap-1">
							<MessageSquare class="h-3.5 w-3.5" />
							{p.sessionCount} {i18n.t('page.projects.sessions')}
						</span>
						<span class="inline-flex items-center gap-1">
							<Clock class="h-3.5 w-3.5" />
							{i18n.t('page.projects.lastActivity')}: {relativeTime(p.lastActivity)}
						</span>
						<span class="inline-flex items-center gap-1">
							<FileText class="h-3.5 w-3.5" />
							{#if p.hasSettings}
								<span class="text-green-600 dark:text-green-400">{i18n.t('page.projects.hasSettings')}</span>
							{:else}
								<span class="text-gray-400">{i18n.t('page.projects.noSettings')}</span>
							{/if}
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
