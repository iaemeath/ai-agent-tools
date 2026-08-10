<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import MarkdownView from './MarkdownView.vue';
import type { ToolId } from '../types/tool';

interface Entry { name: string; isDir: boolean }
interface FileResult { name: string; raw: string; ext: string }
interface DirResult { entries: Entry[]; root: string }

const props = defineProps<{
	/** Root label shown as the breadcrumb root. */
	rootLabel: string;
	/** Function to list a directory (subpath relative to root). Required. */
	listFn: (subpath: string) => Promise<DirResult>;
	/** Function to read a file (subpath relative to root). Required. */
	readFn: (subpath: string) => Promise<FileResult>;
}>();

const { t } = useI18n();

// Current directory relative to root. '' = root.
const currentPath = ref('');
const entries = ref<Entry[]>([]);
const dirLoading = ref(false);
const dirError = ref<string | null>(null);

// Selected file state.
const selectedFile = ref<string | null>(null);
const fileContent = ref('');
const fileExt = ref('');
const fileLoading = ref(false);
const fileError = ref<string | null>(null);

// Breadcrumb segments derived from currentPath.
const breadcrumbs = computed(() => {
	const segs = currentPath.value.split('/').filter(Boolean);
	return [
		{ label: props.rootLabel, path: '' },
		...segs.map((s, i) => ({ label: s, path: segs.slice(0, i + 1).join('/') })),
	];
});

async function loadDir() {
	dirLoading.value = true;
	dirError.value = null;
	try {
		const res = await props.listFn(currentPath.value);
		entries.value = res.entries;
		if (!selectedFile.value) {
			const firstMd = res.entries.find((e) => !e.isDir && e.name.endsWith('.md'));
			if (firstMd) {
				const fp = currentPath.value ? `${currentPath.value}/${firstMd.name}` : firstMd.name;
				await loadFile(fp);
			}
		}
	} catch (e) {
		dirError.value = (e as Error).message;
		entries.value = [];
	} finally {
		dirLoading.value = false;
	}
}

async function loadFile(relPath: string) {
	selectedFile.value = relPath;
	fileContent.value = '';
	fileExt.value = '';
	fileError.value = null;
	fileLoading.value = true;
	try {
		const res = await props.readFn(relPath);
		fileContent.value = res.raw;
		fileExt.value = res.ext;
	} catch (e) {
		fileError.value = (e as Error).message;
	} finally {
		fileLoading.value = false;
	}
}

async function openEntry(e: Entry) {
	const rel = currentPath.value ? `${currentPath.value}/${e.name}` : e.name;
	if (e.isDir) {
		selectedFile.value = null;
		currentPath.value = rel;
		await loadDir();
	} else {
		await loadFile(rel);
	}
}

async function goToBreadcrumb(targetPath: string) {
	if (targetPath === currentPath.value) return;
	selectedFile.value = null;
	currentPath.value = targetPath;
	await loadDir();
}

function entryIcon(e: Entry): string {
	return e.isDir ? '📁' : fileIcon(e.name);
}
function fileIcon(name: string): string {
	if (name.endsWith('.md')) return '📘';
	if (name.endsWith('.json')) return '📄';
	if (name.endsWith('.mjs') || name.endsWith('.js')) return '📜';
	return '📄';
}

// Load root on mount + when listFn identity changes (e.g. switching skill/plugin).
watch(
	() => props.listFn,
	async () => {
		currentPath.value = '';
		selectedFile.value = null;
		await loadDir();
	},
	{ immediate: true },
);

const isMarkdown = computed(() => fileExt.value === '.md');

// ---- Draggable splitter ----
const leftWidth = ref(280);
const dragging = ref(false);

function startDrag(e: MouseEvent) {
	e.preventDefault();
	dragging.value = true;
}
function onDrag(e: MouseEvent) {
	if (!dragging.value) return;
	const min = 180;
	const max = window.innerWidth * 0.6;
	leftWidth.value = Math.min(max, Math.max(min, e.clientX));
}
function stopDrag() {
	dragging.value = false;
}

onMounted(() => {
	window.addEventListener('mousemove', onDrag);
	window.addEventListener('mouseup', stopDrag);
});
onUnmounted(() => {
	window.removeEventListener('mousemove', onDrag);
	window.removeEventListener('mouseup', stopDrag);
});
</script>

<template>
  <div class="file-explorer">
    <!-- Left: directory browser -->
    <div class="fe-left" :style="{ width: leftWidth + 'px', flexShrink: 0 }">
      <!-- Breadcrumb -->
      <div class="fe-breadcrumb">
        <template v-for="(crumb, i) in breadcrumbs" :key="crumb.path">
          <span v-if="i > 0" class="crumb-sep">/</span>
          <span class="crumb" :class="{ active: i === breadcrumbs.length - 1 }" @click="goToBreadcrumb(crumb.path)">
            {{ crumb.label }}
          </span>
        </template>
      </div>

      <div v-if="dirLoading" class="fe-state">{{ t('common.loading') }}</div>
      <div v-else-if="dirError" class="fe-state fe-error">{{ dirError }}</div>
      <div v-else-if="entries.length === 0" class="fe-state">{{ t('plugin.emptyDir') }}</div>
      <ul v-else class="fe-list">
        <li
          v-for="e in entries"
          :key="e.name"
          class="fe-item"
          :class="{ selected: !e.isDir && selectedFile === (currentPath ? currentPath + '/' + e.name : e.name) }"
          @click="openEntry(e)"
        >
          <span class="fe-icon">{{ entryIcon(e) }}</span>
          <span class="fe-name" :title="e.name">{{ e.name }}</span>
        </li>
      </ul>
    </div>

    <!-- Draggable splitter -->
    <div class="fe-splitter" :class="{ active: dragging }" @mousedown="startDrag">
      <div class="fe-splitter-handle"></div>
    </div>

    <!-- Right: file content preview -->
    <div class="fe-right">
      <div v-if="fileLoading" class="fe-state">{{ t('common.loading') }}</div>
      <div v-else-if="fileError" class="fe-state fe-error">{{ fileError }}</div>
      <div v-else-if="!selectedFile" class="fe-state">{{ t('plugin.selectFileHint') }}</div>
      <div v-else class="fe-content">
        <div class="fe-content-header">{{ selectedFile.split('/').pop() }}</div>
        <div class="fe-content-body">
          <MarkdownView v-if="isMarkdown" :raw="fileContent" />
          <pre v-else class="fe-pre">{{ fileContent }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-explorer {
  display: flex;
  border-radius: 8px;
  overflow: hidden;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--el-border-color-lighter);
}
.fe-left {
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.fe-splitter {
  flex: 0 0 5px;
  cursor: col-resize;
  background: var(--el-border-color-lighter);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.fe-splitter:hover,
.fe-splitter.active {
  background: var(--el-color-primary-light-7);
}
.fe-splitter-handle {
  width: 2px;
  height: 32px;
  background: var(--el-border-color);
  border-radius: 1px;
}
.fe-splitter.active .fe-splitter-handle {
  background: var(--el-color-primary);
}
.fe-right {
  flex: 1;
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.fe-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
}
.crumb {
  color: var(--el-color-primary);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
}
.crumb:hover {
  background: var(--el-fill-color-light);
}
.crumb.active {
  color: var(--el-text-color-primary);
  font-weight: 500;
  cursor: default;
}
.crumb.active:hover {
  background: transparent;
}
.crumb-sep {
  color: var(--el-text-color-placeholder);
}
.fe-state {
  padding: 24px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  text-align: center;
}
.fe-error {
  color: var(--el-color-danger);
}
.fe-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  flex: 1;
}
.fe-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.fe-item:hover {
  background: var(--el-fill-color-light);
}
.fe-item.selected {
  background: var(--el-color-primary-light-9);
}
.fe-icon {
  flex-shrink: 0;
  font-size: 14px;
}
.fe-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fe-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.fe-content-header {
  padding: 8px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
  font-weight: 500;
  font-family: 'Consolas', 'Monaco', monospace;
  background: var(--el-fill-color-blank);
}
.fe-content-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}
.fe-pre {
  margin: 0;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--el-text-color-primary);
}
</style>
