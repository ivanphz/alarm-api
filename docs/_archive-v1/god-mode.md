# 上帝模式（GOD MODE）使用说明

> 一句话：在日历里建一个事件，标题命中关键字、备注写一段 JSON，就能**完全接管当天**——
> 常规规则（工作日/放假/请假/上课判定）全部旁路，当天只按你手写的 JSON 执行。
> 实现见 `src/rules.js` 的 **R1**。

---

## 1. 怎么触发（两个硬条件，缺一不可）

### 条件 A：事件标题命中 GOD_MODE 关键字

关键字在 `config` 的 `KEYWORDS.GOD_MODE`，默认 `["上帝模式", "JSON"]`。
标题会先做归一化（全角空格→普通空格、去首尾空白），然后按两种方式判定命中：

| 判定方式 | 命中的标题示例 | 不命中的标题示例 |
|---|---|---|
| ① 整个标题**恰好等于**关键字 | `上帝模式` / `JSON` | `今天上帝模式`（有多余字，不等于） |
| ② 关键字被**成对括号**包住（可含其它文字） | `[上帝模式]` / `【上帝模式】` / `今天[上帝模式]放假` | `[上帝模式`（括号不成对） |

成对括号支持：`[] () {} 【】 （） 「」 『』 〔〕 《》`。

> ✅ 最稳的写法：标题直接写 **`[上帝模式]`**。带括号时前后可以加说明文字（`.includes` 匹配）。

### 条件 B：事件**备注（DESCRIPTION）**里是一段合法 JSON

- JSON 必须写在**备注**，不是标题。
- 备注为空 → 不触发（`ev.description` 为假直接跳过）。
- JSON 解析失败（写到一半、少括号、中文引号、尾逗号等）→ **静默忽略上帝模式，当天回落常规规则**，
  审计日志里会有 `[R1] ❌ 上帝模式 JSON 解析失败 ... 忽略并继续常规规则`。
  换句话说：**写坏 = 当天当作没写过上帝模式**，不会半生效、不会报错给手机。

命中成功时审计日志有 `[R1] 👑 上帝模式 [标题]: 当天完全按手写 JSON 执行，常规规则旁路`。
**看到这行才算真的接管了**；没看到就去查条件 A 的标题。

---

## 2. JSON 的三个字段（全部可选，省略即"空"）

```jsonc
{
  "fixedAlarms":   [ ... ],   // 可开关闹钟的 ON/OFF（白名单：没列到的一律 OFF）
  "dynamicAlarms": [ ... ],   // 当天要新建/保留的一次性闹钟
  "dnd_schedule":  { ... }    // 当天的 DND(勿扰/静音/音量) 开关时刻表
}
```

### 2.1 `fixedAlarms` —— 固定闹钟的开关（⚠️ 白名单语义）

数组，每项 `{ label, action }`：

- `label` **必须**是系统已注册的可开关闹钟标签之一（`FIXED_ALARMS` 的 7 个 +
  已注册的固定闹钟）。写一个不存在的 label 无意义——手机上没有对应闹钟可开关。
- `action`：`"ON"` 或省略 → 开；`"OFF"` → 关。
- **关键点（白名单）**：上帝模式下，**你没列进来的固定闹钟一律被关掉**。
  所以想让某个闹钟当天响，就必须显式列出并 `ON`。
- 附加条件：闹钟只有在**未来 24h 窗口内**才会真正 `ON`（和平时"提前一天把闹钟开好"一致）。

已注册的固定闹钟标签（抄这里）：

```
Gate-Fixed-Workday-WakeUp-Vib        06:25  普通工作日起床·震动
Gate-Fixed-Workday-WakeUp-Ring       06:29  普通工作日起床·响铃
Gate-Fixed-FirstWorkday-WakeUp-Ring  07:38  节后首个工作日·兜底响铃
Gate-Fixed-SchoolBreak-WakeUp-Vib    07:20  寒暑假起床·震动
Gate-Fixed-SchoolBreak-WakeUp-Ring   07:24  寒暑假起床·响铃
Gate-Fixed-Workday-NapEnd-Vib        13:30  午休结束·震动
Gate-Fixed-Workday-OffWork-Vib       17:28  下班·震动
Gate-Fixed-Class-<课程id>             按锚   周末上课(配了 fixed 锚的课, 如 Gate-Fixed-Class-sat-dance)
```

> **上课闹钟有两种形态**（见 config.WEEKEND_CLASS）：
> · 配了 `fixed` 锚且当天时段时间==锚时间 → 是**可开关固定闹钟** `Gate-Fixed-Class-<id>`，写进 `fixedAlarms`；
> · 其余（时间≠锚 / 未配 fixed）→ 是**动态闹钟** `Gate-Class-<星期>-<id>-<HHMM>`，写进 `dynamicAlarms`。

### 2.2 `dynamicAlarms` —— 当天要存在的一次性闹钟

数组，每项 `{ label, time, reason }`：

- `time`：`"HH:MM"`。
- `label`：**必须遵循** `Gate-Dynamic-Event-HHMM` 命名（把时间编进名字），
  例如 05:30 的闹钟 label = `Gate-Dynamic-Event-0530`。
  手机端 SyncAlarms 靠这个前缀做幂等对账：清单里有就保留/新建，清单里没有的 `Gate-Dynamic-Event*` 关掉。
- `reason`：仅用于日志/备注，随便写。
- 只有落在未来 24h 窗口内的才会下发。

### 2.3 `dnd_schedule` —— 当天 DND 开关时刻表

对象，`{ "HH:MM": "ON" | "OFF" }`：

- 这张表**直接**成为当天 `dnd` 规则，喂给 focus / silent 等订阅了 dnd 的字段
  （见 `device-state.js` 的字段订阅模型）。
- 值只认 `"ON"`；其它任何值（含 `"OFF"`、笔误）都当 `OFF` 处理。
- ⚠️ 时刻必须在 `DND.WHITELIST` 白名单内（每个白名单时间对应手机上一条刺客自动化）。
  写白名单外的时间没有刺客接收 = 空发，且引擎会在日志里拦截告警。
  想用新时刻：先加进 `DND.WHITELIST` + 手机建对应刺客。

---

## 3. 省略 / 空值时会怎样

| 你写的 | 效果 |
|---|---|
| 省略 `fixedAlarms`（或 `[]`） | 当天**所有**固定闹钟全部 **OFF**（白名单为空） |
| 省略 `dynamicAlarms`（或 `[]`） | 当天不新建任何一次性闹钟 |
| 省略 `dnd_schedule`（或 `{}`） | 当天 focus/silent 无任何开关指令（DND 全天不动） |
| 备注是 `{}` | = 上面三者全空：**当天什么都不响、DND 不动**，最安静的一天 |
| 备注 JSON 写坏 | 上帝模式**不生效**，当天回落常规规则（日志有 ❌） |

---

## 4. 可直接复制的模板

**日历事件标题：** `[上帝模式]`
**日期：** 你要接管的那一天（单日事件即可；全天/定时都行，Date Guard 按日过滤）
**备注（整段粘贴，改成你的需求）：**

```json
{
  "fixedAlarms": [
    { "label": "Gate-Fixed-Workday-WakeUp-Vib",  "action": "ON" },
    { "label": "Gate-Fixed-Workday-WakeUp-Ring", "action": "ON" },
    { "label": "Gate-Fixed-Workday-NapEnd-Vib",  "action": "OFF" },
    { "label": "Gate-Fixed-Workday-OffWork-Vib", "action": "OFF" }
  ],
  "dynamicAlarms": [
    { "label": "Gate-Dynamic-Event-0530", "time": "05:30", "reason": "赶早班机" }
  ],
  "dnd_schedule": {
    "07:40": "OFF",
    "22:25": "ON"
  }
}
```

这段的含义：当天早起震动+响铃照开、午休结束和下班震动关掉；05:30 新建"赶早班机"闹钟；
DND 早 07:40 解除、晚 22:25 开启；**其余没列出的固定闹钟全部关掉**。

> 想"当天彻底静默、什么都不管"：备注写 `{}` 即可（全 OFF、DND 不动）。

---

## 5. 怎么验证生效

1. 部署后浏览器打开：`https://<你的域名>/?testDate=<那一天>`
   （若日历事件已建，会被读到；也可用 `?testEvents=...` 注入虚拟事件测试）。
2. 看返回 JSON 的 `humanReadable` 面板顶部：
   - 有 `[R1] 👑 上帝模式 [...]` → 命中，按 JSON 执行。
   - 有 `[R1] ❌ ... 解析失败` → JSON 写坏了，去修备注。
   - 两行都没有 → 标题没命中关键字，回第 1 节查标题。
3. 核对面板里的 `fixedAlarms / dynamicAlarms / device_schedule` 是不是你 JSON 里写的那样。
