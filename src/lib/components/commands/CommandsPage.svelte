<script lang="ts">
  import { onMount } from "svelte";
  import { api, type CommandInfo } from "$lib/tauri/commands";
  import ProjectPicker from "$lib/components/shared/ProjectPicker.svelte";
  import ConfirmDialog from "$lib/components/shared/ConfirmDialog.svelte";
  import { getSelectedProjectPath } from "$lib/stores/project-context.svelte";
  import { renderMarkdown } from "$lib/utils/markdown";
  import { Terminal, Plus, Search, X, Trash2 } from "lucide-svelte";
  import { i18n } from "$lib/i18n";

  let scope = $state<"global" | "project">("global");
  let commands = $state<CommandInfo[]>([]);
  let selected = $state<CommandInfo | null>(null);
  let loading = $state(true);
  let searchQuery = $state("");

  // editor
  let editing = $state(false);
  let isNew = $state(false);
  let editName = $state("");
  let editContent = $state("");
  let saving = $state(false);
  let saveMessage = $state<string | null>(null);
  let previewMode = $state(false);

  let deleteDialogOpen = $state(false);

  const projectPath = $derived(getSelectedProjectPath());
  const needsProject = $derived(scope === "project");

  const filtered = $derived(
    commands.filter((c) => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  function parseDescription(raw: string): string {
    if (!raw.startsWith("---")) return "";
    const end = raw.indexOf("---", 3);
    if (end === -1) return "";
    const front = raw.slice(3, end);
    const m = front.match(/^description:\s*(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  }

  function stripFrontmatter(raw: string): string {
    return raw.replace(/^---[\s\S]*?---\s*/, "");
  }

  async function load() {
    if (needsProject && !projectPath) { loading = false; commands = []; return; }
    loading = true;
    try {
      const pp = needsProject ? projectPath ?? undefined : undefined;
      commands = await api.commands.list(scope, pp);
    } catch (e) { console.error(e); commands = []; }
    finally { loading = false; }
  }

  function selectItem(c: CommandInfo) {
    selected = c; editing = false; isNew = false;
  }

  function startEdit() {
    if (!selected) return;
    editName = selected.name; editContent = selected.content;
    editing = true; isNew = false; previewMode = false;
  }

  function startCreate() {
    editName = "";
    editContent = "---\ndescription: What this command does\nargument-hint: <args>\n---\n\n# Prompt\n\nDescribe what Claude should do when /" + "name is invoked.\n";
    editing = true; isNew = true; selected = null; previewMode = false;
  }

  async function save() {
    const name = isNew ? editName.trim() : selected?.name;
    if (!name) return;
    saving = true; saveMessage = null;
    try {
      const pp = needsProject ? projectPath ?? undefined : undefined;
      await api.commands.write(scope, name, editContent, pp);
      saveMessage = i18n.t("shared.saved");
      setTimeout(() => (saveMessage = null), 2000);
      await load();
      if (isNew) {
        selected = commands.find((c) => c.name === name) ?? null;
        editing = false; isNew = false;
      }
    } catch (e) { saveMessage = `${i18n.t("shared.error")}: ${e}`; }
    finally { saving = false; }
  }

  async function deleteItem() {
    if (!selected) return;
    try {
      const pp = needsProject ? projectPath ?? undefined : undefined;
      await api.commands.delete(scope, selected.name, pp);
      selected = null; editing = false;
      await load();
    } catch (e) { console.error(e); }
    finally { deleteDialogOpen = false; }
  }

  onMount(load);
</script>

<ConfirmDialog
  open={deleteDialogOpen}
  title={i18n.t("commands.deleteTitle")}
  message={i18n.t("commands.deleteConfirm")}
  onconfirm={deleteItem}
  oncancel={() => (deleteDialogOpen = false)}
/>

<div class="flex h-full">
  <!-- Sidebar -->
  <div class="w-64 shrink-0 border-r border-border flex flex-col bg-bg-secondary">
    <div class="p-3 border-b border-border space-y-2">
      <div class="flex gap-1 bg-bg-tertiary rounded-lg p-1">
        <button
          class="flex-1 px-3 py-1.5 text-xs rounded-md transition-colors {scope === 'global' ? 'bg-bg-secondary text-text-primary' : 'text-text-muted'}"
          onclick={() => { scope = "global"; selected = null; editing = false; load(); }}
        >{i18n.t('shared.global')}</button>
        <button
          class="flex-1 px-3 py-1.5 text-xs rounded-md transition-colors {scope === 'project' ? 'bg-bg-secondary text-text-primary' : 'text-text-muted'}"
          onclick={() => { scope = "project"; selected = null; editing = false; load(); }}
        >{i18n.t('shared.project')}</button>
      </div>
      {#if needsProject}
        <ProjectPicker onselect={load} />
      {/if}
      <div class="relative">
        <Search size={14} class="absolute left-2.5 top-2 text-text-muted" />
        <input
          type="text"
          class="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          placeholder={i18n.t('shared.search')}
          bind:value={searchQuery}
        />
      </div>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if loading}
        <p class="text-xs text-text-muted px-3 py-4 text-center">{i18n.t('shared.loading')}</p>
      {:else if needsProject && !projectPath}
        <p class="text-xs text-text-muted px-3 py-4 text-center">{i18n.t('shared.selectProject')}</p>
      {:else}
        {#each filtered as c}
          <button
            class="w-full text-left px-3 py-2.5 transition-colors border-b border-border/50
              {selected?.name === c.name ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-bg-hover'}"
            onclick={() => selectItem(c)}
          >
            <div class="flex items-center gap-2">
              <Terminal size={14} class="shrink-0 text-success" />
              <span class="text-sm font-medium truncate font-mono">/{c.name}</span>
            </div>
            {#if parseDescription(c.content)}
              <p class="text-[10px] text-text-muted mt-0.5 truncate ml-[22px]">{parseDescription(c.content)}</p>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <div class="p-3 border-t border-border">
      <button
        class="w-full flex items-center justify-center gap-1.5 py-2 text-xs bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
        onclick={startCreate}
      >
        <Plus size={14} />
        {i18n.t('library.new')}
      </button>
    </div>
  </div>

  <!-- Main content -->
  <div class="flex-1 flex min-w-0">
    {#if editing || isNew}
      <div class="flex-1 flex flex-col">
        <div class="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div class="flex items-center gap-3">
            {#if isNew}
              <label class="flex items-center gap-2">
                <span class="text-xs text-text-muted">{i18n.t('shared.name')}</span>
                <input
                  type="text"
                  class="px-3 py-1 text-sm bg-bg-tertiary border border-border rounded-md text-text-primary font-mono focus:outline-none focus:border-accent"
                  placeholder="my-command"
                  bind:value={editName}
                />
              </label>
            {:else}
              <span class="text-sm font-medium text-text-primary font-mono">/{selected?.name}</span>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            {#if saveMessage}
              <span class="text-xs {saveMessage.startsWith(i18n.t('shared.error')) ? 'text-danger' : 'text-success'}">{saveMessage}</span>
            {/if}
            <div class="flex gap-1 bg-bg-tertiary rounded-lg p-0.5">
              <button class="px-2 py-1 text-[10px] rounded {!previewMode ? 'bg-bg-secondary text-text-primary' : 'text-text-muted'}" onclick={() => (previewMode = false)}>{i18n.t('shared.edit')}</button>
              <button class="px-2 py-1 text-[10px] rounded {previewMode ? 'bg-bg-secondary text-text-primary' : 'text-text-muted'}" onclick={() => (previewMode = true)}>{i18n.t('shared.preview')}</button>
            </div>
            <button
              class="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-md disabled:opacity-50"
              onclick={save}
              disabled={saving || (isNew && !editName.trim())}
            >{saving ? "..." : i18n.t('shared.save')}</button>
            <button class="p-1 text-text-muted hover:text-text-primary" onclick={() => { editing = false; isNew = false; }} aria-label="Close"><X size={16} /></button>
          </div>
        </div>

        <div class="flex-1 overflow-hidden p-4">
          {#if previewMode}
            <div class="h-full overflow-y-auto md-preview px-4">{@html renderMarkdown(stripFrontmatter(editContent))}</div>
          {:else}
            <textarea
              class="w-full h-full px-4 py-3 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary font-mono resize-none focus:outline-none focus:border-accent"
              placeholder={"---\ndescription: ...\n---\n\n# Prompt"}
              bind:value={editContent}
            ></textarea>
          {/if}
        </div>
      </div>
    {:else if selected}
      <div class="flex-1 overflow-y-auto p-6 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <Terminal size={20} class="text-success" />
            </div>
            <div>
              <h2 class="text-lg font-semibold text-text-primary font-mono">/{selected.name}</h2>
              {#if parseDescription(selected.content)}
                <p class="text-sm text-text-muted">{parseDescription(selected.content)}</p>
              {/if}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button class="px-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded-md text-text-secondary hover:border-accent/30" onclick={startEdit}>{i18n.t('library.edit')}</button>
            <button class="p-1.5 text-text-muted hover:text-danger rounded" onclick={() => (deleteDialogOpen = true)} aria-label="Delete"><Trash2 size={14} /></button>
          </div>
        </div>

        <div class="bg-bg-secondary border border-border rounded-lg p-6">
          <div class="md-preview">{@html renderMarkdown(stripFrontmatter(selected.content) || "_No content_")}</div>
        </div>
      </div>
    {:else}
      <div class="flex-1 flex flex-col items-center justify-center text-text-muted">
        <Terminal size={32} class="opacity-20 mb-3" />
        <p class="text-sm">{i18n.t('commands.empty')}</p>
        <p class="text-xs mt-1">{i18n.t('commands.emptyHint')}</p>
      </div>
    {/if}
  </div>
</div>
