<script lang="ts">
  import { getCurrentPage, type Page } from "$lib/stores/navigation.svelte";
  import { i18n, type TranslationKey } from "$lib/i18n";
  import { Languages } from "lucide-svelte";

  const PAGE_TITLE_KEYS: Record<Page, TranslationKey> = {
    skills: "nav.skills",
    agents: "nav.agents",
    mcp: "nav.mcp",
    hooks: "nav.hooks",
    plugins: "nav.plugins",
    rules: "nav.rules",
    instructions: "nav.instructions",
    settings: "nav.settings",
  };

  const PAGE_DESC_KEYS: Record<Page, TranslationKey> = {
    skills: "desc.skills",
    agents: "desc.agents",
    mcp: "desc.mcp",
    hooks: "desc.hooks",
    plugins: "desc.plugins",
    rules: "desc.rules",
    instructions: "desc.instructions",
    settings: "desc.settings",
  };

  const currentPage = $derived(getCurrentPage());
</script>

<header class="flex items-center justify-between px-6 py-[7px] border-b border-border bg-bg-secondary">
  <div>
    <h2 class="text-lg font-semibold text-text-primary">{i18n.t(PAGE_TITLE_KEYS[currentPage])}</h2>
    <p class="text-sm text-text-muted">{i18n.t(PAGE_DESC_KEYS[currentPage])}</p>
  </div>
  <button
    class="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary rounded-md transition-colors"
    onclick={() => i18n.setLocale(i18n.nextLocale)}
    title={i18n.t('header.switchLanguage')}
    aria-label={i18n.t('header.switchLanguage')}
  >
    <Languages size={16} />
    <span class="text-xs font-medium">{i18n.currentLabel}</span>
  </button>
</header>
