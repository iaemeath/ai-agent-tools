<script setup lang="ts">
// Sessions view — master-detail drilled in from Projects: LEFT = the project's
// session list (sqlite index: titles, timestamps), RIGHT = the selected session's
// reading pane. Subagent flows are INTERLEAVED into the main conversation right
// after the turn that spawned them (spawn time from the child session row falls
// between turn i's and turn i+1's timestamps), instead of a bottom pile.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, Bot, MessageSquareText } from 'lucide-vue-next';
import { api } from '../api';
import { useTool } from '../stores/tool';
import SessionTurn from '../components/SessionTurn.vue';
import type { SessionFlow, SessionRead, SessionSummary, TranscriptTurn } from '../types/tool';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { tool } = useTool();

const sessions = ref<SessionSummary[]>([]);
const reading = ref<SessionRead | null>(null);
const loading = ref(false);
const listLoading = ref(false);
const errorMsg = ref<string | null>(null);
/** Expanded inline subagent flows (values = flow id). */
const openAgents = ref<string[]>([]);

const project = computed(() => (typeof route.query.project === 'string' ? route.query.project : ''));
const sessionId = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''));

/** 400 = tool without transcript support — render as unsupported info, not an error. */
function classifyError(e: unknown): string {
	const msg = (e as Error).message;
	return msg.startsWith('400') ? `unsupported:${msg.slice(3).trim()}` : msg;
}

async function reload() {
	errorMsg.value = null;
	if (!project.value) return;
	// session list (left pane) — reload on tool change too
	listLoading.value = true;
	try {
		sessions.value = await api.listSessions(project.value, tool.value);
	} catch (e) {
		sessions.value = [];
	} finally {
		listLoading.value = false;
	}
	// reading pane (right)
	if (sessionId.value) {
		loading.value = true;
		reading.value = null;
		openAgents.value = [];
		try {
			reading.value = await api.readSession(sessionId.value, tool.value);
		} catch (e) {
			errorMsg.value = classifyError(e);
		} finally {
			loading.value = false;
		}
	} else {
		reading.value = null;
	}
}

onMounted(async () => {
	await reload();
	window.addEventListener('ai-tools:tool-change', reload);
});
onUnmounted(() => {
	window.removeEventListener('ai-tools:tool-change', reload);
});
watch(() => [project.value, sessionId.value], reload);

function openSession(id: string): void {
	router.push({ path: '/sessions', query: { project: project.value, id } });
}

function fmtDate(iso: string | null): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return isNaN(+d) ? '—' : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function basename(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

// ---- interleaving: main turns + subagent flows on one timeline ----

interface TimelineTurn { kind: 'turn'; turn: TranscriptTurn; }
interface TimelineAgent { kind: 'agent'; flow: SessionFlow; }

const timeline = computed<{ items: (TimelineTurn | TimelineAgent)[]; orphans: SessionFlow[] }>(() => {
	const main = reading.value?.main;
	const agents = [...(reading.value?.subagents ?? [])].sort((a, b) =>
		(a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
	if (!main) return { items: [], orphans: agents };

	const turns = main.turns;
	const items: (TimelineTurn | TimelineAgent)[] = [];
	let ai = 0;
	turns.forEach((turn, i) => {
		items.push({ kind: 'turn', turn });
		// agents spawned during this turn: startedAt before the NEXT turn's timestamp
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

function fmtDur(flow: SessionFlow): string {
	const a = flow.stats.firstTs ? new Date(flow.stats.firstTs).getTime() : null;
	const b = flow.stats.lastTs ? new Date(flow.stats.lastTs).getTime() : null;
	if (a === null || b === null || b <= a) return '';
	const s = Math.round((b - a) / 1000);
	return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}min` : `${(s / 3600).toFixed(1)}h`;
}
</script>

<template>
	<div class="sessions-view">
		<!-- Top bar: back + project context -->
		<div class="toolbar">
			<el-button text @click="router.push('/projects')">
				<el-icon><ArrowLeft /></el-icon>{{ t('session.backToProjects') }}
			</el-button>
			<span v-if="project" class="proj-name" :title="project">{{ basename(project) }}</span>
		</div>

		<div class="split">
			<!-- ═══ LEFT: session list ═══ -->
			<aside class="list-pane">
				<el-empty v-if="!listLoading && sessions.length === 0" :description="t('session.empty')" />
				<div v-else-if="listLoading" v-loading="true" style="min-height: 120px" />
				<template v-else>
					<div
						v-for="s in sessions" :key="s.id" class="sess-row"
						:class="{ active: s.id === sessionId, dead: !s.hasTranscript }"
						@click="s.hasTranscript && openSession(s.id)"
					>
						<el-icon class="sess-ico"><MessageSquareText /></el-icon>
						<div class="sess-main">
							<div class="sess-title">{{ s.title || t('session.untitled') }}</div>
							<div class="sess-id">{{ s.id }}</div>
						</div>
						<span class="sess-date">{{ fmtDate(s.timeUpdated) }}</span>
					</div>
				</template>
			</aside>

			<!-- ═══ RIGHT: reading pane ═══ -->
			<section class="reader-pane">
				<div v-if="loading" v-loading="true" style="min-height: 160px" />
				<el-alert
					v-else-if="errorMsg && errorMsg.startsWith('unsupported:')"
					class="pad" type="info" :closable="false"
					:title="t('session.unsupported')"
				/>
				<el-alert v-else-if="errorMsg" class="pad" type="error" :closable="false" :title="errorMsg" />
				<el-empty v-else-if="!sessionId" :description="t('session.pickOne')" />

				<template v-else-if="reading">
					<div class="reader-head">
						<div class="reader-title">{{ reading.session.title || reading.session.id }}</div>
						<div class="reader-meta">
							<el-tag size="small" type="info">{{ reading.session.id }}</el-tag>
							<el-tag v-if="reading.main" size="small">{{ t('session.main') }} {{ reading.main.turns.length }} {{ t('session.turnUnit') }}</el-tag>
							<el-tag v-if="reading.subagents.length" size="small" type="warning">{{ t('session.subagents') }} {{ reading.subagents.length }}</el-tag>
							<span class="reader-date">{{ fmtDate(reading.session.timeUpdated) }}</span>
						</div>
					</div>

					<template v-if="reading.main">
						<template v-for="(item, i) in timeline.items" :key="i">
							<SessionTurn v-if="item.kind === 'turn'" :turn="item.turn" />
							<div v-else class="agent-inline">
								<el-collapse v-model="openAgents" class="agent-collapse">
									<el-collapse-item :name="item.flow.id">
										<template #title>
											<el-icon class="agent-ico"><Bot /></el-icon>
											<span class="agent-desc" :title="item.flow.description">{{ item.flow.description || item.flow.id }}</span>
											<span class="agent-stats">
												{{ item.flow.turns.length }} {{ t('session.turnUnit') }} · {{ item.flow.stats.toolCalls }} {{ t('session.tools') }}
												<template v-if="fmtDur(item.flow)"> · {{ fmtDur(item.flow) }}</template>
											</span>
										</template>
										<SessionTurn v-for="(turn, ti) in item.flow.turns" :key="ti" :turn="turn" />
									</el-collapse-item>
								</el-collapse>
							</div>
						</template>
						<div v-if="reading.main.turns.length === 0" class="state">{{ t('session.noMain') }}</div>
					</template>
					<div v-else class="state">{{ t('session.noMain') }}</div>

					<!-- subagents with no resolvable spawn position -->
					<template v-if="timeline.orphans.length">
						<div class="orphans-label">{{ t('session.unplacedAgents') }}</div>
						<div v-for="flow in timeline.orphans" :key="flow.id" class="agent-inline">
							<el-collapse v-model="openAgents" class="agent-collapse">
								<el-collapse-item :name="flow.id">
									<template #title>
										<el-icon class="agent-ico"><Bot /></el-icon>
										<span class="agent-desc" :title="flow.description">{{ flow.description || flow.id }}</span>
										<span class="agent-stats">{{ flow.turns.length }} {{ t('session.turnUnit') }} · {{ flow.stats.toolCalls }} {{ t('session.tools') }}</span>
									</template>
									<SessionTurn v-for="(turn, ti) in flow.turns" :key="ti" :turn="turn" />
								</el-collapse-item>
							</el-collapse>
						</div>
					</template>
				</template>
			</section>
		</div>
	</div>
</template>

<style scoped>
.sessions-view {
	display: flex;
	flex-direction: column;
	/* app chrome above: 64px header. Own toolbar row takes the rest via flex. */
	height: calc(100vh - 64px);
	padding: 12px 16px 0;
	box-sizing: border-box;
	gap: 8px;
}
.toolbar {
	display: flex;
	align-items: center;
	gap: 4px;
	flex-shrink: 0;
}
.proj-name {
	font-size: 13px;
	color: var(--el-text-color-secondary);
	margin-left: 8px;
}
.split {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	gap: 12px;
}
.state {
	color: var(--el-text-color-secondary);
	font-size: 13px;
	padding: 16px;
}
.pad { margin: 12px; }

/* ---- left pane ---- */
.list-pane {
	flex: 0 0 400px;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 8px;
	background: var(--el-bg-color);
	border: 1px solid var(--el-border-color-lighter);
	border-radius: 8px;
}
.sess-row {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 10px;
	border: 1px solid transparent;
	border-radius: 6px;
	cursor: pointer;
	transition: background 0.15s, border-color 0.15s;
}
.sess-row:hover {
	background: var(--el-fill-color-lighter);
}
.sess-row.active {
	border-color: var(--el-color-primary-light-5);
	background: var(--el-color-primary-light-9);
}
.sess-row.dead { cursor: default; opacity: 0.55; }
.sess-ico { color: var(--el-text-color-secondary); flex-shrink: 0; }
.sess-main { flex: 1 1 auto; min-width: 0; }
.sess-title {
	font-size: 13px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.sess-id {
	font-size: 10px;
	color: var(--el-text-color-secondary);
	margin-top: 2px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.sess-date {
	font-size: 10px;
	color: var(--el-text-color-secondary);
	flex-shrink: 0;
}

/* ---- right pane ---- */
.reader-pane {
	flex: 1 1 auto;
	min-width: 0;
	overflow-y: auto;
	padding: 12px 16px 24px;
	background: var(--el-bg-color);
	border: 1px solid var(--el-border-color-lighter);
	border-radius: 8px;
}
.reader-head { margin-bottom: 14px; }
.reader-title {
	font-size: 15px;
	font-weight: 600;
	margin-bottom: 6px;
}
.reader-meta {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}
.reader-date { font-size: 11px; color: var(--el-text-color-secondary); }
.reader-head + :deep(.turn) { margin-top: 0; }
.reader-pane > :deep(.turn) { margin-bottom: 14px; }

/* ---- inline subagent block ---- */
.agent-inline {
	border: 1px dashed var(--el-color-warning-light-5);
	border-left: 3px solid var(--el-color-warning);
	border-radius: 8px;
	background: var(--el-color-warning-light-9);
	margin-bottom: 14px;
}
.agent-head {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	border: none;
	background: transparent;
	padding: 8px 12px;
	font-size: 12px;
	color: var(--el-text-color-regular);
	cursor: pointer;
	text-align: left;
}
.agent-head:hover { color: var(--el-color-primary); }
.agent-desc {
	flex: 1 1 auto;
	min-width: 0;
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.agent-stats {
	flex-shrink: 0;
	font-size: 11px;
	color: var(--el-text-color-secondary);
}
.proc-arrow { color: var(--el-text-color-secondary); flex-shrink: 0; }
.agent-body {
	padding: 0 12px 12px;
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.orphans-label {
	font-size: 11px;
	color: var(--el-text-color-secondary);
	margin: 10px 0 6px;
}
</style>
