# ccc-ui

一个管理 AI 编码代理配置的 Web UI —— 跨作用域(user / project)、跨工具(Claude Code、ZCode、…),并且**跨机器**(通过 SSH 操控另一台主机)。开关 **skills** 与 **plugins**;浏览 **projects**(会话历史)、**instructions**(CLAUDE.md / AGENTS.md)、**rules**、**commands**、**agents**、**hooks** —— 支持就地 markdown 编辑;查看 **MCP** 服务器与 **settings** 总览 —— 全部集中一处。

**Skills 与 plugins 可开关(实时生效,无需重启)。Markdown 资源(instructions / rules / commands / agents)可查看 + 编辑。其余均为只读浏览。**
事实源(source of truth)始终是各工具自身的原生配置;本应用只是架在其上的读取/投影/回写层,绝不另建平行数据库。

后端 Node + Hono,前端 Vue 3 + Element Plus。

---

## 为什么做多工具

不同的 AI 编码工具(Claude Code、ZCode、…)把配置存在不同目录下,settings 文件布局不同、plugin manifest 格式不同、开关所在的 key 嵌套也不同。ccc-ui 把这些差异全部抽象为每个工具一份**声明式 profile**,于是:

- **新增一个工具 = 新增一个 profile 对象。** 引擎/adapter 零改动。
- 读写引擎、adapters、路径助手全部**与工具无关** —— 不含任何工具专属的字符串字面量。

实现方式见下文 *架构 → ResourceLocator*。

## 功能范围

**Skill** 与 **plugin** 可开关(实时生效,无需重启)—— 它们在工具的 settings 里有原生的按名开关。Markdown 资源为**查看 + 编辑**(回写时带 `.bak` 备份)。其余资源为**只读浏览**。

| 类型 | 模式 | 事实源 | 备注 |
|---|---|---|---|
| **skill** | 开关 | `skillOverrides`(on/off/name-only/user-only) | 另支持:项目级提升为全局、删除 |
| **plugin** | 开关 | `enabledPlugins`(`name@marketplace`: bool) | 另支持:内嵌文件浏览器(浏览 plugin 目录 + 预览文件内容) |
| **project** | 只读 | 会话历史文件夹(Claude)/ SQLite DB(ZCode) | 列表 + 删除会话历史 |
| **instruction** | 查看 + 编辑 | `CLAUDE.md` / `AGENTS.md`(全局 + 各项目) | 分栏 markdown 查看/编辑器 + 在文件管理器中打开 |
| **mcp** | 只读 | `mcpServers`(Claude)/ `mcp.servers`(ZCode) | 服务器列表 + 配置详情(command/args/env/url/headers)+ 实时工具探测 |
| **rule** | 查看 + 编辑 | `~/.{tool}/rules/*.md` + `<proj>/.{tool}/rules/*.md` | 分栏查看/编辑器;仅 Claude(ZCode 无 rules 机制 → 空态) |
| **command** | 查看 + 编辑 | `~/.{tool}/commands/*.md` + `<proj>/.{tool}/commands/*.md` | 分栏查看/编辑器;自定义斜杠命令 |
| **agent** | 查看 + 编辑 | `~/.{tool}/agents/*.md` + `<proj>/.{tool}/agents/*.md` | 分栏查看/编辑器;独立子代理 |
| **hook** | 只读 | settings 里的嵌套 JSON(`hooks` / `hooks.events`) | 列表 + 详情(event / matcher / command / timeout);合并 Claude `settings.local.json` |
| **settings** | 只读 | settings JSON | 开关 / 环境变量 / 权限 / 插件市场总览 |

在此之上,**远程 SSH 主机**是一等公民:顶栏的主机切换器可以把每个页面整体重定向到另一台机器的配置(见 *架构 → 远程主机*)。

MCP 的编辑/开关暂缓 —— 三个工具的开关机制差异过大(ZCode 用 `enabled`,Claude 用项目级禁用数组,Codex 没有),强行统一开关只会造出工具根本不认的"假开关"。只读聚合才是诚实的 MVP。

## 设计哲学

**配置即唯一事实源(Config-as-SSOT)。** 本应用不保存任何工具数据的平行副本。它只读取各工具的原生配置(`skillOverrides`、`enabledPlugins`),并以保 key 合并的方式回写(其它顶层 key 原样保留)。每次写入前都会先对被覆盖文件做 `.bak` 备份。

## 当前状态

- **阶段 0** —— 脚手架(Node + Hono + Vue 3 + Element Plus)。已完成。
- **阶段 1** —— skill + plugin 开关,profile 感知。Claude Code + ZCode **已完成**。
  - `Skills` 页:实时(开关 / 提升 / 删除,顶栏工具切换器)。
  - `Plugins` 页:实时(开关 + 内嵌**文件浏览器** —— 浏览 plugin 目录、预览文件内容、在文件管理器中打开)。
  - 工具切换(Claude Code ⇄ ZCode)是全局的,在顶栏。
- **阶段 2** —— 只读浏览页。Claude Code + ZCode **已完成**。
  - `Projects` 页:卡片网格(会话数 / 最近活动)+ 删除会话历史。通过统一的 `ProjectsLocator`
    同时支持文件系统目录(Claude)与 SQLite DB(ZCode)。
  - `Instructions` 页:分栏 markdown 查看器(左侧全局 CLAUDE.md/AGENTS.md,右侧项目卡片,
    分栏可拖动)+ 在文件管理器中打开。
  - `MCP` 页:卡片网格 + 内嵌详情(transport / command / args / env / url / headers)。
    仅 Claude + ZCode(Codex TOML 暂缓)。
- **阶段 3** —— markdown 资源浏览 + 配置总览。Claude Code + ZCode **已完成**。
  - `Rules` / `Commands` / `Agents` 页:分栏 markdown 查看器(左全局、右项目卡片)
    + 在文件管理器中打开。Rules 仅 Claude(ZCode 无 rules 机制 → 空态)。
  - `Hooks` 页:列表 + 详情(event / matcher / command / timeout / 来源文件);合并 Claude
    `settings.local.json`,反映 ZCode `hooks.enabled` 总开关。
  - `Settings` 页:开关 / 环境变量 / 权限 / 插件市场的只读总览。
  - Markdown 编辑(instructions / rules / commands / agents):查看/编辑双模式,
    安全回写(白名单校验 + `.bak` 备份 + 原子写入)。
- **阶段 4** —— 远程 SSH 主机管理。**已完成**。
  - `Hosts` 页:主机的增 / 改 / 删、测试连接、断开(AES-256-GCM 机器绑定密文存储;
    ssh2 连接池,带 keepalive + 去重)。
  - 顶栏主机切换器:选中任意主机即透明地把所有页面重定向过去。
  - **架构 C 远程 exec** —— 在远程主机上,读和写都跑在**远程本机**
    (内置脚本 + 每请求一次 `node` exec),而非逐文件 SFTP。VPN 链路实测:
    完整 overview 28.6s → **约 0.5s**;markdown 保存约 0.8s。Windows 远程完全可用
    (那边是原生 `node:fs` —— 没有 POSIX-shell/`cmd` 差异,没有 SFTP 虚拟路径
    怪癖,ZCode SQLite 项目源也包含在内)。

---

## 开发

前置条件:Node 18+(在 Node 22+ 上开发)。纯 npm workspace,无原生工具链。

```bash
npm install            # 同时安装 server 与 web 两个 workspace
npm run dev            # 并发启动后端(:8787)+ 前端(:5173)
```

打开 **http://localhost:5173**。开发模式下 Vite 把 `/api` 代理到 `:8787`,前端由此对接 Hono API。
(生产模式下,`npm run build` 产出 `web/dist/`,由 server 在 `/` 提供服务。)

```bash
npm run dev:server     # 仅后端(tsx watch)
npm run dev:web        # 仅前端(vite)
npm run build          # 类型检查(vue-tsc)+ vite build → web/dist
npm run typecheck      # tsc(server)+ vue-tsc(web),不产出
npm start              # 运行 server(提供 API + 已构建前端),端口 $PORT 或 8787
```

---

## 架构

### ResourceLocator 模型(核心设计)

每个工具差异 —— skills 存在哪、plugin manifest 以什么为 key、settings JSON 里开关嵌在哪层、
值如何编码 —— 都集中声明在一处(`profiles.ts`),构成一份 **profile**。其余全部是与工具无关的引擎。

```
profiles.ts         ToolProfile —— 每工具布局的唯一事实源
                      skills:       { dirName, marker, overridesKeyPath, overridesEncoding }
                      plugins:      { dirRelative, manifestFile, manifestIsArray, manifestIdField,
                                       enabledKeyPath, enabledEncoding }
                      projects:     ProjectsLocator —— fs(短横线编码目录)或 sqlite(会话 DB)
                      instructions: { fileName }   —— CLAUDE.md / AGENTS.md
                      mcps:         { userFile, userKeyPath, projectFile, projectDir, projectKeyPath }
                    ↓ 被……读取
locator.ts          与工具无关的引擎:
                      readRegistry(profile)   —— 解析 manifest(数组或 map)→ 归一化 Map
                      readFlag(enc, json, keyPath, name)   —— 沿嵌套 key 路径求值 → Status
                      writeFlag(enc, json, keyPath, name, status) —— 遍历 + 自动建层 + 写入
                    ↓ 被……使用
adapters/           SkillAdapter / PluginAdapter —— scan / setStatus / view / detail
                      (不含任何工具专属字面量;一切来自 profile)
paths.ts            路径助手 —— 全部由 profile 的 locator 字段推导,无硬编码片段
mutations/jsonKey.ts  叶子级原语:settings[key][name] 的读写(boolean 或 string 编码)
projects-reader.ts  统一的项目发现(fs 目录或 sqlite 行)+ 删除
instructions-reader.ts  只读的 instruction 文件发现 + 内容读取
mcp-reader.ts       只读的 MCP 服务器发现(用户级 + 项目级)+ transport 推断
decode.ts           解码短横线编码的项目目录名(Windows 盘符 + 下划线重组)
```

**不变式:** 任何工具专属字符串字面量('skills'、'SKILL.md'、'enabledPlugins'、'id'、…)只允许
出现在 `profiles.ts` 里。新增工具永远不需要碰引擎、adapters 或 paths。

### 新增一个工具(例如 Codex)

在 `profiles.ts` 的 `PROFILES` 里加一个条目。改动仅此一处:

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
    userFile: ['.codex', 'config.toml'],       // 注意:TOML 需要专用 reader(非 JSON)
    userKeyPath: ['mcp_servers'],
    projectFile: 'config.toml', projectDir: '.codex', projectKeyPath: ['mcp_servers'],
  },
}
```

然后在 `profiles.ts` 的 `ToolId` 与前端 `stores/tool.ts` 的 `TOOL_OPTIONS` 里加上 `'codex'`。
Skill/plugin 开关、projects、instructions 无需其它改动即可工作。MCP 需要 TOML reader
(基于 JSON 的 `mcp-reader.ts` 解析不了 `.toml`)。

### 远程主机(架构 C —— 远程 exec,而非 SFTP 拉取)

每个 reader 都经过一个可替换的 `FsBackend`(`getFs()`),由 `AsyncLocalStorage` 的 host 上下文
按请求绑定(`X-Host` 头 → host 中间件)。本地请求绑定 `LocalFs`(node:fs),零开销;远程请求
过去绑定 `SshFs`(ssh2 SFTP)—— 能用,但慢链路上逐文件的往返会灾难性叠加(一次完整
overview = 数百次串行 SFTP 调用,VPN 上约 **29s**)。

因此远程请求现在走另一条路:**把工作放到远程本机执行。**

```
route (isRemote) ──▶ remote/runner.ts(本地侧)
                       esbuild 把 remote/entry.ts 打包进内存(每进程一次)
                       经 SFTP 上传到 <home>/.ccc-ui/ccc-remote.<hash>.mjs
                       (按 hash 命名;未变化的 bundle 跳过上传;过期文件自动清理)
                    ──▶ ssh exec: node ccc-remote.<hash>.mjs <command> "<base64 args>"
                       entry.ts 运行在远程自己的 node 里:
                         getHostCtx() → LOCAL_CONTEXT = 远程的 os.homedir()
                         + 平台原生 path + node:fs → 本机速度的读写
                       输出一个 JSON 块:{ status, body }
                    ──▶ sendRemote 把它映射为 c.json(body, status)
```

带来的结果:

- 每请求 **O(1) 次 exec**,而非 O(文件操作数 × RTT)—— overview 28.6s → 预热后约 0.5s。
- 各路由的状态码(404/409/413/…)原样跨跃传递。
- Windows 远程完全可用:递归 mkdir/copy/remove 在那边是原生 `node:fs`(没有 `cmd` 与
  POSIX 的差异),路径是平台原生的(没有 SFTP `/C:/` 虚拟路径怪癖),ZCode 的 SQLite
  项目源也能读(DB 在远程打开)。
- 参数以 base64 放在 argv 里传输(cmd 安全,无引号问题);大参数(例如保存的文件内容)
  超过 cmd 约 8k 的行上限,于是经 SFTP 上传为临时 JSON 文件,以 `"@<path>"` 传递
  (exec 后自动删除)。cmd.exe 不转发 stdin EOF —— 所以用 argv/文件而不是 stdin。
- 每台远程主机的要求:可 SSH + 装有 Node。仅此而已,不留常驻。
- MCP 实时探测(`mcps.tools`)也在远程跑 —— 语义正确:测的正是远程工具会连到的东西。
- `explorer.exe` 式的"在文件管理器中打开"仅限本地(远程桌面动作超出范围);这些路由
  会以 `reason: 'remote'` 干净地拒绝。

### 文件地图

```
server/src/                      Hono API(tsx,跑在 :8787)
  index.ts                       入口:挂载 12 个 /api/* 路由,生产模式服务 web/dist
  profiles.ts                    ★ ToolProfile 声明(工具差异唯一存在的地方)
  locator.ts                     ★ 与工具无关的读写引擎(readRegistry / readFlag / writeFlag)
  paths.ts                       路径助手 —— 全部由 profile 字段推导
  model.ts                       数据模型 + resolveEffective(两级状态解析)
  settings.ts                    SSOT 安全的 JSON 读写(保 key 合并 + .bak 备份)
  scan.ts                        overview 聚合器 —— 对一个 profile 跑全部 adapter
  decode.ts                      解码短横线编码的项目目录名(Windows 盘符 + 下划线)
  projects-reader.ts             统一项目发现(fs 目录或 sqlite)+ 删除
  instructions-reader.ts         只读 instruction 文件发现 + 内容读取
  mcp-reader.ts                  只读 MCP 服务器发现(用户级 + 项目级)+ transport 推断
  rules-reader.ts                只读 rule 发现(仅 Claude —— ZCode 无 rules 机制)
  commands-reader.ts             只读斜杠命令发现(*.md)
  agents-reader.ts               只读子代理发现(*.md)
  hooks-reader.ts                只读 hook 发现(来自嵌套 settings JSON)
  markdown-resource.ts           共享的扫描/解析原语(frontmatter、行数、去重)
  mcp-tools.ts                   MCP 实时工具探测(stdio/http/sse JSON-RPC 握手 → tools/list)
  explorer.ts                    共享 explorer.exe 拉起(仅本地;远程时干净拒绝)
  fs-backend/                    ★ 所有 reader 身后的可替换文件系统
    types.ts                     FsBackend 契约(exists/read/write/stat/readDir/mkdir/remove/copy/…)
    local.ts                     LocalFs —— node:fs/promises
  hosts/                         远程主机机制
    context.ts                   HostContext + AsyncLocalStorage 绑定(getFs()/getHostCtx())
    middleware.ts                X-Host 头 → 解析会话 → 绑定远程上下文(失败给 502)
    pool.ts                      ssh2 连接池(复用/keepalive/去重 + 永久 error 汇)
    registry.ts                  ~/.ccc-ui/hosts.json CRUD(纯本地记账)
    secrets.ts                   AES-256-GCM 机器绑定密文
    ssh.ts                       SshFs —— SFTP 实现的 FsBackend(兜底路径)
  remote/                        ★ 架构 C —— 远程 exec 运行时
    entry.ts                     运行在远程:命令注册表(22 个命令,镜像各路由的
                                  校验/白名单/状态码),输出 {status,body}
    runner.ts                    本地侧:esbuild 打包进内存、按 hash 缓存上传、
                                  cmd 安全的 base64-argv 传参(大参数走临时文件)、sendRemote
  adapters/
    types.ts                     ToolAdapter 接口 + registry(profile)(扩展点)
    skill.ts                     SkillAdapter  (委托 locator 引擎)
    plugin.ts                    PluginAdapter(委托 locator 引擎 + manifest 解析)
  mutations/
    jsonKey.ts                   叶子原语:按编码读写 settings[key][name]
  routes/
    tools.ts                     overview / detail / set-status / view-content(?tool= 参数;远程拆分)
    plugins.ts                   plugin 详情 + 文件浏览(防路径穿越;远程拆分)
    projects.ts                  列表 / 删除会话历史(远程拆分)
    skills.ts                    提升 / 删除 skill + 文件浏览(远程拆分)
    instructions.ts rules.ts commands.ts agents.ts   列表 / 内容 / 保存 / 打开(远程拆分)
    hooks.ts                     列表 / 打开(远程拆分)
    mcps.ts                      列表 / 详情 / 实时探测 / 打开(远程拆分;探测在远程跑)
    settings.ts                  settings 总览 —— 远程抓取 + 本地过滤与密文掩码
    hosts.ts                     host 增删改查 / 测试连接 / 断开 / 连接池状态(恒为本地)
web/src/                         Vue 3 SPA(Vite 开发于 :5173,/api 代理 → :8787)
  stores/tool.ts                 ★ 全局工具选择器(Claude ⇄ ZCode),顶栏与各页共享
  stores/host.ts                 ★ 全局主机选择器('local' ⇄ 远程)—— 注入 X-Host 并重载
  api/index.ts                   fetch 客户端 —— 每个方法接受可选 `tool`;注入 X-Host
  views/SkillsView.vue           skills 页(开关 / 提升 / 删除)
  views/PluginsView.vue          plugins 页(开关 + 内嵌文件浏览器,含内容预览)
  views/ProjectsView.vue         projects 页(卡片网格 + 删除会话历史)
  views/InstructionsView.vue     instructions 页(分栏查看器 + 编辑器)
  views/MCPsView.vue             MCP 页(卡片网格 + 内嵌详情 + 工具列表)
  views/RulesView.vue            rules 页(分栏查看器 + 编辑器;仅 Claude)
  views/CommandsView.vue         commands 页(分栏查看器 + 编辑器)
  views/AgentsView.vue           agents 页(分栏查看器 + 编辑器)
  views/HooksView.vue            hooks 页(列表 + 详情:event / matcher / command / timeout)
  views/SettingsView.vue         settings 页(只读:开关 / 环境变量 / 权限总览)
  views/HostsView.vue            hosts 页(增/改/删/测试/断开)
  components/                    AppHeader(工具 + 主机切换器)/ AppSidebar / SkillCard / PluginCard / FileExplorer / MarkdownView
  i18n/                          vue-i18n(zh / en)
  router/                        /plugins /skills /projects /instructions /rules /commands /agents /hooks /mcps /settings /hosts —— 全部可用
```

### 两级状态解析

每个工具实例带一个 `perScope` 列表:`[user, ...project?]`。`resolveEffective()` 从最具体的
作用域(project —— 列表末尾)向外走到 user;第一个非 `inherited` 的状态胜出。若全部为
`inherited`(或列表为空),默认为 `enabled`。UI 同时展示各作用域的明细与计算出的生效状态。

---

## 项目演进与分支地图

本仓库是 **`ccc-ui` 主线**。它同时保留了早期探索设计空间的尝试,各自作为 **orphan 分支**
(孤立历史,从不合入 `main`)。

| 分支 | 内容 | 许可证 | 是否合并? |
|---|---|---|---|
| **`main`** | 主线 —— profile 感知的多工具架构 | MIT | ——(主干) |
| `attempts/claude-code-config-ui` | 早期主线快照(pre-profile) | MIT | ✅ 可 fast-forward |
| `attempts/glyphic` | 尝试 #1 —— fork 自 [caioricciuti/glyphic](https://github.com/caioricciuti/glyphic) + i18n / 卡片 UI | AGPL-3.0 | ❌ orphan,仅作参考 |
| `attempts/claude-code-tool-manager` | 尝试 #2 —— fork 自 [tylergraydev/claude-code-tool-manager](https://github.com/tylergraydev/claude-code-tool-manager) + 架构提案 | MIT | ❌ orphan,仅作参考 |

**按分支许可:** orphan 分支不合入,`main` 保持纯 MIT(其上不存在 AGPL 的 glyphic 代码)。

## 致谢

- **[tylergraydev/claude-code-tool-manager](https://github.com/tylergraydev/claude-code-tool-manager)** ——
  早期探索过的 Tauri 2 + SvelteKit + Rust 基础与 UI 模式(MIT)。
- **[caioricciuti/glyphic](https://github.com/caioricciuti/glyphic)** ——
  影响早期设计探索的 i18n 思路与卡片 UI(AGPL-3.0,仅保留在其独立分支)。
