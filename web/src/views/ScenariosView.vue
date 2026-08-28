<script setup lang="ts">
// Scenarios view — the saved scenario cards (knowledge.db via /api/caselog/scenarios).
// Click a card: the card area switches to an inline detail panel (same pattern as the
// skills view) — no dialog. Source pointers are listed for provenance (R4).
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, BookCheck } from 'lucide-vue-next';
import { api } from '../api';
import type { CaselogScenario } from '../types/tool';

const { t } = useI18n();

const scenarios = ref<CaselogScenario[]>([]);
const loading = ref(true);
const detail = ref<CaselogScenario | null>(null);

async function load(): Promise<void> {
	loading.value = true;
	try {
		scenarios.value = await api.caselogScenarios();
	} catch {
		scenarios.value = [];
	} finally {
		loading.value = false;
	}
}

/** Group by the day the scenario was noted (created_at), newest day first. */
const groups = computed<[string, CaselogScenario[]][]>(() => {
	const map = new Map<string, CaselogScenario[]>();
	for (const s of scenarios.value) {
		const day = (s.createdAt || '').slice(0, 10) || '—';
		if (!map.has(day)) map.set(day, []);
		map.get(day)!.push(s);
	}
	return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
});

function excerpt(text: string, n = 120): string {
	const line = text.replace(/\s+/g, ' ').trim();
	return line.length > n ? line.slice(0, n) + '…' : line;
}

onMounted(load);
</script>

<template>
	<div class="scenarios-view">
		<!-- ═══ card list ═══ -->
		<template v-if="!detail">
			<div v-if="loading" class="state">{{ t('common.loading') }}</div>
			<div v-else-if="scenarios.length === 0" class="state">{{ t('sc.empty') }}</div>
			<section v-for="[day, list] in groups" v-else :key="day" class="group">
				<div class="group-head">
					<h2 class="group-title">{{ day }} · {{ t('sc.count', { n: list.length }) }}</h2>
				</div>
				<div class="card-grid">
					<div v-for="s in list" :key="s.id" class="sc-card" @click="detail = s">
						<div class="sc-card-head">
							<span class="sc-card-title">{{ s.title }}</span>
							<span v-if="s.editedCount" class="sc-edited">{{ t('caselog.edited', { n: s.editedCount }) }}</span>
						</div>
						<div v-if="s.keywords" class="sc-card-kw">{{ s.keywords }}</div>
						<div class="sc-card-body">{{ excerpt(s.content) }}</div>
						<div class="sc-card-meta">
							<el-icon :size="12"><BookCheck /></el-icon>
							{{ t('sc.pointers', { n: s.pointers.length }) }}
						</div>
					</div>
				</div>
			</section>
		</template>

		<!-- ═══ detail (inline, replaces the card area) ═══ -->
		<div v-else class="detail-panel">
			<div class="detail-toolbar">
				<el-button text :icon="ArrowLeft" @click="detail = null">{{ t('sc.backToList') }}</el-button>
				<span class="dt-title">{{ detail.title }}</span>
				<span class="dt-sub">{{ detail.createdAt.slice(0, 10) }}<template v-if="detail.editedCount"> · {{ t('caselog.edited', { n: detail.editedCount }) }}</template></span>
			</div>
			<div class="detail-body">
				<div v-if="detail.keywords" class="dt-kw">{{ detail.keywords }}</div>
				<div class="dt-content">{{ detail.content }}</div>
				<div class="dt-pointers">
					<div class="dt-pointers-title">{{ t('sc.sourcePointers') }}</div>
					<div v-for="(p, i) in detail.pointers" :key="i" class="dt-pointer">
						{{ p.host }} / {{ p.sessionId }} <span class="dt-range">[{{ p.seqRange }}]</span>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.scenarios-view {
	height: calc(100vh - 64px);
	padding: 12px 16px 0;
	box-sizing: border-box;
	overflow-y: auto;
}
.state { color: var(--el-text-color-secondary); font-size: 13px; padding: 16px; }
.group { margin-bottom: 20px; }
.group-head { margin-bottom: 8px; }
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
.sc-card {
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
.sc-card:hover { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
.sc-card-head { display: flex; align-items: baseline; gap: 8px; }
.sc-card-title { font-size: 14px; font-weight: 600; flex: 1 1 auto; min-width: 0; }
.sc-edited { flex-shrink: 0; font-size: 11px; color: var(--el-color-warning); }
.sc-card-kw { font-size: 11px; color: var(--el-text-color-secondary); }
.sc-card-body { font-size: 12px; color: var(--el-text-color-regular); line-height: 1.6; }
.sc-card-meta {
	display: flex; align-items: center; gap: 4px;
	font-size: 11px; color: var(--el-text-color-secondary);
}

/* ---- detail panel ---- */
.detail-panel { max-width: 860px; }
.detail-toolbar {
	display: flex; align-items: center; gap: 10px;
	padding: 0 0 12px;
}
.dt-title { font-size: 15px; font-weight: 600; }
.dt-sub { font-size: 11px; color: var(--el-text-color-secondary); }
.dt-kw { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 10px; }
.dt-content {
	font-size: 13px; line-height: 1.8; white-space: pre-wrap;
	padding: 14px; border-radius: 8px; background: var(--el-bg-color);
	border: 1px solid var(--el-border-color-lighter);
	margin-bottom: 14px;
}
.dt-pointers-title { font-size: 11px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
.dt-pointer { font-size: 12px; color: var(--el-text-color-regular); padding: 2px 0; word-break: break-all; }
.dt-range { color: var(--el-color-primary); }
</style>
