<script setup lang="ts">
// SplitPane — horizontal two-pane layout with a draggable col-resize splitter.
// Replaces the 5 hand-rolled mousedown/mousemove splitter copies across views.
// modelValue = left pane width in px (delta-dragged, clamped to [min, innerWidth*maxRatio]).
import { onUnmounted, ref } from 'vue';

const props = withDefaults(defineProps<{ modelValue: number; min?: number; maxRatio?: number }>(), {
	min: 240,
	maxRatio: 0.6,
});
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>();

const dragging = ref(false);
let startX = 0;
let startW = 0;

function onMove(e: MouseEvent) {
	if (!dragging.value) return;
	const max = window.innerWidth * props.maxRatio;
	emit('update:modelValue', Math.min(max, Math.max(props.min, startW + (e.clientX - startX))));
}
function stop() {
	dragging.value = false;
	window.removeEventListener('mousemove', onMove);
	window.removeEventListener('mouseup', stop);
}
function start(e: MouseEvent) {
	e.preventDefault();
	dragging.value = true;
	startX = e.clientX;
	startW = props.modelValue;
	window.addEventListener('mousemove', onMove);
	window.addEventListener('mouseup', stop);
}
onUnmounted(stop);
</script>

<template>
  <div class="split-pane">
    <div class="sp-left" :style="{ width: modelValue + 'px', flexShrink: 0 }">
      <slot name="left" />
    </div>
    <div class="sp-splitter" :class="{ active: dragging }" @mousedown="start">
      <div class="sp-handle" />
    </div>
    <div class="sp-right">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.split-pane {
  display: flex;
  overflow: hidden;
  min-height: 0;
  height: 100%;
}
.sp-left,
.sp-right {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  height: 100%;
}
.sp-right {
  flex: 1;
}
.sp-splitter {
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: var(--el-border-color-lighter);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.sp-splitter:hover,
.sp-splitter.active {
  background: var(--el-color-primary-light-5);
}
.sp-handle {
  width: 3px;
  height: 32px;
  border-radius: 2px;
  background: var(--el-border-color);
}
.sp-splitter:hover .sp-handle,
.sp-splitter.active .sp-handle {
  background: var(--el-color-primary);
}
</style>
