<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FolderOpened } from '@element-plus/icons-vue';
import { api } from '../api';
import { useTool } from '../stores/tool';
import { useDragOrder } from '../composables/useDragOrder';
import type { HookInfo } from '../types/tool';

const { t } = useI18n();
const { tool } = useTool();

const items = ref<HookInfo[]>([]);
const errorMsg = ref<string | null>(null);
const loading = ref(true);

const selected = ref<HookInfo | null>(null);

// Resizable splitter: left pane width in px.
const leftWidth = ref(0);
const dragging = ref(false);

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
	window.addEventListener('ai-agent-tools:reload', reload);
	window.addEventListener('ai-agent-tools:tool-change', reload);
	window.addEventListener('mousemove', onDrag);
	window.addEventListener('mouseup', stopDrag);
});
onUnmounted(() => {
	window.removeEventListener('ai-agent-tools:reload', reload);
	window.removeEventListener('ai-agent-tools:tool-change', reload);
	window.removeEventListener('mousemove', onDrag);
	window.removeEventListener('mouseup', stopDrag);
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

// ---- Splitter drag (delta mode — avoids sidebar-offset jump) ----
let dragStartX = 0;
let dragStartWidth = 0;
function startDrag(e: MouseEvent) {
	e.preventDefault();
	dragging.value = true;
	dragStartX = e.clientX;
	dragStartWidth = leftWidth.value;
}
function onDrag(e: MouseEvent) {
	if (!dragging.value) return;
	const min = 240;
	const max = window.innerWidth * 0.6;
	leftWidth.value = Math.min(max, Math.max(min, dragStartWidth + (e.clientX - dragStartX)));
}
function stopDrag() {
	dragging.value = false;
}
</script>

<template>
  <div class="hooks-view">
    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <el-alert v-else-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <div v-else-if="items.length === 0" class="state empty-state">{{ t('hook.empty') }}</div>

    <div v-else class="split-layout">
      <!-- Left: hooks grouped by event (draggable cards) -->
      <div class="pane pane-left" :style="{ width: leftWidth + 'px', flexShrink: 0 }">
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

      <!-- Splitter -->
      <div class="splitter" :class="{ active: dragging }" @mousedown="startDrag">
        <div class="splitter-handle"></div>
      </div>

      <!-- Right: structured detail (NOT markdown — hooks have fields, not file content) -->
      <div class="pane pane-right">
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
            <div class="detail-row">
              <span class="detail-label">{{ t('hook.command') }}</span>
              <code class="detail-code">{{ selected.command }}</code>
            </div>
            <div class="detail-row">
              <span class="detail-label">{{ t('hook.type') }}</span>
              <span class="detail-value">{{ selected.type }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">{{ t('hook.timeout') }}</span>
              <span class="detail-value">{{ selected.timeout ?? '—' }}</span>
            </div>
            <div v-if="selected.statusMessage" class="detail-row">
              <span class="detail-label">{{ t('hook.statusMessage') }}</span>
              <span class="detail-value">{{ selected.statusMessage }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">{{ t('hook.event') }}</span>
              <span class="detail-value">{{ selected.event }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">{{ t('hook.matcher') }}</span>
              <code class="detail-value">{{ selected.matcher }}</code>
            </div>
            <div class="detail-row">
              <span class="detail-label">{{ t('mcp.scope') }}</span>
              <span class="detail-value">{{ scopeLabel(selected) }}<span v-if="selected.project"> · {{ selected.project }}</span></span>
            </div>
            <div class="detail-row">
              <span class="detail-label">{{ t('hook.sourceFile') }}</span>
              <span class="detail-value detail-path clickable" :title="selected.sourceFile" @click="openInExplorer(selected.sourceFile)">{{ selected.sourceFile }}</span>
            </div>
          </div>
        </template>
        <div v-else class="state center">{{ t('hook.noSelection') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hooks-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px;
}
.state.center {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.empty-state {
  padding: 40px 16px;
  text-align: center;
}

/* ---- Split layout ---- */
.split-layout {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}
.pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.pane-left {
  border-right: none;
}
.pane-right {
  flex: 1;
}
.pane-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 16px;
  border-bottom: var(--el-border-color-light) solid 1px;
  flex-shrink: 0;
}
.pane-header-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.pane-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pane-meta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.hook-matcher-inline {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pane-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.list-body {
  padding: 8px;
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.open-btn {
  margin-left: auto;
}

/* ---- Hook cards (draggable grid items, grouped by event) ---- */
.group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 12px 8px 4px;
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

/* ---- Splitter ---- */
.splitter {
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: var(--el-border-color-lighter);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: background 0.15s;
}
.splitter:hover,
.splitter.active {
  background: var(--el-color-primary-light-5);
}
.splitter-handle {
  width: 3px;
  height: 32px;
  border-radius: 2px;
  background: var(--el-border-color);
}
.splitter:hover .splitter-handle,
.splitter.active .splitter-handle {
  background: var(--el-color-primary);
}
</style>
