import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
	{ path: '/', redirect: '/plugins' },
	{ path: '/plugins', name: 'plugins', component: () => import('../views/PluginsView.vue') },
	{ path: '/skills', name: 'skills', component: () => import('../views/SkillsView.vue') },
	{ path: '/instructions', name: 'instructions', component: () => import('../views/InstructionsView.vue') },
	{ path: '/rules', name: 'rules', component: () => import('../views/RulesView.vue') },
	{ path: '/projects', name: 'projects', component: () => import('../views/ProjectsView.vue') },
	{ path: '/commands', name: 'commands', component: () => import('../views/CommandsView.vue') },
	{ path: '/agents', name: 'agents', component: () => import('../views/AgentsView.vue') },
	{ path: '/hooks', name: 'hooks', component: () => import('../views/HooksView.vue') },
	{ path: '/mcps', name: 'mcps', component: () => import('../views/MCPsView.vue') },
	{ path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
];

export const router = createRouter({
	history: createWebHistory(),
	routes,
});
