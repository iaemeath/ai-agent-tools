<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  FolderOpen, ScrollText, Sparkles, Library, Plug, Scale, Terminal, Bot, Webhook, Server,
} from 'lucide-vue-next';
import { useTool } from '../stores/tool';
import type { ToolId } from '../types/tool';

const { t } = useI18n();
const route = useRoute();
const { tool } = useTool();

interface NavItem { index: string; labelKey: string; icon: any; /** When set, show only for these tools (capability gap, e.g. rules is Claude-only). */ onlyTools?: ToolId[]; }
interface NavGroup { index: string; labelKey: string; icon: any; items: NavItem[]; }

/** Filter nav items by the current tool's capabilities. */
function visible(item: NavItem): boolean {
	return !item.onlyTools || item.onlyTools.includes(tool.value);
}

/** Group 1 — workspace context: hosts, projects, instructions, rules. */
const navMain = computed<NavItem[]>(() => [
	{ index: '/hosts', labelKey: 'nav.hosts', icon: Server },
	{ index: '/projects', labelKey: 'nav.projects', icon: FolderOpen },
	{ index: '/instructions', labelKey: 'nav.instructions', icon: ScrollText },
	// Rules are Claude Code only — ZCode has no rules mechanism (profile.rules undefined).
	{ index: '/rules', labelKey: 'nav.rules', icon: Scale, onlyTools: ['claude'] },
]);

/** Group 2 — "Tools": everything the agent runtime loads. */
const navTools = computed<NavItem[]>(() => [
	{ index: '/plugins', labelKey: 'nav.plugins', icon: Plug },
	{ index: '/skills', labelKey: 'nav.skills', icon: Sparkles },
	{ index: '/mcps', labelKey: 'nav.mcps', icon: Library },
	{ index: '/agents', labelKey: 'nav.agents', icon: Bot },
	{ index: '/hooks', labelKey: 'nav.hooks', icon: Webhook },
	{ index: '/commands', labelKey: 'nav.commands', icon: Terminal },
]);

/** 一级菜单（el-sub-menu）：unique-opened 互斥，同时只展开一个。 */
const navGroups = computed<NavGroup[]>(() => [
	{ index: 'g-workspace', labelKey: 'nav.groupWorkspace', icon: Server, items: navMain.value },
	{ index: 'g-tools', labelKey: 'nav.groupTools', icon: Plug, items: navTools.value },
]);

const activeIndex = computed(() => route.path);

/** Open the submenu that contains the active route (first paint / direct URL entry). */
const defaultOpeneds = computed(() => {
	const g = navGroups.value.find((g) => g.items.some((i) => i.index === activeIndex.value));
	return g ? [g.index] : [];
});
</script>

<template>
  <div class="sidebar">
    <div class="brand">
      <div class="brand-logo"><el-icon :size="20"><Plug /></el-icon></div>
      <div class="brand-text">
        <div class="brand-name">{{ t('app.name') }}</div>
        <div v-if="t('app.tagline')" class="brand-tagline">{{ t('app.tagline') }}</div>
      </div>
    </div>

    <el-menu
      :default-active="activeIndex"
      :default-openeds="defaultOpeneds"
      unique-opened
      router
      class="sidebar-menu"
    >
      <el-sub-menu v-for="g in navGroups" :key="g.index" :index="g.index">
        <template #title>
          <el-icon><component :is="g.icon" /></el-icon>
          <span>{{ t(g.labelKey) }}</span>
        </template>
        <el-menu-item v-for="item in g.items.filter(visible)" :key="item.index" :index="item.index">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ t(item.labelKey) }}</span>
        </el-menu-item>
      </el-sub-menu>
    </el-menu>
  </div>
</template>

<style scoped>
.sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: var(--el-border-color) solid 1px;
}
.brand-logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-dark-2));
}
.brand-name {
  font-weight: 600;
  white-space: nowrap;
}
.brand-tagline {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.sidebar-menu {
  flex: 1;
  border-right: none;
  overflow-y: auto;
  padding: 12px 8px;
}
</style>
