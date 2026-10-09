<script setup lang="ts">
// Plugin file-browser mode — /plugins/:name/files. FileExplorer over the plugin
// install dir; reachable from the detail toolbar's 文件浏览器 button.
import { computed, onActivated, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, FolderOpened } from '@element-plus/icons-vue';
import { api } from '../api';
import FileExplorer from '../components/FileExplorer.vue';
import { useTool } from '../stores/tool';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { tool } = useTool();

const name = computed(() => String(route.params.name ?? ''));
const exists = ref(true);

function shortName(full: string): string {
	const at = full.lastIndexOf('@');
	return at > 0 ? full.slice(0, at) : full;
}

async function openInExplorer(): Promise<void> {
	try {
		await api.openPluginInExplorer(name.value, null, tool.value);
	} catch {
		// best-effort
	}
}

/** Existence pre-check: an unknown plugin 404s on detail → fall back to the list.
 *  Success must RESET exists=true — a cached instance may carry exists=false from
 *  an earlier failed check for a different plugin/navigation. */
async function checkExists(): Promise<void> {
	try {
		await api.getPluginDetail(name.value, null, tool.value);
		exists.value = true;
	} catch {
		exists.value = false;
		router.replace('/plugins');
	}
}

watch(tool, () => router.replace('/plugins'));

// keep-alive contract (same as PluginDetailView): the cached instance must re-check
// on every re-entry (onActivated — also the initial mount) and on in-place name
// changes via browser back/forward (watch + route-name guard against the
// tool-switch replace('/plugins') leaving an empty name).
onActivated(checkExists);
watch(name, () => {
	if (route.name === 'plugin-files') checkExists();
});
</script>

<template>
  <div class="detail-panel">
    <div class="detail-toolbar">
      <el-button text :icon="ArrowLeft" @click="router.push(`/plugins/${encodeURIComponent(name)}`)">{{ t('plugin.backToCards') }}</el-button>
      <span class="detail-plugin-name">{{ shortName(name) }}</span>
      <el-button text :icon="FolderOpened" size="small" class="open-btn" @click="openInExplorer">{{ t('plugin.openInExplorer') }}</el-button>
    </div>
    <FileExplorer
      v-if="exists"
      :key="name"
      :root-label="shortName(name)"
      :list-fn="(sp: string) => api.listPluginFiles(name, sp, null, tool)"
      :read-fn="(sp: string) => api.readPluginFile(name, sp, null, tool)"
    />
  </div>
</template>

<style scoped>
.detail-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  padding: 16px 24px;
}
.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.detail-plugin-name {
  font-size: 15px;
  font-weight: 600;
}
.open-btn {
  margin-left: auto;
}
</style>
