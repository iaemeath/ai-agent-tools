<script setup lang="ts">
// Markdown renderer — uses `marked` when available, falls back to <pre> otherwise.
// Once `marked` is installed (npm -w web install marked), the dynamic import resolves
// and rendering upgrades automatically — no code change needed here.
import { computed, shallowRef } from 'vue';

const props = defineProps<{ raw: string }>();

// Hold the parsed HTML (empty until marked loads / not yet loaded).
const html = shallowRef<string>('');
const useMarked = shallowRef(false);

// Lazy-load marked once on first use; if it fails (not installed), stay in pre mode.
let markedLoaded = false;
async function ensureMarked() {
	if (markedLoaded) return;
	markedLoaded = true;
	try {
		const mod: any = await import(/* @vite-ignore */ 'marked');
		const parse = mod.marked?.parse ?? mod.default?.parse ?? mod.default;
		if (typeof parse === 'function') {
			markedParse = parse;
			useMarked.value = true;
		}
	} catch { /* marked not installed yet — keep pre fallback */ }
}
let markedParse: ((src: string) => string) | null = null;

const rendered = computed(() => {
	if (useMarked.value && markedParse) {
		try { return markedParse(props.raw); } catch { /* fall through */ }
	}
	return '';
});

// Kick off the lazy load on mount (non-blocking).
ensureMarked();
</script>

<template>
  <div v-if="useMarked && rendered" class="md-body" v-html="rendered" />
  <pre v-else class="md-pre">{{ raw }}</pre>
</template>

<style scoped>
.md-pre {
  margin: 0;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}
/* Markdown rendered HTML — scoped styles can't reach v-html, use :deep(). */
.md-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4) {
  margin: 16px 0 8px;
  font-weight: 600;
}
.md-body :deep(h1) { font-size: 20px; }
.md-body :deep(h2) { font-size: 17px; }
.md-body :deep(h3) { font-size: 15px; }
.md-body :deep(h4) { font-size: 14px; }
.md-body :deep(p) { margin: 8px 0; }
.md-body :deep(ul),
.md-body :deep(ol) { padding-left: 24px; margin: 8px 0; }
.md-body :deep(li) { margin: 4px 0; }
.md-body :deep(code) {
  background: var(--el-fill-color-light);
  padding: 2px 5px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
}
.md-body :deep(pre) {
  background: #1e1e1e;
  color: #e0e0e0;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}
.md-body :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #e0e0e0;
}
.md-body :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--el-border-color);
  color: var(--el-text-color-secondary);
}
.md-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid var(--el-border-color);
  padding: 6px 10px;
  text-align: left;
}
.md-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--el-border-color);
  margin: 12px 0;
}
.md-body :deep(a) {
  color: var(--el-color-primary);
  text-decoration: none;
}
</style>
