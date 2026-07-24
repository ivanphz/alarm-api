# EXTERNAL-SOURCES.md — 外部闹钟源（对接协议 + 内部机制）

> **现役功能**，非归档。代码落点: `edge/sources.js` 的 `loadExternalAlarms`（I/O 半场）
> + `edge/assemble.js` 的 `assembleAlarms`（换算/标签/窗口半场）+ `domain/alarm-labels.js`
> 的 `esLabel()`（标签唯一构造点）。
>
> **本文分两部分**:
> · **§A 对接协议** —— 平台中性、不含内部机制，**可直接把这一节发给乙方项目**。
> · **§B 内部机制** —— 源配置、识别实现、排错、演进钩子，**对内，勿外发**。
>
> 本文档由 v1 时代的 `external-alarms.md` + `external-alarms-internal.md` 合并重构而来，
> 已翻译到 V12/v2 坐标（标签前缀、配置路径、排错入口全部更新）。

---
---

# §A 对接协议（可外发）

把你项目算好的**具体闹钟点**暴露成一个 URL，就能变成我手机上的闹钟。你只需符合本协议。

## A1. 两条铁律

1. **你负责"算成哪一刻"。** 工作日、间隔、自然月去重、跳节假日、动态改期…这些复杂计算
   由你算出**具体的 `YYYY-MM-DD HH:MM`** 再给我。简单重复（每周三/每月某号）我用手机自带
   重复闹钟即可，别走这个接口。
2. **每条闹钟带一个唯一且稳定的 uid。** 用来认"是不是同一条"。**uid 里不要放时间**——
   时间由我这边处理（你改时间时，吐同一个 uid、换个 `time` 即可，我会自动让它生效）。
   - **唯一**：不同闹钟不同 uid。
   - **稳定**：同一条闹钟每次拉取吐**同一个 uid**，直到它不该再响就别再吐。
     （uid 变了 = 我认成新闹钟，会抖。）

## A2. uid 命名规范（照这个写，不用每次现想）

格式：**`{域}-{任务实例}-{周期桶}`**，全 ASCII。
**周期桶(bucket)的粒度 = 你这个提醒"同一时段内最多响一次"的那个时段**，用稳定的日期/序号，
**不要用时钟时间**（时间我来加）：

| 提醒模式 | bucket | 例 |
|---|---|---|
| 月度（签到、还款） | `YYYYMM` | `checkin-moeshare-202608` |
| 每日一次 | `YYYYMMDD` | `dose-vitaminD-20260807` |
| 每日多次 | `YYYYMMDD-<序号/名>` | `water-desk-20260807-3` |
| 本身有唯一编号 | 直接用编号 | `bill-cmb-202607` |

**唯一判据一句话**：同一个 bucket 值在一次拉取里绝不能出现两次（否则两条闹钟撞身份）。
**别过细**：月度任务别精确到日，否则日期一漂 bucket 就变，回到"抖动"老问题。
多次/天要区分的，用**稳定序号/名**（`-1/-2`、`-am/-pm`），**不要用时间**去区分。

## A3. 通用规则

- **只吐未来的点**（约未来 2 天内即可，多吐无害）。过去的时间点我会丢弃。
- **改时间**：吐同一个 uid、换个 `time` 就行，会自动生效（旧的关掉、按新时间重建）。你不用管这机制。
- **取消 = 不再吐这个 uid**。不用发删除指令，我对账时发现清单里没有了就自动关掉对应闹钟。
- **时区**：`date`/`time` 默认按**北京/香港时间（东八区）**理解。你若在别的时区，
  自己换算成东八区再吐，或显式带时区声明（见下）。
- **一个闹钟一条记录**。你界面上怎么合并展示是你的事，给我的每条 = 一个闹钟。

## A4. 方式 A：JSON 端点（推荐）

GET 返回一个数组，每项是一条已算好的具体闹钟：

```json
[
  { "uid": "cmb-young-0728", "date": "2026-07-28", "time": "10:00", "reason": "招行还款" },
  { "uid": "hsbc-red-0729",  "date": "2026-07-29", "time": "10:00", "reason": "汇丰Red还款" }
]
```

（包一层 `{ "alarms": [ ... ] }` 也行。）

| 字段 | 必填 | 格式 | 说明 |
|---|---|---|---|
| `uid` | ✅ | ASCII 字符串 | 唯一 + 稳定（见 A1 铁律 2） |
| `date` | ✅ | `YYYY-MM-DD` | 你算好的具体日期 |
| `time` | ✅ | `HH:MM`（24h） | 响铃时刻 |
| `reason` | 选填 | 任意 | 仅备注 |
| `tz` | 选填 | IANA 名或 `±HH:MM`/`Z` | 默认东八区；带了我按它换算 |

## A5. 方式 B：ICS 订阅（已有 iCal 时用）

提供 iCal 订阅 URL，并满足：

- **VEVENT 必须是具体日期**（`DTSTART` 是某天）。**不要用 `RRULE` 循环** —— 我不展开它，
  循环账单请直接列出未来几期的具体 VEVENT。
- **每个要变闹钟的事件，在它的任意字段里放一个标签 `[[ES:你的uid]]`**：
  标题、备注、分类（CATEGORIES）、自定义 X- 字段，**放哪都行**，我全字段扫描。
  - 有这个标签 = 这条要变闹钟；**没有 = 我不碰**（所以你日历里其它事件不受影响）。
  - 标签里的 `你的uid` 就是 uid（唯一+稳定）。
  - 例：标题写 `招行还款 [[ES:cmb-young-0728]]`，或把 `[[ES:cmb-young-0728]]` 放在备注里。
  - 若你实在不想自定 uid，可用裸标签 `[[ES]]`，我会退用该事件的原生 `UID` 当身份
    （前提是你的 ICS 每次导出该事件的 `UID` 稳定不变）。
- **时区**：`DTSTART` 带 `Z`（UTC）或 `TZID=...` 我会换算到东八区；**不带时区**则按东八区墙上时间。
- **全天事件**：默认给它配一个提醒时刻（我方设，默认 09:30）；也可约定直接忽略。

## A6. 其它

- **端点要快**：我有 5 秒超时，慢了这次就跳过（不影响我主流程，但你这条也就不下发了）。
- **版本**：JSON 顶层可留一个可选 `"v": 1`；以后协议升级靠它区分。现在不带我按 v1 处理。
- **未知字段我会忽略**；我回传的东西你也不必依赖。互相留演进空间。

## A7. 自检

把你的 URL 给我，我在网关侧就能看到：你的条目有没有被采纳、被拒的话卡在哪
（无标签 / 无 uid / 格式 / 窗口外 / 时区没识别）。有问题我把这行日志发你。

---
---

# §B 内部机制（对内，勿外发）

## B1. 源配置字段全集

**配置路径**（⚠️ v2 已变更）:
- 公开 URL → `config.default.js` / `config.user.js` 的 **`EXTERNAL_ALARMS.SOURCES`** 数组
- 带 token/隐私 URL → Cloudflare Secret **`env.EXTERNAL_ALARMS`**
  （**必须是 JSON 数组字符串**，项格式同下；`wrangler secret put EXTERNAL_ALARMS`）

两处自动合并（config 在前、env 在后）。

```js
{
  name:     "信用卡",          // trace 显示名
  type:     "json" | "ics",    // 必填（未来降为可选，见 HORIZON §5 格式嗅探）
  url:      "https://…",
  code:     "repay",           // ★ 标签段: GateDyn-ES-<code>-<uid>-<HHMM>; 缺省回落 name
  enabled:  true,              // false 停用

  // 仅 ICS:
  markPattern: "\\[\\[ES(?::\\s*([^\\]]+?))?\\s*\\]\\]",  // 覆盖默认识别正则(须含1个uid捕获组)
  allDay:   "default",         // skip | default | error   (默认 default)
  time:     "09:30",           // allDay=default 的兜底时刻 (默认 09:30)

  tz:       "Asia/Shanghai",   // 源级默认时区 (默认东八区; 条目/事件自带的优先)
  timeoutMs: 5000              // 单源超时 (默认 5000)
}
```

> ⚠️ **已知踩坑（对拍第一轮暴露）**: `env.EXTERNAL_ALARMS` 里写**裸 URL 字符串**是非法的，
> v1/v2 双双报错、外部闹钟整体失效。必须写成完整 JSON 数组:
> `[{"name":"…","code":"…","type":"ics","url":"https://…","tz":"Asia/Shanghai"}]`

## B2. 识别机制（强制识别，不做 all 默许）

- **JSON**：乙方全权构造 payload，每条必带 `uid` 字段，有合法 uid 即准入。
- **ICS**：扫描每个 VEVENT 的**全字段拼接** `ev._scan`（parseICS 把 VEVENT 内每行的值累积进去），
  用 `markPattern`（默认 `[[ES:uid]]`，常量 `ES_MARK_DEFAULT`）匹配：
  - 命中 = 准入；捕获组 = uid；裸 `[[ES]]`（无捕获）→ 回退 `ev.uid`（原生 UID）。
  - 未命中 = 不采纳（计入 trace `无标签N`）。
  - "标签放任意字段"就是靠扫 `_scan` 实现的，标题/备注/CATEGORIES/X- 都在里面。

## B3. 标签体系（★ 网关拼时间，手机端认前缀）

- 外部源闹钟 label = **`GateDyn-ES-<code>-<uid>-<HHMM>`**
  （⚠️ v0.7 改名: 原 `Gate-ES-`，现归入统一动态族 `GateDyn-`，见 KERNEL §12）。
- **为什么时间(HHMM)必须进 label**（血泪教训，勿删此段）：
  手机端 SyncAlarms 只能按名称比对，且 iOS 快捷指令**没有"改现有闹钟时间"的动作**（只能
  Create/TurnOn/TurnOff/Delete）。所以"改时间生效"的**唯一**机制 = label 变 → 旧的对账关、
  新时间重建。若 label 不含时间：同 uid 改时间 → `Find Alarms where 名称 is <同名>` 命中旧的 →
  只 `Turn On` → **时间永不更新（静默失效）**。
- **时间由网关拼，不由乙方**：乙方 uid 是纯逻辑身份（bucket 规范，不含时间）；网关把
  **时区换算后的最终墙上时间**拼进 label。乙方改时间 = 吐同 uid + 新 time，网关自动生成新 label。
  故：不分两种前缀、不做 vendor 开关、不放 json/ics 字段——统一网关不变量，无 footgun。
- 身份 = uid + 时间；净化 `[A-Za-z0-9_.-]`，code≤16 / uid≤40；uid 净化后为空 = 丢弃。
- **手机端 sweep 现已统一为单一前缀 `GateDyn-`**（v0.7 收敛）——所有动态族一扫全清，
  加新族不用再改手机端。这是 v0.7 把四个前缀并成一族的主要收益。

## B4. 时区

- `toShanghaiWall(date, time, tz)`：默认/`Asia/Shanghai`/`+08:00`/`Asia/Hong_Kong` → 不换算。
  `Z`/`UTC`/`±HH:MM` → 精确换算；IANA 名 → `Intl` 求当日偏移（含 DST）；无法识别 → 原样 + `tzWarn`。
  换算可能跨天（date 随之变）。
- ICS 侧：parseICS 捕获 `startTZ`（`TZID=…` 或末尾 `Z`）。
  **旧 bug（已修）**：过去只正则抠 `T(HHMM)`，裸 UTC 的 `…T093000Z` 被当成 09:30 墙上时间，差 8 小时。

## B5. 全天事件

parseICS 对无 `T` 的 DTSTART 标 `allDay`。策略 `allDay`：
`skip` 忽略 / `default` 用 `time`（默认 09:30）兜底 / `error` 无 time 则拒。

## B6. 排错（看 `/v2/timeline` 的结构化 trace）

**入口**（v2 已变更，不再是 v1 的 humanReadable 面板）:
```
<域名>/v2/timeline?key=…&date=YYYY-MM-DD&now=00:00
```
在返回 JSON 的 `trace` 数组里找这几个 `ref`：

| ref | level | 含义 / 处置 |
|---|---|---|
| `sources/external_env` | info | env 私密源解析出 N 个。数量不对 → 检查 Secret |
| `sources/external_env_invalid` | **error** | `env.EXTERNAL_ALARMS` 非法 JSON，**整体忽略**。见 B1 踩坑 |
| `sources/external_loaded` | info | `<名>(<code>): 候选N (拒:无标签a/全天b)` |
| `sources/external_failed` | warn | 拉取失败/超时，已跳过不影响主流程 |
| `assemble/external_filtered` | info | `外部候选过滤: 无uid… 格式… 窗口外… 时区未识别…` |

诊断对照：

- **无标签多** → 乙方 ICS 没放 `[[ES:uid]]`，或 markPattern 写错。
- **无uid多** → 乙方 uid 缺失/净化后为空（多为非 ASCII 主体）。
- **窗口外多** → 乙方吐了过去的点或太远的点（>24h）。正常，提醒乙方只吐未来。
- **时区未识别** → tz 字段写了个 `Intl` 不认的名，按东八区兜底了，去核对 tz 值。
- **候选有但闹钟没出现** → 先确认取数带了 `now=`；窗口是 `(锚+1分, 锚+24h]`，
  不带 now 用真实此刻锚，预览别的日期时必然对不上。

## B7. 不合规源怎么接（甲方兜底）

乙方都是自己的项目，改字段即可。万一某个源改不动（第三方 ICS），思路：
在网关和该源之间放一个**转换 Worker**，把原始 ICS/JSON 读进来、按本协议补上 `[[ES:uid]]` 标签或
`uid` 字段再吐给网关。网关本体不为个别乙方开特例，保持干净。

## B8. 演进钩子（已预留）

JSON 顶层可选 `v`；未知字段双向忽略；条目可选 `tz`；`allDay` 是枚举；
`GateDyn-ES-` 前缀固定而 code/uid 结构各自可演进；markPattern 源级可覆盖。

**已定未做**（HORIZON §5/§7）:
- `type` 从必填降为可选 —— 加**格式嗅探器** `sniffFormat()`：试 `JSON.parse` 成功→json；
  失败且含 `BEGIN:VCALENDAR`→ics；再失败→报响亮错误。**嗅探失败绝不猜、绝不静默。**
- `EXTERNAL_ALARMS` 收敛进统一的 `EXTERNAL_SOURCES` 家族（`kind: alarm|todo|calendar`），
  一个拉取器 + 一个嗅探器 + 按 kind 分派，取代闹钟源/todo 源各写一套。
  → **这两件事随 todo 通道一起做最省**（TODO-CHANNEL.md）。

## B9. 架构定位（为什么网关只做"具体点搬运工"）

**走过的弯路，特别记录**: 曾让网关内置 `RECURRING_ALARMS`"每月9号"式循环规则，加了又删。
**定位错误**：简单循环 iPhone 时钟 App 自建重复闹钟即可；复杂计算（工作日/间隔/自然月去重/
跳节假日）是**乙方业务**，必须乙方算成具体 `YYYY-MM-DD HH:MM` 再喂。
网关只做"具体点搬运工"（收点 → 24h 窗口裁剪 → 幂等对账）。
**未来若有人再想给网关加排期能力，先读这段。**

**否决项：between / 时间容差匹配。** 固定闹钟的时间真相在手机（网关不下发时间去比）；
动态闹钟的时间不一致**本就该重建**——容差会把"该重建"误判成"将就旧的"，绕回 B3 那个 bug。
**稳定靠 GateFix 常驻、精准靠 GateDyn 重建，不做单条闹钟上的两者兼得。**
