<script lang="ts">
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import {
    NAV_ITEMS,
    getCurrentPage,
    navigateTo,
  } from "$lib/stores/navigation.svelte";
  import {
    BarChart3,
    Settings as SettingsIcon,
    Zap,
    BookOpen,
    Server,
    Sparkles,
    Shield,
    Puzzle,
    Bot,
    Sun,
    Moon,
  } from "lucide-svelte";
  import { getTheme, toggleTheme } from "$lib/stores/theme.svelte";
  import { ExternalLink, GitBranch as GithubIcon, X as XIcon } from "lucide-svelte";
  import logoUrl from "$lib/assets/logo.png";
  import { i18n } from "$lib/i18n";

  let showAbout = $state(false);
  let appVersion = $state("...");

  const currentPage = $derived(getCurrentPage());

  const ICON_MAP: Record<string, typeof BarChart3> = {
    gear: SettingsIcon,
    bolt: Zap,
    book: BookOpen,
    server: Server,
    sparkles: Sparkles,
    shield: Shield,
    puzzle: Puzzle,
    bot: Bot,
  };

  const currentTheme = $derived(getTheme());

  onMount(async () => {
    try {
      appVersion = await getVersion();
    } catch {
      // silent
    }
  });
</script>

<aside
  class="flex flex-col h-full w-60 bg-bg-secondary border-r border-border shrink-0"
>
  <!-- Logo (clickable → About) -->
  <button
    class="flex items-center gap-2 px-4 py-[13.5px] border-b border-border w-full hover:bg-bg-hover transition-colors text-left"
    onclick={() => (showAbout = true)}
  >
    <img src={logoUrl} alt="Glyphic" class="w-8 h-8 rounded-lg" />
    <div>
      <h1 class="text-sm font-semibold text-text-primary">Glyphic</h1>
      <p class="text-xs text-text-muted">{i18n.t('sidebar.tagline')}</p>
    </div>
  </button>

  <!-- Navigation -->
  <nav class="flex-1 py-2 overflow-y-auto">
    {#each NAV_ITEMS as item}
      {@const IconComponent = ICON_MAP[item.icon]}
      <button
        class="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
          {currentPage === item.id
          ? 'bg-accent-dim text-accent border-r-2 border-accent'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}"
        onclick={() => navigateTo(item.id)}
      >
        <span class="w-5 h-5 flex items-center justify-center">
          {#if IconComponent}
            <IconComponent size={18} />
          {/if}
        </span>
        <span>{i18n.t(item.labelKey)}</span>
      </button>
    {/each}
  </nav>

  <!-- Theme toggle -->
  <div class="px-4 py-2 border-t border-border">
    <button
      class="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary rounded-md transition-colors"
      onclick={toggleTheme}
    >
      {#if currentTheme === "dark"}
        <Sun size={16} />
        <span>{i18n.t('theme.light')}</span>
      {:else}
        <Moon size={16} />
        <span>{i18n.t('theme.dark')}</span>
      {/if}
    </button>
  </div>

</aside>

<!-- About Dialog -->
{#if showAbout}
  <div class="fixed inset-0 z-50 flex items-center justify-center">
    <button class="absolute inset-0 bg-black/50" onclick={() => (showAbout = false)} aria-label="Close"></button>
    <div class="relative bg-bg-secondary border border-border rounded-2xl shadow-2xl w-96 p-8 text-center z-10">
      <button class="absolute top-3 right-3 p-1 text-text-muted hover:text-text-primary" onclick={() => (showAbout = false)} aria-label="Close">
        <XIcon size={16} />
      </button>

      <img src={logoUrl} alt="Glyphic" class="w-20 h-20 rounded-2xl mx-auto mb-4" />
      <h2 class="text-xl font-bold text-text-primary">Glyphic</h2>
      <p class="text-sm text-text-muted mt-1">{i18n.t('about.tagline')}</p>
      <p class="text-xs text-text-muted mt-1">{i18n.t('about.version')} {appVersion}</p>

      <div class="mt-6 space-y-2">
        <a
          href="https://caioricciuti.com"
          target="_blank"
          rel="noopener"
          class="flex items-center justify-center gap-2 text-sm text-accent hover:text-accent-hover transition-colors"
        >
          <ExternalLink size={14} />
          caioricciuti.com
        </a>
        <a
          href="https://github.com/caioricciuti/glyphic"
          target="_blank"
          rel="noopener"
          class="flex items-center justify-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <GithubIcon size={14} />
          github.com/caioricciuti/glyphic
        </a>
      </div>

      <div class="mt-6 pt-4 border-t border-border">
        <p class="text-xs text-text-muted">
          {i18n.t('about.builtBy')} <a href="https://caioricciuti.com" target="_blank" rel="noopener" class="text-accent hover:underline">Caio Ricciuti</a>
        </p>
        <p class="text-[10px] text-text-muted mt-1">{i18n.t('about.license')}</p>
      </div>
    </div>
  </div>
{/if}
