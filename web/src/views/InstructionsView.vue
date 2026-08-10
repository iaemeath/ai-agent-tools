<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowLeft } from '@element-plus/icons-vue';
import { api } from '../api';
import { useTool } from '../stores/tool';
import MarkdownView from '../components/MarkdownView.vue';
import type { InstructionInfo } from '../types/tool';

const { t } = useI18n();
const { tool } = useTool();

const items = ref<InstructionInfo[]>([]);
const errorMsg = ref<string | null>(null);
const loading = ref(true);

// Content states.
const globalRaw = ref<string>('');
const globalLoading = ref(false);
const selectedProject = ref<InstructionInfo | null>(null);
const projectRaw = ref<string>('');
const projectLoading = ref(false);

// Resizable splitter: left pane width in px (40% of viewport on mount).
const leftWidth = ref(0);
const dragging = ref(false);

async function reload() {
	errorMsg.value = null;
	loading.value = true;
	selectedProject.value = null;
	projectRaw.value = '';
	try {
		items.value = await api.listInstructions(tool.value);
		// Auto-load global instruction content.
		const g = items.value.find((i) => i.scope === 'global');
		if (g) await loadGlobal(g);
	} catch (e) {
		errorMsg.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

async function loadGlobal(i: InstructionInfo) {
	globalRaw.value = '';
	globalLoading.value = true;
	try {
		const res = await api.readInstruction(i.path, tool.value);
		globalRaw.value = res.raw;
	} catch (e) {
		globalRaw.value = '```\n' + (e as Error).message + '\n```';
	} finally {
		globalLoading.value = false;
	}
}

async function openProject(i: InstructionInfo) {
	selectedProject.value = i;
	projectRaw.value = '';
	projectLoading.value = true;
	try {
		const res = await api.readInstruction(i.path, tool.value);
		projectRaw.value = res.raw;
	} catch (e) {
		projectRaw.value = '```\n' + (e as Error).message + '\n```';
	} finally {
		projectLoading.value = false;
	}
}

function closeProject() {
	selectedProject.value = null;
	projectRaw.value = '';
}

async function openInExplorer(path: string) {
	try {
		await api.openInExplorer(path, tool.value);
	} catch (e) {
		// silent fail — file manager open is best-effort
	}
}

onMounted(async () => {
	// Initial left width: 40% of viewport, clamped to [240, 70%].
	leftWidth.value = Math.min(window.innerWidth * 0.7, Math.max(240, window.innerWidth * 0.4));
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

const projectItems = computed(() => items.value.filter((i) => i.scope === 'project'));
const globalItem = computed(() => items.value.find((i) => i.scope === 'global') ?? null);

function basename(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}
function projectBasename(i: InstructionInfo): string {
	return i.project?.split(/[\\/]/).filter(Boolean).pop() ?? basename(i.path);
}

// ---- Splitter drag ----
function startDrag(e: MouseEvent) {
	e.preventDefault();
	dragging.value = true;
}
function onDrag(e: MouseEvent) {
	if (!dragging.value) return;
	// Clamp: 240px .. 70% of viewport.
	const min = 240;
	const max = window.innerWidth * 0.7;
	leftWidth.value = Math.min(max, Math.max(min, e.clientX));
}
function stopDrag() {
	dragging.value = false;
}
</script>

<template>
  <div class="instructions-view">
    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <el-alert v-else-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <div v-else-if="items.length === 0" class="state">{{ t('instruction.empty') }}</div>

    <div v-else class="split-layout">
      <!-- Left: global instruction (markdown) -->
      <div class="pane pane-left" :style="{ width: leftWidth + 'px', flexShrink: 0 }">
        <div class="pane-header">
          <div class="pane-header-row">
            <span class="pane-title">🌐 {{ globalItem ? basename(globalItem.path) : t('instruction.groupGlobal') }}</span>
            <span v-if="globalItem" class="pane-meta">{{ globalItem.lineCount }} {{ t('instruction.lines') }}</span>
          </div>
          <div v-if="globalItem" class="pane-path clickable" :title="globalItem.path" @click="openInExplorer(globalItem.path)">{{ globalItem.path }}</div>
        </div>
        <div class="pane-body">
          <div v-if="globalLoading" class="state">{{ t('common.loading') }}</div>
          <MarkdownView v-else :raw="globalRaw" />
        </div>
      </div>

      <!-- Draggable splitter -->
      <div class="splitter" :class="{ active: dragging }" @mousedown="startDrag">
        <div class="splitter-handle"></div>
      </div>

      <!-- Right: project instructions -->
      <div class="pane pane-right">
        <!-- Card grid mode -->
        <template v-if="!selectedProject">
          <div class="pane-header">
            <span class="pane-title">{{ t('instruction.groupProject') }}</span>
            <span class="pane-meta">{{ projectItems.length }}</span>
          </div>
          <div class="pane-body">
            <div v-if="projectItems.length === 0" class="state">{{ t('instruction.noProject') }}</div>
            <div v-else class="card-grid">
              <el-card
                v-for="i in projectItems"
                :key="i.path"
                class="proj-card"
                shadow="hover"
                body-style="padding: 14px;"
                @click="openProject(i)"
              >
                <div class="card-name">📁 {{ projectBasename(i) }}</div>
                <div class="card-path" :title="i.path">{{ i.path }}</div>
                <div class="card-meta">
                  <el-tag size="small" type="info">{{ i.lineCount }} {{ t('instruction.lines') }}</el-tag>
                </div>
              </el-card>
            </div>
          </div>
        </template>

        <!-- Content mode: show selected project's markdown -->
        <template v-else>
          <div class="pane-header">
            <div class="pane-header-row">
              <el-button text :icon="ArrowLeft" @click="closeProject">{{ t('instruction.backToList') }}</el-button>
              <span class="pane-title">📁 {{ projectBasename(selectedProject) }}</span>
              <span class="pane-meta">{{ selectedProject.lineCount }} {{ t('instruction.lines') }}</span>
            </div>
            <div class="pane-path clickable" :title="selectedProject.path" @click="openInExplorer(selectedProject.path)">{{ selectedProject.path }}</div>
          </div>
          <div class="pane-body">
            <div v-if="projectLoading" class="state">{{ t('common.loading') }}</div>
            <MarkdownView v-else :raw="projectRaw" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.instructions-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px;
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
  border-right: none; /* splitter provides the visual */
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
.pane-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
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

/* ---- Project cards ---- */
.card-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}
.proj-card {
  cursor: pointer;
  transition: border-color 0.15s;
}
.proj-card:hover {
  border-color: var(--el-color-primary-light-5);
}
.card-name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-path {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-meta {
  margin-top: 10px;
}
</style>
