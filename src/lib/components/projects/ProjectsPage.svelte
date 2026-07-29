<script lang="ts">
  import { onMount } from "svelte";
  import { api, type ManagedProject } from "$lib/tauri/commands";
  import { i18n } from "$lib/i18n";
  import { open } from "@tauri-apps/plugin-dialog";
  import { selectProject } from "$lib/stores/project-context.svelte";
  import { navigateTo } from "$lib/stores/navigation.svelte";
  import { Plus, FolderOpen, Trash2, ExternalLink, AlertCircle, ArrowRight } from "lucide-svelte";

  let projects = $state<ManagedProject[]>([]);
  let loading = $state(true);
  let deleting = $state<ManagedProject | null>(null);

  async function load() {
    loading = true;
    try {
      projects = await api.projects.listAll();
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }

  async function addProject() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const path = typeof selected === "string"
        ? selected
        : Array.isArray(selected) ? selected[0] : null;
      if (path) {
        await api.projects.add(path);
        await load();
      }
    } catch (e) {
      console.error(e);
      alert(`${e}`);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api.projects.remove(deleting.path);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      deleting = null;
    }
  }

  function useAsScope(p: ManagedProject) {
    selectProject(p.path);
    navigateTo("skills");
  }

  onMount(load);
</script>

<div class="flex flex-col h-full">
  <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
    <p class="text-xs text-text-muted">{projects.length} {i18n.t("nav.projects").toLowerCase()}</p>
    <button
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
      onclick={addProject}
    >
      <Plus size={14} />
      {i18n.t("projects.add")}
    </button>
  </div>

  <div class="flex-1 overflow-y-auto p-4">
    {#if loading}
      <p class="text-sm text-text-muted text-center py-10">Loading...</p>
    {:else if projects.length === 0}
      <div class="flex flex-col items-center justify-center text-text-muted py-16">
        <FolderOpen size={32} class="opacity-20 mb-3" />
        <p class="text-sm">{i18n.t("projects.empty")}</p>
        <p class="text-xs mt-1">{i18n.t("projects.emptyHint")}</p>
      </div>
    {:else}
      <div class="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each projects as p (p.path)}
          <div class="bg-bg-secondary border border-border rounded-lg p-4 flex flex-col gap-2">
            <div class="flex items-start gap-2 min-w-0">
              <FolderOpen size={18} class="text-warning shrink-0 mt-0.5" />
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-sm font-medium text-text-primary truncate">{p.name}</span>
                  <span class="text-[9px] px-1 py-0.5 rounded {p.source === 'registered' ? 'bg-info/10 text-info' : 'bg-bg-tertiary text-text-muted'}">
                    {p.source === "registered" ? i18n.t("projects.registered") : i18n.t("projects.scanned")}
                  </span>
                  {#if !p.exists}
                    <span class="text-[9px] px-1 py-0.5 rounded bg-danger/10 text-danger inline-flex items-center gap-0.5">
                      <AlertCircle size={9} />{i18n.t("projects.moved")}
                    </span>
                  {/if}
                </div>
                <p class="text-[10px] text-text-muted font-mono truncate mt-0.5">{p.path}</p>
              </div>
            </div>

            <div class="flex items-center gap-1 pt-1 border-t border-border/50 mt-1">
              <button
                class="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-accent rounded transition-colors"
                onclick={() => api.projects.openFolder(p.path)}
              ><ExternalLink size={12} />{i18n.t("projects.openFolder")}</button>
              <button
                class="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-accent rounded transition-colors"
                title={i18n.t("projects.useHint")}
                onclick={() => useAsScope(p)}
              >{i18n.t("projects.use")}<ArrowRight size={11} /></button>
              <div class="flex-1"></div>
              {#if p.source === "registered"}
                <button
                  class="p-1 text-text-muted hover:text-danger rounded transition-colors"
                  onclick={() => (deleting = p)}
                  aria-label={i18n.t("projects.remove")}
                ><Trash2 size={13} /></button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if deleting}
  <div class="fixed inset-0 z-50 flex items-center justify-center">
    <button class="absolute inset-0 bg-black/50" onclick={() => (deleting = null)} aria-label="Close"></button>
    <div class="relative bg-bg-secondary border border-border rounded-xl shadow-2xl w-96 p-5 z-10 text-center">
      <Trash2 size={24} class="text-danger mx-auto mb-3" />
      <p class="text-sm text-text-secondary mb-4">{i18n.t("projects.removeConfirm")}</p>
      <p class="text-sm font-medium text-text-primary mb-1">{deleting.name}</p>
      <p class="text-[10px] text-text-muted font-mono mb-4 truncate">{deleting.path}</p>
      <div class="flex gap-2">
        <button class="flex-1 px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-md text-text-secondary hover:text-text-primary" onclick={() => (deleting = null)}>{i18n.t("library.cancel")}</button>
        <button class="flex-1 px-3 py-2 text-sm bg-danger hover:opacity-90 text-white rounded-md" onclick={confirmDelete}>{i18n.t("projects.remove")}</button>
      </div>
    </div>
  </div>
{/if}
