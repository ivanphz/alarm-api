# GUARDS-AND-PARITY.md — 守卫泛化设计 + v1→v2 能力对等审计

> 起因(2026-07-17): 用户在拼装中发现 ① 守卫可扩展到锁屏/当前App等更多条件；
> ② v1→v2 存在功能丢失(Set Focus 变量机制、守卫完整能力)。本文定守卫泛化方向 +
> 系统清点 v1 能力确保 v2 无遗漏 + 记录多语言待测项。

---

## 1. 守卫泛化（guards 列表，预留任意条件，手机端加分支不回插）

### 1.1 现状与问题
v1/v2 的守卫只有一种: focus 值里的 `only_if_current`(检查当前专注)。
但守卫本质 = **执行前检查某手机实况是否满足条件**，current_focus 只是一种实况。
用户需求: "某 App 开着才归零音量 / 开着就不归零"、"锁屏时不执行"等 → 需要更多实况源。

### 1.2 设计：字段值携带 guards 数组（服务端下发，手机通用循环）
任意字段(focus/silent/media_volume/…)的值可带 `guards`:
```json
"media_volume": {
  "value": 0,
  "guards": [
    { "source": "app",    "op": "is_not", "value": "com.game.xxx" },
    { "source": "locked",  "op": "is",     "value": "false" }
  ]
}
```
- **全满足才执行**；任一不满足 → 该字段本次 skip（不动手、不落账，同 only_if_current 语义）。
- `only_if_current` 保留为**语法糖**（等价 `{source:"current_focus", op:"is", value:<token>}`），
  老配置不破；新需求用 guards 数组。
- **✅ 服务端翻译已实现**(edge/assemble.js normalizeGuards): 采样出的 focus 值里
  only_if_current 自动并入 guards、并从输出移除 —— **手机端下发的永远只有 guards**，
  手机 CheckGuards 只有一套逻辑，不知 only_if_current 存在。空 guards 也下发(CheckGuards 见空即 PASS)。

### 1.3 source 词表（开放枚举，手机 CheckGuards 逐个实现取值）
| source | 手机取值动作 | 值形态 | 用途 |
|---|---|---|---|
| `current_focus` | Get Current Focus → 反查 token | token | 保护手动专注（现有） |
| `app` | Get Current App → bundle id | bundle id | 某 App 前台时执行/不执行 |
| `locked` | Get Device Details: Device Is Locked | "true"/"false" | 锁屏/解锁态 |
| `charging`(未来) | Get Device Details: Is Charging | "true"/"false" | 充电时 |
| `wifi`(未来) | Get Network Details: SSID | 文本 | 特定网络 |
| `battery`(未来) | Get Device Details: Battery Level | 数字 | 低电量 |

**op 词表**: `is` | `is_not` | (未来) `gt` | `lt` | `contains`。

### 1.4 手机端 CheckGuards（通用循环，一次写好，加 source 只加分支）
```
输入: 某字段的 guards 数组 → 输出: PASS / SKIP
Repeat with each guard in guards:
  取 guard.source / guard.op / guard.value（均文本化，铁则1）
  按 source 取实况 Cur:
    if source is current_focus → Get Current Focus → 反查 token（用 i18n 表）
    if source is app          → Get Current App → bundle id
    if source is locked       → Get Device Details[Device Is Locked] → "true"/"false"
    （加新 source = 加一个 if 分支，全字段共享此循环）
  按 op 比对 Cur 与 guard.value:
    if op is is     → Cur is value ?     不满足 → Set GuardResult=SKIP, 跳出
    if op is is_not → Cur is not value ? 不满足 → Set GuardResult=SKIP, 跳出
End Repeat
（默认 PASS；任一不满足置 SKIP）
```
- **每个字段块执行前先跑 CheckGuards(该字段的 guards)**，SKIP 就跳过该字段。
- 这是**独立子指令**，被 ApplySilent/ApplyVolume/ApplyFocus 共用 → 加守卫种类**只改这一处**，
  三个字段全受益，**绝不回插各字段主逻辑**。

### 1.5 预留纪律（现在定，实施 todo 时遵）
- 服务端: 字段值组装时可附 guards（edge/assemble.js）; source/op 是开放 token（KERNEL §18 登记）。
- 手机端: CheckGuards 一个子指令; 加 source = 加取值分支; 字段主逻辑永不因新守卫而改。
- **不堵死**: 今天 only_if_current 单守卫，明天 guards 多守卫，语义向后兼容（糖 = 单元素数组）。

---

## 2. v1 → v2 能力对等审计（防功能丢失，逐条核对）

| v1 能力(PHONE.md) | v2 状态 | 备注 |
|---|---|---|
| ApplyFocus 开/关/切专注 | ✅ 已修(PHONE-V2 §3.2) | 曾误退化, 已恢复 v1 变量机制 |
| **Set Focus 吃变量**(Turn $Var On) | ✅ 已修 | 曾误述"不吃变量", 翻案 |
| **Turn 前 priming**(先 Get Current Focus 再 Turn) | ✅ 保留(F49 先读 NowName) | v1 关键点, 勿删 |
| 开启前先关当前别的专注 + Wait | ✅ 保留(F51-F54) | 切换语义 |
| 关闭: 当前是Mode关Mode/否则关当前 | ✅ 保留(F57-F61) | 清场 vs 挑关 |
| **only_if_current 双语义**(有=守卫/无=清场) | ✅ 保留 + 泛化(§1) | 升级为 guards 但语义不变 |
| ApplySilent 开/关 | ✅ | — |
| ApplyVolume ÷ 分母设音量 | ✅(÷100) | v1 是 0~1, v2 整数0-100÷100 |
| 三 Run 显式传状态(不靠上步输出) | ✅ 拆分形态各自 GET | v2 拆分指令各自取数 |
| sync_alarms_flag 触发对账 | ✅ reconcile_alarms | 改名, 语义同 |
| **调试探针**(Append to Note 台账) | ✅ 保留为观测 + 升级(延迟实验§7.5) | v1 上线删, v2 保留做观测 |
| last_applied 防覆盖 | ⭐**v2 新增**(v1 无) | v2 增强: on_change 防覆盖 |
| 守卫种类(仅 current_focus) | ⭐**v2 泛化**(§1 guards) | v2 增强: 任意实况守卫 |

**审计结论**: v1 全部能力 v2 已覆盖(曾丢两处已修); v2 另有两项增强(last_applied、guards)。
**方法教训**: 做 vN+1 时必须逐条核对 vN 能力文档，不能只搬"当前配置用到的那部分"。
此审计表纳入 HANDOFF: 任何大版本迁移前先做能力对等清点。

---

## 3. 多语言 Set Focus —— ✅ 已定案（依据 DEVLOG 2.1 实测，无需再测）

**结论**: **必须用本机语言的专注显示名才能开关 focus**。依据链:
- DEVLOG 2.1 实测: iOS `Turn Focus On/Off` 用 `$ModeText`(专注名文本变量)执行，
  且必须先 Get Current Focus 做 priming 否则静默 no-op。
- Get Current Focus 返回的名字**随系统语言变**(中文"勿扰模式"/英文"Do Not Disturb")。
- ∴ 喂给 Turn On/Off 的名字必须是本机语言名 → **翻译表(token→本机名)是必需的，
  locales 参数必须保留**。这也是当初就设计翻译表、要求传语言参数的原因。

**定死方案**(PHONE-V2 §3.2 现行即此):
- 请求带 `&locales=<系统语言>`（如中文系统 `zh,en`，日文 `ja,zh,en`，首位=系统语言）。
- 云端信封 `i18n.focus_token_to_name`: token→本机名; 执行段查表得本机名喂 Set Focus。
- 换语言 = 云端 FOCUS_NAMES 已含 en/zh/ja/ko + 请求 locales 改首位，**手机零改**。
- 附带铁律(DEVLOG 2.1): Turn 前无条件先 Get Current Focus(priming); 切换必须
  先 Turn 当前 Off + Wait 1s 再 Turn 目标 On(iOS 同时只允许一个 focus)。

### 3.1 多语言双层策略（主路径 + 兜底，防 iOS 更新改译名）

**问题**: token→本机名表若因 iOS 系统更新改了默认专注译名 → Set Focus 喂旧名失效。
**两层防线**(用户提出，采纳):

**层1·系统语言传参(主路径)**: 手机端取设备语言代码作 `&locales=` 传云端，云端返对应
语言表。不猜——系统什么语言就要什么表。
- 手机取语言: Get Device Details 或 Get Current App 的语言(App 语言随系统变)；
  或快捷指令 Device 信息里的 Language。取到语言码(zh/en/ja…)拼进 URL。
- 云端已按 locales 下发对应表(edge/i18n.js)。

**层2·失败换名重试(兜底)**: 云端 `focus_token_to_name` 对每个 token 可下发**候选名数组**
(按用户自定义优先级排序，如 `["Do Not Disturb","勿扰模式",…]`)；手机 Turn 失败就取下一个
候选名重试。大部分 2 遍成，极端 3+ 遍。**这层不依赖译名永远准，靠穷举兜底**——即使 iOS
改名、即使传参层没覆盖，也能撞对。
- **✅ 已实装**: 云端 focus_token_to_name[token] 下发**候选名数组**(edge/i18n.js，按 locales
  优先级); 手机端 §4 F28-F35 Repeat 候选名 → Turn → Get Current Focus 验证 → 成功 Stop 短路。
- 代价: 极端情况多几次本地操作(无网络)，可接受。

**层维护(答"iOS 更新改译名怎么办")**: 表在云端(edge/i18n.js)，iOS 改名 → 云端加/改一行，
手机零改; 叠加层2 穷举，改名生效前的空窗也能兜住。**三重保险: 传参准 + 云端可热改 + 穷举兜底。**

（本节原为"待实测"，实为 DEVLOG 2.1 早有定论；多语言健壮性由上述双层保证。）

## 4. 实施位置（并入 HANDOFF/HORIZON）
- guards 泛化: **服务端翻译层已实现**(assemble.js only_if_current→guards, 73 用例)；
  手机端 CheckGuards 子指令 + 各字段调用见 PHONE-V2 v3.0 §1-§4(已写逐动作)。
  **剩余**: 手机端按 PHONE-V2 v3.0 重拼(独立指令架构); 加 app/locked 等新 source 时
  在 CheckGuards 加取值分支即可。
- 能力对等审计: 已完成, 表入本文 + HANDOFF 引用。
- 多语言: 阻塞在实测, 用户测后定。
