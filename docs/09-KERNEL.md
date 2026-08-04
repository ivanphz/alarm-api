# 09-KERNEL — 内核契约（宪法层）

> ⚠️ **代码里到处引用本文的编号**（`契约3` `契约12` `KERNEL §13` `[09-KERNEL](09-KERNEL.md) §18` …），
> 所以它必须活着。删改条目前先 `grep -rn "契约" src/`。
>
> **最值得先读的是 §17.5「政策 vs 不变量」** —— 它给了判断「这条规矩该落在哪」的判据，
> 是这份宪法里唯一每次改动都用得上的一节。
>
> **§5「字段订阅五旋钮」已于 2026-07-29 退役** —— 规则表取代了它，看 [02-RULES](02-RULES.md)。
> 该节保留仅为读懂旧代码注释；新代码不要按它写。

---

## 0. 定位与三权分立

```
Apple 日历(录入) → grammar(解释) → 插件(决策) → 内核(合并/采样) → 执行器(落地)
```

| 角色 | 位置 | 职责 | 明确不管 |
|---|---|---|---|
| 输入源 | iCloud/外部ICS/workdays-core/facts | 提供事实 | 决策 |
| grammar | domain/grammar.js（包形） | 标题词法 → 类型化事实 | 决策、I/O |
| 插件 | src/plugins/*.js | 纯函数产出 schedule | I/O、采样、字段、手机 |
| 内核 | src/kernel/*.js | 加载/排序/校验/合并/采样/trace | 业务语义 |
| 执行器 | 手机快捷指令 | 采样→比对→本地化映射→动手 | 决策 |

**云端全程无状态**（仅 KV 存事实与外部闹钟聚合）。一切"实际状态"只活在手机。

---

## 1. 核心概念

- **schedule（命名时刻函数）**: 插件的产物。两种 kind：
  - `level`: 分段常值函数 `[{from, value}, …]`，值保持到下一段。**每一刻都有定义**。
  - `pulse`: 点事件 `[{at, id, payload}]`。当前仅定义类型；首个实装场景 = notices。
- **区间时间**【已裁决】: `from`/`at` = `"YYYY-MM-DD HH:MM"` **上海墙钟**（全生态上海锚定，复用 toShanghaiWall）。绝对时间戳，跨午夜天然连续，LOOKBACK 退役。
- **时间线范围**: `[昨天 00:00, 明天 24:00)` 三天滚动。
- **字段（field）= 手机能力的抽象**: focus / silent / media_volume / alarms / notices…。闹钟只是能力之一，**执行落点从不限于闹钟**（状态变更、通知、提醒均为字段）。
- **闹钟即状态**: `alarms` 字段 = "当前应启用的闹钟集合" S(t)，level 语义。手机对账 = diff(实际集合, S(t))；`reconcile_alarms` 仅为"何时执行昂贵对账"的调度提示。
- **事实（fact）vs 实况**: 事实 = 领域事件，可进 KV；实况 = 手机功能实际值（当前音量、当前 Focus 名），**永不进云端**。详见 §17.5。
- **profile（device）**: 配置维度，非租户。

---

## 2. 命名法（宪法级，破坏性重命名一次到位）

**总纲（v0.7）: 明确压倒简洁。** 一个名字宁可长三个字符，也不要在半年后需要查文档才知道它指什么。缩写是给打字省力的，不是给读代码的人省力的。

- **API/JSON/token 一律 snake_case 全称，禁缩写**（历史教训: dnd）。文件名 kebab-case。
- **枚举值 = 小写语义 token**: `on` / `off` / `do_not_disturb` / `sleep` / `work`…
- **人类语言只允许出现在 trace.msg 与 reason 类字段**，永不出现在键名、枚举值、MAP 输出。
- **过边界的词必须换名**（边界双名制）: 网关侧说 `todo`，手机侧说 reminder；见 §18 与 HORIZON §6。

### 2.1 破坏性重命名表（累计，仅 /v2 生效）

| 旧 | 新 | 批次 | 说明 |
|---|---|---|---|
| schedule `dnd` | `quiet` | v0.3 | dnd 只是 focus 的一种模式，原名不规范 |
| 值 `ON`/`OFF` | `on`/`off` | v0.3 | 全域统一 |
| `MODE_NAME: "Do Not Disturb"` | token 化 | v0.3 | 契约13，Focus **名称**永不出云端 |
| MAP 输出 `"静音"/"响铃"` 类 | 必须 token | v0.3 | 本地化下放执行器 |
| `sync_alarms` | `reconcile_alarms` | v0.3 | 语义为对账提示，非同步开关 |
| focus 值键 `mode` | **`preset`** | **v0.7** | `mode` 撞 `?mode=` URL 参数与"模式"泛称；mode 一词全系统退役（URL 参数除外） |
| `Gate-Fixed-` | **`GateFix-`** | **v0.7** | 见 §12 |
| `Gate-Dynamic-` / `Gate-ES-` / `Gate-Class-` / `Gate-AIQ-` | **`GateDyn-` 单一动态族** | **v0.7** | 见 §12 |
| 字段 `ai_available` | **`cadence.ai_claude`** | **v0.7** | ai_quota 归位 cadence 命名空间，见 §10 |
| todo 条目 `mode` | **`landing`** | v0.7 | 同样撞 mode；见 §18 |

---

## 3. 十五条契约

> ⚠️ **勘误（本次整理）**: INDEX/HANDOFF 旧版称"十六契约"，系笔误。历史上从未存在第 16 条；
> 逐条核对 v0.4/v0.5/v0.6/v0.7 增补记录，契约总数恒为 **15**。相关引用已全部更正。

1. **字段消费零依赖**。依赖只存在于生产 DAG（插件 deps），构建时解算完毕。
2. **null = 无主张**。永不表示"迟到了"。状态可迟到采样、漏采样，系统收敛。规则可显式产出 null 边界=**释放主张**（如长假白天）：既让手动状态自由存活，又使随后的重新主张（null→值）成为真变化——周期性重进（长假夜夜进安静）由此实现，无需 enforce。
   ⚠️ **2026-07-31 补**：全 pulse 之后，长假夜夜重进已由 **pulse 不合并同值**直接保证，
   不再依赖 null 释放边界。null 仍是 level 的终止符，语义不变。
3. **守卫附着于区间**，执行时评估。区间值可携带守卫（值为 **token**），不满足则跳过本次、下个采样点再议。手动覆盖天然赢到下一边界。
4. **执行器必缓存 last_applied**。期望值没变，就不动手。所有字段的默认防线。**期望为 null 时删除 last_applied[字段]**——无主张=放下记忆，否则释放期后的重新主张会被旧缓存误判为"没变"。
5. **字段声明 apply 策略**。⚠️ **2026-07-29 起本条由规则表接管，见 [02-RULES](02-RULES.md)**：
   apply 从「字段级常量」下沉为**边界级**，取值 `always` / `if_changed` / `if_differs`
   （信封仍下发 `enforce` / `on_change`）。原文「当前无字段声明 enforce」已不成立 ——
   focus 六个边界现在都是 `always`。加强守卫依赖读取能力，读不到只降级加强守卫。
6. **单一 owner**。每张 schedule 有且只有一个 owner 插件；跨插件影响走 deps。同插件区间重叠 = producer bug，拒收 + trace。
7. **纯度红线**。`produce(ctx, range)` 禁读时钟、禁 I/O；"now" 只在采样端。时间线 = `(inputs, config)` 纯函数 → golden 冻结、`?date=` 预览、按输入哈希缓存。
8. **三层叠加**: 插件 base → god-mode overlay → 字段 OWN。归一化：相邻同值合并；对象相等 = 规范序列化（CRC32 习惯）。
9. **fail 语义**。插件抛错 → 该 schedule 无主张 + trace 大字报；deps required/optional。fail-closed = **宁可不动手机，不可胡动**；保命项靠手机预建固定闹钟兜底。
10. **云端存事实，不存实况**（展开见 §17.5）。
11. **device 第一天生效**: 采样/事实 API 带 `?device=`；KV 命名空间 `fact:<device>:<stream>`；per-device 数据不进他人 ctx 与 trace。
12. **版本信封**: `{version, generated_at, range, fields, trace}`，双向未知字段容忍。
13. **语义 token 红线（本地化下放执行器）**: 云端 API **永不说手机 UI 语言**。Focus 显示名随系统语言变化（"Do Not Disturb"⇄"勿扰模式"）且可被用户自定义——属于**实况**。云端只输出 token；执行器持一张本地名映射表（当前实现见 §7）。**换系统语言零改动**；新增自定义 Focus = 加一行数据。
14. **管理操作 = 纠偏事实**: 一切"重置/手动改时间/补记"不是新接口，而是往事实流写一条纠偏事件（`{type: reset|set_next|done, at, id}`）。纯度不破，审计轨迹免费，管理界面因此只是"事实控制台 + 时间线视图"这样一个纯客户端。
15. **中立规则原则（插件独立铁律）**: 消费者（字段或下游插件）只认**规则名**，不认生产者，更不认其他消费者；规则不属于任何消费者。silent 与 focus 共同订阅 quiet 是"声明决策同源"，不是依附——删除任何一方，另一方零感知；删除 quiet，双方各自安全落地为无主张。想"看一眼别的字段/插件现在的值" = 违宪信号，正确动作永远是把想看的东西升格为一张命名规则，让双方订阅。边界时刻相同，语义同源→共享一份定义（改一处全跟），数字巧合→各自独立（互不牵连）；
    用巧合数字冒充共用是配置腐败。（今天的对应物是 `quietShape()`，见 [02-RULES](02-RULES.md) §4。）

## 3.4 三层解耦（任何一层的坏输入都不该波及其它）

**① 字段之间解耦** —— 各字段独立，通过订阅规则关联，而非「字段跟字段」。
删掉 focus 整节，silent 照常渲染。没人订阅的规则会被审计标为孤儿。

**② 外部输入之间解耦** —— 每个外部输入单独 try/catch + 超时，一个坏了不影响其它。
完整降级表见 [06-OPERATIONS](06-OPERATIONS.md) §4.1。

**③ 手机状态与网关解耦** —— 网关**从不**假设手机当前状态，只下发「应该是什么」；
手机侧读当前态自行决策（守卫）。网关无状态、可随时重算，两侧靠 JSON 契约通信。

---

## 3.5 插件的输入形状与跨度约定（原 BLUEPRINT 步骤② 钉死）

```js
ctx = {
  config,        // 深合并后的只读配置
  profile,       // 设备名，缺省 "default"
  calendars: [   // ⚠️ 【日实例】: edge/sources 已把 RRULE / 跨天事件解算成逐日实例
                 //    → RRULE 复杂度被挡在 lib/ics + edge 层，【插件永不接触重复规则】
    { date, title, description?, start_time, end_time, all_day },
  ],
  workdays: [ { date, off, name } ],   // 跨度 ≥ range±16 天（块扫描需要）
  facts:    { streams: {...}, degraded: [...] },
  schedules: {},                       // 内核注入: 仅含已发布的 deps 产物（未裁剪）
}
```

**产出跨度约定**（发布未裁剪，裁剪归 `edge/assemble`）：

| 插件 | 跨度 | 为什么 |
|---|---|---|
| `restdays` | range **±2 天** | 块扫描 ±16 走原始输入，不受此限 |
| `presence` | range **±1 天** | 下游要读昨日 block、明日 rest |
| 决策类（day_type 等） | range 内逐日 | |

> **降级纪律**：读失败/未绑定的事实流进 `facts.degraded`，
> 插件对降级流输出 `null` —— **宁可不知道，不可编造**。

---

## 4. 插件契约

```js
export default {
  name: "quiet",               // schedule 名，全局唯一，owner 即本插件
  kind: "level",               // level | pulse（开放枚举）
  scope: "per-device",         // per-device | shared
  deps: [
    { name: "presence", required: true },
    { name: "restdays", required: true },
  ],
  produce(ctx, range) {        // 纯函数。禁 Date.now()/fetch
    // ctx = { config, facts, calendars, workdays, schedules(仅deps产物), profile }
    return [ { from: "2026-07-16 20:55", value: "on" },
             { from: "2026-07-17 07:40", value: "off" } ];
  }
};
```

`produce` 亦可返回 `{ segments, notes }`：notes 转 trace（诊断通道，纯度不破）。

内核职责（且仅此）：注册表加载 → deps 拓扑排序 → 校验（重叠/owner/悬空/孤儿）→ 归一化 → 发布 → 采样 → trace → 信封。

## 5. 字段订阅五旋钮 与 v2 字段清单

> ⛔ **本节已于 2026-07-29 退役**，被规则表取代 —— 看 [02-RULES](02-RULES.md)。
> 保留仅为读懂旧代码注释。五旋钮
> `USE/MAP/SKIP/OWN/APPLY` 写不出"13:29 仅工作日归零"这类需求（`OWN` 缺日型条件），
> 且可读性差。**重构完成前以本节为准，完成后本节整体退役。**

```
FIELDS.<field> = { KIND, USE, MAP, SKIP, OWN, APPLY }
```
（另有 **`GUARDS_ALWAYS`**：恒常作用域守卫，作用于整个字段，全程适用；
时点作用域守卫写在值内（`OWN` 的 `guards` / `only_if_current`）。旧键名 `GUARDS` 仍兼容但会告警。）

| 字段 | KIND | 说明 |
|---|---|---|
| `focus` | focus 对象 | `{preset:token, action:on/off, switch_to}`；守卫下发在**字段级** `fields.focus.guards` |
| `silent` | scalar | `on`/`off` |
| `media_volume` | scalar | **整数 0–100**（手机读数为 0–1 浮点，执行器 ×100 取整后比较/设置）|
| `cadence.<task>` | scalar | 周期任务可用性 `"true"/"false"/null`（扁平键，由 `CADENCE.TASKS` 自动派生，见 §10） |
| `alarms` | 集合(level) | 期望 Gate 集合，执行器 diff 对账 |
| `notices` | pulse | 未实装（cadence 通知通道） |
| `reconcile_alarms` | hint | 对账调度提示 |

**守卫位置铁律**: `only_if_current` 是单守卫语法糖，服务端翻译成 guards 条目并从 value 移除；
**所有字段的 guards 一律下发在字段级** `fields.<x>.guards`，手机端三字段读法完全一致。
（历史 bug: 曾把 focus 的 guards 塞在 `value.guards` 内，与标量字段不一致 → focus 守卫永久失效。）

## 6. 采样端

- point/segment 是同一份区间数据的两种问法，`?mode=` 决定；**插件不声明采样模式**。
- segment = 二分找最后一个 `from ≤ now`；point = 容差窗口内的值变化边界。
- point 模式另附 `current_state` "时刻优先"投影（命中时刻 + 全字段值包 + 对账标志，null=装死），供边界刺客直接消费；`changes` 保留为明细。
- point 容差【已裁决】: **过去3分 / 未来3分**（采样器参数）。
- `?device=` 必带；`?date=` 任意日期预览。

## 7. 执行器契约（与 04-PHONE.md 对接）

1. 采样 → 各字段期望 token。
2. **本地名映射**（契约13，仅 focus 类需要）。**现行做法（2026-07-25 起）**：
   请求带 `?locales=<系统语言>,en`，信封下发 **`resolve` 节**，表名 = 守卫 `source` 名
   （`current_focus` / `app` / `locked` / `volume_channel`），值恒为**候选名数组**。
   服务端还把守卫的语义 token 预展开成 `guards[].match[]`，手机端直接精确相等 ——
   **连查表都不需要**；`resolve` 现在只剩 ApplyFocus 执行段用（token → 本机名候选，逐个试开）。
   缺 `?locales=` 时降级为全语言兜底表 + 告警，**不瘫痪**。详见 [03-CONTRACT](03-CONTRACT.md)。

   > 🗑️ 已废弃：早期设计是下发 `i18n` 两张表（`focus_name_to_token` +
   > `focus_token_to_name`）。反查表在守卫改成员判断后已删除 —— 与 app 守卫同构。

3. `期望 == last_applied[field]` → 跳过（on_change）。**focus 的 last_applied 存签名 `preset|action`**，
   否则跨 preset 同 action 切换（勿扰on→睡眠on）会被判"没变"而永不生效。
4. 守卫可读 → 执行时评估；守卫拦截 = 跳过且**不落账**（enforce 压不过守卫）。
5. 动手成功 → 更新 last_applied。
6. alarms: diff 对账，`reconcile_alarms` 提示时全量。

## 8. 路由（v1 已下线 2026-07-27）

**`/v2` 前缀可选**——v1 下线后它已无区分作用：

| 路径 | 等价写法 | 说明 |
|---|---|---|
| `/state` | `/v2/state` | 采样（`?mode=segment\|point`） |
| `/timeline` | `/v2/timeline` | 全时间线预览/审计（debug 常开） |
| `/fact` · `/facts` | `/v2/fact` · `/v2/facts` | 事实写入 / 调试列取 |
| 根路径及其它 | — | 一律走 `/state` |

`V2.DEFAULT` 开关随 v1 一并退休。

## 9. 事实端点

- `POST /v2/fact` body `{stream, at, id, type?, payload?}`；`id` 幂等去重；`type ∈ done|reset|set_next`。
- `GET /v2/facts?stream=` 调试列取。KV: `fact:<device>:<stream>`，每流保留最近 200 条。
- 服务端附加观测字段 `received_at` / `colo`（契约12 容忍；延迟实验与漂移观测共用）。
- KV 未绑定 → 明确返回 `facts_storage_missing`，不静默。
- 内核抓事实流注入 `ctx.facts = { streams, degraded }`；读失败/未绑定进 degraded，插件对降级流输出 null（**宁可不知道，不可编造**）。

## 10. cadence（周期任务超级插件）

**裁决方向: 融入本框架，做成一个通用插件 + 任务纯配置；不另起系统**（另起 = 重复造 facts/采样/手机契约三件套）。ai_quota 是 cadence 的第一个任务（已实现为特例，泛化待做）。

```js
CADENCE.TASKS = {
  ai_claude:  { kind: "rolling_cooldown", cooldown: "5h", weekly_reset: "MO 08:00", channel: "alarm" },
  game_chest: { kind: "rolling_cooldown", cooldown: "7h", channel: "notification" },
  signin_x:   { kind: "ladder", steps: ["5m", "1h", "3h"], channel: "notification" },
};
```

- `kind` 开放枚举: `rolling_cooldown | weekly_reset | ladder | …`（新玩法 = 新 kind 实现，仍在插件层）。
- 任务状态 = 该任务的事实流（`done/reset/set_next` 事件），点错了就写纠偏事实（契约14）。
- `channel` = 输出路由到哪个手机能力字段: `alarm`（可靠，不依赖轮询即响铃，但污染闹钟列表、需对账）| `notification`（轻）| `todo`（走 todos 节，需先做 todo 通道）。可靠性要求决定通道选择，权在任务配置。
- 每任务同时产出一个 level 字段 `fields.cadence.<task>` 供任何消费者查询。
- 提醒闹钟标签族 `GateDyn-CAD-<task>-<HHMM>`（构造函数 `cadenceLabel()`）。
- ✅ **已泛化（2026-07-25）**：`plugins/cadence.js` 由 `CADENCE.TASKS` **生成**插件——
  一个任务 = 一张自己的 schedule `cadence_<task>` + 提醒插件 `cadence_<task>_reminder`。
  字段 `cadence.<task>` 由 `withCadenceFields` 自动派生。加任务 = 加一节纯配置，代码零改动。
  kinds 库当前只实现 `rolling_cooldown`（真有新玩法再写）；**未知 kind 报响亮错误 + 全程无主张**。
- **字段键保持扁平** `"cadence.ai_claude"`（不做嵌套）：`fields` 每个条目必须同构
  （都有 `kind`/`apply`/`value`），嵌套会让 `fields.cadence` 变成"没有 kind 的容器"，
  破坏手机端通用循环。点号只是名字的一部分，对手机端是不透明字符串。

## 11. 文件布局【已裁决】

**现状（2026-07-31 核对）**：

```
src/
  kernel/    intervals.js  fields.js  audit.js  registry.js  rules.js★
  plugins/   presence.js  restdays.js  day-type.js★  school-break.js
             god-mode.js  wake-alarms.js  weekend-class.js  cadence.js
  edge/      router.js  sources.js  assemble.js  resolve.js  push.js★
  domain/    alarm-labels.js  grammar.js
  lib/       time.js  ics.js          ← 包形，稳定后 publish（calendar-api 是第二消费者）
  config.default.js  config.user.js  config.js（合并序: default → user → PROFILES.<device>）
  ics-parser.js                          ← ICS 解析（edge/sources.js 复用）
  index.js                               ← 入口（cron scheduled 处理器也在这）
server/                                  ← 可选：门铃调度器（Docker），见 07-ROADMAP §4
```

★ = 2026-07-29 之后新增。相对原设计的变化：
- `plugins/quiet.js` **已退役** —— 决策逻辑搬进 `day-type.js` 的四根轴 + 规则表
- `edge/i18n.js` **已删** —— 由 `edge/resolve.js` 取代
- `ai-quota*.js` 已并入 `cadence.js`（由 `CADENCE.TASKS` 生成）
- **v1 冻结路径与 `src/router.js` 死文件已全部清除**

> 📖 历史：v1 时代要求五个冻结文件留在 `src/` 根且文件名精确，否则 Cloudflare 构建期
> （解析全部 import）失败。单测不会暴露 —— 用例只 import v2 路径，永不触及 legacy 分支。
> **教训仍然有效**：交付含双轨的包必须做「从入口全图解析」校验。

| v1 文件 | v2 去向 |
|---|---|
| device-state.js | kernel/intervals.js（**零依赖不 import CONFIG**）+ kernel/fields.js + kernel/audit.js |
| rules.js R1 | plugins/god-mode.js（overlay） |
| rules.js R4/R5 + ZONES | plugins/presence.js |
| rules.js R6 | plugins/quiet.js |
| rules.js R2 / R3 | plugins/wake-alarms.js / weekend-class.js |
| rest-days.js / school-break.js | plugins/restdays.js / school-break.js（shared） |
| ics-parser.js + toShanghaiWall 等 | lib/ics.js + lib/time.js（ics-parser 仍双轨共用） |
| 标题词法 | domain/grammar.js（解析失败 = 无主张 + trace） |
| index.js esLabel | domain/alarm-labels.js |
| index.js 其余 | edge/*（v1 冻结适配层亦挂此处） |

## 12. Gate 标签契约（冻结）

**两族，后段全称**（v0.7 冻结批次）:

| 族 | 前缀 | 用途 | 手机端 |
|---|---|---|---|
| 固定 | `GateFix-` | 手工预建、含自定义铃震、绝不能漏响 | 只开/关，**网关从不碰时间** |
| 动态 | `GateDyn-` | 网关按需建删，默认铃 | 前缀 sweep：在清单→开/建，不在→关 |

现役子族：`GateFix-<用途>` · `GateFix-Class-<id>` · `GateDyn-Event-<HHMM>` ·
`GateDyn-ES-<code>-<uid>-<HHMM>`（外部源）· `GateDyn-Class-<星期>-<id>-<HHMM>` ·
`GateDyn-CAD-<task>-<HHMM>`（cadence）。

**冻结含义**: 标签焊死在每台手机手工预建的闹钟里，改语法 = 全家设备重录。
演进只许**新增** `GateDyn-<新族>-`；既有格式动一字即破坏性变更。
**构造唯一入口 `domain/alarm-labels.js`**，代码任何其它位置不得拼标签字符串。

**时间为何必须进动态标签**（血泪教训，勿删）: iOS 快捷指令**没有"改现有闹钟时间"的动作**，
`Find Alarms where 名称 is <label>` 找到同名旧闹钟只能 Turn On，时间永不更新（静默失效）。
把时间编进 label → 改时间 = label 变 → 旧的被 sweep 关掉、新时间重建。**时间由网关拼**
（时区换算后的墙上时间），外部源 uid 永不含时间，正确性开关收在网关手里。

## 13. trace 结构化

`{ level: info|warn|error, plugin, ref, msg }`，出口渲染字符串；ref 用 token，msg 可用人类语言。

## 14. 预留与不留

留: `?device=`、`?platform=`（DEVICE-ABSTRACTION）、`ctx.sources` 开放数组（TeslaMate/MQTT）、
`/audit` `/timeline` 一等端点、pulse 类型、`todo` 通道 token、信封 `drift` 节（FEEDBACK-SELFHEAL）。
**不留**: 插件热加载、跨插件事件总线、多租户、实况回传同步。
**北极星（记录在案，不设计）**: 拖拽编排面向大众 = "配置生成器 + 事实控制台"纯前端，声明式架构已天然容纳；真正门槛在手机侧手工装配（快捷指令+预建闹钟）与多租户，维持不做。

## 15. 验收九条（每条不碰 kernel/ 才算收口）

| # | 变更 | 应落档位 |
|---|---|---|
| 1 | 新 scalar 字段 | 纯 config |
| 2 | 新 focus 类字段 | 纯 config |
| 3 | 新命名规则 | 新插件文件 |
| 4 | 新事实流 | POST /v2/fact + 插件 |
| 5 | 新设备 | PROFILES 一节 + 手机字典 |
| 6 | 新闹钟族 | 标签前缀 + 插件 |
| 7 | 新输入源 | ctx.sources 数组 |
| 8 | 新输出形态/通道 | pulse/channel token |
| 9 | 新周期任务 | CADENCE.TASKS 一节纯配置 |

> ✅ **第 3 条已完全成立**（2026-07-25）。此前 `kernel/audit.js` 与 `edge/assemble.js`
> 各有一张硬编码插件名单，使"非字段订阅型"插件（事实/闹钟集合/派生提醒）必须改内核。
> 现改为**插件自声明** `feeds: "fields"|"alarms"|"todos"|"plugins"`（`kernel/registry.js`），
> **内核与 edge 不再认识任何插件名**，且有契约测试盯着（塞回硬编码即失败）。

## 16. 测试纪律

node --test + 固定夹具（facts/日历/config），CI 即唯一"本地"；时间线纯函数 → golden 冻结对比；
kernel/intervals.js 必须先有测试后有消费者。
**交付含双轨（冻结+现役）的包，必须做"从入口全图解析"校验**——单测可能永不触及冻结路径的 import。

## 17. 开工序

```
⓪ 执行器可行性门禁                                        ← ✅ 全过（2026-07-16）
① kernel/intervals.js（零依赖）+ 测试                      ← ✅
② plugins/presence.js + plugins/quiet.js + 双模采样器      ← ✅ 三件套 = 契约验证
③ edge: /v2/state 接执行器契约（v1 冻结适配层并行挂载）     ← ✅
④ 其余插件搬家（wake-alarms / weekend-class / god-mode / restdays / school-break）← ✅
⑤ /v2/fact + ai_claude 任务（cadence 特例试点）            ← ✅
⑥ 设备抽象层重构                                          ← ✅ 2026-07-25
⑦ 规则原子化（三根轴 / 日型四轴 / 全 pulse / 门铃）        ← ✅ 2026-07-31
⑧ 回传自愈 → todo 通道 → cadence 泛化 → lib 提包           ← 见 [07-ROADMAP](07-ROADMAP.md)
```

> ⚠️ 本节是历史进度，最新状态以 [07-ROADMAP](07-ROADMAP.md) 为准。

## 17.5 两类铁律（政策 vs 不变量）

> **本节 v0.7 已裁决但此前漏写进本文**（BLUEPRINT v0.7 条目、HANDOFF §2.6、
> FEEDBACK-SELFHEAL 开篇均在引用它）。本次整理据上述三处补全。

系统里的规矩分两类，**混为一谈是架构腐坏的主因**：

| | **政策（policy）** | **不变量（invariant）** |
|---|---|---|
| 定义 | 当下选择这么做，换个想法就能改 | 违反了系统就不成立 |
| 例 | 07:40 解除安静；长假阈值 3 天；media_volume 归零 | 插件纯函数；单一 owner；云端不存实况 |
| 落点 | **config / 插件文件** | **kernel/ + 本文契约** |
| 改动成本 | 改一行，随时 | 改 = 修宪，需 Ivan 拍板 + DEVLOG 记录 |
| 判据 | "我明天想改回来会怎样？" → 没事 | → 别处会静默塌掉 |

**纪律**: 新规矩落地前先归类。政策绝不硬编码进 kernel/；不变量绝不藏在 config 里当"默认值"
（那等于把承重柱做成可拆的）。**看到某条规矩需要在两个地方同时改才生效，说明它归错类了。**

### 17.5.1 回传是事实，不是实况（本节最常被引用的一条）

手机回传的数据**只能作为"已发生的事件"进云端，绝不能作为"当前状态"参与决策**：

- ✅ **可进 KV**: "07:40 我把 silent 设成了 on，成功" —— 这是一条已完成的领域事件，
  时间戳固定、不会过期、审计价值高。
- ❌ **绝不进决策**: "手机现在是静音状态" —— 这是实况。KV 最终一致 + 网络延迟意味着
  云端看到的实况永远是过去时；拿它做决策会让控制回路震荡（云说该改→手机改→回传→云再判…）。

推论（三条，FEEDBACK-SELFHEAL 全文建立在此之上）：
1. **云端 diff 永远是 advisory（观点）**，本地 `last_applied` / 手机实际态永远是最终真相。
2. **云不可用 = 安全退回现状**（照旧本地对账），绝不因为云端说"该改"就盲改。
3. **守卫必须在执行时读本地实况**，云端不得代为判断。

---

## 18. 规范性术语表（防语义漂移的疫苗；新键名/新值先查表，查无先补表）

| 术语 | 精确定义 | 禁止的误用 |
|---|---|---|
| token | 全小写 snake_case 英文标识, 是**唯一权威值**, 参与比较与 last_applied | 本地化字符串当值 |
| `on` / `off` | 该字段能力的期望开/关状态（level 值, 非事件） | 当作"执行一次动作" |
| `null`（规则值） | 无主张三义: 缺失事实/字段压制/显式释放; 执行器: 不动手+LA写哨兵 | 表示"迟到""错误""0" |
| `none`（哨兵） | **仅存在于执行器 LA**, 表示"无有效记忆/无专注"; 永不出现在信封 | 写进云端任何字段 |
| `preset`（focus 值内） | 目标专注模式的 token（`do_not_disturb`/`sleep`…）。**v0.7 前叫 mode** | 写本机显示名 |
| `action`（focus 值内） | 期望的开关目标态 on/off | 一次性动作 |
| `action`（alarms.fixed 内） | 该预建闹钟的期望开关状态（对账目标） | 事件/触发指令 |
| `switch_to` | 保留: action 生效后应切换到的目标 preset token; 执行器未实装, 非 null 时可忽略但不得报错 | 自行发明语义 |
| `guards` | 字段级守卫数组, 全满足才执行; 拦截=跳过且不落账 | 放进 value 内部 |
| `source`（guard 内） | 实况来源 token: `current_focus` / `app` / `locked`（未来 charging/wifi/battery）。完整词表见 [01-CONCEPTS](01-CONCEPTS.md) §3.3.2 | 平台特有字符串 |
| `op`（guard 内） | `is` / `is_not` / `in` / `not_in`（未来 gt/lt）; in/not_in 的 value 必须数组 | contains 做集合判断 |
| `only_if_current` | **输入侧语法糖**, 服务端翻译成 guards 条目并从 value 移除 | 手机端去读它 |
| `from` | level 段的起始时刻, 采样归因("值来自哪个边界") | 事件发生时刻 |
| `at` | 点事件/变化边界/事实发生的时刻 | 段起点 |
| `generated_at` | 本次采样的"now"（信封时间戳） | 数据新鲜度保证 |
| `window` | 闹钟对账的采样期权限边界 (at+1分, at+24h] | 生产期概念 |
| `reconcile` | "现在适合执行昂贵对账"的调度提示 | 同步开关/数据一致性承诺 |
| `apply` | 执行策略。**信封**用 `on_change`/`enforce`；**配置**用 `always`/`if_changed`/`if_differs`（2026-07-29 起边界级） | 是否允许执行的权限 |
| `kind` / `channel` / `scope` | 开放枚举: 形态/输出通道/数据作用域 | 封闭校验拒绝未知值 |
| `severity` | **域声明的重要度**: critical/high/normal/low | 与 landing 混用 |
| `landing` | **落地形态**: urgent/alert/silent（severity 经源配置映射而来） | 与 severity 混用 |
| `todo` / `todos` | **网关侧**平台中性待办条目/通道 | 服务端出现 reminder |
| reminder | **手机侧**提醒事项实体（仅手机端文档使用） | 进服务端代码 |
| `platform` | 设备自报的平台 token（`ios`/`android`），决定下发哪张解析表 | 服务端维护注册表 |
| 值类型三法则 | 枚举→token 字符串; 数量→number; **真值→`"true"`/`"false"` 字符串** | 发 JSON 裸布尔 —— iOS 会渲染成「是」/「Yes」，手机端静默失败（CHANNELS §6.1） |
| ~~`i18n.*`~~ | 🗑️ **已删除（2026-07-25）** —— 由 `resolve` 取代，见 §7 第 2 条 | — |
| `resolve.*` | token → 本机标识的**候选名数组**；表名 = 守卫 `source` 名；由 `?locales=`/`?platform=` 下发 | 参与比较/写入 LA（比较用 `guards[].match[]`） |
| `shape`（边界值内） | `level` 电平 / `pulse` 脉冲，**边界级**（2026-07-29 新增） | 当成字段级属性 |
| `when`（规则内） | 日型条件，四轴 `morning/noon/eve/night` 取交集 | 写成字符串表达式 |

---

## 19. 数据结构附录（原 BLUEPRINT 各步骤钉死的 schema，提升为契约）

### 19.1 ctx 形状（插件的全部输入）

```js
ctx = {
  config,        // 深合并后的只读配置。config 键名(SCREAMING_SNAKE)不属于 API，
                 // 命名法只约束 API/JSON 输出 token
  profile,       // device 名，现恒 "default"
  calendars: [   // ⚠️ 日实例(day-resolved): edge/sources 已把 RRULE/跨天事件解算成逐日实例，
                 //    插件永不接触重复规则（最重要的边界决定）
    { date: "YYYY-MM-DD", title, description?,
      start_time: "HH:MM"|null, end_time: "HH:MM"|null, all_day: bool },
  ],
  workdays: [    // workdays-core 原始事实，跨度 ≥ range±16 天（块扫描需要）
    { date: "YYYY-MM-DD", off: bool, name: "" },
  ],
  facts: { streams: { <stream>: [事实...] }, degraded: [<stream>...] },
  schedules: {}, // 内核注入: 仅含已发布的 deps 产物（未裁剪）
}
```

### 19.2 schedule 值 schema（现役全表）

| schedule | owner | 粒度 | 值 |
|---|---|---|---|
| restdays | plugins/restdays.js | 日 | `{workday, named_holiday, rest, block}` |
| presence | plugins/presence.js | 日 | `{workday, rest, block, morning, noon, evening}`，区 token `work\|free\|leave\|out` |
| school_break | plugins/school-break.js | 日 | `{key, name} \| null` |
| god_mode | plugins/god-mode.js | 日 | `null \| {fixed, dynamic, quiet}`（见 GOD-MODE.md） |
| ~~quiet~~ | 🗑️ **已退役（2026-07-29）** | — | 决策逻辑搬进 `day_type` + 规则表 |
| **day_type** | plugins/day-type.js | 日 | `{morning, noon, eve, night}` 四根正交轴，见 [01-CONCEPTS](01-CONCEPTS.md) §4 |
| wake_alarms / weekend_class | 同名插件 | 日 | `{fixed: [label...], dynamic: [{label, time:"HH:MM", reason}], last_wake}`<br>`last_wake` = 当日最晚**起床**闹钟时刻，供规则锚定（2026-07-31 新增） |
| cadence_&lt;task&gt; | plugins/cadence.js（按 `CADENCE.TASKS` 生成） | 时刻边界 | `true \| false \| null` |

区 token 裁决优先级: **leave > out > 底色**（同区多事件并存时）。
产出跨度: restdays ±2 天 / presence ±1 天 / day_type 逐日（发布未裁剪，裁剪归 edge/assemble）。

### 19.3 信封（2026-07-27 冻结；手机端契约见 CONTRACT.md）

```json
{ "version": "2", "generated_at": "2026-07-27 07:41", "device": "default",
  "platform": "ios", "mode": "point", "range": { "start": "...", "end": "..." },
  "fields": {
    "focus":  { "kind": "focus", "apply": "on_change",
                "value": { "preset": "sleep", "action": "off", "switch_to": null },
                "from": "2026-07-27 07:40",
                "guards": [ { "source": "current_focus", "op": "in",
                              "value": ["sleep"], "match": ["睡眠", "Sleep"] } ] },
    "silent":       { "kind": "scalar", "apply": "on_change", "value": "off", "from": "..." },
    "media_volume": { "kind": "scalar", "apply": "enforce",  "value": 0,     "from": "..." }
  },
  "alarms": { "window": {...}, "sweep": "true", "fixed": [...], "dynamic": [...] },
  "resolve": { "current_focus": {...}, "app": {...}, "locked": {"true":["true"],"false":["false"]} },
  "trace": [ "[info] router/params: 收到参数[5]: ...", "..." ] }
```

**五条硬性质**（改动前先读 [03-CONTRACT](03-CONTRACT.md) 的四条形状法则）：

1. **point 与 segment 键集完全相同** —— 手机端读法恒定 `fields.<x>.value` + `.guards`，
   刺客与轮询共用同一批指令。`changes[]` 仅 `?debug=1` 下发。
2. **缺席 ≠ null** —— 字段不出现 = 此刻无指令（什么都不做）；`value: null` = 显式释放主张
   （手机端删 `last_applied`）。point 模式下未命中边界的字段整个缺席。
3. **零裸布尔** —— 真值一律 `"true"`/`"false"` 字符串（iOS 把 boolean 渲染成「是/Yes」，
   随语言漂移）。有一条全量扫描测试守着，新字段无法绕过。
4. **守卫预展开** —— `guards[].match[]` 是服务端按 `?platform=`/`?locales=` 展开好的
   本机比较集合；`value[]` 保留语义 token 供排查。手机端直接精确相等，不查表。
5. **`alarms.sweep` 是破坏性操作的授权位** —— `"true"` 才允许手机执行 sweep。
   降级信封或任一闹钟源失败时为 `"false"`（只加不关）。手机端判 `is true`，两侧 fail-closed。

**已退休**：`reconcile_alarms`（对账幂等，每轮都做）· `current_state`（值只有一个来源）·
`i18n` 节（与 `resolve` 是同一份数据的两种形状）。

**降级信封**：`error:"internal_degraded"` + `fields:{}` + `alarms.sweep:"false"` + HTTP **200**
（200 而非 500：手机拿到 500 会让整条同步失效；200 + 空状态让它安全地什么都不做）。

### 19.4 事实记录

```json
{ "at": "YYYY-MM-DD HH:MM", "id": "≤64字符幂等键",
  "type": "done|reset|set_next", "payload": {} }
```
`set_next` 需 `payload.at`。服务端附加 `received_at` / `colo`。

### 19.5 端点与参数总表

| 端点（`/v2` 前缀可选） | 方法 | 说明 |
|---|---|---|
| `/state` | GET | 采样（`?mode=segment\|point`，默认 segment） |
| `/timeline` | GET | 全时间线预览/审计（debug 常开: schedules + field_timelines） |
| `/fact` | POST | 写事实 |
| `/facts?stream=` | GET | 调试列取 |
| `/schema` | GET | ⬅ **待建**（RULE-TABLE §8）：原子/算子/字段/时刻的元数据，驱动 GUI |
| 根路径及其它 | GET | 一律走 `/state` |

参数: `?key=`（鉴权，另支持 `X-Gateway-Key` / `Bearer`）· `?date=YYYY-MM-DD`（锚日）
· `?now=HH:MM` · `?mode=` · `?device=` · `?locales=zh,en` · `?platform=ios`
· **`?apply=enforce`**（强制推平全部字段）· `?debug=1` · `?testEvents=` · `?skipCalendar=1`

> 💡 trace 里的 `router/params` 会回显**服务端实际收到的参数**——
> URL 混进不可见字符会污染参数名（实案：`locales` 收不到 → 专注开不起来），一眼可查。
