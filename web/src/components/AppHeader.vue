<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Refresh, Sunny, Moon, } from '@element-plus/icons-vue';
import { availableLocales, i18n, nextLocale } from '../i18n';
import { useTool } from '../stores/tool';
import { useHost } from '../stores/host';
import { api } from '../api';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { tool, TOOL_OPTIONS, setTool } = useTool();
const { currentHost, remoteHosts, setHost } = useHost();

const isDark = ref(document.documentElement.classList.contains('dark'));
const isRefreshing = ref(false);

/**
 * Breadcrumb trail from the matched route records: each record contributes
 * meta.crumbKey (i18n label) and/or meta.crumbText (dynamic label from params).
 * Everything but the last crumb links to its resolved path.
 */
interface Crumb { text: string; to?: string }
const crumbs = computed<Crumb[]>(() => {
	const out: Crumb[] = [];
	for (const record of route.matched) {
		const meta = record.meta as { crumbKey?: string; crumbText?: (r: typeof route) => string };
		const key = meta.crumbKey ? t(meta.crumbKey) : '';
		const text = meta.crumbText ? meta.crumbText(route) : '';
		const label = text || key;
		if (!label) continue;
		const resolved = record.name && !String(record.path).includes(':')
			? router.resolve({ name: record.name, params: route.params }).href
			: undefined;
		out.push({ text: label, to: out.length < route.matched.length - 1 ? resolved : undefined });
	}
	return out;
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
    <!-- Breadcrumb trail — grows one level per nested route (插件 / agent-style / 文件) -->
    <el-breadcrumb separator="/" class="crumbs">
      <el-breadcrumb-item
        v-for="(c, i) in crumbs"
        :key="i"
        :to="c.to"
      >{{ c.text }}</el-breadcrumb-item>
    </el-breadcrumb>

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
  height: 48px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.crumbs {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.host-switch {
  width: 132px;
}
</style>
