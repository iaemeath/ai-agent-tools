<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { EllipsisVertical, FolderOpen } from 'lucide-vue-next';
import type { ToolInstance } from '../types/tool';

const props = defineProps<{
	plugin: ToolInstance;
}>();

const emit = defineEmits<{
	(e: 'toggle', status: 'enabled' | 'disabled'): void;
	(e: 'detail'): void;
	(e: 'open'): void;
}>();

const { t } = useI18n();

const isEnabled = computed(() => props.plugin.effective === 'enabled');

function onSwitch(v: boolean) {
	emit('toggle', v ? 'enabled' : 'disabled');
}

function onCommand(cmd: string) {
	if (cmd === 'open') emit('open');
}

// Clicking the switch or the ⋮ dropdown must not bubble up to the card's click handler
// (which opens detail). Stop propagation at these interactive zones.
function stop(e: Event) {
	e.stopPropagation();
}
</script>

<template>
  <el-card class="plugin-card" shadow="hover" body-style="padding: 14px;" @click="emit('detail')">
    <div class="card-name" :title="plugin.name">{{ plugin.name }}</div>
    <div class="card-desc" :title="plugin.description ?? ''">{{ plugin.description ?? '—' }}</div>

    <div class="card-foot">
      <el-switch
        :model-value="isEnabled"
        class="toggle-switch"
        :width="60"
        inline-prompt
        :active-text="t('common.enabled')"
        :inactive-text="t('common.disabled')"
        @change="onSwitch"
        @click="stop"
      />

      <el-dropdown trigger="click" @command="onCommand" @click="stop">
        <el-button class="more-btn" text :title="t('common.more')" @click="stop">
          <el-icon><EllipsisVertical /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="open" :icon="FolderOpen">
              {{ t('plugin.openInExplorer') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </el-card>
</template>

<style scoped>
.plugin-card {
  cursor: pointer;
  transition: border-color 0.2s;
}
.plugin-card:hover {
  border-color: var(--el-color-primary-light-5);
}
.card-name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.more-btn {
  padding: 4px;
  color: var(--el-text-color-secondary);
}
.toggle-switch :deep(.el-switch__label) {
  font-size: 14px;
}
.toggle-switch :deep(.is-text) {
  font-size: 13px;
}
/* Height 25px + green(active)/gray(inactive) overriding EP's blue primary. */
.toggle-switch {
  --el-switch-on-height: 25px;
  --el-switch-off-height: 25px;
  --el-switch-button-size: 17px;
}
.toggle-switch :deep(.el-switch__core) {
  height: 25px;
  border-radius: 13px;
}
.toggle-switch.is-checked :deep(.el-switch__core) {
  background-color: #13ce66 !important;
  border-color: #13ce66 !important;
}
.toggle-switch:not(.is-checked) :deep(.el-switch__core) {
  background-color: #c0c4cc !important;
  border-color: #c0c4cc !important;
}
</style>
