import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

// Placeholder routes share one view, distinguished by the `kind` param for display.
const PLACEHOLDER: RouteRecordRaw[] = [
	'/agents', '/commands', '/hooks',
].map((p) => ({
	path: p,
	name: p.slice(1),
	component: () => import('../views/PlaceholderView.vue'),
	props: { kind: p.slice(1) },
}));

const routes: RouteRecordRaw[] = [
	{ path: '/', redirect: '/plugins' },
	{ path: '/plugins', name: 'plugins', component: () => import('../views/PluginsView.vue') },
	{ path: '/skills', name: 'skills', component: () => import('../views/SkillsView.vue') },
	{ path: '/instructions', name: 'instructions', component: () => import('../views/InstructionsView.vue') },
	{ path: '/projects', name: 'projects', component: () => import('../views/ProjectsView.vue') },
	{ path: '/mcps', name: 'mcps', component: () => import('../views/MCPsView.vue') },
	{ path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
	...PLACEHOLDER,
];

export const router = createRouter({
	history: createWebHistory(),
	routes,
});
