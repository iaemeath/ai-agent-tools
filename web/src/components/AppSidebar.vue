<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  FolderOpen, ScrollText, Sparkles, Library, Plug, Settings, Scale, Terminal, Bot, Webhook,
} from 'lucide-vue-next';

const { t } = useI18n();
const route = useRoute();

interface NavItem { index: string; labelKey: string; icon: any; }

const navItems = computed<NavItem[]>(() => [
	{ index: '/projects', labelKey: 'nav.projects', icon: FolderOpen },
	{ index: '/instructions', labelKey: 'nav.instructions', icon: ScrollText },
	{ index: '/rules', labelKey: 'nav.rules', icon: Scale },
	{ index: '/plugins', labelKey: 'nav.plugins', icon: Plug },
	{ index: '/skills', labelKey: 'nav.skills', icon: Sparkles },
	{ index: '/commands', labelKey: 'nav.commands', icon: Terminal },
	{ index: '/agents', labelKey: 'nav.agents', icon: Bot },
	{ index: '/hooks', labelKey: 'nav.hooks', icon: Webhook },
	{ index: '/mcps', labelKey: 'nav.mcps', icon: Library },
]);

const activeIndex = computed(() => '/' + (route.path.split('/')[1] ?? ''));
</script>

<template>
  <div class="sidebar">
    <div class="brand">
      <div class="brand-logo"><el-icon :size="20"><Plug /></el-icon></div>
      <div class="brand-text">
        <div class="brand-name">{{ t('app.name') }}</div>
        <div class="brand-tagline">{{ t('app.tagline') }}</div>
      </div>
    </div>

    <el-menu :default-active="activeIndex" router class="sidebar-menu">
      <el-menu-item v-for="item in navItems" :key="item.index" :index="item.index">
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ t(item.labelKey) }}</span>
      </el-menu-item>
    </el-menu>

    <div class="settings-entry">
      <el-menu :default-active="activeIndex === '/settings' ? '/settings' : ''" router>
        <el-menu-item index="/settings">
          <el-icon><Settings /></el-icon>
          <span>{{ t('nav.settings') }}</span>
        </el-menu-item>
      </el-menu>
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
.settings-entry {
  border-top: var(--el-border-color) solid 1px;
  padding: 8px;
}
.settings-entry .el-menu {
  border-right: none;
}
</style>
