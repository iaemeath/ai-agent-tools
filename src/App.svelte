<script lang="ts">
  import Sidebar from "$lib/components/layout/Sidebar.svelte";
  import Header from "$lib/components/layout/Header.svelte";
  import UpdateBanner from "$lib/components/layout/UpdateBanner.svelte";
  import CommandPalette from "$lib/components/shared/CommandPalette.svelte";
  import OnboardingWelcome from "$lib/components/shared/OnboardingWelcome.svelte";
  import SkillsPage from "$lib/components/skills/SkillsPage.svelte";
  import McpPage from "$lib/components/mcp/McpPage.svelte";
  import HooksPage from "$lib/components/hooks/HooksPage.svelte";
  import PluginsPage from "$lib/components/plugins/PluginsPage.svelte";
  import RulesPage from "$lib/components/rules/RulesPage.svelte";
  import InstructionsPage from "$lib/components/instructions/InstructionsPage.svelte";
  import SettingsPage from "$lib/components/settings/SettingsPage.svelte";
  import { getCurrentPage } from "$lib/stores/navigation.svelte";

  const currentPage = $derived(getCurrentPage());
</script>

<CommandPalette />
<OnboardingWelcome />

<div class="flex h-screen w-screen">
  <Sidebar />

  <main class="flex flex-col flex-1 min-w-0">
    <UpdateBanner />
    <Header />

    <div class="flex-1 overflow-hidden">
      {#if currentPage === "skills"}
        <SkillsPage />
      {:else if currentPage === "mcp"}
        <McpPage />
      {:else if currentPage === "hooks"}
        <HooksPage />
      {:else if currentPage === "plugins"}
        <PluginsPage />
      {:else if currentPage === "rules"}
        <RulesPage />
      {:else if currentPage === "instructions"}
        <InstructionsPage />
      {:else if currentPage === "settings"}
        <SettingsPage />
      {/if}
    </div>
  </main>
</div>
