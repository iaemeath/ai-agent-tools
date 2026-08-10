<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, Delete } from '@element-plus/icons-vue';
import { EllipsisVertical } from 'lucide-vue-next';
import { api } from '../api';
import { useTool } from '../stores/tool';
import type { ProjectInfo } from '../types/tool';

const { t } = useI18n();
const { tool } = useTool();

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
	await reload();
	window.addEventListener('ccc-ui:reload', reload);
	window.addEventListener('ccc-ui:tool-change', reload);
});
onUnmounted(() => {
	window.removeEventListener('ccc-ui:reload', reload);
	window.removeEventListener('ccc-ui:tool-change', reload);
});

const filtered = computed(() => {
	const q = search.value.trim().toLowerCase();
	if (!q) return projects.value;
	return projects.value.filter((p) => p.path.toLowerCase().includes(q));
});

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
  <div class="projects-view">
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

    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <el-alert v-else-if="errorMsg" class="state" type="error" :closable="false" :title="errorMsg" />
    <div v-else-if="filtered.length === 0" class="state">{{ t('project.empty') }}</div>

    <div v-else class="card-grid">
      <el-card v-for="p in filtered" :key="p.encoded" class="proj-card" shadow="hover" body-style="padding: 14px;">
        <div class="card-name" :title="p.path">{{ basename(p.path) }}</div>
        <div class="card-path" :title="p.path">{{ p.path }}</div>
        <div class="card-meta">
          <el-tag :type="p.sessionCount > 0 ? '' : 'info'" size="small">
            {{ p.sessionCount }} {{ t('project.colSessions') }}
          </el-tag>
          <span class="card-date">{{ fmtDate(p.lastActivity) }}</span>
        </div>
        <div class="card-foot">
          <el-dropdown trigger="click" @command="(cmd: string) => onCommand(cmd, p)">
            <el-button class="more-btn" text :title="t('common.more')">
              <el-icon><EllipsisVertical /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="delete" :icon="Delete" :disabled="deleting === p.encoded">
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
  transition: none;
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
