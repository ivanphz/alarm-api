# BLUEPRINT.md — V12 分步施工图（KERNEL.md 的下层文档，逐步追加）

> KERNEL.md 管"改不动的宪法"，本文档管"每步开工前钉死的 schema"。
> 纪律: 接口细节对着真实消费者定 —— 每步只钉本步需要的，绝不提前猜。

---

## 步骤② 三件套（restdays → presence → quiet）✅ 2026-07-16 交付，32 用例全绿

### ctx 形状（本步钉死的部分）

```js
ctx = {
  config,        // 深合并后的只读配置。config 键名(SCREAMING_SNAKE)不属于 API，维持原状；
                 // 命名法只约束 API/JSON 输出 token（KERNEL §2 适用范围澄清）
  profile,       // "default"
  calendars: [   // ⚠️ 日实例（day-resolved）: edge/sources 负责把 RRULE/跨天事件
                 //    解算成逐日实例后注入 —— RRULE 复杂度被挡在 lib/ics + edge，
                 //    插件永不接触重复规则（本步最重要的边界决定）
    { date: "YYYY-MM-DD", title, description?,
      start_time: "HH:MM"|null, end_time: "HH:MM"|null, all_day: bool },
  ],
  workdays: [    // workdays-core 原始事实，跨度 ≥ range±16 天（块扫描需要）
    { date: "YYYY-MM-DD", off: bool, name: "" },
  ],
  facts: {},     // 步骤⑤启用
  schedules: {}, // 内核注入: 仅含已发布的 deps 产物（未裁剪）
}
```

### schedule 值 schema（本步产出）

| schedule | owner | 粒度 | 值 |
|---|---|---|---|
| restdays | plugins/restdays.js | 日（from="D 00:00"） | `{workday, named_holiday, rest, block}` |
| presence | plugins/presence.js | 日 | `{workday, rest, block, morning, noon, evening}`，区 token `work\|free\|leave\|out` |
| quiet | plugins/quiet.js | 时刻边界 | `"on"\|"off"` |

区 token 裁决优先级: **leave > out > 底色**（同区多事件并存时）。
R 编号迁移: R4/R5 → presence（碰撞升格为可订阅事实），R6 → quiet（编号在注释中保留）。

### 产出跨度约定（发布未裁剪，裁剪归 edge/assemble）

- restdays: range **±2 天**（块扫描 ±14 走原始输入，不受此限）
- presence: range **±1 天**（quiet 读昨日 block、明日 rest）
- quiet: range 内逐日

### 本步语义保真点（与 V11 逐字对位，改动为零）

关键词判定两法则、碰撞三区公式（全天=三区全中）、R6 决策树全部分支
（含 R6.2b "昨日块<阈值早点解除" 的用户拍板语义）、半天假不计整休息日、
块长双向扫描各限14天。**唯一语义升级**: R6.2a/c 的"不输出"由"刺客装死"
变为"无 off 边界 → 夜间 on 直接延续"，长假整段合并为一个 on 区间（场景C用例）。

### 本步遗留 → 后续步骤

1. DND 时间与手机自动化白名单的一致性审计 → kernel/audit.js（步骤④）。
2. god_mode 事件 presence 中显式忽略 → god-mode overlay 插件（步骤④，用 intervals.stack）。
3. wake-alarms 需要的晨间事件具体时间：直读 ctx.calendars + 复用 presence 导出的
   computeCollisions（单一变更点），不经 presence 值转手（步骤④）。
4. WEEKEND_CLASS / SCHOOL_BREAK / FIXED_ALARMS 迁移 → 步骤④。
5. /v2/state 信封组装与 range 裁剪（clampToRange）→ 步骤③。

### 入库路径

```
src/kernel/intervals.js      （更新: +isDate/addDays/dayOfWeek）
src/kernel/registry.js       （新增）
src/domain/grammar.js        （新增）
src/plugins/restdays.js      （新增）
src/plugins/presence.js      （新增）
src/plugins/quiet.js         （新增）
test/kernel/intervals.test.js（更新）
test/kernel/registry.test.js （新增）
test/domain/grammar.test.js  （新增）
test/plugins/quiet.e2e.test.js（新增）
```

---

## 步骤③ edge 层 + 五旋钮（/v2 首次通电）✅ 2026-07-16 交付，累计 51 用例全绿

### 本步钉死的 schema

**/v2 信封（契约12 实例化）**:
```json
{ "version": "2", "generated_at": "2026-07-15 01:30", "device": "default",
  "mode": "segment", "range": { "start": "...", "end": "..." },
  "fields": {
    "focus":  { "kind": "focus",  "apply": "on_change",
                "value": { "mode": "do_not_disturb", "action": "on",
                           "switch_to": null, "only_if_current": null },
                "from": "2026-07-14 20:55" },
    "silent": { "kind": "scalar", "apply": "on_change", "value": "on", "from": "..." },
    "media_volume": { "kind": "scalar", "apply": "on_change", "value": 0, "from": "..." }
  },
  "reconcile_alarms": true,
  "trace": ["[info] quiet/published: 2 段", "..."] }
```
point 模式: 每字段 `changes: [{at, value, previous}]` 替代 value/from。
故障降级信封: `error:"internal_degraded"` + fields 空 + reconcile false（宁可不动手机）。

**端点与参数**: `/v2/state`、`/v2/timeline`（常开 debug 内脏: schedules + field_timelines）。
`?date=`(锚日,任意日期预览) `?now=HH:MM` `?mode=segment|point`(默认 **segment**，level 是主表示)
`?device=` `?debug=1` `?testEvents=` `?skipCalendar=1`（沙盒与 v1 同参）。

**config 增量（config.user.js 加一节，深合并；不动 v1 任何键）**:
```js
V2: {
  DEFAULT: false,   // 迁移完成后翻 true = 根路径走 v2
  // FIELDS / RECONCILE_ALARMS / POINT 不写则用 router.js 的 V2_DEFAULTS
}
```

### 五旋钮 v1→v2 语义差异（就三条，其余逐字保真）

1. `OWN: {key: null}` 与 focus `{action:null}`: v1=输出 null，v2=**压制该边界**（前值延续）。
2. 同值 OWN 被归一化吸收（level: 重申不是变化；要重申用 APPLY:"enforce"）。
3. OWN 每日展开含前一日（跨午夜迟到采样可承接昨日主张，替代 LOOKBACK）。

### 入库操作（顺序敏感）

1. GitHub 网页 rename: `src/index.js` → `src/edge/v1-legacy.js`（内容零改动）。
2. 新文件入库: `src/index.js`(新入口) `src/kernel/fields.js` `src/edge/router.js`
   `src/edge/assemble.js` `src/edge/sources.js` + 测试 `test/kernel/fields.test.js`
   `test/edge/{assemble,sources,router}.test.js`。
3. 部署后验证: 老路径行为不变；`/v2/timeline?date=<明天>` 首次预览。

### 本步遗留 → 步骤④

alarms 字段（期望集合）尚未进 /v2 —— v2 暂只有状态字段，闹钟仍由 v1 服务；
wake-alarms/weekend-class/god-mode/school-break 搬家 + kernel/audit.js + alarm-labels.js。

---

## 步骤④ 其余插件搬家 + 闹钟入 /v2 ✅ 2026-07-16 交付，累计 59 用例全绿

### 本步钉死的 schema

**闹钟值 schema**（wake_alarms / weekend_class / god 接管日同形）:
`{ fixed: [label...], dynamic: [{label, time:"HH:MM", reason}] }`（日粒度 level =
"当日期望集合"；窗口是采样期权限边界，归 assembleAlarms）。

**信封新增 alarms 节**:
```json
"alarms": {
  "window": { "start": "2026-07-15 20:01", "end": "2026-07-16 20:00" },
  "fixed":  [ { "label": "Gate-Fixed-...", "action": "on|off", "scheduled_at": "06:25", "kind": "fixed|class" } ],
  "dynamic":[ { "label": "Gate-...", "at": "YYYY-MM-DD HH:MM", "reason": "..." } ]
}
```
手机对账不变: fixed 按 label 开关；dynamic 前缀 sweep（Gate-Dynamic-Event/Gate-ES/Gate-Class）
在清单→开/建、不在→关。v2 窗口 = (at, at+24h]，分钟平面排除当前分钟 ≈ v1 的 ±15s 死区。

**god_mode 值**: `null | { fixed, dynamic, quiet:{"HH:MM":"on|off"} }`（兼容 v1 词汇
fixedAlarms/dynamicAlarms/dnd_schedule；JSON 非法 = 该日回落常规，R1 原语义）。
overlay 实现方式: quiet/wake-alarms/weekend-class 各自 deps god_mode(optional)，
命中日让位 —— 契约8 的语义以"上游事实"形态达成，单一 owner 不破。

### R 编号迁移完成表

| v1 | v2 归宿 |
|---|---|
| R1 | plugins/god-mode.js + 三消费者让位分支 |
| R2.1–2.4 | plugins/wake-alarms.js（先加后删 → 按 presence 分区判定不加，语义等价） |
| R3.1–3.4 | plugins/weekend-class.js（晨间碰撞清课一并内化） |
| R4/R5 | presence 分区 + wake-alarms 集合效应 + R5.1 事件闹钟 |
| R6 | plugins/quiet.js（步骤②，本步补 R1 让位） |
| 外部闹钟 | sources.loadExternalAlarms(I/O) + assembleAlarms(换算/标签/窗口/去重) |
| esLabel/类标签 | domain/alarm-labels.js（唯一构造点，语法冻结） |
| WHITELIST 校验 | kernel/audit.js（结构化 warn；注: 同值边界被归一化吸收属正常） |

### 已知语义微调（除步骤③三条外新增）

- v2 窗口起点"排除当前分钟"代替 v1 的 now+15s；终点 at+24h 含端代替 +24h+15s。
- 上课动态标签沿用 v1 大小写（Gate-Class-Sat-<id>-HHMM，id 取自配置原文如 Sat-Dance）。
- 同值 quiet 边界（god 重申等）被归一化合并——point 刺客视角"无变化=装死"，语义一致。

### 入库路径（本步新增/更新）

```
src/lib/time.js  src/domain/alarm-labels.js  src/kernel/audit.js       （新增）
src/plugins/{school-break,god-mode,wake-alarms,weekend-class}.js       （新增）
src/plugins/quiet.js（更新: R1 让位分支）
src/edge/sources.js（更新: +loadExternalAlarms）
src/edge/assemble.js（更新: +assembleAlarms）
src/edge/router.js（更新: 七插件挂载 + 审计 + alarms 入信封）
test/plugins/alarms.e2e.test.js                                        （新增）
```

### 遗留 → 步骤⑤

/fact 端点 + ai_claude 冷却任务（cadence 特例）；PHONE.md v2（含双语反查词典、
last_applied、alarms 对账流程改读 /v2）；lib/ics 提包与 PROFILES 归⑥⑦。

---

## 步骤⑤ /fact + ai_claude 冷却试点 ✅ 2026-07-16 交付，累计 65 用例全绿

### 本步钉死的 schema

**事实记录**: `{ at:"YYYY-MM-DD HH:MM", id:"≤64字符幂等键", type:"done|reset|set_next", payload? }`
KV 键 `fact:<device>:<stream>`（契约11），每流保留最近 200 条，同 id 重试去重。

**端点**: `POST /v2/fact` body `{stream, at, id, type?, payload?}`（?device= 同采样端）;
`GET /v2/facts?stream=` 调试列取。鉴权同制。KV 未绑定 → `facts_storage_missing` 明确报缺。

**ctx.facts**: `{ streams: { <stream>: [事实...] }, degraded: [<stream>...] }`
——读失败/未绑定进 degraded，插件对降级流输出 null（宁可不知道，不可编造）。

**ai_quota 值**: `true | false | null`。冷却语义: done → 阻塞 [at, min(at+COOLDOWN,
下个周重置)]；reset 截断；set_next 阻塞至 payload.at；重叠阻塞合并。
**ai_quota_reminder**: 纯派生插件——只读 ai_quota 时间线的 **false→true 跳变**产出
`Gate-AIQ-<stream>-<HHMM>` 提醒（配额逻辑单点，提醒是 level 的派生视图，这就是
"字段/闹钟都是同一份状态的投影"的完整示范）。assembleAlarms 并集来源参数化为
ALARM_SCHEDULES（缺流安全跳过）。

**配置**（默认关，开启加进 config.user.js）:
```js
V2: { AI_QUOTA: { ENABLED: true } }   // 其余缺省: ai_claude / 300分钟 / 周一08:00 / 提醒开
```

### 部署前置

wrangler.toml 增加 KV 绑定（CF 面板先建命名空间）:
```toml
[[kv_namespaces]]
binding = "FACTS_KV"
id = "<面板创建后的 namespace id>"
```
不绑定不影响其他一切功能——ai_available 恒 null，/v2/fact 明确报缺。

### 入库路径（本步新增/更新）

```
src/plugins/{ai-quota,ai-quota-reminder}.js  （新增）
src/domain/alarm-labels.js（更新: +aiqLabel 前缀族）
src/edge/sources.js（更新: +loadFacts）  src/edge/assemble.js（更新: ALARM_SCHEDULES）
src/edge/router.js（更新: AI_QUOTA 配置/facts 注入/handleFact）  src/index.js（更新: /v2/fact 路由）
test/plugins/ai-quota.e2e.test.js（新增）  test/{edge/router,plugins/alarms.e2e}.test.js（更新: 假 loader +loadFacts）
```

### 遗留 → V13

cadence 泛化（本文件冷却构造抽 kinds 库→任务纯配置）、notices(pulse 实装)、
Pages 管理前端（读 /v2/facts+/v2/timeline、写 /v2/fact 的纠偏控制台）。

---

## 契约15 增补（中立规则原则）✅ 2026-07-16，累计 66 用例全绿

- KERNEL 升 v0.4: 消费者只认规则名不认生产者；规则不属于任何消费者；"想看别人的值"
  = 升格为命名规则让双方订阅。删除矩阵已验证: 删任一消费者→另一方零感知；
  删 quiet→双方各自落地无主张 + audit 悬空大字报。
- **media_volume 配置修正**（router.js V2_DEFAULTS）: 原 OWN 抄写 quiet 的四个边界数字
  （巧合冒充共用）→ 改为 `USE:"quiet", MAP:{on:0, off:null}`。
  行为差异 vs v1: 进入安静(12:15/20:55)照旧归零且每次进入重申(null→0 是变化)；
  **解除时刻(07:40/13:29)不再补一次归零**——解除后无主张，白天手动调的音量存活到下一次
  进入安静。与"media_volume 用 on_change"的裁决一致。想要 v1 的解除也归零 → `off: 0`。
- 更新: src/edge/router.js · docs/KERNEL.md · test/edge/router.test.js · test/kernel/fields.test.js

---

## 长假夜间重进修正（KERNEL v0.5）✅ 2026-07-16，累计 66 用例全绿

用户推演"3天以上假期 silent 是什么规则"时暴露真 bug: level 合并使长假夜间 22:25
不再是值变化, on_change 下"白天手动取消静音→整个假期夜里不再重进", 偏离 v1 刺客
夜夜点火的语义。修正: R6.2a/c 从"不输出"改为**产出 null 释放边界**（07:40/09:30）,
时间线变 on→null→on 交替——白天无主张(手动自由), 夜间 null→on 为真变化夜夜重进。
配套执行器规则(契约4增补): **期望 null → 删除 last_applied[f]**。
更新: src/plugins/quiet.js · docs/KERNEL.md · docs/PHONE-V2.md ·
test/plugins/quiet.e2e.test.js · test/edge/router.test.js

---

## V13 清单增补（2026-07-16 讨论定案）

- **漂移观测 P1**: 手机回传 `applied_state` 事实流（服务端零改动，/v2/fact 通吃）;
  /v2/timeline 并排"期望 vs 最后回报" + audit 持续漂移 warn。P2 advisory diff 双轨,
  P3 翻转权威（门槛见 KERNEL §14）。权威留本地 last_applied, 云端 diff 只是观点。

- **延迟实验仪表已埋**（2026-07-16）: /v2/fact 读写响应回声 colo, 存储事件附加
  received_at/colo 观测字段（契约12 容忍）。探针与被动观测流程见 PHONE-V2 §7.5。
  数据裁决 P3 底座: KV 够用 vs Durable Object。

---

## 对拍第一轮（周五场景）✅ 2026-07-17 裁决，累计 67 用例全绿

判例入 PARITY.md §5: 闹钟差异=窗口锚点(方法, 补 now=00:00) · audit 孤儿误报(已修) ·
focus 07:40 守卫缺失(已修, V2_DEFAULTS 继承) · EXTERNAL_ALARMS 裸 URL(用户环境, v1 同病)。
media_volume 22:25 归零属契约15 声明差异。新增 docs/PARITY.md 对拍手册。
