# KERNEL.md — alarm-api V12 内核契约（宪法层）

> 状态: **v0.6 定稿**（新增 §18 规范性术语表 + i18n 下发已实装）
> 前版:（契约2/4 增补"释放主张清除记忆"；新增契约15 中立规则原则）
> 前版:（2026-07-16 PHONE-FEASIBILITY 门禁 P1–P7 全部通过，A案升级为双语反查词典，B案退役未启用）。
> 本文档是 V12 的单一真相源。修改本文档 = 修改宪法，需在 DEVLOG 记录理由。

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
  - `pulse`: 点事件 `[{at, id, payload}]`。V12 仅定义类型；**首个实装场景 = notices（V13）**。
- **区间时间**【已裁决】: `from`/`at` = `"YYYY-MM-DD HH:MM"` **上海墙钟**（全生态上海锚定，复用 toShanghaiWall）。绝对时间戳，跨午夜天然连续，LOOKBACK 退役。
- **时间线范围**: `[昨天 00:00, 明天 24:00)` 三天滚动。
- **字段（field）= 手机能力的抽象**: focus / silent / media_volume / alarms / notices…。闹钟只是能力之一，**执行落点从不限于闹钟**（状态变更、通知、提醒均为字段）。
- **闹钟即状态**: `alarms` 字段 = "当前应启用的闹钟集合" S(t)，level 语义。手机对账 = diff(实际集合, S(t))；`reconcile_alarms` 仅为"何时执行昂贵对账"的调度提示。
- **事实（fact）vs 实况**: 事实 = 领域事件，可进 KV；实况 = 手机功能实际值（当前音量、当前 Focus 名），**永不进云端**。
- **profile（device）**: 配置维度，非租户。

---

## 2. 命名法（宪法级，破坏性重命名一次到位）

- **API/JSON/token 一律 snake_case 全称，禁缩写**（历史教训: dnd）。文件名 kebab-case。
- **枚举值 = 小写语义 token**: `on` / `off` / `do_not_disturb` / `sleep` / `work`…
- **人类语言只允许出现在 trace.msg 与 reason 类字段**，永不出现在键名、枚举值、MAP 输出。
- 破坏性重命名表（仅 /v2 生效）:

| 旧 (v1) | 新 (v2) | 说明 |
|---|---|---|
| schedule `dnd` | schedule **`quiet`** | dnd 只是 focus 的一种模式，原名不规范；quiet = "此刻手机该不该安静"的决策 |
| 值 `ON`/`OFF` | `on`/`off` | 全域统一 |
| `MODE_NAME: "Do Not Disturb"` | `mode: "do_not_disturb"` | 见契约13，Focus **名称**永不出云端 |
| MAP 输出 `"静音"/"响铃"` 类 | 必须 token（如 `on`/`off`） | 本地化下放执行器 |
| `sync_alarms` | `reconcile_alarms` | 语义为对账提示，非同步开关 |
| `adAlarms`/`exAlarms` 类遗留 | （calendar-api 已清理，此处对齐） | 全称原则 |

---

## 3. 十五条契约

1. **字段消费零依赖**。依赖只存在于生产 DAG（插件 deps），构建时解算完毕。
2. **null = 无主张**。永不表示"迟到了"。状态可迟到采样、漏采样，系统收敛。规则可显式产出 null 边界=**释放主张**（如长假白天）：既让手动状态自由存活，又使随后的重新主张（null→值）成为真变化——周期性重进（长假夜夜进安静）由此实现，无需 enforce。
3. **守卫附着于区间**，执行时评估。区间值可携带 `only_if_current`（值为 **token**），不满足则跳过本次、下个采样点再议。手动覆盖天然赢到下一边界。
4. **执行器必缓存 last_applied**。期望值没变，就不动手。所有字段的默认防线。**期望为 null 时删除 last_applied[字段]**——无主张=放下记忆，否则释放期后的重新主张会被旧缓存误判为"没变"。
5. **字段声明 apply 策略**【已裁决】: 默认 `on_change`；`enforce` 仅显式声明（当前**无字段**声明 enforce，media_volume 亦为 on_change）。加强守卫依赖读取能力，读不到只降级加强守卫。
6. **单一 owner**。每张 schedule 有且只有一个 owner 插件；跨插件影响走 deps。同插件区间重叠 = producer bug，拒收 + trace。
7. **纯度红线**。`produce(ctx, range)` 禁读时钟、禁 I/O；"now" 只在采样端。时间线 = `(inputs, config)` 纯函数 → golden 冻结、`?date=` 预览、按输入哈希缓存。
8. **三层叠加**: 插件 base → god-mode overlay → 字段 OWN。归一化：相邻同值合并；对象相等 = 规范序列化（CRC32 习惯）。
9. **fail 语义**。插件抛错 → 该 schedule 无主张 + trace 大字报；deps required/optional。fail-closed = **宁可不动手机，不可胡动**；保命项靠手机预建固定闹钟兜底。
10. **云端存事实，不存实况**。
11. **device 第一天生效**: 采样/事实 API 带 `?device=`；KV 命名空间 `fact:<device>:<stream>`；per-device 数据不进他人 ctx 与 trace。
12. **版本信封**: `{version, generated_at, range, fields, trace}`，双向未知字段容忍。
13. **语义 token 红线（本地化下放执行器）**: 云端 API **永不说手机 UI 语言**。Focus 显示名随系统语言变化（"Do Not Disturb"⇄"勿扰模式"）且可被用户自定义——属于**实况**。云端只输出 token；执行器持一张**双语反查词典 `本机名 → token`**（中英文条目一次性预载，实测表见 §7，冻结为执行器常量）。`Get Current Focus` 文本先反查成 token 再与 `only_if_current` 比对；空文本 = token `none`（"仅当无专注"守卫免费获得）。**换系统语言零改动**；新增自定义 Focus = 加一行（自定义名不随语言变）。快捷指令无原生"获取系统语言"动作，反查词典使检测本身成为多余。
14. **管理操作 = 纠偏事实**: 一切"重置/手动改时间/补记"不是新接口，而是往事实流写一条纠偏事件（`{type: reset|set_next|done, at, id}`）。纯度不破，审计轨迹免费，管理界面因此只是"事实控制台 + 时间线视图"这样一个纯客户端。

---

15. **中立规则原则（插件独立铁律）**: 消费者（字段或下游插件）只认**规则名**，不认生产者，更不认其他消费者；规则不属于任何消费者。silent 与 focus 共同订阅 quiet 是"声明决策同源"，不是依附——删除任何一方，另一方零感知；删除 quiet，双方各自安全落地为无主张。想"看一眼别的字段/插件现在的值" = 违宪信号，正确动作永远是把想看的东西升格为一张命名规则，让双方订阅。边界时刻相同，语义同源→USE 共享（改一处全跟），数字巧合→各自 OWN（互不牵连）；用巧合数字冒充共用是配置腐败。

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

内核职责（且仅此）：注册表加载 → deps 拓扑排序 → 校验（重叠/owner/悬空/孤儿）→ 归一化 → 发布 → 采样 → trace → 信封。

## 5. 字段订阅五旋钮 与 v2 字段清单

```
FIELDS.<field> = { KIND, USE, MAP, SKIP, OWN, APPLY }
```

| 字段 | KIND | 说明 |
|---|---|---|
| `focus` | focus 对象 | `{mode:token, action:on/off, switch_to, only_if_current:token}` |
| `silent` | scalar | `on`/`off` |
| `media_volume` | scalar | **整数 0–100**（手机读数为 0–1 浮点，执行器 ×100 取整后比较/设置）|
| `alarms` | 集合(level) | 期望 Gate 集合，执行器 diff 对账 |
| `notices` | pulse | V13 实装（cadence 通知通道） |
| `reconcile_alarms` | hint | 对账调度提示 |

## 6. 采样端

- point/segment 是同一份区间数据的两种问法，`?mode=` 决定；**插件不声明采样模式**。
- segment = 二分找最后一个 `from ≤ now`；point = 容差窗口内的值变化边界。
- point 容差【已裁决】: **过去3分 / 未来3分**（采样器参数，沿用）。
- `?device=` 必带；`?date=` 任意日期预览。

## 7. 执行器契约（PHONE.md 对接）

1. 采样 → 各字段期望 token。
2. **反查词典**（契约13，仅 focus 类需要）: `Get Current Focus` 文本 → token。冻结表（2026-07-16 实测）:

| en | zh | token |
|---|---|---|
| Do Not Disturb | 勿扰模式 | do_not_disturb |
| Sleep | 睡眠 | sleep |
| Personal | 个人 | personal |
| Work | 工作 | work |
| Driving | 驾驶 | driving |
| Reduce Interruptions | 减少干扰 | reduce_interruptions |
| (空) | (空) | none |
3. `期望 == last_applied[field]` → 跳过（on_change）。
4. `only_if_current` 且可读 → 执行时评估。
5. 动手成功 → 更新 last_applied。
6. alarms: diff 对账，`reconcile_alarms` 提示时全量。

## 8. 路由与迁移【已裁决】

- `/v1/*`: 旧逻辑**冻结**（薄适配层包住现 index.js 流程，只修 bug 不进化）。
- `/v2/*`: 新内核（本契约全部生效，含破坏性命名）。
- 默认路径指向由 config 开关**手动控制**；全部迁移后默认切 v2，v1 择日下线。

## 9. 事实端点

- `POST /fact` body `{stream, at, id, type?, payload?}`；`id` 幂等去重。
- KV: `fact:<device>:<stream>`。纠偏事件（契约14）走同一端点。
- 内核抓事实流注入 `ctx.facts`；缓存键含事实哈希。

## 10. cadence（周期任务超级插件，V13 主菜）

**裁决方向: 融入本框架，做成一个通用插件 + 任务纯配置；不另起系统**（另起 = 重复造 facts/采样/手机契约三件套）。ai_quota 不再是独立插件，而是 cadence 的第一个任务（步骤⑤先做特例试点，V13 泛化收编）。

```js
CADENCE.TASKS = {
  ai_claude:  { kind: "rolling_cooldown", cooldown: "5h", weekly_reset: "MO 08:00", channel: "alarm" },
  game_chest: { kind: "rolling_cooldown", cooldown: "7h", channel: "notification" },
  signin_x:   { kind: "ladder", steps: ["5m", "1h", "3h"], channel: "notification" },
};
```

- `kind` 开放枚举: `rolling_cooldown | weekly_reset | ladder | …`（新玩法 = 新 kind 实现，仍在插件层）。
- 任务状态 = 该任务的事实流（`done/reset/set_next` 事件），点错了就写纠偏事实（契约14）。
- `channel` = 输出路由到哪个手机能力字段: `alarm`（可靠，不依赖轮询即响铃，但污染闹钟列表、需对账）| `notification`（轻，仅执行器采样/自动化触发时可见）| `reminder`（占坑 token，未来接 iOS 提醒事项）。可靠性要求决定通道选择，权在任务配置。
- 每任务同时产出一个 level 字段（如 `ai_available: true/false`）供任何消费者查询。
- **管理界面** = Cloudflare Pages 纯前端（读 `/timeline` + 写 `/fact`），复用 otc-rate-suite 的 Pages+Worker 套路；对内核零侵入。

## 11. 文件去向表（含最终目录【已裁决】）

```
src/
  kernel/    intervals.js  fields.js  audit.js  registry.js
  plugins/   quiet.js  presence.js  wake-alarms.js  weekend-class.js
             god-mode.js  restdays.js  school-break.js  cadence.js(V13)
  edge/      router.js  auth.js  sources.js  assemble.js
  domain/    alarm-labels.js  grammar.js
  lib/       time.js  ics.js          ← 包形，稳定后 publish（calendar-api 是第二消费者）
  config.default.js  config.user.js  config.js（合并序: default → user → PROFILES.<device>）
```

| 现文件 | 去向 |
|---|---|
| device-state.js | kernel/intervals.js（**零依赖不 import CONFIG**）+ kernel/fields.js + kernel/audit.js |
| rules.js R1 | plugins/god-mode.js（overlay） |
| rules.js R4/R5 + ZONES | plugins/presence.js |
| rules.js R6 | plugins/quiet.js |
| rules.js R2 / R3 | plugins/wake-alarms.js / weekend-class.js |
| rest-days.js / school-break.js | plugins/restdays.js / school-break.js（shared） |
| ics-parser.js + toShanghaiWall 等 | lib/ics.js + lib/time.js |
| 标题词法 | domain/grammar.js（解析失败 = 无主张 + trace） |
| index.js esLabel | domain/alarm-labels.js |
| index.js 其余 | edge/*（v1 冻结适配层亦挂此处） |

## 12. Gate 标签契约（冻结）

既有格式（Gate-Fixed-*、Gate-Dynamic-*、Gate-ES-<code>-<uid>-<HHMM>）**冻结**；演进只许新增前缀族（如 Gate-AIQ-*）；构造唯一入口 domain/alarm-labels.js。标签是手机预建闹钟的焊死契约，改语法 = 全家设备重录。

## 13. trace 结构化

`{ level: info|warn|error, plugin, ref, msg }`，出口渲染字符串；ref 用 token，msg 可用人类语言。

## 14. 预留与不留

留: `?device=`、`/ack` 占坑、`ctx.sources` 开放数组（TeslaMate/MQTT）、`/audit` `/timeline` 一等端点、pulse 类型、`reminder` 通道 token。
**不留**: 插件热加载、跨插件事件总线、多租户、实况回传同步。
**北极星（记录在案，不设计）**: 拖拽编排面向大众 = "配置生成器 + 事实控制台"纯前端，声明式架构已天然容纳；真正门槛在手机侧手工装配（快捷指令+预建闹钟）与多租户，维持不做。

## 15. 验收九条（每条不碰 kernel/ 才算收口）

| # | 变更 | 应落档位 |
|---|---|---|
| 1 | 新 scalar 字段 | 纯 config |
| 2 | 新 focus 类字段 | 纯 config |
| 3 | 新命名规则 | 新插件文件 |
| 4 | 新事实流 | POST /fact + 插件 |
| 5 | 新设备 | PROFILES 一节 + 手机字典 |
| 6 | 新闹钟族 | 标签前缀 + 插件 |
| 7 | 新输入源 | ctx.sources 数组 |
| 8 | 新输出形态/通道 | pulse/channel token |
| 9 | 新周期任务 | CADENCE.TASKS 一节纯配置（V13） |

## 16. 测试纪律

node --test + 固定夹具（facts/日历/config），CI 即唯一"本地"；时间线纯函数 → golden 冻结对比；kernel/intervals.js 必须先有测试后有消费者。

## 17. 开工序

```
⓪ PHONE-FEASIBILITY 门禁                                   ← ✅ 全过（2026-07-16）
① kernel/intervals.js（零依赖）+ 测试                      ← ✅ 14 用例全绿
② plugins/presence.js + plugins/quiet.js + 双模采样器      ← 三件套 = 契约验证
③ edge: /v2/state 接 PHONE 契约（v1 冻结适配层并行挂载）
④ 其余插件搬家（wake-alarms / weekend-class / god-mode / restdays / school-break）
⑤ /fact + ai_claude 任务（cadence 特例试点，验证 facts/闹钟即状态/纠偏事实）
⑥ V13: cadence 泛化 + notices(pulse 实装) + Pages 管理前端
⑦ lib/ics + lib/time 提包 publish
```


## 18. 规范性术语表（防语义漂移的疫苗；新键名/新值先查表，查无先补表）

| 术语 | 精确定义 | 禁止的误用 |
|---|---|---|
| token | 全小写 snake_case 英文标识, 是**唯一权威值**, 参与比较与 last_applied | 本地化字符串当值 |
| `on` / `off` | 该字段能力的期望开/关状态（level 值, 非事件） | 当作"执行一次动作" |
| `null`（规则值） | 无主张三义: 缺失事实/字段压制/显式释放; 执行器: 不动手+LA写哨兵 | 表示"迟到""错误""0" |
| `none`（哨兵） | **仅存在于执行器 LA**, 表示"无有效记忆/无专注"; 永不出现在信封 | 写进云端任何字段 |
| `action`（focus 值内） | 期望的开关目标态 on/off | 一次性动作 |
| `action`（alarms.fixed 内） | 该预建闹钟的期望开关状态（对账目标） | 事件/触发指令 |
| `switch_to` | 保留: action 生效后应切换到的目标 mode token; v2 执行器未实装, 非 null 时执行器可忽略但不得报错 | 自行发明语义 |
| `from` | level 段的起始时刻, 采样归因("值来自哪个边界") | 事件发生时刻 |
| `at` | 点事件/变化边界/事实发生的时刻 | 段起点 |
| `generated_at` | 本次采样的"now"（信封时间戳） | 数据新鲜度保证 |
| `window` | 闹钟对账的采样期权限边界 (at+1分, at+24h] | 生产期概念 |
| `reconcile` | "现在适合执行昂贵对账"的调度提示 | 同步开关/数据一致性承诺 |
| `apply` | 执行策略 on_change/enforce（开放枚举） | 是否允许执行的权限 |
| `kind` / `channel` / `scope` | 开放枚举: 形态/输出通道/数据作用域 | 封闭校验拒绝未知值 |
| 值类型三法则 | 枚举→token 字符串; 数量→number; 真值→boolean | 布尔写成 "true" 字符串 |
| `i18n.focus_name_to_token` | 显示名→token 反查表, **显示层数据**; 由 ?locales= 请求下发 | 参与比较/写入 LA |
