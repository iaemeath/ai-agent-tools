<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { FolderOpened, EditPen } from '@element-plus/icons-vue';
import { api } from '../api';
import { useTool } from '../stores/tool';
import { useDragOrder } from '../composables/useDragOrder';
import MarkdownView from '../components/MarkdownView.vue';
import type { CommandInfo } from '../types/tool';

const { t } = useI18n();
const { tool } = useTool();

const items = ref<CommandInfo[]>([]);
const errorMsg = ref<string | null>(null);
const loading = ref(true);

const selected = ref<CommandInfo | null>(null);
const raw = ref('');
const contentLoading = ref(false);

// Edit mode (view ↔ edit).
const editing = ref(false);
const editRaw = ref('');
const saving = ref(false);

// Resizable splitter: left pane width in px.
const leftWidth = ref(0);
const dragging = ref(false);

// Drag-to-reorder — logic lives in the reusable composable; this view only
// supplies the resource key ('commands-order') and page-specific grouping data.
const drag = useDragOrder('commands-order');
const { dragPath, dragOverPath } = drag;

async function reload() {
	errorMsg.value = null;
	loading.value = true;
	selected.value = null;
	raw.value = '';
	try {
		items.value = await api.listCommands(tool.value);
		// Auto-select the first global command for immediate content.
		const g = globalItems.value.find((i) => i.scope === 'global');
		if (g) await selectCommand(g);
	} catch (e) {
		errorMsg.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

async function selectCommand(r: CommandInfo) {
	editing.value = false;
	selected.value = r;
	raw.value = '';
	contentLoading.value = true;
	try {
		const res = await api.readCommand(r.path, tool.value);
		raw.value = res.raw;
	} catch (e) {
		raw.value = '```\n' + (e as Error).message + '\n```';
	} finally {
		contentLoading.value = false;
	}
}

async function openInExplorer(path: string) {
	try {
		await api.openCommandInExplorer(path, tool.value);
	} catch {
		// best-effort — file manager open is non-critical
	}
}

// ---- Edit mode ----
const dirty = computed(() => editRaw.value !== raw.value);
function startEdit() {
	editRaw.value = raw.value;
	editing.value = true;
}
function cancelEdit() {
	editing.value = false;
}
async function save() {
	const r = selected.value;
	if (!r) return;
	saving.value = true;
	try {
		await api.saveCommand(r.path, editRaw.value, tool.value);
		raw.value = editRaw.value;
		editing.value = false;
		ElMessage.success(t('command.saved'));
	} catch (e) {
		ElMessage.error((e as Error).message);
	} finally {
		saving.value = false;
	}
}

/** Drop wrapper: supplies the group's current path[] (page-specific data) to the composable. */
function dropAt(e: DragEvent, groupKey: string, targetPath: string) {
	drag.onDrop(e, groupKey, targetPath, groupCurrentPaths(groupKey));
}
/** Current path[] order of a group, read from the sorted computed (basis for reorder). */
function groupCurrentPaths(groupKey: string): string[] {
	if (groupKey === 'global') return globalItems.value.map((i) => i.path);
	const proj = groupKey.slice('project:'.length);
	const group = projectGroups.value.find(([p]) => p === proj);
	return group ? group[1].map((i) => i.path) : [];
}

onMounted(async () => {
	// Initial left width: 30% of viewport, clamped to [260, 40%].
	leftWidth.value = Math.min(window.innerWidth * 0.4, Math.max(260, window.innerWidth * 0.3));
	drag.loadOrder();
	await reload();
	window.addEventListener('ccc-ui:reload', reload);
	window.addEventListener('ccc-ui:tool-change', reload);
	window.addEventListener('mousemove', onDrag);
	window.addEventListener('mouseup', stopDrag);
});
onUnmounted(() => {
	window.removeEventListener('ccc-ui:reload', reload);
	window.removeEventListener('ccc-ui:tool-change', reload);
	window.removeEventListener('mousemove', onDrag);
	window.removeEventListener('mouseup', stopDrag);
});

// ---- Grouping (sorted by saved drag order) ----

const globalItems = computed(() =>
	drag.sortByOrder(items.value.filter((i) => i.scope === 'global'), drag.orderMap.value['global'] ?? [], (r) => r.path),
);
const projectGroups = computed<[string, CommandInfo[]][]>(() => {
	const map = new Map<string, CommandInfo[]>();
	for (const i of items.value.filter((i) => i.scope === 'project')) {
		const key = i.project ?? '?';
		if (!map.has(key)) map.set(key, []);
		map.get(key)!.push(i);
	}
	return [...map.entries()].map(([proj, list]) => [
		proj,
		drag.sortByOrder(list, drag.orderMap.value['project:' + proj] ?? [], (r) => r.path),
	]) as [string, CommandInfo[]][];
});

function projectBasename(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
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
  <div class="commands-view">
    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <el-alert v-else-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <div v-else-if="items.length === 0" class="state empty-state">{{ t('command.empty') }}</div>

    <div v-else class="split-layout">
      <!-- Left: grouped file list (draggable cards) -->
      <div class="pane pane-left" :style="{ width: leftWidth + 'px', flexShrink: 0 }">
        <div class="pane-header">
          <span class="pane-title">{{ t('nav.commands') }}</span>
          <span class="pane-meta">{{ items.length }}</span>
        </div>
        <div class="pane-body list-body">
          <!-- Global group -->
          <div class="group-label">🌐 {{ t('command.groupGlobal') }}</div>
          <div v-if="globalItems.length === 0" class="state small">{{ t('command.empty') }}</div>
          <div v-else class="card-grid">
            <div
              v-for="r in globalItems"
              :key="r.path"
              class="item-card"
              :class="{ selected: selected?.path === r.path, dragging: dragPath === r.path, 'drag-over': dragOverPath === r.path && dragPath !== r.path }"
              draggable="true"
              @dragstart="drag.onDragStart($event, r.path)"
              @dragover="drag.onDragOver($event, r.path)"
              @drop="dropAt($event, 'global', r.path)"
              @dragend="drag.onDragEnd"
              @click="selectCommand(r)"
            >
              <div class="item-name">{{ r.name }}</div>
              <div v-if="r.description" class="item-desc" :title="r.description">{{ r.description }}</div>
              <div class="item-meta">{{ r.lineCount }} {{ t('command.lines') }}</div>
            </div>
          </div>

          <!-- Project groups -->
          <template v-for="[proj, list] in projectGroups" :key="proj">
            <div class="group-label">📁 {{ projectBasename(proj) }}</div>
            <div class="card-grid">
              <div
                v-for="r in list"
                :key="r.path"
                class="item-card"
                :class="{ selected: selected?.path === r.path, dragging: dragPath === r.path, 'drag-over': dragOverPath === r.path && dragPath !== r.path }"
                draggable="true"
                @dragstart="drag.onDragStart($event, r.path)"
                @dragover="drag.onDragOver($event, r.path)"
                @drop="dropAt($event, 'project:' + proj, r.path)"
                @dragend="drag.onDragEnd"
                @click="selectCommand(r)"
              >
                <div class="item-name">{{ r.name }}</div>
                <div v-if="r.description" class="item-desc" :title="r.description">{{ r.description }}</div>
                <div class="item-meta">{{ r.lineCount }} {{ t('command.lines') }}</div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Splitter -->
      <div class="splitter" :class="{ active: dragging }" @mousedown="startDrag">
        <div class="splitter-handle"></div>
      </div>

      <!-- Right: content -->
      <div class="pane pane-right">
        <template v-if="selected">
          <div class="pane-header">
            <div class="pane-header-row">
              <span class="pane-title">{{ selected.name }}</span>
              <span class="pane-meta">{{ selected.lineCount }} {{ t('command.lines') }}</span>
              <div class="header-actions">
                <template v-if="editing">
                  <span v-if="dirty" class="dirty-hint">{{ t('command.unsaved') }}</span>
                  <el-button size="small" @click="cancelEdit">{{ t('command.cancel') }}</el-button>
                  <el-button size="small" type="primary" :loading="saving" @click="save">{{ t('command.save') }}</el-button>
                </template>
                <el-button v-else size="small" :icon="EditPen" @click="startEdit">{{ t('command.edit') }}</el-button>
                <el-button text :icon="FolderOpened" size="small" @click="openInExplorer(selected.path)">
                  {{ t('command.openInExplorer') }}
                </el-button>
              </div>
            </div>
            <div class="pane-path clickable" :title="selected.path" @click="openInExplorer(selected.path)">{{ selected.path }}</div>
          </div>
          <div class="pane-body">
            <div v-if="contentLoading" class="state">{{ t('common.loading') }}</div>
            <div v-else-if="editing" class="edit-mode">
              <el-input type="textarea" v-model="editRaw" class="md-textarea" resize="none" />
            </div>
            <MarkdownView v-else :raw="raw" />
          </div>
        </template>
        <div v-else class="state center">{{ t('command.noSelection') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.commands-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px;
}
.state.small {
  padding: 8px 16px;
  font-size: 12px;
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
.pane-path {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pane-path.clickable {
  cursor: pointer;
}
.pane-path.clickable:hover {
  color: var(--el-color-primary);
  text-decoration: underline;
}
.pane-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.list-body {
  padding: 8px;
}
.open-btn {
  margin-left: auto;
}

/* ---- Item cards (draggable grid items) ---- */
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
  grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
  padding: 4px 8px 8px;
}
.item-card {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.item-card:hover {
  background: var(--el-fill-color-light);
}
.item-card.selected {
  background: var(--el-color-primary-light-9);
}
.item-card.dragging {
  opacity: 0.4;
}
.item-card.drag-over {
  border-color: var(--el-color-primary);
  border-style: dashed;
}
.item-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-desc {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-meta {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  margin-top: 2px;
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

/* ---- Edit mode ---- */
.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.edit-mode {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.dirty-hint {
  font-size: 12px;
  color: var(--el-color-warning);
}
.md-textarea {
  flex: 1;
  min-height: 0;
}
.md-textarea :deep(.el-textarea__inner) {
  height: 100%;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
}
</style>
