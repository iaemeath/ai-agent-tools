<script lang="ts">
	import '../app.css';
	import { Sidebar } from '$lib/components/layout';
	let { children } = $props();
</script>

<div class="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
	<Sidebar />
	<main class="flex flex-1 flex-col overflow-hidden">{@render children()}</main>
</div>