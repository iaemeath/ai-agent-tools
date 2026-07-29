import { invoke } from '@tauri-apps/api/core';
import type {
	SessionMeta,
	SessionMessage,
	DeleteSessionOptions,
	DeleteSessionResult
} from '$lib/types';

class SessionStoreState {
	sessions = $state<SessionMeta[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);

	searchQuery = $state('');

	selectedSessionId = $state<string | null>(null);
	messages = $state<SessionMessage[]>([]);
	messagesLoading = $state(false);

	// Batch-delete selection mode
	selectionMode = $state(false);
	selectedIds = $state<Set<string>>(new Set());

	filteredSessions = $derived.by(() => {
		let result = this.sessions;
		const query = this.searchQuery.trim().toLowerCase();
		if (query) {
			result = result.filter(
				(s) =>
					(s.title ?? '').toLowerCase().includes(query) ||
					(s.summary ?? '').toLowerCase().includes(query) ||
					(s.projectDir ?? '').toLowerCase().includes(query) ||
					(s.sourcePath ?? '').toLowerCase().includes(query) ||
					s.sessionId.toLowerCase().includes(query)
			);
		}
		return [...result].sort((a, b) => {
			const aTs = a.lastActiveAt ?? a.createdAt ?? 0;
			const bTs = b.lastActiveAt ?? b.createdAt ?? 0;
			return bTs - aTs;
		});
	});

	selectedSession = $derived(
		this.sessions.find((s) => s.sessionId === this.selectedSessionId) ?? null
	);

	selectedCount = $derived(this.selectedIds.size);

	async load() {
		this.isLoading = true;
		this.error = null;
		try {
			this.sessions = await invoke<SessionMeta[]>('list_sessions');
		} catch (e) {
			this.error = String(e);
			console.error('Failed to load sessions:', e);
		} finally {
			this.isLoading = false;
		}
	}

	async refresh() {
		await this.load();
	}

	async select(meta: SessionMeta | null) {
		if (!meta) {
			this.selectedSessionId = null;
			this.messages = [];
			return;
		}
		this.selectedSessionId = meta.sessionId;
		this.messagesLoading = true;
		this.messages = [];
		try {
			this.messages = await invoke<SessionMessage[]>('get_session_messages', {
				providerId: meta.providerId,
				sourcePath: meta.sourcePath
			});
		} catch (e) {
			console.error('Failed to load session messages:', e);
		} finally {
			this.messagesLoading = false;
		}
	}

	async deleteOne(meta: SessionMeta): Promise<boolean> {
		try {
			await invoke('delete_session', {
				providerId: meta.providerId,
				sessionId: meta.sessionId,
				sourcePath: meta.sourcePath
			});
			this.sessions = this.sessions.filter((s) => s.sessionId !== meta.sessionId);
			if (this.selectedSessionId === meta.sessionId) {
				await this.select(null);
			}
			this.selectedIds = new Set([...this.selectedIds].filter((id) => id !== meta.sessionId));
			return true;
		} catch (e) {
			console.error('Failed to delete session:', e);
			return false;
		}
	}

	async deleteMany(metas: SessionMeta[]): Promise<DeleteSessionResult[]> {
		const items: DeleteSessionOptions[] = metas.map((m) => ({
			providerId: m.providerId,
			sessionId: m.sessionId,
			sourcePath: m.sourcePath ?? ''
		}));
		let outcomes: DeleteSessionResult[] = [];
		try {
			outcomes = await invoke<DeleteSessionResult[]>('delete_sessions', { items });
			const removedIds = new Set(
				outcomes.filter((o) => o.success).map((o) => o.sessionId)
			);
			this.sessions = this.sessions.filter((s) => !removedIds.has(s.sessionId));
			if (this.selectedSessionId && removedIds.has(this.selectedSessionId)) {
				await this.select(null);
			}
			this.selectedIds = new Set();
		} catch (e) {
			console.error('Failed to delete sessions:', e);
		}
		return outcomes;
	}

	toggleSelected(sessionId: string) {
		const next = new Set(this.selectedIds);
		if (next.has(sessionId)) {
			next.delete(sessionId);
		} else {
			next.add(sessionId);
		}
		this.selectedIds = next;
	}

	toggleSelectionMode() {
		this.selectionMode = !this.selectionMode;
		if (!this.selectionMode) {
			this.selectedIds = new Set();
		}
	}

	clearSelection() {
		this.selectedIds = new Set();
	}
}

export const sessionStore = new SessionStoreState();
