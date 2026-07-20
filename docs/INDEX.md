# INDEX.md — alarm-api V12 文档总索引与路线图

> **换对话接力开发者: 先读 docs/HANDOFF.md**(防偏移契约)，再按其指引读其余。

> 迷路时先看这里。文档分四层: 宪法 / 操作 / 施工史 / 待建。v1 时代文档已归档 _archive-v1/。

## 现役文档（V12）

| 文档 | 层级 | 何时看 |
|---|---|---|
| **KERNEL.md** (v0.7) | 宪法 | 改架构前必读: 两类铁律(§17.5)、十六契约、命名法、术语表(§18) |
| **RULEBOOK.md** | 操作 | 想改规则/加字段/加插件: 事实词汇表 + 变更配方 + 委托 AI 模板 |
| **PHONE-V2.md** (v2.0) | 操作 | 手机端逐动作装配: 铁则四条 + ApplyState/SyncAlarms/刺客 |
| **PARITY.md** | 操作 | v1↔v2 对拍: 取数口径 + 映射 + 白名单 + 判例 |
| **PHONE-FEASIBILITY.md** | 施工史 | 手机端能力实测台账(P1–P7, 2026-07) |
| **BLUEPRINT.md** | 施工史 | 每步怎么建的、每个 schema 怎么定的、历次裁决 |
| **DEVLOG.md** | 施工史 | 时间线流水 |
| **HANDOFF.md** | 交接契约 | ⭐换对话开发 todo通道/cadence 必读: 阅读顺序+不变量+落点+防偏移 |
| **HORIZON.md** | 远期方向 | 可视化/多设备/多用户/网页配置/格式嗅探/术语清扫; 只钉形状不写码 |
| **FEEDBACK-SELFHEAL.md** | 方向定稿 | 回传+闹钟对账自愈(接口已冻结) |
| **GUARDS-AND-PARITY.md** | 方向+审计 | 守卫泛化(guards数组,预留锁屏/App等) + v1→v2能力对等审计 + 多语言待测 |

## 待建模块文档（V13 蓝图，随实施转正）

| 文档 | 状态 | 说明 |
|---|---|---|
| **CHANNELS.md** | 蓝图·实测已备 | iPhone 执行层全部打断/提醒/触发能力总册; 新"想被提醒"需求先查此表 |
| **PROMPT-alarm-api-todo-channel.md** | 蓝图 | todo 执行通道 + Bark 推送通道实施提示词 |
| **PROMPT-phone-synctodos.md** | 蓝图 | 手机侧 SyncTodos 行为契约 |
| **V12-ADDENDUM.md** | 坐标勘误 | ⚠️ 上两份提示词是 v1 坐标系写的; 实施时**必须配本附录**翻译到 /v2 |
| _prompts-calendar-api/PROMPT-calendar-api-todos.md | 蓝图 | 另一仓库(calendar-api)的 todo 出口, 独立轨道 |
| **FEEDBACK-SELFHEAL.md** | 方向定稿 | 手机状态回传 + 闹钟对账自愈; 接口/数据/权威已冻结, 防两头大改 |

## 未来模块路线图（优先级序）

```
进行中  手机 ApplyState 灰度（PHONE-V2, 不受下列打扰）
─────────────────────────────────────────────
P1  todo 执行通道 → /v2 信封 todos 节 + reconcile_todos
     （服务端: sources.loadTodoSources + assemble.assembleTodos + domain.tdMarker）
     手机: 新建 SyncTodos 独立指令（不碰 ApplyState）
P2  Bark 推送命令通道（edge/push.js, driver 可换; god-mode/请假变更触发门铃）
     纪律: 内容只路由、指令带 key 回拉、active 档机器门铃、回响双发
P3  回传自愈【方向已定稿 → docs/FEEDBACK-SELFHEAL.md】: 三阶段 观测→建议→自愈。
     手机回传 applied_state + alarm_inventory(固定/动态闹钟实测清单, delta 优先) →
     服务端 reconcile.js diff 期望集 → 漂移分级 → reconcile_todos/Bark; 动态可自动补建。
     铁律: 自愈只"建"不"删"、固定闹钟永不自动建、回传是事实非实况(§17.5)、本地永远是最终裁判。
     接口形状已冻结(/v2/fact 三 stream + 信封 drift 节 + edge/reconcile.js), 实施只填肉不改构。
P4  cadence 泛化: ai_quota 升格为通用周期任务插件（rolling_cooldown/weekly_reset/ladder）
     任务纯配置 CADENCE.TASKS; channel 可设 alarm/reminder/notification
     标签族 GateDyn-CAD-*; 字段 fields.cadence.<task>.*（本次已命名空间就绪）
P5  闹钟标签命名迁移收尾（若 GateFix/GateDyn 上线后仍需微调, 走专项 + 手机重建）
P6  Pages 管理前端（读 /v2/timeline + /v2/facts, 写 /v2/fact 纠偏; 拖拽编排北极星）
P7  lib/ics + lib/time 提包 publish（calendar-api 第二消费者）
P8  PROFILES 多设备层（?device= 与 KV 命名空间已就绪, 配置分层）
─────────────────────────────────────────────
每个 P 项服务端由 AI 全包; 手机侧一律新建独立指令, 从头顺拼, 绝不回插 ApplyState。
```

## 外部依赖冗余原则（KERNEL 派生约束）

Bark/workdays-core 等外部依赖一律经**适配器接口**接入, 具体后端是可换 driver:
- 推送: push 接口, Bark 是一个 driver（可换 ntfy/WebPush）
- 节假日: 已是 workdays-core 动态 import + 降级
哪天某依赖付费/关停, 换 driver 不动主逻辑。切换成本被隔离在适配器一处。
