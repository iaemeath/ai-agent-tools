<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FolderOpened } from '@element-plus/icons-vue';
import { api } from '../api';
import { useTool } from '../stores/tool';
import { useDragOrder } from '../composables/useDragOrder';
import SplitPane from '../components/SplitPane.vue';
import type { HookInfo } from '../types/tool';

const { t } = useI18n();
const { tool } = useTool();

const items = ref<HookInfo[]>([]);
const errorMsg = ref<string | null>(null);
const loading = ref(true);

const selected = ref<HookInfo | null>(null);

// Resizable split: left pane width in px (drag logic lives in SplitPane).
const leftWidth = ref(0);

// Drag-to-reorder within each event group. Logic lives in the reusable composable;
// this view supplies the resource key ('hooks-order') and page-specific grouping.
const drag = useDragOrder('hooks-order');
const { dragPath, dragOverPath } = drag;

async function reload() {
	errorMsg.value = null;
	loading.value = true;
	selected.value = null;
	try {
		items.value = await api.listHooks(tool.value);
		// Auto-select the first hook for immediate detail.
		const first = eventGroups.value[0]?.[1]?.[0];
		if (first) selected.value = first;
	} catch (e) {
		errorMsg.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

function selectHook(h: HookInfo) {
	selected.value = h;
}

async function openInExplorer(sourceFile: string) {
	try {
		await api.openHookSourceInExplorer(sourceFile, tool.value);
	} catch {
		// best-effort — file manager open is non-critical
	}
}

/** Drop wrapper: supplies the group's current id[] (page-specific data) to the composable. */
function dropAt(e: DragEvent, event: string, targetId: string) {
	drag.onDrop(e, event, targetId, groupCurrentIds(event));
}
/** Current id[] order of an event group, read from the sorted computed (basis for reorder). */
function groupCurrentIds(event: string): string[] {
	const group = eventGroups.value.find(([ev]) => ev === event);
	return group ? group[1].map((h) => h.id) : [];
}

onMounted(async () => {
	// Initial left width: 30% of viewport, clamped to [260, 40%].
	leftWidth.value = Math.min(window.innerWidth * 0.4, Math.max(260, window.innerWidth * 0.3));
	drag.loadOrder();
	await reload();
	window.addEventListener('ai-tools:reload', reload);
	window.addEventListener('ai-tools:tool-change', reload);
});
onUnmounted(() => {
	window.removeEventListener('ai-tools:reload', reload);
	window.removeEventListener('ai-tools:tool-change', reload);
});

// ---- Grouping by event (each group sorted by saved drag order) ----

const eventGroups = computed<[string, HookInfo[]][]>(() => {
	const map = new Map<string, HookInfo[]>();
	for (const h of items.value) {
		if (!map.has(h.event)) map.set(h.event, []);
		map.get(h.event)!.push(h);
	}
	return [...map.entries()].map(([event, list]) => [
		event,
		drag.sortByOrder(list, drag.orderMap.value[event] ?? [], (h) => h.id),
	]) as [string, HookInfo[]][];
});

function scopeLabel(h: HookInfo): string {
	return h.scope === 'global' ? t('hook.scopeGlobal') : t('hook.scopeProject');
}

</script>

<template>
  <div v-loading="loading" class="hooks-view">
    <el-alert v-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <div v-else-if="items.length === 0" class="state empty-state">{{ t('hook.empty') }}</div>

    <SplitPane v-else v-model="leftWidth" :min="240" :max-ratio="0.6">
      <template #left>
      <!-- Left: hooks grouped by event (draggable cards) -->
      <div class="pane">
        <div class="pane-header">
          <span class="pane-title">{{ t('nav.hooks') }}</span>
          <span class="pane-meta">{{ items.length }}</span>
        </div>
        <div class="pane-body list-body">
          <template v-for="[event, list] in eventGroups" :key="event">
            <div class="group-label">⚡ {{ event }}</div>
            <div class="card-grid">
              <div
                v-for="h in list"
                :key="h.id"
                class="hook-card"
                :class="{ selected: selected?.id === h.id, disabled: !h.enabled, dragging: dragPath === h.id, 'drag-over': dragOverPath === h.id && dragPath !== h.id }"
                draggable="true"
                @dragstart="drag.onDragStart($event, h.id)"
                @dragover="drag.onDragOver($event, h.id)"
                @drop="dropAt($event, event, h.id)"
                @dragend="drag.onDragEnd"
                @click="selectHook(h)"
              >
                <div class="hook-matcher" :title="h.matcher">/{{ h.matcher }}/</div>
                <div class="hook-cmd">{{ h.command }}</div>
                <div class="hook-foot">
                  <span class="hook-scope">{{ scopeLabel(h) }}</span>
                  <span v-if="!h.enabled" class="hook-disabled-tag">{{ t('hook.disabled') }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      </template>

      <!-- Right: content -->
      <template #right>

      <!-- Right: structured detail (NOT markdown — hooks have fields, not file content) -->
      <div class="pane">
        <template v-if="selected">
          <div class="pane-header">
            <div class="pane-header-row">
              <span class="pane-title">⚡ {{ selected.event }}</span>
              <span class="hook-matcher-inline">/{{ selected.matcher }}/</span>
              <el-tag v-if="!selected.enabled" size="small" type="info">{{ t('hook.disabled') }}</el-tag>
              <el-button text :icon="FolderOpened" size="small" class="open-btn" @click="openInExplorer(selected.sourceFile)">
                {{ t('hook.openInExplorer') }}
              </el-button>
            </div>
          </div>
          <div class="pane-body detail-body">
          <el-descriptions :column="1" border size="small" class="hook-desc">
            <el-descriptions-item label="{{ t('hook.command') }}"><code class="detail-code">{{ selected.command }}</code></el-descriptions-item>
            <el-descriptions-item label="{{ t('hook.type') }}"><span class="detail-value">{{ selected.type }}</span></el-descriptions-item>
            <el-descriptions-item label="{{ t('hook.timeout') }}"><span class="detail-value">{{ selected.timeout ?? '—' }}</span></el-descriptions-item>
            <el-descriptions-item label="{{ t('hook.event') }}"><span class="detail-value">{{ selected.event }}</span></el-descriptions-item>
            <el-descriptions-item label="{{ t('hook.matcher') }}"><code class="detail-value">{{ selected.matcher }}</code></el-descriptions-item>
            <el-descriptions-item label="{{ t('mcp.scope') }}"><span class="detail-value">{{ scopeLabel(selected) }}<span v-if="selected.project"> · {{ selected.project }}</span></span></el-descriptions-item>
            <el-descriptions-item label="{{ t('hook.sourceFile') }}"><span class="detail-value detail-path clickable" :title="selected.sourceFile" @click="openInExplorer(selected.sourceFile)">{{ selected.sourceFile }}</span></el-descriptions-item>
          </el-descriptions>
          </div>
        </template>
        <el-empty v-else :description="t('hook.noSelection')" />
      </div>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.hooks-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.pane-header-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hook-matcher-inline {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  padding: 4px 8px 8px;
}
.hook-card {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.hook-card:hover {
  background: var(--el-fill-color-light);
}
.hook-card.selected {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}
.hook-card.disabled {
  opacity: 0.55;
}
.hook-card.dragging {
  opacity: 0.4;
}
.hook-card.drag-over {
  border-color: var(--el-color-primary);
  border-style: dashed;
}
.hook-matcher {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  color: var(--el-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hook-cmd {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 11px;
  color: var(--el-text-color-regular);
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}
.hook-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.hook-scope {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
}
.hook-disabled-tag {
  font-size: 10px;
  color: var(--el-color-info);
}

/* ---- Structured detail rows ---- */
.detail-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.detail-value {
  font-size: 13px;
  color: var(--el-text-color-primary);
  word-break: break-all;
}
.detail-code {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  background: var(--el-fill-color-light);
  padding: 8px 10px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--el-text-color-primary);
}
.detail-path {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.detail-path.clickable {
  cursor: pointer;
}
.detail-path.clickable:hover {
  color: var(--el-color-primary);
  text-decoration: underline;
}

</style>
