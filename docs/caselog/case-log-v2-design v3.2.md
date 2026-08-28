# Case-Log 架构增补（v3.2）

> **文档性质**：对 v3.1 的技术底座修订与采集方案增补（2026-08-28，用户裁定）
> **裁定**：技术栈 Python→**Node（Hono + Vue3 + Element Plus，同 ai-agent-tools）**；etl.py 退役删除；
> 多设备会话经 **SSH 拉取**汇集到阅读主机本地。v3.1 的需求层（R1~R11 / N1~N5）全部不变。

## 1. 技术底座修订（替代 v3.1 附录）

| 组件 | v3.1 | v3.2 |
|---|---|---|
| 工具面 | Python + MCP | **Node server（Hono）+ Vue3/Element Plus 页面**；MCP 后置，Phase 1 不做 |
| 解析器 | Python 移植版（双份维护） | **直接复用 ai-agent-tools `transcript-parser.ts`（TS 单一来源）** |
| 阅读界面 | 待定 | **复用 SessionTurn / SessionsView 组件**（折叠渲染已打磨） |
| 存储 | SQLite | 不变：`~/.knowledge/knowledge.db`（3 表）+ 新增 raw 库（见 §3） |
| ETL | Python etl.py | **删除**；规范化在读取时在线解析，normalized/ JSON 落盘仅作归档输出 |

npm 依赖走 Nexus 私服（ssh2 / hono / vue 等均可取，与 ai-agent-tools 同源）。

## 2. 同步方案选型（调研结论）

目标：阅读主机本地能看到多台设备的会话记录。候选评估：

| 方案 | 结论 | 理由 |
|---|---|---|
| Syncthing（P2P 块级增量） | ❌ | 需每台设备常驻 daemon + 配对管理；对**热写中的 sqlite 单文件**同步有一致性风险（官方也建议不同步 DB 文件）；首次仍要传 625MB 全量 |
| rsync 块增量 | ❌ | Windows 源机无原生 rsync；且 VACUUM 会整文件重排，增量失效 |
| 整库快照（VACUUM INTO + scp） | ❌ | 本机 db.sqlite 实测 **625MB**，每次同步传输量不可接受 |
| **SSH 行级增量拉取** | ✅ | 只拉变化：`session.time_updated > 水位` 的会话 + 其 message/part 行；每次几 MB 以内；复用 ai-agent-tools 的 remote-exec 模式（esbuild bundle → ssh exec → JSON） |

**定案：SSH 行级增量拉取**。源机零常驻（只要 sshd + node，与 ai-agent-tools 远程主机要求一致）、零安装。

## 3. 采集设计（raw 库）

```
~/.knowledge/
├── raw/<host>.sqlite      # 各设备会话镜像（session/message/part 三表子集）
├── knowledge.db           # 3 表：scenarios / scenario_sessions / review_log
└── normalized/            # （可选归档）规范化会话流 JSON
```

- **拉取协议**（对每台 host）：
  1. exec 查询 `SELECT id, title, task_type, parent_id, time_updated FROM session WHERE time_updated > ?`（水位 = 该 host 上次拉取值）
  2. 对每个新增/变更会话，拉其 message+part 行（大 payload 走 sftp 临时文件，小 payload 走 exec stdout JSON——沿用 runner.ts 的 ARG_INLINE_MAX 分流思路）
  3. 本地 upsert 进 `raw/<host>.sqlite`，更新水位
  4. 变更会话按 session_id 整体重写（会话被压缩/追加时行集变化，非 append-only，不做行级 diff）
- **首次回填**：默认近 90 天（`--since` 可调），不追求全量历史
- **一致性**：源机 db 为热库，读取用只读连接；行级 SELECT 本身是事务一致快照，无需 VACUUM INTO
- **host 清单**：沿用 ai-agent-tools 的 hosts 注册表形态（hostId / 地址 / 凭据）

## 4. 页面形态（细化 v3.1 §5.2）

- **主页 = 情景时间线**：按日分组情景卡片；**顶部固定区 = 今日到期回顾清单**（满 1/2/4/7/15 天）
- **复盘页**（核心流）：会话阅读（复用 SessionTurn 折叠渲染，跨 host 的会话列表）→ 勾选轮次区间 → 凭记忆写草稿（标题+经验小结）→ AI 后置补充（候选形态，可整项丢弃）→ 确认落库
- **回顾页**：标题态 → 回忆 → 展开 → review_log（remembered/forgotten/conflict）
- 无搜索框、无任何查询输入（R3/N5 不变）

## 5. Phase 1（修订）

| 步骤 | 内容 | 验收 |
|---|---|---|
| 1a | Node 骨架（server Hono + web Vue3），拷入 transcript-parser / SessionTurn / hosts-ssh 模块 | 本机阅读页可看会话 |
| 1b | SSH 行级增量拉取 → raw/<host>.sqlite | 两台设备会话在本地可读 |
| 1c | knowledge.db 3 表 + 情景落库 + 主页时间线 | 一条情景走完「阅读→勾选→写→AI 后置→确认」，时间线可见 |

AI 后置校对（本地/内网 LLM 调用编排）在 1c 内一并落地最小版。
