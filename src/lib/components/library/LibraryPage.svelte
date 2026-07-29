<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    type LibraryItem,
    type Deployment,
    type ManagedProject,
    type LibraryKind,
    type DeployScope,
  } from "$lib/tauri/commands";
  import { i18n } from "$lib/i18n";
  import {
    Plus, Search, X, Trash2, Pencil, Upload, Globe,
    Library as LibraryIcon, Sparkles, Bot, Shield, Terminal, Server, Zap,
  } from "lucide-svelte";

  let kind = $state<LibraryKind>("skills");
  let items = $state<LibraryItem[]>([]);
  let deployments = $state<Record<string, Deployment[]>>({});
  let projects = $state<ManagedProject[]>([]);
  let loading = $state(true);
  let search = $state("");

  // editor
  let editing = $state(false);
  let isNew = $state(false);
  let editingItem = $state<LibraryItem | null>(null);
  let editName = $state("");
  let editContent = $state("");
  let editPaths = $state("");
  let saving = $state(false);
  let msg = $state<string | null>(null);

  // modals
  let deleting = $state<LibraryItem | null>(null);
  let deployTarget = $state<LibraryItem | null>(null);

  const KINDS: { id: LibraryKind; labelKey: "nav.skills" | "nav.agents" | "nav.rules" | "nav.commands" | "nav.mcp" | "nav.hooks"; icon: typeof Sparkles }[] = [
    { id: "skills", labelKey: "nav.skills", icon: Sparkles },
    { id: "agents", labelKey: "nav.agents", icon: Bot },
    { id: "rules", labelKey: "nav.rules", icon: Shield },
    { id: "commands", labelKey: "nav.commands", icon: Terminal },
    { id: "mcp", labelKey: "nav.mcp", icon: Server },
    { id: "hooks", labelKey: "nav.hooks", icon: Zap },
  ];

  const isRules = $derived(kind === "rules");
  const isJsonKind = $derived(kind === "mcp" || kind === "hooks");
  const placeholder = $derived(
    isJsonKind ? "{\n  ...\n}" : "---\nname: ...\ndescription: ...\n---\n\n# ...",
  );

  const filtered = $derived(
    items.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase())),
  );

  async function load() {
    loading = true;
    try {
      items = await api.library.list(kind);
      const map: Record<string, Deployment[]> = {};
      await Promise.all(
        items.map(async (it) => {
          try { map[it.name] = await api.library.deployments(kind, it.name); }
          catch { map[it.name] = []; }
        }),
      );
      deployments = map;
    } catch (e) { console.error(e); items = []; }
    finally { loading = false; }
  }

  async function loadProjects() {
    try { projects = await api.projects.listAll(); } catch (e) { console.error(e); }
  }

  function switchKind(k: LibraryKind) {
    if (k === kind) return;
    kind = k;
    editing = false; isNew = false; editingItem = null;
    load();
  }

  function startCreate() {
    let tpl: string;
    if (kind === "skills") {
      tpl = "---\nname: my-skill\ndescription: What this skill does\n---\n\n# Instructions\n\nDescribe what Claude should do.\n";
    } else if (kind === "agents") {
      tpl = "---\nname: my-agent\ndescription: When to delegate to this agent\nmodel: sonnet\ntools: Read, Glob, Grep\n---\n\n# System Prompt\n\nYou are a specialized assistant that...\n";
    } else if (kind === "rules") {
      tpl = "Rule body in markdown.";
    } else if (kind === "commands") {
      tpl = "---\ndescription: What this command does\nargument-hint: <args>\n---\n\n# Prompt\n\nDescribe what Claude should do.\n";
    } else if (kind === "mcp") {
      tpl = '{\n  "command": "npx",\n  "args": ["-y", "package"]\n}\n';
    } else {
      // hooks
      tpl = '{\n  "event": "PreToolUse",\n  "config": {\n    "matcher": "Bash",\n    "hooks": [\n      { "type": "command", "command": "echo hello" }\n    ]\n  }\n}\n';
    }
    editContent = tpl; editName = ""; editPaths = "";
    isNew = true; editing = true; editingItem = null;
  }

  function startEdit(it: LibraryItem) {
    editingItem = it; editName = it.name; editContent = it.content;
    editPaths = it.pathsFilter.join(", ");
    isNew = false; editing = true;
  }

  async function save() {
    const name = isNew ? editName.trim() : editingItem?.name;
    if (!name) return;
    saving = true; msg = null;
    try {
      const pathsFilter = isRules
        ? editPaths.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      await api.library.write(kind, name, editContent, pathsFilter);
      msg = i18n.t("shared.saved");
      setTimeout(() => (msg = null), 2000);
      editing = false; isNew = false; editingItem = null;
      await load();
    } catch (e) { msg = `${i18n.t("shared.error")}: ${e}`; }
    finally { saving = false; }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try { await api.library.delete(kind, deleting.name); await load(); }
    catch (e) { console.error(e); }
    finally { deleting = null; }
  }

  const deployTargets = $derived([
    { scope: "global" as DeployScope, projectPath: undefined as string | undefined, label: i18n.t("library.global") },
    ...projects.map((p) => ({ scope: "project" as DeployScope, projectPath: p.path, label: p.name })),
  ]);

  async function doDeploy(scope: DeployScope, projectPath?: string) {
    if (!deployTarget) return;
    try {
      await api.library.deploy(kind, deployTarget.name, scope, projectPath);
      deployTarget = null;
      await load();
    } catch (e) { alert(`${e}`); }
  }

  async function doUndeploy(d: Deployment, itemName: string) {
    try {
      await api.library.undeploy(kind, itemName, d.scope as DeployScope, d.projectPath ?? undefined);
      await load();
    } catch (e) { alert(`${e}`); }
  }

  function depLabel(d: Deployment): string {
    return d.scope === "global" ? i18n.t("library.global") : (d.projectName ?? d.projectPath ?? "");
  }

  onMount(() => { load(); loadProjects(); });
</script>

<div class="flex flex-col h-full">
  <!-- Top bar: kind tabs + search + new -->
  <div class="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 flex-wrap">
    <div class="flex gap-1 bg-bg-tertiary rounded-lg p-1 flex-wrap">
      {#each KINDS as k}
        {@const Icon = k.icon}
        <button
          class="flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors {kind === k.id ? 'bg-bg-secondary text-text-primary' : 'text-text-muted hover:text-text-primary'}"
          onclick={() => switchKind(k.id)}
        >
          <Icon size={13} />
          {i18n.t(k.labelKey)}
        </button>
      {/each}
    </div>
    <div class="relative w-48">
      <Search size={14} class="absolute left-2.5 top-2 text-text-muted" />
      <input
        type="text"
        bind:value={search}
        placeholder="..."
        class="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
      />
    </div>
    <div class="flex-1"></div>
    <button
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
      onclick={startCreate}
    >
      <Plus size={14} />
      {i18n.t("library.new")}
    </button>
  </div>

  <!-- Body -->
  <div class="flex-1 overflow-y-auto p-4">
    {#if editing}
      <div class="max-w-3xl mx-auto bg-bg-secondary border border-border rounded-lg flex flex-col" style="min-height: 70%;">
        <div class="flex items-center justify-between px-4 py-3 border-b border-border">
          <label class="block">
            <span class="text-xs text-text-muted">{i18n.t("shared.name")}</span>
            <input
              type="text"
              bind:value={editName}
              disabled={!isNew}
              class="ml-2 px-3 py-1 text-sm bg-bg-tertiary border border-border rounded-md text-text-primary font-mono focus:outline-none focus:border-accent disabled:opacity-60"
              placeholder="my-item"
            />
          </label>
          <div class="flex items-center gap-2">
            {#if msg}
              <span class="text-xs {msg.startsWith(i18n.t('shared.error')) ? 'text-danger' : 'text-success'}">{msg}</span>
            {/if}
            <button
              class="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-md disabled:opacity-50"
              onclick={save}
              disabled={saving || (isNew && !editName.trim())}
            >{saving ? "..." : i18n.t("library.save")}</button>
            <button
              class="p-1 text-text-muted hover:text-text-primary"
              onclick={() => { editing = false; isNew = false; editingItem = null; }}
              aria-label="Close"
            ><X size={16} /></button>
          </div>
        </div>

        {#if isJsonKind}
          <div class="px-4 py-2 border-b border-border text-[10px] text-text-muted">{i18n.t("library.jsonHint")} · {i18n.t("library.copyNote")}</div>
        {:else if isRules}
          <div class="px-4 py-2 border-b border-border">
            <label class="block">
              <span class="text-xs text-text-muted">{i18n.t("library.pathsFilter")}</span>
              <input
                type="text"
                bind:value={editPaths}
                class="mt-1 w-full px-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded-md text-text-primary font-mono focus:outline-none focus:border-accent"
                placeholder="src/**, **/*.test.ts"
              />
            </label>
          </div>
        {/if}

        <textarea
          class="flex-1 w-full px-4 py-3 text-sm bg-transparent border-0 text-text-primary font-mono resize-none focus:outline-none"
          placeholder={placeholder}
          bind:value={editContent}
        ></textarea>
      </div>
    {:else if loading}
      <p class="text-sm text-text-muted text-center py-10">{i18n.t('shared.loading')}</p>
    {:else if filtered.length === 0}
      <div class="flex flex-col items-center justify-center text-text-muted py-16">
        <LibraryIcon size={32} class="opacity-20 mb-3" />
        <p class="text-sm">{i18n.t("library.empty")}</p>
        <p class="text-xs mt-1">{i18n.t("library.emptyHint")}</p>
      </div>
    {:else}
      <div class="max-w-3xl mx-auto space-y-2">
        {#each filtered as it (it.name)}
          {@const deps = deployments[it.name] ?? []}
          <div class="bg-bg-secondary border border-border rounded-lg p-3">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2 min-w-0 flex-wrap">
                <span class="text-sm font-medium text-text-primary truncate">{it.name}</span>
                {#if isJsonKind}
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-warning/10 text-warning" title={i18n.t("library.copyNote")}>copy</span>
                {/if}
                {#if deps.length === 0}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted">{i18n.t("library.notDeployed")}</span>
                {:else}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success">{i18n.t("library.deployed")}:</span>
                  {#each deps as d}
                    <button
                      class="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent hover:bg-danger/10 hover:text-danger transition-colors"
                      title={i18n.t("library.undeploy")}
                      onclick={() => doUndeploy(d, it.name)}
                    >{depLabel(d)} ✕</button>
                  {/each}
                {/if}
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  class="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-accent rounded transition-colors"
                  onclick={() => startEdit(it)}
                ><Pencil size={12} />{i18n.t("library.edit")}</button>
                <button
                  class="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-accent rounded transition-colors"
                  onclick={() => { deployTarget = it; loadProjects(); }}
                ><Upload size={12} />{i18n.t("library.deployTo")}</button>
                <button
                  class="p-1 text-text-muted hover:text-danger rounded transition-colors"
                  onclick={() => (deleting = it)}
                  aria-label={i18n.t("library.delete")}
                ><Trash2 size={13} /></button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- Deploy modal -->
{#if deployTarget}
  <div class="fixed inset-0 z-50 flex items-center justify-center">
    <button class="absolute inset-0 bg-black/50" onclick={() => (deployTarget = null)} aria-label="Close"></button>
    <div class="relative bg-bg-secondary border border-border rounded-xl shadow-2xl w-96 p-5 z-10">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-text-primary">
          {i18n.t("library.deployTitle")}: <span class="text-accent">{deployTarget.name}</span>
        </h3>
        <button class="p-1 text-text-muted hover:text-text-primary" onclick={() => (deployTarget = null)}><X size={14} /></button>
      </div>
      {#if isJsonKind}
        <p class="text-[10px] text-text-muted mb-2">{i18n.t("library.copyNote")}</p>
      {/if}
      <div class="space-y-1">
        {#each deployTargets as t}
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-text-secondary hover:bg-bg-hover hover:text-text-primary rounded-md transition-colors"
            onclick={() => doDeploy(t.scope, t.projectPath)}
          >
            {#if t.scope === "global"}<Globe size={14} class="text-accent" />{:else}<LibraryIcon size={14} class="text-warning" />{/if}
            <span class="flex-1 truncate">{t.label}</span>
            {#if t.scope === "project"}<span class="text-[10px] text-text-muted truncate">{t.projectPath}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<!-- Delete confirm modal -->
{#if deleting}
  <div class="fixed inset-0 z-50 flex items-center justify-center">
    <button class="absolute inset-0 bg-black/50" onclick={() => (deleting = null)} aria-label="Close"></button>
    <div class="relative bg-bg-secondary border border-border rounded-xl shadow-2xl w-96 p-5 z-10 text-center">
      <Trash2 size={24} class="text-danger mx-auto mb-3" />
      <p class="text-sm text-text-secondary mb-4">{i18n.t("library.deleteConfirm")}</p>
      <p class="text-sm font-medium text-text-primary mb-4">{deleting.name}</p>
      <div class="flex gap-2">
        <button class="flex-1 px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-md text-text-secondary hover:text-text-primary" onclick={() => (deleting = null)}>{i18n.t("library.cancel")}</button>
        <button class="flex-1 px-3 py-2 text-sm bg-danger hover:opacity-90 text-white rounded-md" onclick={confirmDelete}>{i18n.t("library.delete")}</button>
      </div>
    </div>
  </div>
{/if}
