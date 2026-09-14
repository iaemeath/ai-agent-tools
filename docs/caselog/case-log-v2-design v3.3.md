# Case-Log 定位修订（v3.3）

> **文档性质**：定位与宿主修订（2026-08-28，用户裁定）。优先级高于 v3.1/v3.2；冲突处以本文为准。
> 前序：需求 v1.1（R 条目仍有效）→ 架构 v3.1 → 技术底座 v3.2（Node 栈 + SSH 增量拉取）。

## 1. 定位变更

**v3.1 的定位**：个人复盘工作台（每日巩固仪式）。
**v3.3 的定位**：**多设备原始会话阅读器为主体 + 两个产出通道**：

```
阅读层（主体）  多设备会话列表 + 折叠阅读（适配器架构：zcode / claude-code / web-import）
   ├─ 情景通道  勾选轮次 → 写草稿 → AI 后置 → 确认 → knowledge.db（巩固仪式，红线不变）
   └─ 笔记通道  勾选/摘录 → MD 编辑（带溯源指针）→ ~/.knowledge/notes/*.md → 导出 Obsidian
                 （采集中转站：深度学习发生在 Obsidian + 在线 AI 问答，不在本系统）
采集层         hosts SSH 行级增量拉取 → ~/.knowledge/raw/<host>.sqlite（v3.2 定案不变）
```

两条通道是**不同的认知动作**，规则不同：
- 情景通道 = 巩固（对抗遗忘）：AI 后置、人工确认唯一写入、防粘贴闸门、回顾仪式（v3.1 红线全部保留，**只约束本通道**）。
- 笔记通道 = 采集转出：摘抄会话内容合法（不需要闸门），产出 MD 文档送出系统，本系统不承载其后续学习。

## 2. 宿主变更：并入 ai-agent-tools

case-log 独立仓库（D:\cly\case-log）已废弃，功能作为 ai-agent-tools 的 **caselog 模块** 开发（技术栈全同：Hono + Vue3 + Element Plus + node:sqlite）。后期如需拆除再议。

**模块边界（拆除成本控制线）**：
- 代码：`server/src/caselog/`（模块内自包含，含自己的类型定义，不进 model.ts/profiles.ts/ToolProfile 体系）+ `web/src/views/CaselogView.vue` + 侧栏独立入口"复盘" + `/api/caselog/*` 路由前缀。
- 数据：原 `~/.knowledge/`（knowledge.db + raw/ + notes/）与宿主其余数据分立。**2026-09-10 变更**：随宿主改名 ai-tools，数据并入统一数据目录 `~/.ai-tools/caselog/`（内部布局不变，旧目录由 data-dir.ts 一次性自动搬迁；CASELOG_KB_ROOT 仍可覆盖）。
- 复用而不混编：import transcript-parser / SessionTurn / hosts-pool 是**依赖方向单向**（caselog → 工具设施），工具设施不得反向 import caselog。

## 3. 适配器架构（阅读层）

会话来源按适配器注册（复用 profiles 的 TranscriptLocator 分发思路，但 caselog 自持注册表）：

| 适配器 | 来源 | 状态 |
|---|---|---|
| `zcode` | `~/.zcode/cli/db/db.sqlite`（message+part） | ✅ 首个实现 |
| `claude-code` | `~/.claude/projects/*/*.jsonl` | 后续 |
| `web-import` | 网页导出对话（豆包/Gemini，外部脚本预处理为统一 JSONL 后导入） | 后续 |

统一中间形态：raw 库的 session/message/part 三表子集（各适配器负责把异构来源规范化进 raw），阅读组件只消费 raw → `parseSqliteMessages` 的统一 turns 结构。

## 4. 数据布局（v3.2 §3 基础上补 notes）

```
~/.knowledge/
├── raw/<host>.sqlite      # 各设备会话镜像（增量拉取，水位 = session.time_updated）
├── knowledge.db           # 3 表：scenarios / scenario_sessions / review_log（v3.1 §3.1 不变）
└── notes/                 # MD 学习笔记（一文件一篇，纯 md，文件名即 id）
```

- 笔记导出：配置 Obsidian vault 目录（env `CASELOG_OBSIDIAN_DIR`），导出 = 复制 md 文件到 vault（Obsidian 自动感知）。未配置时提供下载。
- 情景的 AI 后置校对：OpenAI 兼容端点（env `CASELOG_LLM_BASE_URL/MODEL/API_KEY`），未配置时优雅跳过（参照 reference/mcp_server.py 的编排，移植到 Node）。

## 5. 页面形态

- **复盘页（/caselog）**，三个标签：
  - **阅读**：设备(host)选择 + 会话列表 → SessionTurn 折叠阅读 → 「记情景」「记笔记」动作
  - **情景**：情景卡片列表（编辑走 R7 留痕；回顾视图 Phase 2）
  - **笔记**：MD 列表 + 编辑器 + 导出到 Obsidian
- 主页时间线（情景 + 顶部今日到期回顾）推迟到 Phase 2——阅读器先用起来。
- 无搜索框红线（R3/N5）只约束情景与回顾界面；阅读层的设备/会话切换是浏览不是检索。

## 6. 分期（修订）

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1a | caselog 模块骨架 + 阅读层（raw 库 + 本机 zcode 适配器 + 阅读页） | 本次 |
| 1b | 采集层：hosts SSH 增量拉取（remote 命令 caselog.pull） | 本次（含） |
| 1c | 情景通道最小闭环（草稿+指针落库，AI 后置待 LLM 端点配置）+ 笔记通道 + 导出 | 本次（AI 后置留 TODO） |
| 2 | 回顾视图（review_log + 到期计算）+ 主页时间线 + R7 编辑留痕 + AI 后置接通 | 后续 |
| 3 | claude-code / web-import 适配器 + 导入导出 | 后续 |
