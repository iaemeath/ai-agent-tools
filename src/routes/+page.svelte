<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		goto('/projects', { replaceState: true });
	});
</script>

<div class="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
	Loading…
</div>
