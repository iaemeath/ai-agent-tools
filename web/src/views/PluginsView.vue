<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { Search } from '@element-plus/icons-vue';
import { api } from '../api';
import PluginCard from '../components/PluginCard.vue';
import { useTool } from '../stores/tool';
import { useDragOrder } from '../composables/useDragOrder';
import type { ProjectInfo, Scope, Status, ToolInstance, ToolOverview } from '../types/tool';

const { t } = useI18n();
const router = useRouter();
const { tool } = useTool();

// Drag-to-reorder for the plugin list (pure UI preference, persisted to localStorage).
const drag = useDragOrder('plugins-order');
const { dragPath, dragOverPath } = drag;

const projects = ref<ProjectInfo[]>([]);
const overview = ref<ToolOverview | null>(null);
const errorMsg = ref<string | null>(null);
const loading = ref(true);

const selected = ref<string | null>(null); // 'user' | project path | null (all)
const search = ref('');

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
	loading.value = true;
	await loadProjects();
	await reload();
}

onMounted(async () => {
	drag.loadOrder();
	await loadProjects();
	await reload();
	window.addEventListener('ai-agent-tools:reload', reload);
	window.addEventListener('ai-agent-tools:tool-change', onToolChange);
});
onUnmounted(() => {
	window.removeEventListener('ai-agent-tools:reload', reload);
	window.removeEventListener('ai-agent-tools:tool-change', onToolChange);
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
	return [...map.entries()]
		.map(([mp, list]) => [mp, drag.sortByOrder(list, drag.orderMap.value['marketplace:' + mp] ?? [], (p) => p.name)] as [string, ToolInstance[]])
		.sort((a, b) => a[0].localeCompare(b[0]));
});

/** Drop wrapper: supplies the marketplace group's current name[] order to the composable. */
function groupCurrentIds(groupKey: string): string[] {
	const mp = groupKey.slice('marketplace:'.length);
	const g = marketplaceGroups.value.find(([k]) => k === mp);
	return g ? g[1].map((p) => p.name) : [];
}
function dropAt(e: DragEvent, groupKey: string, targetName: string) {
	drag.onDrop(e, groupKey, targetName, groupCurrentIds(groupKey));
}

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

/** Card click → route-driven detail page. */
function openDetail(p: ToolInstance): void {
	router.push(`/plugins/${encodeURIComponent(p.name)}`);
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
    <!-- Toolbar: search + scope -->
    <div class="toolbar">
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

    <el-alert v-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <el-empty v-else-if="!loading && plugins.length === 0" :description="t('plugin.empty')" />

    <!-- Card grid grouped by marketplace -->
    <template v-else v-loading="loading">
      <section v-for="[mp, list] in marketplaceGroups" :key="mp" class="group">
        <div class="group-head">
          <h2 class="group-title">{{ t('plugin.groupMarketplace') }} — {{ mp }}</h2>
        </div>
        <div class="card-grid">
          <div
            v-for="p in list"
            :key="p.name"
            class="drag-wrap"
            :class="{ dragging: dragPath === p.name, 'drag-over': dragOverPath === p.name && dragPath !== p.name }"
            draggable="true"
            @dragstart="drag.onDragStart($event, p.name)"
            @dragover="drag.onDragOver($event, p.name)"
            @drop="dropAt($event, 'marketplace:' + mp, p.name)"
            @dragend="drag.onDragEnd"
          >
            <PluginCard
              :plugin="p"
              @toggle="(s) => toggleScope(p, s)"
              @detail="openDetail(p)"
              @open="openInExplorer(p)"
            />
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.plugins-view {
  padding: 24px;
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
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
.drag-wrap.dragging {
  opacity: 0.4;
}
.drag-wrap.drag-over {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: 2px;
  border-radius: 8px;
}
</style>
