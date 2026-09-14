<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, Plus, Delete, DocumentAdd } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import type { ScriptCard, ScriptFileInput } from '../types/script';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/** 'list' | 'new' — 卡片列表 + 内嵌新建；卡片详情（iframe 内嵌脚本页面）在 ScriptDetailView。 */
const mode = computed<'list' | 'new'>(() => (route.name === 'script-new' ? 'new' : 'list'));

/* ===================== 卡片列表：启动 / 查看状态 / 关闭 三键 ===================== */
const cards = ref<ScriptCard[]>([]);
const loading = ref(true);
const now = ref(Date.now());

async function loadCards() {
	try {
		cards.value = await api.listScripts();
		now.value = Date.now();
	} catch {
		/* 轮询失败静默，保留旧数据 */
	} finally {
		loading.value = false;
	}
}

function statusTagType(s: ScriptCard['status']) {
	return s.status === 'running' ? 'success' : s.status === 'exited' ? (s.exitCode ? 'danger' : 'info') : 'info';
}
function statusLabel(s: ScriptCard['status']) {
	if (s.status === 'running') return t('scripts.statusRunning');
	if (s.status === 'exited') return s.exitCode ? `${t('scripts.statusExited')} (${s.exitCode})` : t('scripts.statusExitedOk');
	return t('scripts.statusIdle');
}
/** 状态徽标悬浮：pid + 运行时长（按最近一次刷新时刻计）。 */
function statusTip(s: ScriptCard['status']) {
	if (!s.pid) return '';
	const dur = s.startedAt ? Math.max(0, now.value - s.startedAt) : 0;
	return `PID ${s.pid}${dur ? ' · ' + t('scripts.runDur', { d: fmtDur(dur) }) : ''}`;
}
function fmtDur(ms: number) {
	const sec = Math.floor(ms / 1000);
	if (sec >= 86400) return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
	if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
	if (sec >= 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
	return `${sec}s`;
}

function openPage(card: ScriptCard) {
	if (card.ui) router.push(`/scripts/${encodeURIComponent(card.id)}`);
}

async function start(card: ScriptCard) {
	try {
		await api.startScript(card.id);
		ElMessage.success(t('scripts.started', { name: card.name }));
	} catch (e) {
		ElMessage.error((e as Error).message);
	}
	await loadCards();
}

/* ---- 查看状态：三合一弹窗（进程状态 + 最近输出 + 脚本状态参数输出） ---- */
const statusDlg = ref(false);
const statusCard = ref<ScriptCard | null>(null);
const statusLoading = ref(false);
const statusRecent = ref('');
const statusOut = ref('');
const statusProcLine = computed(() => {
	const s = statusCard.value?.status;
	if (!s || s.status === 'idle') return t('scripts.statusIdle');
	const base = `${statusLabel(s)}${s.pid ? ` · PID ${s.pid}` : ''}`;
	const dur = s.startedAt ? ` · ${t('scripts.runDur', { d: fmtDur(Math.max(0, now.value - s.startedAt)) })}` : '';
	return base + dur + (s.detached ? ` · ${t('scripts.detachedSvc')}` : '');
});

async function viewStatus(card: ScriptCard) {
	statusCard.value = card;
	statusRecent.value = '';
	statusOut.value = '';
	statusDlg.value = true;
	statusLoading.value = true;
	try {
		// ① 最近输出（attached 走内存环 / detached 或宿主重启后读日志文件）
		try {
			const log = await api.scriptLog(card.id, 0);
			const lines = log.lines.slice(-50).join('\n').trim();
			statusRecent.value = lines || t('scripts.statusEmpty');
		} catch {
			statusRecent.value = t('scripts.statusEmpty');
		}
		// ② 脚本状态参数输出（配了才跑）
		if (card.args.status) {
			try {
				const r = await api.runScriptStatus(card.id);
				let text = r.output || t('scripts.statusEmpty');
				if (r.timedOut) text += `\n${t('scripts.statusTimeout')}`;
				statusOut.value = text;
			} catch (e) {
				statusOut.value = (e as Error).message;
			}
		}
	} finally {
		statusLoading.value = false;
		loadCards();
	}
}

async function stop(card: ScriptCard) {
	try {
		await api.stopScript(card.id);
		ElMessage.success(t('scripts.stopped', { name: card.name }));
	} catch (e) {
		ElMessage.error((e as Error).message);
	}
	await loadCards();
}

/* ===================== 新建脚本（内嵌表单，一次可录入多个文件；或从现成目录导入） ===================== */
const creating = ref(false);
const form = reactive({ name: '', desc: '', startArgs: '' });
const files = ref<ScriptFileInput[]>([]);
const importDir = ref('');
const importing = ref(false);

function initCreate() {
	form.name = '';
	form.desc = '';
	form.startArgs = '';
	files.value = [{ path: 'main.js', content: '' }];
	importDir.value = '';
}

function addFile() {
	files.value.push({ path: '', content: '' });
}
function removeFile(i: number) {
	files.value.splice(i, 1);
}

async function importDir2Card() {
	const dir = importDir.value.trim().replace(/^["']|["']$/g, '');
	if (!dir) {
		ElMessage.warning(t('scripts.importPh'));
		return;
	}
	importing.value = true;
	try {
		const r = await api.importScript(dir);
		ElMessage.success(t('scripts.imported', { id: r.id }));
		router.push('/scripts');
	} catch (e) {
		ElMessage.error((e as Error).message);
	} finally {
		importing.value = false;
	}
}

async function create() {
	if (!form.name.trim()) {
		ElMessage.warning(t('scripts.warnName'));
		return;
	}
	const valid = files.value.filter((f) => f.path.trim());
	if (!valid.length) {
		ElMessage.warning(t('scripts.warnFiles'));
		return;
	}
	creating.value = true;
	try {
		await api.createScript({
			name: form.name.trim(),
			desc: form.desc.trim(),
			files: valid.map((f) => ({ path: f.path.trim(), content: f.content })),
			startArgs: form.startArgs.trim() || undefined,
		});
		ElMessage.success(t('scripts.created'));
		router.push('/scripts');
	} catch (e) {
		ElMessage.error((e as Error).message);
	} finally {
		creating.value = false;
	}
}

/* ===================== 模式切换 & 轮询 ===================== */
watch(
	mode,
	(m) => {
		if (m === 'list') loadCards();
		if (m === 'new') initCreate();
	},
	{ immediate: true },
);
const listTimer = setInterval(() => {
	if (mode.value === 'list') loadCards();
}, 5000);
onUnmounted(() => clearInterval(listTimer));

const rootHint = computed(() => t('scripts.rootHint'));
</script>

<template>
  <!-- ============ 卡片列表：启动 / 查看状态 / 关闭 ============ -->
  <div v-if="mode === 'list'" v-loading="loading" class="scripts-view">
    <div class="toolbar">
      <span class="hint">{{ rootHint }}</span>
      <div class="spacer" />
      <el-button type="primary" :icon="Plus" @click="router.push('/scripts/new')">{{ t('scripts.new') }}</el-button>
    </div>

    
    <el-empty v-if="!loading && cards.length === 0" :description="t('scripts.empty')">
      <div class="empty-sub">{{ t('scripts.emptySub') }}</div>
    </el-empty>

    <div v-else class="card-grid">
      <el-card
        v-for="s in cards"
        :key="s.id"
        class="script-card"
        :class="{ clickable: !!s.ui }"
        shadow="hover"
        @click="openPage(s)"
      >
        <div class="card-head">
          <span class="card-name">{{ s.name }}</span>
          <el-tooltip :content="statusTip(s.status)" :disabled="!statusTip(s.status)" placement="top">
            <el-tag size="small" :type="statusTagType(s.status)" disable-transitions>{{ statusLabel(s.status) }}</el-tag>
          </el-tooltip>
        </div>
        <div class="card-desc">{{ s.desc || t('scripts.noDesc') }}</div>
        <div class="card-meta">
          <el-tag v-if="s.ui" size="small" disable-transitions>{{ t('scripts.hasPage') }}</el-tag>
          <el-tag v-else size="small" type="info" disable-transitions>{{ t('scripts.pageOnly') }}</el-tag>
          <el-tag v-if="s.detached" size="small" type="warning" disable-transitions>{{ t('scripts.detachedSvc') }}</el-tag>
        </div>
        <div class="card-ops" @click.stop>
          <el-button
            v-if="s.entry"
            size="small"
            type="success"
            plain
            :disabled="s.status.status === 'running'"
            @click="start(s)"
          >{{ t('scripts.start') }}</el-button>
          <el-button
            v-if="s.entry"
            size="small"
            plain
            @click="viewStatus(s)"
          >{{ t('scripts.viewStatus') }}</el-button>
          <el-button
            v-if="s.entry"
            size="small"
            type="danger"
            plain
            :disabled="s.status.status !== 'running'"
            @click="stop(s)"
          >{{ t('scripts.stop') }}</el-button>
          <span v-if="!s.entry" class="hint">{{ t('scripts.pageOnlyHint') }}</span>
        </div>
      </el-card>
    </div>

    <!-- 查看状态弹窗：进程状态 + 最近输出 + 脚本状态参数输出 -->
    <el-dialog v-model="statusDlg" :title="`${statusCard?.name ?? ''} · ${t('scripts.viewStatus')}`" width="680px">
      <div v-loading="statusLoading" class="status-body">
        <div class="status-sec">
          <label class="form-label">{{ t('scripts.procLine') }}</label>
          <div class="mono status-proc">{{ statusProcLine }}</div>
        </div>
        <div class="status-sec">
          <label class="form-label">{{ t('scripts.recentOut') }}</label>
          <pre class="status-output">{{ statusRecent }}</pre>
        </div>
        <div v-if="statusCard?.args.status" class="status-sec">
          <label class="form-label">{{ t('scripts.statusArgsOut') }}</label>
          <pre class="status-output">{{ statusOut || t('scripts.statusEmpty') }}</pre>
        </div>
      </div>
      <template #footer>
        <el-button @click="statusDlg = false">{{ t('scripts.close') }}</el-button>
      </template>
    </el-dialog>
  </div>

  <!-- ============ 新建脚本（内嵌，非弹窗；一次可录入多个文件） ============ -->
  <div v-else class="scripts-view">
    <div class="toolbar">
      <el-button :icon="ArrowLeft" @click="router.push('/scripts')">{{ t('scripts.back') }}</el-button>
      <h2 class="page-title">{{ t('scripts.new') }}</h2>
    </div>

    <div class="create-form">
      <!-- 方式一：从现成目录导入（AI 写好的工具目录直接注册） -->
      <div class="import-box">
        <label class="form-label">{{ t('scripts.import') }}</label>
        <div class="import-row">
          <el-input v-model="importDir" :placeholder="t('scripts.importPh')" class="mono" />
          <el-button type="primary" plain :loading="importing" @click="importDir2Card">{{ t('scripts.importBtn') }}</el-button>
        </div>
        <div class="form-hint">{{ t('scripts.importHint') }}</div>
        <el-divider class="import-divider">{{ t('scripts.orPaste') }}</el-divider>
      </div>

      <div class="form-item">
        <label class="form-label">{{ t('scripts.name') }}</label>
        <el-input v-model="form.name" :placeholder="t('scripts.namePh')" maxlength="40" />
      </div>

      <div class="form-item">
        <label class="form-label">{{ t('scripts.desc') }}</label>
        <el-input v-model="form.desc" type="textarea" :rows="2" maxlength="200" />
      </div>

      <div class="files-head">
        <label class="form-label">{{ t('scripts.files') }}</label>
        <div class="spacer" />
        <el-button size="small" :icon="DocumentAdd" @click="addFile">{{ t('scripts.addFile') }}</el-button>
      </div>
      <div v-for="(f, i) in files" :key="i" class="file-row">
        <div class="file-head">
          <el-input v-model="f.path" :placeholder="i === 0 ? 'main.js' : t('scripts.filePh')" class="mono file-path" size="small" />
          <el-button size="small" :icon="Delete" text type="danger" :disabled="files.length <= 1" @click="removeFile(i)" />
        </div>
        <el-input v-model="f.content" type="textarea" :rows="8" class="mono code" spellcheck="false" :placeholder="t('scripts.codePh')" />
      </div>
      <div class="form-hint">{{ t('scripts.entryAutoHint') }}</div>

      <div class="form-item">
        <label class="form-label">{{ t('scripts.startArgs') }}</label>
        <el-input v-model="form.startArgs" placeholder="serve / scan --only-missing" class="mono" />
      </div>
      <div class="form-hint">{{ t('scripts.argsHint') }}</div>

      <div class="form-actions">
        <el-button @click="router.push('/scripts')">{{ t('scripts.cancel') }}</el-button>
        <el-button type="primary" :loading="creating" @click="create">{{ t('scripts.create') }}</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scripts-view {
  padding: 24px;
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.mono {
  font-family: Consolas, 'Courier New', monospace;
}
.state {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px;
}
.empty {
  text-align: center;
  padding: 60px 16px;
  line-height: 2;
}
.empty-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.page-title {
  margin: 0;
  font-size: 16px;
  color: var(--el-text-color-primary);
}

/* ---- 卡片 ---- */
.card-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
}
.script-card.clickable {
  cursor: pointer;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-name {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  margin: 8px 0;
  min-height: 38px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.card-ops {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 10px;
  min-height: 46px;
}
.status-output {
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-regular);
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  padding: 10px 12px;
  border-radius: 4px;
  max-height: 50vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  min-height: 60px;
}

/* ---- 新建表单 ---- */
.create-form {
  max-width: 860px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.form-row .form-item {
  flex: 1 1 220px;
}
.form-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  font-weight: 600;
}
.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: -8px;
}
.files-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.file-row {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.file-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.file-path {
  flex: 1 1 220px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.import-box {
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.import-row {
  display: flex;
  gap: 8px;
}
.import-divider {
  margin: 6px 0 0;
}
.status-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 80px;
}
.status-sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.status-proc {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.status-output {
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-regular);
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  padding: 10px 12px;
  border-radius: 4px;
  max-height: 34vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  min-height: 42px;
}
.code :deep(textarea) {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 13px;
}
</style>
