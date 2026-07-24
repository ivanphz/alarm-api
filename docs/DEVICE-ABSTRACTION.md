# DEVICE-ABSTRACTION.md — 设备抽象层设计（方案定稿，待实施）

> **状态**: 设计定稿，**尚未实施**。实施前请通读本文 + KERNEL.md + HANDOFF.md。
> **起因**: ① 我(AI)为兼容硬加了字段级 `GUARDS`，与值内 guards 形成两个来源，不统一；
> ② guards 的 app 值直接写了 iOS 包名(`com.apple.Maps`)，把平台细节漏进契约，安卓移植必返工。
> **本次重构 = 为上述失误买单**，一次到位，不留二茬。
> **纪律**: 本文是设计，实施者按此写代码；对本文有异议先问 Ivan，不得自行变更结构。

---

## 0. 一句话总纲

**契约只说语义 token；一切平台/语言/设备差异由【数据】消化（云端解析表 + 设备能力声明）；
执行器是一个通用解释器 —— 加 App、加语言、加平台，全是云端数据变动，手机端零改。**

---

## 1. 平台差异分三类，分别去三层（不要试图用一层解决全部）

| 类型 | 例子 | 归属层 | 加新平台的成本 |
|---|---|---|---|
| **① 标识符差异**（同一概念，不同平台叫法不同） | 地图 App: iOS `com.apple.Maps` / 安卓 `com.google.android.apps.maps`；勿扰: 中文"勿扰模式"/英文 Do Not Disturb | **语义 token + 云端解析表**（§2） | 云端加一张表 |
| **② 能力差异**（概念在此平台不存在或工作方式不同） | 安卓无 iOS Focus 模型；安卓有媒体/铃声/闹钟/通知四路音量，iOS 只有媒体音量 | **设备能力声明**（§4，本次只留形状） | 设备档案加一节 |
| **③ 执行机制差异** | iOS 快捷指令 / 安卓 Tasker、Automate | **执行器自己的事，契约不知道** | 写一个新执行器 |

**判据**: 问"这个差异能不能用一张对照表翻译掉？" 能 → ①；不能但能声明有无 → ②；
连声明都不必、纯粹是"怎么动手" → ③。

---

## 2. 核心机制：语义 token + `resolve` 解析表

### 2.1 契约里只有 token，零平台字符串

```json
// guards 里写语义 token，永远不写包名/本地名
{ "source": "app",           "op": "not_in", "value": ["maps", "video", "music"] }
{ "source": "current_focus", "op": "in",     "value": ["do_not_disturb"] }
```

### 2.2 信封新增 `resolve` 节（统一一切"token → 本设备实际标识"）

```json
"resolve": {
  "focus_preset": {
    "do_not_disturb": ["勿扰模式", "Do Not Disturb"],
    "sleep":          ["睡眠", "Sleep"]
  },
  "app": {
    "maps":  ["com.apple.Maps", "com.google.Maps", "com.autonavi.amap", "com.baidu.BaiduMap"],
    "video": ["com.bilibili.*", "com.netflix.Netflix", …],
    "music": ["com.apple.Music", "com.spotify.client", …],
    "amap":  ["com.autonavi.amap"]
  }
}
```

**统一规则（无特例）**:
1. **token → 数组，恒定**。单个 App 就是长度 1 的数组；类别 token 是多元素数组。
   → 手机端只有一种展开逻辑，没有"单值 or 数组"的分支。
2. **每张表只列该平台真实存在的**。苹果地图在安卓表里**根本不出现**——不是缺失、不需占位。
   "两个平台都有高德" 靠 token 相同(`amap`)锚定，包名各表各写(iOS `com.autonavi.amap` /
   安卓 `com.autonavi.minimap`)。**token 是语义锚点，本地标识是平台细节。**
3. **查不到 token → 展开为空数组，语义自动正确**:
   - `not_in` 空集 → "没有要躲的东西" → 通过 ✓
   - `in` 空集 → "当前不可能属于空集" → 拦截 ✓
   无需任何特判（如安卓设备的 guards 里出现 `apple_maps`）。
4. **按请求下发**: `?platform=ios&locales=zh,en` 决定发哪张表。
   `focus_preset` 受 locales 影响（显示名随语言）；`app` 只受 platform 影响（包名不本地化）。

### 2.3 ⭐ 重大简化：i18n 表并入 resolve，且**只需要一个方向**

**现状(将废弃)**: 信封有 `i18n.focus_name_to_token`(反查，守卫用) + `i18n.focus_token_to_name`
(正查，执行用) 两张表 + 两套逻辑。

**新方案**: 只保留 `resolve.focus_preset`(token → 本地名数组) **一个方向**，
守卫比对改为**成员判断**:
> 守卫 `{source:"current_focus", op:"in", value:["do_not_disturb"]}`
> → 展开 token 得 `["勿扰模式","Do Not Disturb"]`
> → 判断 `Get Current Focus` 的结果 **∈ 该数组**

于是 **focus 守卫与 app 守卫的比对机制完全相同**，手机端一套代码通吃。反查表 `focus_name_to_token`
**整个删除**。执行段(Turn On)仍用 `resolve.focus_preset[token]` 的候选名数组逐个试开（穷举兜底不变）。

### 2.4 ⭐ 重大简化：op 收敛为 `in` / `not_in` 两个

`is`/`is_not` 是"单元素集合"的语法糖 —— **服务端翻译成 `in`/`not_in` + 单元素数组下发**，
手机端**只需实现两个分支**:

```
展开 Expected = resolve[source] 有表则按 token 展开并合并；无表(如 locked)则字面量
member = (Cur ∈ Expected)          ← 精确相等，绝不子串匹配
op = in     且 !member → SKIP
op = not_in 且  member → SKIP
```

未来 `gt`/`lt`(数值区间，如电量)另加分支，不影响上述两个。

**为何不用 `contains`**: bundle id 前缀高度重合(`com.app.a` ⊂ `com.app.about`)，子串匹配会误命中；
且 contains 语义应是"字段含子串"而非"属于集合"。集合语义必须 in/not_in + 精确相等。

---

## 3. guards 统一：两个**声明作用域**，一个**下发列表**

### 3.1 为什么必须有两个作用域（Ivan 的判据）
- **恒常型**: "调音量永远躲导航/视频/音乐软件" —— 这是 media_volume 这个字段的固有不变量，
  与时刻无关。
- **时点型**: "07:40 关勿扰，但仅当此刻确实是勿扰" —— 只在那个边界成立；
  focus "有时要躲首位、有时不用"。
- 二者**可叠加**: "07:40 关音量，但如果开着导航就别关" = 时点守卫 AND 字段恒常守卫。

### 3.2 声明（config，两处分开写，语义清晰）

```js
FIELDS: {
  media_volume: {
    KIND: "scalar", USE: "quiet", MAP: { on: 0, off: null }, APPLY: "on_change",
    // 【恒常作用域】整个字段永远适用
    GUARDS_ALWAYS: [
      { source: "app", op: "not_in", value: ["maps", "video", "music"] },
    ],
    OWN: {
      // 【时点作用域】仅此边界适用
      "07:40": { value: 0, guards: [{ source: "locked", op: "in", value: ["false"] }] },
    },
  },
  focus: {
    KIND: "focus", USE: "quiet", PRESET: "do_not_disturb", APPLY: "on_change",
    GUARDS_ALWAYS: [],                       // focus 无恒常守卫（"有时躲有时不躲"）
    OWN: {
      "07:40": { action: "off", guards: [{ source: "current_focus", op: "in", value: ["do_not_disturb"] }] },
    },
  },
}
```

**命名决定**: 恒常型用 `GUARDS_ALWAYS`（大写，与 USE/MAP/SKIP/OWN/APPLY 的 config 惯例一致，
且 `_ALWAYS` 明示作用域）；时点型用 OWN 值内的小写 `guards`。
**废弃**: 我此前加的裸 `GUARDS`（语义暧昧），实施时一并改名。

### 3.3 下发（合并成一个数组，手机只见一套）

```json
"fields": {
  "media_volume": {
    "kind": "scalar", "apply": "on_change", "value": 0, "from": "2026-07-15 07:40",
    "guards": [
      { "source": "locked", "op": "in",     "value": ["false"] },              // 时点
      { "source": "app",    "op": "not_in", "value": ["maps","video","music"] } // 恒常
    ]
  }
}
```
- **合并规则**: 时点守卫在前、恒常守卫在后（顺序仅影响短路时机，不影响语义——全是 AND）。
- **AND 语义**: 全满足才执行；任一不满足 → 该字段本次 SKIP、且**不落账 last_applied**（铁则3）。
- **手机端永远只读 `fields.<x>.guards`**，不知道某条来自哪个作用域。
- `only_if_current` 语法糖: 服务端翻译成时点守卫 `{source:"current_focus", op:"in", value:[token]}`，
  且从 value 中移除（手机端永不见 only_if_current）。

### 3.4 服务端校验（治理硬失败，不静默放行）
- `source` 白名单: `current_focus` | `app` | `locked`（未来 `charging`/`wifi`/`battery`）
- `op` 白名单: `in` | `not_in`（`is`/`is_not` 入参时接受，翻译为单元素后下发；未来 `gt`/`lt`）
- `value` 必须数组（翻译后恒为数组）；元素必须是 token 字符串
- 违规 → **丢弃该条 + trace 告警**（`level:"warn", ref:"bad_guard"`），绝不静默通过

---

## 4. 设备与平台（`?platform=` 自报 + 能力声明预留）

### 4.1 platform 自报（Ivan 定案）
- 手机端 GET 时自带: `?device=ivan-iphone&platform=ios&locales=zh,en`
- **服务端不维护"哪台设备是什么平台"的注册表** —— 设备自报家门，新设备接入零配置。
- 缺省/未知 platform → 用 `config.DEFAULT_PLATFORM`（当前 `ios`）+ trace 提示，不报错。
- 安卓将来只是自报 `platform=android`，服务端多一张 app 表。

### 4.2 能力声明（**本次只留形状，不建实体**）
安卓的真实差异（无 iOS Focus 模型、四路音量、铃声模式）无法翻译，只能声明:
```js
// config 预留形状；iOS 跑通前不实现
PLATFORMS: {
  ios:     { fields: ["focus", "silent", "media_volume"] },
  android: { fields: ["silent", "volume_media", "volume_ring"] },  // 形状示意
}
```
- 服务端据此**只下发该平台支持的字段**（或附能力标记让执行器优雅跳过）。
- **安卓碎片化在这层吸收**: 每台安卓能力不同 → 各自一个 profile，不强求一致。
- **纪律**: 现在只在 config 与文档留形状与注释，**不写实现**；等 iOS 全链路跑通、
  Ivan 决定上安卓时再填（HORIZON P8 PROFILES 同一层）。

---

## 5. 手机端影响（CheckGuards 改造，其余零改）

### 5.1 CheckGuards 新流程（比现版更简单）
```
输入: { guards: [...], resolve: <resolve节> }
对每条 guard:
  ① 按 source 取当前实况 Cur
       current_focus → Get Current Focus（文本，本地名）
       app           → Get Current App → Bundle Identifier
       locked        → Get Device Details: Device Is Locked（"true"/"false"）
  ② 展开 Expected:
       resolve[source] 存在 → 对 guard.value 每个 token 取 resolve[source][token]（数组），全部合并
       不存在(如 locked)   → 直接用 guard.value 字面量
  ③ member = Cur ∈ Expected  （逐项标记法精确相等，绝不 contains）
  ④ op=in 且 !member → Stop and Output: SKIP
     op=not_in 且 member → Stop and Output: SKIP
全部通过 → Stop and Output: PASS
```
**净变化**: 增加②的 token 展开（一个 Repeat）；删除原 focus 反查表专用分支；
op 分支从 4 个减到 2 个。**总步骤数基本持平甚至更少。**

### 5.2 各 Apply* 指令
- 读 guards 的路径不变: `fields.<x>.guards`（三字段统一）。
- 传给 CheckGuards 的参数增加 `resolve` 节（替代原 `cloud` 整包，更轻）。
- **其余逻辑一律不动**（标记判空、last_applied、focus 签名比对、候选名穷举全部保留）。

### 5.3 ApplyFocus 执行段
- 仍用 `resolve.focus_preset[token]` 取候选名数组逐个 Turn 试开 + Get Current Focus 验证。
- **原 `i18n.focus_token_to_name` 改名为 `resolve.focus_preset`**，结构不变（token→名数组）。
- 原 `i18n.focus_name_to_token` 反查表**删除**（守卫改成员判断后不再需要）。

---

## 6. 迁移清单（实施者按此执行，逐条打勾）

### 服务端
- [ ] `edge/i18n.js` → 改造为 `edge/resolve.js`；`FOCUS_NAMES` 保留并入 `resolve.focus_preset`；
      **新增 `APP_IDS` 按 platform 分表**（ios 先建，android 留空壳 + 注释）
- [ ] 信封 `i18n` 节 → 改名 `resolve`；删除 `focus_name_to_token`（只留 token→名数组）
- [ ] 新增 `?platform=` 参数解析；`config.DEFAULT_PLATFORM`
- [ ] `edge/assemble.js`: 废弃裸 `GUARDS` → 改读 `GUARDS_ALWAYS`；
      合并顺序: 时点(OWN.guards / only_if_current 翻译) + 恒常(GUARDS_ALWAYS)
- [ ] guard 校验: `is`/`is_not` 翻译为 `in`/`not_in` 单元素；value 恒为 token 数组；
      source/op 白名单 + 违规丢弃告警
- [ ] `config.default.js` / `router.js V2_DEFAULTS`:
      **删除 media_volume 里我写的 bundle id 示例**，改为 token 形态
      `GUARDS_ALWAYS: [{source:"app", op:"not_in", value:["maps","video","music"]}]`
- [ ] `PLATFORMS` 能力声明形状 + 注释（不实现）
- [ ] 测试: resolve 下发(按 platform/locales)、token 展开、guards 两作用域合并、
      is→in 翻译、空 token 展开的 in/not_in 语义、非法 guard 丢弃告警

### 文档
- [ ] KERNEL §18: 登记 `resolve`/`platform`/`GUARDS_ALWAYS`；`op` 收敛为 in/not_in；
      删除 i18n 相关旧词条
- [ ] PHONE-V2: §1 CheckGuards 按 §5.1 重写；§4 ApplyFocus 的 i18n 路径改 resolve；
      各 Apply* 传参改 resolve 节；URL 加 `&platform=ios`
- [ ] GUARDS-AND-PARITY: guards 章节指向本文；删除"标量需 value 包装"的旧结论
- [ ] HORIZON: 多平台/多设备条目指向本文；格式嗅探等其余不变
- [ ] INDEX / HANDOFF: 挂本文；HANDOFF 加"跨平台不变量"一条

### 手机端（Ivan 执行，实施者只出文档）
- [ ] CheckGuards 按 §5.1 重建（token 展开 + 两个 op 分支）
- [ ] 各 Apply* 的 URL 加 `&platform=ios`；传参改 resolve
- [ ] ApplyFocus 执行段路径改 `resolve.focus_preset`
- [ ] 常用 App 的 bundle id 收集（导航/视频/音乐各若干）填入云端 `APP_IDS.ios`

---

## 7. 不变量（本次重构必须守住，违反即失败）

1. **契约零平台字符串**: 信封的 fields/guards 里永远不出现包名、本地化名、平台特有词。
2. **一个 token 一个语义锚点**: 同一概念跨平台同 token，差异只在 resolve 表。
3. **token → 数组恒定**: 无单值/数组的分支特例。
4. **查不到 = 空展开**: 语义自动正确，禁止特判、禁止报错中断。
5. **guards 声明可两作用域，下发恒为一个数组**: 手机端只有一套 AND 逻辑。
6. **精确相等，永不子串**: 集合判断一律 in/not_in + 逐项相等。
7. **手机端零平台知识**: 执行器是通用解释器；平台差异全在云端数据与执行器自身实现里，
   不在契约里。
8. **能力声明只留形状**: iOS 跑通前不实现 PLATFORMS 逻辑，避免过早抽象。

---

## 8. 遗留决策（实施前需 Ivan 拍板，勿自行决定）

1. `GUARDS_ALWAYS` 这个名字是否满意（备选: `ALWAYS_GUARDS` / `FIELD_GUARDS`）。
2. App token 的分类粒度: 只做类别(`maps`/`video`/`music`)，还是同时提供具体 App token
   (`amap`/`bilibili`)？（设计已支持两者共存，问的是首批建哪些）
3. `locked` 守卫的值形态: 现为 `["true"]`/`["false"]` 字符串数组，是否接受。
4. 安卓 app 表首批是否建空壳（留注释）还是完全不建。
