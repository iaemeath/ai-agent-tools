<script lang="ts">
	import { Header } from '$lib/components/layout';
	import { Placeholder } from '$lib/components/shared';
	import { i18n } from '$lib/i18n';
</script>

<Header title={i18n.t('nav.hooks')} onRefresh={() => {}} />
<div class="flex-1 overflow-auto">
	<Placeholder kind="hooks" />
</div>
