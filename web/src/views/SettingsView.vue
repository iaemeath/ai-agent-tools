<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { useTool } from '../stores/tool';

const { t } = useI18n();
const { tool } = useTool();

const values = ref<Record<string, unknown>>({});
const errorMsg = ref<string | null>(null);
const loading = ref(true);

async function reload() {
	errorMsg.value = null;
	loading.value = true;
	try {
		const res = await api.getSettings(tool.value);
		values.value = res.values;
	} catch (e) {
		errorMsg.value = (e as Error).message;
		values.value = {};
	} finally {
		loading.value = false;
	}
}

async function onToolChange() {
	values.value = {};
	loading.value = true;
	await reload();
}

onMounted(async () => {
	await reload();
	window.addEventListener('ai-agent-tools:reload', reload);
	window.addEventListener('ai-agent-tools:tool-change', onToolChange);
});
onUnmounted(() => {
	window.removeEventListener('ai-agent-tools:reload', reload);
	window.removeEventListener('ai-agent-tools:tool-change', onToolChange);
});

// ---- Section extraction (computed from raw values) ----

/** Known boolean toggle keys. */
const BOOL_KEYS = new Set([
	'alwaysThinkingEnabled', 'autoMemoryEnabled',
	'skipAutoPermissionPrompt', 'skipWorkflowUsageWarning',
]);

/** env section: object of string→string (environment variables). */
const envEntries = computed<[string, string][]>(() => {
	const env = values.value['env'];
	if (!env || typeof env !== 'object' || Array.isArray(env)) return [];
	return Object.entries(env).filter(([, v]) => typeof v === 'string') as [string, string][];
});

/** permissions section. */
const permissions = computed<Record<string, unknown> | null>(() => {
	const p = values.value['permissions'];
	return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : null;
});

/** hooks section. */
const hooks = computed<Record<string, unknown> | null>(() => {
	const h = values.value['hooks'];
	return h && typeof h === 'object' && !Array.isArray(h) ? h as Record<string, unknown> : null;
});

/** pluginConfigs section (per-plugin option overrides). */
const pluginConfigs = computed<Record<string, unknown> | null>(() => {
	const pc = values.value['pluginConfigs'];
	return pc && typeof pc === 'object' && !Array.isArray(pc) ? pc as Record<string, unknown> : null;
});

/** Boolean toggles. */
const boolToggles = computed<[string, boolean][]>(() => {
	return Object.entries(values.value)
		.filter(([k, v]) => BOOL_KEYS.has(k) && typeof v === 'boolean') as [string, boolean][];
});

/** Simple scalar values (string/number) not in special sections. */
const scalars = computed<[string, string][]>(() => {
	const skip = new Set([...BOOL_KEYS, 'env', 'permissions', 'hooks', 'pluginConfigs', 'extraKnownMarketplaces']);
	return Object.entries(values.value)
		.filter(([k, v]) => !skip.has(k) && (typeof v === 'string' || typeof v === 'number'))
		.map(([k, v]) => [k, String(v)] as [string, string]);
});

/** extraKnownMarketplaces (object, possibly empty). */
const marketplaces = computed<Record<string, unknown> | null>(() => {
	const m = values.value['extraKnownMarketplaces'];
	return m && typeof m === 'object' && !Array.isArray(m) ? m as Record<string, unknown> : null;
});

/** Other unmapped object keys (fallback display). */
const otherObjects = computed<[string, Record<string, unknown>][]>(() => {
	const known = new Set([...BOOL_KEYS, 'env', 'permissions', 'hooks', 'pluginConfigs', 'extraKnownMarketplaces', 'language']);
	return Object.entries(values.value)
		.filter(([k, v]) => !known.has(k) && v && typeof v === 'object' && !Array.isArray(v))
		.map(([k, v]) => [k, v as Record<string, unknown>]);
});

const hasAnyContent = computed(() =>
	envEntries.value.length > 0 ||
	permissions.value ||
	hooks.value ||
	pluginConfigs.value ||
	boolToggles.value.length > 0 ||
	scalars.value.length > 0 ||
	(marketplaces.value && Object.keys(marketplaces.value).length > 0) ||
	otherObjects.value.length > 0
);

function boolLabel(key: string): string {
	const map: Record<string, string> = {
		alwaysThinkingEnabled: t('settings.alwaysThinking'),
		autoMemoryEnabled: t('settings.autoMemory'),
		skipAutoPermissionPrompt: t('settings.skipAutoPermission'),
		skipWorkflowUsageWarning: t('settings.skipWorkflow'),
	};
	return map[key] ?? key;
}
</script>

<template>
  <div class="settings-view">
    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <el-alert v-else-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <div v-else-if="!hasAnyContent" class="state">{{ t('settings.empty') }}</div>

    <template v-else>
      <!-- Boolean toggles -->
      <section v-if="boolToggles.length" class="group">
        <h2 class="group-title">{{ t('settings.toggles') }}</h2>
        <div class="toggle-list">
          <div v-for="[key, val] in boolToggles" :key="key" class="toggle-row">
            <span class="toggle-label">{{ boolLabel(key) }}</span>
            <el-tag :type="val ? 'success' : 'info'" size="small">{{ val ? t('settings.on') : t('settings.off') }}</el-tag>
          </div>
        </div>
      </section>

      <!-- Scalar values (language, etc.) -->
      <section v-if="scalars.length" class="group">
        <h2 class="group-title">{{ t('settings.general') }}</h2>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item v-for="[k, v] in scalars" :key="k" :label="k">
            <code class="val-code">{{ v }}</code>
          </el-descriptions-item>
        </el-descriptions>
      </section>

      <!-- Environment variables -->
      <section v-if="envEntries.length" class="group">
        <h2 class="group-title">{{ t('settings.envVars') }} ({{ envEntries.length }})</h2>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item v-for="[k, v] in envEntries" :key="k" :label="k">
            <code class="val-code">{{ v }}</code>
          </el-descriptions-item>
        </el-descriptions>
      </section>

      <!-- Permissions -->
      <section v-if="permissions" class="group">
        <h2 class="group-title">{{ t('settings.permissions') }}</h2>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item v-for="[k, v] in Object.entries(permissions)" :key="k" :label="k">
            <code class="val-code">{{ typeof v === 'object' ? JSON.stringify(v) : String(v) }}</code>
          </el-descriptions-item>
        </el-descriptions>
      </section>

      <!-- Hooks -->
      <section v-if="hooks" class="group">
        <h2 class="group-title">{{ t('settings.hooks') }}</h2>
        <div v-for="[event, config] in Object.entries(hooks)" :key="event" class="hook-block">
          <div class="hook-event">⚡ {{ event }}</div>
          <pre class="hook-json">{{ JSON.stringify(config, null, 2) }}</pre>
        </div>
      </section>

      <!-- Plugin configs -->
      <section v-if="pluginConfigs" class="group">
        <h2 class="group-title">{{ t('settings.pluginConfigs') }}</h2>
        <div v-for="[plugin, config] in Object.entries(pluginConfigs)" :key="plugin" class="pc-block">
          <div class="pc-plugin">🔌 {{ plugin }}</div>
          <pre class="pc-json">{{ JSON.stringify(config, null, 2) }}</pre>
        </div>
      </section>

      <!-- Marketplaces -->
      <section v-if="marketplaces && Object.keys(marketplaces).length" class="group">
        <h2 class="group-title">{{ t('settings.marketplaces') }}</h2>
        <pre class="block-json">{{ JSON.stringify(marketplaces, null, 2) }}</pre>
      </section>

      <!-- Other unmapped objects (fallback) -->
      <section v-for="[key, obj] in otherObjects" :key="key" class="group">
        <h2 class="group-title">{{ key }}</h2>
        <pre class="block-json">{{ JSON.stringify(obj, null, 2) }}</pre>
      </section>
    </template>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 24px;
  max-width: 800px;
}
.state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px;
}
.group {
  margin-bottom: 28px;
}
.group-title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--el-text-color-secondary);
}
.toggle-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}
.toggle-label {
  font-size: 13px;
}
.val-code {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  word-break: break-all;
}
.hook-block, .pc-block {
  margin-bottom: 12px;
}
.hook-event, .pc-plugin {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
}
.hook-json, .pc-json, .block-json {
  margin: 0;
  padding: 10px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
