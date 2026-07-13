# DEVLOG — 开发日志与决策考古（ios-alarm-api）

> **给谁看**：未来的维护者，尤其是新开的 AI 会话。目的只有一个：**不重走弯路**。
> 每条按"现象 → 根因 → 定案 → 为什么不选别的"写。总体架构见 `ARCHITECTURE.md`。
> 当前版本：**V11（全解耦版）**。

---

## 1. 版本演进时间线（浓缩）

| 版本 | 里程碑 |
|---|---|
| V7.x | 单文件 Worker，基础 DND/闹钟逻辑 |
| V9 | 多文件 ES 模块拆分；规则引擎 R1~R6（上帝模式/底色/上课/碰撞/DND）；humanReadable 审计面板 |
| V10 | 字段独立引擎（focus/silent/volume 各管各）；两层配置 default/user 深合并；fail-closed 鉴权 |
| V10.1 | `FOCUS.OWN` 收编 GUARD/CUSTOM_ACTIONS（每时刻定制单一入口）；config.user 纯增量化（333→40 行） |
| **V11** | **命名规则+字段订阅全解耦**（USE/MAP/SKIP/OWN + 孤儿审计）；外部闹钟 `Gate-ES` 体系（甲方契约）；时间参数归一化/互填；workdays-core 迁移；**最外层兜底网** |

---

## 2. iOS 快捷指令的坑（血泪区，条条都真实踩过）

### 2.1 Turn Focus 不生效 ≠ 逻辑错 —— 必须先 Get Current Focus（priming）
- **现象**：`now=07:40`（带守卫）能退 DND，`now=13:29`（无守卫）退不掉；变量、分支全对。
- **根因**：iOS 的 `Turn Focus On/Off` 不先读一次当前 focus 就常常静默 no-op。守卫路径恰好顺手跑了 `Get Current Focus`，无守卫路径没跑 → 表现成"复杂的行、简单的不行"。
- **定案**：ApplyFocus **无条件**先 `Get Current Focus`（既 priming 又拿当前名），再决策执行。
- **另一半**：iOS 同时只允许一个 focus，**不能直接切换**——从 Sleep 进 DND 必须先 `Turn [当前] Off` + `Wait 1s` 再 `Turn [目标] On`。

### 2.2 变量自我覆盖事故
- **现象**：重构后连 07:40 都关不掉。
- **根因**：`Get Value for mode in FocusDict → Set variable FocusDict`——把字典自己覆盖成了字符串，后续取值全空。
- **定案**：**`Set variable FocusDict` 全 shortcut 只允许出现一次**（从 focus 取那次）；其余取值一律存新变量。

### 2.3 后台调试：Show alert 不弹，用 Append to Note
- 后台自动化里 alert 不一定弹，前台测出来的"都正常"不代表后台正常。要看真实后台行为：`Append to Note` 写固定备忘录（时间戳+变量，变量用 `[ ]` 包住便于看出空值）。
- **另一坑**：备忘录 append 里直接放非文本变量（如 Current Focus 对象）会存成 Attachment.txt——先过一道 `Text` 再 append。

### 2.4 布尔值转文本是 "Yes"/"No"
- **现象**：worker 输出 JSON `true`，手机 `If Text is Yes` 居然成立。
- **根因**：iOS 对 boolean→Text 的呈现是 "Yes/No"（且历史上出现过 1/0、true/false，**不是契约**）。
- **定案**：不赌系统呈现。worker 显式输出字符串旗标 `sync_alarms_flag: "yes"/"no"`，手机比字面。原布尔字段保留（既有契约不动）。

### 2.5 Create Alarm 的两个硬约束 → 催生 Fixed/动态两类模型
- `Create Alarm` 建的闹钟**震动/铃声只能系统默认**，指定不了。
- 快捷指令**没有"改现有闹钟时间"的动作**（只能建/开/关/删）。
- 由此定案（详见 ARCHITECTURE §4）：需要自定义震动铃声或**绝不能漏响**（叫醒）→ 预建 `Gate-Fixed-*`；时间会变、默认铃可接受 → 动态族。

### 2.6 Find Alarms 只按名称 → 时间必须编进 label（"改时间静默失效"大坑）
- **现象**：动态闹钟同 uid 改时间（7点→9点），手机上还是 7 点。
- **根因**：SyncAlarms `Find Alarms where 名称 is <label>` 找到同名旧闹钟 → 只 `Turn On`，时间不更新（也无法更新，见 2.5）。
- **定案（方案 A）**：**label 尾部编入时间** `Gate-ES-<code>-<uid>-<HHMM>`。改时间 → label 变 → 旧的（不在清单）被 sweep 关掉、新时间重建。时间由**网关**拼（时区换算后的墙上时间），**乙方 uid 永不含时间**——把这个正确性开关收在网关手里，乙方选错的可能性为零。
- **手机端 sweep 最终形态**：`名称 contains "Gate-" 且 不 contains "Gate-Fixed"`——覆盖所有动态族、排除预建，以后加新族不用再改。

---

### 2.7 快捷指令 JSON 导出 与 UI 脱节（差点误判生产bug）
- **现象**：从 PDF/JSON 导出审 ApplyFocus，OFF 分支的两个 `Set Focus` 缺 `Enabled` 字段，看起来"On/Off 不确定"，一度判为"可能turn on→午间DND解除不了"。
- **真相**：UI 里两个动作**明确都是 Turn Off**，只是导出没序列化该标志。
- **定案**：**快捷指令 JSON 导出不完整，不能当唯一真相源；以 UI 实际显示为准。** 手机端真相固化在 `PHONE.md`（按 UI 逐动作写），审时对照它，别只信导出。

### 2.8 only_if_current 的语义是设计，不是可省的保护（连设计者都会忘）
- OFF 时：有 `only_if_current`→只在当前==该值才关；无→不管什么 focus 一律清掉当前。
- **这是刻意的**：无守卫也"只关 Mode"的话，`only_if_current` 字段就没用了。它存在就是为了让网关按需挑 focus。
- 教训：**没有文档，连原设计者都会自我怀疑**（本会话就发生过：把自己设计的"无守卫清场"当成 bug 去提醒仓主）。故写死进 `PHONE.md` §3 与 `ARCHITECTURE.md` §4.x。

## 3. Worker 侧的坑

### 3.1 时刻匹配 vs iOS 自动化抖动
- **现象**：不带 `now` 参数时 07:40 的 DND 解除偶发失效。
- **根因**：POINT 匹配容差 ±3 分钟，iOS 定时自动化后台触发常晚几分钟 → 槽没命中 → focus=null，下游全不跑（看起来像"guard 坏了"，其实是上游没匹配）。
- **定案**：每个"时间刺客"把**自己的计划时间**传给 DNDTick（`?now=HH:MM`），iOS 晚触发也照样命中；`now/testTime` 走 `normClock` 归一化（`7`→`07:00`）、非法降级实时、双向互填（`?linkTime=0` 关）。
- **教训**：测试时写死 `?now=13:29` 这类残留**上线前必清**。

### 3.2 ICS 裸 UTC 差 8 小时（真 bug，已修）
- **根因**：旧 parseICS 只正则抠 `T(HHMM)`，完全没看 `Z`/`TZID` —— `...T093000Z`（UTC 01:30 对应上海 09:30）被当成上海 09:30。
- **定案**：parseICS 捕获 `startTZ`；`toShanghaiWall()` 统一换算（Z/±HH:MM 精确、IANA 名走 Intl 含 DST、未识别告警兜底）。协议规定 date/time 默认东八区墙上时间。

### 3.3 迁移丢容错（workdays-core 接入时踩的）
- **现象**：把节假日拉取换成 `createHolidayHub` 时，原实现的"拉不到→空数据→周末推演"降级被顺手删了——core 一抛错整个请求就崩。
- **定案**：补回 try/catch 降级。**教训（重要）：替换一段代码时，它携带的容错语义也是接口的一部分，必须一并迁移。**
- 顺带修复：years 现含 `yesterday` 的年份（1 月上旬跨年边界，原来静默按周末兜底）。

### 3.4 最外层兜底网（V11 收口）
- 外部输入各自有 try（日历逐条、外部源逐个+5s 超时、env JSON、节假日），但内部逻辑意外没人接。
- **定案**：主 handler 整体包最外层 try/catch。任何未接住的异常 → **HTTP 200 + 格式合法的降级响应**（state 全 null → 手机 Apply\* 空转不误动；错误进 error/humanReadable）。**为什么 200 不是 500**：手机端 fetch 拿到 500 会让整条同步失效；200+空状态让手机"安全地什么都不做"。

---

## 4. 架构决策（为什么是现在这个样子）

### 4.1 设备字段：命名规则 + 订阅（V11 核心）
- **动机**："改一处、另一处静默失效"——silent 曾靠 `FOLLOW_FOCUS` 跟随 focus，删 focus 就塌。
- **定案**：规则引擎产出**命名时刻表**（现仅 `dnd`）；字段用四旋钮订阅：`USE`（订哪张）/`MAP`（值映射）/`SKIP`（屏蔽时刻）/`OWN`（自有时刻，最高优先）。**依赖方向 = 字段→规则**，字段间零引用；删任一字段其余照常；无人订阅的规则被审计标为孤儿（可删）。
- `FOCUS.OWN` 是 focus 每时刻定制唯一入口（简写 `"ON"`、守卫 `{only_if_current}`、压制 `{action:null}`、预留 `switch_to`），对象写法**逐字段与规则合并**。

### 4.2 config.user 纯增量
- 原"全量个人配置"333 行与默认层 diff 后真实差异 3 处。deepMerge 本就支持增量。
- **定案**：user 层只写差异（对象深合并、数组整段替换、删行即回落默认）。

### 4.3 外部闹钟：甲方契约（走过一段弯路，特别记录）
- **弯路：RECURRING_ALARMS 加了又删。** 曾让网关内置"每月9号"式循环规则——**定位错误**：简单循环 iPhone 时钟 App 自建重复闹钟即可；复杂计算（工作日/间隔/自然月去重/跳节假日）是**乙方业务**，必须乙方算成具体 `YYYY-MM-DD HH:MM` 再喂。网关只做"具体点搬运工"（收点→24h 裁剪→幂等对账）。**未来若有人再想给网关加排期能力，先读这段。**
- **准入 = 强制识别**：ICS 在事件**任意字段**放 `[[ES:uid]]`（全字段扫描 `_scan` 实现；裸 `[[ES]]` 回退原生 UID）；JSON 每条必带 uid。没标记的事件绝不误收。
- **uid 规范**：`{域}-{任务实例}-{周期桶}`，bucket 粒度=该提醒"同一时段最多响一次"的时段（YYYYMM / YYYYMMDD / -序号），**不含时钟时间**（时间网关拼）。同一 bucket 一次拉取内不得重复；也别过细（月度别到日）。
- **否决项：between/时间容差匹配。** Fixed 的时间在手机（网关不下发时间去比）；动态的时间不一致**本就该重建**——容差会把"该重建"误判成"将就旧的"，绕回 2.6 的 bug。稳定靠 Fixed 常驻、精准靠动态重建，**不做单条闹钟上的两者兼得**。
- 隐私分流：公开源 `config.SOURCES`；带 token 的 `env.EXTERNAL_ALARMS`（Secret，格式同），自动合并。

### 4.4 Fixed 闹钟：时间的真相在手机
- 网关对 `Gate-Fixed-*` **只开关、从不碰时间**。改响铃时间=改手机那条闹钟；代码里 `scheduledAt` 只是镜像（窗口布防判断+面板显示），且是该时间**代码里唯一存放处**（rules.js 日志经 `ftime()` 动态取，不再抄字面时间）。手机改了记得同步镜像，纯为不骗人。

### 4.5 workdays-core 依赖
- 节假日/工作日判定收敛为私有 npm 包（多国、含调休口径），CN 数据与原 holiday-cn `days[]` 同形同序 → `rest-days.js` 零改动。发版→下游自动升级部署链见 core 的 `INTEGRATION.md`。alarm-api 侧唯一姿势：`createHolidayHub(['CN'], years)`（有 try 降级，见 3.3）。

---

## 5. 已定未做（欠账清单，做时直接照此施工）

### 5.1 上课闹钟动态化（方案已定稿，暂缓实施）
- **划分**：当天**第一个叫醒闹钟**留预建 `Gate-Fixed-*`（周六/周日起床铃，不容漏）；**之后的课程**下放动态 `Gate-Class-<星期>-<课程id>-<HHMM>`（稳定 id 如 `dance`，**不用序号**防重排抖动）。
- **配置形态**：每课一条 `{day, id, name, time, breaks:{"寒假":"08:45","暑假":"08:30"}}` —— `breaks` 按 SCHOOL_BREAK 的 name 覆盖时间；**列了才在该假期响**（穿透），没列照旧跳过。
- **牵动**：config（WEEKEND_CLASS 结构）、rules.js（R3 从 activeLabels 改为产出 dynamicOut）、index.js（class 挪出 fixedOut）、god-mode.md 示例、手机端删旧预建 class 闹钟。sweep 已是最终形态无需再改。

### 5.2 其它
- 手机端待办：sweep 保持显式多前缀 `contains Gate-Dynamic-Event 或 Gate-ES 或 Gate-Class`（已加 Gate-Class）；
  DNDTick 决定 now 方案（实时+宽容差 或 刺客传入）、上线删调试探针。以 `PHONE.md` 为准。

---

## 6. 新会话上手指引（AI 或人）

1. **先读** `docs/ARCHITECTURE.md`（分层/解耦/可靠性模型），再按需读专项文档（索引在其文末）。
2. **改行为**：开关在 `config.default.js`（个人差异进 `config.user.js`，纯增量）；决策逻辑看 `rules.js`（日志方括号 [R编号] ↔ 代码同编号）；设备字段看 `device-state.js` 的订阅模型。
3. **测试回路**：浏览器 `?testDate=YYYY-MM-DD&testTime=HH:MM`（互填 now）看 `humanReadable` 面板 + DEEPLOG；`?testEvents=` 注入虚拟日历事件。手机侧后台 debug 用 Append to Note（见 2.3）。
4. **交付习惯**：只交**当轮改动的文件**（不打包），这是仓主的明确偏好。
5. **动手前必读本文件 §2/§3**——iOS 快捷指令的行为不符合直觉，别用"常识"推断它。
