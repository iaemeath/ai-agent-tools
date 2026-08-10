<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, ArrowLeft } from '@element-plus/icons-vue';
import { api } from '../api';
import SkillCard from '../components/SkillCard.vue';
import FileExplorer from '../components/FileExplorer.vue';
import { useTool } from '../stores/tool';
import type { ProjectInfo, Scope, Status, ToolInstance, ToolOverview } from '../types/tool';

const { t } = useI18n();
const { tool } = useTool();

const projects = ref<ProjectInfo[]>([]);
const overview = ref<ToolOverview | null>(null);
const errorMsg = ref<string | null>(null);
const loading = ref(true);

const selected = ref<string | null>(null); // 'user' | project path | null (all)
const search = ref('');
const promoting = ref<string | null>(null);
const deleting = ref<string | null>(null);

// Inline detail state: when selectedSkill is set, the list hides and detail shows.
const selectedSkill = ref<ToolInstance | null>(null);

/** Resolve the skill scope ('user' | 'project') from its origin. */
function skillScope(s: ToolInstance): 'user' | 'project' {
	return s.origin === 'project' ? 'project' : 'user';
}
/** Resolve the project path for a skill (null for user-level). */
function skillProject(s: ToolInstance): string | null {
	return s.origin === 'project' ? (s.originProject ?? null) : null;
}

// 'user' or 'all' both resolve to user-level project arg; a project path selects it.
const projectPath = computed(() => (selected.value && selected.value !== 'user' ? selected.value : null));
const isUserScope = computed(() => selected.value === 'user');
const isAllScope = computed(() => selected.value === null);

interface ScopeOption { value: string; label: string; sublabel?: string; icon: 'user' | 'folder' }

const scopeOptions = computed<ScopeOption[]>(() => [
	...projects.value.map((p) => ({
		value: p.path,
		label: p.path.split('/').filter(Boolean).pop() ?? p.path,
		sublabel: p.path,
		icon: 'folder' as const,
	})),
]);

async function reload() {
	errorMsg.value = null;
	selectedSkill.value = null;
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
	selectedSkill.value = null;
	loading.value = true;
	await loadProjects();
	await reload();
}

onMounted(async () => {
	await loadProjects();
	await reload();
	window.addEventListener('ccc-ui:reload', reload);
	window.addEventListener('ccc-ui:tool-change', onToolChange);
});
onUnmounted(() => {
	window.removeEventListener('ccc-ui:reload', reload);
	window.removeEventListener('ccc-ui:tool-change', onToolChange);
});

const allSkills = computed(() => overview.value?.items.filter((i) => i.kind === 'skill') ?? []);

const skills = computed(() => {
	const q = search.value.trim().toLowerCase();
	if (!q) return allSkills.value;
	return allSkills.value.filter(
		(s) =>
			s.name.toLowerCase().includes(q) ||
			(s.description ?? '').toLowerCase().includes(q),
	);
});

const globalSkills = computed(() => skills.value.filter((s) => s.origin === 'global'));
const projectSkills = computed(() => skills.value.filter((s) => s.origin === 'project'));

// Group project skills by owning project, sorted by project path.
const projectGroups = computed<[string, ToolInstance[]][]>(() => {
	const map = new Map<string, ToolInstance[]>();
	for (const s of projectSkills.value) {
		const key = s.originProject ?? 'unknown';
		if (!map.has(key)) map.set(key, []);
		map.get(key)!.push(s);
	}
	return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
});

async function toggleScope(t_: ToolInstance, next: Status) {
	// Project-origin skill → write project scope (its own settings.json).
	// Global skill → write user scope (or project scope when one is selected).
	const scopeArg: Scope = t_.origin === 'project'
		? { level: 'project', path: t_.originProject! }
		: (isUserScope.value || isAllScope.value
			? { level: 'user' }
			: { level: 'project', path: projectPath.value! });
	try {
		await api.setToolStatus({ kind: 'skill', name: t_.name, scope: scopeArg, status: next, project: projectPath.value, tool: tool.value });
		await reload();
	} catch (e) {
		errorMsg.value = (e as Error).message;
	}
}

async function promote(t_: ToolInstance) {
	if (!t_.originProject) return;
	try {
		await ElMessageBox.confirm(t('skill.promoteConfirm'), t('skill.promote'), { type: 'warning' });
	} catch {
		return; // cancelled
	}
	promoting.value = t_.name;
	try {
		await api.promoteSkill(t_.name, t_.originProject, tool.value);
		ElMessage.success(t('skill.promoted'));
		await reload();
	} catch (e) {
		ElMessage.error((e as Error).message);
	} finally {
		promoting.value = null;
	}
}

async function removeSkill(t_: ToolInstance) {
	const isProject = t_.origin === 'project';
	const scope: 'user' | 'project' = isProject ? 'project' : 'user';
	try {
		await ElMessageBox.confirm(t('skill.deleteConfirm'), t('common.delete'), { type: 'warning' });
	} catch {
		return; // cancelled
	}
	deleting.value = t_.name;
	try {
		await api.deleteSkill({ name: t_.name, scope, project: isProject ? t_.originProject : undefined, tool: tool.value });
		ElMessage.success(t('skill.deleted'));
		await reload();
	} catch (e) {
		ElMessage.error((e as Error).message);
	} finally {
		deleting.value = null;
	}
}

function basename(p: string): string {
	return p.split('/').filter(Boolean).pop() ?? p;
}

// ---- Detail view ----

function showDetail(s: ToolInstance) {
	selectedSkill.value = s;
}

function closeDetail() {
	selectedSkill.value = null;
}
</script>

<template>
  <div class="skills-view">
    <!-- Toolbar: search + scope — only in list mode (hidden in detail) -->
    <div v-if="!selectedSkill" class="toolbar">
      <el-input
        v-model="search"
        :placeholder="t('scope.searchPlaceholder')"
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

    <!-- List mode -->
    <template v-else-if="!selectedSkill">
      <div v-if="skills.length === 0" class="state">{{ t('skill.empty') }}</div>
      <section v-if="globalSkills.length" class="group">
        <div class="group-head">
          <h2 class="group-title">{{ t('skill.groupGlobal') }}</h2>
        </div>
        <div class="card-grid">
          <SkillCard
            v-for="t_ in globalSkills"
            :key="t_.name"
            :skill="t_"
            :deleting="deleting === t_.name"
            @toggle="(s) => toggleScope(t_, s)"
            @delete="removeSkill(t_)"
            @detail="showDetail(t_)"
          />
        </div>
      </section>

      <!-- Project skills (grouped by project) -->
      <section v-for="[projPath, list] in projectGroups" :key="projPath" class="group">
        <div class="group-head">
          <h2 class="group-title">{{ t('skill.groupProject') }} — {{ basename(projPath) }}</h2>
        </div>
        <div class="card-grid">
          <SkillCard
            v-for="t_ in list"
            :key="projPath + '/' + t_.name"
            :skill="t_"
            :promoting="promoting === t_.name"
            :deleting="deleting === t_.name"
            @toggle="(s) => toggleScope(t_, s)"
            @promote="promote(t_)"
            @delete="removeSkill(t_)"
            @detail="showDetail(t_)"
          />
        </div>
      </section>
    </template>

    <!-- Detail mode: file explorer for the skill directory -->
    <div v-else class="detail-panel">
      <div class="detail-toolbar">
        <el-button text :icon="ArrowLeft" @click="closeDetail">{{ t('skill.backToList') }}</el-button>
        <span class="detail-skill-name">{{ selectedSkill.name }}</span>
        <el-tag v-if="selectedSkill.origin === 'project'" size="small" type="info">
          {{ basename(selectedSkill.originProject ?? '') }}
        </el-tag>
      </div>
      <FileExplorer
        :root-label="selectedSkill.name"
        :list-fn="(sp: string) => api.listSkillFiles(selectedSkill!.name, skillScope(selectedSkill!), sp, skillProject(selectedSkill!), tool)"
        :read-fn="(sp: string) => api.readSkillFile(selectedSkill!.name, skillScope(selectedSkill!), sp, skillProject(selectedSkill!), tool)"
      />
    </div>
  </div>
</template>

<style scoped>
.skills-view {
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
}
.search {
  flex: 1 1 auto;
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
.hint {
  margin-bottom: 20px;
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

/* ---- Detail panel ---- */
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
.detail-skill-name {
  font-size: 15px;
  font-weight: 600;
}
</style>
