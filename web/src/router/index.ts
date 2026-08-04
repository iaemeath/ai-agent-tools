import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

// Placeholder routes share one view, distinguished by the `kind` param for display.
const PLACEHOLDER: RouteRecordRaw[] = [
	'/plugins', '/agents', '/commands', '/hooks', '/instructions', '/rules', '/mcps',
].map((p) => ({
	path: p,
	name: p.slice(1),
	component: () => import('../views/PlaceholderView.vue'),
	props: { kind: p.slice(1) },
}));

const routes: RouteRecordRaw[] = [
	{ path: '/', redirect: '/skills' },
	{ path: '/skills', name: 'skills', component: () => import('../views/SkillsView.vue') },
	{ path: '/projects', name: 'projects', component: () => import('../views/PlaceholderView.vue'), props: { kind: 'projects' } },
	{ path: '/settings', name: 'settings', component: () => import('../views/PlaceholderView.vue'), props: { kind: 'settings' } },
	...PLACEHOLDER,
];

export const router = createRouter({
	history: createWebHistory(),
	routes,
});
