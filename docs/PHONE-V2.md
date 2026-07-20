# PHONE-V2.md — 执行器逐动作装配手册（v3.0：独立模块 + 通用守卫架构）

> 逐动作脚本，英文动作名为准，照拼即可。**本文三条铁规则优先于任何 AI 的自由发挥。**
> 服务端契约 KERNEL v0.7。基础 URL 记为 `BASE = https://<worker>/v2`
> （带 `?key=` 与 `&device=default`；focus 需要 `&locales=zh,en`——本机语言首位）。
>
> **v3.0 架构（应用户要求）**: ① 每个字段是**完全独立的快捷指令**(ApplySilent /
> ApplyFocus / ApplyVolume)，**不拼成大模块**——加/改一个字段只动一个小指令，步骤少、
> 好维护、好排查。② 守卫统一抽成一个 **CheckGuards 通用子指令**，所有字段共用；加新守卫
> 种类(锁屏/App/…)只改 CheckGuards 一处，字段主逻辑永不动。③ 服务端把 only_if_current
> 翻译成统一 guards 格式下发，手机端只认 guards、只有一套守卫逻辑。

---

## §0 三条铁规则 + 变量命名（先读，违反必出诡异 bug）

**铁则1 — If 的输入与条件对象必须全是文本；判空用"标记法"。**
① 任何进 If 或进条件框的值，先过一次 `Text` 动作(数字0→"0"、空→空文本)。
② 判空禁用 `has any value`(0即空/空文本两边都有版本怪癖)，统一用**标记法**:
   `Text: X（插入原始变量）` → `If (该文本) is X`(命中=空/null)。确定性文本相等，不赌。
③ 数字只在算术处用原始值。ShouldRun 用 Text 的 "0"/"1"。

**铁则2 — 云端 null = 写哨兵 `none`，不是留空。**
期望 null(无主张)→ 不动手 + 把该字段 last_applied 设为文本 `none`(放下记忆:下次真值
出现时 `值 ≠ none` 必判为变化，夜间重进才触发)。禁止"留空写入"(版本行为不定型)。

**铁则3 — 守卫拦截时不落账；enforce 压不过守卫。**
CheckGuards 返回 SKIP → 跳过该字段且**不更新 last_applied**(下轮重判)。
enforce 只压"无变化跳过"，不压守卫拦截。只有实际动手成功才写 last_applied。

**变量命名(每个独立指令内部；名字不跨指令，无需统一)**:
| 变量 | 含义 |
|---|---|
| Cloud | 本指令 GET 到的整包字典 |
| Expect | 本字段期望值(文本) |
| LA | 本字段的 last_applied 值(文本) |
| ShouldRun | "0"/"1" |
| GuardResult | CheckGuards 返回的 PASS/SKIP |

---

## §1 通用守卫子指令 CheckGuards（先建这个，三个字段都调它）

**作用**: 输入 guards 数组 + Cloud，逐条检查手机实况，全满足输出 `PASS`，任一不满足 `SKIP`。
**输入**: 「字典」——含两键 `{ guards: [...], cloud: <整包> }`（cloud 供 current_focus 反查 token）。
**输出**: 文本 `PASS` / `SKIP`（Stop and Output）。

```
G1  接收输入(字典) → Get Dictionary Value: guards → Set Variable: Guards
G2  接收输入(字典) → Get Dictionary Value: cloud  → Set Variable: Cloud
G3  Text: PASS → Set Variable: GuardResult              （默认通过）
G4  Count → Items in Guards
G5  If → (G4) is → 0 → Stop and Output: GuardResult → End If   （无守卫直接 PASS）
G6  Repeat with each item in Guards →（当前项 = Guard）
G7    Get Dictionary Value: source → in Guard → Text → Set Variable: GSource
G8    Get Dictionary Value: op     → in Guard → Text → Set Variable: GOp
G9    Get Dictionary Value: value  → in Guard → Text → Set Variable: GValue
        ══ 按 source 取当前实况 Cur（加新守卫种类 = 在此加一个 If 分支）══
G10   If → GSource is → current_focus
G11     Get Current Focus → Text → Set Variable: FocusName
G12     Get Dictionary Value: i18n → in Cloud
G13     Get Dictionary Value: focus_name_to_token → in（G12）
G14     Get Dictionary Value:（FocusName）→ in（G13）→ Text → Set Variable: Cur
          （空 Focus → 查不到 → Cur 空；下方标记法按空处理，需要时对应 token none）
G15   End If
G16   If → GSource is → app
G17     Get Current App → Bundle Identifier → Text → Set Variable: Cur
G18   End If
G19   If → GSource is → locked
G20     Get Device Details → Device Is Locked → Text → Set Variable: Cur   （true/false）
G21   End If
        （未来 charging/wifi/battery：复制一个 If GSource is <name> → 取值 → Set Cur）
        ══ 按 op 比对 Cur 与 GValue（标记法兼容空值）══
G22   Text: X（插入 Cur）→ Set Variable: CurMark
G23   Text: X（插入 GValue）→ Set Variable: ValMark
G24   If → GOp is → is
G25     If →（CurMark）is not →（ValMark）→ Stop and Output: SKIP   （短路: 直接返回，不空跑剩余守卫）
G26   End If
G27   If → GOp is → is_not
G28     If →（CurMark）is →（ValMark）→ Stop and Output: SKIP       （短路同上）
G29   End If
G30 End Repeat
G31 Stop and Output → GuardResult                                   （全部通过 → PASS）
```

**op 词表**: is | is_not（未来 gt/lt/contains 加分支于 G24 区）。
**source 词表**: current_focus | app | locked（未来 charging/wifi/battery）。
**为何 CheckGuards 独立**: 三字段共用一套守卫逻辑；加守卫种类只改此指令一处，
字段主逻辑永不动 —— 这是"加分支不回插"的落地。

---

## §2 ApplySilent（独立指令，最简，先拼这个练手）

```
S1  Text: BASE/state → URL → Get Contents of URL(GET)
S2  Get Dictionary from Input →（S1）→ Set Variable: Cloud
    ── 守卫（§1）──
S3  Get Dictionary Value: fields.silent.guards → in Cloud → Set Variable: Guards   （字段级，与 value 同级）
S4  Dictionary: { guards: Guards, cloud: Cloud } → Run Shortcut: CheckGuards →入 → Set: GuardResult
S5  If → GuardResult is → SKIP → Stop This Shortcut → End If     （守卫拦截，不动手不落账）
    ── 期望 + 记忆 ──
S6  Get Dictionary Value: fields.silent.value → in Cloud         （原始值，判空用）
S7  Text: X（插入 S6）→ If →(该文本) is → X                       （云端 null）
S8    写 la_silent = none（§5）→ Stop This Shortcut
S9  End If
S10 Text →（插入 S6）→ Set Variable: Expect
S11 读 la_silent（§5）→ Set Variable: LA
S12 Text: 0 → Set Variable: ShouldRun
S13 If → Expect → is not → LA → Text: 1 → Set: ShouldRun → End If
S14 Get Dictionary Value: fields.silent.apply → in Cloud → Text
S15 If →（S14）is → enforce → Text: 1 → Set: ShouldRun → End If
S16 If → ShouldRun is → 1
S17   If → Expect is → on → Set Silent Mode On → Otherwise → Set Silent Mode Off → End If
S18   写 la_silent = Expect（§5）
S19 End If
```

## §3 ApplyVolume（独立指令；结构=Silent，两处差异）

照 §2 抄，`fields.silent.*` 换 `fields.media_volume.*`（⚠️**含 S3 的 guards 路径**:
必须改成 `fields.media_volume.guards`，这是复制粘贴最易漏的一处），`la_silent` 换 `la_volume`，差异:
```
V-a  S17 执行段换: Calculate →（S6 原始数字）÷ 100 → Set Volume ←（结果）
     （算术用原始数字；比较/落账用文本）
V-b  其余全同（守卫 S3-S5、标记判空 S7、null 写 none、enforce、落账）
```

## §4 ApplyFocus（独立指令；v1 变量机制 + 云端本机名 + 守卫）

> 依据 DEVLOG 2.1(已更正): **Turn Focus 本身就能生效，无需 priming 前置**。
> Get Current Focus 只在"逻辑需要当前专注名"处读(切换先关当前、关闭挑对象)——
> 那是守卫/切换需要，不是 Turn 需要。
> Set Focus 吃**本机语言名文本变量**(DEVLOG 2.1 实证)，故必须用 i18n 反查本机名。

```
F1  Text: BASE/state?...&locales=zh,en（首位=系统语言）→ URL → Get Contents(GET)
F2  Get Dictionary from Input →（F1）→ Set Variable: Cloud
    ── 守卫（§1；服务端已把 only_if_current 翻译进 guards，手机只认 guards）──
F3  Get Dictionary Value: fields.focus.guards → in Cloud → Set Variable: Guards   （⚠️字段级，不是 .value.guards）
F4  Dictionary: { guards: Guards, cloud: Cloud } → Run Shortcut: CheckGuards → Set: GuardResult
F5  If → GuardResult is → SKIP → Stop This Shortcut → End If
    ── 期望 + 记忆 ──
F6  Get Dictionary Value: fields.focus.value → in Cloud          （原始值，判空用）
F7  Text: X（插入 F6）→ If →(该文本) is → X                       （云端 null）
F8    写 la_focus = none（§5）→ Stop This Shortcut
F9  End If
F10  Get Dictionary Value: fields.focus.value.action → in Cloud → Text → Set Variable: Act
F10a Get Dictionary Value: fields.focus.value.preset → in Cloud → Text → Set Variable: Pre
F10b Text:（Pre）|（Act）→ Set Variable: ExpectSig
       ⚠️ 用 preset 的【token】(do_not_disturb) 不用本机名 → 签名跨语言稳定，换语言不误判。
       例: "do_not_disturb|on" / "sleep|on" / "|off"。**这修的是跨 preset 同 action 切换失效**:
       勿扰(on)→睡眠(on) 若只比 action 会判"没变"跳过 → 新 preset 永不生效; 签名则不同。
F11  读 la_focus（§5）→ Set Variable: LA
F12  Text: 0 → Set Variable: ShouldRun
F13  If → ExpectSig → is not → LA → Text: 1 → Set: ShouldRun → End If
F14 Get Dictionary Value: fields.focus.apply → in Cloud → Text
F15 If →（F14）is → enforce → Text: 1 → Set: ShouldRun → End If
F16 If → ShouldRun is → 1
      ── 查期望专注的【候选名数组】（token→名数组，多语言穷举兜底 GUARDS §3.1）──
F17   Get Dictionary Value: fields.focus.value.preset → in Cloud → Set Variable: WantToken
        （action=off 无 preset 时 WantToken 空 → 走 F31 关闭分支，不进开启循环）
F18   Get Dictionary Value: i18n → in Cloud
F19   Get Dictionary Value: focus_token_to_name → in（F18）
F20   Get Dictionary Value:（WantToken）→ in（F19）→ Set Variable: WantNameList
        ⚠️ **直接是数组，绝对不要加 Text 动作**（强转 Text 会变 "A, B" 逗号死文本，喂 Set Focus 必失效）
F21   Get Current Focus → Text → Set Variable: NowName          （可能空）
F22   If → Act is → on
        ── 先关当前别的专注【只做一次，在循环外】；当前已是目标则跳过清场，防 On→Off→On 翻转 ──
F23     Combine Text →（WantNameList）with Custom separator "|" → Set Variable: CombinedNames
F23a    Text: X（插入 NowName）→ Set Variable: NowMark
F24     If →（NowMark）is not → X                                （当前有专注）
F24a      If →（CombinedNames）does not contain →（NowName）      （且当前专注不在候选名单里）
F25         Set Focus → Turn（变量 NowName）Off                  （才清场；否则跳过，循环内幂等覆盖）
F26         Wait 1 Second
F27a      End If
F27     End If
          （防翻转闪烁: 当前专注若已是候选之一，不 Off 再 On——避免连累绑该专注的其他
           iOS 自动化(锁屏/智能家居)被误触发两次；循环内 Turn On 对已开目标幂等无害。）
        ── 遍历候选名试开 + 验证 + 成功短路（循环内只做"试开一个名"）──
F28     Repeat with each item in WantNameList →（当前项 = CandidateName）
F29       Set Focus → Turn（变量 CandidateName）On, until Turned Off
F30       Get Current Focus → Text → Set Variable: VerifyName
F31       If → VerifyName is → CandidateName                    （切换成功）
F32         写 la_focus = ExpectSig（§5）                        （存签名 preset|action）
F33         Stop This Shortcut                                  （成功即短路，等同跳出循环）
F34       End If
F35     End Repeat
          （循环走完未 Stop = 所有候选名都没开成功 → 不落账，下轮重试；
           大部分 1 个候选即成，极端 iOS 改名时靠后续候选兜底）
F36   Otherwise                                                 （Act = off）
        ── 关闭: 无差别清场，当前若有任何专注一律关（关任意不挑名，无需候选数组）──
F37     Text: X（插入 NowName）→ If →(该文本 is not X)
F38       Set Focus → Turn（变量 NowName）Off
F39     End If
F40     写 la_focus = ExpectSig（§5）                            （存签名，off 时为 "|off"）
F41   End If
F42 End If
```
（**多 preset 天然支持**（**多 preset 天然支持**: F20 按 token 查候选名数组，F29 的 Turn 吃变量，加专注模式
 只需云端 i18n 有该 token↔名数组，**手机零改**；关闭 F38 变量通杀，无需分档也无需数组。）

## §5 last_applied 读写（每字段独立文件，防并发覆盖）

**独立文件**(v3.0 关键: 每字段一文件，指令间不共享变量、不抢文件):
`la_silent.json` / `la_focus.json` / `la_volume.json`（Shortcuts 文件夹；纯文本）。
存法: silent 存 `on/off`，volume 存数字文本，**focus 存签名 `preset|action`**(如
`do_not_disturb|on`)，null 一律哨兵 `none`。读回即 LA，与各自 Expect/ExpectSig 比对。

> ⚠️ **路径陷阱**: File 动作的灰色预设根目录若已是 Shortcuts，路径**只填文件名**，
> 不要再写 `Shortcuts/`——否则套娃成 `Shortcuts/Shortcuts/…` 或权限报错。

**读**:
```
Get File → la_<field>.json（关 Error If Not Found；根目录用预设 Shortcuts）
Text: X（插入 File）→ If (该文本) is X → Text: none → Set LA    （无文件/空 = none）
Otherwise → Set LA ←（File 文本）
End If
```
**写**:
```
Text:（Expect 或 none）→ Save File → la_<field>.json
  ✅ Overwrite If File Exists；关 Ask Where To Save；根目录用预设 Shortcuts
```

## §6 主调度 RunAll（可选；不想要大模块可跳过）

> **默认推荐: 每个 Apply* 各挂一个每小时自动化，不建 RunAll**——完全独立，互不影响。
> 仅当想"一键全跑"时才建 RunAll，它只调度、不含字段逻辑:
```
R1  Run Shortcut: ApplySilent
R2  Run Shortcut: ApplyFocus
R3  Run Shortcut: ApplyVolume
R4  GET BASE/state → Get Dictionary Value: reconcile_alarms → Text
R5  If →(R4) is → true → Run Shortcut: SyncAlarms → End If
```
（各 Apply* 各自 GET 一次 state——实测二三十次网络交互可靠。省流量可让 RunAll GET 一次
 传参给子指令，但**独立性/简单性优先**，首版各取各的。）

## §7 SyncAlarms（改造现有 v1 版本，别重建）

克隆现有 SyncAlarms，只改四处:
```
① URL → BASE/state
② 固定闹钟数据源 → alarms.fixed[]；action ON/OFF → on/off
③ 动态清单 → alarms.dynamic[]；建闹钟时间取 at 后 5 位(HH:MM)
④ sweep 前缀两个: GateFix-（固定，只开关）/ GateDyn-（动态，建删+按名对账）
```

## §8 边界刺客（长期保留——堵"迟到断言窗口"）

现有每个刺客只改:
```
① URL → BASE/state?mode=point
② 读 current_state(时刻优先值包): null/无值→装死；否则逐字段执行
   （执行前同样 Run CheckGuards；focus 用 §4 本机名机制）
③ 执行成功后更新对应 la_<field>.json 并落盘（准点断言+落账，边界后手动操作存活）
④ current_state.reconcile_alarms is true → Run SyncAlarms
```

## §9 灰度顺序

```
① 先建 CheckGuards(§1) + ApplySilent(§2) → 手动跑通，对照 BASE/timeline 核对
② ApplyVolume(§3) + ApplyFocus(§4) 各自独立拼 → 各自手动跑通
③ 各挂每小时自动化(Time of Day / 关 Ask Before Running)，与旧刺客并行一周
④ SyncAlarms 切数据源(§7)；刺客换 URL+加落账(§8，保留不退役)
⑤ config.user.js 设 V2:{DEFAULT:true} 收口
```

## §10 UseAI（启用 V2.AI_QUOTA 后；独立指令）

```
U1  GET BASE/state → Get Dictionary Value: fields.cadence.ai_claude.value   （v0.7 命名空间键）
U2  If →(U1) is → true
U3    Open App → 你的 AI 应用
U4    Format Date: yyyy-MM-dd HH:mm（Current Date）
U5    生成 UUID(或时间戳文本作幂等键)
U6    GET BASE/fact → POST JSON: { stream: ai_claude, at:(U4), id:(U5), type: done }
U7  Otherwise → Show Notification: 冷却中（恢复提醒 GateDyn-CAD 已在对账清单）
U8  End If
```
纠偏: 同 U6，type 换 reset；或 set_next + payload:{at:"…"}。

## §11 延迟实验（部署后随时跑，裁决 P3 上云）

**探针**: POST latency_probe 记 t0+响应 colo → 轮询 GET 至可见记 t1+colo → 记
「延迟秒/写读同节点否」；换 WiFi/蜂窝/旅行多测。**被动**: 各 Apply* 落账后 POST
applied_state{field,value}(失败无所谓)。裁决 KV 够用 vs 上 Durable Object。

## §12 常见坑速查

| 症状 | 原因 | 铁则/位置 |
|---|---|---|
| If 条件里选不到 is | 输入没过 Text | 铁则1①: 先 Text |
| 判空失灵/音量0被当null | has any value 的 0即空怪癖 | 铁则1②: 标记法 "X0" is X |
| 长假夜里不再自动静音 | null 时留空没写 none | 铁则2: 写 none 哨兵 |
| 手动开的睡眠被误关 | 守卫拦截后仍写 LA，或没跑守卫 | 铁则3 + §1 CheckGuards |
| 跑一次正常下次全重放 | 忘了落盘 last_applied | §5 写 |
| 换语言 Set Focus 开失败 | 喂了 token 不是本机名 | §4 F17-F20 反查本机名 |
| 关专注只关勿扰关不掉睡眠 | 没用变量喂 Set Focus | §4 F33 变量通杀 |
| focus 守卫永远失效 | 读了 .value.guards（多一层） | §4 F3: fields.focus.guards 字段级 |
| Set Focus 喂了 "A, B" 死文本失效 | 候选名数组被 Text 强转拼接 | §4 F20: 数组不加 Text, 进 Repeat 逐个试 |
| 专注切换偶尔漏关旧的 | "先关当前"塞进候选循环内 | §4 F23-27: 关当前只做一次, 在循环外 |
| 跨preset切换失效(勿扰→睡眠不生效) | la_focus 只存 action, 判"没变"跳过 | §4 F10b: 存签名 preset|action |
| 切同目标专注引发自动化误触发两次 | 无脑 Off 再 On 翻转 | §4 F24a: 当前是候选则跳过清场 |
| CheckGuards 慢/变量污染 | 循环里没短路 | §1 G25/G28: Stop and Output |
| last_applied 存进套娃文件夹 | 路径写了 Shortcuts/ 前缀 | §5: 只填文件名 |
| 加锁屏/App守卫要改每个字段 | 守卫没抽成子指令 | §1: 只改 CheckGuards 一处 |
| 拆分指令互相覆盖 last_applied | 共用了一个文件 | §5: 每字段独立文件 |
| 自动化夜里不跑 | Ask Before Running 没关 | §9 ③ |
