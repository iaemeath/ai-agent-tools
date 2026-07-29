<script lang="ts">
	import { sessionStore } from '$lib/stores';
	import { LoadingSpinner, EmptyState } from '$lib/components/shared';
	import { i18n } from '$lib/i18n';
	import { MessageSquare } from 'lucide-svelte';

	function roleLabel(role: string): string {
		switch (role) {
			case 'user':
				return i18n.t('session.roleUser');
			case 'assistant':
				return i18n.t('session.roleAssistant');
			case 'tool':
				return i18n.t('session.roleTool');
			case 'system':
				return i18n.t('session.roleSystem');
			default:
				return role;
		}
	}

	function roleClass(role: string): string {
		switch (role) {
			case 'user':
				return 'bg-gray-100 dark:bg-gray-700/60 border-gray-200 dark:border-gray-600';
			case 'assistant':
				return 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800';
			case 'tool':
				return 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800';
			default:
				return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
		}
	}

	function formatTime(ts?: number): string {
		if (!ts) return '';
		return new Date(ts).toLocaleString();
	}
</script>

<div class="card h-full flex flex-col overflow-hidden">
	{#if !sessionStore.selectedSession}
		<div class="flex-1 flex items-center justify-center">
			<EmptyState
				icon={MessageSquare}
				title={i18n.t('session.noSelectionTitle')}
				description={i18n.t('session.noSelectionDesc')}
			/>
		</div>
	{:else}
		<!-- Header -->
		<div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
			<h3 class="text-sm font-semibold text-gray-900 dark:text-white truncate">
				{sessionStore.selectedSession.title ?? i18n.t('session.unknownTitle')}
			</h3>
			<div class="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
				{#if sessionStore.selectedSession.projectDir}
					<span class="truncate font-mono">{sessionStore.selectedSession.projectDir}</span>
				{/if}
				<span class="shrink-0">
					{i18n.t('session.messages', { count: sessionStore.messages.length })}
				</span>
			</div>
		</div>

		<!-- Messages -->
		<div class="flex-1 overflow-auto p-4 space-y-3">
			{#if sessionStore.messagesLoading}
				<div class="flex justify-center py-12">
					<LoadingSpinner />
				</div>
			{:else if sessionStore.messages.length === 0}
				<EmptyState icon={MessageSquare} title={i18n.t('session.noMessages')} />
			{:else}
				{#each sessionStore.messages as msg, i (i)}
					<div class="rounded-lg border p-3 {roleClass(msg.role)}">
						<div class="flex items-center justify-between mb-1">
							<span
								class="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300"
							>
								{roleLabel(msg.role)}
							</span>
							{#if msg.ts}
								<span class="text-xs text-gray-400 dark:text-gray-500">{formatTime(msg.ts)}</span>
							{/if}
						</div>
						<div class="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
							{msg.content}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
