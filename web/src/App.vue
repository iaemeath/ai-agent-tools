<script setup lang="ts">
import AppSidebar from './components/AppSidebar.vue';
import AppHeader from './components/AppHeader.vue';
import { sidebarCollapsed } from './stores/ui';
</script>

<template>
  <el-container class="app-shell">
    <el-aside :width="sidebarCollapsed ? '64px' : '200px'" class="app-aside">
      <AppSidebar />
    </el-aside>
    <el-container>
      <el-header class="app-header">
        <AppHeader />
      </el-header>
      <el-main class="app-main">
        <!-- keep-alive: list pages survive detail round-trips (scroll position, filters,
             loaded data). Cap bounds memory; views refresh via the header refresh button
             and the reload/tool-change window events, which cached instances still hear. -->
        <router-view v-slot="{ Component }">
          <keep-alive :max="12">
            <component :is="Component" />
          </keep-alive>
        </router-view>
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
  transition: width 0.2s;
}
.app-header {
  border-bottom: var(--el-border-color) solid 1px;
  padding: 0;
  height: 48px;
}
.app-main {
  padding: 0;
  background: var(--el-bg-color-page);
  /* No overflow override — el-main's default `overflow: auto` is what makes pages
     without internal scroll containers (Skills/Projects/…) scrollable. Views that
     manage their own scrolling (height:100% + inner panes) are unaffected. */
}
</style>
