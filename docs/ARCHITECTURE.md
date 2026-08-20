# Architecture

Deep-dive for contributors. For a product overview, see the [README](../README.md).

## Design invariants

1. **Config-as-SSOT.** The app never keeps a parallel copy of tool data. It reads the tools' native config and writes back with key-preserving merges (other top-level keys pass through untouched). Every write: whitelist check → `.bak` backup → atomic write.
2. **Tool-specific string literals live in exactly one file — `server/src/profiles.ts`.** Everything else (engine, adapters, path helpers) is tool-agnostic. Adding a tool never touches the engine.

## The ResourceLocator model

Each tool's differences are declared as one `ToolProfile`: where skills live, which settings key toggles plugins, how values are encoded, what the plugin manifest looks like, where MCP servers are configured.

```
profiles.ts         ToolProfile — the single source of truth for tool layout
                      skills:       { dirName, marker, overridesKeyPath, overridesEncoding }
                      plugins:      { dirRelative, manifestFile, manifestIsArray, manifestIdField,
                                       enabledKeyPath, enabledEncoding, supportedComponents }
                      projects:     ProjectsLocator — fs (dash-encoded dirs) or sqlite (session DB)
                      instructions: { fileName }  — CLAUDE.md / AGENTS.md
                      rules?:       { dirName }   — optional (capability gap → undefined)
                      mcps:         { userFile, userKeyPath, projectFile, projectDir, projectKeyPath }
                    ↓ consumed by
locator.ts          tool-agnostic engine:
                      readRegistry(profile)                    parse manifest (array or map) → normalized Map
                      readFlag(enc, json, keyPath, name)       walk nested key path → Status
                      writeFlag(enc, json, keyPath, name, st)  traverse + auto-create levels + write
                    ↓ used by
adapters/           SkillAdapter / PluginAdapter — scan / setStatus / view / detail
paths.ts            path helpers — all derived from profile fields, no hardcoded segments
mutations/jsonKey.ts  leaf primitive: read/write settings[key][name] (boolean or string encoding)
```

### Adding a tool (e.g. Codex) — the whole recipe

Add one entry to `PROFILES` in `profiles.ts`, plus the tool id in `ToolId` and in the frontend `TOOL_OPTIONS`:

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
    userFile: ['.codex', 'config.toml'],   // note: TOML needs a dedicated reader (not JSON)
    userKeyPath: ['mcp_servers'],
    projectFile: 'config.toml', projectDir: '.codex', projectKeyPath: ['mcp_servers'],
  },
}
```

Skill/plugin toggles, projects and instructions then work with no further changes. MCP needs a TOML reader.

## Remote hosts — remote exec, not per-file SFTP

Every reader goes through a swappable `FsBackend` (`getFs()`), bound per-request to a host context via `AsyncLocalStorage` (`X-Host` header → host middleware). Local requests bind `LocalFs` (node:fs, zero overhead). The SFTP-based `SshFs` exists as a fallback, but on slow links per-file round-trips compound disastrously (a full overview ≈ hundreds of serial SFTP calls ≈ 29 s over VPN).

So remote requests instead **run the work on the remote itself**:

```
route (isRemote) ──▶ remote/runner.ts (local side)
                       esbuild bundles remote/entry.ts into memory (once per process)
                       uploads to <home>/.ccc-ui/ccc-remote.<hash>.mjs via SFTP
                       (hash-named; unchanged bundles skip upload; stale files cleaned up)
                    ──▶ ssh exec: node ccc-remote.<hash>.mjs <command> "<base64 args>"
                       entry.ts runs in the remote's own node:
                         homedir / platform-native path / node:fs → native-speed I/O
                       emits one JSON block: { status, body }
                    ──▶ sendRemote maps it to c.json(body, status)
```

Consequences:

- **O(1) execs per request** instead of O(file ops × RTT) — overview: 28.6 s → ~0.5 s warm; markdown save ~0.8 s.
- Route status codes (404/409/413/…) pass through unchanged.
- Windows remotes just work: recursive mkdir/copy/remove are native `node:fs` (no cmd-vs-POSIX gaps), paths are platform-native (no SFTP `/C:/` virtual-path quirks), and ZCode's SQLite project source is readable (the DB opens on the remote).
- Args travel base64-encoded in argv (cmd-safe, no quoting issues). Large args (e.g. saved file content) exceed cmd's ~8k line limit and go via a temp JSON file uploaded over SFTP, referenced as `"@<path>"` and deleted after exec. cmd.exe doesn't forward stdin EOF — hence argv/file, not stdin.
- Per-host requirement: SSH access + Node installed. Nothing resident is left behind.
- Live MCP tool probing (`mcps.tools`) also runs remotely — semantically correct: it probes exactly what the remote tool would connect to.
- "Open in file manager" is local-only (a remote-desktop action is out of scope); those routes decline cleanly with `reason: 'remote'`.

## Two-level status resolution

Each tool instance carries a `perScope` list `[user, ...project?]`. `resolveEffective()` walks from the most specific scope (project — end of list) outward to user; the first non-`inherited` status wins. If all are `inherited` (or the list is empty), the default is `enabled`. The UI shows both per-scope detail and the computed effective state.

## File map

```
server/src/                      Hono API (tsx, :8787)
  index.ts                       entry: mounts /api/* routes, serves web/dist in production
  profiles.ts                    ★ ToolProfile declarations (the only place tool differences live)
  locator.ts                     ★ tool-agnostic read/write engine (readRegistry / readFlag / writeFlag)
  paths.ts                       path helpers, derived from profile fields
  model.ts                       data models + resolveEffective
  settings.ts                    SSOT-safe JSON read/write (key-preserving merge + .bak)
  scan.ts                        overview aggregator — runs all adapters for a profile
  decode.ts                      decodes dash-encoded project dir names (Windows drives + underscores)
  *-reader.ts                    projects / instructions / mcp / rules / commands / agents / hooks discovery
  markdown-resource.ts           shared scan/parse primitives (frontmatter, line counts, dedupe)
  mcp-tools.ts                   live MCP tool probing (stdio/http/sse JSON-RPC → tools/list)
  explorer.ts                    explorer.exe launch (local-only; declines cleanly when remote)
  fs-backend/                    ★ swappable filesystem behind every reader
    local.ts                     LocalFs — node:fs/promises
  hosts/                         remote-host machinery
    context.ts / middleware.ts   host context + AsyncLocalStorage binding (X-Host header)
    pool.ts                      ssh2 connection pool (reuse / keepalive / dedupe)
    registry.ts / secrets.ts     ~/.ccc-ui/hosts.json CRUD; AES-256-GCM machine-bound secrets
    ssh.ts                       SshFs — SFTP-backed FsBackend (fallback path)
  remote/                        ★ remote-exec runtime
    entry.ts                     runs on the remote: command registry mirroring route validation,
                                  whitelist and status codes; emits { status, body }
    runner.ts                    local side: esbuild bundle, hash-cached upload, base64-argv,
                                  temp-file pass-through, sendRemote
  adapters/                      ToolAdapter interface + skill / plugin adapters
  mutations/jsonKey.ts           leaf primitive: settings[key][name] by encoding
  routes/                        one file per resource + hosts + settings (remote-split logic)
web/src/                         Vue 3 SPA (Vite dev on :5173, /api proxied to :8787)
  stores/tool.ts                 ★ global tool selector (Claude ⇄ ZCode), shared by header + views
  stores/host.ts                 ★ global host selector ('local' ⇄ remote) — injects X-Host, reloads
  api/index.ts                   fetch client — optional `tool` per method; injects X-Host
  views/                         Skills / Plugins / Projects / Instructions / MCPs / Rules /
                                  Commands / Agents / Hooks / Settings / Hosts
  components/                    AppHeader (tool + host switchers) / AppSidebar / cards /
                                  FileExplorer / MarkdownView
  i18n/                          vue-i18n (zh / en)
```
