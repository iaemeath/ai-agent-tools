# ccc-ui

Manage Claude Code **skills** and **plugins**: toggle them on/off across scopes (user / project),
see status at a glance, promote project skills to global, and browse session history.
**Only toggles and file-level ops — no content editing.** Source of truth is Claude Code's own config.

Node + Hono backend, Vue 3 + Element Plus frontend. Replaces an earlier Tauri/Rust/SvelteKit design
(see *Project evolution* below).

> Design baseline: see `docs/REWRITE_PROPOSAL_zh.md` on the `attempts/claude-code-tool-manager` branch.

---

## Project evolution & branch map

This repository is the **new `ccc-ui` project mainline** — the architecture is confirmed, development is in
progress (not a finished product). It also preserves the earlier attempts that explored the design space, each
as an **orphan branch** (isolated history, never merged into `main`) so the evolution is readable in one place.

> **Status:** architecture confirmed. Phase 0 scaffold done; Phase 1 (skill + plugin toggle) in progress.

| branch | what it holds | license | merged into `main`? |
|---|---|---|---|
| **`main`** | new project mainline — initial implementation on the confirmed architecture | MIT | — (trunk) |
| `attempts/claude-code-config-ui` | the same mainline code, branch kept as the development line | MIT | ✅ yes |
| `attempts/glyphic` | attempt #1 — fork of [caioricciuti/glyphic](https://github.com/caioricciuti/glyphic) (v0.20.0) + i18n / page-trim work | AGPL-3.0 | ❌ orphan, reference only |
| `attempts/claude-code-tool-manager` | attempt #2 — fork of [tylergraydev/claude-code-tool-manager](https://github.com/tylergraydev/claude-code-tool-manager) (v3.10.0) + trim work + the Chinese architecture proposal | MIT | ❌ orphan, reference only |

**Why orphan branches?** The two fork attempts have no common ancestor with `main` (or with each other), so
they cannot be cleanly merged — and they carry different licenses (AGPL-3.0 vs MIT). They are kept as readable
snapshots of "what was tried", not as code that ships. Only `attempts/claude-code-config-ui` shares `main`'s
root commit, so it is the one that fast-forward-merges cleanly.

**Per-branch licensing:** each branch is an independent work; licenses do not cross-contaminate as long as the
orphan branches are not merged. `main` stays MIT-clean because no AGPL glyphic code lives on it.

## Acknowledgements

This project stands on the shoulders of two open-source projects, explored on the attempt branches above:

- **[tylergraydev/claude-code-tool-manager](https://github.com/tylergraydev/claude-code-tool-manager)** — the
  Tauri 2 + SvelteKit + Rust + SQLite foundation and UI patterns that this project builds on (MIT).
- **[caioricciuti/glyphic](https://github.com/caioricciuti/glyphic)** — an alternative Claude Code manager
  whose i18n approach and card UI informed early design exploration (AGPL-3.0, kept on its own branch only).

---

## Scope

Only **skill** and **plugin** are toggle-able, because these are the only kinds that support
**in-session reload** (`/reload-skills`, `/reload-plugins`) — so a toggle is **live**, no new session needed.

| kind | real (source of truth) | toggle key | reload |
|---|---|---|---|
| **skill** | `~/.claude/skills/<name>/` (global) or `{project}/.claude/skills/<name>/` | `skillOverrides` in `settings.json` (on/off/name-only/user-only) | `/reload-skills` |
| **plugin** | `~/.claude/plugins/installed_plugins.json` | `enabledPlugins` in `settings.json` (`name@marketplace`: bool) | `/reload-plugins` |

Other kinds (agent / command / rule / hook / mcp) have **no native on/off**, so they are out of toggle scope.

Beyond toggling, ccc-ui also:
- **promotes** a project skill to global (moves `{project}/.claude/skills/<name>/` → `~/.claude/skills/<name>/`),
- **deletes** a skill from disk (user or project scope),
- **lists / deletes** Claude Code session-history folders under `~/.claude/projects/`.

## Philosophy

**Config-as-SSOT.** This app holds no parallel copy of any tool. It only reads/scans CC-native config
(`skillOverrides`, `enabledPlugins`) and writes it back with key-preserving merges (other keys untouched).
Every write is preceded by a `.bak` backup of the file it overwrites.

## Status

- **Phase 0** — scaffold. done. (Now Node + Hono + Vue 3 + Element Plus; the earlier
  Tauri 2 + Rust + SvelteKit + Tailwind scaffold was retired — see *Project evolution*.)
- **Phase 1** — skill + plugin toggle (scan → overview → native key → in-session reload). **in progress.**
  The `Skills` view is live; projects/plugins/agents/commands/hooks/instructions/rules/mcps/settings are
  placeholder routes (`PlaceholderView`) awaiting implementation.

## Dev

Prerequisites: Node 18+ (developed on Node 22+). It's a plain npm workspace — no native toolchain.

```bash
npm install            # installs both server and web workspaces
npm run dev            # concurrently starts backend (:8787) + frontend (:5173)
```

Then open **http://localhost:5173**. Vite proxies `/api` → `:8787`, so the frontend talks to the
Hono API in dev. (In production, `npm run build` emits `web/dist/` and the server serves it at `/`.)

Other scripts:

```bash
npm run dev:server     # backend only (tsx watch)
npm run dev:web        # frontend only (vite)
npm run build          # type-check (vue-tsc) + vite build → web/dist
npm run typecheck      # tsc (server) + vue-tsc (web), no emit
npm start              # run server (serves API + built frontend) on $PORT or 8787
```

> WSL2: `vite.config.ts` binds `host: true` (0.0.0.0) so a Windows browser can reach the dev server
> over the WSL port forward. No GPU drivers needed (this is a web app, not Tauri/WSLg).

## Architecture

```
server/src/                      Hono API (tsx, runs on :8787)
  index.ts                       entry: mounts /api/* and (in prod) serves web/dist
  paths.ts                       path helpers — all rooted at ~/.claude/
  model.ts                       data model + resolveEffective (two-level status resolution)
  settings.ts                    SSOT-safe JSON read/write (key-preserving merge + .bak backup)
  scan.ts                        overview aggregator — runs every adapter
  decode.ts                      decode Claude-encoded project folder names (greedy fs walk)
  adapters/
    types.ts                     ToolAdapter interface + registry (core extension point)
    skill.ts                     SkillAdapter   (toggle key: skillOverrides)
    plugin.ts                    PluginAdapter  (toggle key: enabledPlugins)
  routes/
    tools.ts                     overview / detail / set-status / view-content
    projects.ts                  list / delete session-history folders
    skills.ts                    promote / delete skills
web/src/                         Vue 3 SPA (Vite dev on :5173, proxies /api → :8787)
  api/index.ts                   fetch client — mirrors the server route table 1:1
  views/SkillsView.vue           the one live view (others are PlaceholderView)
  components/                    AppHeader / AppSidebar / SkillCard
  i18n/                          vue-i18n (zh / en)
  router/                        /skills is real; rest are placeholders
```

**Core idea:** add a toggle-able kind = add one `ToolAdapter` (`scan` / `setStatus` / `view`).
Routes and the frontend card stay unchanged. The two-level status model walks
`[user, ...project?]` from most-specific outward; first non-`inherited` status wins, defaulting to
`enabled`.
