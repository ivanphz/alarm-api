# RULE-TABLE.md — 规则表重构（设计定稿，待实施）

> **状态**: 设计定稿，**尚未实施**。这是一次**破坏性重构**（Ivan 已明确接受）。
> **信封形状不变 → 手机端零改动**（`docs/CONTRACT.md` 与 `docs/PHONE.md` 一个字不用改）。
>
> **实施前必读**: `KERNEL.md`（宪法）· `HANDOFF.md` §2 不变量 · `HORIZON.md` §1（网页配置愿景与红线）
>
> **给实施会话的话**: 本文是完整规格。设计决策与被否决的方案都写在里面了，
> **不要重新论证**；如果你想改设计，先读 §9「已否决的方案」，那里多半有答案。

---

## 1. 为什么改

### 1.1 现在的模型写不出一条真实需求

需求：**媒体音量在 07:40（不分工作日/休息日）、13:29（仅工作日）、夜间 都归零**。

当前 `media_volume` 的配置形态：
```js
media_volume: { KIND:"scalar", USE:"quiet", MAP:{on:0, off:null}, APPLY:"on_change", OWN:{} }
```
实测产出（周五工作日）：
```
07:40 → null   ← 需要 0
12:15 → 0
13:29 → null   ← 需要 0，且只在工作日
22:25 → 0
```

`OWN: {"13:29": 0}` 能设值，**但 `OWN` 没有日型条件** —— 周末也会平白多出一个 13:29 边界。
**这不是风格偏好，是表达力缺口。**

### 1.2 可读性也是真问题

`silent: { KIND:"scalar", USE:"quiet", SKIP:["12:15","13:29"], APPLY:"on_change", OWN:{} }`

要读懂它，得先知道 `quiet` 是什么、它怎么算出来的、`MAP`/`SKIP`/`OWN` 三者如何交互。
而使用者的问题只是「**07:40 到底发生了什么**」——现在没有任何地方能直接回答。

### 1.3 未来方向要求它

`HORIZON.md` §1 已写死：
> "RULEBOOK 已定义'事实词汇表' —— **网页 UI 的条件下拉就是对这张表的可视化**。"

即：**这张表将来要被 GUI 渲染成下拉框**。这对设计提出了硬要求（见 §2）。

---

## 2. 设计约束（不可违反）

| # | 约束 | 来源 |
|---|---|---|
| C1 | **信封形状一个字节不变**，手机端零改动 | 本次重构的前提 |
| C2 | **原子必须自带 schema**（类型/值域/标签），因为 GUI 的条件下拉直接渲染它 | HORIZON §1 |
| C3 | **原子由插件自声明**，内核不持有任何原子名单 | 同 `feeds` 的手法；验收九条 #3 |
| C4 | **谓词是数据不是代码**（结构化对象，非字符串表达式） | GUID 要能双向读写；且与 guards 的 `{source,op,value}` 同构 |
| C5 | **DSL 不追求图灵完备**，覆盖八成场景，剩两成保留"写插件"逃生门 | HORIZON §1 红线（Ivan 早已定死） |
| C6 | **事实层永远是代码**（碰撞/块扫描/god 解析），DSL 只做「条件 → emit」 | 同上 |
| C7 | 不碰 `kernel/intervals.js`、`kernel/registry.js`、`kernel/audit.js` 的既有契约 | 不变量 |

---

## 3. 四层结构

```
① 原子层   插件自声明的【日级事实】+ schema           ← 代码算（C6）
② 日型层   命名的【结构化谓词】，组合原子，可互相引用   ← 纯数据  ｜ 回答"什么时候"
③ 效果层   命名的【字段效果组】，可引用可局部覆盖       ← 纯数据  ｜ 回答"做什么"
④ 规则表   (时刻, 日型) → 效果组                       ← 纯数据  ｜ 把两者接起来
```

**②③ 都是"原子 → 命名组合"的同一手法**，与 `edge/resolve.js` 的 App 表
（原子 `APPS` + 类别 `GROUPS`）也同构 —— 全项目一套心智，不用学三遍。

---

## 4. ① 原子层

### 4.1 插件自声明

在插件对象上加 `atoms`（与 `feeds` 并列）：

```js
// src/plugins/restdays.js
export default {
  name: "restdays",
  kind: "level",
  scope: "shared",
  feeds: "plugins",
  atoms: {
    workday:       { type: "bool",         label: "上班日" },
    rest:          { type: "bool",         label: "休息日" },
    named_holiday: { type: "string|null",  label: "法定节假日名" },
    block:         { type: "int",          label: "连休块长度(天)", hint: "≥3 视为长假" },
    workday_index: { type: "int",          label: "本工作段第几天", hint: "1 = 节后首日" },
    rest_index:    { type: "int",          label: "本连休块第几天" },
  },
  produce(ctx, range) { /* 现有逻辑 + 新增两个 index，见 4.3 */ },
};
```

**取值约定**：原子名 = 该插件**日级产物对象的键名**。
若要换个对外名字（避免撞名），用 `from`：

```js
// src/plugins/presence.js
atoms: {
  zone_morning: { from: "morning", type: "enum",
                  values: ["work", "free", "leave", "out"], label: "上午所在区" },
  zone_noon:    { from: "noon",    type: "enum", values: [...], label: "午间所在区" },
  zone_evening: { from: "evening", type: "enum", values: [...], label: "晚间所在区" },
},
```
> `presence` 也产 `workday/rest/block`（转录自 restdays），**不要重复声明为原子**，
> 否则撞名。撞名 → 由 `kernel/audit.js` 报 error（见 §8）。

### 4.2 schema 字段

| 键 | 必填 | 说明 |
|---|---|---|
| `type` | ✅ | `bool` / `int` / `string` / `string\|null` / `enum` |
| `label` | ✅ | 人话标签，**GUI 下拉直接显示** |
| `values` | enum 必填 | 允许值数组 |
| `values_from` | 选 | 值域来自配置路径（如 `SCHOOL_BREAK` 的 key 集合），GUI 动态渲染 |
| `from` | 选 | 该原子在插件日级产物里的键名（缺省 = 原子名本身） |
| `hint` | 选 | 补充说明，GUI 显示为提示 |

### 4.3 ⚠️ 命名审查（动工前必须改，否则错到处扩散）

核对现有插件后发现**一处真正的命名错误**：

```
restdays 注释原文：
  workday: 法定要不要上班
  rest:    实际在休息（法定休 OR 全天 leave）
```

**这两个不是互补的** —— 全天请假那天，`workday=true` 且 `rest=true`。
但名字看起来像非此即彼，照它写规则必然出错。**这是"字段性错误"，改名成本随时间指数上升。**

**定名表（本次一次到位，之后冻结）**：

| 旧名 | 新名 | 类型 | 含义（label） |
|---|---|---|---|
| `workday` | **`work_scheduled`** | bool | 按法定/调休/排班，今天**该上班** |
| `rest` | **`resting`** | bool | 今天**实际在休息**（法定休 或 全天请假）⚠️ 与上一条**不互斥** |
| `block` | **`rest_block_length`** | int | 所在连休块**总天数**（0 = 不在休息块） |
| `named_holiday` | **`holiday_name`** | string\|null | 法定节假日名 |
| — | **`rest_block_index`** | int | 连休块内**第几天**，1 起；**负数从末尾**（-1 = 最后一天） |
| — | **`work_streak_length`** | int | 所在连续上班段**总天数** |
| — | **`work_streak_index`** | int | 上班段内**第几天**；**负数从末尾**（-1 = 最后一个工作日） |
| — | **`weekday`** | enum 0–6 | 星期几（0=周日），编译器内置 |

**长度与序号用不同的词**（`length` / `index`），避免 `block_day` 这种一眼分不清的命名。

### 4.4 负索引

`-1` = 段内最后一天，`-2` = 倒数第二天。于是：

| 想表达 | 谓词 |
|---|---|
| 节后第一个工作日 | `{ work_streak_index: 1 }` |
| **长假后**第一个工作日（区别于普通周末后） | `{ work_streak_index: 1, prev: { rest_block_length: { gte: 3 } } }` |
| 长假最后一天 | `{ resting: true, rest_block_index: -1 }` |
| 节前最后一个工作日 | `{ work_streak_index: -1 }` |
| 上班段第二天 | `{ work_streak_index: 2 }` |

> ⚠️ **负索引的正确性依赖"整个块可见"**。`restdays` 现在扫 ±16 天；
> 若某个块延伸到扫描窗口之外，**负索引必须报 warn 并按无主张处理，绝不给一个错的数**。
> 编译器要显式检查块边界是否落在扫描窗口内（RULE-TABLE 验收项）。

### 4.5 值域声明（GUI 下拉的数据源）

`school_break` **已经分开了**（`SCHOOL_BREAK.RANGES[].key` = `summer`/`winter`/`spring`/`autumn`），
`{ school_break: "summer" }` 当前就能表达。要补的只是让 schema 声明值域：

```js
school_break: { type: "enum", values_from: "SCHOOL_BREAK.RANGES[].key",
                nullable: true, label: "寒暑春秋假" },
```

`values_from` = 配置路径，`/v2/schema` 求值后下发实际值域 →
**你在 config 里加一个 `spring`，GUI 下拉自动多一项，前端零改动。**

## 5. ② 日型层

### 5.1 形态

```js
// config.default.js
DAY_TYPES: {
  工作日:       { workday: true },
  休息日:       { workday: false },
  工作日首日:   { workday: true, workday_index: 1 },
  长假中:       { rest: true, block: { gte: 3 } },
  节前一天:     { workday: true, next: { workday: false } },
  次日上班:     { next: { workday: true } },
  次日休息:     { next: { workday: false } },
  周六非寒暑假: { weekday: 6, school_break: null },
  周六寒暑假:   { weekday: 6, school_break: { not: null } },
  上午请假:     { zone_morning: "leave" },
  工作日非长假: { is: "工作日", rest: false },        // 引用另一个日型
}
```

### 5.2 语义

- **对象** = 所有键 AND
- **数组** = 任一元素成立即成立（OR）
- **`is: "<日型名>"`** = 引用另一个日型，与同级其余键 AND；**禁止循环引用**（audit 报错）
- **裸值** = 相等
- **算子对象**（封闭集合，GUI 渲染成下拉）：

| 算子 | 适用类型 | 说明 |
|---|---|---|
| `eq` | 全部 | 与裸值等价，显式写法 |
| `not` | 全部 | 不等于 |
| `in` / `not_in` | 全部 | 值必须是数组 |
| `gte` / `lte` / `gt` / `lt` | int | 数值比较 |

> **算子集合与 guards 保持同一套心智**，但**不共用实现**：guards 在手机端求值、
> 日型在服务端求值。两边各自封闭校验，未知算子**响亮报错**，绝不静默放行。

### 5.3 `weekday` 从哪来

`weekday`（0=周日…6=周六）不属于任何插件，由**编译器直接从日期算**，
作为内置原子登记进 schema（`label: "星期几"`, `type: "enum"`, `values: [0..6]`）。

---

### 5.4 ⚠️ 矛盾检测（靠猜是猜不出来的）

**不能靠静态推理判断两个原子互斥** —— 反例就在眼前：`work_scheduled` 与 `resting`
看着互斥，实际全天请假时同时为真。**引擎无从知道哪些组合不可能。**

所以用两条机制，各管一类：

| 机制 | 抓什么 | 级别 |
|---|---|---|
| **区间自矛盾**（静态） | 同一原子的数值约束不可能同时成立，如 `{rest_block_length:{gte:5, lte:3}}`；enum 值不在 `values` 里；类型不匹配（对 bool 用 `gte`） | **error** |
| **空匹配探测**（动态） | 把该日型在**一个足够宽的日期窗**（建议 ±400 天）上求值一遍，**一次都没命中** → 多半是拼错原子名或写了不可能的组合 | **warn**，附"检查了哪些天" |

空匹配探测比静态分析更管用：**它连拼写错误一起抓**（`work_scheduld: true` 静态看不出问题，但永远不命中）。

> 想显式声明互斥？可以在原子 schema 里写 `conflicts_with: ["xxx"]`，
> 但**这是可选的人工标注，不是引擎的推断依据** —— 没标不代表兼容，标了才报错。

---

### 5.5 效果组合（字段绑定）

字段效果也要能组合 —— 「进入安静」这件事天然是 silent + focus + media_volume 三个一起动。
若每条规则各写三行，改一处要改多处（正是契约15 要防的）。

```js
// config.default.js
EFFECTS: {
  进入安静: {
    silent:       { value: "on" },
    focus:        { action: "on" },
    media_volume: { value: 0 },
  },
  解除安静: {
    silent:       { value: "off" },
    focus:        { action: "off", guard: "sleep" },
    media_volume: { value: 0, apply: "enforce" },   // 解除时也归零（本次新需求）
  },
  白天释放: {
    silent:       { value: null },     // null = 显式释放主张
    focus:        { action: "off", guard: "sleep" },
    media_volume: { value: null },
  },
}

RULES: [
  { at: "NIGHT_ON_WORKDAY_EVE", days: "次日上班", use: "进入安静" },
  { at: "NIGHT_ON_REST_EVE",    days: "次日休息", use: "进入安静" },
  { at: "MORNING_OFF_WORKDAY",  days: "工作日",   use: "解除安静" },
  { at: "MORNING_OFF_WEEKEND",  days: "休息日",   use: "解除安静" },
  { at: "NOON_OFF", days: "工作日", use: "解除安静",
    set: { focus: null } },            // ★ 组合 + 局部覆盖：午休解除不碰 focus
]
```

**语义**：
- `use: "<效果名>"` 引入整组；也可 `use: ["A","B"]` 依次叠加
- `set: {...}` 在其上**局部覆盖或补充**
- `set: { <字段>: null }` = **从本条规则里移除该字段**（不是"释放主张"，
  释放主张是 `{ value: null }`）—— ⚠️ 这两个写法必须在实现里严格区分，
  与信封的「缺席 ≠ null」是同一条法则的第三次出现
- 效果组可互相引用：`{ use: "进入安静", set: {...} }` 也能作为 `EFFECTS` 的一项

**这一层同时解决了「时间挂事件 vs 事件挂时间」的取舍**：
条件写在组头（每组一次），效果引用命名组（改一处全跟），两边的好处都拿到了。

---

## 6. ③ 规则表

### 6.1 形态：**时间挂事件**

```js
RULES: [
  { at: "MORNING_OFF_WORKDAY", days: "工作日", set: {
      media_volume: { value: 0, apply: "enforce" },
      focus:        { action: "off", guard: "sleep" },
      silent:       { value: "off" },
  }},
  { at: "MORNING_OFF_WEEKEND", days: "休息日", set: {
      media_volume: { value: 0, apply: "enforce" },
      focus:        { action: "off", guard: "sleep" },
      silent:       { value: "off" },
  }},
  { at: "NOON_ON",  days: "工作日", set: { silent:{value:"on"}, media_volume:{value:0} }},
  { at: "NOON_OFF", days: "工作日", set: { silent:{value:"off"}, media_volume:{value:0, apply:"enforce"} }},
  { at: "NIGHT_ON_WORKDAY_EVE", days: "次日上班", set: {
      silent:{value:"on"}, focus:{action:"on"}, media_volume:{value:0} }},
  { at: "NIGHT_ON_REST_EVE",    days: "次日休息", set: {
      silent:{value:"on"}, focus:{action:"on"}, media_volume:{value:0} }},
  // 长假白天释放主张（value:null = 显式释放，与"字段不在 set 里"语义不同，见 6.3）
  { at: "MORNING_OFF_WORKDAY", days: "长假中", set: {
      silent:{value:null}, focus:{action:"off"}, media_volume:{value:null} }},
]
```

### 6.2 为什么是「时间挂事件」而不是「事件挂时间」

| | 时间挂事件（选用） | 事件挂时间（否决） |
|---|---|---|
| 日型条件 | **每组写一次** | 每个字段重写一遍 → 改条件要改 N 处（契约15 要防的） |
| 与执行模型 | **同构**（刺客在 07:40 问"此刻该干什么"） | 需要人脑做一次转置 |
| "某字段的完整故事" | 打散 | 集中 |

后者的劣势**由派生视图消除**：同一份数据服务端可同时渲染两种排序，
`/timeline` 增加 `rules_by_field` 索引即可。**书写用一种形式，查看两种都有。**

### 6.3 `set` 内的字段效果

| 键 | 适用 | 说明 |
|---|---|---|
| `value` | scalar | 目标值。**`null` = 显式释放主张**（手机端删 last_applied） |
| `action` | focus | `on` / `off` |
| `preset` | focus | 缺省取字段的 `PRESET` |
| `guard` | 全部 | 单值语法糖 → `{source:"current_focus", op:"in", value:[x]}`；多值写 `guards: [...]` |
| `guards` | 全部 | 完整守卫数组（时点作用域） |
| `apply` | 全部 | `on_change`（缺省） / `enforce`。**★ 逐条生效，不是整个字段一直 enforce** |

⚠️ **两条必须区分（与信封的「缺席 ≠ null」同一条法则）**：

| 写法 | 含义 | 编译产物 |
|---|---|---|
| 字段**不出现**在 `set` 里 | 此刻不碰这个字段 | 不产生边界 |
| `{ value: null }` | **显式释放主张** | 产生边界，值为 null |

### 6.4 `at` 引用命名时刻

`at` 取 `DND.*` 的键名（`MORNING_OFF_WORKDAY` 等），编译器解析成 `HH:MM`。
**改时间只动 `DND` 一处**。也允许直接写 `"07:40"`（逃生门），但 audit 会提示优先用命名。

⚠️ **所有出现在规则表里的时刻，必须在 `DND.WHITELIST` 内**（手机端需有对应的边界刺客），
否则 audit 报 warn（沿用现有 `auditQuietWhitelist` 的判据）。

---

## 7. 编译器

新增 `src/kernel/daytypes.js` + `src/kernel/rules.js`（或合并成一个 `compile.js`）。

### 7.1 职责

```
输入: ctx（各插件已发布的 schedules）+ config.DAY_TYPES + config.RULES + config.DND
输出: 与现在 buildFieldTimelines 完全相同形状的 field timelines
```

流程：

1. **原子快照**：为 `range` 内每一天（前后各外扩 1 天，供 `next`/`prev`）
   从各插件的日级产物 + `weekday` 组装一份 `{原子名: 值}`。
2. **日型求值**：对每一天，算出它命中哪些 `DAY_TYPES`（结果进 trace，见 §8）。
3. **规则展开**：逐天遍历 `RULES`，`days` 命中则在 `at` 解析出的时刻为 `set` 里
   每个字段产生一条边界。
4. **god-mode 覆盖**：命中日**整体替换**该日的规则产物（现有 god_mode 插件产物照用）。
5. **归一化**：交给现有 `kernel/intervals.js` 的合并逻辑，不重写。

### 7.2 冲突处理

同一天、同一时刻、同一字段被多条规则命中 → **响亮报错**（trace `error` + 该字段该刻无主张）。
**不做优先级、不做后写覆盖** —— 静默择一是最难查的一类 bug。
需要"例外"就把条件写窄（用 `is` 组合），这是 C5 的必然结果。

### 7.3 与现有插件的关系

- `restdays` / `presence` / `school_break` / `god_mode` —— **保留**，它们是事实层（C6）。
- `quiet` 插件 —— **退役**。它的决策逻辑（20:55 vs 22:25、长假释放、请假区）
  全部translate成 `DAY_TYPES` + `RULES`。
- `wake_alarms` / `weekend_class` / `cadence_*` —— **保留**（产闹钟，不走字段渲染）。
- `kernel/fields.js`（五旋钮 USE/MAP/SKIP/OWN/APPLY）—— **删除**，由规则表取代。

---

## 8. `/v2/schema` 端点（GUI 的数据源）

```
GET /v2/schema
→ { atoms:      { <name>: {type,label,values?,hint?,plugin} },
    operators:  ["eq","not","in","not_in","gte","lte","gt","lt"],
    day_types:  { <name>: <谓词原文> },
    times:      { <DND键名>: "HH:MM" },
    fields:     { <字段名>: {kind, accepts:[...]} },
    guard_sources: ["current_focus","app","locked"] }
```

**前端是通用渲染器，不认识任何具体原子。** 加原子 = 插件加一行声明 → 端点自动多一项 → GUI 自动多一个下拉选项。

### 8.1 audit 新增校验

| 检查 | 级别 | 说明 |
|---|---|---|
| 原子名撞名（两个插件声明同名） | error | 必须用 `from` 改名 |
| 日型引用了不存在的原子 | error | 拼写错误会静默永不命中 |
| 日型循环引用（`is` 成环） | error | — |
| 未知算子 | error | 封闭集合 |
| 规则的 `at` 不在 `DND.WHITELIST` | warn | 手机端没有对应刺客 = 空发 |
| 同刻同字段多规则命中 | error | 见 7.2 |
| 某日型从未被任何规则引用 | warn | 死配置 |

### 8.2 诊断输出

`/v2/timeline` 增加：
- `day_types`: 每天命中的日型列表 —— **"为什么这条规则没生效"一眼可查**
- `rules_by_field`: 按字段排序的规则索引（§6.2 的派生视图）

---

### 8.5 预留：排班插件（大小周 / 早中晚班 / 智能排班）

**本次不实现，但形状现在就定死** —— 因为它是检验「原子自声明」到底成不成立的**第一个真实用例**：
如果加排班需要改内核或改前端，那这套设计就是失败的。

### 8.5.1 它是一个新插件，不是 DSL 特性

排班算的是**事实**（今天该不该上班、上什么班），按 C6「事实层永远是代码」，
它是 `src/plugins/roster.js`，产日级事实并**自声明原子**：

```js
export default {
  name: "roster", kind: "level", scope: "shared", feeds: "plugins",
  atoms: {
    shift:              { type:"enum", values_from:"ROSTER.SHIFTS", nullable:true,
                          label:"班次", hint:"off/early/mid/late… 由配置定义" },
    roster_cycle_index: { type:"int",  label:"排班周期内第几天", hint:"1 起，负数从末尾" },
    roster_name:        { type:"string|null", label:"当前生效的排班方案名" },
  },
  produce(ctx, range) { /* 见 8.5.2 */ },
};
```

**加了它之后**：内核零改动、`/v2/schema` 自动多出三个原子、GUI 下拉自动多三项、
规则表可以直接写 `{ shift: "late" }`。**这就是验收标准。**

### 8.5.2 配置形状（分段锚定 + 单日覆盖）

```js
ROSTER: {
  SHIFTS: ["off", "work", "early", "mid", "late"],   // 值域，GUI 下拉直接读
  SEGMENTS: [
    // 每段一个锚点日 + 一个循环模式。中途改排班 = 追加一段，【历史不变、可回放】
    { from: "2026-01-01", name: "双休",
      cycle: ["work","work","work","work","work","off","off"] },
    { from: "2026-07-01", name: "大小周",
      cycle: ["work","work","work","work","work","work","off",     // 单休周
              "work","work","work","work","work","off","off"] },   // 双休周
    { from: "2026-10-01", name: "三班倒",
      cycle: ["early","early","mid","mid","late","late","off","off"] },
  ],
  OVERRIDES: { "2026-08-15": "off", "2026-08-16": "late" },   // 单日改排，最高优先
}
```

- **锚定**：`cycle_index = (该日 - segment.from) mod cycle.length`，锚点日即 index 0
- **分段**：取 `from ≤ 今天` 的最后一段。**改排班只追加，不修改旧段** →
  查历史某天时结果与当时一致（时间线是 `(inputs, config)` 纯函数，契约7）
- **单日覆盖** > 分段循环

### 8.5.3 ⚠️ 与法定节假日的优先级（现在就要定）

排班说上班、法定说放假 —— 谁赢？**必须在实现前裁决，别让它变成"看代码顺序"。**

建议（待 Ivan 确认）：

| 情形 | 结果 | 理由 |
|---|---|---|
| 法定节假日 且 排班=work | `work_scheduled = false` | 法定假日优先，不上班 |
| 法定调休补班 且 排班=off | `work_scheduled = true` | 调休补班是法定要求 |
| 平日 | 排班说了算 | — |
| `ROSTER.OVERRIDES` 命中 | **覆盖以上全部** | 手工改排是最终意志 |

即：`OVERRIDES > 法定 > 排班循环`。
`shift` 原子仍保留排班原值（用于「今天本该上晚班但放假了」这类判断）。

### 8.5.4 未做但已预留的钩子

- `roster_cycle_index` 支持负索引（同 §4.4），一次覆盖"循环最后一天"这类需求
- `SHIFTS` 是开放枚举，加班次 = 加一个值，无需改码
- 若将来要"间隔 N 天放假"这种非固定循环，那是 `cycle` 之外的新 kind ——
  **届时在 roster 插件内部加，仍不动内核**（同 cadence 的 kinds 库手法）

---

## 9. 已否决的方案（别重新论证）

| 方案 | 否决理由 |
|---|---|
| 字符串表达式 `"workday && block>=3"` | 要写解析器；GUI 无法双向读写；与 guards 的结构化形态不一致 |
| 枚举式日型（把"工作日第二天"当独立日型） | 字段爆炸。`workday_index` 一个原子解决整族 |
| 事件挂时间（field 为主键的扁平行） | 日型条件要在每个字段重写；见 §6.2 |
| 规则优先级 / 后写覆盖 | 静默择一最难查；改用"冲突即报错 + 把条件写窄" |
| 内核持有原子名单 | 违反 C3；加插件要改内核 |
| 保留 `quiet` 插件与规则表共存 | 同一决策两个来源，必然漂移。要么全走规则表 |
| DSL 支持函数/循环/自定义算子 | C5 红线：解释器会长成第二个内核 |
| 靠静态推理判断原子互斥 | 推不出来。反例：`work_scheduled` 与 `resting` 在全天请假日**同时为真**。改用§5.4 的两条机制 |
| 排班做成 DSL 特性 | 它是事实层（C6），必须是插件。做成 DSL 特性 = 内核长出业务语义 |
| 改排班时修改旧 SEGMENT | 破坏"时间线是纯函数"（契约7），历史查询结果会变。只许追加新段 |

---

## 10. 迁移清单

- [ ] `restdays` 增加 `workday_index` / `rest_index`（§4.3）+ `atoms` 声明
- [ ] `presence` / `school_break` / `god_mode` 增加 `atoms` 声明
- [ ] `weekday` 内置原子（编译器提供）
- [ ] 新增 `kernel/daytypes.js`（谓词求值）+ `kernel/rules.js`（规则展开）
- [ ] `config.default.js` 新增 `DAY_TYPES` + `RULES` 段
- [ ] **把现有 `quiet` 插件的全部行为翻译成 `DAY_TYPES` + `RULES`**（最容易漏的一步，见 §11）
- [ ] 删除 `kernel/fields.js` 与 `config.V2.FIELDS` 的五旋钮
- [ ] `edge/assemble.js` 改为消费规则表编译产物（**信封组装代码不动**）
- [ ] 新增 `/v2/schema` 端点 + `/v2/timeline` 的 `day_types` / `rules_by_field`
- [ ] `kernel/audit.js` 新增 §8.1 的七项校验
- [ ] 文档同步：`KERNEL.md` §5（五旋钮退役）· `RULEBOOK.md`（改法全变）· `HORIZON.md` §1（愿景落地一半）

---

## 11. 验收标准

### 11.1 ★ Golden 快照对比（最重要的一条）

**重构前**先跑一批日期，把 `/v2/state` 与 `/v2/timeline` 的输出存成 golden：

```
工作日 / 周末 / 长假第1天 / 长假中 / 长假末日 / 节后首个工作日 /
调休上班的周六 / 寒暑假期间的周六 / 请假日 / 出差日 / god-mode 接管日
× 各自的 6 个白名单时刻 × segment 与 point 两种模式
```

**重构后必须逐字节一致**，唯一允许的差异是本次**故意新增**的规则
（`media_volume` 在 07:40 / 13:29 归零）。

> 这是破坏性重构唯一可靠的安全网。**先建 golden，再动代码。**

### 11.2 其余

- [ ] `node --test` 全绿，且新增：原子快照 / 谓词求值（含每个算子的反例）/ `next`·`prev` /
      日型引用与循环检测 / 规则展开 / 冲突报错 / 缺席 vs null
- [ ] **信封形状零变化** —— `CONTRACT.md` 与 `PHONE.md` 一个字不用改；
      现有那条"信封零裸布尔"全量扫描测试继续通过
- [ ] 不碰 `kernel/intervals.js` / `registry.js` 的既有契约（C7）
- [ ] `/v2/schema` 能完整驱动一个"假前端"：只读该端点就能列出全部原子、算子、字段与值域
- [ ] 新需求验证：`media_volume` 在 07:40（全天型）与 13:29（仅工作日）确实归零且 `apply=enforce`
- [ ] **命名迁移完成**：`workday`→`work_scheduled`、`rest`→`resting`、`block`→`rest_block_length`
      全库无残留（含注释与文档）
- [ ] **负索引边界**：块延伸到扫描窗口外时报 warn 且不给错值（§4.4）
- [ ] **矛盾检测**：区间自矛盾报 error；空匹配日型报 warn 并列出检查窗口（§5.4）
- [ ] **效果组合**：`use` + `set` 局部覆盖；`set:{字段:null}` 移除 与 `{value:null}` 释放主张
      两者行为不同且各有用例
- [ ] **排班可插性验证**（不实现，但要能论证）：照 §8.5 加 `roster.js` 后，
      内核 diff 为零、前端零改动、`/v2/schema` 自动多出三个原子

---

## 12. 一句话总结

**把"字段订阅命名规则"换成"(时刻, 日型) → 字段效果"，
原子由插件自声明并自带 schema，日型是可组合的结构化谓词，
GUI 只读 `/v2/schema` 就能渲染 —— 加任何新模块，内核与前端都零改动。**
