<script lang="ts">
  import { getCurrentPage, type Page } from "$lib/stores/navigation.svelte";
  import { i18n, type TranslationKey } from "$lib/i18n";
  import { Languages } from "lucide-svelte";

  const PAGE_TITLE_KEYS: Record<Page, TranslationKey> = {
    dashboard: "nav.dashboard",
    settings: "nav.settings",
    hooks: "nav.hooks",
    instructions: "nav.instructions",
    memory: "nav.memory",
    mcp: "nav.mcp",
    skills: "nav.skills",
    rules: "nav.rules",
    plugins: "nav.plugins",
    git: "nav.git",
    terminal: "nav.terminal",
    analytics: "nav.analytics",
    pipelines: "nav.pipelines",
    sessions: "nav.sessions",
    templates: "nav.templates",
    "token-savings": "nav.token-savings",
    "context-engine": "nav.context-engine",
    keybindings: "nav.keybindings",
  };

  const PAGE_DESC_KEYS: Record<Page, TranslationKey> = {
    dashboard: "desc.dashboard",
    settings: "desc.settings",
    hooks: "desc.hooks",
    instructions: "desc.instructions",
    memory: "desc.memory",
    mcp: "desc.mcp",
    skills: "desc.skills",
    rules: "desc.rules",
    plugins: "desc.plugins",
    git: "desc.git",
    terminal: "desc.terminal",
    analytics: "desc.analytics",
    pipelines: "desc.pipelines",
    sessions: "desc.sessions",
    templates: "desc.templates",
    "token-savings": "desc.token-savings",
    "context-engine": "desc.context-engine",
    keybindings: "desc.keybindings",
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
