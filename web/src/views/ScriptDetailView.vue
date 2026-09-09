<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import type { ScriptCard } from '../types/script';

/**
 * 脚本详情页：控制台三键（启动/查看状态/关闭）+ iframe 内嵌脚本自带页面。
 * 页面内容归脚本自己（/scripts-pages/<id>/<ui>），控制台只管进程与外壳。
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));

const card = ref<ScriptCard | null>(null);
const loading = ref(true);
const notFound = ref(false);
const now = ref(Date.now());
const iframeKey = ref(0);

async function loadCard() {
	try {
		card.value = await api.getScript(id.value);
		now.value = Date.now();
	} catch {
		if (!card.value) notFound.value = true; // 首次加载即失败才算不存在，轮询失败静默保留旧数据
	}
	loading.value = false;
}

const pageUrl = computed(() =>
	card.value?.ui ? `/scripts-pages/${encodeURIComponent(card.value.id)}/${card.value.ui}` : '',
);
function reloadPage() {
	iframeKey.value++;
}
function openNew() {
	if (pageUrl.value) window.open(pageUrl.value);
}

/* ---- 状态徽标 / 三键 ---- */
function statusTagType(s: ScriptCard['status']) {
	return s.status === 'running' ? 'success' : s.status === 'exited' ? (s.exitCode ? 'danger' : 'info') : 'info';
}
function statusLabel(s: ScriptCard['status']) {
	if (s.status === 'running') return t('scripts.statusRunning');
	if (s.status === 'exited') return s.exitCode ? `${t('scripts.statusExited')} (${s.exitCode})` : t('scripts.statusExitedOk');
	return t('scripts.statusIdle');
}
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

async function start() {
	try {
		await api.startScript(id.value);
		ElMessage.success(t('scripts.started', { name: card.value?.name ?? id.value }));
	} catch (e) {
		ElMessage.error((e as Error).message);
	}
	await loadCard();
}

async function stop() {
	try {
		await api.stopScript(id.value);
		ElMessage.success(t('scripts.stopped', { name: card.value?.name ?? id.value }));
	} catch (e) {
		ElMessage.error((e as Error).message);
	}
	await loadCard();
}

/* ---- 查看状态弹窗（与列表页同款三合一） ---- */
const statusDlg = ref(false);
const statusLoading = ref(false);
const statusRecent = ref('');
const statusOut = ref('');
const statusProcLine = computed(() => {
	const s = card.value?.status;
	if (!s || s.status === 'idle') return t('scripts.statusIdle');
	const base = `${statusLabel(s)}${s.pid ? ` · PID ${s.pid}` : ''}`;
	const dur = s.startedAt ? ` · ${t('scripts.runDur', { d: fmtDur(Math.max(0, now.value - s.startedAt)) })}` : '';
	return base + dur + (s.detached ? ` · ${t('scripts.detachedSvc')}` : '');
});

async function viewStatus() {
	statusRecent.value = '';
	statusOut.value = '';
	statusDlg.value = true;
	statusLoading.value = true;
	try {
		try {
			const log = await api.scriptLog(id.value, 0);
			const lines = log.lines.slice(-50).join('\n').trim();
			statusRecent.value = lines || t('scripts.statusEmpty');
		} catch {
			statusRecent.value = t('scripts.statusEmpty');
		}
		if (card.value?.args.status) {
			try {
				const r = await api.runScriptStatus(id.value);
				let text = r.output || t('scripts.statusEmpty');
				if (r.timedOut) text += `\n${t('scripts.statusTimeout')}`;
				statusOut.value = text;
			} catch (e) {
				statusOut.value = (e as Error).message;
			}
		}
	} finally {
		statusLoading.value = false;
		loadCard();
	}
}

loadCard();
const timer = setInterval(loadCard, 5000);
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="script-detail">
    <div class="toolbar">
      <el-button :icon="ArrowLeft" @click="router.push('/scripts')">{{ t('scripts.back') }}</el-button>
      <template v-if="card">
        <h2 class="page-title">{{ card.name }}</h2>
        <el-tooltip :content="statusTip(card.status)" :disabled="!statusTip(card.status)" placement="top">
          <el-tag size="small" :type="statusTagType(card.status)" disable-transitions>{{ statusLabel(card.status) }}</el-tag>
        </el-tooltip>
        <el-tag v-if="card.detached" size="small" type="warning" disable-transitions>{{ t('scripts.detachedSvc') }}</el-tag>
        <span v-if="card.desc" class="hint">{{ card.desc }}</span>
      </template>
      <div class="spacer" />
      <template v-if="card?.ui">
        <el-button :icon="Refresh" @click="reloadPage">{{ t('scripts.reloadPage') }}</el-button>
        <el-button @click="openNew">{{ t('scripts.openNew') }}</el-button>
      </template>
      <template v-if="card?.entry">
        <el-button type="success" plain :disabled="card.status.status === 'running'" @click="start">{{ t('scripts.start') }}</el-button>
        <el-button plain @click="viewStatus">{{ t('scripts.viewStatus') }}</el-button>
        <el-button type="danger" plain :disabled="card.status.status !== 'running'" @click="stop">{{ t('scripts.stop') }}</el-button>
      </template>
    </div>

    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <div v-else-if="notFound" class="state empty">{{ t('scripts.notFound') }}</div>
    <iframe v-else-if="pageUrl" :key="iframeKey" :src="pageUrl" class="page-frame" :title="card?.name || id" />
    <div v-else class="state empty">
      {{ t('scripts.noPageDetail') }}
      <div class="empty-sub">{{ t('scripts.pageOnlyHint') }}</div>
    </div>

    <!-- 查看状态弹窗：进程状态 + 最近输出 + 脚本状态参数输出 -->
    <el-dialog v-model="statusDlg" :title="`${card?.name ?? id} · ${t('scripts.viewStatus')}`" width="680px">
      <div v-loading="statusLoading" class="status-body">
        <div class="status-sec">
          <label class="form-label">{{ t('scripts.procLine') }}</label>
          <div class="mono status-proc">{{ statusProcLine }}</div>
        </div>
        <div class="status-sec">
          <label class="form-label">{{ t('scripts.recentOut') }}</label>
          <pre class="status-output">{{ statusRecent }}</pre>
        </div>
        <div v-if="card?.args.status" class="status-sec">
          <label class="form-label">{{ t('scripts.statusArgsOut') }}</label>
          <pre class="status-output">{{ statusOut || t('scripts.statusEmpty') }}</pre>
        </div>
      </div>
      <template #footer>
        <el-button @click="statusDlg = false">{{ t('scripts.close') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.script-detail {
  padding: 24px;
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.page-title {
  margin: 0;
  font-size: 16px;
  color: var(--el-text-color-primary);
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
.page-frame {
  flex: 1;
  width: 100%;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: #fff;
  box-sizing: border-box;
}
.form-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  font-weight: 600;
}
.mono {
  font-family: Consolas, 'Courier New', monospace;
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
</style>
