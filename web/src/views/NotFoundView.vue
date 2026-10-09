<script setup lang="ts">
// 404 catch-all page — any unmatched path lands here instead of a blank view.
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

const router = useRouter();
const { t } = useI18n();
</script>

<template>
  <div class="not-found">
    <el-result icon="warning" :title="t('notFound.title')" :sub-title="t('notFound.desc')">
      <template #extra>
        <el-button type="primary" @click="router.replace('/plugins')">{{ t('notFound.back') }}</el-button>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.not-found {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
