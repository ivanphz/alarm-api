# HANDOFF.md — 接力开发的防偏移契约 + 文档地图 + 路线图

> **读者**: 接手 alarm-api 后续开发的新会话（可能是别的 AI）。你没有此前对话的记忆，
> 只有本仓库文档。**本文是你的行为契约与阅读顺序，先读完再动任何代码。**
> 违反本文任一条 = 偏移。偏移的代价见每条括注。
>
> （本文合并了原 `INDEX.md` 的文档地图与路线图——一个入口，不再两处维护。）

---

## 0. 三十秒定位

alarm-api 已完成 V12 插件化重构（双轨: `/v1` 冻结、`/v2` 现役，**75 用例全绿**）。
你接手的是**在 /v2 上新增能力**，不是改架构。三层生态:
`workdays-core`（事实）→ `calendar-api`（决策，另一仓库）→ **`alarm-api`（执行，本仓库）**。

## 1. 强制阅读顺序（跳读 = 偏移，后果: 重复已废弃的方案）

```
1. 本文 §2 不变量 + §4 落点速查   ← 先知道什么不能碰、东西该放哪
2. docs/KERNEL.md                 ← 宪法。重点: §3 十五条契约、§17.5 两类铁律、
                                     §18 术语表(含边界双名制)、§19 数据结构附录
3. docs/RULEBOOK.md               ← 改规则/加插件/加字段的配方 + 事实词汇表 + 委托模板
4. 你的任务专属文档（见 §3/§6）
5. docs/DEVLOG.md §1              ← 动手机端之前必读: iOS 快捷指令的行为不符合直觉
```

## 2. 不可违反的不变量（违反即架构损伤）

1. **/v1 冻结**: `src/v1-legacy.js` 及其依赖只修 bug，绝不加功能。新能力**只进 /v2**。
   (违反: 把新字段加进冻结轨道，将来 v1 下线时连累新功能)
2. **插件纯函数**: `produce(ctx, range)` 禁读时钟(`Date.now()`)、禁 I/O(`fetch`)。
   所有 I/O 在 edge 层，now 只在采样端。(违反: golden 测试失效、`?date=` 预览崩)
3. **消费者只认规则名**(契约15): 字段/下游插件只订阅 schedule 名，不碰生产者内部，
   不看其他字段的值。想"看别人的值"→ 升格为命名规则让双方订阅。
   (违反: 删一个模块炸另一个，回到 V11 耦合地狱)
4. **token 唯一权威**: API 全小写 snake_case token; 显示名/本地化永不参与比较、不入 last_applied。
   (违反: 换语言全字段重放、比较随 iOS 版本漂移)
5. **单一 owner**(契约6): 每个 schedule 一个 owner 插件，同 owner 区间不重叠。
6. **回传是事实非实况**(KERNEL §17.5): 手机回传可作"已发生事件"进 KV，绝不作"决策依据"。
   云端 diff 永远 advisory，本地是最终裁判。(违反: KV 最终一致致控制回路震荡)
7. **Gate 标签冻结**(KERNEL §12): `GateFix-`/`GateDyn-` 两族，后段全称。演进只许加
   `GateDyn-<新族>-`，既有格式动一字 = 全设备重录。构造唯一入口 `domain/alarm-labels.js`。
8. **网关零 iPhone 概念**: 服务端禁用 列表/urgent/alert/归档/提醒事项 等词。
   见 KERNEL §18 边界双名制: 网关 `todo` ⇄ 手机 `reminder`。
9. **验收九条**: 任何改动完成，`node --test` 全绿 + 新逻辑有用例(含反例) +
   `kernel/` 目录 diff 为零。碰 `kernel/` = 你选错了层，回 RULEBOOK 重选。
10. **大版本迁移必做能力对等清点**: 迁移(如 v2→v3)前逐条核对旧版能力文档，
    不能只搬"当前配置用到的部分"。
    **教训(真实发生过)**: v1→v2 曾丢 Set Focus 变量机制与守卫完整能力，
    审计表见 `_archive/GUARDS-AND-PARITY.md` §2。
11. **跨平台契约零平台字符串**: fields/guards 里永不出现包名、本地化名、平台特有词，
    只有语义 token。平台差异由数据消化（云端 resolve 表 + 设备能力声明）。
    详见 DEVICE-ABSTRACTION.md §7。

---

## 3. ⚠️ 当前首要任务: 设备抽象层重构

**读 `docs/DEVICE-ABSTRACTION.md`（设计已定稿，含完整迁移清单，照做即可）。**

**接手第一件事不是 todo 通道，是这个重构** —— 它为两处失误买单，且是安卓移植的前提:
① 曾把 iOS 包名(`com.apple.Maps`)写进 guards 契约 → 平台细节漏进契约，安卓必返工;
② 曾为兼容硬加字段级裸 `GUARDS`，与值内 guards 形成两个来源 → 不统一。

核心不变量见该文 §7。**§8 有四个遗留决策需 Ivan 先拍板，勿自行决定。**

---

## 4. 服务端落点速查（别放错层）

| 要加什么 | 放哪 | 禁止放哪 |
|---|---|---|
| 外部数据拉取/解析 | `edge/sources.js` | 插件(纯度红线) |
| 时区换算/窗口/severity映射/标签构造 | `edge/assemble.js` + `domain/alarm-labels.js` | 插件 |
| 新决策规则(内生的) | `src/plugins/新文件` | `kernel/` |
| 新事实(内生的) | `src/plugins/新文件` 或 presence 扩展 | edge |
| diff/漂移/推送 | `edge/reconcile.js`(新) + `edge/push.js`(新) | 插件 |
| 新配置 | `config.default.js`(零配置值) + `config.user.js`(用户领地) | 硬编码进 src |
| 信封新字段 | `edge/assemble.js` 组装 | `kernel/` |

---

## 5. 文档地图

**契约层**（改之前必读）
| 文档 | 何时看 |
|---|---|
| **KERNEL.md** (v0.7) | 改架构前必读: 十五条契约、两类铁律(§17.5)、命名法、术语表(§18)、数据结构(§19) |
| **RULEBOOK.md** | 想改规则/加字段/加插件: 事实词汇表 + 变更配方 + 委托 AI 模板 |
| **PHONE.md** (v3.0) | 手机端逐动作装配: 铁则四条 + CheckGuards/ApplySilent/ApplyFocus/ApplyVolume/SyncAlarms/刺客 |
| **CHANNELS.md** | iPhone 全部打断/提醒/触发能力总册 + 实测台账; **新"想被提醒"需求先查此表** |

**接口与运维**
| 文档 | 何时看 |
|---|---|
| **OPERATIONS.md** | 部署/密钥/KV/冒烟/排错 trace 速查/交付纪律 |
| **EXTERNAL-SOURCES.md** | 外部闹钟源: §A 对接协议(可外发乙方) / §B 内部机制与排错 |
| **GOD-MODE.md** | 上帝模式: 触发条件 + JSON 模板 + 验证 |

**待建（设计已定稿，只差实施）**
| 文档 | 状态 |
|---|---|
| **DEVICE-ABSTRACTION.md** | ⭐ **下一步主任务**: 语义token + resolve解析表、guards两作用域、platform自报 |
| **TODO-CHANNEL.md** | todo 执行通道 + Bark 推送通道，服务端+手机端完整契约（已翻译到 v2 坐标） |
| **FEEDBACK-SELFHEAL.md** | 回传 + 闹钟对账自愈，三阶段；接口形状已冻结 |
| **HORIZON.md** | 远期方向账本: 可视化/网页配置/多设备/格式嗅探/术语清扫; 只钉形状不写码 |

**历史**
| 文档 | 何时看 |
|---|---|
| **DEVLOG.md** | 踩坑总账(iOS/Worker) + 决策考古 + 版本时间线。**动手机端前必读 §1** |
| **_archive/** | 已完成的一次性文档 + v1 时代文档。有效结论已迁出，仅供考古 |

---

## 6. 路线图（优先级序）

```
进行中  手机端 Apply* 灰度（PHONE.md, 不受下列打扰）
─────────────────────────────────────────────
P0  ⭐ 设备抽象层重构（DEVICE-ABSTRACTION.md）—— 当前首要任务
     resolve 表替代 i18n 双表 · op 收敛 in/not_in · GUARDS_ALWAYS 两作用域 · ?platform= 自报

P1  todo 执行通道 → /v2 信封 todos 节 + reconcile_todos（TODO-CHANNEL.md 第一部分）
     服务端: sources.loadTodoSources + assemble.assembleTodos + domain.tdMarker()
     手机: 新建 SyncTodos 独立指令（不碰 Apply*）

P2  Bark 推送命令通道（edge/push.js, driver 可换; god-mode/请假变更触发门铃）
     纪律: 内容只路由、指令带 key 回拉、active 档机器门铃、回响双发

P3  回传自愈（FEEDBACK-SELFHEAL.md）: 三阶段 观测→建议→自愈
     手机回传 applied_state + alarm_inventory → edge/reconcile.js diff 期望集 → 漂移分级
     铁律: 只"建"不"删"、固定闹钟永不自动建、回传是事实非实况、本地永远是最终裁判

P4  cadence 泛化 + 命名收口（见 §7，当前处于半迁移状态）
     ai_quota 升格为通用周期任务插件（rolling_cooldown/weekly_reset/ladder）
     任务纯配置 CADENCE.TASKS; channel 可设 alarm/todo/notification
     ⚠️ 含两处前置修复，见 §7.1/§7.2 —— 其中 audit 豁免名单不修则改名必破验收九条

P5  Pages 管理前端（读 /v2/timeline + /v2/facts, 写 /v2/fact 纠偏; 拖拽编排北极星）
P6  lib/ics + lib/time 提包 publish（calendar-api 第二消费者）
P7  PROFILES 多设备层（?device= 与 KV 命名空间已就绪, 配置分层）
─────────────────────────────────────────────
每个 P 项服务端由 AI 全包; 手机侧一律新建独立指令, 从头顺拼, 绝不回插现有 Apply*。
```

**顺序裁决（Ivan 已同意，实施会话不要抢跑）**:
① 手机 Apply\* 灰度先跑顺（进行中，不得打扰）→ ② P0 设备抽象（服务端可先行）→
③ P1 todo 服务端 → ④ PHONE.md 加 §SyncTodos + 手机施工 → ⑤ P2 Bark（依赖④的门铃预建物）。
calendar-api 侧的 todo 出口是**独立轨道**，随时可做（另一仓库）。

---

## 7. cadence 任务的专属契约（P4 时读）

读 KERNEL §10（cadence 设计）+ `src/plugins/ai-quota.js`（首个特例，当范本）。

### 7.0 ⚠️ 当前是半迁移状态（v0.7 只改了一半）

v0.7 的"ai→cadence 归位"**只改了对外契约，没改内部命名**，于是同一个机制现在有两套名字:

| 层 | 现状 | 该叫什么 |
|---|---|---|
| 字段名 | `fields.cadence.ai_claude` ✅ | 已归位 |
| 标签族 | `GateDyn-CAD-*` / `cadenceLabel()` ✅ | 已归位 |
| **插件文件** | `plugins/ai-quota.js` · `ai-quota-reminder.js` ❌ | `cadence.js` · `cadence-reminder.js` |
| **schedule 名** | `ai_quota` · `ai_quota_reminder` ❌ | `cadence` · `cadence_reminder` |
| **config 块** | `V2.AI_QUOTA` ❌ | `V2.CADENCE.TASKS` |

**可见的接缝**: `V2_DEFAULTS.FIELDS["cadence.ai_claude"].USE = "ai_quota"`
—— 一个 `cadence.*` 字段订阅着一条 `ai_quota` 规则。读代码的人必然卡在这。

**⚠️ 边界（别过度改名）**: `ai_claude` 是**任务名**，是数据不是结构，
和 KERNEL §10 里的 `game_chest` / `signin_x` 同级 —— **它不该被改，改了反而错**。
要改的只有上表"机制名"那三行。

**波及范围**（本次核对实测）: `src/` 4 文件 + `test/` 2 文件。

### 7.1 前置修复①: kernel/audit.js 的硬编码豁免名单（必须先做）

`kernel/audit.js` 里有一张写死的插件名集合，用来把"非字段订阅型 schedule"排除出孤儿告警:

```js
const exempt = new Set(["restdays", "presence", "school_break", "god_mode",
                        "wake_alarms", "weekend_class", "ai_quota_reminder"]);
```

**这是一处真实的契约破口，两个后果:**
1. 把 `ai_quota_reminder` 改名 → **必须动 `kernel/`** → 直接违反验收九条「kernel/ diff 为零」。
2. 更根本: 代码注释自己写着"新增非字段订阅型 schedule 必须同步登记"
   —— 意味着**验收九条 #3「新命名规则 = 新插件文件、内核零改动」对这一类插件目前根本做不到**。

**修法（方向，实施时定稿）**: 豁免改为**插件自声明**，如插件对象加一个
`subscribable: false`（或由 `kind` 推断），audit 从注册表读，**kernel/ 从此不认识任何插件名**。
改完之后，加任何新插件才真正是内核零改动。

### 7.2 前置修复②: edge/assemble.js 的 ALARM_SCHEDULES

```js
export const ALARM_SCHEDULES = ["wake_alarms", "weekend_class", "ai_quota_reminder"];
```
同样是硬编码名单，但它在 `edge/`（按 §4 落点表属允许改动区），**不违反契约，只是同样该改成
自声明**（如插件声明 `emits: "alarms"`）。**两处一起改最省，机制一致。**

### 7.3 泛化本体

- **cadence 是通用周期任务插件；ai_quota 是它的第一个特例（已实现）:**
  字段 `fields.cadence.<task>`、标签族 `GateDyn-CAD-*`、`cadenceLabel()`。
- 泛化 = 把 `ai-quota.js` 的区间构造（冷却/周重置/纠偏事实）抽成 **kinds 库**
  (`rolling_cooldown` | `weekly_reset` | `ladder` | …)，任务变**纯配置** `CADENCE.TASKS`。
- 每任务声明 `channel`: `alarm`（走 GateDyn 闹钟）| `todo`（走 todos 节，需先做 P1）|
  `notification`（走 Bark/通知）。channel=todo 时**产物汇入 todos 节**，与自愈/calendar 并集。
- 管理操作（重置/手动改期）= 往事实流写纠偏事件（`reset`/`set_next`），**不加新端点**（契约14）。

---

## 8. 外部依赖冗余原则（KERNEL 派生约束）

Bark / workdays-core 等外部依赖一律经**适配器接口**接入，具体后端是可换 driver:
- 推送: push 接口，Bark 是一个 driver（可换 ntfy/WebPush）
- 节假日: 已是 workdays-core 动态 import + 降级

哪天某依赖付费/关停，换 driver 不动主逻辑。**切换成本被隔离在适配器一处。**

---

## 9. 交付纪律

- 只交付新增/修改的**单个文件**，不打包（除非明确要整包）。
- 每个改动配 `node --test` 用例（含一个反例）。
- 改线上契约（信封/端点）必同步更新 `PHONE.md` 与相关文档。
- 新术语/新字段先查 KERNEL §18，查无先补表 —— 尤其过边界的词走双名制。
- 交付含双轨（冻结+现役）的包，必须做"从入口全图解析"校验（OPERATIONS §6.6）。
- 完成后自查 §2 不变量 + KERNEL §15 验收九条。

---

## 10. 疑似要改架构时（停）

如果你发现任务"必须"改 `kernel/`、必须破契约、必须动 Gate 标签语法、必须让插件读时钟或
让服务端存实况 —— **停下来，先问 Ivan**。90% 情况是选错了层（回 §4 重选）或误解了需求。
真需要破契约的，是架构决策，不是实施细节，必须 Ivan 拍板并记入 KERNEL/DEVLOG。

**同理，设计与实施分开**: 涉及结构性改动时**先出设计文档给 Ivan 确认，再写代码**
（此前有过未经同意即改代码的教训）。

---

## 附: 当前状态锚点

- KERNEL **v0.7** / **75 用例全绿** / v2 未正式切默认（手机灰度中）
- **已实现**: 全部决策插件 + 字段五旋钮 + 闹钟 + 外部源 + ai_quota(cadence 特例)
  + guards(is/is_not/in/not_in, 字段级下发) + i18n 下发 + `/v2/fact` 事实流
- **首要**: 设备抽象层重构（DEVICE-ABSTRACTION.md，设计定稿待实施）
- **方向已定稿未实施**: todo通道 · Bark · 回传自愈 · cadence泛化 · 可视化/网页配置/多设备
- ⚠️ **现有代码含四处待清理痕迹**:
  ① 字段级裸 `GUARDS`（应改名 `GUARDS_ALWAYS`，DEVICE-ABSTRACTION §3）
  ② `router.js V2_DEFAULTS` 里 media_volume 的 bundle id 注释示例（应改语义 token）
  ③ **`src/edge/fields.js` 是 `src/kernel/fields.js` 的完全副本且无人 import —— 死文件，可直接删**
  ④ **cadence 半迁移**: 字段/标签已归位 cadence，但插件文件/schedule名/config 块仍叫 ai_quota（§7.0）
- ⚠️ **已知契约破口**: `kernel/audit.js` 硬编码插件名豁免清单，使验收九条 #3
  对"非字段订阅型插件"无法成立（§7.1）。修法已定方向，随 P4 一起做
