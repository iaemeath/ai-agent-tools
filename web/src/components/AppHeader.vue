<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Refresh, Sunny, Moon, } from '@element-plus/icons-vue';
import { availableLocales, i18n, nextLocale } from '../i18n';
import { useTool } from '../stores/tool';
import { useHost } from '../stores/host';
import { api } from '../api';

const route = useRoute();
const { t } = useI18n();
const { tool, TOOL_OPTIONS, setTool } = useTool();
const { currentHost, remoteHosts, setHost } = useHost();

const isDark = ref(document.documentElement.classList.contains('dark'));
const isRefreshing = ref(false);

// Map route → header title/subtitle i18n keys.
const titleKey = computed(() => {
	const map: Record<string, string> = {
		skills: 'page.skills.title',
		projects: 'page.projects.title',
		plugins: 'page.plugins.title',
		instructions: 'page.instructions.title',
		rules: 'page.rules.title',
		commands: 'page.commands.title',
		agents: 'page.agents.title',
		hooks: 'page.hooks.title',
		mcps: 'page.mcps.title',
		settings: 'page.settings.title',
		hosts: 'page.hosts.title',
	};
	const seg = route.path.split('/')[1];
	return map[seg] ?? 'page.placeholder.title';
});
const subtitleKey = computed(() => {
	const map: Record<string, string> = {
		skills: 'page.skills.subtitle',
		projects: 'page.projects.subtitle',
		plugins: 'page.plugins.subtitle',
		instructions: 'page.instructions.subtitle',
		rules: 'page.rules.subtitle',
		commands: 'page.commands.subtitle',
		agents: 'page.agents.subtitle',
		hooks: 'page.hooks.subtitle',
		mcps: 'page.mcps.subtitle',
		settings: 'page.settings.subtitle',
		hosts: 'page.hosts.subtitle',
	};
	const seg = route.path.split('/')[1];
	return map[seg] ?? '';
});

// Remote host list for the selector; reloaded when HostsView adds/removes one.
async function loadHosts() {
	try {
		const { hosts } = await api.listHosts();
		remoteHosts.value = hosts.map((h) => ({ id: h.id, name: h.name, isLocal: false, status: h.status }));
	} catch { /* ignore */ }
}
onMounted(() => {
	loadHosts();
	window.addEventListener('ai-agent-tools:hosts-changed', loadHosts);
});
onUnmounted(() => window.removeEventListener('ai-agent-tools:hosts-changed', loadHosts));

function onHostChange(val: unknown) {
	setHost(String(val));
}

// Skills view exposes a global reload via a custom event; others refresh via location reload.
function onRefresh() {
	if (isRefreshing.value) return;
	isRefreshing.value = true;
	window.dispatchEvent(new CustomEvent('ai-agent-tools:reload'));
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
      <el-select :model-value="currentHost" size="default" class="host-switch" :title="t('header.switchHost')" @change="onHostChange">
        <el-option value="local" :label="t('host.local')" />
        <el-option v-for="h in remoteHosts" :key="h.id" :value="h.id" :label="h.name" />
      </el-select>
      <el-radio-group :model-value="tool" size="default" class="tool-switch" @change="setTool">
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
  gap: 8px;
}
/* Both use size="default" → identical 24px height. Widths: host fixed (132px fits typical
   host names), tool auto-sizes to "Claude Code / ZCode" labels. Unified gap replaces
   the old per-element margin-right so spacing is even across the whole row. */
.host-switch {
  width: 132px;
}
</style>
