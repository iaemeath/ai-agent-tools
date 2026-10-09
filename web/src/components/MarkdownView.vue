<script setup lang="ts">
// Markdown renderer — uses `marked` when available, falls back to <pre> otherwise.
// Once `marked` is installed (npm -w web install marked), the dynamic import resolves
// and rendering upgrades automatically — no code change needed here.
//
// Frontmatter mode (opt-in `frontmatter`): for skill/agent/command .md files whose
// YAML front-matter carries metadata. Per the official skill standard only TWO
// fields are surfaced — name (top) and description (middle) — then the document
// body below; version/maturity/license/… and every other key are dropped.
// Off by default: chat turns and editable docs must render verbatim.
import { computed, shallowRef } from 'vue';

const props = defineProps<{ raw: string; frontmatter?: boolean }>();

interface SplitFm { name: string | null; description: string | null; body: string }

/** Extract ONLY name + description from a leading `---` front-matter block; the
 *  rest of the block is discarded. No block → body is the raw text unchanged. */
function splitFrontMatter(src: string): SplitFm {
	const text = src.replace(/^\uFEFF/, '');
	if (!text.startsWith('---')) return { name: null, description: null, body: src };
	// /\r?\n/: CRLF files must parse identically (a trailing \r breaks the field regex).
	const lines = text.split(/\r?\n/);
	let close = -1;
	for (let i = 1; i < lines.length; i++) {
		const t = lines[i].trim();
		if (t === '---' || t === '...') { close = i; break; }
	}
	if (close === -1) return { name: null, description: null, body: src };
	const fmLines = lines.slice(1, close);
	const out: SplitFm = { name: null, description: null, body: lines.slice(close + 1).join('\n').replace(/^\s*\n/, '') };
	for (let i = 0; i < fmLines.length; i++) {
		const m = fmLines[i].match(/^(name|description):\s*(.*)$/);
		if (!m) continue;
		let val = m[2].trim().replace(/^["']|["']$/g, '');
		// Block scalars (> >- | |- …): fold the indented continuation lines in.
		if (/^[>|][+-?\d]*$/.test(val)) {
			const literal = val.startsWith('|');
			const cont: string[] = [];
			while (i + 1 < fmLines.length && (/^\s/.test(fmLines[i + 1]) || fmLines[i + 1].trim() === '')) {
				cont.push(fmLines[i + 1].replace(/^\s+/, ''));
				i++;
			}
			val = cont.join(literal ? '\n' : ' ').trim();
		}
		if (val !== '') out[m[1] as 'name' | 'description'] = val;
	}
	return out;
}

const fm = computed<SplitFm | null>(() => (props.frontmatter ? splitFrontMatter(props.raw) : null));
/** Text that goes through the markdown pipeline — front-matter stripped in fm mode. */
const sourceText = computed(() => (fm.value ? fm.value.body : props.raw));
const hasFmHead = computed(() => !!fm.value && (fm.value.name !== null || fm.value.description !== null));

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
		try { return markedParse(sourceText.value); } catch { /* fall through */ }
	}
	return '';
});

// Kick off the lazy load on mount (non-blocking).
ensureMarked();
</script>

<template>
  <div v-if="useMarked && rendered" class="md-body">
    <!-- Front-matter head: official-standard fields only — name, then description. -->
    <div v-if="hasFmHead" class="md-fm-head">
      <div v-if="fm?.name" class="md-fm-name">{{ fm.name }}</div>
      <div v-if="fm?.description" class="md-fm-desc">{{ fm.description }}</div>
    </div>
    <div :class="{ 'md-fm-body': hasFmHead }" v-html="rendered" />
  </div>
  <pre v-else class="md-pre">{{ sourceText }}</pre>
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
/* Front-matter head zones: name on top, description under it, then the body. */
.md-fm-head {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.md-fm-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}
.md-fm-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
/* Markdown rendered HTML — scoped styles can't reach v-html, use :deep(). */
.md-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
}
.md-fm-body :deep(h1:first-child),
.md-fm-body :deep(h2:first-child) {
  margin-top: 0;
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
