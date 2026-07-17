# PHONE-V2.md — 执行器逐动作装配手册（v2.0 全量重写）

> 逐动作脚本，英文动作名为准（英文系统 UI），可直接照拼，也可整段喂给带练 AI——
> 但**本文的三条铁规则优先于任何 AI 的自由发挥**。
> 服务端契约: KERNEL v0.5。基础 URL 记为 `BASE = https://<worker>/v2`（带 ?key= 与 &device=default）。

---

## §0 三条铁规则 + 变量命名表（先读，违反必出诡异 bug）

**铁则1 — 一切比较都是纯文本比较。**
LA（last_applied）里只存文本: silent 存 `on`/`off`；media_volume 存数字文本 `0`；
focus 存**签名文本** `mode|action|switch_to`（如 `do_not_disturb|off|`）。
⛔ 禁止直接比较两个字典对象（Shortcuts 字典转文本键序不保证，同值会比出不等）。

**铁则2 — 云端 null = 写哨兵 `none`，不是留空。**
期望为 null（无主张）→ 不动手 + 把 LA 对应键设为文本 `none`（"放下记忆"的落地形态：
下次出现真值时 `值 ≠ none` 必判为变化 → 夜间重进得以触发）。
⛔ 禁止"Value 留空"写入——不同 iOS 版本行为不定型。

**铁则3 — 守卫拦截时不落账。**
only_if_current 不满足 → 跳过本次且**不更新 LA**（下个采样点重新判断）。
只有实际动手成功才写 LA。

| 变量 | 含义 | | 变量 | 含义 |
|---|---|---|---|---|
| CloudState | 云端整包字典 | | ShouldRun | 0/1 执行开关 |
| LA | 本地记忆字典 | | FocusSig / LAFocus | focus 签名文本/记忆 |
| SilentNode/ExpectSilent/LASilent | silent 三件 | | VolNode/ExpectVol/LAVol | 音量三件 |

---

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
A6  If → A5(File) has any value
A7    Get Dictionary from Input → 输入: A5 → Set Variable: LA
A8  Otherwise
A9    Dictionary（空字典，不加任何键）→ Set Variable: LA
A10 End If
```

### §3.1 Silent 块（哨兵版，修正带练 AI 的第 19–21 步）

```
S1  Get Dictionary Value → key: fields.silent → in: CloudState → Set Variable: SilentNode
S2  Get Dictionary Value → key: value → in: SilentNode → Set Variable: ExpectSilent
S3  Get Dictionary Value → key: silent → in: LA → Set Variable: LASilent
S4  If → ExpectSilent has any value
S5    Number 0 → Set Variable: ShouldRun
S6    If → ExpectSilent is not LASilent          （文本比较，铁则1）
S7      Number 1 → Set Variable: ShouldRun
S8    End If
S9    Get Dictionary Value → key: apply → in: SilentNode
S10   If → (S9) is enforce
S11     Number 1 → Set Variable: ShouldRun
S12   End If
S13   If → ShouldRun is 1
S14     If → ExpectSilent is on
S15       Set Silent Mode → On
S16     Otherwise
S17       Set Silent Mode → Off
S18     End If
S19     Set Dictionary Value → key: silent；value: ExpectSilent；dictionary: LA
S20     Set Variable: LA ←（S19 的 Dictionary）
S21   End If
S22 Otherwise                                     （云端 null → 铁则2）
S23   Set Dictionary Value → key: silent；value: 文本 none；dictionary: LA
S24   Set Variable: LA ←（S23 的 Dictionary）
S25 End If
```

### §3.2 Focus 块（签名比较 + 守卫，铁则1/3 的主战场）

```
F1  Get Dictionary Value → key: fields.focus → in: CloudState → Set Variable: FocusNode
F2  Get Dictionary Value → key: value → in: FocusNode → Set Variable: FocusVal
F3  If → FocusVal has any value
F4    Text: 「mode变量|action变量|switch_to变量」    ← 从 FocusVal 取三个键拼一行
        （即 Text 动作里依次插入 Get Dictionary Value 的三个魔法变量, 竖线分隔）
F5    Set Variable: FocusSig
F6    Get Dictionary Value → key: focus → in: LA → Set Variable: LAFocus
F7    ─ 守卫段 ─
        Get Dictionary Value → key: only_if_current → in: FocusVal → Set Variable: Guard
F8    If → Guard has any value
F9      Get Current Focus → 转文本（Text 动作包住）
F10     Dictionary（§1 那张反查词典）
F11     Get Dictionary Value → key: (F9 文本) → in: (F10) → Set Variable: CurToken
F12     If → CurToken has any value → 什么都不加 → Otherwise
F13       Text: none → Set Variable: CurToken     （空 Focus = token none）
F14     End If
F15     If → CurToken is not Guard
F16       Text: skip → Set Variable: FocusSig     （守卫拦截: 让后续比较必不执行，
                                                    且【不写 LA】= 铁则3）
F17     End If
F18   End If
F19   Number 0 → Set Variable: ShouldRun
F20   If → FocusSig is not LAFocus
F21     If → FocusSig is not skip
F22       Number 1 → Set Variable: ShouldRun
F23     End If
F24   End If
F25   （enforce 兜底，同 S9–S12，key 取自 FocusNode.apply）
F26   If → ShouldRun is 1
F27     Get Dictionary Value → key: action → in: FocusVal
F28     If → (F27) is on
F29       Set Focus → 编辑器选择器绑定【勿扰】→ Turn On until Turned Off
F30     Otherwise
F31       Set Focus → 绑定【勿扰】→ Turn Off
F32     End If
        （将来有 sleep/work 等 mode: 在 F27 前加 mode 判断分支, 每个 mode 一对 F28–F32）
F33     Set Dictionary Value → key: focus；value: FocusSig；dictionary: LA
F34     Set Variable: LA
F35   End If
F36 Otherwise
F37   Set Dictionary Value → key: focus；value: 文本 none；dictionary: LA
F38   Set Variable: LA
F39 End If
```

### §3.3 MediaVolume 块（结构 = Silent 块，仅三处不同）

照抄 S1–S25，键名换 media_volume / LA 键 volume，差异:
```
V-a  执行段不是开关而是: Calculate → ExpectVol ÷ 100 → Set Volume ← 计算结果
V-b  比较仍是文本比较（ExpectVol 与 LAVol 都按文本处理即可）
V-c  null 分支同样写哨兵 none
```

### §3.4 收尾：落盘 + 对账（漏掉 = 前功尽弃）

```
E1  Save File → File: LA；Destination Path: last_applied.json；
    Folder: Shortcuts；✅ Overwrite If File Exists；关闭 Ask Where To Save
E2  Get Dictionary Value → key: reconcile_alarms → in: CloudState
E3  If → (E2) is true（布尔在 Shortcuts 中按文本 true 比较即可）
E4    Run Shortcut → SyncAlarms（关闭 Show While Running）
E5  End If
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
| 长假夜里不再自动静音 | null 时留空/没写哨兵 | 铁则2: 写 none |
| 手动开的睡眠模式被关 | 守卫段缺失或守卫拦截后写了 LA | §3.2 F7–F17 + 铁则3 |
| 手动改动一小时内被吃 | 刺客退役了或刺客没落账 | §5 ③ |
| 跑一次正常、下次全重放 | 忘了 E1 落盘 | §3.4 |
| 自动化夜里不跑 | Ask Before Running 没关 | §6 ② |
| 音量设成了 1% | 忘了 ÷100 | §3.3 V-a |
