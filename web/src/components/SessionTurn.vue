<script setup lang="ts">
// One conversation turn, reading layout:
//   🕐 timestamp → 👤 user input → ⚙️ 中间过程 (collapsed: thinking + text + tools)
//   → ✅ final response (markdown)
// The proc block's content renders lazily (v-if on the open state) so large
// sessions don't build hundreds of markdown/tool DOM trees up front.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { User, Check, Cog, Brain } from 'lucide-vue-next';
import MarkdownView from './MarkdownView.vue';
import type { TranscriptStep, TranscriptTurn } from '../types/tool';

const props = defineProps<{ turn: TranscriptTurn }>();
const { t } = useI18n();

const procOpen = ref(false);

/** Over these lengths a block renders collapsed (with a preview line); click to expand. */
const USER_COLLAPSE_OVER = 400;
const RESP_COLLAPSE_OVER = 1000;

const userLong = computed(() => props.turn.user.length > USER_COLLAPSE_OVER);
const respLong = computed(() => props.turn.response.length > RESP_COLLAPSE_OVER);
const userOpen = ref(!userLong.value);
const respOpen = ref(!respLong.value);

function preview(text: string): string {
	const oneLine = text.replace(/\s+/g, ' ').trim();
	return oneLine.slice(0, 120) + (oneLine.length > 120 ? '…' : '');
}

interface ProcStep extends TranscriptStep { kind: 'thinking' | 'text'; }
interface ProcRow { steps: ProcStep[]; tools: TranscriptTurn['tools']; think: number; text: number; }

/**
 * Proc parts: thinking/text steps (text steps that merely duplicate the final
 * response are dropped) + tool list + aggregate counts for the summary line.
 */
const row = computed<ProcRow>(() => {
	const resp = props.turn.response;
	const steps: ProcStep[] = [];
	for (const s of props.turn.steps) {
		if (resp && (s.text === resp || resp.startsWith(s.text) || s.text.startsWith(resp))) continue;
		steps.push({ ...s, kind: s.type });
	}
	return {
		steps,
		tools: props.turn.tools,
		think: steps.filter((s) => s.kind === 'thinking').length,
		text: steps.filter((s) => s.kind === 'text').length,
	};
});

const hasProc = computed(() => row.value.think + row.value.text + row.value.tools.length > 0);

function fmtTs(ts: string | null): string {
	if (!ts) return '';
	const d = new Date(ts);
	return isNaN(+d) ? '' : d.toLocaleString();
}
</script>

<template>
	<div class="turn">
		<div v-if="turn.ts" class="turn-ts">{{ fmtTs(turn.ts) }}</div>

		<div v-if="turn.user" class="block user">
			<div class="block-head" :class="{ togglable: userLong }" @click="userLong && (userOpen = !userOpen)">
				<el-icon><User /></el-icon><span>{{ t('session.user') }}</span>
				<span v-if="userLong" class="head-count">{{ turn.user.length }} {{ t('session.chars') }}</span>
				<span v-if="userLong" class="head-arrow">{{ userOpen ? '▾' : '▸' }}</span>
			</div>
			<pre v-if="userOpen" class="user-text">{{ turn.user }}</pre>
			<div v-else class="block-preview" @click="userOpen = true">{{ preview(turn.user) }}</div>
		</div>

		<div v-if="hasProc" class="proc" :class="{ open: procOpen }">
			<button class="proc-head" type="button" @click="procOpen = !procOpen">
				<el-icon><Cog /></el-icon>
				<span>{{ t('session.proc') }}（{{ t('session.thinking') }} {{ row.think }} · {{ t('session.text') }} {{ row.text }} · {{ t('session.tools') }} {{ row.tools.length }}）</span>
				<span class="proc-arrow">{{ procOpen ? '▾' : '▸' }}</span>
			</button>
			<template v-if="procOpen">
				<details v-for="(s, si) in row.steps" :key="'s' + si" class="sub" :class="s.kind" :open="s.kind === 'text'">
					<summary v-if="s.kind === 'thinking'" class="sub-sum">
						<el-icon><Brain /></el-icon>{{ t('session.thinking') }} #{{ si + 1 }}（{{ s.text.length }} {{ t('session.chars') }}）
					</summary>
					<pre v-if="s.kind === 'thinking'" class="think-text">{{ s.text }}</pre>
					<MarkdownView v-else :raw="s.text" />
				</details>
				<details v-if="row.tools.length" class="sub tools">
					<summary class="sub-sum">🔧 {{ t('session.tools') }}（{{ row.tools.length }}）</summary>
					<div class="tool-line" v-for="(tool, ti) in row.tools" :key="ti">
						<code class="tool-name">{{ tool.name }}</code>
						<span v-if="tool.summary" class="tool-summary">{{ tool.summary }}</span>
						<details v-if="tool.input.length > 160" class="tool-detail">
							<summary class="sub-sum">{{ t('session.fullInput') }}</summary>
							<pre class="tool-input">{{ tool.input }}</pre>
						</details>
					</div>
				</details>
			</template>
		</div>

		<div v-if="turn.response" class="block response">
			<div class="block-head" :class="{ togglable: respLong }" @click="respLong && (respOpen = !respOpen)">
				<el-icon><Check /></el-icon><span>{{ t('session.response') }}</span>
				<span v-if="respLong" class="head-count">{{ turn.response.length }} {{ t('session.chars') }}</span>
				<span v-if="respLong" class="head-arrow">{{ respOpen ? '▾' : '▸' }}</span>
			</div>
			<MarkdownView v-if="respOpen" :raw="turn.response" />
			<div v-else class="block-preview" @click="respOpen = true">{{ preview(turn.response) }}</div>
		</div>
	</div>
</template>

<style scoped>
.turn {
	border: 1px solid var(--el-border-color-lighter);
	border-radius: 8px;
	padding: 12px 14px;
	background: var(--el-bg-color);
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.turn-ts { font-size: 11px; color: var(--el-text-color-secondary); }
.block { border-radius: 6px; padding: 8px 10px; }
.block-head {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	color: var(--el-text-color-secondary);
	margin-bottom: 4px;
}
.block-head.togglable {
	cursor: pointer;
	user-select: none;
}
.block-head.togglable:hover { color: var(--el-color-primary); }
.head-count {
	font-size: 10px;
	color: var(--el-text-color-placeholder);
}
.head-arrow { margin-left: 2px; }
.block-preview {
	font-size: 12px;
	color: var(--el-text-color-secondary);
	cursor: pointer;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	padding: 2px 0;
}
.block-preview:hover { color: var(--el-color-primary); }
.user {
	background: var(--el-color-primary-light-9);
	border-left: 3px solid var(--el-color-primary);
}
.user-text {
	margin: 0;
	font-family: inherit;
	font-size: 13px;
	line-height: 1.6;
	white-space: pre-wrap;
	word-break: break-word;
}
.response {
	background: var(--el-fill-color-lighter);
	border-left: 3px solid var(--el-color-success);
}
.proc {
	border: 1px solid var(--el-border-color-lighter);
	border-radius: 6px;
	background: var(--el-fill-color-light);
}
.proc-head {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	border: none;
	background: transparent;
	padding: 7px 10px;
	font-size: 12px;
	color: var(--el-text-color-regular);
	cursor: pointer;
	text-align: left;
}
.proc-head:hover { color: var(--el-color-primary); }
.proc-arrow { margin-left: auto; color: var(--el-text-color-secondary); }
.proc.open .proc-head { border-bottom: 1px solid var(--el-border-color-lighter); }
.proc :deep(*) { box-sizing: border-box; }
.sub {
	border: 1px solid var(--el-border-color-lighter);
	border-radius: 6px;
	padding: 6px 10px;
	margin: 6px 8px 6px;
	background: var(--el-bg-color);
}
.sub.thinking { background: var(--el-fill-color-light); }
.sub-sum {
	font-size: 12px;
	color: var(--el-text-color-secondary);
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 5px;
	user-select: none;
}
.think-text {
	margin: 6px 0 0;
	font-size: 12px;
	line-height: 1.6;
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--el-text-color-regular);
}
.tool-line {
	font-size: 12px;
	padding: 3px 0;
	border-bottom: 1px dashed var(--el-border-color-lighter);
}
.tool-line:last-child { border-bottom: none; }
.tool-name {
	background: var(--el-fill-color);
	border-radius: 3px;
	padding: 1px 5px;
	font-size: 11px;
}
.tool-summary {
	margin-left: 8px;
	color: var(--el-text-color-regular);
	word-break: break-all;
}
.tool-detail { margin-top: 3px; }
.tool-input {
	margin: 4px 0 0;
	font-size: 11px;
	line-height: 1.5;
	white-space: pre-wrap;
	word-break: break-word;
	background: var(--el-fill-color-darker);
	color: var(--el-text-color-regular);
	padding: 8px;
	border-radius: 4px;
	max-height: 320px;
	overflow: auto;
}
</style>
