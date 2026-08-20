<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search, ArrowLeft } from '@element-plus/icons-vue';
import { api } from '../api';
import { useTool } from '../stores/tool';
import { useDragOrder } from '../composables/useDragOrder';
import type { McpServer } from '../types/tool';

const { t } = useI18n();
const { tool } = useTool();

// Drag-to-reorder (pure UI preference, persisted to localStorage).
const drag = useDragOrder('mcps-order');
const { dragPath, dragOverPath } = drag;

const servers = ref<McpServer[]>([]);
const errorMsg = ref<string | null>(null);
const loading = ref(true);
const search = ref('');

// Inline detail state: when selectedServer is set, the list hides and detail shows.
const selectedServer = ref<McpServer | null>(null);
const detailData = ref<McpServer | null>(null);
const detailLoading = ref(false);

// Live-probed tool list (separate from the static config, loaded after the detail).
const tools = ref<{ name: string; description?: string }[]>([]);
const toolsLoading = ref(false);
const toolsError = ref<string | null>(null);

async function reload() {
	errorMsg.value = null;
	loading.value = true;
	selectedServer.value = null;
	detailData.value = null;
	try {
		servers.value = await api.listMcps(tool.value);
	} catch (e) {
		errorMsg.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

/** Tool switched from the header — reset state and reload. */
async function onToolChange() {
	search.value = '';
	servers.value = [];
	selectedServer.value = null;
	detailData.value = null;
	loading.value = true;
	await reload();
}

onMounted(async () => {
	drag.loadOrder();
	await reload();
	window.addEventListener('ai-agent-tools:reload', reload);
	window.addEventListener('ai-agent-tools:tool-change', onToolChange);
});
onUnmounted(() => {
	window.removeEventListener('ai-agent-tools:reload', reload);
	window.removeEventListener('ai-agent-tools:tool-change', onToolChange);
});

const filtered = computed(() => {
	const q = search.value.trim().toLowerCase();
	if (!q) return servers.value;
	return servers.value.filter(
		(s) =>
			s.name.toLowerCase().includes(q) ||
			s.transport.toLowerCase().includes(q) ||
			(s.command ?? '').toLowerCase().includes(q) ||
			(s.url ?? '').toLowerCase().includes(q),
	);
});

const userServers = computed(() =>
	drag.sortByOrder(filtered.value.filter((s) => s.scope === 'user'), drag.orderMap.value['user'] ?? [], (s) => s.name),
);
const projectServers = computed(() => filtered.value.filter((s) => s.scope === 'project'));

// Group project servers by owning project, sorted by project path.
const projectGroups = computed<[string, McpServer[]][]>(() => {
	const map = new Map<string, McpServer[]>();
	for (const s of projectServers.value) {
		const key = s.project ?? 'unknown';
		if (!map.has(key)) map.set(key, []);
		map.get(key)!.push(s);
	}
	return [...map.entries()]
		.map(([proj, list]) => [proj, drag.sortByOrder(list, drag.orderMap.value['project:' + proj] ?? [], (s) => s.name)] as [string, McpServer[]])
		.sort((a, b) => a[0].localeCompare(b[0]));
});

/** Drop wrapper: supplies the group's current name[] order to the composable. */
function groupCurrentIds(groupKey: string): string[] {
	if (groupKey === 'user') return userServers.value.map((s) => s.name);
	const proj = groupKey.slice('project:'.length);
	const g = projectGroups.value.find(([p]) => p === proj);
	return g ? g[1].map((s) => s.name) : [];
}
function dropAt(e: DragEvent, groupKey: string, targetName: string) {
	drag.onDrop(e, groupKey, targetName, groupCurrentIds(groupKey));
}

function transportIcon(tp: string): string {
	if (tp === 'stdio') return '🔌';
	if (tp === 'http') return '🌐';
	if (tp === 'sse') return '📡';
	return '❓';
}

function transportLabelKey(tp: string): string {
	if (tp === 'stdio') return 'mcp.transportStdio';
	if (tp === 'http') return 'mcp.transportHttp';
	if (tp === 'sse') return 'mcp.transportSse';
	return 'mcp.transportStdio';
}

function shortInfo(s: McpServer): string {
	if (s.transport === 'stdio') return s.command ?? '';
	if (s.transport === 'http' || s.transport === 'sse') return s.url ?? '';
	return '';
}

function basename(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

async function openDetail(s: McpServer) {
	selectedServer.value = s;
	detailData.value = null;
	detailLoading.value = true;
	tools.value = [];
	toolsError.value = null;
	toolsLoading.value = false;
	try {
		detailData.value = await api.getMcpDetail(s.name, s.scope, s.project ?? null, tool.value);
	} catch {
		detailData.value = s; // fall back to the list entry
	} finally {
		detailLoading.value = false;
	}
	// Lazy-load the live tool list after the detail panel renders.
	void loadTools(s);
}

/** Probe the server for its exposed tools (best-effort; failures show inline). */
async function loadTools(s: McpServer) {
	tools.value = [];
	toolsError.value = null;
	toolsLoading.value = true;
	try {
		const res = await api.getMcpTools(s.name, s.scope, s.project ?? null, tool.value);
		tools.value = res.tools;
		toolsError.value = res.error ?? null;
	} catch (e) {
		toolsError.value = (e as Error).message;
	} finally {
		toolsLoading.value = false;
	}
}

function closeDetail() {
	selectedServer.value = null;
	detailData.value = null;
	tools.value = [];
	toolsError.value = null;
	toolsLoading.value = false;
}

async function openInExplorer(filePath: string) {
	try {
		await api.openMcpInExplorer(filePath, tool.value);
	} catch {
		// silent — best-effort
	}
}

function envEntries(s: McpServer | null): [string, string][] {
	if (!s?.env) return [];
	return Object.entries(s.env);
}
function headerEntries(s: McpServer | null): [string, string][] {
	if (!s?.headers) return [];
	return Object.entries(s.headers);
}
</script>

<template>
  <div class="mcps-view">
    <!-- Toolbar: search — only in list mode (hidden in detail) -->
    <div v-if="!selectedServer" class="toolbar">
      <el-input
        v-model="search"
        :placeholder="t('mcp.searchPlaceholder')"
        :prefix-icon="Search"
        clearable
        class="search"
      />
    </div>

    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <el-alert v-else-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <div v-else-if="servers.length === 0" class="state">{{ t('mcp.empty') }}</div>

    <!-- List mode: card grid grouped by scope -->
    <template v-else-if="!selectedServer">
      <!-- User-level servers -->
      <section v-if="userServers.length" class="group">
        <div class="group-head">
          <h2 class="group-title">{{ t('mcp.scopeUser') }}</h2>
          <span class="group-count">{{ userServers.length }}</span>
        </div>
        <div class="card-grid">
          <el-card
            v-for="s in userServers"
            :key="s.name"
            class="mcp-card"
            :class="{ dragging: dragPath === s.name, 'drag-over': dragOverPath === s.name && dragPath !== s.name }"
            shadow="hover"
            body-style="padding: 14px;"
            draggable="true"
            @dragstart="drag.onDragStart($event, s.name)"
            @dragover="drag.onDragOver($event, s.name)"
            @drop="dropAt($event, 'user', s.name)"
            @dragend="drag.onDragEnd"
            @click="openDetail(s)"
          >
            <div class="card-name">{{ transportIcon(s.transport) }} {{ s.name }}</div>
            <div class="card-info" :title="shortInfo(s)">{{ shortInfo(s) }}</div>
            <div class="card-meta">
              <el-tag size="small" :type="s.transport === 'stdio' ? 'warning' : 'success'">{{ t(transportLabelKey(s.transport)) }}</el-tag>
              <el-tag v-if="s.enabled === false" size="small" type="info">{{ t('mcp.disabled') }}</el-tag>
            </div>
          </el-card>
        </div>
      </section>

      <!-- Project-level servers (grouped by project) -->
      <section v-for="[projPath, list] in projectGroups" :key="projPath" class="group">
        <div class="group-head">
          <h2 class="group-title">{{ t('mcp.scopeProject') }} — {{ basename(projPath) }}</h2>
          <span class="group-count">{{ list.length }}</span>
        </div>
        <div class="card-grid">
          <el-card
            v-for="s in list"
            :key="projPath + '/' + s.name"
            class="mcp-card"
            :class="{ dragging: dragPath === s.name, 'drag-over': dragOverPath === s.name && dragPath !== s.name }"
            shadow="hover"
            body-style="padding: 14px;"
            draggable="true"
            @dragstart="drag.onDragStart($event, s.name)"
            @dragover="drag.onDragOver($event, s.name)"
            @drop="dropAt($event, 'project:' + projPath, s.name)"
            @dragend="drag.onDragEnd"
            @click="openDetail(s)"
          >
            <div class="card-name">{{ transportIcon(s.transport) }} {{ s.name }}</div>
            <div class="card-info" :title="shortInfo(s)">{{ shortInfo(s) }}</div>
            <div class="card-meta">
              <el-tag size="small" :type="s.transport === 'stdio' ? 'warning' : 'success'">{{ t(transportLabelKey(s.transport)) }}</el-tag>
            </div>
          </el-card>
        </div>
      </section>
    </template>

    <!-- Detail mode: inline full-view detail panel -->
    <div v-else class="detail-panel">
      <div class="detail-toolbar">
        <el-button text :icon="ArrowLeft" @click="closeDetail">{{ t('mcp.backToList') }}</el-button>
      </div>

      <div v-if="detailLoading" class="state">{{ t('common.loading') }}</div>
      <div v-else-if="detailData" class="detail-body">
        <div class="detail-row">
          <span class="detail-label">{{ t('mcp.name') }}</span>
          <span class="detail-value">{{ transportIcon(detailData.transport) }} {{ detailData.name }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ t('mcp.transport') }}</span>
          <span class="detail-value">
            <el-tag size="small" :type="detailData.transport === 'stdio' ? 'warning' : 'success'">{{ t(transportLabelKey(detailData.transport)) }}</el-tag>
            <span v-if="detailData.type && detailData.type.toLowerCase() !== detailData.transport" class="detail-hint">type: {{ detailData.type }}</span>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ t('mcp.scope') }}</span>
          <span class="detail-value">{{ detailData.scope === 'user' ? t('mcp.scopeUser') : t('mcp.scopeProject') }}</span>
        </div>

        <!-- stdio fields -->
        <template v-if="detailData.transport === 'stdio'">
          <div v-if="detailData.command" class="detail-row">
            <span class="detail-label">{{ t('mcp.command') }}</span>
            <code class="detail-code">{{ detailData.command }}</code>
          </div>
          <div v-if="detailData.args?.length" class="detail-row">
            <span class="detail-label">{{ t('mcp.args') }}</span>
            <code class="detail-code">{{ detailData.args.join(' ') }}</code>
          </div>
          <div v-if="envEntries(detailData).length" class="detail-block">
            <div class="detail-label">{{ t('mcp.env') }}</div>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item v-for="[k, v] in envEntries(detailData)" :key="k" :label="k">
                <code class="detail-code">{{ v }}</code>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </template>

        <!-- http/sse fields -->
        <template v-else>
          <div v-if="detailData.url" class="detail-row">
            <span class="detail-label">{{ t('mcp.url') }}</span>
            <code class="detail-code">{{ detailData.url }}</code>
          </div>
          <div v-if="headerEntries(detailData).length" class="detail-block">
            <div class="detail-label">{{ t('mcp.headers') }}</div>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item v-for="[k, v] in headerEntries(detailData)" :key="k" :label="k">
                <code class="detail-code">{{ v }}</code>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </template>

        <!-- ZCode-only optional fields -->
        <div v-if="detailData.enabled !== undefined || detailData.timeoutMs !== undefined" class="detail-row">
          <span class="detail-label">{{ t('mcp.extra') }}</span>
          <span class="detail-value">
            <el-tag v-if="detailData.enabled !== undefined" size="small" :type="detailData.enabled ? 'success' : 'info'">
              {{ detailData.enabled ? t('mcp.enabled') : t('mcp.disabled') }}
            </el-tag>
            <span v-if="detailData.timeoutMs !== undefined" class="detail-hint">{{ t('mcp.timeout') }}: {{ detailData.timeoutMs }}ms</span>
          </span>
        </div>

        <!-- Source file -->
        <div class="detail-source">
          <span class="detail-label">{{ t('mcp.sourceFile') }}</span>
          <span class="source-path clickable" :title="detailData.sourceFile" @click="openInExplorer(detailData.sourceFile)">{{ detailData.sourceFile }}</span>
        </div>

        <!-- Exposed tools (live-probed by connecting to the server) -->
        <div class="detail-tools">
          <div class="detail-tools-head">
            <span class="detail-label">{{ t('mcp.tools') }}</span>
            <span v-if="!toolsLoading && !toolsError" class="tools-count">{{ tools.length }}</span>
            <el-button v-if="toolsError" text size="small" @click="selectedServer && loadTools(selectedServer)">{{ t('mcp.toolsRetry') }}</el-button>
          </div>
          <div v-if="toolsLoading" class="tools-state">{{ t('mcp.toolsLoading') }}</div>
          <el-alert v-else-if="toolsError" type="warning" :closable="false" :title="toolsError" class="tools-state" />
          <div v-else-if="tools.length === 0" class="tools-state">{{ t('mcp.noTools') }}</div>
          <ul v-else class="tools-list">
            <li v-for="tool in tools" :key="tool.name" class="tool-item">
              <code class="tool-name">{{ tool.name }}</code>
              <span v-if="tool.description" class="tool-desc">{{ tool.description }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcps-view {
  padding: 24px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.search {
  flex: 1 1 auto;
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
  display: flex;
  align-items: center;
  gap: 8px;
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
.group-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.card-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
.mcp-card {
  cursor: pointer;
  transition: border-color 0.2s, opacity 0.15s;
}
.mcp-card.dragging {
  opacity: 0.4;
}
.mcp-card.drag-over {
  border-color: var(--el-color-primary);
  border-style: dashed;
}
.mcp-card:hover {
  border-color: var(--el-color-primary-light-5);
}
.card-name {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-info {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 8px;
  min-height: 16px;
}
.card-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* Detail panel */
.detail-panel {
  display: flex;
  flex-direction: column;
}
.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.detail-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.detail-label {
  flex: 0 0 90px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.detail-value {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.detail-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.detail-code {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  background: var(--el-fill-color-light);
  padding: 2px 6px;
  border-radius: 3px;
  word-break: break-all;
}
.detail-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.detail-block .detail-label {
  flex: none;
}
.detail-source {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

/* Exposed tools section */
.detail-tools {
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.detail-tools-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.tools-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.tools-state {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  padding: 4px 0;
}
.tools-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tool-item {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 8px 12px;
}
.tool-name {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: var(--el-color-primary);
  font-weight: 600;
}
.tool-desc {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}
.source-path {
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.source-path.clickable {
  cursor: pointer;
}
.source-path.clickable:hover {
  color: var(--el-color-primary);
  text-decoration: underline;
}
</style>
