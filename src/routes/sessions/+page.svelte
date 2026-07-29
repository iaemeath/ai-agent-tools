<script lang="ts">
	import { onMount } from 'svelte';
	import { Header } from '$lib/components/layout';
	import { sessionStore } from '$lib/stores';
	import { i18n } from '$lib/i18n';
	import SessionList from '$lib/components/sessions/SessionList.svelte';
	import SessionDetail from '$lib/components/sessions/SessionDetail.svelte';

	onMount(() => {
		sessionStore.load();
	});
</script>

<Header title={i18n.t('session.title')} subtitle={i18n.t('session.subtitle')} />

<div class="flex-1 overflow-hidden p-6">
	<div class="h-full grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
		<div class="h-full overflow-hidden flex flex-col">
			<SessionList />
		</div>
		<div class="h-full overflow-hidden flex flex-col">
			<SessionDetail />
		</div>
	</div>
</div>
