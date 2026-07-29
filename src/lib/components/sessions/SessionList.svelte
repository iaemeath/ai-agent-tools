<script lang="ts">
	import { sessionStore, notifications } from '$lib/stores';
	import { SearchBar, LoadingSpinner, EmptyState, ConfirmDialog } from '$lib/components/shared';
	import { i18n } from '$lib/i18n';
	import { RefreshCw, History, Trash2, CheckSquare, Square } from 'lucide-svelte';
	import type { SessionMeta } from '$lib/types';

	let confirmingDelete = $state(false);

	function handleRefresh() {
		sessionStore.refresh();
	}

	function titleOrFallback(s: SessionMeta): string {
		return s.title ?? i18n.t('session.unknownTitle');
	}

	function formatTime(ts?: number): string {
		if (!ts) return '—';
		return new Date(ts).toLocaleString();
	}

	function handleRowClick(s: SessionMeta) {
		if (sessionStore.selectionMode) {
			sessionStore.toggleSelected(s.sessionId);
		} else {
			sessionStore.select(s);
		}
	}

	async function handleDeleteOne(meta: SessionMeta) {
		const ok = await sessionStore.deleteOne(meta);
		if (ok) notifications.success(i18n.t('session.deleted', { count: 1 }));
		else notifications.error(i18n.t('session.deleteFailed'));
	}

	async function handleBatchDelete() {
		const metas = sessionStore.sessions.filter((s) => sessionStore.selectedIds.has(s.sessionId));
		confirmingDelete = false;
		if (metas.length === 0) return;
		const outcomes = await sessionStore.deleteMany(metas);
		const success = outcomes.filter((o) => o.success).length;
		const failed = outcomes.length - success;
		if (failed === 0) {
			notifications.success(i18n.t('session.deleted', { count: success }));
		} else if (success === 0) {
			notifications.error(i18n.t('session.deleteFailed'));
		} else {
			notifications.error(i18n.t('session.deletePartial', { success, failed }));
		}
		sessionStore.toggleSelectionMode();
	}
</script>

<div class="card h-full flex flex-col overflow-hidden">
	<!-- Toolbar -->
	<div class="flex items-center gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
		<div class="flex-1">
			<SearchBar bind:value={sessionStore.searchQuery} placeholder={i18n.t('session.search')} />
		</div>
		<button onclick={handleRefresh} class="btn btn-ghost !p-2" title={i18n.t('session.refresh')}>
			<RefreshCw class="w-4 h-4" />
		</button>
		{#if sessionStore.selectionMode}
			<button
				onclick={() => sessionStore.toggleSelectionMode()}
				class="btn btn-ghost text-sm whitespace-nowrap"
			>
				{i18n.t('session.cancel')}
			</button>
			<button
				onclick={() => (confirmingDelete = true)}
				disabled={sessionStore.selectedCount === 0}
				class="inline-flex items-center px-2.5 py-1.5 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
			>
				<Trash2 class="w-4 h-4 mr-1" />
				{i18n.t('session.batchDelete')} ({sessionStore.selectedCount})
			</button>
		{:else}
			<button
				onclick={() => sessionStore.toggleSelectionMode()}
				class="btn btn-ghost text-sm whitespace-nowrap"
			>
				{i18n.t('session.selectMode')}
			</button>
		{/if}
	</div>

	<!-- List -->
	<div class="flex-1 overflow-auto">
		{#if sessionStore.isLoading}
			<div class="flex justify-center py-12">
				<LoadingSpinner />
			</div>
		{:else if sessionStore.sessions.length === 0}
			<EmptyState
				icon={History}
				title={i18n.t('session.emptyTitle')}
				description={i18n.t('session.emptyDesc')}
			/>
		{:else if sessionStore.filteredSessions.length === 0}
			<EmptyState
				icon={History}
				title={i18n.t('session.noMatchTitle')}
				description={i18n.t('session.noMatchDesc', { query: sessionStore.searchQuery })}
			/>
		{:else}
			<ul class="divide-y divide-gray-100 dark:divide-gray-700">
				{#each sessionStore.filteredSessions as s (s.sessionId)}
					<li>
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div
							role="button"
							tabindex="0"
							onclick={() => handleRowClick(s)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handleRowClick(s);
								}
							}}
							class="cursor-pointer w-full text-left px-3 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors {sessionStore.selectedSessionId === s.sessionId && !sessionStore.selectionMode ? 'bg-primary-50 dark:bg-primary-900/20' : ''}"
						>
							<div class="flex items-start gap-2">
								{#if sessionStore.selectionMode}
									<span class="mt-0.5 shrink-0 text-gray-400">
										{#if sessionStore.selectedIds.has(s.sessionId)}
											<CheckSquare class="w-4 h-4 text-primary-500" />
										{:else}
											<Square class="w-4 h-4" />
										{/if}
									</span>
								{/if}
								<div class="flex-1 min-w-0">
									<div class="flex items-center justify-between gap-2">
										<p class="text-sm font-medium text-gray-900 dark:text-white truncate">
											{titleOrFallback(s)}
										</p>
										{#if !sessionStore.selectionMode}
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													handleDeleteOne(s);
												}}
												class="shrink-0 text-gray-400 hover:text-red-500 transition-colors"
												title={i18n.t('session.batchDelete')}
											>
												<Trash2 class="w-4 h-4" />
											</button>
										{/if}
									</div>
									{#if s.summary}
										<p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
											{s.summary}
										</p>
									{/if}
									{#if s.projectDir}
										<p class="text-xs text-gray-400 dark:text-gray-500 truncate font-mono mt-1">
											{s.projectDir}
										</p>
									{/if}
									<p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
										{i18n.t('session.lastActive')}: {formatTime(s.lastActiveAt ?? s.createdAt)}
									</p>
								</div>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<ConfirmDialog
	open={confirmingDelete}
	title={i18n.t('session.deleteConfirmTitle')}
	message={i18n.t('session.deleteConfirmMessage')}
	variant="danger"
	onConfirm={handleBatchDelete}
	onCancel={() => (confirmingDelete = false)}
/>
