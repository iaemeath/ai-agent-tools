<script lang="ts">
	import { Header } from '$lib/components/layout';
	import { i18n } from '$lib/i18n';
</script>

<Header title={i18n.t('nav.settings')} />
<div class="flex-1 overflow-auto p-6">
	<div class="mx-auto max-w-2xl space-y-4">
		<div class="card">
			<h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">{i18n.t('app.name')} {i18n.t('app.tagline')}</h2>
			<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
				Toggle Claude Code skills and plugins across user and project scopes.
			</p>
		</div>
		<div class="card">
			<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">{i18n.t('header.switchLanguage')}</h3>
			<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">EN / 简体中文 — use the button in the header.</p>
		</div>
		<div class="card">
			<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">{i18n.t('header.toggleTheme')}</h3>
			<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Dark / Light — toggle via the header.</p>
		</div>
	</div>
</div>

