<script setup lang="ts">
// Caselog view — the personal review workbench (docs/caselog v3.3). No tabs; two
// views switched by state:
//   数据 data (default): sync overview — host → project → session counts, today's
//     new as a red badge; unique session = host-project-session (also the sync unit).
//   阅读 read: entered by clicking a host-project card; left pane is that
//     host-project's session history → SessionTurn timeline → 记情景 action.
// caselog data ALWAYS lives on the machine running the server; API calls never
// inject X-Host.
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, BookCheck, Bot, Database, FileText, Maximize2, MessageSquareText, Minimize2, PenLine, RefreshCw } from 'lucide-vue-next';
import { api } from '../api';
import SessionTurn from '../components/SessionTurn.vue';
import type { CaselogFlow, CaselogHostStat, CaselogSessionRead, CaselogSessionSummary, TranscriptTurn } from '../types/tool';

const { t } = useI18n();
const view = ref<'data' | 'read'>('data');

// Fullscreen for the whole app. State is driven by the fullscreenchange event (the
// request itself can reject, e.g. inside an iframe without allow="fullscreen").
const isFullscreen = ref(false);
function onFsChange(): void {
	isFullscreen.value = document.fullscreenElement !== null;
}
function toggleFullscreen(): void {
	if (document.fullscreenElement) {
		void document.exitFullscreen().catch(() => { /* already exited */ });
	} else {
		document.documentElement.requestFullscreen()
			.catch((e: unknown) => console.error('[caselog] requestFullscreen failed:', e));
	}
}

// ══════════════════ data tab (sync overview) ══════════════════

const stats = ref<CaselogHostStat[]>([]);
const statsLoading = ref(false);

async function loadStats(): Promise<void> {
	statsLoading.value = true;
	try {
		stats.value = await api.caselogStats();
	} catch {
		stats.value = [];
	} finally {
		statsLoading.value = false;
	}
}

/** Jump from a data-tab project card into the reading tab scoped to that host-project. */
function openHostProject(host: string, project: string): void {
	hostFilter.value = host;
	projectFilter.value = project;
	view.value = 'read';
	void loadSessions();
}

/** Back to the data overview (refresh stats so today's badges are current). */
function backToData(): void {
	view.value = 'data';
	void loadStats();
}

/** True when the session was created today (local time) — drives the "new" badge. */
function isToday(ms: number | null | undefined): boolean {
	if (typeof ms !== 'number' || ms <= 0) return false;
	const d = new Date(ms);
	const n = new Date();
	return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

/** Last path segment of a zcode project directory (handles both / and \). */
function basename(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

// ══════════════════ reading view ══════════════════

const hostFilter = ref<string>('');   // set when entering from the data view
const projectFilter = ref<string>(''); // set when entering from the data view
const sessions = ref<CaselogSessionSummary[]>([]);
const reading = ref<CaselogSessionRead | null>(null);
const currentHost = ref('');
const currentId = ref('');
const listLoading = ref(false);
const readLoading = ref(false);
const syncing = ref(false);
const syncMsg = ref('');
const openAgents = ref<string[]>([]);

async function loadSessions(): Promise<void> {
	listLoading.value = true;
	try {
		sessions.value = await api.caselogSessions(hostFilter.value || undefined, projectFilter.value || undefined);
	} catch {
		sessions.value = [];
	} finally {
		listLoading.value = false;
	}
}

/** Sync one host / the current filter / everything ('all' from the data view). */
async function sync(hostArg?: string): Promise<void> {
	syncing.value = true;
	syncMsg.value = '';
	try {
		const host = hostArg ?? (hostFilter.value || undefined);
		const r = await api.caselogSync(host);
		syncMsg.value = r.results.map((x) => `${x.host}: ${x.ok ? `+${x.sessions}` : x.error}`).join('  ·  ');
		await loadSessions();
		await loadStats();
	} catch (e) {
		syncMsg.value = (e as Error).message;
	} finally {
		syncing.value = false;
	}
}

async function openSession(host: string, id: string): Promise<void> {
	currentHost.value = host;
	currentId.value = id;
	readLoading.value = true;
	reading.value = null;
	openAgents.value = [];
	selectedTurns.value = new Set();
	capMsg.value = '';
	try {
		reading.value = await api.caselogReadSession(host, id);
		const first = reading.value?.main?.turns[0];
		capContent.value = first?.user.slice(0, 400) ?? '';
	} finally {
		readLoading.value = false;
	}
}

function fmtDate(ms: number | null | undefined): string {
	return typeof ms === 'number' && ms > 0
		? new Date(ms).toLocaleDateString() + ' ' + new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		: '—';
}

// interleave subagent flows at their spawn position (same rule as SessionsView)
interface TimelineTurn { kind: 'turn'; turn: TranscriptTurn; seq: number }
interface TimelineAgent { kind: 'agent'; flow: CaselogFlow }
const timeline = computed<{ items: (TimelineTurn | TimelineAgent)[]; orphans: CaselogFlow[] }>(() => {
	const main = reading.value?.main;
	const agents = [...(reading.value?.subagents ?? [])].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
	if (!main) return { items: [], orphans: agents };
	const turns = main.turns;
	const items: (TimelineTurn | TimelineAgent)[] = [];
	let ai = 0;
	turns.forEach((turn, i) => {
		items.push({ kind: 'turn', turn, seq: i + 1 });
		const nextTs = turns[i + 1]?.ts ?? null;
		while (ai < agents.length && agents[ai]!.startedAt) {
			const st = agents[ai]!.startedAt!;
			if (nextTs === null || st < nextTs) {
				items.push({ kind: 'agent', flow: agents[ai]! });
				ai += 1;
			} else break;
		}
	});
	return { items, orphans: agents.slice(ai) };
});

// ── turn selection (edit mode): tick turns in the reader, range string derives ──
const selectedTurns = ref<Set<number>>(new Set());

function toggleTurn(seq: number): void {
	const next = new Set(selectedTurns.value);
	if (!next.delete(seq)) next.add(seq);
	selectedTurns.value = next;
}

/** Collapse {1,2,3,7} → "1-3,7" (stored in scenario_sessions.seq_range). */
function formatRanges(sel: Set<number>): string {
	const nums = [...sel].sort((a, b) => a - b);
	const parts: string[] = [];
	let i = 0;
	while (i < nums.length) {
		let j = i;
		while (j + 1 < nums.length && nums[j + 1] === nums[j]! + 1) j += 1;
		parts.push(i === j ? String(nums[i]) : `${nums[i]}-${nums[j]}`);
		i = j + 1;
	}
	return parts.join(',');
}

const seqRangeLabel = computed(() => {
	if (selectedTurns.value.size === 0) return '';
	return t('caselog.turnsPicked', { ranges: formatRanges(selectedTurns.value) });
});

// ══════════════════ edit pane + immersive fullscreen ══════════════════

// EDIT: splits the reading area — reader on the left, scenario editor top-right,
// note-capture bottom-right. Shell chrome untouched.
const editing = ref(false);

function toggleEditing(): void {
	editing.value = !editing.value;
	if (editing.value) {
		scForm.value = { title: '', keywords: '', content: '', category: '' };
		selectedTurns.value = new Set();
		const n = reading.value?.main?.turns.length ?? 0;
		rangeFrom.value = 1;
		rangeTo.value = Math.max(1, n);
	}
}

// toolbar range-pick: add [rangeFrom..rangeTo] to the selection (merges with hand-picked)
const rangeFrom = ref(1);
const rangeTo = ref(1);

function pickRange(): void {
	const n = reading.value?.main?.turns.length ?? 0;
	const from = Math.max(1, Math.min(rangeFrom.value, rangeTo.value, n));
	const to = Math.min(n, Math.max(rangeFrom.value, rangeTo.value));
	const next = new Set(selectedTurns.value);
	for (let i = from; i <= to; i++) next.add(i);
	selectedTurns.value = next;
}

function pickAll(): void {
	const n = reading.value?.main?.turns.length ?? 0;
	selectedTurns.value = new Set(Array.from({ length: n }, (_, i) => i + 1));
}

function pickNone(): void {
	selectedTurns.value = new Set();
}

// IMMERSIVE FULLSCREEN: hides the app shell (sidebar + header via body.caselog-immerse
// in App.vue) and the session list, so the reader takes the whole viewport.
const immersive = ref(false);

function toggleImmersive(): void {
	immersive.value = !immersive.value;
	document.body.classList.toggle('caselog-immerse', immersive.value);
}

const scSaving = ref(false);
const scMsg = ref('');
const scForm = ref({ title: '', keywords: '', content: '', category: '' });

async function saveScenario(): Promise<void> {
	if (!scForm.value.title.trim() || !currentId.value) return;
	scSaving.value = true;
	scMsg.value = '';
	try {
		const n = reading.value?.main?.turns.length ?? 0;
		const range = selectedTurns.value.size > 0 ? formatRanges(selectedTurns.value) : `1-${n}`;
		await api.caselogSaveScenario({
			...scForm.value,
			pointers: [{
				host: currentHost.value,
				sessionId: currentId.value,
				agentId: '',
				seqRange: range,
			}],
		});
		scMsg.value = t('caselog.scSaved');
		scForm.value = { ...scForm.value, title: '', keywords: '', content: '' };
		selectedTurns.value = new Set();
	} catch (e) {
		scMsg.value = (e as Error).message;
	} finally {
		scSaving.value = false;
	}
}

// Note capture (bottom-right editor): input area seeded with an excerpt of the
// current session; whatever the user leaves here is written to ~/.knowledge/notes.
const capName = ref('');
const capContent = ref('');
const capMsg = ref('');
const capSaving = ref(false);

async function captureNote(): Promise<void> {
	if (!reading.value) return;
	capSaving.value = true;
	capMsg.value = '';
	try {
		const base = capName.value.trim() || `note-${new Date().toISOString().slice(0, 10)}`;
		const name = base.toLowerCase().endsWith('.md') ? base : `${base}.md`;
		const head = reading.value.session.title || currentId.value;
		const content = `# ${head}\n\n> ${t('caselog.source')}: ${currentHost.value} / ${currentId.value}\n\n${capContent.value}\n`;
		await api.caselogSaveNote(name, content);
		capMsg.value = t('caselog.noteSaved');
	} catch (e) {
		capMsg.value = (e as Error).message;
	} finally {
		capSaving.value = false;
	}
}

onMounted(async () => {
	isFullscreen.value = document.fullscreenElement !== null;
	document.addEventListener('fullscreenchange', onFsChange);
	await loadStats();
	await loadSessions();
});

onUnmounted(() => {
	document.removeEventListener('fullscreenchange', onFsChange);
	document.body.classList.remove('caselog-immerse');
});
</script>

<template>
	<div class="caselog-view">
		<!-- ═══ 数据（默认视图）═══ -->
		<div v-if="view === 'data'" class="pane-pad">
			<div class="stats-tools">
				<el-button size="small" :loading="syncing" @click="sync('all')">
					<el-icon v-if="!syncing"><RefreshCw /></el-icon>&nbsp;{{ t('caselog.syncAll') }}
				</el-button>
				<span class="stats-total">{{ t('caselog.statsTotal', { hosts: stats.length, sessions: stats.reduce((n, h) => n + h.total, 0) }) }}</span>
			</div>
			<div v-if="syncMsg" class="sync-msg">{{ syncMsg }}</div>
			<div v-if="statsLoading" class="state">{{ t('common.loading') }}</div>
			<div v-else-if="stats.length === 0" class="state">{{ t('caselog.emptyStats') }}</div>
			<section v-for="h in stats" v-else :key="h.host" class="group">
				<div class="group-head">
					<h2 class="group-title">{{ h.host }} · {{ t('caselog.sessionsCount', { n: h.total }) }}</h2>
					<el-tag v-if="h.today" size="small" type="danger" effect="dark">+{{ h.today }}</el-tag>
				</div>
				<div class="card-grid">
					<div
						v-for="p in h.projects" :key="p.project" class="proj-card"
						@click="openHostProject(h.host, p.project)"
					>
						<div class="proj-card-head">
							<span class="proj-card-name">{{ basename(p.project) }}</span>
							<el-tag v-if="p.today" size="small" type="danger" effect="dark">+{{ p.today }}</el-tag>
						</div>
						<div class="proj-card-path" :title="p.project">{{ p.project }}</div>
						<div class="proj-card-meta">{{ t('caselog.sessionsCount', { n: p.total }) }}</div>
					</div>
				</div>
			</section>
		</div>

		<!-- ═══ 阅读（从数据卡片进入）═══ -->
		<div v-else class="read-wrap">
			<div class="read-topbar" v-show="!immersive">
				<el-button size="small" text @click="backToData()">
					<el-icon><ArrowLeft /></el-icon>&nbsp;{{ t('caselog.backToData') }}
				</el-button>
				<Database :size="13" class="read-top-ico" />
				<span class="read-top-proj" :title="projectFilter">{{ basename(projectFilter) }}</span>
			</div>
			<div class="read-split">
					<aside v-show="!immersive" class="list-pane">
						<div v-if="listLoading" class="state">{{ t('common.loading') }}</div>
						<div v-else-if="sessions.length === 0" class="state">{{ t('caselog.emptySessions') }}</div>
						<template v-else>
							<div
								v-for="s in sessions" :key="s.host + s.id" class="sess-row"
								:class="{ active: s.id === currentId, dead: !s.hasTranscript }"
								@click="s.hasTranscript && openSession(s.host, s.id)"
							>
								<el-tag v-if="isToday(s.time_created)" size="small" type="danger" effect="dark" class="sess-badge">{{ t('caselog.newBadge') }}</el-tag>
								<el-icon class="sess-ico"><MessageSquareText /></el-icon>
								<div class="sess-main">
									<div class="sess-title">{{ s.title || t('session.untitled') }}</div>
									<div class="sess-id"><el-tag size="small" effect="plain">{{ s.host }}</el-tag> {{ s.id }}</div>
								</div>
								<span class="sess-date">{{ fmtDate(s.time_updated) }}</span>
							</div>
						</template>
					</aside>

					<section class="reader-pane">
						<div v-if="readLoading" class="state">{{ t('common.loading') }}</div>
						<div v-else-if="!reading" class="state">{{ t('session.pickOne') }}</div>
						<template v-else>
							<div class="reader-head">
								<div class="reader-title">{{ reading.session.title || reading.session.id }}</div>
								<div class="reader-meta">
									<el-tag size="small" type="info">{{ reading.host }} / {{ reading.session.id }}</el-tag>
									<el-tag v-if="reading.main" size="small">{{ t('session.main') }} {{ reading.main.turns.length }} {{ t('session.turnUnit') }}</el-tag>
									<el-tag v-if="reading.subagents.length" size="small" type="warning">{{ t('session.subagents') }} {{ reading.subagents.length }}</el-tag>
									<span class="reader-spacer" />
									<el-button size="small" :type="editing ? 'primary' : 'default'" plain @click="toggleEditing()">
										<el-icon><PenLine /></el-icon>&nbsp;{{ t('caselog.edit') }}
									</el-button>
									<el-button size="small" :type="immersive ? 'primary' : 'default'" plain @click="toggleImmersive()">
										<el-icon><component :is="immersive ? Minimize2 : Maximize2" /></el-icon>&nbsp;{{ t('caselog.fullscreen') }}
									</el-button>
								</div>
							</div>
							<template v-if="reading.main">
								<template v-for="(item, i) in timeline.items" :key="i">
									<div v-if="item.kind === 'turn'" class="turn-wrap" :class="{ picked: selectedTurns.has(item.seq) }">
										<el-checkbox
											v-if="editing"
											:model-value="selectedTurns.has(item.seq)"
											class="turn-pick"
											@change="toggleTurn(item.seq)"
										/>
										<div class="turn-seq">{{ item.seq }}</div>
										<SessionTurn :turn="item.turn" />
									</div>
									<div v-else class="agent-inline">
										<button class="agent-head" type="button" @click="openAgents.includes(item.flow.id) ? openAgents.splice(openAgents.indexOf(item.flow.id), 1) : openAgents.push(item.flow.id)">
											<el-icon><Bot /></el-icon>
											<span class="agent-desc" :title="item.flow.description">{{ item.flow.description || item.flow.id }}</span>
											<span class="agent-stats">{{ item.flow.turns.length }} {{ t('session.turnUnit') }} · {{ item.flow.stats.toolCalls }} {{ t('session.tools') }}</span>
											<span class="proc-arrow">{{ openAgents.includes(item.flow.id) ? '▾' : '▸' }}</span>
										</button>
										<div v-if="openAgents.includes(item.flow.id)" class="agent-body">
											<SessionTurn v-for="(turn, ti) in item.flow.turns" :key="ti" :turn="turn" />
										</div>
									</div>
								</template>
							</template>
							<div v-else class="state">{{ t('session.noMain') }}</div>
						</template>
				</section>

				<!-- ═══ 编辑面板（编辑模式）：右上情景编辑框 + 右下笔记输入库 ═══ -->
				<aside v-if="editing" class="edit-pane">
					<div class="edit-card sc-card">
						<div class="sc-toolbar">
							<el-input-number v-model="rangeFrom" :min="1" size="small" controls-position="right" class="tb-num" />
							<span class="tb-dash">—</span>
							<el-input-number v-model="rangeTo" :min="1" size="small" controls-position="right" class="tb-num" />
							<el-button size="small" @click="pickRange()">{{ t('caselog.pickRange') }}</el-button>
							<el-button size="small" @click="pickAll()">{{ t('caselog.pickAll') }}</el-button>
							<el-button size="small" @click="pickNone()">{{ t('caselog.pickNone') }}</el-button>
						</div>
						<div class="edit-card-head">
							<el-icon><BookCheck /></el-icon>
							<span>{{ t('caselog.scPanel') }}</span>
							<span class="sc-foot-spacer" />
							<span class="turns-picked" :title="seqRangeLabel">{{ seqRangeLabel || t('caselog.turnsNone') }}</span>
						</div>
						<el-input v-model="scForm.title" :placeholder="t('caselog.fTitleHint')" class="sc-field" />
						<el-input v-model="scForm.keywords" :placeholder="t('caselog.fKeywordsHint')" size="small" class="sc-field" />
						<el-input v-model="scForm.content" type="textarea" :rows="5" resize="none" :placeholder="t('caselog.fContentHint')" class="sc-content-field" />
						<div class="sc-foot">
							<span v-if="scMsg" class="sc-msg">{{ scMsg }}</span>
							<span class="sc-foot-spacer" />
							<el-button size="small" type="primary" :loading="scSaving" :disabled="!scForm.title.trim()" @click="saveScenario()">
								{{ t('common.save') }}
							</el-button>
						</div>
					</div>
					<div class="edit-card note-card">
						<div class="edit-card-head">
							<el-icon><FileText /></el-icon>
							<span>{{ t('caselog.notePanel') }}</span>
							<span class="sc-foot-spacer" />
							<el-input v-model="capName" size="small" :placeholder="`note-${new Date().toISOString().slice(0, 10)}`" class="note-name-input" />
							<el-button size="small" type="primary" plain :loading="capSaving" @click="captureNote()">{{ t('caselog.capture') }}</el-button>
						</div>
						<el-input v-model="capContent" type="textarea" resize="none" :placeholder="t('caselog.noteInputHint')" class="note-input" />
						<div v-if="capMsg" class="sc-msg">{{ capMsg }}</div>
					</div>
				</aside>
			</div>
		</div>

		<!-- fullscreen toggle, pinned top-right of the page -->
		<el-button class="cl-fullscreen" size="small" text @click="toggleFullscreen()">
			<el-icon><component :is="isFullscreen ? Minimize2 : Maximize2" /></el-icon>
		</el-button>
	</div>
</template>

<style scoped>
.caselog-view {
	position: relative;
	height: calc(100vh - 64px);
	padding: 4px 16px 0;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
}
.cl-fullscreen { position: absolute; top: 4px; right: 0; z-index: 5; }
.read-wrap {
	flex: 1 1 auto; min-height: 0;
	display: flex; flex-direction: column;
}
.read-topbar {
	display: flex; align-items: center; gap: 6px;
	padding: 2px 0 8px;
}
.read-top-ico { color: var(--el-text-color-secondary); flex-shrink: 0; }
.read-top-proj {
	font-size: 13px; font-weight: 600;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.state { color: var(--el-text-color-secondary); font-size: 13px; padding: 16px; }
.pane-pad { overflow-y: auto; height: 100%; padding: 4px 8px 24px; }
.sync-msg { font-size: 11px; color: var(--el-text-color-secondary); padding: 4px 10px; }

.stats-tools { display: flex; align-items: center; gap: 10px; padding: 4px 6px 12px; }
.stats-total { font-size: 12px; color: var(--el-text-color-secondary); }
.group { margin-bottom: 20px; }
.group-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
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
.proj-card {
	border: 1px solid var(--el-border-color-lighter);
	border-radius: 8px;
	padding: 12px 14px;
	cursor: pointer;
	background: var(--el-bg-color);
	transition: border-color 0.15s, background 0.15s;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.proj-card:hover { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
.proj-card-head { display: flex; align-items: center; gap: 8px; }
.proj-card-name { font-size: 14px; font-weight: 600; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proj-card-path {
	font-size: 11px; color: var(--el-text-color-secondary);
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.proj-card-meta { font-size: 12px; color: var(--el-text-color-secondary); }

.read-split { flex: 1 1 auto; min-height: 0; display: flex; gap: 12px; }

/* ---- edit pane (edit mode: right of the reader) ---- */
.edit-pane {
	flex: 0 0 400px; min-height: 0;
	display: flex; flex-direction: column; gap: 12px;
}
.edit-card {
	display: flex; flex-direction: column; gap: 8px; padding: 12px;
	background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 8px;
}
.sc-card { flex: 1 1 0; min-height: 0; }
.note-card { flex: 1 1 0; min-height: 0; }
.sc-toolbar {
	display: flex; align-items: center; gap: 6px;
	padding-bottom: 8px; border-bottom: 1px dashed var(--el-border-color-lighter);
}
.tb-num { flex: 0 0 74px; }
.tb-dash { color: var(--el-text-color-secondary); }
.edit-card-head {
	display: flex; align-items: center; gap: 6px;
	font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary);
}
.sc-field { flex: 0 0 auto; }
.sc-content-field { flex: 1 1 auto; min-height: 0; }
.sc-content-field :deep(textarea) { height: 100%; }
.sc-foot { display: flex; align-items: center; gap: 8px; }
.sc-foot-spacer { flex: 1 1 auto; }
.sc-msg { font-size: 11px; color: var(--el-color-success); }
.turns-picked { font-size: 11px; font-weight: normal; color: var(--el-color-primary); }
.note-name-input { flex: 0 0 180px; }
.note-input { flex: 1 1 auto; min-height: 0; }
.note-input :deep(textarea) { height: 100%; }

/* ---- turn picking (edit mode checkboxes in the reader) ---- */
.turn-wrap { position: relative; margin-bottom: 14px; }
.turn-wrap.picked > :deep(.turn) {
	outline: 2px solid var(--el-color-primary);
	outline-offset: 2px;
	border-radius: 8px;
}
.turn-seq {
	position: absolute; top: 8px; left: -22px; z-index: 1;
	font-size: 10px; color: var(--el-text-color-secondary);
}
.turn-pick {
	position: absolute; top: -10px; right: 10px; z-index: 2;
	height: 18px;
	background: var(--el-bg-color); border-radius: 4px; padding: 0 2px;
}
.list-pane {
	flex: 0 0 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px;
	background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 8px;
}
.sess-row {
	position: relative;
	display: flex; align-items: center; gap: 10px; padding: 8px 10px;
	border: 1px solid transparent; border-radius: 6px; cursor: pointer;
	transition: background 0.15s, border-color 0.15s;
}
.sess-badge {
	position: absolute; top: -7px; right: 8px; z-index: 1;
	font-size: 10px; line-height: 14px; padding: 0 4px; border-radius: 4px;
}
.sess-row:hover { background: var(--el-fill-color-lighter); }
.sess-row.active { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
.sess-row.dead { cursor: default; opacity: 0.55; }
.sess-ico { color: var(--el-text-color-secondary); flex-shrink: 0; }
.sess-main { flex: 1 1 auto; min-width: 0; }
.sess-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sess-id { font-size: 10px; color: var(--el-text-color-secondary); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sess-date { font-size: 10px; color: var(--el-text-color-secondary); flex-shrink: 0; }

.reader-pane {
	flex: 1 1 auto; min-width: 0; overflow-y: auto; padding: 12px 16px 24px;
	background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 8px;
}
.reader-head { margin-bottom: 14px; }
.reader-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
.reader-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.reader-spacer { flex: 1 1 auto; }
.reader-pane .turn-wrap > :deep(.turn) { margin-bottom: 0; }
.agent-inline {
	border: 1px dashed var(--el-color-warning-light-5); border-left: 3px solid var(--el-color-warning);
	border-radius: 8px; background: var(--el-color-warning-light-9); margin-bottom: 14px;
}
.agent-head {
	display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: transparent;
	padding: 8px 12px; font-size: 12px; color: var(--el-text-color-regular); cursor: pointer; text-align: left;
}
.agent-head:hover { color: var(--el-color-primary); }
.agent-desc { flex: 1 1 auto; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-stats { flex-shrink: 0; font-size: 11px; color: var(--el-text-color-secondary); }
.proc-arrow { color: var(--el-text-color-secondary); flex-shrink: 0; }
.agent-body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px; }
</style>
