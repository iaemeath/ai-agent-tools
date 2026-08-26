<script setup lang="ts">
// Session turn list — thin wrapper rendering one SessionTurn per entry.
import SessionTurn from './SessionTurn.vue';
import type { TranscriptTurn } from '../types/tool';

defineProps<{ turns: TranscriptTurn[] }>();
</script>

<template>
	<div class="turns">
		<SessionTurn v-for="(turn, i) in turns" :key="i" :turn="turn" />
	</div>
</template>

<style scoped>
.turns {
	display: flex;
	flex-direction: column;
	gap: 14px;
}
</style>
