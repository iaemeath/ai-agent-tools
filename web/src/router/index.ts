import { createRouter, createWebHistory, type RouteLocationNormalizedLoaded, type RouteRecordRaw } from 'vue-router';

/**
 * Route table — hierarchical (breadcrumb-ready). meta.crumbKey names the i18n key
 * for the crumb; meta.crumbText optionally derives a dynamic label from params
 * (e.g. the plugin short name). Detail routes are REAL routes: refresh/deep-link
 * keep their state, and the breadcrumb grows one level per nesting.
 *
 * Legacy query-based links had no URL presence (detail state lived in component
 * memory), so no redirect table is needed beyond the '/' alias.
 */
const routes: RouteRecordRaw[] = [
	{ path: '/', redirect: '/plugins' },

	// Plugins (hierarchical pilot: list → detail → files / component)
	{ path: '/plugins', name: 'plugins', component: () => import('../views/PluginsView.vue'), meta: { crumbKey: 'nav.plugins' } },
	{
		path: '/plugins/:name',
		name: 'plugin-detail',
		component: () => import('../views/PluginDetailView.vue'),
		meta: {
			crumbKey: 'nav.plugins',
			crumbText: (r: RouteLocationNormalizedLoaded) => String(r.params.name ?? '').split('@')[0],
		},
	},
	{
		path: '/plugins/:name/files',
		name: 'plugin-files',
		component: () => import('../views/PluginFilesView.vue'),
		meta: { crumbKey: 'plugin.filesTab' },
	},
	{
		path: '/plugins/:name/:kind/:item',
		name: 'plugin-component',
		component: () => import('../views/PluginComponentView.vue'),
		meta: { crumbText: (r: RouteLocationNormalizedLoaded) => String(r.params.item ?? '') },
	},

	// Flat resources (detail state still in-page; hierarchy lands per-page in later phases)
	{ path: '/skills', name: 'skills', component: () => import('../views/SkillsView.vue'), meta: { crumbKey: 'nav.skills' } },
	{ path: '/instructions', name: 'instructions', component: () => import('../views/InstructionsView.vue'), meta: { crumbKey: 'nav.instructions' } },
	{ path: '/rules', name: 'rules', component: () => import('../views/RulesView.vue'), meta: { crumbKey: 'nav.rules' } },
	{ path: '/projects', name: 'projects', component: () => import('../views/ProjectsView.vue'), meta: { crumbKey: 'nav.projects' } },
	{ path: '/sessions', name: 'sessions', component: () => import('../views/SessionsView.vue'), meta: { crumbKey: 'nav.projects' } },
	{ path: '/commands', name: 'commands', component: () => import('../views/CommandsView.vue'), meta: { crumbKey: 'nav.commands' } },
	{ path: '/agents', name: 'agents', component: () => import('../views/AgentsView.vue'), meta: { crumbKey: 'nav.agents' } },
	{ path: '/hooks', name: 'hooks', component: () => import('../views/HooksView.vue'), meta: { crumbKey: 'nav.hooks' } },
	{ path: '/mcps', name: 'mcps', component: () => import('../views/MCPsView.vue'), meta: { crumbKey: 'nav.mcps' } },
	{ path: '/hosts', name: 'hosts', component: () => import('../views/HostsView.vue'), meta: { crumbKey: 'nav.hosts' } },

	// Catch-all 404 — any unknown path renders the not-found page instead of a blank view.
	{ path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue'), meta: { crumbKey: 'notFound.crumb' } },
];

export const router = createRouter({
	history: createWebHistory(),
	routes,
});
