# Claude Code Tool Manager — 重写撰写方案

> 配套基线: `C:/Users/iaemeath/Desktop/tool-manager-goals.md`(下称《目标文档》)。
> 本文档回答"为什么重写、重写成什么、怎么落地",作为实施前的工程蓝图。
> 确认后即可进入脚手架与 Phase 1。

---

## 〇、一句话结论

**重写,不是改造。** 现有 `claude-code-config-ui` 的核心数据模型("SQLite 当 SSOT + 把 tool 内容部署到 CC 文件")与《目标文档》要求的模型("CC 原生配置即 SSOT + 原生开关")在哲学上相反。改造等于在删掉 80% 代码的同时重写内核,不如从一张干净的架构图开始,只复用确实可用的零件。

---

## 一、现状剖析:现有 ccc-ui 到底是什么

技术栈(优秀,可保留):**Tauri 2 + Rust + SvelteKit + TypeScript + Tailwind + SQLite**。

但它目前是一个"**配置内容创作 + 多编辑器同步 + 一堆周边**"的工具,与《目标文档》"只做 移动/开关/查看、只聚焦 Claude Code"的边界严重错位。

### 1.1 它的数据模型(SSOT = DB)

- 工具(Mcp/Skill/Command/…)以**行**存在 `mcp_library.db`。
- 用 `global_xxx` / `project_xxx` 联结表 + `is_enabled` 表达"全局/项目启用"。
- 再由 writer **把 DB 里的内容写回** CC 文件(`.claude/skills/<name>/SKILL.md` 等)。
- **结果**:CC 文件是 DB 的"投影/副本",改 CC 文件不会回流;同一 skill 被写到多个项目路径 = 正是《目标文档》点名的 **divergent 副本**反模式。

### 1.2 它的边界(远超目标)

现有功能里,以下与《目标文档》**五、非目标**冲突或无关:

- 多编辑器同步(Claude Code / OpenCode / Codex / Cursor / Gemini / Copilot)——目标只要 Claude Code。
- 内容创作/编辑(SkillForm/CommandForm/HookForm 全套 CRUD)——目标明确不做。
- MCP 测试/执行网关 + 自带 MCP Server(`mcp_server/`、`mcp_gateway/`)。
- 会话浏览器、用量分析、Insights、状态栏构建器、Spinner 动词、Profiles、Memory 管理、Agent Memory、Keybindings。

> 结论:它"大而全"地做了《目标文档》"明确不做"的事,而目标要的"作用域可视化 + 原生开关闭环"反而**没有按 CC 原生模型实现**。

---

## 二、为什么是"重写"而非"改造"(决策论证)

| 维度 | 改造现有项目 | 重写 |
|---|---|---|
| SSOT 来源 | 要把"DB 投影到文件"改成"文件即 SSOT",触及**所有** writer/store/schema | 干净地以 Config-as-SSOT 起步 |
| skill 机制 | 现在是"写多份 SKILL.md";目标是"全局真身 + skillOverrides"——**模型相反** | 直接实现单轴模型 |
| 特性体积 | 需删除 ~80% 代码(MCP 网关/会话/分析/多编辑器/内容编辑…) | 只写需要的 |
| 认知负担 | 在被删代码的残骸上工作,bug 频发、边界模糊 | 一份清晰的架构图 |
| 复用 | 仍可复用(i18n、backup、3-scope settings、UI 组件、设计系统) | 同样可复用,**且更干净** |

> 注意:《目标文档》六.1 写着"载体 = 演进 claude-code-config-ui"。**本方案修正这一条**:演进的是**可复用的零件与设计资产**,但**应用本体重写**。理由如上——内核模型相反,演进内核 = 重写内核,不如显式重写并显式复用。

---

## 三、核心设计哲学:Config-as-SSOT

**唯一真相源是 Claude Code 自己的配置文件,本工具不持有任何 tool 的平行副本。**

| 角色 | 落点 |
|---|---|
| 读 | 扫描 CC 各配置位置,聚合出"当前有哪些 tool、各 scope 什么状态" |
| 写 | 直接改 CC 配置(原生 key / 目录),**新会话即可见** |
| 本工具自留状态 | 仅 app 级偏好(如"上次选中的项目"),**不存 tool 内容** |

> 这一条直接消除 divergent 副本:全局只一份真身,要变就变那一处。

---

## 四、技术栈选型

**保留 Tauri 2 + Rust + SvelteKit + TS + Tailwind。** 栈不是问题,数据模型才是。

- Rust:安全、快速的本地 FS + JSON 操作;Tauri 命令天然是 Rust。
- SvelteKit:已有设计系统、i18n、卡片 UI;契合"Native、绝不 Electron 臃肿"的品牌(CLAUDE.md)。
- 砍掉:SQLite 作为 tool SSOT 的整层(`db/` 仅保留 app 偏好时再决定是否还需要)。

---

## 五、三类工具的存储与控制模型

按"CC 有没有给原生开关"分三类(对齐《目标文档》六.2):

### A. 原生开关型(skill / plugin / lsp)——单轴

- 真身**全局唯一**存放(skill: `~/.claude/skills/<name>/`;plugin/lsp: 全局安装)。
- 开关 = 原生 per-scope key:
  - skill → `skillOverrides`(值 `on` / `off` / `name-only` / `user-only`)。
  - plugin/lsp → `enabledPlugins`(叠加覆盖,local `false` 可反选)。
- "仅 N 个项目可用" = **全局 `off` + 目标项目 `on`**(已验证 project 覆盖 user ✅)。
- 不用软链、不用 DB。

### B. 作用域定义型(hook / mcp)——无全局开关

- 全局定义即全开,**无法 per-project 关**(实测 `disabledMcpjsonServers` 对 root `mcpServers` 无效)。
- 控 scope = **控制定义写在哪个 scope**(user/project/local 的 `settings.json` 之 `hooks`、或 `.claude.json` 之 `mcpServers`)。
- 工具操作 = "把这个定义从 scope X 挪到 scope Y"。

### C. 文件部署型(agent / command / rule)——SSOT 软链

- CC 无原生开关,只能"放/撤文件"。
- 真身放**规范库** `~/.claude/library/<kind>/<name>`,目标 scope 用**软链**指过去(移植 glyphic `library.rs`)。
- 改真身 → 所有链接处自动同步 = SSOT。
- 注意:Windows 上软链受限,需降级为**硬拷贝 + 真身指纹校验**(见 §12 风险)。

---

## 六、统一抽象(让"一眼总览"成立)

不同类 tool 机制不同,但前端要统一卡片。用 **聚合视图模型 + Adapter Trait** 解耦。

### 6.1 视图模型

```rust
enum ToolKind { Skill, Agent, Command, Rule, Hook, Mcp, Plugin, Lsp }
enum Scope    { User, Project(String), Local }            // Local = 项目本地、不入版本库
enum Status   { Enabled, Disabled, NameOnly, UserOnly, Inherited }
enum Origin   { NativeGlobal, LibraryCanonical, ScopeInline }

struct ToolInstance {
    kind: ToolKind,
    name: String,
    description: Option<String>,
    origin: Origin,
    source_path: String,                 // 真身物理位置
    per_scope: Vec<(Scope, Status)>,     // 各层状态
    effective: Status,                   // 当前查看上下文的生效值
}

struct ToolOverview { items: Vec<ToolInstance> }   // 给"总览页"一次渲染
```

### 6.2 Adapter Trait(每类 tool 一个实现,可扩展)

```rust
pub trait ToolAdapter: Send + Sync {
    fn kind(&self) -> ToolKind;
    fn mechanism(&self) -> Mechanism;                  // NativeToggle | FileDeploy | ScopeInline
    fn scan(&self, ctx: &ScanCtx) -> Result<Vec<ToolInstance>>;
    fn status(&self, name: &str, scope: Scope, ctx: &ScopeCtx) -> Result<Status>;
    fn set_status(&self, name: &str, scope: Scope, s: Status, ctx: &ScopeCtx) -> Result<()>;
    // 仅 FileDeploy 类型实现:
    fn deploy(&self, name: &str, scope: Scope, ctx: &ScopeCtx) -> Result<()> { Err(…) }
    fn undeploy(&self, name: &str, scope: Scope, ctx: &ScopeCtx) -> Result<()> { Err(…) }
    // 只读查看:
    fn view(&self, name: &str) -> Result<ToolContent>;
}
```

> 加一个 tool 类型 = 加一个 Adapter,前端命令与卡片不变。这是整个重写的可扩展性支点。

---

## 七、分层架构与目录结构

```
src-tauri/src/
  core/
    model.rs        # ToolKind/Scope/Status/ToolInstance/Overview
    paths.rs        # CC 配置路径解析(复用旧 utils/paths.rs)
    backup.rs       # 写前备份(复用旧 utils/backup.rs)
    settings_io.rs  # 3-scope settings 读写、保键合并(复用旧 claude_settings.rs 思路)
  adapters/
    mod.rs          # ToolAdapter trait + 注册表
    skill.rs        # A 类:全局真身 + skillOverrides
    plugin.rs       # A 类:enabledPlugins(lsp 走同模型)
    hook.rs         # B 类:scope 内定义迁移
    mcp.rs          # B 类:scope 内定义迁移
    deploy/         # C 类共享:library 规范库 + 软链
      library.rs    # 移植自 glyphic
      agent.rs / command.rs / rule.rs
  scan.rs           # 聚合所有 adapter.scan() -> ToolOverview
  commands.rs       # 精简的 Tauri 命令(见 §8)
  prefs.rs          # 仅 app 级偏好(非 tool 内容)

src/lib/
  types/tool.ts           # 对齐 core::model
  stores/overview.svelte.ts
  components/overview/...  # 统一卡片 + scope 状态条
  components/detail/...    # 各类只读查看(Phase 5)
```

---

## 八、Tauri 命令(从 200+ 砍到 ~8 个)

通用、按抽象而非按实体:

```ts
get_overview(projectPath?)              // -> ToolOverview(所有 tool 聚合)
get_tool_detail(kind, name)             // -> 单个 tool 的 scope 矩阵 + 来源
set_tool_status(kind, name, scope, status, projectPath?)
deploy_tool(kind, name, scope, projectPath?)     // C 类专用
undeploy_tool(kind, name, scope, projectPath?)   // C 类专用
view_tool_content(kind, name)                    // 只读内容(Phase 5)
list_projects() / scan_projects()
```

---

## 九、复用 / 丢弃清单

**复用(显式移植):**
- `utils/backup.rs`、`utils/paths.rs`。
- `services/claude_settings.rs` 的 **3-scope(user/project/local)读取+保键合并** 逻辑(改写为 `core/settings_io.rs`)。
- 设计系统与品牌(CLAUDE.md)、i18n、Tailwind 主题、Lucide 图标。
- UI 零件:Sidebar、Card、Toggle、Badge、ScopeBar、ConfirmDialog、Toast。
- glyphic `library.rs` 的软链/规范库模型(给 C 类)。

**丢弃:** SQLite tool-SSOT 层、MCP gateway/server、会话/分析/Insights、状态栏/Spinner/Profiles、多编辑器同步、所有内容编辑表单。

---

## 十、MVP 切片(Phase 1:skill 单轴闭环)

用 skill 验证最核心的"全局真身 + 按项目开关"闭环:

1. **扫** `~/.claude/skills/*/SKILL.md` -> 全局 skill(默认 enabled)。
2. **读** user/project/local 的 `skillOverrides` -> 各层 status。
3. **总览页**渲染:每个 skill + 各 scope 的开关状态(复用 ScopeBar)。
4. **操作**:某 skill user `off` + 目标 project `on` -> 写两层 `skillOverrides`。
5. **验收**:开新 CC 会话,确认仅目标项目看到该 skill;其他项目不受影响。

> 出口标准 = 《目标文档》七的前两条。

---

## 十一、实施路线图

| 阶段 | 内容 | 出口 |
|---|---|---|
| Phase 0 | 脚手架(新仓库或干净分支)+ 移植复用件 + 设计系统 | 能跑空壳 |
| Phase 1 | **skill 单轴闭环**(scan/overview/toggle/verify) | 七.1-2 |
| Phase 2 | C 类(agent/command/rule)library + 软链部署 | 七.4 |
| Phase 3 | A 类剩余(plugin/lsp,`enabledPlugins`) | 总览合并 |
| Phase 4 | B 类(hook/mcp)scope 迁移 + 全类总览 | 七.3 |
| Phase 5 | 只读内容查看页(七"查看"迭代项) | - |

每阶段都"落地到 CC 真实配置、新会话可见",保证始终可用。

---

## 十二、风险与对策

| 风险 | 对策 |
|---|---|
| Windows 软链受限(影响 C 类) | 检测平台:Unix 用 symlink;Windows 降级为**硬拷贝 + 指纹(sha256)校验**,真身变更时重拷 |
| 直接写原生配置有误删风险 | 每次写前 `backup.rs` 备份 + **保键合并**(只动目标 key,保留其余) |
| `skillOverrides` 语义随 CC 升级变动 | 把 skill 行为收敛进 `adapters/skill.rs` 一处;加版本/字段探测,变动只改一处 |
| 扫描多项目较慢 | 总览先做"全局 + 当前选中项目";全量扫描异步、缓存、可刷新 |
| 与 CC 实测假设不符 | 每个 Phase 以《目标文档》已验证结论为基线;MVP 用真机验证后再推进 |

---

## 十三、命名与脚手架建议

- 项目名:**claude-tool-manager**(沿用 ccc-ui 的 internal name `claude_code_tool_manager`)或 **cc-tools**。
- 仓库:新 repo,README 注明"脱胎于 claude-code-config-ui,聚焦 Claude Code tool 的作用域与开关管理"。
- 第一步命令(确认后执行):建目录、`cargo tauri init` 起壳、移植 §9 复用件、落地 Phase 1。

---

## 十四、成功标准(映射《目标文档》七)

- 打开即一眼看到本机所有 tool + 每个 tool 的作用域与开关状态。
- 一个全局 skill 能"仅在 N 个指定项目启用"(全局 `off` + 目标 `on`)。
- 某项目关掉某 skill,其他项目不受影响。
- agent/command/rule 能 SSOT 部署到多项目(改真身全同步)。
- 所有操作落地 **CC 真实配置文件**(新会话即可见)。

---

*本文档为工程蓝图。确认(或提出修改)后,进入 Phase 0 脚手架与 Phase 1 MVP。*