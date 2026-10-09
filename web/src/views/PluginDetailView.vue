<script setup lang="ts">
// Plugin detail — grouped component card wall (level 1). Route-driven:
// /plugins/:name. Cards navigate to /plugins/:name/:kind/:item; the toolbar's
// file-browser button switches to /plugins/:name/files (FileExplorer mode).
import { computed, onActivated, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, FolderOpened } from '@element-plus/icons-vue';
import { api } from '../api';
import { useTool } from '../stores/tool';
import type { ComponentKind, PluginComponent, PluginDetail } from '../types/tool';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { tool } = useTool();

const name = computed(() => String(route.params.name ?? ''));
const detailData = ref<PluginDetail | null>(null);
const loading = ref(true);

/** Group display order: the resource-page-backed kinds first, then the light ones. */
const GROUP_ORDER: ComponentKind[] = ['skill', 'mcp', 'agent', 'command', 'persona', 'group', 'tool', 'hook', 'lsp'];

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

/** Non-empty component groups, in display order. */
const componentGroups = computed<[ComponentKind, PluginComponent[]][]>(() => {
	const all = detailData.value?.components ?? [];
	return GROUP_ORDER
		.map((k) => [k, all.filter((c) => c.kind === k)] as [ComponentKind, PluginComponent[]])
		.filter(([, list]) => list.length > 0);
});

/** Monotonic sequence: when two loads overlap, only the newest may write state. */
let loadSeq = 0;

async function load() {
	const seq = ++loadSeq;
	loading.value = true;
	detailData.value = null;
	try {
		const d = await api.getPluginDetail(name.value, null, tool.value);
		if (seq !== loadSeq) return; // superseded by a newer navigation
		detailData.value = d;
		// DSH presets (Phase A) have no parsed components — land directly in the
		// file browser so the composition YAML is immediately viewable.
		if (d.components.length === 0) {
			router.replace(`/plugins/${encodeURIComponent(name.value)}/files`);
		}
	} catch {
		if (seq !== loadSeq) return;
		router.replace('/plugins');
	} finally {
		if (seq === loadSeq) loading.value = false;
	}
}

function shortName(full: string): string {
	const at = full.lastIndexOf('@');
	return at > 0 ? full.slice(0, at) : full;
}

function openComponent(c: PluginComponent): void {
	router.push(`/plugins/${encodeURIComponent(name.value)}/${c.kind}/${encodeURIComponent(c.name)}`);
}

async function openInExplorer(): Promise<void> {
	try {
		await api.openPluginInExplorer(name.value, null, tool.value);
	} catch {
		// best-effort
	}
}

// Tool switch → the plugin may not exist under the other tool; fall back to the list.
watch(tool, () => router.replace('/plugins'));

// keep-alive contract: App.vue caches this view, so the instance survives route
// round-trips and onMounted would never re-fire. Without re-loading, a cached
// instance re-rendered for another /plugins/:name shows the PREVIOUS plugin's
// content — or a blank panel when the cached load had failed (detailData=null).
//   onActivated → covers every list→detail re-entry (and the initial mount,
//                 which counts as an activation inside keep-alive);
//   watch(name) → covers in-place param changes the activation misses
//                 (browser back/forward between two plugin details).
// The route-name guard keeps the tool-switch replace('/plugins') from firing a
// doomed load with an empty name.
onActivated(load);
watch(name, () => {
	if (route.name === 'plugin-detail') load();
});
</script>

<template>
  <div class="detail-panel">
    <div class="detail-toolbar">
      <el-button text :icon="ArrowLeft" @click="router.push('/plugins')">{{ t('plugin.backToList') }}</el-button>
      <span v-if="detailData" class="detail-plugin-info">
        <span class="detail-plugin-name">{{ shortName(detailData.name) }}</span>
        <el-tag v-if="detailData.version" size="small" type="info">v{{ detailData.version }}</el-tag>
      </span>
      <span v-if="detailData?.description" class="detail-desc" :title="detailData.description">{{ detailData.description }}</span>
      <el-button
        v-if="detailData"
        text
        :icon="FolderOpened"
        size="small"
        @click="router.push(`/plugins/${encodeURIComponent(name)}/files`)"
      >{{ t('plugin.fileBrowser') }}</el-button>
      <el-button v-if="detailData" text :icon="FolderOpened" size="small" class="open-btn" @click="openInExplorer">{{ t('plugin.openInExplorer') }}</el-button>
    </div>

    <div v-if="loading" v-loading="true" class="state" style="min-height: 120px" />

    <template v-else-if="detailData">
      <section v-for="[kind, list] in componentGroups" :key="kind" class="group comp-group">
        <div class="group-head">
          <h2 class="group-title">{{ t(KIND_LABELS[kind]) }}（{{ list.length }}）</h2>
        </div>
        <div class="card-grid">
          <div
            v-for="c in list"
            :key="kind + '/' + c.name"
            class="comp-card"
            @click="openComponent(c)"
          >
            <div class="comp-card-name">{{ c.name }}</div>
            <div v-if="c.detail" class="comp-card-desc" :title="c.detail">{{ c.detail }}</div>
          </div>
        </div>
      </section>
      <el-empty
        v-if="componentGroups.length === 0"
        :description="t('plugin.noComponents')"
        :image-size="80"
      />
    </template>
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
  overflow-y: auto;
}
.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-shrink: 0;
}
.detail-plugin-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.detail-plugin-name {
  font-size: 15px;
  font-weight: 600;
}
.detail-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40vw;
}
.open-btn {
  margin-left: auto;
}
.group {
  margin-bottom: 24px;
}
.group-head {
  margin-bottom: 8px;
}
.group-title {
  margin: 0;
  font-size: 12px;
  font-weight: normal;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.card-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
.comp-card {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  min-height: 52px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s;
}
.comp-card:hover {
  background: var(--el-fill-color-light);
  border-color: var(--el-color-primary-light-5);
}
.comp-card-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comp-card-desc {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px;
}
</style>
