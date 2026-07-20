# V12-ADDENDUM.md — alarm-api todo/Bark 实施提示词的坐标勘误（必读，随原提示词一并交给实施会话）

> 原提示词（PROMPT-alarm-api-todo-channel.md / PROMPT-phone-synctodos.md）的**契约与裁决
> 全部有效**，但其落地坐标系是 v1。alarm-api 已完成 V12 重构（双轨: /v1 冻结、/v2 现役），
> 本附录做坐标翻译。冲突时: 契约听原提示词，坐标听本附录，架构听 KERNEL.md。

## 1. 真相源替换

| 原提示词指向 | V12 实际 |
|---|---|
| docs/ARCHITECTURE.md / external-alarms*.md / PHONE.md | **docs/KERNEL.md（宪法, v0.6）+ docs/BLUEPRINT.md（施工史）+ docs/RULEBOOK.md（改法手册）+ docs/PHONE-V2.md（执行器）** |
| PHONE.md 联动更新 | PHONE-V2.md 新增 §SyncTodos 章（照 PROMPT-phone 契约展开为逐动作脚本, 铁则四条适用: 文本比较/标记判空/守卫不落账/八名封顶） |

## 2. 落点坐标翻译（⚠️ 最重要: /v1 已冻结, todos 只许进 /v2）

| 原提示词词汇 | V12 落点 |
|---|---|
| 响应新增 todos 段 | **/v2/state 信封新增 `todos` 节**（与 alarms 节并列; /v1 一个字节不动） |
| `sync_todos_flag` | **`reconcile_todos`**（reconcile_* 命名族, 与 reconcile_alarms 同构） |
| humanReadable 拒收计数 | **结构化 trace**: `{level, plugin:"todos", ref, msg}`（KERNEL §13, 出口渲染） |
| 源配置位置 | config.default.js 新增 `TODO_SOURCES` 段 + env 隐私源（同 EXTERNAL_ALARMS 双轨） |
| 拉源/净化/换算代码位置 | edge/sources.js 新增 loadTodoSources（I/O 半场）+ edge/assemble.js 新增 assembleTodos（窗口/severity 映射半场）——与外部闹钟同构分工 |
| 标记构造 | domain/alarm-labels.js 新增 `tdMarker(code, uid)`（Gate 家族单一构造点; gate-td:// 语法一经上线即冻结, 同 §12 纪律） |
| Bark 出站模块 | edge/push.js（新）; BARK_KEY 走 Cloudflare Secret; 触发点挂 edge 层（god-mode/请假变更检测属采样期比对, 不进插件——插件纯度红线契约7） |

## 3. 术语表合规修正（KERNEL §18 "新键先查表"）

| 原提示词键名 | 修正 | 理由 |
|---|---|---|
| 条目 `mode: urgent\|alert\|silent` | **`landing: urgent\|alert\|silent`**（建议; 现场可另裁但不得用 mode） | `mode` 已被 §18 定义为 focus 模式 token, 撞名即语义污染 |
| `dueDate`/`dueTime`（下发契约） | **`due_date` / `due_time`** | 命名法: API 全 snake_case |
| severity 值 | 照用 high/normal/low（token, 合规）; critical 不进本通道（原裁决维持） | — |
| 新 token 登记 | `landing`、`reconcile_todos`、`gate-td://`、`gate-tdx://` 补进 §18 术语表 | 一并交付 |

## 4. 架构对位说明（给实施会话的心智地图）

- todos = "此刻应存在的未来 todo 全集" = **闹钟即状态**的提醒事项版; 手机 upsert+墓碑
  = reconcile。KERNEL §10 预留的 `channel: "reminder"` 由此兑现——**V13 的 cadence 任务
  将来把 channel 设为 reminder 时, 产物路由进同一个 todos 节**, 本次实现即为其铺轨。
- 外部 todo 源走 sources→assemble 路径（同外部闹钟, 不需要插件）; 将来内生 todo
  （cadence）走插件→assemble 汇入, 两路在 assembleTodos 并集。
- CHANNELS.md 入库 docs/（原样, 它是实测台账不需翻译）; V13 notices 设计**服从其结论**:
  机器门铃 = Bark active, 人的紧急 = critical, "Show Notification"路线降级为备选。
- 验收: 本次两手术均不得触碰 kernel/ 目录（验收九条延续）; todos 治理硬熔断风格
  沿用 assembleAlarms 的拒收计数 trace。

## 5. 排期裁决（Ivan 已同意的顺序, 实施会话不要抢跑）

① 手机 ApplyState 灰度先跑顺（进行中, 本工程不得打扰）
② 手术A todo 通道 → /v2（服务端可先行, 不依赖①）
③ PHONE-V2 §SyncTodos 逐动作化 + 手机施工（在①收口后）
④ 手术B Bark（依赖③的门铃自动化预建物）
⑤ calendar-api 侧 PROMPT 独立轨道, 随时可做（另一仓库）
