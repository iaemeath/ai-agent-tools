# Claude Tool Manager

Toggle Claude Code **tools** on/off across scopes (global / project / local), see status at a glance.
**Only toggles — no content editing.** Source of truth is Claude Code own config.

> Design baseline: see `docs/REWRITE_PROPOSAL_zh.md` on the `attempts/claude-code-tool-manager` branch.

---

## Project evolution & branch map

This repository consolidates the full history of this project — the production rewrite **and** the earlier
attempts that explored the design space. Each attempt is preserved as an **orphan branch** (isolated history,
never merged into `main`) so the evolution is readable in one place.

| branch | what it holds | license | merged into `main`? |
|---|---|---|---|
| **`main`** | production rewrite (this code) | MIT | — (trunk) |
| `attempts/rewrite` | the rewrite, before it was merged into `main` | MIT | ✅ yes |
| `attempts/glyphic` | attempt #1 — fork of [caioricciuti/glyphic](https://github.com/caioricciuti/glyphic) (v0.20.0) + i18n / page-trim work | AGPL-3.0 | ❌ orphan, reference only |
| `attempts/claude-code-tool-manager` | attempt #2 — fork of [tylergraydev/claude-code-tool-manager](https://github.com/tylergraydev/claude-code-tool-manager) (v3.10.0) + trim work + the Chinese rewrite proposal | MIT | ❌ orphan, reference only |

**Why orphan branches?** The two attempts have no common ancestor with `main` (or with each other), so they
cannot be cleanly merged — and they carry different licenses (AGPL-3.0 vs MIT). They are kept as readable
snapshots of "what was tried", not as code that ships. Only `attempts/rewrite` shares `main`'s root commit,
so it is the one that fast-forward-merges cleanly.

**Per-branch licensing:** each branch is an independent work; licenses do not cross-contaminate as long as the
orphan branches are not merged. `main` stays MIT-clean because no AGPL glyphic code lives on it.

## Acknowledgements

This project stands on the shoulders of two open-source projects, explored on the attempt branches above:

- **[tylergraydev/claude-code-tool-manager](https://github.com/tylergraydev/claude-code-tool-manager)** — the
  Tauri 2 + SvelteKit + Rust + SQLite foundation and UI patterns that this rewrite builds on (MIT).
- **[caioricciuti/glyphic](https://github.com/caioricciuti/glyphic)** — an alternative Claude Code manager
  whose i18n approach and card UI informed early design exploration (AGPL-3.0, kept on its own branch only).

---

## Scope

Only **skill** and **plugin** are toggle-able, because these are the only kinds that support
**in-session reload** (`/reload-skills`, `/reload-plugins`) — so a toggle is **live**, no new session needed.

| kind | real (source of truth) | toggle key | reload |
|---|---|---|---|
| **skill** | `~/.claude/skills/<name>/` | `skillOverrides` (on/off/name-only/user-only) | `/reload-skills` |
| **plugin** | `~/.claude/plugins/installed_plugins.json` | `enabledPlugins` (`name@marketplace`: bool) | `/reload-plugins` |

Other kinds (agent / command / rule / hook / mcp) have **no native on/off**, so they are out of toggle scope.

## Philosophy

**Config-as-SSOT.** This app holds no parallel copy of any tool. It only reads/scans CC-native config
(`skillOverrides`, `enabledPlugins`) and writes it back with key-preserving merges (other keys untouched).

## Status

- **Phase 0** — scaffold (Tauri 2 + Rust + SvelteKit + Tailwind). done.
- **Phase 1** — skill + plugin single-axis toggle (scan -> overview -> native key -> in-session reload).

## Dev

```bash
npm install
npm run tauri dev      # or: npm run dev (frontend) / cd src-tauri && cargo test
```

> WSLg note: if the window is blank, install GPU drivers: `sudo apt install mesa-vulkan-drivers libgl1-mesa-dri`.

## Architecture

```
src-tauri/src/
  core/        model, paths, settings_io (3-scope, preserve-key), backup
  adapters/    ToolAdapter trait + registry; skill.rs, plugin.rs
  scan.rs      aggregate adapters -> ToolOverview
  commands.rs  slim Tauri commands (get_overview / set_tool_status / view_tool_content ...)
src/lib/       types, api, stores, components
```

Add a toggle-able kind = add one `ToolAdapter`. Frontend commands and cards stay unchanged.
