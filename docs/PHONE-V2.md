# PHONE-V2.md — 执行器逐动作装配手册（v2.0 全量重写）

> 逐动作脚本，英文动作名为准（英文系统 UI），可直接照拼，也可整段喂给带练 AI——
> 但**本文的三条铁规则优先于任何 AI 的自由发挥**。
> 服务端契约: KERNEL v0.5。基础 URL 记为 `BASE = https://<worker>/v2`（带 ?key= 与 &device=default）。

---

## §0 三条铁规则 + 变量命名表（先读，违反必出诡异 bug）

**铁则1 — 一切比较都是纯文本比较，且用"文本化三明治"机械执行。**
任何 If 比较的两个操作数，各自**先过一次 Text 动作再 Set Variable**，比较只发生在
两个文本变量之间（Text 动作 = 类型归一器: 空值→空文本、数字 0→"0"、哨兵本就是文本）。
为什么不能省: Get Dictionary Value 的返回类型跟着 JSON 走——silent 取出是文本(碰巧
安全)，media_volume 取出是**数字**，数字对文本哨兵 none 的比较在快捷指令里行为不定型。
LA 里只存文本: silent `on`/`off`；media_volume 数字文本 `0`；focus **签名文本**
`mode|action|switch_to`。⛔ 禁止直接比较字典对象（键序不保证，同值比出不等）。

**铁则2 — 云端 null = 写哨兵 `none`，不是留空。**
期望为 null（无主张）→ 不动手 + 把 LA 对应键设为文本 `none`（"放下记忆"的落地形态：
下次出现真值时 `值 ≠ none` 必判为变化 → 夜间重进得以触发）。
⛔ 禁止"Value 留空"写入——不同 iOS 版本行为不定型。

**铁则3 — 守卫拦截时不落账，enforce 也压不过守卫。**
only_if_current 不满足 → 跳过本次且**不更新 LA**；enforce 只压"无变化跳过"，
不压守卫拦截（§3.2 F30–F34 的嵌套就是为此）。只有实际动手成功才写 LA。

**铁则4 — 命名纪律: 全流程八个名字封顶。**
只给"跨距离复用"的值 Set Variable: 全局 `CloudState` `LA` `ShouldRun`，
块内 `ExpectSilent` `ExpectVol` `FocusSig` `Guard` `CurToken`。
用一次就消费的值 → 直接引用上一步动作的魔法变量, 不取名；
后面再要云端数据 → 宁可重新 Get Dictionary Value 一次(根是 CloudState), 也不为它取名。

| 变量 | 含义 | 生命周期 |
|---|---|---|
| CloudState / LA | 云端整包 / 本地记忆 | 全程 |
| ShouldRun | 文本 0/1 执行开关 | 每块复位复用 |
| ExpectSilent / ExpectVol / FocusSig | 各块期望值(文本) | 块内 |
| Guard / CurToken | 守卫 token / 当前 Focus token | Focus 块内 |

---

## §0.5 扩展承诺（重构疲劳的解药: 哪些未来变化零改手机）

**零改手机**: 新决策规则/改任何时刻常量/新事实与词汇/长假阈值/守卫条件/新周期任务
(cadence)/新语言与 Focus 名(用云端词典时)/信封新增任何键(未知字段容忍)。
**改一处**: 字段换订阅或换 MAP → 云端配置, 手机零动。
**克隆一个块**: 真正的新手机能力(如亮度) = 复制 Silent 块改 3 个键名 + 一个执行动作。
**全家重录(冻结禁区)**: Gate 标签语法 —— 所以它永不改。

## §1 反查词典（做进 ApplyState 内部，不依赖外部 App）

后文 §3.2 第 F7 步会用到一个 Dictionary 动作，内容一次录入（Text 类型键值）:

| Key | Value | | Key | Value |
|---|---|---|---|---|
| Do Not Disturb | do_not_disturb | | 勿扰模式 | do_not_disturb |
| Sleep | sleep | | 睡眠 | sleep |
| Personal | personal | | 个人 | personal |
| Work | work | | 工作 | work |
| Driving | driving | | 驾驶 | driving |
| Reduce Interruptions | reduce_interruptions | | 减少干扰 | reduce_interruptions |

换系统语言零维护；新自定义 Focus 各语言名各加一行。
**云端词典（可选替代, 免手机维护）**: 请求加 `&locales=zh,en` → 信封 `i18n.focus_name_to_token`
即本表, F10 改为 Get Dictionary Value(key: i18n.focus_name_to_token, in: CloudState)。
加语言/加自定义 Focus 从此只改云端数据。

## §2 记忆文件（免初始化，自愈式）

不需要单独的初始化指令——§3.0 的 A5–A7 内置"文件不存在则从空字典起步"。

---

## §3 ApplyState 总装（聚合形态；拆分形态见 §3.5）

### §3.0 骨架：取云端 + 读记忆（7 个动作）

```
A1  Text                    → BASE/state        （即 …/v2/state?key=…&device=default）
A2  URL                     → 指向 A1
A3  Get Contents of URL     → Method: GET
A4  Get Dictionary from Input → 输入: A3 → Rename 为 CloudState
A5  Get File from Folder    → Folder: Shortcuts；File Path: last_applied.json；
                              关闭 Error If Not Found
A6  Text: X（插入 A5 的 File）                     （标记判空: 文件内容→"X{…}", 缺失/空文件→"X"）
A7  If → 输入（A6）→ is → X                        （无记忆 / 文件损坏为空 → 自愈新建）
A8    Dictionary（空字典，不加任何键）→ Set Variable: LA
A9  Otherwise
A10   Get Dictionary from Input → 输入: A5 → Set Variable: LA
A11 End If
```

### §3.1 Silent 块（27 步；标记判空, null 分支前置）

```
S1  Get Dictionary Value → key: fields.silent.value → in: CloudState     （原始值）
S2  Text: X（插入 S1 魔法变量）                                          （标记判空）
S3  If → 输入（S2 的 Text）→ is → X                                      （命中 = 云端 null）
S4    Set Dictionary Value → key: silent；value: 直接打字 none；dict: LA
S5    Set Variable: LA
S6  Otherwise                                                            （主干: 有值）
S7    Text →（插入 S1）→ Set Variable: ExpectSilent
S8    Get Dictionary Value → key: silent → in: LA
S9    Text →（插入 S8）                                                   （不取名,S11条件用）
S10   Text: 0 → Set Variable: ShouldRun
S11   If → 输入 ExpectSilent → is not → 条件框插入（S9 的 Text）
S12     Text: 1 → Set Variable: ShouldRun
S13   End If
S14   Get Dictionary Value → key: fields.silent.apply → in: CloudState
S15   Text →（插入 S14）
S16   If → 输入（S15）→ is → enforce
S17     Text: 1 → Set Variable: ShouldRun
S18   End If
S19   If → 输入 ShouldRun → is → 1
S20     If → 输入 ExpectSilent → is → on
S21       Set Silent Mode → On
S22     Otherwise
S23       Set Silent Mode → Off
S24     End If
S25     Set Dictionary Value → key: silent；value: ExpectSilent；dict: LA
S26     Set Variable: LA
S27   End If
S28 End If
```

### §3.2 Focus 块（55 步；判空全标记法，has any value 零残留）

```
F1  Get Dictionary Value → key: fields.focus.value → in: CloudState      （原始值）
F2  Text: X（插入 F1）                                （标记判空: 字典→"X{…}", null→"X"）
F3  If → 输入（F2）→ is → X                           （云端 null）
F4    Set Dictionary Value → key: focus；value: 直接打字 none；dict: LA
F5    Set Variable: LA
F6  Otherwise                                         （主干: 有值）
F7    Get Dictionary Value → key: fields.focus.value.mode → in: CloudState
F8    Get Dictionary Value → key: fields.focus.value.action → in: CloudState
F9    Get Dictionary Value → key: fields.focus.value.switch_to → in: CloudState
F10   Text: （F7）|（F8）|（F9）→ Set Variable: FocusSig
F11   Get Dictionary Value → key: focus → in: LA
F12   Text →（插入 F11）                               （不取名, F33 条件用）
      ── 守卫段（全标记法）──
F13   Get Dictionary Value → key: fields.focus.value.only_if_current → in: CloudState
F14   Text: X（插入 F13）
F15   If → 输入（F14）→ is not → X                    （有守卫才进）
F16     Text →（插入 F13）→ Set Variable: Guard
F17     Get Current Focus
F18     Text →（插入 F17）
F19     Dictionary（§1 词典；或云端词典见 §1 附注）
F20     Get Dictionary Value → key:（F18 的 Text）→ in:（F19）
F21     Text: X（插入 F20）
F22     If → 输入（F21）→ is → X                      （词典未命中 / 无专注）
F23       Text: none → Set Variable: CurToken
F24     Otherwise
F25       Text →（插入 F20）→ Set Variable: CurToken
F26     End If
F27     If → 输入 CurToken → is not → 条件框插入 Guard
F28       Text: skip → Set Variable: FocusSig         （拦截: 必不执行且不落账, 铁则3）
F29     End If
F30   End If
      ── 变化判定 ──
F31   Text: 0 → Set Variable: ShouldRun
F32   If → 输入 FocusSig → is not → skip
F33     If → 输入 FocusSig → is not → 条件框插入（F12 的 Text）
F34       Text: 1 → Set Variable: ShouldRun
F35     End If
F36   End If
      ── enforce（嵌"非 skip": 压不过守卫）──
F37   Get Dictionary Value → key: fields.focus.apply → in: CloudState
F38   Text →（插入 F37）
F39   If →（F38）→ is → enforce
F40     If → 输入 FocusSig → is not → skip
F41       Text: 1 → Set Variable: ShouldRun
F42     End If
F43   End If
      ── 执行 ──
F44   If → 输入 ShouldRun → is → 1
F45     Get Dictionary Value → key: fields.focus.value.action → in: CloudState
F46     Text →（插入 F45）
F47     If →（F46）→ is → on
F48       Set Focus → 编辑器绑定【勿扰】→ On until Turned Off
F49     Otherwise
F50       Set Focus → 绑定【勿扰】→ Off
F51     End If
F52     Set Dictionary Value → key: focus；value: FocusSig；dict: LA
F53     Set Variable: LA
F54   End If
F55 End If
```
（将来多 mode: F47 前按 F7 的 mode 文本加分支, 每 mode 一对 Set Focus。）

### §3.3 MediaVolume 块（结构=Silent, 三处差异）

照 §3.1 抄, 键名换 fields.media_volume.* / LA 键 volume / 变量 ExpectVol，差异:
```
V-a  执行段: Calculate →（V 块的 S1 原始数字变量）÷ 100 → Set Volume ←（计算结果）
     （算术用原始数字, 比较用三明治文本——各取各的, 铁则1③）
V-b  S21 落账写 ExpectVol（文本 "0"; 读回也走三明治, 恒同型）
V-c  null 分支同写 none
```

### §3.4 收尾：落盘 + 对账（4 步；漏掉 = 前功尽弃）

```
E1  Save File → File: LA；Destination Path: last_applied.json；Folder: Shortcuts；
    ✅ Overwrite If File Exists；关闭 Ask Where To Save
E2  Get Dictionary Value → key: reconcile_alarms → in: CloudState
E3  Text →（插入 E2）
E4  If →（E3）is → true → Run Shortcut: SyncAlarms（关 Show While Running）→ End If
```

### §3.5 拆分形态（推荐终态，见旅行场景）

把 §3.1/§3.2/§3.3 各自独立成 ApplySilent / ApplyFocus / ApplyVolume 三条指令:
骨架 A1–A10 每条各带一份；LA 文件名各用 la_silent.json / la_focus.json / la_volume.json
（⚠️ 并发写同一文件会互相覆盖）；E1 落盘各写各的；E2–E5 对账只放其中一条（如 Silent）。
暂停任何一条 → 其余零感知；重新启用 → 下次轮询自动收敛。

---

## §4 SyncAlarms（改造你现有的 v1 版本，别重建）

克隆现有 SyncAlarms，只改数据映射四处:
```
① URL → BASE/state（或沿用 ApplyState 传参）
② 固定闹钟数据源 → alarms.fixed[]；action 比较值 ON/OFF → on/off
③ 动态清单 → alarms.dynamic[]；建闹钟时间取 at 的后 5 位（HH:MM）
④ sweep 前缀清单加一个: Gate-AIQ（原有 Gate-Dynamic-Event / Gate-ES / Gate-Class 不变）
```

## §5 边界刺客（长期保留——堵"迟到断言窗口"的关键）

现有每个刺客只改三处:
```
① URL → BASE/state?mode=point
② 读 current_state: null / 无值 → 结束（装死）；否则逐字段读 current_state.fields.*
   （字段值 null = 不动；执行动作与 §3 各块的执行段相同，focus 过 §3.2 守卫段）
③ 【新增】执行成功后按 §3 的方式更新对应 LA 键并落盘——刺客准点断言+落账，
   整点轮询随后看到"无变化"即跳过 → 边界后的手动操作存活（PHONE 防覆盖第三层）
④ current_state.reconcile_alarms 为 true → Run SyncAlarms
```

## §6 灰度顺序

```
① §3 ApplyState 拼好 → 手动跑通，对照 BASE/timeline 核对每字段
② 挂每小时自动化（Time of Day 每小时 / 关闭 Ask Before Running），与旧刺客并行一周
③ §4 SyncAlarms 切数据源
④ §5 刺客换 URL + 加落账（保留不退役）
⑤ config.user.js 设 V2:{DEFAULT:true} 收口
```

## §7 UseAI（启用 V2.AI_QUOTA 后）

```
U1  Get Contents of URL → BASE/state → Get Dictionary Value: fields.ai_available.value
U2  If → (U1) is true
U3    Open App → 你的 AI 应用
U4    Date → Current Date；Format Date → Custom: yyyy-MM-dd HH:mm
U5    Text（UUID）→ Shortcuts 无原生 UUID: 用 Hash(当前日期含秒)前若干位, 或 Files 的
      Generate UUID 类第三方动作; 目的只是幂等键, 时间戳文本亦可
U6    Get Contents of URL → BASE/fact → Method: POST → Request Body: JSON →
      { stream: ai_claude, at: (U4), id: (U5), type: done }
U7  Otherwise → Show Notification: 冷却中（恢复提醒 Gate-AIQ 已在对账清单）
U8  End If
```
纠偏: 同 U6，type 换 reset；或 set_next + payload:{at:"…"}。

## §7.5 延迟实验（不变，见旧版流程: 主动探针 + applied_state 被动观测）

POST latency_probe 记 t0 与响应 colo → 轮询 GET 至可见记 t1 与 colo → 记录
「延迟秒数+写读是否同节点」；换 WiFi/蜂窝/旅行时多测。数据裁决 P3 底座（KV vs DO）。

## §8 常见坑速查

| 症状 | 原因 | 铁则 |
|---|---|---|
| focus 每小时反复重设 | 比较了字典对象 | 铁则1: 签名文本 |
| 音量每小时重放/从不执行 | 数字 vs 哨兵混型比较 | 铁则1: 三明治(S2b/S3b) |
| 音量 0 被当成 null 跳过 | has any value 的"0即空"怪癖 | 铁则1②: 标记判空 "X0" is X |
| 判空行为随 iOS 版本漂移 | 用了 has any value（0/空文本两边都有怪癖） | 铁则1②: 全面弃用, 只用标记法 |
| If 条件里选不到 is | 输入没过 Text（类型不是文本） | 铁则1①: 先 Text 再 If |
| 守卫拦了还是被强制执行 | enforce 判定没嵌"非 skip" | F33–F36 嵌套（铁则3） |
| 长假夜里不再自动静音 | null 时留空/没写哨兵 | 铁则2: 写 none |
| 手动开的睡眠模式被关 | 守卫段缺失或守卫拦截后写了 LA | §3.2 F7–F17 + 铁则3 |
| 手动改动一小时内被吃 | 刺客退役了或刺客没落账 | §5 ③ |
| 跑一次正常、下次全重放 | 忘了 E1 落盘 | §3.4 |
| 自动化夜里不跑 | Ask Before Running 没关 | §6 ② |
| 音量设成了 1% | 忘了 ÷100 | §3.3 V-a |
