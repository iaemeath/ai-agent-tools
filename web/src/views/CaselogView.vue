<script setup lang="ts">
// Caselog view — the personal review workbench (docs/caselog v3.3). Three tabs:
//   阅读 reading: host filter + sync + session list → SessionTurn timeline with
//     interleaved subagents (same interleave as SessionsView) → 记情景 / 记笔记 actions
//   情景 scenarios: knowledge.db scenario cards (delete = soft)
//   笔记 notes: MD capture channel — editor + export to the Obsidian vault dir
// caselog data ALWAYS lives on the machine running the server; API calls never
// inject X-Host.
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Bot, BookCheck, FileText, MessageSquareText, RefreshCw } from 'lucide-vue-next';
import { api } from '../api';
import SessionTurn from '../components/SessionTurn.vue';
import type { CaselogFlow, CaselogNote, CaselogScenario, CaselogSessionRead, CaselogSessionSummary, TranscriptTurn } from '../types/tool';

const { t } = useI18n();
const tab = ref<'read' | 'scenarios' | 'notes'>('read');

// ══════════════════ reading tab ══════════════════

const hosts = ref<string[]>([]);
const hostFilter = ref<string>('');   // '' = all hosts
const sessions = ref<CaselogSessionSummary[]>([]);
const reading = ref<CaselogSessionRead | null>(null);
const currentHost = ref('');
const currentId = ref('');
const listLoading = ref(false);
const readLoading = ref(false);
const syncing = ref(false);
const syncMsg = ref('');
const openAgents = ref<string[]>([]);

async function loadHosts(): Promise<void> {
	try {
		hosts.value = (await api.caselogHosts()).hosts;
	} catch { hosts.value = ['local']; }
}

async function loadSessions(): Promise<void> {
	listLoading.value = true;
	try {
		sessions.value = await api.caselogSessions(hostFilter.value || undefined);
	} catch {
		sessions.value = [];
	} finally {
		listLoading.value = false;
	}
}

async function sync(): Promise<void> {
	syncing.value = true;
	syncMsg.value = '';
	try {
		const r = await api.caselogSync(hostFilter.value || undefined);
		syncMsg.value = r.results.map((x) => `${x.host}: ${x.ok ? `+${x.sessions}` : x.error}`).join('  ·  ');
		await loadHosts();
		await loadSessions();
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
	try {
		reading.value = await api.caselogReadSession(host, id);
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
interface TimelineTurn { kind: 'turn'; turn: TranscriptTurn; }
interface TimelineAgent { kind: 'agent'; flow: CaselogFlow; }
const timeline = computed<{ items: (TimelineTurn | TimelineAgent)[]; orphans: CaselogFlow[] }>(() => {
	const main = reading.value?.main;
	const agents = [...(reading.value?.subagents ?? [])].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
	if (!main) return { items: [], orphans: agents };
	const turns = main.turns;
	const items: (TimelineTurn | TimelineAgent)[] = [];
	let ai = 0;
	turns.forEach((turn, i) => {
		items.push({ kind: 'turn', turn });
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

// ══════════════════ scenario dialog ══════════════════

const scVisible = ref(false);
const scSaving = ref(false);
const scForm = ref({ title: '', keywords: '', content: '', category: '', seqFrom: 1, seqTo: 1 });

function openScenarioDialog(): void {
	const n = reading.value?.main?.turns.length ?? 0;
	scForm.value = { title: '', keywords: '', content: '', category: '', seqFrom: 1, seqTo: Math.max(1, n) };
	scVisible.value = true;
}

async function saveScenario(): Promise<void> {
	if (!scForm.value.title.trim()) return;
	scSaving.value = true;
	try {
		await api.caselogSaveScenario({
			...scForm.value,
			pointers: [{
				host: currentHost.value,
				sessionId: currentId.value,
				agentId: '',
				seqRange: `${scForm.value.seqFrom}-${scForm.value.seqTo}`,
			}],
		});
		scVisible.value = false;
		tab.value = 'scenarios';
		await loadScenarios();
	} finally {
		scSaving.value = false;
	}
}

const scenarios = ref<CaselogScenario[]>([]);
async function loadScenarios(): Promise<void> {
	try { scenarios.value = await api.caselogScenarios(); } catch { scenarios.value = []; }
}
async function removeScenario(id: string): Promise<void> {
	await api.caselogDeleteScenario(id);
	await loadScenarios();
}

// ══════════════════ notes tab ══════════════════

const notes = ref<CaselogNote[]>([]);
const noteName = ref('');
const noteContent = ref('');
const noteDirty = ref(false);
const noteMsg = ref('');

async function loadNotes(): Promise<void> {
	try { notes.value = await api.caselogNotes(); } catch { notes.value = []; }
}

async function openNote(name: string): Promise<void> {
	if (noteDirty.value && !confirm(t('caselog.noteDirtyConfirm'))) return;
	try {
		const r = await api.caselogReadNote(name);
		noteName.value = r.name;
		noteContent.value = r.raw;
		noteDirty.value = false;
		noteMsg.value = '';
	} catch { /* ignore */ }
}

function newNote(): void {
	noteName.value = `note-${new Date().toISOString().slice(0, 10)}.md`;
	noteContent.value = `# ${t('caselog.untitledNote')}\n\n`;
	noteDirty.value = false;
}

/** Seed the note editor from the session being read (capture channel → Obsidian). */
function captureToNote(): void {
	const head = reading.value?.session.title || currentId.value;
	const first = reading.value?.main?.turns[0];
	noteName.value = `note-${new Date().toISOString().slice(0, 10)}.md`;
	noteContent.value = `# ${head}\n\n> ${t('caselog.source')}: ${currentHost.value} / ${currentId.value}\n\n${first?.user.slice(0, 400) ?? ''}\n`;
	tab.value = 'notes';
	noteDirty.value = true;
	noteMsg.value = '';
}

async function saveNote(): Promise<void> {
	if (!noteName.value) return;
	try {
		await api.caselogSaveNote(noteName.value, noteContent.value);
		noteDirty.value = false;
		noteMsg.value = t('caselog.noteSaved');
		await loadNotes();
	} catch (e) {
		noteMsg.value = (e as Error).message;
	}
}

async function exportNote(): Promise<void> {
	try {
		const r = await api.caselogExportNotes(noteName.value || undefined);
		noteMsg.value = r.copied.length ? t('caselog.exported', { n: r.copied.length }) : t('caselog.noVault');
	} catch (e) {
		noteMsg.value = (e as Error).message;
	}
}

async function removeNote(name: string): Promise<void> {
	await api.caselogDeleteNote(name);
	if (noteName.value === name) { noteName.value = ''; noteContent.value = ''; }
	await loadNotes();
}

onMounted(async () => {
	await loadHosts();
	await loadSessions();
	await loadScenarios();
	await loadNotes();
});
</script>

<template>
	<div class="caselog-view">
		<el-tabs v-model="tab" class="cl-tabs">
			<!-- ═══ 阅读 ═══ -->
			<el-tab-pane name="read">
				<template #label><el-icon><MessageSquareText /></el-icon>&nbsp;{{ t('caselog.tabRead') }}</template>
				<div class="read-split">
					<aside class="list-pane">
						<div class="list-tools">
							<el-select v-model="hostFilter" size="small" style="width: 130px" @change="loadSessions">
								<el-option :label="t('caselog.allHosts')" value="" />
								<el-option v-for="h in hosts" :key="h" :label="h" :value="h" />
							</el-select>
							<el-button size="small" :loading="syncing" @click="sync()">
								<el-icon v-if="!syncing"><RefreshCw /></el-icon>&nbsp;{{ t('caselog.sync') }}
							</el-button>
						</div>
						<div v-if="syncMsg" class="sync-msg">{{ syncMsg }}</div>
						<div v-if="listLoading" class="state">{{ t('common.loading') }}</div>
						<div v-else-if="sessions.length === 0" class="state">{{ t('caselog.emptySessions') }}</div>
						<template v-else>
							<div
								v-for="s in sessions" :key="s.host + s.id" class="sess-row"
								:class="{ active: s.id === currentId, dead: !s.hasTranscript }"
								@click="s.hasTranscript && openSession(s.host, s.id)"
							>
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
									<el-button size="small" type="primary" plain @click="openScenarioDialog()">
										<el-icon><BookCheck /></el-icon>&nbsp;{{ t('caselog.toScenario') }}
									</el-button>
									<el-button size="small" plain @click="captureToNote()">
										<el-icon><FileText /></el-icon>&nbsp;{{ t('caselog.toNote') }}
									</el-button>
								</div>
							</div>
							<template v-if="reading.main">
								<template v-for="(item, i) in timeline.items" :key="i">
									<SessionTurn v-if="item.kind === 'turn'" :turn="item.turn" />
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
				</div>
			</el-tab-pane>

			<!-- ═══ 情景 ═══ -->
			<el-tab-pane name="scenarios">
				<template #label><el-icon><BookCheck /></el-icon>&nbsp;{{ t('caselog.tabScenarios') }}</template>
				<div class="pane-pad">
					<div v-if="scenarios.length === 0" class="state">{{ t('caselog.emptyScenarios') }}</div>
					<el-card v-for="s in scenarios" :key="s.id" class="sc-card" shadow="never">
						<div class="sc-head">
							<span class="sc-title">{{ s.title }}</span>
							<span class="sc-meta">
								{{ s.createdAt.slice(0, 10) }}
								<template v-if="s.editedCount"> · {{ t('caselog.edited', { n: s.editedCount }) }}</template>
								<el-popconfirm :title="t('caselog.deleteConfirm')" @confirm="removeScenario(s.id)">
									<template #reference><el-button size="small" text type="danger">{{ t('common.delete') }}</el-button></template>
								</el-popconfirm>
							</span>
						</div>
						<div v-if="s.keywords" class="sc-keywords">{{ s.keywords }}</div>
						<div class="sc-content">{{ s.content }}</div>
						<div v-for="(p, pi) in s.pointers" :key="pi" class="sc-ptr" @click="openSession(p.host, p.sessionId); tab = 'read'">
							{{ t('caselog.source') }}: {{ p.host }} / {{ p.sessionId.slice(0, 24) }}… [{{ p.seqRange }}]
						</div>
					</el-card>
				</div>
			</el-tab-pane>

			<!-- ═══ 笔记 ═══ -->
			<el-tab-pane name="notes">
				<template #label><el-icon><FileText /></el-icon>&nbsp;{{ t('caselog.tabNotes') }}</template>
				<div class="notes-split">
					<aside class="notes-list">
						<el-button size="small" style="width: 100%" @click="newNote()">{{ t('caselog.newNote') }}</el-button>
						<div
							v-for="n in notes" :key="n.name" class="note-row"
							:class="{ active: n.name === noteName }"
							@click="openNote(n.name)"
						>
							<FileText :size="14" style="flex-shrink: 0" />
							<span class="note-name">{{ n.name }}</span>
							<el-button size="small" text type="danger" class="note-del" @click.stop="removeNote(n.name)">✕</el-button>
						</div>
					</aside>
					<section class="notes-editor">
						<div class="notes-tools" v-if="noteName">
							<span class="note-name-cur">{{ noteName }}<span v-if="noteDirty"> *</span></span>
							<el-button size="small" type="primary" @click="saveNote()">{{ t('common.save') }}</el-button>
							<el-button size="small" @click="exportNote()">{{ t('caselog.exportObsidian') }}</el-button>
						</div>
						<div v-if="noteMsg" class="sync-msg">{{ noteMsg }}</div>
						<textarea v-if="noteName" v-model="noteContent" class="note-ta" @input="noteDirty = true" />
						<div v-else class="state">{{ t('caselog.pickNote') }}</div>
					</section>
				</div>
			</el-tab-pane>
		</el-tabs>

		<!-- scenario dialog: human draft → save (AI-post polish lands later, as candidates only) -->
		<el-dialog v-model="scVisible" :title="t('caselog.scenarioTitle')" width="640px">
			<el-form label-width="90px">
				<el-form-item :label="t('caselog.fTitle')">
					<el-input v-model="scForm.title" :placeholder="t('caselog.fTitleHint')" />
				</el-form-item>
				<el-form-item :label="t('caselog.fKeywords')">
					<el-input v-model="scForm.keywords" :placeholder="t('caselog.fKeywordsHint')" />
				</el-form-item>
				<el-form-item :label="t('caselog.fTurns')">
					<el-input-number v-model="scForm.seqFrom" :min="1" size="small" /> —
					<el-input-number v-model="scForm.seqTo" :min="scForm.seqFrom" size="small" />
				</el-form-item>
				<el-form-item :label="t('caselog.fContent')">
					<el-input v-model="scForm.content" type="textarea" :rows="8" :placeholder="t('caselog.fContentHint')" />
				</el-form-item>
			</el-form>
			<template #footer>
				<el-button @click="scVisible = false">{{ t('common.cancel') }}</el-button>
				<el-button type="primary" :loading="scSaving" :disabled="!scForm.title.trim()" @click="saveScenario()">{{ t('common.save') }}</el-button>
			</template>
		</el-dialog>
	</div>
</template>

<style scoped>
.caselog-view {
	height: calc(100vh - 64px);
	padding: 4px 16px 0;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
}
.cl-tabs { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.cl-tabs :deep(.el-tabs__content) { flex: 1 1 auto; min-height: 0; }
.cl-tabs :deep(.el-tab-pane) { height: 100%; }
.state { color: var(--el-text-color-secondary); font-size: 13px; padding: 16px; }
.pane-pad { overflow-y: auto; height: 100%; padding: 4px 8px 24px; }
.sync-msg { font-size: 11px; color: var(--el-text-color-secondary); padding: 4px 10px; }

.read-split { display: flex; gap: 12px; height: 100%; }
.list-pane {
	flex: 0 0 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px;
	background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 8px;
}
.list-tools { display: flex; gap: 6px; }
.sess-row {
	display: flex; align-items: center; gap: 10px; padding: 8px 10px;
	border: 1px solid transparent; border-radius: 6px; cursor: pointer;
	transition: background 0.15s, border-color 0.15s;
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
.reader-pane > :deep(.turn) { margin-bottom: 14px; }
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

.sc-card { margin-bottom: 10px; }
.sc-head { display: flex; align-items: baseline; gap: 10px; }
.sc-title { font-weight: 600; font-size: 14px; flex: 1 1 auto; }
.sc-meta { font-size: 11px; color: var(--el-text-color-secondary); flex-shrink: 0; }
.sc-keywords { font-size: 11px; color: var(--el-text-color-secondary); margin: 4px 0; }
.sc-content { font-size: 13px; white-space: pre-wrap; }
.sc-ptr { font-size: 11px; color: var(--el-color-primary); margin-top: 6px; cursor: pointer; }

.notes-split { display: flex; gap: 12px; height: 100%; }
.notes-list {
	flex: 0 0 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding: 8px;
	background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 8px;
}
.note-row {
	display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; cursor: pointer;
	font-size: 12px; color: var(--el-text-color-regular);
}
.note-row:hover { background: var(--el-fill-color-lighter); }
.note-row.active { background: var(--el-color-primary-light-9); }
.note-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-del { opacity: 0; }
.note-row:hover .note-del { opacity: 1; }
.notes-editor { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.notes-tools { display: flex; align-items: center; gap: 8px; padding: 4px 0 8px; }
.note-name-cur { flex: 1 1 auto; font-size: 13px; font-weight: 500; }
.note-ta {
	flex: 1 1 auto; resize: none; border: 1px solid var(--el-border-color-lighter); border-radius: 8px;
	padding: 12px; font-family: Consolas, Monaco, monospace; font-size: 13px; line-height: 1.7;
	background: var(--el-bg-color); color: var(--el-text-color-primary); outline: none;
}
.note-ta:focus { border-color: var(--el-color-primary-light-5); }
</style>
