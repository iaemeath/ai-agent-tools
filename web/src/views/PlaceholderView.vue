<script setup lang="ts">
import { useI18n } from 'vue-i18n';
defineProps<{ kind?: string }>();
const { t } = useI18n();
</script>

<template>
  <div class="placeholder">
    <el-empty :description="t('page.placeholder.subtitle')">
      <template #image>
        <span style="font-size: 56px">🚧</span>
      </template>
      <h2 style="margin: 8px 0">{{ t('page.placeholder.title') }}</h2>
      <p v-if="kind" style="text-transform: uppercase; letter-spacing: 0.05em; color: var(--el-text-color-secondary); font-size: 12px">
        {{ kind }}
      </p>
    </el-empty>
  </div>
</template>

<style scoped>
.placeholder {
  padding: 60px 0;
  display: flex;
  justify-content: center;
}
</style>
