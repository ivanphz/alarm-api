# GOD-MODE.md — 上帝模式（日历接管当天）

> 一句话：在日历里建一个事件，标题命中关键字、备注写一段 JSON，就能**完全接管当天**——
> 常规规则（工作日/放假/请假/上课判定）全部旁路，当天只按你手写的 JSON 执行。
>
> **现役功能**，实现见 `src/plugins/god-mode.js`（v1 时代的 R1 规则）。
> 本文已翻译到 v2 坐标（标签前缀、JSON 词汇、验证入口）；**v1 旧词汇永久兼容**，
> 你日历里已有的老事件不用重打。

---

## 1. 怎么触发（两个硬条件，缺一不可）

### 条件 A：事件标题命中 GOD_MODE 关键字

关键字在 `config.KEYWORDS.GOD_MODE`，默认 `["上帝模式", "JSON"]`。
标题先做归一化（全角空格→普通空格、去首尾空白），然后按两种方式判定命中：

| 判定方式 | 命中的标题示例 | 不命中的标题示例 |
|---|---|---|
| ① 整个标题**恰好等于**关键字 | `上帝模式` / `JSON` | `今天上帝模式`（有多余字，不等于） |
| ② 关键字被**成对括号**包住（可含其它文字） | `[上帝模式]` / `【上帝模式】` / `今天[上帝模式]放假` | `[上帝模式`（括号不成对） |

### 条件 B：事件**备注（DESCRIPTION）**里是一段合法 JSON

- JSON 必须写在**备注**，不是标题。备注为空 → 不触发。
- **同一天有多条命中事件 → 首条生效**（其余忽略）。
- JSON 解析失败 → **该日回落常规规则**，且 trace 里有一条 **error 级大字报**：
  `god_mode/god_json_invalid: [日期] 上帝模式 JSON 解析失败(已做智能标点容错仍非法): … → 该日回落常规规则`
  换句话说：**写坏 = 当天当作没写过上帝模式**，不会半生效、不会报错给手机。

> **v2 改进**: v1 时代解析失败是**静默吞错**，排查全靠猜。现在是 error 级 trace 含日期与
> 具体错误信息（这个诊断通道是 `produce` 返回 `{segments, notes}` 换来的，纯度不破）。

### 已内置的两道输入容错（都是踩过坑才加的）

1. **智能标点容错** `normalizeSmartJson`：iOS 键盘/日历会把直引号替换成弯引号 `“ ”`、
   冒号逗号括号变全角、混入零宽字符。这些一律先规范化再 parse。
   → **手打 JSON 被键盘"优化"过也能救回来。**
2. **ICS 反转义** `unescapeIcsText`：RFC 5545 要求 TEXT 里的逗号转义成 `\,`、分号 `\;`。
   旧解析器只还原了 `\n`，残留的反斜杠让 `JSON.parse` 在含逗号的 JSON 上必然失败。
   → **这是 v1 时代潜伏的真 bug**（v1/v2 同错为证），已一次修复两版同愈。

---

## 2. JSON 的三个字段（全部可选，省略即"空"）

**v2 规范格式**（推荐；`fixed` / `dynamic` / `quiet`）:

```jsonc
{
  "fixed":   [ ... ],   // 固定闹钟的开关（白名单：没列到的一律关）
  "dynamic": [ ... ],   // 当天要新建/保留的一次性闹钟
  "quiet":   { ... }    // 当天的安静(勿扰/静音/音量)开关时刻表
}
```

**v1 旧词汇永久兼容**：`fixedAlarms` / `dynamicAlarms` / `dnd_schedule`，值 `ON`/`OFF` 大写
——解析器两套词汇都吃，你不需要回去改老事件。新写的建议用 v2 词汇。

### 2.1 `fixed` —— 固定闹钟的开关（⚠️ 白名单语义）

数组，每项 `{ label, action }`：

- `label` **必须**是系统已注册的可开关闹钟标签之一（见下表）。写一个不存在的 label
  无意义——手机上没有对应闹钟可开关。
- `action`：`"on"`（或省略）→ 开；`"off"` → 关。**大小写不敏感，只有 `off` 是关，其余全按开。**
- **关键点（白名单）**：上帝模式下，**你没列进来的固定闹钟一律被关掉**。
  想让某个闹钟当天响，就必须显式列出并 `on`。
- 附加条件：闹钟只有在**未来 24h 窗口内**才会真正开（和平时"提前一天把闹钟开好"一致）。

已注册的固定闹钟标签（抄这里；真相源 `config.default.js` 的 `FIXED_ALARMS`）：

```
GateFix-Workday-WakeUp-Vib        06:25  普通工作日起床·震动(先头)
GateFix-Workday-WakeUp-Ring       06:29  普通工作日起床·响铃(+4min兜底)
GateFix-FirstWorkday-WakeUp-Ring  07:38  节后首个工作日·额外兜底响铃
GateFix-SchoolBreak-WakeUp-Vib    07:20  寒暑假起床·震动(先头)
GateFix-SchoolBreak-WakeUp-Ring   07:24  寒暑假起床·响铃(+4min兜底)
GateFix-Workday-NapEnd-Vib        13:30  工作日午休结束·震动
GateFix-Workday-OffWork-Vib       17:28  工作日下班·震动
GateFix-Class-<课程id>             按锚   周末上课(配了 fixed 锚的课, 如 GateFix-Class-sat-dance)
```

> **联动开关（BUNDLED）**: `WakeUp-Vib` 开时 `WakeUp-Ring` 会**自动一并开**
> （震动先响、响铃兜底）。所以起床组你只写 Vib 那条也行，但显式两条都写更不容易看错。

> **上课闹钟有两种形态**（见 `config.WEEKEND_CLASS`）：
> · 配了 `fixed` 锚且当天时段时间 == 锚时间 → 是**可开关固定闹钟** `GateFix-Class-<id>`，写进 `fixed`；
> · 其余（时间≠锚 / 未配 fixed）→ 是**动态闹钟** `GateDyn-Class-<星期>-<id>-<HHMM>`，写进 `dynamic`。

### 2.2 `dynamic` —— 当天要存在的一次性闹钟

数组，每项 `{ label, time, reason }`：

- `time`：`"HH:MM"`。
- `label`：**建议遵循** `GateDyn-Event-<HHMM>` 命名（把时间编进名字），
  例如 05:30 的闹钟 label = `GateDyn-Event-0530`。
  手机端 SyncAlarms 靠 `GateDyn-` 前缀做幂等对账：清单里有就保留/新建，清单里没有的关掉。
  **时间不进 label 的后果**见 KERNEL §12（改时间会静默失效）。
- `reason`：仅用于 trace/备注，随便写。
- 只有落在未来 24h 窗口内的才会下发。

### 2.3 `quiet` —— 当天安静开关时刻表

对象，`{ "HH:MM": "on" | "off" }`：

- 这张表**直接**成为当天的 `quiet` 规则，喂给 focus / silent / media_volume 等订阅了
  quiet 的字段（契约15：它们订阅的是规则名，不是彼此）。
- 值只认 `on`（大小写不敏感）；其它任何值（含 `off`、笔误）都当 `off` 处理。
- ⚠️ 时刻应在 `config.DND.WHITELIST` 内（默认 `20:55 / 22:25 / 07:40 / 09:30 / 12:15 / 13:29`），
  每个白名单时间对应手机上一条边界刺客自动化。写白名单外的时间没有刺客接收 = 空发，
  `kernel/audit.js` 会在 trace 里发 warn。想用新时刻：先加进 `DND.WHITELIST` + 手机建对应刺客。
- **同值重申会被归一化吸收属正常**（level 语义：重申不是变化），不是 bug。

---

## 3. 省略 / 空值时会怎样

| 你写的 | 效果 |
|---|---|
| 省略 `fixed`（或 `[]`） | 当天**所有**固定闹钟全部关（白名单为空） |
| 省略 `dynamic`（或 `[]`） | 当天不新建任何一次性闹钟 |
| 省略 `quiet`（或 `{}`） | 当天 focus/silent/volume 无任何开关指令（全天不动） |
| 备注是 `{}` | = 上面三者全空：**当天什么都不响、安静状态不动**，最安静的一天 |
| 备注 JSON 写坏 | 上帝模式**不生效**，当天回落常规规则（trace 有 error 大字报） |

---

## 4. 可直接复制的模板

**日历事件标题：** `[上帝模式]`
**日期：** 你要接管的那一天（单日事件即可；全天/定时都行，按日过滤）
**备注（整段粘贴，改成你的需求）：**

```json
{
  "fixed": [
    { "label": "GateFix-Workday-WakeUp-Vib",  "action": "on" },
    { "label": "GateFix-Workday-WakeUp-Ring", "action": "on" },
    { "label": "GateFix-Workday-NapEnd-Vib",  "action": "off" },
    { "label": "GateFix-Workday-OffWork-Vib", "action": "off" }
  ],
  "dynamic": [
    { "label": "GateDyn-Event-0530", "time": "05:30", "reason": "赶早班机" }
  ],
  "quiet": {
    "07:40": "off",
    "22:25": "on"
  }
}
```

这段的含义：当天早起震动+响铃照开、午休结束和下班震动关掉；05:30 新建"赶早班机"闹钟；
安静状态早 07:40 解除、晚 22:25 开启；**其余没列出的固定闹钟全部关掉**。

> 想"当天彻底静默、什么都不管"：备注写 `{}` 即可。

---

## 5. 怎么验证生效

```
https://<你的域名>/v2/timeline?key=…&date=<那一天>&now=00:00
```
（⚠️ 必带 `now=00:00`，否则窗口锚到真实此刻，闹钟开关状态没法看。
 日历事件已建就会被读到；也可用 `?testEvents=…` 注入虚拟事件测试。）

看返回 JSON：

1. **`schedules.god_mode`** 里那一天的值：
   - 是个对象 `{fixed, dynamic, quiet}` → 命中，按你的 JSON 执行。
   - 是 `null` → 没命中。去看 trace。
2. **`trace`** 数组：
   - 有 `god_mode/god_json_invalid` → JSON 写坏了，消息里有具体报错位置，去修备注。
   - 什么都没有 → 标题没命中关键字，回 §1 条件 A 查标题（多半是"恰好等于"或"成对括号"没满足）。
3. 核对 **`alarms.fixed` / `alarms.dynamic` / `field_timelines.*`** 是不是你 JSON 里写的那样。

---

## 6. 实现要点（改代码前看）

- **overlay 的实现方式不是特权层**：god_mode 是一张普通的**事实 schedule**，
  quiet / wake-alarms / weekend-class 各自 `deps: [{name:"god_mode", required:false}]`，
  命中日各自**让位**。契约8 的三层叠加语义由此达成，而**单一 owner（契约6）不破**。
- 所以「上帝模式该不该影响 X」这个问题，答案永远在 **X 自己的插件文件里**，不在 god-mode.js。
  想让一个新规则也被上帝模式接管 → 在那个新插件里加 deps + 让位分支。
- **值是日粒度 level**：`null`（常态）| `{fixed, dynamic, quiet}`。范围比 range 各外扩一天。
