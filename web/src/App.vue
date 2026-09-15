<script setup lang="ts">
import AppSidebar from './components/AppSidebar.vue';
import AppHeader from './components/AppHeader.vue';
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="200px" class="app-aside">
      <AppSidebar />
    </el-aside>
    <el-container>
      <el-header class="app-header">
        <AppHeader />
      </el-header>
      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
.app-shell {
  height: 100vh;
}
.app-aside {
  border-right: var(--el-border-color) solid 1px;
  overflow: hidden;
}
.app-header {
  border-bottom: var(--el-border-color) solid 1px;
  padding: 0;
  height: 64px;
}
.app-main {
  padding: 0;
  background: var(--el-bg-color-page);
}
</style>
