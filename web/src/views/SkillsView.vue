<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search } from '@element-plus/icons-vue';
import { api } from '../api';
import SkillCard from '../components/SkillCard.vue';
import type { ProjectInfo, Scope, Status, ToolInstance, ToolOverview } from '../types/tool';

const { t } = useI18n();

const projects = ref<ProjectInfo[]>([]);
const overview = ref<ToolOverview | null>(null);
const errorMsg = ref<string | null>(null);
const loading = ref(true);

const selected = ref<string | null>(null); // 'user' | project path | null (all)
const search = ref('');
const promoting = ref<string | null>(null);
const deleting = ref<string | null>(null);

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
	try {
		overview.value = await api.getOverview(projectPath.value);
	} catch (e) {
		errorMsg.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

async function loadProjects() {
	try {
		projects.value = await api.listProjects();
	} catch {
		projects.value = [];
	}
}

onMounted(async () => {
	await loadProjects();
	await reload();
	// Header refresh button dispatches this event.
	window.addEventListener('ccc-ui:reload', reload);
});
onUnmounted(() => window.removeEventListener('ccc-ui:reload', reload));

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

function scopeStatus(t_: ToolInstance): Status {
	const level = isUserScope.value ? 'user' : projectPath.value ? 'project' : 'user';
	return t_.perScope.find((s) => s.scope.level === level)?.status ?? 'inherited';
}

async function toggleScope(t_: ToolInstance, next: Status) {
	// Project-origin skill → write project scope (its own settings.json).
	// Global skill → write user scope (or project scope when one is selected).
	const scopeArg: Scope = t_.origin === 'project'
		? { level: 'project', path: t_.originProject! }
		: (isUserScope.value || isAllScope.value
			? { level: 'user' }
			: { level: 'project', path: projectPath.value! });
	try {
		await api.setToolStatus({ kind: 'skill', name: t_.name, scope: scopeArg, status: next, project: projectPath.value });
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
		await api.promoteSkill(t_.name, t_.originProject);
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
		await api.deleteSkill({ name: t_.name, scope, project: isProject ? t_.originProject : undefined });
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
</script>

<template>
  <div class="skills-view">
    <!-- Toolbar: search + scope -->
    <div class="toolbar">
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
    <div v-else-if="skills.length === 0" class="state">{{ t('skill.empty') }}</div>

    <template v-else>
      <!-- Global skills -->
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
          />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.skills-view {
  padding: 24px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.search {
  flex: 0 0 calc(74% - 8px);
}
.scope-select {
  flex: 0 0 calc(24% - 8px);
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
</style>
