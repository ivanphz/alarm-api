# 04-PHONE — 手机端装配手册

> 装配/修改快捷指令时看这一篇。**最后更新 2026-07-31**（时刻 07:40→07:44、全 pulse、
> 新增通知自动化与埋点）。
>
> 手机能力的事实依据在 [05-FACTS](05-FACTS.md)；信封格式在 [03-CONTRACT](03-CONTRACT.md)。

---

## §0 本轮要做的改动（2026-07-31，尚未落地）

按优先级：

| # | 改什么 | 为什么 | 工作量 |
|---|---|---|---|
| 1 | **刺客 07:40 → 07:44** | 晨间解除时刻变了（锚定最晚起床闹钟+20，下限 07:44） | 改一条自动化 |
| 2 | **新建通知自动化**：收到通知 → 标题包含 `\|SYNCALL\|` → 运行 SyncAll，关掉「运行前询问」 | 门铃唯一的落点；不建则出差日不解除 | 新建一条 |
| 3 | **语言自报**：组 URL 时用 Actions `Get User Details` → Language Code 拼 `&locales=<码>` | 根除「URL 丢 locales → 守卫全线永久拦截且不报错」 | 改一处 |
| 4 | 埋点四个点（见 §埋点） | 抓 Shortcut Timed Out | 半天 |
| 5 | 回传（见 [07-ROADMAP](07-ROADMAP.md)） | 自愈的前提 | 下一阶段 |

⚠️ 竖线 `|` 不能省 —— iOS 通知过滤是 `contains`（子串匹配），将来加 `SYNC` 会互相命中。

**当前刺客清单**（`/v2/schema` 的 `automations` 段会实时生成）：
`07:44` `09:30` `12:15` `13:29` `20:55` `22:25`

---

## §0.1 ⚠️ 全 pulse 的后果

`focus` / `silent` / `media_volume` 的边界现在全是 pulse：
**手动跑 SyncAll（不带 `mode=point`）时这三个字段什么都不做**，这是正确行为不是 bug。
要手动触发某一刻的动作，带 `{mode:point, now:HH:MM}`。

---


> **手机端版本变更史**（v4.1 → v6.0，共 32 条修订）已移入
> [13-HISTORY](13-HISTORY.md) §8 —— 装配时不需要读，排查「为什么当初这么设计」时再去看。
> 其中最重要的三条已升格为下面的**铁则6/7/8**。

> **建的顺序**：§2 GetState → §3 CheckGuards → §5 ApplySilent（跑通再往下）→
> §6 ApplyVolume → §7 ApplyFocus → §8 SyncAlarms → §9 CleanAlarms → §11 触发器。

---

## §0 八条铁则（先读，违反必出诡异 bug）

**铁则1 — 进 If 的值必须先过 `Text`；判空用"标记法"。⚠️ 但布尔是例外，见铁则7。**
① 任何进 If 或进条件框的值，先过一次 `Text` 动作（数字 0→"0"、空→空文本）。
② 判空**禁用 `has any value`**（0 即空的版本怪癖，两边都有）。统一用**标记法**：
   `Text: X（插入变量）` → `If (该文本) is X` ⇒ 命中即为空。确定性文本相等，不赌。
③ 数字只在算术处用原始值；比较/落账一律文本。

**铁则2 — 云端 `value` 为 null ⇒ 写哨兵 `none`，不是留空。**
不动手 + 把该字段 last_applied 设为文本 `none`（放下记忆：下次真值出现时 `值 ≠ none`
必判为变化，长假后夜间重进才会触发）。禁止"留空写入"（版本行为不定型）。

**铁则3 — 守卫拦截时不落账。**
CheckGuards 返回 SKIP → 跳过该字段且**不更新 last_applied**（下轮重判）。
`enforce` 只压"无变化跳过"，压不过守卫。只有实际动手成功才写 last_applied。

**铁则4 — 不要用【不同类型】的值覆盖同名变量。**
尤其"字典 → 文本"这种降级覆盖：V2 的连环失效就是 `Get Value … → Set 同名变量`
把字典覆盖成字符串，后续取值全空。取出来的中间值一律存新变量。
> 例外：布尔标志位（`Matched` 先 `0` 后 `1`）类型不变，是标准写法，不受此限。

**铁则5 — `contains` 判断必须两边加分隔符。** ⭐ v4.1 新增
`A contains B` 是**子串**匹配，不是成员匹配。专注名「工作」是「工作模式」的子串，
bundle id `com.app.a` 是 `com.app.about` 的子串——直接 contains 必然误命中。
凡是拿 contains 当"属于集合"用的地方，两边都补分隔符：
`|A|B|C|` contains `|B|`。（守卫路径已由服务端展开成 `match[]` 逐项精确相等，不受此影响；
本铁则针对 §7 F26a 那类手工拼接的场合。）

**铁则6 — 闹钟只有四个操作：建 / 开 / 关 / 删。没有"改"。** ⭐ v4.2
`Create Alarm` / `Turn On` / `Turn Off` / `Delete`。**iOS 快捷指令没有"修改现有闹钟时间"的动作。**
这不是可以绕过去的限制，是整套动态闹钟设计的根：
- 正因为不能改时间 → 时间必须**编进标签**（`GateDyn-Event-0530`）
- 改时间 = 标签变 = **关掉旧的 + 建一条新的**，而不是就地更新
- 代价就是旧标签的闹钟会堆积 → 需要 §9 的月度清扫

⚠️ **别拿提醒事项(todo)的心智套闹钟**。提醒事项能 `Set Detail` 就地改到期日，
所以 todo 通道是"改期即改铃、身份不变"；闹钟**做不到**，只能关旧建新。
两者的对账模型因此根本不同，不要互相借鉴实现。

**铁则7 — 布尔值绝不过 `Text`（铁则1 的唯一例外）。** ⭐ v4.3 · 实测
`Text(true)` 在**中文系统渲染成「是」、英文系统「Yes」**，历史上还出现过 `1`/`0`、`true`/`false`。
**呈现方式随系统语言和 iOS 版本漂移，不是契约。** 拿它去比对必然失败，
而且是**静默失败**——条件永不成立，表现为"什么都没发生"，最难查的一类。

两种来源分开处理：

| 布尔来自 | 怎么办 | 位置 |
|---|---|---|
| **服务端信封** | ✅ **已在服务端根治**：信封里永不出现裸布尔，真值一律下发字符串 `"true"`/`"false"`。手机端照常过 `Text` 做文本相等即可，**无需任何类型处理** | §8 A21a（`alarms.sweep`）|
| **iOS 自己的动作**（`Device Is Locked` 等） | 手机端必须建一层**语言无关隔离带**：`If (布尔) is True → Text: true / Otherwise → Text: false`，把系统布尔翻成死文本再参与比较 | §3 G17 |

> 服务端那侧有一条全量扫描测试盯着（递归遍历整个信封，出现任何 boolean 就红），
> 所以**将来新增字段也不可能把裸布尔漏出来**。你只需处理 iOS 自己产生的布尔。

**铁则8 — `Get Dictionary from Input` 只能喂字典。喂数组会静默清空。** ⭐ v6.0 实测重写

**实测结论（2026-07-26，三层传导测谎仪）**：

| 传的东西 | 不洗 | 洗（`Get Dictionary from Input`）|
|---|---|---|
| 手工字典 | ✅ 正常取值 | ✅ 正常 |
| `Get Contents of URL` 的信封 | ✅ 读出 `version: 2` | ✅ 正常 |
| **数组** `[1,2,3]` | ✅ **Count = 3，完好无损** | ⛔ **Count = 0，静默清空** |

**真相与此前的传言相反**：
- ❌ ~~"结构穿过 `Run Shortcut` 边界会被降级成纯文本"~~ —— **证伪**。字典和数组都完好。
  这是 v4.1 一次评审提出、被引用了五个版本却**从未验证**的断言。
- ✅ **危险的是"洗"这个动作本身**：`Get Dictionary from Input` 遇到数组
  **不报错、不提示，直接返回空**。

**两条硬规矩**：

1. **⛔ 绝不对数组做 `Get Dictionary from Input`。**
   后果是静默清空 → 后续 `Count` 为 0、`Repeat` 一次不跑 → **逻辑整个哑火且无报错**。
   具体到本手册：若 CheckGuards 直接收 `guards` 数组再洗一遍，
   就是 `Count = 0` → **所有守卫被当成 0 条而全部放行**。（v5.5 改成收字典，正好避开。）

2. **✅ 别让裸数组过边界 —— 包进字典再传。**
   不是因为数组过不去（它过得去），而是因为**接收方一旦按习惯洗一下就全毁了**。
   包成字典后，接收方洗字典（安全）→ 内部掏数组（安全），
   **不存在"记得别洗"这种负向规矩**。CheckGuards 就是这么做的。

**现有三处洗数据，洗的都是字典，全部安全**：

| 指令 | 洗在哪 | 洗的是 | 定性 |
|---|---|---|---|
| `GetState` | N0 | 参数字典 / 信封 | 实测洗不洗都行 → **1 块的保险，留着** |
| `CheckGuards` | G0a | `fields.<x>` 字典 | 同上 |
| `ApplyX` | S1g | 信封 | 同上 |

> **别把"洗"当成万能防护。** 它对字典无害、对数组致命。
> 判据不是"它是不是结构"，而是**"它是不是字典"**。

**变量命名**（每个指令内部，不跨指令）：

| 变量 | 含义 |
|---|---|
| `Cloud` | GetState 返回并解析后的整包字典 |
| `Expect` / `ExpectSig` | 本字段期望值（文本）／focus 的签名 `preset\|action` |
| `LA` | 本字段 last_applied 读回值（文本） |
| `ShouldRun` | `"0"` / `"1"` |
| `GuardResult` | CheckGuards 返回的 `PASS` / `SKIP` |
| `Params` | 传给 GetState 的 `{mode, now}` 字典 |

---

## §1 预建物清单（一次性，先备齐再拼指令）

- **固定闹钟**：`config.FIXED_ALARMS` 里的 7 条 + 每门配了 `fixed` 锚的课一条
  `GateFix-Class-<id>`。在时钟 App 里逐条配好**时间/铃声/震动/Label**，
  Label 与配置**逐字一致，大小写敏感**。
- **文件**：`la_silent.txt` / `la_focus.txt` / `la_volume.txt`（首次运行自动建，不用预建）。
  ⛔ **必须 `.txt`，绝不能 `.json`** —— 裸 token 不是合法 JSON，`.json` 扩展名会让读取
  **静默返回空** → LA 恒为 `none` → `on_change` 退化成 `enforce`。详见 §10。
- **观测备忘录**：一条固定 Note，用于后台调试探针（§12）。

---

## §2 共享子指令 `GetState`（先建这个）

**作用**：拉取信封。**URL、鉴权、参数的唯一改动点**——以后加参数只改这一处。
**输入**：字典 `{ mode: "segment"|"point", now: "HH:MM" 或空 }`（允许空字典）
**输出**：**原始响应，不解析**（见下方说明）。

```
    ══ ⓪ 洗数据（铁则8）——★ 全系统最关键的一块 ══
N0  Get Dictionary from Input ←（Shortcut Input）→ Set Variable: In
      ★ **实测洗不洗都能读出 `version`**（手工字典与 URL 信封均已验证）。留着当 1 块的保险。
      ★ 以下是"万一真降级了"的后果，**不是已观测到的现象**： 信封要连穿三道 Run Shortcut 边界
         （GetState→SyncAll→ApplyX→GetState），每穿一次都可能被降级成纯文本。
         不洗的后果：N1 取不到 `version` → N5 直通失效 → GetState 以为收到的是参数 →
         取不到 mode 于是回落 segment → **重新发一次网络**。
         四个模块各来一次 = **1 次网络变 5 次，且刺客的 `now`/`point` 全部丢失，
         静默退化成普通轮询**。全程无报错，只有观察网络请求才看得出来。

    ══ ① 先把输入里可能有的四个键【一次性全读出来】══
N1  Get Dictionary Value: version → in（In）→ Text → Set Variable: Ver
N2  Get Dictionary Value: mode    → in（In）→ Text → Set Variable: Mode
N3  Get Dictionary Value: now     → in（In）→ Text → Set Variable: Now
N4  Get Dictionary Value: apply   → in（In）→ Text → Set Variable: Ap
      （不存在的键取出来是空，标记法判空即可；空输入走不到这里，见调用方的兜底）

    ══ ② 直通判定：收到的已经是信封 → 原样吐回，不发网络 ══
N5  If → Ver is → 2 → Stop and Output ←（In）→ End If
      （吐 `In` 而不是原始 `Shortcut Input`：吐出洗干净的规范形态，下游少一次不确定）
      ★★ 这三行让「参数还是信封」的判别【只发生在传输层】，
         各 ApplyX 因此一块都不用加，且以后加多少模块都不再增加。
      ⚠️ 判别键必须用 `version`（恒为 "2"），**不能用 `fields`**——
         降级信封的 fields 是 {}，取出来可能渲染成空，判别会翻车。

    ══ ③ 缺省值 ══
N6  Text: X（插入 Mode）→ If →(该文本) is → X
N7    Text: segment → Set Variable: Mode2
N8  Otherwise
N9    Text ←（Mode）→ Set Variable: Mode2
N10 End If

    ══ ④ 拼 URL（可选参数逐个追加）══
N11 Text:
      https://<你的域名>/v2/state?key=<KEY>&mode=（Mode2）&locales=zh,en&platform=ios
    → Set Variable: Url
      ⚠️ **这段 URL 必须手打，不要从聊天记录/网页粘贴**（2026-07-27 实案）：
         粘贴容易带进**零宽连接符**等不可见字符，落在 `&` 与参数名之间就把参数名污染成
         `⁠locales`，服务端 `searchParams.get("locales")` 直接返回 null。
         **而 `mode` / `platform` 的默认值恰好等于期望值，丢了也看不出来** ——
         只有没有默认值的 `locales` 会露馅，表现为「专注永远开不起来，别的都正常」。
      🔎 **自查**：跑一次看 trace 里的 `router/params` 回显，它列出服务端**实际收到**的参数；
         若参数名里有怪字符，服务端还会额外报 `param_name_polluted`。
N12 Text: X（插入 Now）→ If →(该文本) is not → X
N13   Text: （Url）&now=（Now） → Set Variable: Url2
N14 Otherwise
N15   Text ←（Url）→ Set Variable: Url2
N16 End If
N17 Text: X（插入 Ap）→ If →(该文本) is not → X
N18   Text: （Url2）&apply=（Ap） → Set Variable: Url3
N19 Otherwise
N20   Text ←（Url2）→ Set Variable: Url3
N21 End If

    ══ ⑤ 发请求，原样吐出（不解析）══
N22 URL ←（Url3）→ Get Contents of URL (GET)
N23 Stop and Output ←（N22）
```

> ⭐ **解析放在调用方，不放这里。**
> `Run Shortcut` 把子指令输出跨指令传递时，字典极易被引擎强转成文本，后续
> `Get Dictionary Value` 静默失败 → 你的缺席检查会误判成"字段不存在"而直接退出，
> **表现为"什么都不发生"，最难查的一种**。
> 解析只发生在一处（调用方 §5 S1f），就不存在"到底哪一层已经转过了"的含糊。

> ⚠️ **`locales=` 首位必须是你的系统语言**（决定 Set Focus 先试哪个名字）。
> ⚠️ **别在这里写死 `now=`**——测试用完一定清掉，否则永远采样在那个时刻。

---

## §3 共享子指令 `CheckGuards`（守卫逻辑的唯一改动点）

**作用**：逐条比对手机实况，全满足输出 `PASS`，任一不满足 `SKIP`。
**输入**：**一个带 `guards` 键的字典** —— 实际就是把 `fields.<x>` 整个传进来。
**输出**：文本 `PASS` / `SKIP`（纯文本，调用方不要洗）。

> ⚠️ **为什么收字典而不是直接收 guards 数组** —— **实测支撑（2026-07-26）**：
> `Get Dictionary from Input` **喂数组会静默返回空**（实测 Count 3 → 0，不报错）。
> 若这里直接收 `guards` 数组、又按习惯洗一下，就是
> **`Count = 0` → 所有守卫被当成 0 条 → 全部放行**，且毫无迹象。
> 收字典则：洗字典（安全）→ 内部掏数组（安全），**不需要"记得别洗"这种负向规矩**。
> 顺带 ApplyX 各少一块，净减 2 块。
>
> 由此 CheckGuards 的输入契约是「**一个带 `guards` 键的字典**」。
> 将来若要在别处复用（如给闹钟或 todo 加守卫），把守卫包成 `{guards:[...]}` 再传即可。

```
G0a Get Dictionary from Input ←（Shortcut Input）→ Set Variable: FDict
      ★ 铁则8 洗数据。传进来的是**字典**（`fields.<x>` 整个），
        所以这个"洗字典"的动作是确定能用的 —— 不碰"数组过边界"那个未知区。
G0b Get Dictionary Value: guards → in（FDict）→ Set Variable: Guards
      ★ 在指令【内部】掏出数组。**实测：数组在指令内部与跨边界都完好**，
        真正会毁掉它的是对它做 `Get Dictionary from Input`（静默清空）——
        这里不会发生，因为洗的是外层字典。
        字段没有 guards 时这里取到空 → G3 的 Count 为 0 → 直接放行，正确。
G2  Text: PASS → Set Variable: GuardResult                  （默认通过）
G3  Count → Items in（Guards）
G4  If →（G3）is → 0 → Stop and Output ←（GuardResult）→ End If
      （无守卫直接放行；guards 整个不存在时 Count 为 0，同样安全）
G5  Repeat with each item in（Guards）→ 当前项 = Guard
G6    Get Dictionary Value: source → in（Guard）→ Text → Set Variable: GSource
G7    Get Dictionary Value: op     → in（Guard）→ Text → Set Variable: GOp
G8    Get Dictionary Value: match  → in（Guard）→ Set Variable: GMatch
        ⚠️ **不要加 Text**——它是数组，强转会变成 "A, B" 死文本
      ══ 读当前实况：唯一需要按 source 分支的地方 ══
G9    Text: __unknown__ → Set Variable: Cur                  （哨兵默认值，见 G19）
G10   If → GSource is → current_focus
G11     Get Current Focus → Text → Set Variable: Cur          （无专注时为空，正常）
G12   End If
G13   If → GSource is → app
G14     Get Current App → Bundle Identifier → Text → Set Variable: Cur
G15   End If
G16   If → GSource is → locked
G17a    Get Device Details → Device Is Locked
G17b    If →（G17a，点变量把类型设为 Boolean/布尔值）is → True
G17c      Text: true  → Set Variable: Cur
G17d    Otherwise
G17e      Text: false → Set Variable: Cur
G17f    End If
G18   End If
        ★ **v4.3 铁则7 隔离带**：这是 iOS【自己】产生的布尔，服务端管不着。
          直接过 Text 会得到「是/否」或「Yes/No」，与服务端 resolve.locked 的
          ["true","false"] 对不上 → 落进 G19 的 fail-closed → **100% 拦截，该字段永远停摆**。
        （以后加 charging / wifi / battery：在此复制一个 If 分支即可，别处不动）
G19   If → Cur is → __unknown__ → Stop and Output: SKIP → End If
        ★ **fail-closed 兜底，必须有**：服务端将来加了新守卫源、而这里还没实现，
          则整个字段停摆（不动手），而不是**无保护地动手**。宁可不动，不可胡动。
      ══ 成员判断：match[] 已由服务端按本机展开，逐项精确相等，无子串误配 ══
G20   Text: 0 → Set Variable: Matched
G21   Repeat with each item in（GMatch）→ 当前项 = M
G22     Text: X（插入 Cur）→ Set Variable: CurMark
G23     Text: X（插入 M）  → Set Variable: MMark
G24     If →（CurMark）is →（MMark）→ Text: 1 → Set Variable: Matched → End If
G25   End Repeat
      ══ 只有两个 op（服务端已把 is/is_not 翻译成单元素 in/not_in）══
G26   If → GOp is → in
G27     If → Matched is → 0 → Stop and Output: SKIP → End If   （不在集合 → 拦截）
G28   End If
G29   If → GOp is → not_in
G30     If → Matched is → 1 → Stop and Output: SKIP → End If   （命中集合 → 拦截）
G31   End If
G32 End Repeat
G33 Stop and Output ←（GuardResult）                            （全部通过 = PASS）
```

**为什么不需要 `resolve`**：服务端已把 `value: ["maps"]` 展开成
`match: ["com.apple.Maps","com.google.Maps","com.autonavi.amap","com.baidu.BaiduMap"]`。
你以后往守卫里加 App、加类别、加专注模式，**这里一个块都不用改**。

**空实况天然正确**：没开任何专注时 `Cur` 为空字符串。

⚠️ **2026-07-27 起有一个重要变化**：服务端新增了语义 token **`none`**，
它展开成 `match: [""]`（空字符串）—— 所以「当前没有任何专注」现在是**可以被命中的**：

| 守卫 | 展开 | 没开专注时 |
|---|---|---|
| `in: ["sleep"]` | `["睡眠", "Sleep", …]` | 空 ∉ match → **拦截**（"仅当前是睡眠才动手"）✓ |
| `in: ["none"]` | `[""]` | 空 ∈ match → **放行**（"仅当没有专注才动手"）✓ |
| `not_in: ["sleep"]` | `["睡眠", …]` | 空 ∉ match → **放行** ✓ |

G21–G25 的逐项标记法**本来就能处理空串**（`Text: X` 插入空变量 = `"X"`，两边一致即命中），
所以这里**一个块都不用改**。但要知道空串是有意义的值，不是"没值"。

> 夜间进入安静的守卫就是 `in: ["none"]` —— 手动开着任何专注就让路，不打破你的现场。

---

## §4 三个 ApplyX 的公共骨架（先理解，再看具体三节）

```
① 取参数（兼容"无输入"运行）  → Params
② Run GetState → 解析 → Cloud
③ 取本字段 F；F 缺席 → 直接结束（连缓存都不碰）
④ CheckGuards(F.guards)；SKIP → 结束（不落账）
⑤ F.value 为 null → 写 none → 结束
⑥ 算 Expect → 比 LA → 定 ShouldRun（enforce 可强制置 1）
⑦ 动手 → 落账
```
三个 ApplyX 只有第 ⑦ 步和字段名不同。

---

## §5 `ApplySilent`（最简，先拼这个练手）

```
    ── ① 兜底空输入（只解决"无输入会报错"，不做任何判别）──
S1a Text: X（插入 Shortcut Input）→ If →(该文本) is → X
S1b   Dictionary: { }（空字典，不加任何键）→ Set Variable: Params
S1c Otherwise
S1d   Set Variable: Params ←（Shortcut Input）
S1e End If
      ★ 无输入时直接对 Shortcut Input 取字典值会**报错**（不是返回空），必须先判空。
    ── ② 无脑全部交给 GetState 路由（★ 绝不能在这里自己判别）──
S1f Run Shortcut: GetState ←（Params）→ Set Variable: Src
      ★★ **不管拿到的是参数还是信封，一律过一遍 GetState**，由它的 N5 当裁判：
           · `{}`（手动/每小时轮询）              → 拉 segment
           · `{mode:point, now:07:44}`（手动调试）→ 拉 point
           · 信封（刺客 / ForceResync 传入）      → 认出 `version` → 直通，零网络
         ⛔ **别在这里把输入直接当信封用**（曾经的写法：`Set Src ← Shortcut Input`）。
            手动传 `{mode,now}` 时它会被当成信封去取 `fields`，取不到 →
            缺席检查误判 → **指令静默结束，什么都不发生，也不报错**。
            判别是传输层的事，写在这里就要在每个模块重复一遍，且每次都可能漏。
    ── ③ 强制断言字典 ──
S1g Get Dictionary from Input ←（Src）→ Set Variable: Cloud
      ★ **这一步是强制类型断言，不能省**（见 §2 说明）。
    ── ③ 取字段 + 缺席检查 ──
S2  Get Dictionary Value: fields → in（Cloud）→ Set Variable: Fields
S3  Get Dictionary Value: silent → in（Fields）→ Set Variable: F
S4  Text: X（插入 F）→ If →(该文本) is → X → Stop This Shortcut → End If
      ★ **缺席 ≠ null**：字段整个不出现 = 什么都不做，**连 last_applied 都不碰**
    ── ④ 守卫（§3）──
S5  Run Shortcut: CheckGuards ← 输入（F）→ Set Variable: GuardResult
      ★ **直接把整个字段字典 F 传过去，不单独传 guards 数组**（原 S6 已并入本块）。
        CheckGuards 自己会掏 guards —— 这样跨边界的永远是字典，避开"数组过边界"的未知区。
      ★ 返回的是**纯文本** PASS/SKIP，**不要**对它做 Get Dictionary from Input（铁则8 例外）。
S7  If → GuardResult is → SKIP → Stop This Shortcut → End If    （铁则3：不落账）
    ── ⑤ 显式 null ──
S8  Get Dictionary Value: value → in（F）→ Set Variable: Raw     （原始值，判空用）
S9  Text: X（插入 Raw）→ If →(该文本) is → X
S10   写 la_silent = none（§10）→ Stop This Shortcut              （铁则2：放下记忆）
S11 End If
    ── ⑥ 期望 vs 记忆 ──
S12 Text ←（插入 Raw）→ Set Variable: Expect
S13 读 la_silent（§10）→ Set Variable: LA
S14 Text: 0 → Set Variable: ShouldRun
S15 If → Expect → is not → LA → Text: 1 → Set Variable: ShouldRun → End If
S16 Get Dictionary Value: apply → in（F）→ Text → Set Variable: ApplyMode
S17 If → ApplyMode is → enforce → Text: 1 → Set Variable: ShouldRun → End If
    ── ⑦ 动手 + 落账 ──
S18 If → ShouldRun is → 1
S19   If → Expect is → on → Set Silent Mode On → Otherwise → Set Silent Mode Off → End If
S20   写 la_silent =（Expect）（§10）
S21 End If
```

**S4 与 S9 的区别是整份手册最容易搞错的一处**：

| | 信封 | 动作 |
|---|---|---|
| S4 缺席 | `fields` 里没有 `silent` 这个键 | **什么都不做**，连缓存都不碰 |
| S9 null | 键在，`value` 是 `null` | **删缓存**（写 `none`），因为规则在主动放手 |

搞反的后果：把缺席当 null 处理 → 刺客每次没命中都清缓存 → 下一轮全量重放。

---

## §6 `ApplyVolume`（照 §5 抄，三处差异）

```
V-a  S3 的字段名 → media_volume
       ⚠️ 复制粘贴最易漏的一处；guards 走 S5 从 F 里取，不用改路径
V-b  文件名 → la_volume.txt（S10 / S13 / S20 三处；⛔ 必须 .txt，见 §10）
V-c  S19 执行段换成:
       Calculate →（Raw 原始数字）÷ 100 → Set Volume ←（计算结果）
       （算术用原始数字；比较/落账仍用文本 Expect）
```

**恒常守卫典型用途**：服务端给 `media_volume` 配
`GUARDS_ALWAYS: [{source:"app", op:"not_in", value:["maps","video","music"]}]`
→ 导航/视频/音乐前台时 CheckGuards 返回 SKIP → 跳过归零。**手机端零额外代码。**

---

## §7 `ApplyFocus`（唯一复杂的一个）

> 依据实测：**`Turn Focus` 本身就能生效，不需要 priming 前置**。
> `Set Focus` **吃本机语言名的文本变量**，所以必须用 `resolve.current_focus` 查候选名。

```
F1a-F1g  同 S1a–S1g（取参数 → GetState → Get Dictionary from Input → Cloud）
F2  Get Dictionary Value: fields → in（Cloud）→ Set Variable: Fields
F3  Get Dictionary Value: focus  → in（Fields）→ Set Variable: F
F4  Text: X（插入 F）→ If →(该文本) is → X → Stop This Shortcut → End If     （缺席）
F5  Run Shortcut: CheckGuards ← 输入（F）→ Set Variable: GuardResult
      ★ 同 S5：传整个 F，不单独传数组（原 F6 已并入本块）。
      ⚠️ 传的是**字段级的 F**。历史 bug：曾经去读 `value.guards`（多一层），
        导致 focus 守卫**永久失效**。CheckGuards 从 F 的 `guards` 键取，路径唯一。
F7  If → GuardResult is → SKIP → Stop This Shortcut → End If
F8  Get Dictionary Value: value → in（F）→ Set Variable: Val
F9  Text: X（插入 Val）→ If →(该文本) is → X
F10   写 la_focus = none（§10）→ Stop This Shortcut
F11 End If
    ── 签名（★修的是"跨 preset 同 action 切换失效"）──
F12 Get Dictionary Value: action → in（Val）→ Text → Set Variable: Act
F13 Get Dictionary Value: preset → in（Val）→ Text → Set Variable: Pre
F14 Text: （Pre）|（Act）→ Set Variable: ExpectSig
      ⚠️ 用 preset 的 **token**（`do_not_disturb`）不用本机名 → 换语言签名不变。
      例：`do_not_disturb|on` / `sleep|on` / `|off`。
      **只存 action 的后果**：勿扰(on)→睡眠(on) 会被判"没变"而跳过，新 preset 永不生效。
F15 读 la_focus（§10）→ Set Variable: LA
F16 Text: 0 → Set Variable: ShouldRun
F17 If → ExpectSig → is not → LA → Text: 1 → Set Variable: ShouldRun → End If
F18 Get Dictionary Value: apply → in（F）→ Text → Set Variable: ApplyMode
F19 If → ApplyMode is → enforce → Text: 1 → Set Variable: ShouldRun → End If
F20 If → ShouldRun is → 1
      ── 取候选名数组（token → 本机名，多语言穷举兜底）──
F21   Get Dictionary Value: resolve → in（Cloud）→ Set Variable: Resolve
F22   Get Dictionary Value: current_focus → in（Resolve）→ Set Variable: FocusTable
F23   Get Dictionary Value:（Pre）→ in（FocusTable）→ Set Variable: WantNameList
        ⚠️ **绝不加 Text**——数组被强转成 "A, B" 死文本，喂 Set Focus 必失效
        （Act=off 时 Pre 为空 → 查不到 → 空，正好走 F42 关闭分支）
F24   Get Current Focus → Text → Set Variable: NowName          （可能为空）
F25   If → Act is → on
        ── 先关掉当前别的专注：只做一次，在循环外 ──
F26     Combine Text ←（WantNameList）with Custom separator "|" → Set Variable: Joined
F26a    Text: |（Joined）| → Set Variable: Candidates
          ★ v4.1 铁则5：首尾补分隔符，否则「工作」会命中「工作模式」，该清场的没清场
F27     Text: X（插入 NowName）→ Set Variable: NowMark
F28     If →（NowMark）is not → X                                 （当前有专注）
F29       Text: |（NowName）| → Set Variable: NowNeedle            ★ v4.1 同样补分隔符
F29a      If →（Candidates）does not contain →（NowNeedle）        （且不是目标之一）
F30         Set Focus → Turn（变量 NowName）Off
F31         Wait 1 Second
F32       End If
F33     End If
          ★ **当前专注已是候选之一就跳过清场**——无脑 Off→On 会让绑该专注的其他
            iOS 自动化（锁屏/智能家居）被误触发两次。
          ★ **清场必须在循环外**——塞进循环里会偶尔漏关。
        ── 逐个候选名试开 + 验证 + 成功即短路 ──
F34     Repeat with each item in（WantNameList）→ 当前项 = CandidateName
F35       Set Focus → Turn（变量 CandidateName）On, until Turned Off
F35a      Wait 1 Second
            ★ **v4.1 必须加**：Set Focus 是**异步系统总线事件**，立刻读会拿到旧专注名，
              验证失败 → 不落账 → 且循环继续去试下一个候选（同一专注的另一语言名），
              大概率静默无效 → 走完循环白跑一轮，**下次触发照旧全错**。
              1 秒起步；若实测仍偶发失败就提到 2 秒（这个数只能你在机上调）。
F36       Get Current Focus → Text → Set Variable: VerifyName
F37       If → VerifyName is → CandidateName
F38         写 la_focus =（ExpectSig）（§10）
F39         Stop This Shortcut                                    （成功即结束）
F40       End If
F41     End Repeat
          （走完没 Stop = 所有候选名都没开成功 → **不落账**，下轮重试）
F42   Otherwise                                                   （Act = off）
F43     Text: X（插入 NowName）→ If →(该文本) is not → X
F44       Set Focus → Turn（变量 NowName）Off                      （变量通杀，不挑名）
F45     End If
F46     写 la_focus =（ExpectSig）（§10）                            （off 时为 `|off`）
F47   End If
F48 End If
```

**加新专注模式（如自定义"读书"）手机端零改动**：服务端 `resolve.current_focus` 加一行即可。

> 💡 **想彻底摆脱多语言维护**：iOS 里**自建**一个自定义专注（名字不随系统语言变），
> 服务端表里给它加一行固定名，从此换语言零影响。

---

## §8 `SyncAlarms`（无人值守；只建/只开/只关，**绝不删**）

> 铁则6：闹钟没有"改"。所以本指令永远不碰任何闹钟的时间——固定闹钟的时间真相在手机，
> 动态闹钟的时间在标签里（改时间 = 关旧建新）。

```
A1a-A1g  同 S1a–S1g（取参数 → GetState → Get Dictionary from Input → Cloud）
A2  Get Dictionary Value: alarms → in（Cloud）→ Set Variable: Alarms
A2a Get Dictionary Value: sweep → in（Alarms）→ Text → Set Variable: Sweep
      ★ 服务端的 **sweep 授权位**（`"true"` / `"false"`），下面 A22 段用。
    ── 固定闹钟：只开关，**永不碰时间** ──
A3  Get Dictionary Value: fixed → in（Alarms）→ Set Variable: FixedList
A4  Repeat with each item in（FixedList）→ 当前项 = Item
A5    Get Dictionary Value: label  → in（Item）→ Text → Set Variable: Lab
A6    Get Dictionary Value: action → in（Item）→ Text → Set Variable: Act2
A7    Find Alarms where → Label → is →（Lab）
A8    If → Act2 is → on → Turn（A7）On → Otherwise → Turn（A7）Off → End If
A9  End Repeat
    ── 动态闹钟：清单里有的 → 有则开、无则建 ──
A10 Get Dictionary Value: dynamic → in（Alarms）→ Set Variable: DynList
A11 Repeat with each item in（DynList）→ 当前项 = D
A12   Get Dictionary Value: label → in（D）→ Text → Set Variable: DLab
A13   Get Dictionary Value: at    → in（D）→ Text → Set Variable: DAt
A14   Find Alarms where → Label → is →（DLab）
A15   Count → Items in（A14）
A16   If →（A15）is → 0
A17a    Match Text → 正则 \d{2}:\d{2}$ → in（DAt）
A17b    Get Item from List → First Item → from（A17a）
A17c    Create Alarm → Time 选（A17b），Label 选（DLab）
          ★ 正则精确抠出末尾 HH:MM，比"取后 5 位"稳。
            更简单的等价写法：`Split Text（DAt）by 空格 → Get Last Item`
            （契约把 at 冻结为 `YYYY-MM-DD HH:MM`，两种都行，挑你顺手的）。
A18   Otherwise
A19     Turn（A14）On                       （已存在则只开；**不改时间**，标签相同即时间相同）
A20   End If
A21 End Repeat
    ── sweep：开着的 GateDyn- 里，不在本次清单的一律【关掉】（不删）──
A21a If → Sweep is → true                       ← ★★ 判 `is true`，不是 `is not false`
      ★★ **这一句绝不能省，也绝不能反着写。** sweep 的规则是"不在清单就关掉"，
         而空清单 = 全都不在 = 【全关】。服务端任何一次异常、任何一个闹钟源超时，
         都会让清单变短 → **关光你的动态闹钟**。
         注意 `dynamic: []` 本身是【合法指令】（今天真没有动态闹钟，就该全关），
         所以无法靠"空不空"识别故障，只能看服务端给不给授权。
         **写成 `is true` 是 fail-closed**：老服务端不发这个字段、值拼错、拿到空信封 ——
         一律不 sweep（只加不关），而不是"除非明确说 false 否则就关"。
A22   Find Alarms where → Is Enabled → and → Label → contains → GateDyn-
      ★ 加 `Is Enabled` 筛选：只看当前开着的。堆积的那些禁用闹钟不参与循环，
        既省时间，也不会被反复"再关一次"。
A23 Repeat with each item in（A22）→ 当前项 = Al
A24   Get → Label → of（Al）→ Text → Set Variable: ALab
A25   Text: 0 → Set Variable: Found
A26   Repeat with each item in（DynList）→ 当前项 = D2
A27     Get Dictionary Value: label → in（D2）→ Text → Set Variable: DLab2
A28     If →（ALab）is →（DLab2）→ Text: 1 → Set Variable: Found → End If
A29   End Repeat
A30     If → Found is → 0 → Turn（Al）Off → End If
A31   End Repeat
A31a End If                                      ← 对应 A21a
      ★ 未获授权时: 上面 A4-A21 的【加法部分照常执行】（有则开、无则建，幂等且只增），
        只跳过这段破坏性的 sweep。少关一次的代价是几条该关的闹钟多留一轮；
        误关一次的代价是该响的没响。两害相权，宁可少关。
      ★ 用两层循环逐条精确相等，**不拼字符串、不用 contains**——
        避开铁则5 的子串误配，也不依赖 `Add to Variable` 的行为。
        两个集合都很小（开着的动态闹钟 + 本次清单），性能无虞。
```

**为什么只关不删**：`Delete` **会弹人工确认**，放进无人值守流程会卡死在弹窗上
（半夜刺客触发时你根本不在）。删除是破坏性动作，留给 §9 的人工仪式。

**为什么 `GateFix-` 不进 sweep**：A22 只找 `GateDyn-` 前缀。固定闹钟由 A3–A9 显式开关。

**以后加任何动态闹钟族**（cadence 提醒 `GateDyn-CAD-*`、外部源 `GateDyn-ES-*`、
上帝模式 `GateDyn-Event-*`）——**都不用改这里**，同一个前缀一扫全清。
> 对比你 v1 的 delete-alarm：那里要写四个条件
> （`Gate-Dynamic-Event` / `[AI]Claude-Reset` / `Gate-ES` / `Gate-Class`），
> 每加一族就要回来改。v0.7 并成单一 `GateDyn-` 之后，**一个条件通吃、永不再改**。

## §9 `CleanAlarms`（人工清扫仪式，月度；★ v4.2 按实测简化）

**为什么需要**：铁则6——闹钟不能改时间，所以改时间 = 关旧建新，旧标签的闹钟会堆积。
不清理的话，半年后时钟 App 里躺着几百条禁用闹钟。

**为什么必须人工**：`Delete` 会弹确认。这不是缺陷，是设计的一部分——
破坏性动作留人一道闸。

```
C1  Run Shortcut: SyncAlarms
      ★ **这一步的顺序至关重要**：先让 SyncAlarms 把"当前该开的"全开好、
        "不该开的"全关掉。之后"关着的 GateDyn-" 才等价于"已经没人要了"。
        跳过这步直接删，会误删今天还要响的闹钟。
C2  Wait 2 Seconds                                （等 SyncAlarms 的开关落地）
C3  Find Alarms where → Not Is Enabled
                   → and → Label → contains → GateDyn-
C4  Count → Items in（C3）
C5  If →（C4）is not → 0
C6    Show Alert: 将删除（C4）条已停用的动态闹钟      （给自己一次反悔机会）
C7    Delete ←（C3）                                ← 整个列表一次性传入
C8  End If
```

**只有 8 块**。相比 v1 的 delete-alarm（Find → Repeat → If Any are true 四个条件 →
Delete Repeat Item → Otherwise → End If → End Repeat）省掉了整个循环，因为：

| v1 的做法 | 现在 | 原因 |
|---|---|---|
| Repeat + 逐条 `If Label contains` 四个条件 | `Find` 里直接筛 `Label contains GateDyn-` | v0.7 四族并一族 |
| 逐条 `Delete Repeat Item` → **每条弹一次确认** | 整个列表一次 `Delete` → **弹一次** | 批量传入 |
| 无法区分开/关 | `Find` 加 `Not Is Enabled` 筛选 | 筛选器本来就有 |

> ⚠️ **一次性迁移清扫**：你时钟里还留着旧命名的闹钟
> （`Gate-Dynamic-Event-*` / `Gate-ES-*` / `Gate-Class-*` / `[AI]Claude-Reset`）。
> 新的 sweep 只认 `GateDyn-` 前缀，**不会去关它们，也不会删它们**——它们会一直留在那儿。
> 迁移当天手工跑一次你的 v1 `delete-alarm-1`（那四个条件正好覆盖旧名），清干净后再退役它。
> 之后就只用本节这个新版。

**运行时机**：手动跑，月度即可。加到主屏或共享表单，**不要挂自动化**。
平时时钟里堆着一批禁用的 `GateDyn-` 是**无害的**，只是难看。

## §10 `last_applied` 读写（每字段独立文件）

`la_silent.txt` / `la_focus.txt` / `la_volume.txt`。**每字段一个文件**——
指令间不共享变量、不抢文件。

> ⛔ **v4.4 实测修正：文件名必须是 `.txt`，绝不能用 `.json`。**
> 我们存的是**裸 token**（`on` / `none` / `do_not_disturb|off` / `0`），**这不是合法 JSON**
> （合法 JSON 只有 `true`/`false`/`null`/数字/带引号字符串/对象/数组）。
> 文件叫 `.json` → 系统 UTI 判成 `public.json` → `Get Text from File` 会**先按 JSON 解析**
> → 解析失败 → **返回空字符串**。
>
> **症状极具迷惑性**：写入完全正常（文件确实 2 bytes = `on`），读取却永远空，
> LA 恒为 `none` → `Expect ≠ LA` → 每轮都重放。功能"看起来正常"，
> 实则 `on_change` 已退化成 `enforce`，**没有守卫的字段每小时被盖一次手动操作**。
> 旁证：文件在"文件" App 里**缩略图一片空白**（QuickLook 也解析不了）。

> ⚠️ **路径陷阱**：File 动作的灰色预设根目录若已是 Shortcuts，路径**只填文件名**，
> 别再写 `Shortcuts/` 前缀（会套娃成 `Shortcuts/Shortcuts/…` 或权限报错）。

**读**（4 块）：
```
Get File → la_<field>.txt            （关掉 Error If Not Found）
Get Text from Input ←（File）→ 记为 FileText
Text: X（插入 FileText）→ If (该文本) is → X → Text: none → Set Variable: LA
Otherwise → Set Variable: LA ←（FileText）
End If
```

**写**（3 块）：
```
Text ←（Expect 或 ExpectSig 或 none）
Rename → 名称填全名 `la_<field>.txt`
   ⚠️ `Don't Include File Extension` 开关保持**你现在的状态**（实测: 开着时按输入名原样用）。
      判据很简单——存完去"文件"App 看名字对不对，不对就翻这个开关。
Save File → 目标 Shortcuts 根目录
   ✅ Overwrite If File Exists；关 Ask Where To Save
```

存什么：silent 存 `on`/`off`；volume 存数字文本；**focus 存签名 `preset|action`**；
null 一律存哨兵 `none`。

> **迁移**：把已有的 `la_*.json` 在"文件" App 里改名成 `.txt`（或直接删掉，
> 首次运行会重建）。改完跑一次读取，LA 应能读出真实值而不是 `none`。

## §11 `SyncAll` 与触发器（★ v5.3 结构收敛：编排只有一份）

### 11.0 为什么要有 `SyncAll`

v5.1 之前，"依次跑哪几个模块"这件事被抄了 **8 份**：3 个每小时轮询 + 6 个刺客
（还各自差一个 `now` 值）+ ForceResync。以后加一个 SyncTodos 要改 8 个地方。

根因：编排原本**必须**分散，因为每个 ApplyX 自己拉网络。现在拉取集中到 GetState 了，
**编排也该跟着集中**。于是所有触发器都退化成"给 SyncAll 传个字典"：

```
每小时轮询   Run SyncAll                                    （无输入）
刺客 ×6      Dictionary {mode:point, now:07:44} → Run SyncAll
强制推平     Dictionary {apply:enforce}         → Run SyncAll
```

**加 SyncTodos 那天，只改 SyncAll 一处。**

### 11.1 `SyncAll`（唯一的编排点）

```
Y1a Text: X（插入 Shortcut Input）→ If →(该文本) is → X
Y1b   Dictionary: { }（空字典）→ Set Variable: Params
Y1c Otherwise
Y1d   Set Variable: Params ←（Shortcut Input）
Y1e End If
Y2  Run Shortcut: GetState ←（Params）→ Set Variable: Env    ← ★ 全程唯一一次网络
Y3  Run Shortcut: ApplySilent ←（Env）
Y4  Run Shortcut: ApplyVolume ←（Env）
Y5  Run Shortcut: ApplyFocus  ←（Env）
Y6  Run Shortcut: SyncAlarms  ←（Env）
      （灰度期建议再加一块 Append to Note 探针，写时间戳 + Env 的前 80 字，切默认前删）
```

**9 块。** 各模块拿到的是同一份信封，它们内部会再过一次 GetState 但走 N5 直通，零网络。

> ⚠️ **失败不隔离**：`Run Shortcut` 的子指令报错会中断父指令，所以 Y3 出错时 Y4-Y6 不跑。
> 这是合并的代价，但**旧的刺客本来就是这样**（T3/T4/T5 也是顺序调用），
> 只有轮询是隔离的——为了轮询独有的隔离性而保留 8 份编排不划算。
> 幂等对账使下一次触发自动补齐，最坏损失一个周期。
> 若某天真需要隔离，把 Y3-Y6 拆成互不依赖的分支即可，**改动仍然只在这一处**。

### 11.2 触发器（全部退化成两块）

**A. 每小时轮询（地基）**：一条 `Time of Day` 自动化，每小时 → `Run SyncAll`，**不传输入**。
**必须关掉 "Ask Before Running"**，否则后台完全不触发。
（v5.3 前是三条自动化各拉一次网络，现在一条、一次。）

**B. 边界刺客 ×6**：`DND.WHITELIST` 每个时刻各一条自动化，每条**只有两块**：

```
Dictionary: { mode: point, now: 07:44 }     ← 只有这个值每条不同
Run Shortcut: SyncAll
```

时刻表：07:44 / 09:30 / 12:15 / 13:29 / 20:55 / 22:25（与服务端 `DND.WHITELIST` 一致；
不一致时服务端 audit 会在 trace 里 warn）。

⚠️ **`now` 必须填这条刺客自己的计划时刻**。不传也能跑，但容差 ±3 分钟会围绕
**真实触发时刻**而不是计划时刻——iOS 后台晚触发超过 3 分钟就完全落空，且**静默落空**。
实测（2026-07 当时边界还是 07:40）：**07:37–07:43 触发命中，07:44 起全部落空** ——
容差窗是 [边界−3, 边界+3]，晚 4 分钟就没了。

**C. 强制推平 `ForceResync`**（手动，放主屏）：

```
Dictionary: { apply: enforce }
Run Shortcut: SyncAll
```

服务端把所有字段的 `apply` 置为 `enforce` → 你现成的
「If ApplyMode is enforce → ShouldRun=1」直接生效，**手机端零代码**。
用途：改完 bug 想把手机推到与云端一致，一次网络、一个原子动作，不碰任何本地文件。

⚠️ 两点：**守卫仍然拦得住**（铁则3，enforce 压不过守卫——开着导航时也不会归零音量，
这是对的）；**focus 会真的重放一次 `Set Focus`**，绑在那个专注上的其他 iOS 自动化会被触发。

**D. 起床钩子**：`When Any Alarm Is Stopped` → 取 **Shortcut Input** 的 Label，
判前缀分流。（**别用 Goes Off**——那是响起未醒；**别在选择器里绑死具体闹钟**。）

> ⚠️ **前缀只判 `GateFix-` 会漏掉出差日**（2026-07-31 发现）：晨间碰撞时服务端**不注入**
> 固定早间组，响的是 `GateDyn-Event-0810` —— 前缀不匹配，钩子**不触发**。
> 要覆盖出差日就把前缀判断扩成 `GateFix-` ∪ `GateDyn-Event-`。
>
> 但注意：**晨间解除已经不依赖这个钩子了** —— 它由门铃投递（[01-CONCEPTS](01-CONCEPTS.md) §5.2）。
> 钩子只服务于「你自己的晨间流程」，两者互不依赖。

> 触发后做什么属于你的个人晨间流程，本手册不规定。若想顺带同步一次，`Run SyncAll` 即可。

## §12 灰度顺序

```
① 建 GetState(§2) + CheckGuards(§3) → 先单独跑 GetState，确认能拿到信封
② 建 ApplySilent(§5) → 手动跑通，对照 /v2/timeline 核对
③ ApplyVolume(§6) + ApplyFocus(§7) → 各自手动跑通
④ 建 SyncAll(§11.1) → 手动跑一次，四个模块应依次生效
⑤ 挂每小时轮询(§11.2A)，与旧刺客并行观察一周
⑥ SyncAlarms(§8) 切数据源；建 6 个新刺客(§11.2B，每个两块)，旧刺客退役
⑦ ForceResync(§11.2C) + CleanAlarms(§9) 放主屏，各跑一次确认
⑧ 删掉 SyncAll 里的探针块，收口
```

**后台验证不能省**：前台正常 ≠ 后台正常。用 `Append to Note` 写固定备忘录做探针
（时间戳 + 变量，变量用 `[ ]` 包住以便看出空值），真实等一个刺客时刻自动触发后核对。
⚠️ 备忘录里直接放非文本变量会存成 `Attachment.txt`——**先过一道 `Text` 再 append**。

---

## §13 常见坑速查

| 症状 | 原因 | 位置 |
|---|---|---|
| 指令"什么都没发生"，无报错 | 字典被强转文本，缺席检查误判 | 铁则8 · §5 S1g |
| **刺客变成了 5 次网络，且 now 失效** | GetState 没洗输入 → 直通失效 → 各模块重拉 | 铁则8 · §2 N0 |
| **守卫忽然全部放行** | 对 `guards` 数组做了 `Get Dictionary from Input` → 静默清空 → Count=0 | ⛔ 铁则8：绝不洗数组 |
| 自动化跑报错，手动跑正常 | 无输入时直接对 Shortcut Input 取值 | §5 S1a 标记法判空 |
| If 条件里选不到 `is` | 输入没过 Text | 铁则1① |
| 判空失灵 / 音量 0 被当 null | `has any value` 的 0 即空怪癖 | 铁则1② 标记法 |
| 长假夜里不再自动静音 | null 时留空没写 `none` | 铁则2 |
| 手动开的睡眠被误关 | 守卫拦截后仍落账，或没跑守卫 | 铁则3 + §3 |
| 跑一次正常下次全重放 | ① 忘了落盘 last_applied ② **LA 文件用了 `.json` 扩展名，读取恒空** | §10 |
| LA 恒为 `none`，文件却有内容 | `.json` 扩展名触发 JSON 解析，裸 token 非法 JSON → 读回空 | §10 用 `.txt` |
| 变量突然变空 | 字典被文本覆盖（同名变量降级） | 铁则4 |
| 该清场的专注没清 | contains 子串误配（工作 ⊂ 工作模式） | 铁则5 + §7 F26a/F29 |
| 专注开了但每次都判失败、反复重试 | 开启后没等就验证（异步总线） | §7 F35a Wait |
| 换语言 Set Focus 开失败 | 喂了 token 不是本机名 | §7 F21-F23 |
| Set Focus 喂了 "A, B" 失效 | 候选名数组被 Text 强转 | §7 F23 不加 Text |
| 关专注只关得掉勿扰 | 没用变量喂 Set Focus | §7 F44 |
| 跨 preset 切换失效（勿扰→睡眠） | la_focus 只存了 action | §7 F14 存签名 |
| 切同目标专注引发别的自动化触发两次 | 无脑 Off 再 On | §7 F29a |
| focus 守卫永远失效 | 读了 `.value.guards`（多一层） | §7 F5 字段级 |
| 时钟 App 里几百条禁用闹钟 | 动态闹钟只关不删，没做月度清扫 | §9 CleanAlarms |
| 改了时间但闹钟还按旧时间响 | 想"就地改时间"——**做不到** | 铁则6：关旧建新 |
| 旧命名闹钟永远清不掉 | 新 sweep 只认 GateDyn-，不认旧四族 | §9 一次性迁移清扫 |
| 清扫时每条都弹确认 | 逐条 Delete Repeat Item | §9 C7：整列表一次传入 |
| 半夜刺客卡住不动 | 无人值守流程里放了 `Delete` | §8：只关不删 |
| 某天早上动态闹钟全没了 | sweep 授权位没判，或写成了 `is not false` | §8 A21a 判 `is true` |
| 手动带 `{mode,now}` 跑，静默无反应 | 把输入直接当信封用了，没过 GetState | §5 S1f 无脑路由 |
| 专注切换变慢、候选名试好几个 | URL 里混进**不可见字符**（零宽连接符等）→ 参数名被污染 → `locales` 收不到 → 降级成**全语言兜底表** → Set Focus 要多试几个名字 | trace 里有 `locales_fallback` 告警；**URL 删掉重新手打，别粘贴**。<br>⚠️ 2026-07-31 前此症状是「专注**永远开不起来**」（整表不下发），已改为降级不瘫痪 |
| 刺客偶发不生效 | 没传 `now=` 自己的计划时刻 | §11B |
| 自动化夜里不跑 | Ask Before Running 没关 | §11A |
| last_applied 存进套娃文件夹 | 路径写了 `Shortcuts/` 前缀 | §10 |
| 文件缩略图一片空白 | 内容不是合法 JSON 而扩展名是 `.json` | §10 用 `.txt` |
| 服务端真值判等永假（如 sweep） | 布尔过 Text 变「是/Yes」 | 铁则7 + §8 A21a |
| `locked` 守卫 100% 拦截 | 同上：iOS 布尔没做隔离带 | 铁则7 + §3 G17 |
| 服务端加了新守卫源后字段停摆 | **设计如此**（fail-closed） | §3 G19，加个分支即可 |

---

## §14 验收清单

- [ ] `GetState` 单独跑，输出能被 `Get Dictionary from Input` 解析出 `fields`
- [ ] `ApplySilent` **无输入**手动跑（验 S1a 空字典分支不报错）
- [ ] `ApplySilent` 带 `{mode:point, now:20:55}` 手动跑（验 S1f 路由——**这里曾有 bug**，
      直接把参数当信封会静默无反应）
- [ ] `SyncAll` 无输入手动跑 → 四个模块依次生效
- [ ] ★ **直通验证（最容易静默失败的一处）**：刺客带 `{mode:point, now:20:55}` 跑 `SyncAll`，
      各 ApplyX 的 `from` 应指向 20:55 那个边界。若指向别处或行为像 segment，
      说明 GetState 的 N0 没洗到位、直通失效、各模块偷偷重拉了网络（铁则8）
- [ ] **LA 回读**：连跑两次 ApplySilent → 第二次 `LA` 应显示真实值（`on`/`off`）而**不是 `none`**
      （若恒为 `none`，检查文件扩展名是不是还留着 `.json`，见 §10）
- [ ] `ApplySilent` 带 `{mode:point, now:20:55}` 跑 → 应静音；`now:07:44` → 应解除
- [ ] 守卫生效：开着高德地图跑 `ApplyVolume` → 音量**不**被归零
- [ ] 守卫不落账：接上一步，关掉地图再跑 → 这次归零（说明上次没误落账）
- [ ] 跨 preset：手动开睡眠 → 跑 `ApplyFocus` 期望勿扰 → 应切过去（签名 + Wait 生效）
- [ ] 关闭分支：随便开个专注 → 跑期望 off → 应关掉
- [ ] 缺席语义：`{mode:point, now:10:00}`（无边界）跑 ApplySilent → 什么都不做，
      且 `la_silent.txt` **内容不变**
- [ ] 后台验证：真实等一个刺客时刻自动触发，Note 探针有记录
- [ ] `SyncAlarms`：造一个假的 `GateDyn-ES-test-uid-0900` → 跑一次 → 应被**关掉**（不是删掉）
- [ ] `CleanAlarms`：接上一步再跑 → 那条假闹钟应被删除，且**只弹一次确认**
- [ ] 迁移清扫：跑一次 v1 的 `delete-alarm-1` 清掉旧命名闹钟，之后退役它
- [ ] 连观察 3~5 天，叫醒闹钟不漏

---

# 埋点（本地日志）

> 触发它的实案: `"DND 定时 20:55" took too long to run` —— 但手机状态全改对了，无从判断
> 是网络慢还是某步慢。成本实测见 [05-FACTS](05-FACTS.md) §0.2（12 点 = 0.44 秒 = 1.5%）。

## 1. 最关键的一条设计: **记「意图」而不是「结果」**

这是整份设计的核心，也是最容易做错的地方。

| 写法 | 正常运行 | **超时被杀那次** |
|---|---|---|
| 结束时统一写 | ✅ 完整 | ❌ **什么都没有** —— 而这正是你要查的那次 |
| 每步做完写结果 | ✅ 完整 | ⚠️ 缺最后一步，只知道"上一步成功了" |
| **每步动手前写意图** | ✅ 完整 | ⭐ **最后一行就是凶手** |

所以配置默认 `MODE: "intent"`:

```
09:20:31.412  a3f2k1  →GET 网关
09:20:33.180  a3f2k1  →ApplySilent
09:20:33.402  a3f2k1  →ApplyVolume
09:20:33.655  a3f2k1  →ApplyFocus            ← 日志到此为止
                                              ⇒ 死在 ApplyFocus 里
```

「箭头」表示**即将执行**。最后一行没有配对的完成记录 = 它就是被杀的地方。

> 代价: 写入次数翻倍（每步一次而不是每轮一次）。这就是为什么必须有总入口 —— 稳定后关掉。

---

## 2. 总入口（已就位）

信封里多一节，手机端**先读它再决定记不记**:

```json
"telemetry": {
  "ENABLED": true,
  "MODE": "intent",
  "SLOW_MS": 15000,
  "KEEP_DAYS": 7,
  "run_id": "h2e14zfuz8",
  "server_at": "2026-07-31 08:29"
}
```

| 字段 | 手机端怎么用 |
|---|---|
| `ENABLED` | `false` → 整段跳过，一个字节都不写。**稳定后改这里，不用碰手机** |
| `MODE` | `intent` / `result`，见 §1 |
| `SLOW_MS` | 本轮总耗时超它 → 该轮标 `SLOW`，事后好筛 |
| `KEEP_DAYS` | 本地保留天数，手机端自己清 |
| `run_id` | ⭐ **服务端生成**，本轮所有日志行的分组键 |
| `server_at` | 服务端时刻，和手机时刻一起记 → 能算出钟差 |

### 2.1 ⚠️ 必须有本地默认值

`ENABLED` 来自信封，而信封来自 GET。**GET 失败的那次拿不到配置 —— 而那正是最该记录的一次。**

所以手机端的读法必须是:

```
T1  从信封取 telemetry.ENABLED
T2  If (T1) is empty → 用本地默认（建议 true）
```

不能写成"取不到就不记"，否则网络故障永远查不出来。

### 2.2 `run_id` 为什么由服务端生成

手机端自己 UUID 也能分组，但服务端生成的能**和服务端日志对上同一个 id**。
将来 P-观测回传时带上 `run_id`，一条链路两端的记录就能拼起来 —— 这是免费的，
现在不做也别把口堵死。

---

## 3. 埋点位置

按「一次运行」的骨架排:

| # | 埋点 | 记什么 | 为什么 |
|---|---|---|---|
| 1 | SyncAll 入口 | `→SyncAll` + 触发因（刺客时刻 / 门铃 / 手动） | 定位是哪种入口慢 |
| 2 | 组 URL 后、发请求前 | `→GET` | **网络是最大变量**，这条和下一条的差值就是往返耗时 |
| 3 | 信封到手 | `←GET` + 字段数 + `server_at` | 有 `server_at` 就能算钟差 |
| 4 | 每个 Apply 之前 | `→ApplyXxx` | §1 的凶手定位靠这条 |
| 5 | 每个 Apply 内部：守卫判定后 | `guard=pass/skip` | 区分"没动手"和"动手失败" |
| 6 | 每个 Apply 内部：动作执行后 | `done` | `Set Focus` 的 Wait 累加在这里现形 |
| 7 | SyncAll 出口 | `←SyncAll` + 总毫秒 + 是否 `SLOW` | 汇总行，正常运行只看这一行就够 |

`Set Focus` 那圈候选名循环建议**每次尝试都记一行**（`try=睡眠`）——
缺 `locales` 降级成全语言时会多试几次，这里能直接量出代价（见 `ACTIONS-APP.md §3.2`）。

---

## 4. 时间戳精度

原生 `Current Date` 只到**秒**，而单轮预算就 40–80 秒，秒级精度量不出"哪一步慢"。

**用 Actions 的 `Get High-Resolution Timestamp`。**

> 这条推翻了 `ACTIONS-APP.md §4` 把它列为"别用"的判断。当时的理由是"只对延迟实验有意义，
> 而延迟实验没在做"——现在有了超时实案，条件变了。**判断随证据改，不是打脸。**

记录用**相对毫秒**（相对本轮第一条），不是绝对时间:

- 一眼看出步间差值，不用心算
- 行更短，写入更快
- 绝对时间只在第一行记一次

---

## 5. 写到哪 / 怎么防垃圾

### 5.1 按天分片

文件名 `telemetry-YYYY-MM-DD.txt`。**用文件不用 Note**，理由见 §6.3。好处:

- 天然分片，单个文件不会无限长
- 清理只是删旧文件，不用读改写
- 出问题时你知道去翻哪一天

### 5.2 清理

每天第一次运行时，删掉 `KEEP_DAYS` 之前的文件。挂在**当天第一条日志之后**，
不要挂在入口 —— 清理本身要花时间，别占用最紧张的开头。

### 5.3 关掉之后

`ENABLED: false` 之后不再写入，已有文件不动。你想彻底清就手动删一次。
**不要做"关掉时自动清空"** —— 关掉往往是因为稳定了，而那时的历史数据恰恰有参考价值。

---


## 7. 落地顺序

1. ~~先测写入耗时~~ ✅ **已完成**（§6）—— 结论: 直写，不缓冲
2. ~~补测后台写入耗时~~ ✅ **已完成**（§6.4）—— 后台与前台一致，方案定稿
3. `Get High-Resolution Timestamp` 装好可用（Actions，已装 ✅）
4. SyncAll 的入口/GET/出口四个点（#1 #2 #3 #7）—— **只这四条就能回答"是不是网络慢"**
5. 各 Apply 的 `→` 意图行（#4）—— 回答"死在哪一步"
6. Apply 内部的守卫/动作行（#5 #6）—— 回答"为什么那步慢"
7. 按天分片 + 清理（§5）

**第 4 步做完就能解 §0 那个实案了** —— 四条埋点 ≈ 0.15 秒，就能回答"是不是网络慢"。
下次再撞上 timeout，日志会直接给答案: 最后一行停在 `→GET` 就是网络，停在 `→ApplyXxx`
就是那个指令。**各 Apply 的意图行先别加，先看这四条够不够。**

---

