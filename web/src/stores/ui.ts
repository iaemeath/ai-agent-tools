// UI shell state — sidebar collapse + per-page view-mode preferences, persisted
// to localStorage (survives refresh; mainstream admin behavior).

import { ref } from 'vue';

const COLLAPSE_KEY = 'sidebar-collapsed';

function readBool(key: string): boolean {
	try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

/** Sidebar collapsed to icon-only mode. */
export const sidebarCollapsed = ref(readBool(COLLAPSE_KEY));

export function toggleSidebar(): void {
	sidebarCollapsed.value = !sidebarCollapsed.value;
	try { localStorage.setItem(COLLAPSE_KEY, sidebarCollapsed.value ? '1' : '0'); } catch { /* ignore */ }
}
