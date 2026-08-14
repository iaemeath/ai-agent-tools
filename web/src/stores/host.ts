// Global host selector — which machine the app is operating on.
//
// 'local' = the machine running the server (the historical default). Any other id = a
// configured remote SSH host. AppHeader switches it; api/index.ts injects the chosen host
// as an X-Host header on every request so all 10 views transparently target it.
//
// Implemented as a module-scope singleton ref (mirrors stores/tool.ts — no Pinia). A
// change dispatches 'ccc-ui:reload', which every view already listens for, so switching
// the host refreshes every page with zero per-view changes.

import { ref } from 'vue';

export type HostId = string; // 'local' or a registry id

export interface HostOption {
	id: HostId;
	name: string;
	isLocal: boolean;
	status?: 'connected' | 'connecting' | 'idle';
}

export const currentHost = ref<HostId>('local');
/** Remote hosts available in the selector (loaded from /api/hosts by AppHeader). */
export const remoteHosts = ref<HostOption[]>([]);

export function useHost() {
	function setHost(next: HostId) {
		if (next === currentHost.value) return;
		currentHost.value = next;
		// All 10 views listen on 'ccc-ui:reload' and re-fetch — reuse it so a host switch
		// refreshes every page (the api layer now targets the new host) with no view edits.
		window.dispatchEvent(new CustomEvent('ccc-ui:reload'));
	}
	return { currentHost, remoteHosts, setHost };
}
