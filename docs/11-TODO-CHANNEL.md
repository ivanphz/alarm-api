# 11-TODO-CHANNEL — todo 执行通道（设计定稿，待实施）

> 服务端可先行、不依赖手机端；手机端工作量是全项目最大的一块。

---

## §0 术语：todo 三层定义（钉死，聊天与代码都按此）

「todo」这个词曾经同时指三样东西，做这块之前先把它拆开：

| 层 | 唯一术语 | 定义 | 出现在 |
|---|---|---|---|
| 开发方向 | **「todo 通道」**（禁止单说 todo） | 一整块开发工作 | 聊天、路线图 |
| 网关侧 | **`todo` / `todos`** | 与 alarm 平级的输出通道，产出**平台中性**条目 | 服务端代码、信封 |
| 手机侧 | **reminder / 提醒事项** | iPhone Reminders App 的实体 | 手机端文档、快捷指令 |

### 边界翻译铁律

`todo` 与 `reminder` 是**同一件事在边界两侧的两个名字**。过「网关↔手机」边界，词必须换 ——
**网关永远说 todo**（它不知道 iPhone），**手机永远说 reminder**（它在操作那个 App）。
翻译发生在 SyncTodos 指令里，与 focus 的 `preset` → Set Focus 同构。

> **防复发机制**：任何跨边界的词，必须能回答「它属于哪一侧概念」——
> 网关侧禁用一切 iPhone 词汇（列表 / urgent / alert / 归档 / 提醒事项）。
> 新增字段前问一句：**这个词在对话里会不会指两个东西？**

另：`severity`（域声明的重要度：critical/high/normal/low）与 `landing`
（落地形态：urgent/alert/silent）**不是同义词**，是两层，映射关系在网关的源配置里。

---

> **状态**: 契约与裁决全部定稿，**待实施**。服务端可先行，不依赖手机端。
> **本文来源**: 由 `PROMPT-alarm-api-todo-channel.md`（服务端）+ `PROMPT-phone-synctodos.md`
> （手机端）+ `V12-ADDENDUM.md`（坐标勘误）三份合并而成。**原三份的 v1 坐标已全部翻译到
> V12/v2，勘误补丁不再单独存在**——本文即最终坐标，冲突时以本文为准，架构听 09-KERNEL.md。
>
> **配套必读**: 09-KERNEL.md（宪法）· 05-FACTS.md（通道能力实测台账，选型判据）·
> 02-RULES.md（改法）· 04-PHONE.md（执行器）。

---

## 0.1 ⚠️ 本稿写于 2026-07-17，三处已被现状超前

| 原稿假设 | 现状 |
|---|---|
| Bark 通道待建 | ✅ 已建（门铃），`edge/push.js` + 多目标 `PUSH_TARGETS` |
| 回传端点待建 | ✅ `/v2/fact` 已支持批量 `{events:[...]}` |
| 「服务端可先行，不依赖手机端」 | 仍成立，但**优先级已排在回传自愈之后**（[07-ROADMAP](07-ROADMAP.md)）—— 自愈是当前唯一缺口 |

其余（分工、坐标、身份标记、墓碑三连、执行预算）全部有效，实施时照本文走。

---

## 0. 术语纪律（先背，这块最容易翻车）

**todo 三层定义**（HORIZON §6 钉死，聊天与代码都按此）:

| 层 | 唯一术语 | 定义 | 出现在 |
|---|---|---|---|
| 开发方向 | **"todo 通道"**（禁止单说 todo） | 一整块开发工作 | 聊天、路线图、DEVLOG |
| 网关侧 | **`todo` / `todos`** | 与 alarm 平级的输出通道，产出**平台中性**条目 | 服务端代码、/v2 信封 |
| 手机侧 | **reminder / 提醒事项** | iPhone Reminders App 的实体 | 手机端文档、快捷指令 |

**边界翻译铁律**: `todo` 与 `reminder` 是**同一件事在边界两侧的两个名字**。
翻译发生在 SyncTodos 指令里（读信封 todos → 落地成 reminder），与 focus 的
`preset → Set Focus 本机名` 同构。
🚫 **严禁在服务端代码/信封出现 `reminder`、列表、urgent、alert、归档、提醒事项等 iPhone 词汇。**

**另外两个易混词**（[09-KERNEL](09-KERNEL.md) §18）:
- `severity` = **域声明的重要度**（critical/high/normal/low），乙方/源说了算。
- `landing` = **落地形态**（urgent/alert/silent），网关按源配置映射得出。
- 二者**不同层**，映射表在源配置里。⚠️ 不叫 `mode`——`mode` 已被 focus preset 与
  `?mode=` URL 参数占用，撞名即语义污染。

---

# 第一部分 · 服务端（手术 A）

## 1. 分工

网关负责：拉源、净化校验、时区换算、拼身份标记、算"当前应存在的未来 todo 全集"、下发。
手机负责：upsert + 墓碑归档（第二部分）。
**一源一通道**：todo 源是独立登记项，闹钟协议一字不动。

## 2. 落点坐标（⚠️ /v1 已冻结，todos 只许进 /v2）

| 要加什么 | 落点 |
|---|---|
| todos 节 | **`/v2/state` 信封新增 `todos` 节**（与 `alarms` 节并列）。<br>注：v1 已于 2026-07-27 整体下线，"/v1 不动"这条约束已消失 |
| 对账提示标志 | ⚠️ 原文写 `reconcile_todos`（对标 `reconcile_alarms`），但 **`reconcile_alarms` 已于 2026-07-25 退休**，现名 `alarms.sweep`（字符串 `"true"/"false"` 的**授权位**）。<br>→ 实施时应叫 **`todos.sweep`**，与 alarms 同构 |
| 拉源 / 净化（I/O 半场） | `edge/sources.js` 新增 `loadTodoSources` |
| 窗口 / severity→landing 映射（采样期半场） | `edge/assemble.js` 新增 `assembleTodos` |
| 身份标记构造 | `domain/alarm-labels.js` 新增 `tdMarker(code, uid)` —— Gate 家族单一构造点 |
| 源配置 | `config.default.js` 新增 `TODO_SOURCES` 段 + `env` 隐私源（同 EXTERNAL_ALARMS 双轨） |
| 诊断 | **结构化 trace** `{level, plugin:"todos", ref, msg}`（KERNEL §13，出口渲染） |
| Bark 出站 | ✅ **`edge/push.js` 已建**（2026-07-30 随门铃做的）—— 驱动接口 `send({title,body,level})`，加通道只加一个函数。配置见 [06-OPERATIONS](06-OPERATIONS.md) §0.1 |

**⛔ 不进插件**：拉源是 I/O（契约7 纯度红线），时区换算/映射是采样期概念。
与外部闹钟同构分工，照 `loadExternalAlarms` / `assembleAlarms` 抄形态。

## 3. 源配置（源级；iPhone 概念全住这里）

```js
{
  name: '还款待办', type: 'todo-json', code: 'repay',
  url: 'https://<calendar-api>/?cal=card&format=todo',
  list: '账单',            // 落到哪个提醒事项列表（手机侧须预建）
  leadDays: 3,             // 采纳窗口: 到期前 N 天开始出现在清单（todo 的 horizon，与闹钟 24h 窗口无关）
  severityMap: {           // severity → landing（缺省即此，可覆盖）
    high: 'urgent', normal: 'alert', low: 'silent'
  },
  defaultTime: '09:30',    // 无 time 条目的到期钟点兜底
  enabled: true, timeoutMs: 5000
}
```

> `list` 是 iPhone 概念，**只允许出现在源配置这一处**（它是"这个源落到哪"的路由声明，
> 不是网关对 iPhone 的知识）。信封里 `list` 原样透传，网关不解释其含义。

## 4. 身份标记（同 label 哲学：uid 纯身份，网关拼落地形态）

- 提醒事项 **URL 字段** = `gate-td://<code>/<uid>`（全 ASCII；净化同 ES：code≤16、uid≤40）。
- **标记不含时间**（与 `GateDyn-ES-*-HHMM` 相反！）：铃伴生于日期、**改期即改铃**（实测 R4），
  身份无需换壳。这是 todo 与闹钟的关键差异——闹钟没有"改时间"动作，todo 有。
- 墓碑前缀 `gate-tdx://` 预留给手机侧归档机制（对在役查询隐形），**网关永不生成、永不下发**。
- Title/Notes = 源条目原样（人话归人话，标记归 URL，互不污染）。
- `gate-td://` 语法一经上线即**冻结**，同 KERNEL §12 纪律。

## 5. 下发契约（网关 → 手机）

信封新增 `todos` 节 + `reconcile_todos` 标志。每条：

```json
{ "marker": "gate-td://repay/cmb-202608",
  "title": "招行还款", "notes": "…", "list": "账单",
  "due_date": "2026-08-07", "due_time": "09:30",
  "landing": "urgent" }
```

⚠️ 键名全 snake_case（`due_date` / `due_time`，不是 dueDate/dueTime）。
网关已做完时区换算与 severity→landing 映射，**手机零判断照单执行**。

**全集语义**：`todos` 节 = "此刻应存在的全部未来 todo"（leadDays 窗口内）。
手机据此 upsert + 归档。**过期条目网关不下发也不指示删除**（过去归用户）。

## 6. 治理与降级（沿用既有哲学）

- 逐源 try/catch + 超时；拒收计数进结构化 trace：
  `{level:"info", plugin:"todos", ref:"todo_loaded", msg:"还款(repay): 候选N 窗口内M (拒:无uid a/格式 b/窗口外 c/时区 d)"}`
- 违规条目**响亮熔断该条**，绝不静默修复。
- 最外层兜底网语义不变：`todos` 缺省空数组，手机见空 = 什么都不做。

## 7. Bark 推送命令通道（手术 B）

- 新增出站模块 `edge/push.js`，向自托管 bark-server POST。**BARK_KEY 走 Cloudflare Secret。**
- **适配器纪律**（INDEX 外部依赖冗余原则）：push 是接口，Bark 只是一个 driver
  （可换 ntfy/WebPush）。哪天 Bark 付费/关停，换 driver 不动主逻辑。
- 消息形状：
  - `title` = **路由关键词**（手机侧按 Title contains 分流）
  - `body` = 人话摘要（**给人看的，不是指令**）
  - `level` 两类：**机器门铃一律 `active`**（零打扰、照触发，实测 B1）；
    给人的紧急事件才 `timeSensitive`/`critical`。
- **推送语义（实测）**：边沿触发、不可靠、手机侧单槽忙碌即丢（B3/B4）。据此：
  关键变更（god-mode、请假）**回响双发**——同一幂等门铃发两次，间隔 ≥ 2 分钟
  （大于单轮同步最坏时长）；普通变更单发即可。
  推送失败/丢失的最坏后果 = 延迟到下个心跳，**心跳地基永不撤**。
- **触发点挂 edge 层**（god-mode/请假变更检测属采样期比对，**不进插件**——契约7）。
- 触发时机（首批保守）：god-mode 变更、请假写入、上游数据缺口告警。以后再扩。

## 8. 命令通道纪律（CHANNELS §5，实现时内嵌注释）

1. **门铃不是信件**：通知内容只做路由（关键词选指令），**永不作为指令内容**；
   被触发的指令一律带 key 去 GET 网关拿权威状态。泄露 Bark key 最坏 = 骚扰门铃。
2. **推送是快路径不是地基**。
3. **计划内归定时，计划外归推送**。
4. **完成语义归人**：任何自动化不得把提醒事项置为已完成。
5. **机器门铃用 active 档**：零打扰、照触发；critical 只留给必须叫醒人的事。

---

# 第二部分 · 手机端（SyncTodos）

> 本节是**行为契约**，据此在 04-PHONE.md 展开为逐动作脚本。
> 全部机制均有实测支撑（CHANNELS §6），**实施时不得凭直觉翻案**。
> 04-PHONE.md 铁则四条适用：文本比较 / 标记判空 / 守卫不落账 / 命名八名封顶。

## 9. 铁律（先背再建）

1. **完成语义归人**：任何指令永不把「Is Completed」置为真。
2. **无人值守只建只改，绝不删**：Remove 需人工确认（实测），只出现在人工清扫仪式。
3. **过去归用户**：已过期条目一概不碰——"你漏了这件事"正是待办的价值。
4. **关键动作不置尾，正确性不依赖"跑完"**：后台预算 40~80 秒非确定被掐、**掐尾部**（E1）。
   upsert 幂等天然免疫：掐哪儿算哪儿，下轮补齐。

## 10. SyncTodos 对账（upsert）

网络调用**有且仅有一次**：拉网关 `todos` 全集。对每条：

1. `Find Reminders where URL contains <marker>` —— **不加完成状态过滤**
   （已完成的也要命中，否则用户勾完的条目会被重建成僵尸）。
2. **无命中** → Add Reminder：列表=`list`、标题/备注、到期=`due_date`+`due_time`、URL=`marker`，
   landing：`urgent`→开 Urgent；`alert`→Alert At Time；`silent`→No Alert。
3. **命中且已完成** → 跳过（铁律 1 的另一面：不覆盖、不改期、不复活）。
4. **命中且未完成** → Set Detail 幂等覆写 Due Date / Title / Notes。
   改期在此自然生效：**铃伴生于日期，改期即改铃**（R4 实测），无需删旧建新。
5. **landing 变更**（下发 landing ≠ 现存形态）：**Urgent 是出生属性、Set Detail 改不了**
   → 走 §11 墓碑三连 + 按新 landing 新建，全程静默。

## 11. 归档 = 墓碑三连（处理"取消"与"换壳"）

语义：网关全集里没有、但清单里有、且到期在未来、且未完成 = 已取消。

**查询**：URL contains `gate-td://` ∧ Is Not Completed ∧ Due Date **is in the next** N 天
（N = leadDays；此运算符同时表达"在未来"与"在窗口内"，天然排除过期条目）
∧ 逐条比对不在本次下发全集。

**对每条命中执行三连**：
1. **Set List → 「归档」**（离开视野）
2. **Set Due Date → 喂固定串 `none`**（任意非日期文本即清空日期——日期没了铃就没了。
   **E2 实测：这是唯一可靠的静默消铃手段，移列表本身不消铃**）
3. **Set URL → 前缀改写** `gate-td://` → `gate-tdx://`（墓碑对一切在役查询隐形）

**复活即重生**：上游若重新吐同一 uid，去重查询（`gate-td://`）查不到墓碑 → 自然全新建，
Urgent 等出生属性全套齐整。**不做原地救活，不需要任何特判。**

## 12. 清扫仪式（人工，低频）

手动跑：Find URL contains `gate-tdx://` 全部 → Remove（**会弹一次人工确认，
这是设计的一部分**——破坏性动作留人一道闸）。可顺带清 Completion Date 早于 90 天的
已完成老条目，同一次确认。归档列表平时就是待清扫暂存区，堆着无害。

## 13. 触发器布线

- **定时 = 电平地基**：已知边界时刻 + 低频心跳（2~4 小时）。
- **门铃 = Bark active 档**：`收到 Bark 通知 ∧ Title contains <关键词>` → 对应指令。
  Automation 开、Notify 关。单槽忙丢（B3/B4）：门铃可能蒸发，靠网关回响推送 + 心跳兜底，
  **手机侧无须任何处理**。
- **起床钩子**：`When Any Alarm Is Stopped` → 取 **Shortcut Input** 的 Label 判 `GateFix-` 前缀分流
  （勿用 Goes Off——那是响起未醒；勿在选择器绑死具体闹钟对象；
  动态闹钟停止会进同一触发器，靠 Label 前缀滤掉）。
- **盲窗认知**：重启后首次解锁前动作不落地（E3），解锁后首次心跳/门铃幂等补齐，不做特殊处理。
- **SyncTodos 与 SyncAlarms 分开两条指令**，各自失败互不拖累。

## 14. 执行预算三规则（E1）

单轮目标 < 30 秒（预算 40~80s 的三倍余量内）；网络调用一次；
日志（Append to Note 台账）只做观测、**永不承载正确性**。

## 15. 预建物清单（一次性）

各源提醒事项列表（如「账单」）、「归档」列表、Bark App + 自托管 server、
门铃自动化若干（active 档）、起床钩子自动化、**提醒事项"闹钟"权限**（Urgent 需要）、
观测台账 Note。

---

## 16. 架构对位（心智地图）

- `todos` = "此刻应存在的未来 todo 全集" = **闹钟即状态**的提醒事项版；
  手机 upsert + 墓碑 = reconcile。同一个 level 语义，换了个落点。
- KERNEL §10 预留的 cadence `channel: "todo"` 由此兑现——**将来 cadence 任务把 channel
  设为 todo 时，产物路由进同一个 `todos` 节**，本次实现即为其铺轨。
- 外部 todo 源走 `sources → assemble` 路径（同外部闹钟，不需要插件）；
  将来内生 todo（cadence）走 `插件 → assemble` 汇入，两路在 `assembleTodos` **并集**。
- **自愈复用同一通道**：FEEDBACK-SELFHEAL 的漂移提醒走的就是本次建好的 `reconcile_todos`。
  故实施顺序：**todo 通道 → Bark → 回传观测 → 自愈**，前面每块都为后面备好零件。
- 同一业务事件允许**同时**进闹钟通道与 todo 通道（两套 uid 空间、互不相识）。

## 17. 验收

- 不得触碰 `kernel/` 目录（验收九条延续）。
- 治理硬熔断风格沿用 `assembleAlarms` 的拒收计数 trace。
- 测试：源解析 / 净化 / 窗口 / severity→landing 映射 / 降级各一组，含反例。
- 新 token 补进 [09-KERNEL](09-KERNEL.md) §18：`landing`、`reconcile_todos`、`gate-td://`、`gate-tdx://`。
- 改了信封 → **同步更新 04-PHONE.md 新增 §SyncTodos 章**。

## 18. 留给现场裁决（实施时问 Ivan）

- `todos` 节并入主响应还是独立端点（**倾向并入**，省一次拉取；确认体积与超时预算）。
- ICS 途径 `[[TD:uid]]` 首批做不做（calendar-api 走 JSON 正门，ICS 只为未来乙方）。
- Bark level 与事件类型的映射表定稿。
- **Add Reminder 的 List 参数是否吃变量**（建指令首日自明）：吃 = 平铺循环照契约；
  不吃 = 网关按 list 分组下发、手机按列表分支写死。**契约不变，仅实现分叉。**

## 19. 外部源格式

首批可要求源声明 `type: 'todo-json' | 'todo-ics'`；
**格式嗅探留后**（HORIZON §5：试 `JSON.parse` → 含 `BEGIN:VCALENDAR` → 报响亮错误）。
随本通道一起做最省——届时闹钟源与 todo 源共用一个 `sniffFormat()`。

> 另一仓库（calendar-api）的 todo 出口是**独立轨道**，随时可做，不阻塞本文。
