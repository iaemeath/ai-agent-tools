<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search, ArrowLeft, FolderOpened } from '@element-plus/icons-vue';
import { api } from '../api';
import PluginCard from '../components/PluginCard.vue';
import FileExplorer from '../components/FileExplorer.vue';
import MarkdownView from '../components/MarkdownView.vue';
import { useTool } from '../stores/tool';
import type {
	ComponentKind, PluginComponent, PluginDetail, ProjectInfo, Scope, Status, ToolInstance, ToolOverview,
} from '../types/tool';

const { t } = useI18n();
const { tool } = useTool();

const projects = ref<ProjectInfo[]>([]);
const overview = ref<ToolOverview | null>(null);
const errorMsg = ref<string | null>(null);
const loading = ref(true);

const selected = ref<string | null>(null); // 'user' | project path | null (all)
const search = ref('');

// Inline detail state: when selectedPlugin is set, the list hides and the detail shows.
const selectedPlugin = ref<ToolInstance | null>(null);
const detailData = ref<PluginDetail | null>(null);
const detailLoading = ref(false);

// 'user' or 'all' both resolve to user-level project arg; a project path selects it.
const projectPath = computed(() => (selected.value && selected.value !== 'user' ? selected.value : null));
const isUserScope = computed(() => selected.value === 'user');
const isAllScope = computed(() => selected.value === null);

interface ScopeOption { value: string; label: string; sublabel?: string }

const scopeOptions = computed<ScopeOption[]>(() => [
	...projects.value.map((p) => ({
		value: p.path,
		label: p.path.split('/').filter(Boolean).pop() ?? p.path,
		sublabel: p.path,
	})),
]);

async function reload() {
	errorMsg.value = null;
	try {
		overview.value = await api.getOverview(projectPath.value, tool.value);
	} catch (e) {
		errorMsg.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

async function loadProjects() {
	try {
		projects.value = await api.listProjects(tool.value);
	} catch {
		projects.value = [];
	}
}

/** Tool switched from the header — reset all view state and reload. */
async function onToolChange() {
	selected.value = null;
	search.value = '';
	overview.value = null;
	selectedPlugin.value = null;
	detailData.value = null;
	loading.value = true;
	await loadProjects();
	await reload();
}

onMounted(async () => {
	await loadProjects();
	await reload();
	window.addEventListener('ccc-ui:reload', reload);
	window.addEventListener('ccc-ui:tool-change', onToolChange);
	window.addEventListener('mousemove', onCompDrag);
	window.addEventListener('mouseup', stopCompDrag);
});
onUnmounted(() => {
	window.removeEventListener('ccc-ui:reload', reload);
	window.removeEventListener('ccc-ui:tool-change', onToolChange);
	window.removeEventListener('mousemove', onCompDrag);
	window.removeEventListener('mouseup', stopCompDrag);
});

const allPlugins = computed(() => overview.value?.items.filter((i) => i.kind === 'plugin') ?? []);

const plugins = computed(() => {
	const q = search.value.trim().toLowerCase();
	if (!q) return allPlugins.value;
	return allPlugins.value.filter(
		(p) =>
			p.name.toLowerCase().includes(q) ||
			(p.description ?? '').toLowerCase().includes(q),
	);
});

// Extract marketplace from "name@marketplace"; group plugins by it.
function marketplaceOf(name: string): string {
	const at = name.lastIndexOf('@');
	return at > 0 ? name.slice(at + 1) : '';
}

const marketplaceGroups = computed<[string, ToolInstance[]][]>(() => {
	const map = new Map<string, ToolInstance[]>();
	for (const p of plugins.value) {
		const key = marketplaceOf(p.name) || t('plugin.groupUnknown');
		if (!map.has(key)) map.set(key, []);
		map.get(key)!.push(p);
	}
	return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
});

async function toggleScope(p: ToolInstance, next: Status) {
	const scopeArg: Scope = isUserScope.value || isAllScope.value
		? { level: 'user' }
		: { level: 'project', path: projectPath.value! };
	try {
		await api.setToolStatus({ kind: 'plugin', name: p.name, scope: scopeArg, status: next, project: projectPath.value, tool: tool.value });
		await reload();
	} catch (e) {
		errorMsg.value = (e as Error).message;
	}
}

// ---- Detail helpers ----

function shortName(full: string): string {
	const at = full.lastIndexOf('@');
	return at > 0 ? full.slice(0, at) : full;
}

async function showDetail(p: ToolInstance) {
	selectedPlugin.value = p;
	detailData.value = null;
	activeTab.value = 'files';
	selectedComponent.value = null;
	detailLoading.value = true;
	try {
		detailData.value = await api.getPluginDetail(p.name, projectPath.value, tool.value);
	} catch (e) {
		errorMsg.value = (e as Error).message;
		selectedPlugin.value = null;
	} finally {
		detailLoading.value = false;
	}
}

function closeDetail() {
	selectedPlugin.value = null;
	detailData.value = null;
	activeTab.value = 'files';
	selectedComponent.value = null;
}

// ---- Tab navigation (files / skill / command / agent / hook / mcp / lsp) ----

type TabKind = 'files' | ComponentKind;
const activeTab = ref<TabKind>('files');

/** Component kinds in display order for the tab buttons. */
const KIND_TABS: ComponentKind[] = ['skill', 'command', 'agent', 'hook', 'mcp', 'lsp'];

/** Kind → i18n label key map. */
const KIND_LABELS: Record<ComponentKind, string> = {
	skill: 'plugin.kindSkill',
	command: 'plugin.kindCommand',
	agent: 'plugin.kindAgent',
	hook: 'plugin.kindHook',
	mcp: 'plugin.kindMcp',
	lsp: 'plugin.kindLsp',
	monitor: 'plugin.kindMonitor',
};

/** Set of kinds this plugin actually has (drives button enabled/disabled). */
const availableKinds = computed<Set<ComponentKind>>(() => {
	const s = new Set<ComponentKind>();
	for (const c of detailData.value?.components ?? []) s.add(c.kind);
	return s;
});

/** Components filtered by the active tab kind. */
const tabComponents = computed<PluginComponent[]>(() => {
	if (activeTab.value === 'files') return [];
	return (detailData.value?.components ?? []).filter((c) => c.kind === activeTab.value);
});

// ---- Component detail (right pane when a type tab is active) ----

const selectedComponent = ref<PluginComponent | null>(null);
const componentContent = ref('');
const componentLoading = ref(false);

/** Load the content for a selected component. For skill → read SKILL.md via file-content API. */
async function selectComponent(c: PluginComponent) {
	selectedComponent.value = c;
	componentContent.value = '';
	componentLoading.value = true;
	try {
		if (c.kind === 'skill') {
			// Skills have a SKILL.md inside skills/<name>/ — read it directly.
			const res = await api.readPluginFile(detailData.value!.name, `skills/${c.name}/SKILL.md`, projectPath.value, tool.value);
			componentContent.value = res.raw;
		}
		// Other kinds (command/agent/hook/mcp/lsp) only have a name — no file to read.
	} catch {
		componentContent.value = '';
	} finally {
		componentLoading.value = false;
	}
}

/** Auto-select first component when switching to a type tab. */
function switchTab(tab: TabKind) {
	activeTab.value = tab;
	selectedComponent.value = null;
	componentContent.value = '';
	if (tab !== 'files') {
		const first = (detailData.value?.components ?? []).find((c) => c.kind === tab);
		if (first) selectComponent(first);
	}
}

// ---- Draggable splitter for component-view left/right panes ----
const compListWidth = ref(260);
const compDragging = ref(false);

function startCompDrag(e: MouseEvent) {
	e.preventDefault();
	compDragging.value = true;
}
function onCompDrag(e: MouseEvent) {
	if (!compDragging.value) return;
	const min = 180;
	const max = window.innerWidth * 0.6;
	compListWidth.value = Math.min(max, Math.max(min, e.clientX));
}
function stopCompDrag() {
	compDragging.value = false;
}

async function openInExplorer(p: ToolInstance) {
	try {
		await api.openPluginInExplorer(p.name, projectPath.value, tool.value);
	} catch {
		// silent — best-effort
	}
}
</script>

<template>
  <div class="plugins-view">
    <!-- Toolbar: search + scope — only in list mode (hidden in detail) -->
    <div v-if="!selectedPlugin" class="toolbar">
      <el-input
        v-model="search"
        :placeholder="t('scope.searchPlaceholderPlugin')"
        :prefix-icon="Search"
        clearable
        class="search"
      />
      <el-select
        v-model="selected"
        :placeholder="t('scope.selectScope')"
        clearable
        class="scope-select"
        @change="reload"
      >
        <el-option
          v-for="opt in scopeOptions"
          :key="opt.value"
          :value="opt.value"
          :label="opt.label"
        >
          <span style="float: left">{{ opt.label }}</span>
          <span v-if="opt.sublabel" class="opt-sub">{{ opt.sublabel }}</span>
        </el-option>
      </el-select>
    </div>

    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <el-alert v-else-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <div v-else-if="plugins.length === 0" class="state">{{ t('plugin.empty') }}</div>

    <!-- List mode: card grid grouped by marketplace -->
    <template v-else-if="!selectedPlugin">
      <section v-for="[mp, list] in marketplaceGroups" :key="mp" class="group">
        <div class="group-head">
          <h2 class="group-title">{{ t('plugin.groupMarketplace') }} — {{ mp }}</h2>
        </div>
        <div class="card-grid">
          <PluginCard
            v-for="p in list"
            :key="p.name"
            :plugin="p"
            @toggle="(s) => toggleScope(p, s)"
            @detail="showDetail(p)"
            @open="openInExplorer(p)"
          />
        </div>
      </section>
    </template>

    <!-- Detail mode: tab navigation + content -->
    <div v-else class="detail-panel">
      <!-- Toolbar: back + name/version + kind tabs + open (all one row) -->
      <div class="detail-toolbar">
        <el-button text :icon="ArrowLeft" @click="closeDetail">{{ t('plugin.backToList') }}</el-button>
        <span v-if="detailData" class="detail-plugin-info">
          <span class="detail-plugin-name">{{ shortName(detailData.name) }}</span>
          <el-tag v-if="detailData.version" size="small" type="info">v{{ detailData.version }}</el-tag>
        </span>

        <!-- Kind tab buttons (inline, after name) -->
        <span v-if="detailData && !detailLoading" class="kind-tabs">
          <el-button
            size="small"
            :type="activeTab === 'files' ? 'primary' : 'default'"
            @click="switchTab('files')"
          >📁 {{ t('plugin.filesTab') }}</el-button>
          <el-button
            v-for="kind in KIND_TABS"
            :key="kind"
            size="small"
            :type="activeTab === kind ? 'primary' : 'default'"
            :disabled="!availableKinds.has(kind)"
            @click="switchTab(kind)"
          >{{ t(KIND_LABELS[kind]) }}</el-button>
        </span>

        <el-button v-if="detailData" text :icon="FolderOpened" size="small" class="open-btn" @click="openInExplorer(selectedPlugin!)">{{ t('plugin.openInExplorer') }}</el-button>
      </div>

      <div v-if="detailLoading" class="state">{{ t('common.loading') }}</div>

      <!-- Tab content: file explorer -->
      <FileExplorer
        v-else-if="detailData && activeTab === 'files'"
        :root-label="shortName(detailData.name)"
        :list-fn="(sp: string) => api.listPluginFiles(detailData!.name, sp, projectPath, tool)"
        :read-fn="(sp: string) => api.readPluginFile(detailData!.name, sp, projectPath, tool)"
      />

      <!-- Tab content: component list + detail (left-right split, draggable splitter) -->
      <div v-else-if="detailData && activeTab !== 'files'" class="component-view">
        <!-- Left: component cards -->
        <div class="comp-list-pane" :style="{ width: compListWidth + 'px', flexShrink: 0 }">
          <div
            v-for="c in tabComponents"
            :key="c.name"
            class="comp-card"
            :class="{ selected: selectedComponent?.name === c.name }"
            @click="selectComponent(c)"
          >
            <div class="comp-card-name">{{ c.name }}</div>
            <div v-if="c.detail" class="comp-card-desc" :title="c.detail">{{ c.detail }}</div>
          </div>
          <div v-if="tabComponents.length === 0" class="state">{{ t('plugin.noComponents') }}</div>
        </div>

        <!-- Draggable splitter -->
        <div class="comp-splitter" :class="{ active: compDragging }" @mousedown="startCompDrag">
          <div class="comp-splitter-handle"></div>
        </div>

        <!-- Right: component detail -->
        <div class="comp-detail-pane">
          <div v-if="componentLoading" class="state">{{ t('common.loading') }}</div>
          <template v-else-if="selectedComponent">
            <div class="comp-detail-header">{{ selectedComponent.name }}</div>
            <div class="comp-detail-body">
              <!-- skill: render SKILL.md content -->
              <MarkdownView v-if="selectedComponent.kind === 'skill' && componentContent" :raw="componentContent" />
              <!-- no content loaded (non-skill kinds have no file) -->
              <div v-else-if="selectedComponent.kind !== 'skill'" class="comp-name-only">
                <p class="comp-name-only-hint">{{ selectedComponent.name }}</p>
                <p class="comp-name-only-desc" v-if="selectedComponent.detail">{{ selectedComponent.detail }}</p>
              </div>
              <!-- skill but content failed to load -->
              <div v-else class="state">{{ t('plugin.contentUnavailable') }}</div>
            </div>
          </template>
          <div v-else class="state">{{ t('plugin.selectComponentHint') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugins-view {
  padding: 24px;
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.search {
  flex: 1 1 300px;
}
.scope-select {
  flex: 0 0 220px;
}
.opt-sub {
  float: right;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px;
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

/* ---- Inline detail panel ---- */
.detail-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
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
.open-btn {
  margin-left: auto;
}

/* ---- Kind tab buttons (inline in toolbar) ---- */
.kind-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* ---- Component view (left list + splitter + right detail) ---- */
.component-view {
  display: flex;
  flex: 1;
  min-height: 0;
}
.comp-list-pane {
  background: var(--el-bg-color);
  overflow-y: auto;
  padding: 6px;
}
.comp-splitter {
  flex: 0 0 5px;
  cursor: col-resize;
  background: var(--el-border-color-lighter);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.comp-splitter:hover,
.comp-splitter.active {
  background: var(--el-color-primary-light-7);
}
.comp-splitter-handle {
  width: 2px;
  height: 32px;
  background: var(--el-border-color);
  border-radius: 1px;
}
.comp-splitter.active .comp-splitter-handle {
  background: var(--el-color-primary);
}
.comp-card {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.15s;
}
.comp-card:hover {
  background: var(--el-fill-color-light);
}
.comp-card.selected {
  background: var(--el-color-primary-light-9);
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
.comp-detail-pane {
  flex: 1;
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.comp-detail-header {
  padding: 8px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
  font-weight: 600;
  font-family: 'Consolas', 'Monaco', monospace;
  background: var(--el-fill-color-blank);
}
.comp-detail-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
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
.comp-name-only-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0;
}
</style>
