# ccc-ui

A web UI to manage AI coding-agent config — across scopes (user / project), across tools
(Claude Code, ZCode, …). Toggle **skills** and **plugins** on/off; browse **projects** (session
history), **instructions** (CLAUDE.md / AGENTS.md), **rules**, **commands**, **agents**, and
**hooks**; inspect **MCP** servers and review **settings** — all from one place.

**Skills and plugins are toggle-able (live, no restart). Everything else is read-only browsing.**
Source of truth is each tool's own native config; this app is a read/project/edit-back layer over it,
never a parallel database.

Node + Hono backend, Vue 3 + Element Plus frontend.

---

## Why multi-tool

Different AI coding tools (Claude Code, ZCode, …) store their config under different directories,
with different settings-file layouts, different plugin-manifest formats, and different key-nesting for
the on/off switch. ccc-ui abstracts all those differences into a **declarative profile** per tool, so:

- **Adding a new tool = adding one profile object.** No engine/adapter changes.
- The read/write engine, the adapters, and the path helpers are **tool-agnostic** — they hold zero
  tool-specific string literals.

See *Architecture → ResourceLocator* below for how.

## Scope

**Skill** and **plugin** are toggle-able (live, no restart) — they carry a native per-name on/off switch
in the tool's settings. Other resources are **read-only browsing**.

| kind | mode | source of truth | notes |
|---|---|---|---|
| **skill** | toggle | `skillOverrides` (on/off/name-only/user-only) | also: promote project→global, delete |
| **plugin** | toggle | `enabledPlugins` (`name@marketplace`: bool) | also: inline file explorer (browse plugin dir + preview file content) |
| **project** | read-only | session-history folders (Claude) / SQLite DB (ZCode) | list + delete session history |
| **instruction** | read-only | `CLAUDE.md` / `AGENTS.md` (global + per-project) | split-pane markdown viewer + open in file manager |
| **mcp** | read-only | `mcpServers` (Claude) / `mcp.servers` (ZCode) | list servers + view config detail (command/args/env/url/headers) + live tool probe |
| **rule** | read-only | `~/.{tool}/rules/*.md` + `<proj>/.{tool}/rules/*.md` | split-pane viewer; Claude only (ZCode has no rules mechanism → empty state) |
| **command** | read-only | `~/.{tool}/commands/*.md` + `<proj>/.{tool}/commands/*.md` | split-pane viewer; custom slash commands |
| **agent** | read-only | `~/.{tool}/agents/*.md` + `<proj>/.{tool}/agents/*.md` | split-pane viewer; standalone subagents |
| **hook** | read-only | nested JSON in settings (`hooks` / `hooks.events`) | list + detail (event / matcher / command / timeout); Claude `settings.local.json` merged in |
| **settings** | read-only | settings JSON | overview of toggles / env vars / permissions / marketplaces |

MCP edit/toggle is deferred — the three tools' on/off mechanisms differ too widely (ZCode has `enabled`,
Claude has project-block arrays, Codex has none), so a unified toggle would create "fake" switches the
tool ignores. Read-only aggregation is the honest MVP.

## Philosophy

**Config-as-SSOT.** This app holds no parallel copy of any tool's data. It only reads each tool's native
config (`skillOverrides`, `enabledPlugins`) and writes it back with key-preserving merges (other top-level
keys untouched). Every write is preceded by a `.bak` backup of the file it overwrites.

## Status

- **Phase 0** — scaffold (Node + Hono + Vue 3 + Element Plus). done.
- **Phase 1** — skill + plugin toggle, profile-aware. **done** for Claude Code + ZCode.
  - `Skills` view: live (toggle / promote / delete, tool switcher in header).
  - `Plugins` view: live (toggle + inline **file explorer** — browse plugin dir, preview file content,
    open in file manager).
  - Tool switching (Claude Code ⇄ ZCode) is global, in the header.
- **Phase 2** — read-only browsing pages. **done** for Claude Code + ZCode.
  - `Projects` view: card grid (session count / last activity) + delete session history.
    Supports both fs folders (Claude) and SQLite DB (ZCode) via unified `ProjectsLocator`.
  - `Instructions` view: split-pane markdown viewer (global CLAUDE.md/AGENTS.md left, project cards right,
    draggable splitter) + open in file manager.
  - `MCP` view: card grid + inline detail (transport / command / args / env / url / headers).
    Claude + ZCode only (Codex TOML deferred).
- **Phase 3** — markdown-resource browsing + config overview. **done** for Claude Code + ZCode.
  - `Rules` / `Commands` / `Agents` views: split-pane markdown viewer (global left, project cards right)
    + open in file manager. Rules is Claude-only (ZCode has no rules mechanism → empty state).
  - `Hooks` view: list + detail (event / matcher / command / timeout / source file); Claude
    `settings.local.json` merged in, ZCode `hooks.enabled` kill-switch reflected.
  - `Settings` view: read-only overview of toggles / env vars / permissions / marketplaces.

---

## Dev

Prerequisites: Node 18+ (developed on Node 22+). Plain npm workspace — no native toolchain.

```bash
npm install            # installs both server and web workspaces
npm run dev            # concurrently starts backend (:8787) + frontend (:5173)
```

Open **http://localhost:5173**. Vite proxies `/api` → `:8787`, so the frontend talks to the Hono API
in dev. (In production, `npm run build` emits `web/dist/` and the server serves it at `/`.)

```bash
npm run dev:server     # backend only (tsx watch)
npm run dev:web        # frontend only (vite)
npm run build          # type-check (vue-tsc) + vite build → web/dist
npm run typecheck      # tsc (server) + vue-tsc (web), no emit
npm start              # run server (serves API + built frontend) on $PORT or 8787
```

---

## Architecture

### The ResourceLocator model (core design)

Every tool-specific difference — where skills live, how the plugin manifest is keyed, where the
enabled-switch nests in settings JSON, how values are encoded — is declared in one place
(`profiles.ts`) as a **profile**. Everything else is a tool-agnostic engine.

```
profiles.ts         ToolProfile — the single source of truth for per-tool layout
                      skills:       { dirName, marker, overridesKeyPath, overridesEncoding }
                      plugins:      { dirRelative, manifestFile, manifestIsArray, manifestIdField,
                                       enabledKeyPath, enabledEncoding }
                      projects:     ProjectsLocator — fs (dash-encoded folders) OR sqlite (session DB)
                      instructions: { fileName }   — CLAUDE.md / AGENTS.md
                      mcps:         { userFile, userKeyPath, projectFile, projectDir, projectKeyPath }
                    ↓ read by
locator.ts          tool-agnostic engine:
                      readRegistry(profile)   — parse manifest (array OR map) → normalized Map
                      readFlag(enc, json, keyPath, name)   — walk nested key path → Status
                      writeFlag(enc, json, keyPath, name, status) — walk + auto-create + write
                    ↓ used by
adapters/           SkillAdapter / PluginAdapter — scan / setStatus / view / detail
                      (hold NO tool-specific literals; everything comes from the profile)
paths.ts            path helpers — derive from profile locator fields, no hardcoded segments
mutations/jsonKey.ts  leaf-level read/write of settings[key][name] (boolean OR string encoding)
projects-reader.ts  unified project discovery (fs folders OR sqlite rows) + delete
instructions-reader.ts  read-only instruction file discovery + content read
mcp-reader.ts       read-only MCP server discovery (user-level + project-level) + transport inference
decode.ts           decode dash-encoded project folder names (Windows drive + underscore recombination)
```

**The invariant:** no tool-specific string literal ('skills', 'SKILL.md', 'enabledPlugins', 'id', …)
lives outside `profiles.ts`. Adding a tool never touches the engine, adapters, or paths.

### Adding a new tool (e.g. Codex)

Add one entry to `PROFILES` in `profiles.ts`. That's the whole change:

```typescript
codex: {
  id: 'codex', label: 'Codex', configDir: '.codex', projectPrefix: '.codex',
  settingsFile: ['config.json'],
  projects: { source: 'fs', dirRelative: 'sessions', encoding: 'dash' },
  skills: {
    dirName: 'skills', marker: 'SKILL.md',
    overridesKeyPath: ['skillOverrides'], overridesEncoding: SKILL_STR,
  },
  plugins: {
    dirRelative: ['plugins'], manifestFile: 'plugins.json',
    manifestIsArray: false, manifestIdField: null,
    enabledKeyPath: ['enabledPlugins'], enabledEncoding: PLUGIN_BOOL,
  },
  instructions: { fileName: 'AGENTS.md' },
  mcps: {
    userFile: ['.codex', 'config.toml'],       // NB: TOML needs its own reader (not JSON)
    userKeyPath: ['mcp_servers'],
    projectFile: 'config.toml', projectDir: '.codex', projectKeyPath: ['mcp_servers'],
  },
}
```

Then add `'codex'` to `ToolId` in `profiles.ts` and to the frontend `TOOL_OPTIONS` in `stores/tool.ts`.
Skill/plugin toggle, projects, instructions all work without further change. MCP needs a TOML reader
(the JSON-based `mcp-reader.ts` won't parse `.toml`).

### File map

```
server/src/                      Hono API (tsx, runs on :8787)
  index.ts                       entry: mounts 11 /api/* routes and (in prod) serves web/dist
  profiles.ts                    ★ ToolProfile declarations (the ONLY place tool differences live)
  locator.ts                     ★ tool-agnostic read/write engine (readRegistry / readFlag / writeFlag)
  paths.ts                       path helpers — all derived from profile fields
  model.ts                       data model + resolveEffective (two-level status resolution)
  settings.ts                    SSOT-safe JSON read/write (key-preserving merge + .bak backup)
  scan.ts                        overview aggregator — runs every adapter for a profile
  decode.ts                      decode dash-encoded project folder names (Windows drive + underscore)
  projects-reader.ts             unified project discovery (fs folders OR sqlite) + delete
  instructions-reader.ts         read-only instruction file discovery + content read
  mcp-reader.ts                  read-only MCP server discovery (user-level + project-level) + transport inference
  rules-reader.ts                read-only rule discovery (Claude only — ZCode has no rules mechanism)
  commands-reader.ts             read-only slash-command discovery (*.md)
  agents-reader.ts               read-only subagent discovery (*.md)
  hooks-reader.ts                read-only hook discovery from nested settings JSON
  markdown-resource.ts           shared scan/parse primitives (frontmatter, line count, dedupe)
  mcp-tools.ts                   live MCP tool probe (stdio/http/sse JSON-RPC handshake → tools/list)
  adapters/
    types.ts                     ToolAdapter interface + registry(profile) (extension point)
    skill.ts                     SkillAdapter   (delegates to locator engine)
    plugin.ts                    PluginAdapter  (delegates to locator engine + manifest parsing)
  mutations/
    jsonKey.ts                   leaf primitive: read/write settings[key][name] with encoding
  routes/
    tools.ts                     overview / detail / set-status / view-content (?tool= param)
    plugins.ts                   plugin detail + file browser (list dir / read file, path-traversal-guarded)
    projects.ts                  list / delete session-history
    skills.ts                    promote / delete skills
    instructions.ts              list / content / open-in-explorer
    mcps.ts                      list / detail / open-in-explorer + live tool probe
    rules.ts commands.ts agents.ts hooks.ts   list / content / open-in-explorer (markdown resources)
    settings.ts                  read-only settings overview (toggles / env / permissions / marketplaces)
web/src/                         Vue 3 SPA (Vite dev on :5173, proxies /api → :8787)
  stores/tool.ts                 ★ global tool selector (Claude ⇄ ZCode) shared by header + views
  api/index.ts                   fetch client — every method takes an optional `tool`
  views/SkillsView.vue           skills page (toggle / promote / delete)
  views/PluginsView.vue          plugins page (toggle + inline file explorer with content preview)
  views/ProjectsView.vue         projects page (card grid + delete session history)
  views/InstructionsView.vue     instructions page (split-pane markdown viewer)
  views/MCPsView.vue             MCP page (card grid + inline detail + tool list)
  views/RulesView.vue            rules page (split-pane viewer; Claude only → empty state on ZCode)
  views/CommandsView.vue         commands page (split-pane slash-command viewer)
  views/AgentsView.vue           agents page (split-pane subagent viewer)
  views/HooksView.vue            hooks page (list + detail: event / matcher / command / timeout)
  views/SettingsView.vue         settings page (read-only toggles / env / permissions overview)
  components/                    AppHeader / AppSidebar / SkillCard / PluginCard / FileExplorer / MarkdownView
  i18n/                          vue-i18n (zh / en)
  router/                        /plugins /skills /projects /instructions /rules /commands /agents /hooks /mcps /settings — all live
```

### Two-level status resolution

Each tool instance carries a `perScope` list: `[user, ...project?]`. `resolveEffective()` walks from
the most-specific scope (project — last) outward to user; the first non-`inherited` status wins.
If everything is `inherited` (or the list is empty), the default is `enabled`. The UI shows both the
per-scope breakdown and the computed effective status.

---

## Project evolution & branch map

This repository is the **`ccc-ui` mainline**. It also preserves earlier attempts that explored the
design space, each as an **orphan branch** (isolated history, never merged into `main`).

| branch | what it holds | license | merged? |
|---|---|---|---|
| **`main`** | mainline — profile-aware multi-tool architecture | MIT | — (trunk) |
| `attempts/claude-code-config-ui` | earlier mainline snapshot (pre-profile) | MIT | ✅ fast-forwards |
| `attempts/glyphic` | attempt #1 — fork of [caioricciuti/glyphic](https://github.com/caioricciuti/glyphic) + i18n / card UI | AGPL-3.0 | ❌ orphan, reference only |
| `attempts/claude-code-tool-manager` | attempt #2 — fork of [tylergraydev/claude-code-tool-manager](https://github.com/tylergraydev/claude-code-tool-manager) + the architecture proposal | MIT | ❌ orphan, reference only |

**Per-branch licensing:** orphan branches are not merged, so `main` stays MIT-clean (no AGPL glyphic
code lives on it).

## Acknowledgements

- **[tylergraydev/claude-code-tool-manager](https://github.com/tylergraydev/claude-code-tool-manager)** —
  the Tauri 2 + SvelteKit + Rust foundation and UI patterns explored earlier (MIT).
- **[caioricciuti/glyphic](https://github.com/caioricciuti/glyphic)** — i18n approach and card UI that
  informed early design exploration (AGPL-3.0, kept on its own branch only).
