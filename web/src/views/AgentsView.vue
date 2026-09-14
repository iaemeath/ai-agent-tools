<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { FolderOpened, EditPen } from '@element-plus/icons-vue';
import { api } from '../api';
import { useTool } from '../stores/tool';
import { useDragOrder } from '../composables/useDragOrder';
import MarkdownView from '../components/MarkdownView.vue';
import SplitPane from '../components/SplitPane.vue';
import type { AgentInfo } from '../types/tool';

const { t } = useI18n();
const { tool } = useTool();

const items = ref<AgentInfo[]>([]);
const errorMsg = ref<string | null>(null);
const loading = ref(true);

const selected = ref<AgentInfo | null>(null);
const raw = ref('');
const contentLoading = ref(false);

// Edit mode (view ↔ edit).
const editing = ref(false);
const editRaw = ref('');
const saving = ref(false);

// Resizable split: left pane width in px (drag logic lives in SplitPane).
const leftWidth = ref(0);

// Drag-to-reorder — logic lives in the reusable composable; this view only
// supplies the resource key ('agents-order') and page-specific grouping data.
const drag = useDragOrder('agents-order');
const { dragPath, dragOverPath } = drag;

async function reload() {
	errorMsg.value = null;
	loading.value = true;
	selected.value = null;
	raw.value = '';
	try {
		items.value = await api.listAgents(tool.value);
		// Auto-select the first global agent for immediate content.
		const g = globalItems.value.find((i) => i.scope === 'global');
		if (g) await selectAgent(g);
	} catch (e) {
		errorMsg.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

async function selectAgent(r: AgentInfo) {
	editing.value = false;
	selected.value = r;
	raw.value = '';
	contentLoading.value = true;
	try {
		const res = await api.readAgent(r.path, tool.value);
		raw.value = res.raw;
	} catch (e) {
		raw.value = '```\n' + (e as Error).message + '\n```';
	} finally {
		contentLoading.value = false;
	}
}

async function openInExplorer(path: string) {
	try {
		await api.openAgentInExplorer(path, tool.value);
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
		await api.saveAgent(r.path, editRaw.value, tool.value);
		raw.value = editRaw.value;
		editing.value = false;
		ElMessage.success(t('agent.saved'));
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
	window.addEventListener('ai-tools:reload', reload);
	window.addEventListener('ai-tools:tool-change', reload);
});
onUnmounted(() => {
	window.removeEventListener('ai-tools:reload', reload);
	window.removeEventListener('ai-tools:tool-change', reload);
});

// ---- Grouping (sorted by saved drag order) ----

const globalItems = computed(() =>
	drag.sortByOrder(items.value.filter((i) => i.scope === 'global'), drag.orderMap.value['global'] ?? [], (r) => r.path),
);
const projectGroups = computed<[string, AgentInfo[]][]>(() => {
	const map = new Map<string, AgentInfo[]>();
	for (const i of items.value.filter((i) => i.scope === 'project')) {
		const key = i.project ?? '?';
		if (!map.has(key)) map.set(key, []);
		map.get(key)!.push(i);
	}
	return [...map.entries()].map(([proj, list]) => [
		proj,
		drag.sortByOrder(list, drag.orderMap.value['project:' + proj] ?? [], (r) => r.path),
	]) as [string, AgentInfo[]][];
});

function projectBasename(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}
</script>

<template>
  <div v-loading="loading" class="agents-view">
    <el-alert v-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <el-empty v-else-if="!loading && items.length === 0" :description="t('agent.empty')" />

    <SplitPane v-else v-model="leftWidth" :min="240" :max-ratio="0.6">
      <!-- Left: grouped file list (draggable cards) -->
      <template #left>
      <div class="pane">
        <div class="pane-header">
          <span class="pane-title">{{ t('nav.agents') }}</span>
          <span class="pane-meta">{{ items.length }}</span>
        </div>
        <div class="pane-body list-body">
          <!-- Global group -->
          <div class="group-label">🌐 {{ t('agent.groupGlobal') }}</div>
          <div v-if="globalItems.length === 0" class="state small">{{ t('agent.empty') }}</div>
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
              @click="selectAgent(r)"
            >
              <div class="item-name">{{ r.name }}</div>
              <div v-if="r.description" class="item-desc" :title="r.description">{{ r.description }}</div>
              <div class="item-meta">{{ r.lineCount }} {{ t('agent.lines') }}</div>
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
                @click="selectAgent(r)"
              >
                <div class="item-name">{{ r.name }}</div>
                <div v-if="r.description" class="item-desc" :title="r.description">{{ r.description }}</div>
                <div class="item-meta">{{ r.lineCount }} {{ t('agent.lines') }}</div>
              </div>
            </div>
          </template>
        </div>
      </div>
      </template>

      <!-- Right: content -->
      <template #right>
      <div class="pane">
        <template v-if="selected">
          <div class="pane-header">
            <div class="pane-header-row">
              <span class="pane-title">{{ selected.name }}</span>
              <span class="pane-meta">{{ selected.lineCount }} {{ t('agent.lines') }}</span>
              <div class="header-actions">
                <template v-if="editing">
                  <span v-if="dirty" class="dirty-hint">{{ t('agent.unsaved') }}</span>
                  <el-button size="small" @click="cancelEdit">{{ t('agent.cancel') }}</el-button>
                  <el-button size="small" type="primary" :loading="saving" @click="save">{{ t('agent.save') }}</el-button>
                </template>
                <el-button v-else size="small" :icon="EditPen" @click="startEdit">{{ t('agent.edit') }}</el-button>
                <el-button text :icon="FolderOpened" size="small" @click="openInExplorer(selected.path)">
                  {{ t('agent.openInExplorer') }}
                </el-button>
              </div>
            </div>
            <div class="pane-path clickable" :title="selected.path" @click="openInExplorer(selected.path)">{{ selected.path }}</div>
          </div>
          <div class="pane-body">
            <div v-if="contentLoading" v-loading="true" class="state" style="min-height: 120px" />
            <div v-else-if="editing" class="edit-mode">
              <el-input type="textarea" v-model="editRaw" class="md-textarea" resize="none" />
            </div>
            <MarkdownView v-else :raw="raw" />
          </div>
        </template>
        <el-empty v-else :description="t('agent.noSelection')" />
      </div>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.agents-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.pane-header-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
  padding: 4px 8px 8px;
}
</style>
