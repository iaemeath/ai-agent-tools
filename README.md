# Claude Tool Manager

Toggle Claude Code **tools** on/off across scopes (global / project / local), see status at a glance.
**Only toggles — no content editing.** Source of truth is Claude Code own config.

> Design baseline: `../claude-code-config-ui/docs/REWRITE_PROPOSAL_zh.md`.

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
