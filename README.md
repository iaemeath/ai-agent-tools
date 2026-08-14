# ccc-ui

A web UI to manage AI coding-agent config — across scopes (user / project), across tools
(Claude Code, ZCode, …), and **across machines** (operate another host over SSH). Toggle
**skills** and **plugins** on/off; browse **projects** (session history), **instructions**
(CLAUDE.md / AGENTS.md), **rules**, **commands**, **agents**, and **hooks** — with in-place
markdown editing; inspect **MCP** servers and review **settings** — all from one place.

**Skills and plugins are toggle-able (live, no restart). Markdown resources (instructions /
rules / commands / agents) are view + edit. Everything else is read-only browsing.**
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
in the tool's settings. Markdown resources are **view + edit** (save back with `.bak` backup).
Other resources are **read-only browsing**.

| kind | mode | source of truth | notes |
|---|---|---|---|
| **skill** | toggle | `skillOverrides` (on/off/name-only/user-only) | also: promote project→global, delete |
| **plugin** | toggle | `enabledPlugins` (`name@marketplace`: bool) | also: inline file explorer (browse plugin dir + preview file content) |
| **project** | read-only | session-history folders (Claude) / SQLite DB (ZCode) | list + delete session history |
| **instruction** | view + edit | `CLAUDE.md` / `AGENTS.md` (global + per-project) | split-pane markdown viewer/editor + open in file manager |
| **mcp** | read-only | `mcpServers` (Claude) / `mcp.servers` (ZCode) | list servers + view config detail (command/args/env/url/headers) + live tool probe |
| **rule** | view + edit | `~/.{tool}/rules/*.md` + `<proj>/.{tool}/rules/*.md` | split-pane viewer/editor; Claude only (ZCode has no rules mechanism → empty state) |
| **command** | view + edit | `~/.{tool}/commands/*.md` + `<proj>/.{tool}/commands/*.md` | split-pane viewer/editor; custom slash commands |
| **agent** | view + edit | `~/.{tool}/agents/*.md` + `<proj>/.{tool}/agents/*.md` | split-pane viewer/editor; standalone subagents |
| **hook** | read-only | nested JSON in settings (`hooks` / `hooks.events`) | list + detail (event / matcher / command / timeout); Claude `settings.local.json` merged in |
| **settings** | read-only | settings JSON | overview of toggles / env vars / permissions / marketplaces |

On top of that, **remote SSH hosts** are first-class: the header host switcher retargets every
page at another machine's config (see *Architecture → Remote hosts*).

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
  - Markdown editing (instructions / rules / commands / agents): view/edit dual-mode with
    safe save-back (whitelist check + `.bak` backup + atomic write).
- **Phase 4** — remote SSH host management. **done**.
  - `Hosts` view: add / edit / delete hosts, test connection, disconnect (AES-256-GCM
    machine-bound secret storage; ssh2 connection pool with keepalive + dedupe).
  - Header host switcher: any host selection transparently retargets all pages.
  - **Architecture C remote exec** — on a remote host, reads AND writes run ON the remote
    (bundled script + one `node` exec per request), not over per-file SFTP. Measured over a
    VPN link: full overview 28.6s → **~0.5s**; markdown save ~0.8s. Windows remotes work
    fully (native `node:fs` there — no POSIX-shell/`cmd` mismatch, no SFTP virtual-path
    quirks, ZCode SQLite project source included).

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

### Remote hosts (Architecture C — remote exec, not SFTP pulling)

Every reader goes through a swappable `FsBackend` (`getFs()`), bound per-request from an
`AsyncLocalStorage` host context (`X-Host` header → host middleware). Local requests bind
`LocalFs` (node:fs) with zero overhead; remote requests used to bind `SshFs` (ssh2 SFTP) —
which works, but over a slow link the per-file round-trips compound catastrophically (a full
overview = hundreds of sequential SFTP calls ≈ **29s** over VPN).

So remote requests now take a different path: **run the work on the remote itself.**

```
route (isRemote) ──▶ remote/runner.ts (local side)
                       esbuild-bundles remote/entry.ts to MEMORY (once per process)
                       uploads it via SFTP to <home>/.ccc-ui/ccc-remote.<hash>.mjs
                       (hash-named; unchanged bundles skip re-upload; stale ones pruned)
                    ──▶ ssh exec: node ccc-remote.<hash>.mjs <command> "<base64 args>"
                       entry.ts runs ON the remote under its own node:
                         getHostCtx() → LOCAL_CONTEXT = the REMOTE's os.homedir()
                         + platform-native path + node:fs → localhost-speed reads/writes
                       prints one JSON blob: { status, body }
                    ──▶ sendRemote maps it onto c.json(body, status)
```

Consequences:

- **O(1) exec per request** instead of O(file-ops × RTT) — overview 28.6s → ~0.5s warm.
- Per-route status codes (404/409/413/…) pass through the hop intact.
- Windows remotes are fully functional: recursive mkdir/copy/remove are native `node:fs`
  there (no `cmd`-vs-POSIX gap), paths are platform-native (no SFTP `/C:/` virtual-path
  quirks), and ZCode's SQLite project source is readable (the DB opens on the remote).
- Args travel as base64 in argv (cmd-safe, no quoting); large args (e.g. file contents for
  saves) exceed cmd's ~8k line cap, so they upload as a temp JSON file over SFTP and pass
  as `"@<path>"` (auto-deleted after the exec). cmd.exe does not forward stdin EOF — that's
  why argv/file, not stdin.
- Requirements per remote host: SSH access + Node installed. Nothing else, nothing resident.
- MCP live probes (`mcps.tools`) run on the remote too — semantically correct: they test
  what the remote tool would reach.
- `explorer.exe`-style "open in file manager" stays local-only (a remote desktop action is
  out of scope); those routes refuse cleanly with `reason: 'remote'`.

### File map

```
server/src/                      Hono API (tsx, runs on :8787)
  index.ts                       entry: mounts 12 /api/* routes and (in prod) serves web/dist
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
  explorer.ts                    shared explorer.exe spawn (local-only; refuses remote cleanly)
  fs-backend/                    ★ swappable filesystem behind every reader
    types.ts                     FsBackend contract (exists/read/write/stat/readDir/mkdir/remove/copy/…)
    local.ts                     LocalFs — node:fs/promises
  hosts/                         remote-host machinery
    context.ts                   HostContext + AsyncLocalStorage binding (getFs()/getHostCtx())
    middleware.ts                X-Host header → resolve session → bind remote context (502 on failure)
    pool.ts                      ssh2 connection pool (reuse/keepalive/dedupe + permanent error sink)
    registry.ts                  ~/.ccc-ui/hosts.json CRUD (local-only bookkeeping)
    secrets.ts                   AES-256-GCM machine-bound secret encryption
    ssh.ts                       SshFs — SFTP-backed FsBackend (fallback path)
  remote/                        ★ Architecture C — remote exec runtime
    entry.ts                     runs ON the remote: command registry (22 commands mirroring
                                  the routes' validation/whitelists/status codes), {status,body} out
    runner.ts                    local side: esbuild bundle-to-memory, hash-cached upload,
                                  cmd-safe base64-argv args (large args via temp file), sendRemote
  adapters/
    types.ts                     ToolAdapter interface + registry(profile) (extension point)
    skill.ts                     SkillAdapter   (delegates to locator engine)
    plugin.ts                    PluginAdapter  (delegates to locator engine + manifest parsing)
  mutations/
    jsonKey.ts                   leaf primitive: read/write settings[key][name] with encoding
  routes/
    tools.ts                     overview / detail / set-status / view-content (?tool= param; remote-split)
    plugins.ts                   plugin detail + file browser (path-traversal-guarded; remote-split)
    projects.ts                  list / delete session-history (remote-split)
    skills.ts                    promote / delete skills + file browser (remote-split)
    instructions.ts rules.ts commands.ts agents.ts   list / content / save / open (remote-split)
    hooks.ts                     list / open (remote-split)
    mcps.ts                      list / detail / live probe / open (remote-split; probe runs on remote)
    settings.ts                  settings overview — remote fetch + local filter & secret masking
    hosts.ts                     host CRUD / test-connection / disconnect / pool status (always local)
web/src/                         Vue 3 SPA (Vite dev on :5173, proxies /api → :8787)
  stores/tool.ts                 ★ global tool selector (Claude ⇄ ZCode) shared by header + views
  stores/host.ts                 ★ global host selector ('local' ⇄ remote) — X-Host injection + reload
  api/index.ts                   fetch client — every method takes an optional `tool`; injects X-Host
  views/SkillsView.vue           skills page (toggle / promote / delete)
  views/PluginsView.vue          plugins page (toggle + inline file explorer with content preview)
  views/ProjectsView.vue         projects page (card grid + delete session history)
  views/InstructionsView.vue     instructions page (split-pane viewer + editor)
  views/MCPsView.vue             MCP page (card grid + inline detail + tool list)
  views/RulesView.vue            rules page (split-pane viewer + editor; Claude only)
  views/CommandsView.vue         commands page (split-pane viewer + editor)
  views/AgentsView.vue           agents page (split-pane viewer + editor)
  views/HooksView.vue            hooks page (list + detail: event / matcher / command / timeout)
  views/SettingsView.vue         settings page (read-only toggles / env / permissions overview)
  views/HostsView.vue            hosts page (add/edit/delete/test/disconnect)
  components/                    AppHeader (tool + host switchers) / AppSidebar / SkillCard / PluginCard / FileExplorer / MarkdownView
  i18n/                          vue-i18n (zh / en)
  router/                        /plugins /skills /projects /instructions /rules /commands /agents /hooks /mcps /settings /hosts — all live
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
