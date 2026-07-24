# 外部闹钟 · 内部设计与运维（对内，勿外发）

对外协议见 `external-alarms.md`。这里放乙方不需要、我方要知道的：源配置、识别机制、
标签体系、手机端改动、排错。实现细节就地注释在 `index.js` 的 4.5 段与 `ics-parser.js`。

## 1. 源配置字段全集（config.SOURCES 或 env.EXTERNAL_ALARMS）

```js
{
  name:     "信用卡",          // 日志显示名
  type:     "json" | "ics",
  url:      "https://…",
  code:     "repay",           // ★ 标签段: label = Gate-ES-<code>-<uid>; 缺省回落 name
  enabled:  true,              // false 停用

  // 仅 ICS:
  markPattern: "\\[\\[ES(?::\\s*([^\\]]+?))?\\s*\\]\\]",  // 覆盖默认识别正则(须含1个uid捕获组)
  allDay:   "default",         // skip | default | error   (默认 default)
  time:     "09:30",           // allDay=default 的兜底时刻 (默认 09:30)

  tz:       "Asia/Shanghai",   // 源级默认时区 (默认东八区; 条目/事件自带的优先)
  timeoutMs: 5000              // 单源超时 (默认 5000)
}
```

- **公开 URL → config.SOURCES(明文入库)；带 token/隐私 URL → Cloudflare Secret `env.EXTERNAL_ALARMS`**
  (JSON 数组字符串，项格式同上)。两处自动合并。`wrangler secret put EXTERNAL_ALARMS`。

## 2. 识别机制（强制识别，不做 all 默许）

- **JSON**：乙方全权构造 payload，每条必带 `uid` 字段，有合法 uid 即准入。
- **ICS**：扫描每个 VEVENT 的**全字段拼接** `ev._scan`（parseICS 把 VEVENT 内每行的值累积进去），
  用 `markPattern`(默认 `[[ES:uid]]`) 匹配：
  - 命中 = 准入；捕获组 = uid；裸 `[[ES]]` (无捕获) → 回退 `ev.uid`(原生 UID)。
  - 未命中 = 不采纳（计入日志 `无标签N`）。
  - 「标签放任意字段」就是靠扫 `_scan` 实现的，标题/备注/CATEGORIES/X- 都在里面。

## 3. 标签体系（★ 网关拼时间，手机端认前缀）

- 外部源闹钟 label = **`Gate-ES-<code>-<uid>-<HHMM>`**，自成一族，区别于内部动态闹钟 `Gate-Dynamic-Event-*`。
- **为什么时间(HHMM)必须进 label（血泪教训，勿删此段）**：
  手机端 SyncAlarms 只能按名称比对，且 iOS 快捷指令**没有"改现有闹钟时间"的动作**（只能
  Create/TurnOn/TurnOff/Delete）。所以"改时间生效"的**唯一**机制 = label 变 → 旧的对账关、
  新时间重建。若 label 不含时间：同 uid 改时间 → `Find Alarms where 名称 is <同名>` 命中旧的 →
  只 `Turn On` → **时间永不更新（静默失效）**。这是必须避免的坑。
- **时间由网关拼，不由乙方**：乙方 uid 是纯逻辑身份（bucket 规范，不含时间）；网关把
  **时区换算后的最终墙上时间**拼进 label。乙方改时间 = 吐同 uid + 新 time，网关自动生成新 label。
  故：不分两种前缀、不做 vendor 开关、不放 json/ics 字段——统一网关不变量，无 footgun。
- **手机端零额外逻辑**：`-HHMM` 在 label 内部。"清单外同前缀就关"用**前缀** `Gate-ES*` 匹配
  （不受 HHMM 影响）；"找到同名就开/没有就建"用**精确 label**（每个时间版本是不同精确名）。
  所以手机端只需认 `Gate-ES*` 一个前缀即可，无需解析 HHMM。
- 身份 = uid + 时间；净化 `[A-Za-z0-9_.-]`，code≤16 / uid≤40。
- **⚠️ 手机端 SyncAlarms 的"清单外就关"对账，必须同时认两个前缀**：
  `Gate-Dynamic-Event*`（内部）与 `Gate-ES*`（外部）。那段 `Find Alarms where 名称 contains
  Gate-Dynamic-Event` 要改成**同时匹配 `Gate-ES`**（加一条 or，或改成 contains `Gate-`）。
  **不改的后果**：外部源闹钟能建、但"取消/改时间"时旧的关不掉 → 关不掉的僵尸。

## 4. 时区（修了个真 bug）

- `toShanghaiWall(date,time,tz)`：默认/`Asia/Shanghai`/`+08:00`/`Asia/Hong_Kong` → 不换算。
  `Z`/`UTC`/`±HH:MM` → 精确换算；IANA 名 → `Intl` 求当日偏移（含 DST）；无法识别 → 原样 + `tzWarn`。
  换算可能跨天（date 随之变）。
- ICS 侧：parseICS 现在捕获 `startTZ`（`TZID=…` 或末尾 `Z`）。
  **旧 bug**：过去只正则抠 `T(HHMM)`，裸 UTC 的 `…T093000Z` 被当成 09:30 墙上时间，差 8 小时。已修。

## 5. 全天事件

parseICS 对无 `T` 的 DTSTART 标 `allDay`。策略 `allDay`：
`skip` 忽略 / `default` 用 `time`(默认09:30)兜底 / `error` 无 time 则拒。

## 6. 排错（看 humanReadable 面板日志）

`[外部闹钟] 🌐 <名>(<code>): 候选N 窗口内新增M (拒/警:无标签a/全天b/无uid c/格式d/窗口外e/时区未识别f)`

- **无标签多** → 乙方 ICS 没放 `[[ES:uid]]`，或放的字段没进 `_scan`（几乎不会）。
- **无uid多** → 乙方 uid 缺失/净化后为空（多为非 ASCII 主体）。
- **窗口外多** → 乙方吐了过去的点或太远的点（>24h）。正常，提醒乙方只吐未来。
- **时区未识别** → tz 字段写了个 `Intl` 不认的名，按东八区兜底了，去核对 tz 值。
- `🔐 env… N 个隐私源` / `⚠️ 超时>5000ms` / `🚨 env JSON 写坏`。

## 7. 不合规源怎么接（甲方兜底）

乙方都是自己的项目，改字段即可。万一某个源改不动（第三方 ICS），思路：
在网关和该源之间放一个**转换 Worker**，把原始 ICS/JSON 读进来、按本协议补上 `[[ES:uid]]` 标签或
`uid` 字段再吐给网关。网关本体不为个别乙方开特例，保持干净。

## 8. 演进钩子（已预留）

JSON 顶层可选 `v`；未知字段双向忽略；条目可选 `tz`；`allDay` 是枚举；
`Gate-ES-` 前缀固定而 code/uid 结构各自可演进；markPattern 源级可覆盖。
