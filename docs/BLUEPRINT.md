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

---

## 对拍第二轮（请假三连 + 上帝模式）✅ 2026-07-17 裁决，累计 69 用例全绿

- 请假三连全过: 11-06 R6.2b早解除+请假入3天块+铃全灭 · 11-07 R3.2跳课+null释放 ·
  11-09 节后首日铃。外部闹钟 env 修复后 Gate-ES 链路 v2 验证通过。
- 上帝模式: **v1/v2 双双 JSON 解析失败**（日历描述被 iOS 智能标点污染, 非迁移 bug）。
  修复两件: ① god-mode 增 normalizeSmartJson（弯引号/全角标点/零宽字符容错,
  现有日历事件大概率免重打字）; ② registry 增**诊断通道**——produce 可返回
  {segments, notes}, notes 转 trace（纯度不破）; god 解析失败从静默吞错改为
  error 大字报含日期与错误信息。PARITY §5 判例追加。

---

## 上帝模式真凶定案（第三轮）✅ 2026-07-17，累计 70 用例全绿

用户提供 ICS 原文后翻案: 引号是直的, 智能标点诊断作废。真凶 = **ics-parser 反转义
不完整**——RFC 5545 要求 TEXT 的逗号转义为 \, 分号为 \;, 解析器只还原了 \n,
反斜杠残留使 JSON.parse 在 position 67 失败。此为 v1 时代潜伏缺陷(v1 同错为证)。
修复: ics-parser.js 新增 unescapeIcsText 单趟反转义(\\ \; \, \n\N), 折行展开
兼容 TAB 续行。**v1/v2 共用此文件, 一次修复两版同愈**。用户 07-22 实案的原始
转义形态已固化为端到端回归用例。智能标点容错(normalizeSmartJson)保留——防的是
另一类真实输入(手打 JSON 被键盘替换)。

---

## 对拍收官 + current_state 回归 ✅ 2026-07-17，累计 71 用例全绿

上帝模式实拍通过(两版同愈, v1 史上首次跑通含逗号 JSON), 半天假顺带验收。对拍判收官。
用户反馈 point 不如 v1 current_state 直观 → 信封 point 模式追加 current_state
"时刻优先"投影(命中时刻+全字段值包+对账标志, null=装死), changes 保留为明细——
刺客迁移退化为"换 URL+认 token"。RULEBOOK §7 增 god v2 模板(旧格式永久兼容)。

- **迟到断言窗口定案**（2026-07-17, 用户审阅 PHONE-V2 时提出）: 整点轮询使边界断言
  最晚迟到1小时, 期间手动操作会被吃掉一次。裁决: 边界刺客长期保留且写同一份
  last_applied(准点断言+落账), 轮询降级为自愈兜底——互补双轨, 非替代。PHONE-V2
  §3 防覆盖三层保证 + §5 修订已入文。

---

## 精准化收口 + i18n 实装 ✅ 2026-07-17，累计 72 用例全绿（KERNEL v0.6）

用户三问(命名精准/词典上云预备/手机扩展性)裁决: ① KERNEL §18 规范性术语表——
action 双语境/switch_to/from-at-generated_at 分工/哨兵 none 边界/值类型三法则等
全部钉死, 新键先查表; ② ?locales= 参数实装, 信封按需下发 i18n.focus_name_to_token
反查表(edge/i18n.js, 数据即扩展; token 唯一权威, 显示名永不比较不入 LA);
③ PHONE-V2 §0.5 扩展承诺清单(零改/改一处/克隆块/冻结禁区四档)。

- **文本化三明治定案**（2026-07-17, 用户审出规范落差）: 铁则1 升级为机械步骤——
  比较操作数一律先过 Text 动作(S2b/S3b/F6b); 判空用原始变量。病灶: media_volume
  数字型 vs 哨兵文本混型比较行为不定型。PHONE-V2 §0/§3.1/§3.2/§3.3/§8 已修。

- **§3 逐动作脚本二审重写**（2026-07-17, 用户审出 S10 同病+命名过密）: 铁则1 终版
  "If 输入与条件对象必须全文本, 判空用原始值"; 新增铁则4 命名纪律(八名封顶,
  一次性值用魔法变量, 复取宁可重 Get); 复查抓出 enforce 压过守卫 skip 的隐藏 bug
  (F33–F36 嵌套修复)。§3.1/3.2/3.3/3.4 干净重编号。

- **标记判空定案**（2026-07-17, 带练AI报 0 即空怪癖）: 诊断采纳修法否决——其"空文本
  判空False"赌了怪癖另一面。终案: Text 前缀 X + is X 的确定性相等比较, 三块统一,
  has any value 全面弃用。§3.1 重写(null 分支前置), §3.2 头尾改造, §3.3/坑表更新。

- **守卫段一致性收尾**（2026-07-17）: §3.2 残留的两处 has any value 换标记法(F14/F21),
  全手册 has any value 零残留——铁律无豁免, 免除未来一切个案论证。§3.2 终版 55 步。

---

## 冻结批次改名 v0.7 ✅ 2026-07-17，累计 72 用例全绿

用户五项裁决落地(直接改 v2 现役, 无兼容层):
① focus 值 `mode`→`preset`, mode 全系统退役(?mode=URL参数除外); ② Gate 标签两族
`GateFix-`/`GateDyn-`, 后段全称保留(用户定: 逻辑不变只换前缀), Gate-AIQ→GateDyn-CAD;
③ ai_quota 归位 cadence: 字段 fields.cadence.ai_claude 命名空间就绪, 标签族 GateDyn-CAD,
cadenceLabel() 取代 aiqLabel(); ④ KERNEL v0.7: 命名明确性纲领(明确压倒简洁) +
§17.5 两类铁律(政策随时改/不变量抽承重柱, 回传=事实可进·实况不可进); ⑤ 文档整理:
v1 时代 7 份移入 docs/_archive-v1/, todo/Bark 蓝图+CHANNELS+勘误入库, INDEX.md 总索引
+ P1–P8 路线图, RENAME-V0.7.md 改名总表与手机闹钟清单。
真嵌套 cadence 字段推迟至 V13(改 fields 渲染核心, 现命名空间字符串键已平滑铺路)。
外部依赖冗余原则(push driver 可换)记入 INDEX。

---

## 回传自愈方向补齐 ✅ 2026-07-17（应用户"闹钟对账似乎没提到"）

用户指出 INDEX 只一行半、对话里的回传自愈决定未落文档(返工风险)。补 FEEDBACK-SELFHEAL.md
方向定稿: 三阶段(观测/建议/自愈)、三条回传 stream(applied_state/alarm_inventory delta优先/
manual_override)、固定+动态闹钟各自 diff 矩阵(缺失/状态错/时间错/残留)、漂移分级→
CHANNELS 通道路由、自愈铁律(只建不删/固定不自动建/本地最终裁判/回传是事实非实况)、
接口预留清单(冻结形状防两头大改)。KERNEL §14 与 INDEX P3 加文档指针。

---

## 交接文档体系完成 ✅ 2026-07-17（为换对话开发 todo通道/cadence 备）

用户明确后续换对话开发，需严密防偏移。定案:
① todo 三层定义钉死(HORIZON §6 + KERNEL §18): 开发方向说"todo 通道"、网关字段 `todo`、
手机落地 reminder; 边界双名制(过网关↔手机边界词必换，网关禁iPhone词汇)。
② 新增 HANDOFF.md 交接契约: 强制阅读顺序、九条不变量浓缩、两任务(todo通道/cadence)
专属契约、服务端落点速查表、"疑似改架构即停"闸。INDEX 置顶指引。
③ HORIZON.md 远期账本: 每方向标"已铺的路/到时才做/不堵死纪律"; 术语清扫表列未来待改
歧义字段(EXTERNAL_ALARMS统一、type嗅探、severity vs landing 分层)。
纯文档批次，零代码改动，72 用例不变。

---

## 手机端 focus 块两处修正 ✅ 2026-07-17（用户拼装时发现）

① **多语言字典下沉云端**: PHONE-V2 §1 原让本地内嵌 Dictionary(与云端 i18n 实装自相矛盾)。
改为请求带 &locales=、守卫段 F19 从 CloudState.i18n.focus_name_to_token 取表。换日/韩语=
云端 FOCUS_NAMES 加节(已加 ja/ko 占位), 手机零改。
② **关闭专注不再定死**(修 v1 退化): F50–F54 原"关掉写死的勿扰", 手动开的睡眠等关不掉。
改为 开→按 fields.focus.value.preset 选具体专注; 关→Set Focus Turn Off 通杀当前任意专注。
比 v1"读当前再关"更干净。src/edge/i18n.js 加 ja/ko; PHONE-V2 §0/§1/§3.2/§8 更新。

---

## focus 开关不对称定案 ✅ 2026-07-17（用户追问"开别的模式要新建指令吗"）

答: 不用新建指令，同 ApplyState 内加开启分支即可。根因披露: **iOS 的 Set Focus 开启哪个
专注是编辑期选死、不吃变量**(系统限制非 bug)，故开启必须每 preset 一个 Set Focus 分支
(F52+，用 WantPreset 选)；关闭反而是 Set Focus→Turn Off 一个通杀(F48)。**开关不对称**。
上一版残留"开关都定死勿扰"的错块已彻底清除。加睡眠/工作=复制一个开启 If 分支，关闭永不动。
服务端多 preset 方向记入 HORIZON §6.5(focus 值 preset 已是自由 token)。PHONE-V2 §3.2/§8 更新。

---

## focus 执行段翻案 ✅ 2026-07-17（用户翻出 v1 PHONE.md 证伪我的"iOS限制"误述）

我先前断言"Set Focus 开哪个专注编辑期选死、不吃变量"是**错的**。v1 PHONE.md §3 实证:
`Turn $NowText Off` / `Turn $ModeText On` —— Set Focus **吃本机名文本变量**。撤销"每 preset
一分支/开关不对称"的错误方案。正解 = 融合 v1 变量机制 + v2 token/云端字典:
① i18n 节新增反向表 focus_token_to_name(token→本机名); ② 执行段用 focus_token_to_name[preset]
查出本机名喂给 Set Focus Turn On/Off, **一个动作通吃所有 preset**; ③ 多语言天然解决——
换语言云端换表, Set Focus 拿到的永远是对的本机名, 手机零改; ④ 开启保留 v1"先关当前别的
再开期望"、关闭保留 v1"当前是期望关它否则关当前"语义。src/edge/i18n.js 双向表 +
router 信封两表 + PHONE-V2 §1/§3.2/§8 重写。

---

## 守卫泛化方向 + v1能力对等审计 ✅ 2026-07-17（用户拼装中发现两问题）

① 守卫泛化: only_if_current 升级为 guards 数组(source: current_focus/app/locked/…,
op: is/is_not/…), 全满足才执行; only_if_current 保留为单守卫语法糖。手机端 CheckGuards
独立子指令, 加守卫种类只改一处、三字段共享, 不回插主逻辑。方向文档 GUARDS-AND-PARITY.md。
② v1→v2 能力对等审计: 逐条核对 v1 PHONE.md, 确认曾丢两处(Set Focus 变量/守卫完整能力)
已修, v2 另有 last_applied/guards 两增强。教训入 HANDOFF 第10条: 大版本迁移必做能力清点。
③ 多语言 Set Focus 是否需 locales: 阻塞在 2 分钟手机实测(喂英文名能否开勿扰), 待用户测后
定死——能则删 locales 简化, 否则保留现方案。纯文档/方向批次, 代码零改, 72 用例不变。

---

## 多语言 locales 定案（撤销上一轮冗余待测）✅ 2026-07-17

用户指出: 多语言"必须本机语言名开关 focus"早在 DEVLOG 2.1 实测定论(Turn 用专注名文本变量
+ priming)，我上一轮又标"待手机实测"是倒退。已撤销: GUARDS-AND-PARITY §3 改为定案(保留
locales + token→本机名反查，依据 DEVLOG 2.1); PHONE-V2 §3.2 警示改为"已定案不用测"。
教训: 已有实测文档的结论不得让用户重测——动手机方案前先查 DEVLOG/PHONE-FEASIBILITY。

---

## 守卫泛化落地 + 手机端 v3.0 独立模块重构 ✅ 2026-07-17（73 用例全绿）

应用户要求全面重构:
① **服务端 guards 翻译**(edge/assemble.js normalizeGuards): only_if_current 自动并入
   focus 值的 guards 数组并移除原字段, segment/point/current_state 三路统一 —— 手机端
   下发永远只见 guards, 一套守卫逻辑。KERNEL §18 登记 guards/source/op/only_if_current。
② **PHONE-V2 升 v3.0 独立模块架构**: 每字段完全独立快捷指令(ApplySilent/ApplyFocus/
   ApplyVolume), 不拼大模块; 守卫抽成通用 CheckGuards 子指令三字段共用, 加守卫种类只改
   一处; last_applied 每字段独立文件防并发覆盖; RunAll 仅可选调度。
③ **priming 更正**(DEVLOG 2.1): Turn Focus 无需 priming 前置(当年误归因); Get Current
   Focus 仅切换/守卫比对时读。focus 执行段据此保留 v1 变量机制 + 云端本机名反查。
④ 守卫审计: current_focus 保留、新增 app/locked source 词表、op is/is_not, 未来
   charging/wifi/battery 加分支即可。

---

## 第三方 AI 推演采纳: 三 bug 修复 + guards 提字段级 + 多语言双层 ✅ 2026-07-17（73 用例）

用户转来第三方 AI 全流程沙盘推演，逐条核验:
① **guards 层级 bug(严重)**: focus 守卫读 .value.guards 多一层 → 永久失效。根因是服务端
   把 guards 塞进 value 内部、与 silent/volume 字段级不一致。**修法改服务端**: extractGuards
   把 guards 提到【字段级】(fields.<x>.guards)，三字段路径统一，focus 也一致。手机端 F3 改
   fields.focus.guards。(assemble.js + 测试更新)
② **CheckGuards 未短路**: Repeat 里 Set 变量不跳出、空跑拖慢+污染 → 改 Stop and Output 短路。
③ **文件路径套娃**: Shortcuts/ 前缀在预设根目录下会套 Shortcuts/Shortcuts/ → 只填文件名。
④ ApplyVolume 复制盲区(guards 路径)、focus off 空 preset 兜底(F29-35 已覆盖) — 文档强化。
⑤ **多语言双层策略**(用户提+AI 问共同促成): 层1 系统语言传参(主路径)+ 层2 失败换名重试
   (候选名数组穷举兜底)，三重保险防 iOS 更新改译名。i18n.js 留候选名数组扩展方向。
Bark 增控制能力归 P2(方向已在 CHANNELS)。

---

## 第三方 AI 推演二采纳: 候选名数组穷举实装 ✅ 2026-07-17（73 用例）

AI 指出 §4 F20 取候选名数组若强转 Text 会变 "A, B" 死文本喂 Set Focus 失效——真 bug，采纳。
但其修复片段把"先关当前"塞进候选循环内有偶尔漏关隐患，修正为: **关当前只做一次、在
Repeat 外**；循环内只"试开一个候选名 + Get Current Focus 验证 + 成功 Stop 短路"。
配套服务端: i18n.js token_to_name 从单名改为**候选名数组**(按 locales 优先级)，兑现
GUARDS §3.1 层2 穷举兜底。PHONE-V2 §1/§4/§坑表 + i18n.js + 测试更新。

---

## 第三方 AI 推演三采纳: focus 签名比对 + 防翻转闪烁 ✅ 2026-07-17

AI 戳中真 bug: 我声称"多 preset 天然支持"，但 la_focus 只存 action → 跨 preset 同 action
切换(勿扰on→睡眠on)被 on_change 判"没变"跳过、新 preset 永不生效。**这是我埋了数轮的空头
支票**。采纳修复: Expect 升为签名 `preset|action`(F10b)，落账存签名(F32/F40)，**preset 用
token 故签名跨语言稳定**(AI 未提但关键，否则换语言签名变、天天误判)。§5 记 focus 存签名。
优化二采纳: 无脑清场在"当前已是目标专注"时 On→Off→On 翻转，连累绑该专注的其他 iOS 自动化
误触发两次 → F24a 加"当前专注在候选名单里则跳过清场"，循环内 Turn On 幂等覆盖。
纯手机文档批次，服务端未动(签名在手机侧拼)，73 用例不变。
