<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Refresh, Sunny, Moon, } from '@element-plus/icons-vue';
import { availableLocales, i18n, nextLocale } from '../i18n';
import { useTool } from '../stores/tool';

const route = useRoute();
const { t } = useI18n();
const { tool, TOOL_OPTIONS, setTool } = useTool();

const isDark = ref(document.documentElement.classList.contains('dark'));
const isRefreshing = ref(false);

// Map route → header title/subtitle i18n keys.
const titleKey = computed(() => {
	const map: Record<string, string> = {
		skills: 'page.skills.title',
		projects: 'page.projects.title',
		plugins: 'page.plugins.title',
		settings: 'nav.settings',
	};
	const seg = route.path.split('/')[1];
	return map[seg] ?? 'page.placeholder.title';
});
const subtitleKey = computed(() => {
	const map: Record<string, string> = {
		skills: 'page.skills.subtitle',
		projects: 'page.projects.subtitle',
		plugins: 'page.plugins.subtitle',
	};
	const seg = route.path.split('/')[1];
	return map[seg] ?? '';
});

// Skills view exposes a global reload via a custom event; others refresh via location reload.
function onRefresh() {
	if (isRefreshing.value) return;
	isRefreshing.value = true;
	window.dispatchEvent(new CustomEvent('ccc-ui:reload'));
	setTimeout(() => (isRefreshing.value = false), 600);
}

function toggleTheme() {
	isDark.value = !isDark.value;
	document.documentElement.classList.toggle('dark', isDark.value);
	try {
		localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
	} catch { /* ignore */ }
}

function switchLanguage() {
	nextLocale();
}
</script>

<template>
  <div class="header">
    <div>
      <h1 class="title">{{ t(titleKey) }}</h1>
      <p v-if="subtitleKey" class="subtitle">{{ t(subtitleKey) }}</p>
    </div>
    <div class="actions">
      <el-radio-group :model-value="tool" size="small" class="tool-switch" @change="setTool">
        <el-radio-button v-for="opt in TOOL_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</el-radio-button>
      </el-radio-group>
      <el-button text :title="t('header.switchLanguage')" @click="switchLanguage">
        {{ availableLocales.find((l) => l.code === (i18n.global.locale.value as string))?.label }}
      </el-button>
      <el-button text :title="t('header.refresh')" :icon="Refresh" :loading="isRefreshing" @click="onRefresh" />
      <el-button text :title="t('header.toggleTheme')" @click="toggleTheme">
        <el-icon><Moon v-if="isDark" /><Sunny v-else /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.header {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}
.title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.subtitle {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tool-switch {
  margin-right: 8px;
}
</style>
