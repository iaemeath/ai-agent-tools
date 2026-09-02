<script setup lang="ts">
// Read-only card for a skill provided by a plugin. Unlike SkillCard there are no
// actions: a plugin skill's on/off is governed at the PLUGIN level (Plugins page),
// never per-skill, and its files are browsable from the plugin's own detail view.

import { useI18n } from 'vue-i18n';

const props = defineProps<{
	name: string;
	description: string | null;
	/** True when the providing plugin is disabled — the skill will not load. */
	disabled?: boolean;
	/** Skill-tool invocation count from transcripts; undefined = stats unavailable (hide badge). */
	usage?: number;
}>();

const emit = defineEmits<{
	(e: 'detail'): void;
}>();

const { t } = useI18n();
</script>

<template>
  <el-card class="plugin-skill-card" :class="{ 'plugin-skill-card--off': props.disabled }" shadow="hover" body-style="padding: 14px;" @click="emit('detail')">
    <div class="card-name-row">
      <div class="card-name">{{ props.name }}</div>
      <el-tag
        v-if="usage !== undefined"
        size="small"
        :type="usage === 0 ? 'info' : 'success'"
        effect="plain"
      >
        {{ usage === 0 ? t('skill.zeroUsage') : t('skill.usageCount', { n: usage }) }}
      </el-tag>
    </div>
    <div class="card-desc">{{ props.description ?? '—' }}</div>
    <div class="card-foot">
      <el-tag v-if="props.disabled" size="small" type="info" effect="plain">{{ t('skill.pluginDisabled') }}</el-tag>
    </div>
  </el-card>
</template>

<style scoped>
.plugin-skill-card {
	cursor: pointer;
	transition: border-color 0.2s;
}
.plugin-skill-card:hover {
	border-color: var(--el-color-primary-light-5);
}
.plugin-skill-card--off {
	opacity: 0.6;
}
.card-name-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
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
	justify-content: flex-end;
	margin-top: 14px;
	min-height: 24px;
}
</style>
