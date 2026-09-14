<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, Delete } from '@element-plus/icons-vue';
import { EllipsisVertical, MessagesSquare } from 'lucide-vue-next';
import { api } from '../api';
import { useTool } from '../stores/tool';
import { useDragOrder } from '../composables/useDragOrder';
import type { ProjectInfo } from '../types/tool';

const { t } = useI18n();
const router = useRouter();
const { tool } = useTool();

// Drag-to-reorder (pure UI preference, persisted to localStorage).
const drag = useDragOrder('projects-order');
const { dragPath, dragOverPath } = drag;

const projects = ref<ProjectInfo[]>([]);
const errorMsg = ref<string | null>(null);
const loading = ref(true);
const search = ref('');
const deleting = ref<string | null>(null);

async function reload() {
	errorMsg.value = null;
	loading.value = true;
	try {
		projects.value = await api.listProjects(tool.value);
	} catch (e) {
		errorMsg.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

onMounted(async () => {
	drag.loadOrder();
	await reload();
	window.addEventListener('ai-tools:reload', reload);
	window.addEventListener('ai-tools:tool-change', reload);
});
onUnmounted(() => {
	window.removeEventListener('ai-tools:reload', reload);
	window.removeEventListener('ai-tools:tool-change', reload);
});

const filtered = computed(() => {
	const q = search.value.trim().toLowerCase();
	const base = !q ? projects.value : projects.value.filter((p) => p.path.toLowerCase().includes(q));
	return drag.sortByOrder(base, drag.orderMap.value['all'] ?? [], (p) => p.encoded);
});

/** Drop wrapper: projects have no sub-groups, so groupKey is 'all'. */
function dropAt(e: DragEvent, targetEncoded: string) {
	drag.onDrop(e, 'all', targetEncoded, filtered.value.map((p) => p.encoded));
}

function fmtDate(iso: string | null): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function basename(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function onCommand(cmd: string, p: ProjectInfo) {
	if (cmd === 'delete') removeProject(p);
	else if (cmd === 'sessions') openSessions(p);
}

/** Drill into this project's session history (reading view). */
function openSessions(p: ProjectInfo): void {
	router.push({ path: '/sessions', query: { project: p.encoded } });
}

async function removeProject(p: ProjectInfo) {
	try {
		await ElMessageBox.confirm(t('project.deleteConfirm'), t('common.delete'), { type: 'warning' });
	} catch {
		return; // cancelled
	}
	deleting.value = p.encoded;
	try {
		await api.deleteProject(p.encoded, tool.value);
		ElMessage.success(t('project.deleted'));
		await reload();
	} catch (e) {
		ElMessage.error((e as Error).message);
	} finally {
		deleting.value = null;
	}
}
</script>

<template>
  <div v-loading="loading" class="projects-view">
    <!-- Toolbar: search -->
    <div class="toolbar">
      <el-input
        v-model="search"
        :placeholder="t('project.searchPlaceholder')"
        :prefix-icon="Search"
        clearable
        class="search"
      />
    </div>

    <el-alert v-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <el-empty v-else-if="!loading && filtered.length === 0" :description="t('project.empty')" />

    <div v-else class="card-grid">
      <el-card
        v-for="p in filtered"
        :key="p.encoded"
        class="proj-card"
        :class="{ dragging: dragPath === p.encoded, 'drag-over': dragOverPath === p.encoded && dragPath !== p.encoded }"
        shadow="hover"
        body-style="padding: 14px;"
        draggable="true"
        @dragstart="drag.onDragStart($event, p.encoded)"
        @dragover="drag.onDragOver($event, p.encoded)"
        @drop="dropAt($event, p.encoded)"
        @dragend="drag.onDragEnd"
        @click="openSessions(p)"
      >
        <div class="card-name" :title="p.path">{{ basename(p.path) }}</div>
        <div class="card-path" :title="p.path">{{ p.path }}</div>
        <div class="card-meta">
          <el-tag :type="p.sessionCount > 0 ? '' : 'info'" size="small">
            {{ p.sessionCount }} {{ t('project.colSessions') }}
          </el-tag>
          <span class="card-date">{{ fmtDate(p.lastActivity) }}</span>
        </div>
        <div class="card-foot" @click.stop>
          <el-dropdown trigger="click" @command="(cmd: string) => onCommand(cmd, p)">
            <el-button class="more-btn" text :title="t('common.more')">
              <el-icon><EllipsisVertical /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="sessions" :icon="MessagesSquare">
                  {{ t('project.viewSessions') }}
                </el-dropdown-item>
                <el-dropdown-item command="delete" :icon="Delete" :disabled="deleting === p.encoded" divided>
                  {{ deleting === p.encoded ? t('project.deleting') : t('common.delete') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.projects-view {
  padding: 24px;
}
.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}
.search {
  flex: 1 1 auto;
  max-width: 480px;
}
.state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px;
}
.card-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.proj-card {
  transition: opacity 0.15s;
  cursor: pointer;
}
.proj-card.dragging {
  opacity: 0.4;
}
.proj-card.drag-over {
  border-color: var(--el-color-primary);
  border-style: dashed;
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
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.card-date {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.card-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 10px;
}
.more-btn {
  padding: 4px;
  color: var(--el-text-color-secondary);
}
</style>
