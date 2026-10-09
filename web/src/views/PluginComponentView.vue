<script setup lang="ts">
// Plugin component detail — /plugins/:name/:kind/:item. Route-driven second level.
//
// Content-area layout rule (global): the FULL-AREA mode is for grouped cards only;
// md renders and file browsers NEVER take the full area — they appear inside a
// SPLIT layout. Here that means:
//   skill    → FileExplorer rooted at skills/<name>/          (left files, right md)
//   agent    → FileExplorer rooted at agents/, initial = <name>.md
//   command  → FileExplorer rooted at commands/, initial = <name>.md
//   mcp/hook → definition JSON (exception: a config blob with no dir to browse)
//   lsp/monitor → name only
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft } from '@element-plus/icons-vue';
import { api } from '../api';
import FileExplorer from '../components/FileExplorer.vue';
import { useTool } from '../stores/tool';
import type { ComponentKind } from '../types/tool';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { tool } = useTool();

const name = computed(() => String(route.params.name ?? ''));
const kind = computed(() => route.params.kind as ComponentKind);
const item = computed(() => String(route.params.item ?? ''));

const VALID_KINDS: ComponentKind[] = ['skill', 'command', 'agent', 'hook', 'mcp', 'lsp', 'monitor', 'tool', 'persona', 'group'];

const KIND_LABELS: Record<ComponentKind, string> = {
	skill: 'plugin.kindSkill',
	command: 'plugin.kindCommand',
	agent: 'plugin.kindAgent',
	hook: 'plugin.kindHook',
	mcp: 'plugin.kindMcp',
	lsp: 'plugin.kindLsp',
	monitor: 'plugin.kindMonitor',
	tool: 'plugin.kindTool',
	persona: 'plugin.kindPersona',
	group: 'plugin.kindGroup',
};

type CompView = 'explorer' | 'json' | 'name-only';
const view = computed<CompView>(() => {
	switch (kind.value) {
		case 'skill':
		case 'agent':
		case 'command': return 'explorer';
		case 'mcp':
		case 'hook':
		case 'tool':
		case 'persona':
		case 'group': return 'json';
		default: return 'name-only';
	}
});

/** Directory (plugin-root-relative) the file browser is rooted at. */
const explorerRoot = computed(() => {
	switch (kind.value) {
		case 'skill': return `skills/${item.value}`;
		case 'agent': return 'agents';
		case 'command': return 'commands';
		default: return '';
	}
});

/** The file to auto-select (agent/command: the exact .md that was clicked). */
const initialFile = computed(() => (kind.value === 'agent' || kind.value === 'command' ? `${item.value}.md` : undefined));

/** Root label for the explorer breadcrumb: the skill's own dir, or the kind dir. */
const rootLabel = computed(() => (kind.value === 'skill' ? item.value : `${kind.value}s`));

/** Join the explorer root with a subpath. */
function withRoot(sp: string): string {
	return `${explorerRoot.value}${sp ? '/' + sp : ''}`;
}

const compJson = ref<string | null>(null);
const loading = ref(false);
/** True when the component's content dir/file doesn't exist in the plugin install dir
 *  (e.g. manifest-declared but not shipped, or a URL pointing at the wrong plugin). */
const missing = ref(false);
const missingDesc = ref<string | null>(null);

async function load(): Promise<void> {
	if (!VALID_KINDS.includes(kind.value)) {
		router.replace(`/plugins/${encodeURIComponent(name.value)}`);
		return;
	}
	compJson.value = null;
	missing.value = false;
	missingDesc.value = null;
	loading.value = true;
	try {
		if (view.value === 'explorer') {
			// Existence pre-check: a 404 here means the dir isn't shipped (manifest-only
			// component, or a URL naming the wrong plugin) — show a friendly empty state
			// instead of a half-blank explorer.
			try {
				await api.listPluginFiles(name.value, explorerRoot.value, null, tool.value);
			} catch {
				missing.value = true;
				try {
					const d = await api.getPluginDetail(name.value, null, tool.value);
					missingDesc.value = d.components.find((c) => c.kind === kind.value && c.name === item.value)?.detail ?? null;
				} catch { /* plugin itself unknown — generic message stays */ }
				return;
			}
		} else if (view.value === 'json') {
			if (kind.value === 'tool' || kind.value === 'persona' || kind.value === 'group') {
				// DSH composition row: the config JSON lives on the component itself.
				const d = await api.getPluginDetail(name.value, null, tool.value);
				const comp = d.components.find((x) => x.kind === kind.value && x.name === item.value);
				compJson.value = comp?.configJson ?? null;
				return;
			}
			// mcp → plugin-root .mcp.json 的 mcpServers[name]；hook → hooks/hooks.json，
			// 形态兼容两种：{hooks:{事件:…}}（Claude 插件约定）或直接 {事件:…}
			const file = kind.value === 'mcp' ? '.mcp.json' : 'hooks/hooks.json';
			const res = await api.readPluginFile(name.value, file, null, tool.value);
			const parsed = JSON.parse(res.raw) as Record<string, unknown>;
			const map = (kind.value === 'hook' && parsed['hooks'] && typeof parsed['hooks'] === 'object'
				? parsed['hooks']
				: parsed) as Record<string, unknown>;
			const def = map[item.value];
			compJson.value = def ? JSON.stringify(def, null, 2) : null;
		}
	} finally {
		loading.value = false;
	}
}

function back(): void {
	router.push(`/plugins/${encodeURIComponent(name.value)}`);
}

watch(tool, () => router.replace('/plugins'));
watch([kind, item], load);
onMounted(load);
</script>

<template>
  <div class="detail-panel">
    <div class="detail-toolbar">
      <el-button text size="small" :icon="ArrowLeft" @click="back">{{ t('plugin.backToCards') }}</el-button>
      <span class="comp-detail-title">{{ item }}</span>
      <el-tag size="small" type="info">{{ t(KIND_LABELS[kind]) }}</el-tag>
    </div>

    <div v-if="loading" v-loading="true" class="state" style="min-height: 120px" />

    <!-- Component content missing (manifest-only declaration, or wrong-plugin URL) -->
    <el-empty v-else-if="missing" :description="missingDesc || t('plugin.componentMissing')">
      <el-button type="primary" @click="back">{{ t('plugin.backToCards') }}</el-button>
    </el-empty>

    <!-- skill/agent/command: split — left file browser, right md preview.
         :key remounts the explorer on any in-place param change (browser
         back/forward) — its internal cwd/selection must not leak across
         different plugin/kind/item targets. -->
    <FileExplorer
      v-else-if="view === 'explorer'"
      :key="`${name}/${kind}/${item}`"
      :root-label="rootLabel"
      :initial-file="initialFile"
      :list-fn="(sp: string) => api.listPluginFiles(name, withRoot(sp), null, tool)"
      :read-fn="(sp: string) => api.readPluginFile(name, withRoot(sp), null, tool)"
    />

    <!-- mcp/hook: pretty-printed definition JSON -->
    <div v-else-if="view === 'json'" class="comp-detail-body">
      <pre v-if="compJson" class="json-block">{{ compJson }}</pre>
      <div v-else class="state">{{ t('plugin.noDefinition') }}</div>
    </div>

    <!-- lsp/monitor: name only -->
    <div v-else class="comp-detail-body">
      <div class="comp-name-only">
        <p class="comp-name-only-hint">{{ item }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  padding: 16px 24px;
}
.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.comp-detail-title {
  font-size: 14px;
  font-weight: 600;
  font-family: 'Consolas', 'Monaco', monospace;
}
.comp-detail-body {
  flex: 1;
  overflow: auto;
}
.json-block {
  margin: 0;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--el-fill-color-darker);
  color: var(--el-text-color-regular);
  padding: 12px;
  border-radius: 6px;
}
.comp-name-only {
  text-align: center;
  padding: 40px 16px;
}
.comp-name-only-hint {
  font-size: 16px;
  font-weight: 500;
  margin: 0 0 8px;
}
.state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px;
}
</style>
