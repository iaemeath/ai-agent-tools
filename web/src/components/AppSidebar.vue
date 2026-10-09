<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  FolderOpen, ScrollText, Sparkles, Library, Plug, Scale, Terminal, Bot, Webhook, Server,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-vue-next';
import { useTool } from '../stores/tool';
import { sidebarCollapsed, toggleSidebar } from '../stores/ui';
import type { ToolId } from '../types/tool';

const { t } = useI18n();
const route = useRoute();
const { tool } = useTool();

interface NavItem { index: string; labelKey: string; icon: any; /** When set, show only for these tools (capability gap, e.g. rules is Claude-only). */ onlyTools?: ToolId[]; }

/** Filter nav items by the current tool's capabilities. */
function visible(item: NavItem): boolean {
	return !item.onlyTools || item.onlyTools.includes(tool.value);
}

/** Group 1 — workspace context: hosts, projects, instructions, rules. */
const navMain = computed<NavItem[]>(() => [
	{ index: '/hosts', labelKey: 'nav.hosts', icon: Server },
	{ index: '/projects', labelKey: 'nav.projects', icon: FolderOpen },
	// DSH has no standalone instructions/rules resources (capabilities come from
	// plugin compositions) — those pages are Claude/ZCode only.
	{ index: '/instructions', labelKey: 'nav.instructions', icon: ScrollText, onlyTools: ['claude', 'zcode'] },
	{ index: '/rules', labelKey: 'nav.rules', icon: Scale, onlyTools: ['claude'] },
]);

/** Group 2 — "Tools": everything the agent runtime loads. */
const navTools = computed<NavItem[]>(() => [
	{ index: '/plugins', labelKey: 'nav.plugins', icon: Plug },
	{ index: '/skills', labelKey: 'nav.skills', icon: Sparkles },
	{ index: '/mcps', labelKey: 'nav.mcps', icon: Library, onlyTools: ['claude', 'zcode'] },
	{ index: '/agents', labelKey: 'nav.agents', icon: Bot, onlyTools: ['claude', 'zcode'] },
	{ index: '/hooks', labelKey: 'nav.hooks', icon: Webhook, onlyTools: ['claude', 'zcode'] },
	{ index: '/commands', labelKey: 'nav.commands', icon: Terminal, onlyTools: ['claude', 'zcode'] },
]);

/** Flat groups (el-menu-item-group) — one click to any page; no submenu nesting. */
const navGroups = computed(() => [
	{ labelKey: 'nav.groupWorkspace', items: navMain.value },
	{ labelKey: 'nav.groupTools', items: navTools.value },
]);

const activeIndex = computed(() => '/' + (route.path.split('/')[1] ?? ''));
</script>

<template>
  <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">
    <div class="brand">
      <div class="brand-logo"><el-icon :size="20"><Plug /></el-icon></div>
      <div v-if="!sidebarCollapsed" class="brand-text">
        <div class="brand-name">{{ t('app.name') }}</div>
        <div v-if="t('app.tagline')" class="brand-tagline">{{ t('app.tagline') }}</div>
      </div>
    </div>

    <el-scrollbar class="sidebar-scroll">
      <el-menu
        :default-active="activeIndex"
        router
        :collapse="sidebarCollapsed"
        :collapse-width="64"
        class="sidebar-menu"
      >
        <el-menu-item-group v-for="g in navGroups" :key="g.labelKey" :title="t(g.labelKey)">
          <el-menu-item
            v-for="item in g.items.filter(visible)"
            :key="item.index"
            :index="item.index"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ t(item.labelKey) }}</template>
          </el-menu-item>
        </el-menu-item-group>
      </el-menu>
    </el-scrollbar>

    <div class="sidebar-foot">
      <el-button text class="collapse-btn" @click="toggleSidebar">
        <el-icon :size="16"><PanelLeftOpen v-if="sidebarCollapsed" /><PanelLeftClose v-else /></el-icon>
        <span v-if="!sidebarCollapsed">{{ t('sidebar.collapse') }}</span>
      </el-button>
    </div>
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
  padding: 12px 16px;
  border-bottom: var(--el-border-color) solid 1px;
  min-height: 56px;
}
.collapsed .brand {
  padding: 12px 0;
  justify-content: center;
}
.brand-logo {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-dark-2));
}
.brand-text {
  white-space: nowrap;
  overflow: hidden;
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
.sidebar-scroll {
  flex: 1;
}
.sidebar-menu {
  border-right: none;
  padding: 8px;
}
.sidebar-foot {
  border-top: var(--el-border-color) solid 1px;
  padding: 6px 8px;
}
.collapse-btn {
  width: 100%;
  justify-content: flex-start;
  gap: 8px;
  color: var(--el-text-color-secondary);
}
.collapsed .collapse-btn {
  justify-content: center;
}
</style>
