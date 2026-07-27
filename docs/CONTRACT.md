# CONTRACT.md — 手机端契约（冻结版）

> **这份文档是搭手机端的唯一依据。** 服务端 95 用例全绿，形状已冻结。
> 目标：**手机端搭一次，以后加规则/加任务/加闹钟族/加数据源，手机端一个块都不用动。**

---

## 0. 四条形状法则（为什么这次不一样）

V1 死于「值从标量变数组」，V2 死于「守卫从 `is` 变 `in`」。两次都是同一个病：
**同一个位置在不同情况下形状不同**。Shortcuts 没类型、没测试、改一处要手动找齐所有消费点。

所以冻结的目标不是「这次定对」，而是**让形状永远不需要变**：

| # | 法则 | 服务端已保证 |
|---|---|---|
| **1 同构** | 集合里每个条目键集相同，没有"有时是容器" | `fields` 每项都是 `{kind, apply, value, from, guards?}` |
| **2 恒数组** | 可能复数的永远是数组，哪怕 0 或 1 个 | `guards[]`、`guard.value[]`、`resolve[表][token][]` |
| **2b 零裸布尔** | 真值一律字符串 `"true"`/`"false"`，永不发 JSON boolean | 全量扫描测试守着（见下） |
| **3 单路径** | 同一信息只有一个读取位置，不随 mode/kind 变 | segment 与 point **键集逐字节相同** |
| **4 只增不改** | 可以冒出新键，已有键的含义/形状/位置永不动 | 未知键双向忽略（契约12） |

**你唯一需要守的**：读到不认识的东西 → **fail-closed（跳过、不动手）**，不要猜。

---

## 1. 请求

```
GET https://<worker>/v2/state
      ?key=<鉴权>
      &mode=segment|point         轮询用 segment；边界刺客用 point
      &now=HH:MM                  刺客必带（传自己的计划时刻，抗 iOS 延迟触发）
      &locales=<系统语言>,en       决定 resolve.current_focus 表
      &platform=ios               决定 resolve.app 表
```

---

## 2. 响应（两个模式形状完全一致）

```json
{
  "version": "2",
  "generated_at": "2026-07-15 07:41",
  "mode": "point",
  "platform": "ios",

  "fields": {
    "focus": {
      "kind": "focus",
      "apply": "on_change",
      "value": { "preset": "do_not_disturb", "action": "off", "switch_to": null },
      "from": "2026-07-15 07:40",
      "guards": [ { "source": "current_focus", "op": "in",
                    "value": ["do_not_disturb"],                    // 语义 token（人读/排查用）
                    "match": ["勿扰模式", "Do Not Disturb"] } ]      // 已按本机展开，直接比这个
    },
    "silent":       { "kind": "scalar", "apply": "on_change", "value": "off", "from": "..." },
    "media_volume": { "kind": "scalar", "apply": "on_change", "value": 0, "from": "...",
                      "guards": [ { "source": "app", "op": "not_in",
                                    "value": ["maps", "video", "music"],
                                    "match": ["com.apple.Maps", "com.google.Maps", "..."] } ] }
  },

  "resolve": {
    "current_focus": { "do_not_disturb": ["勿扰模式", "Do Not Disturb"], "sleep": ["睡眠", "Sleep"] },
    "app":           { "maps": ["com.apple.Maps", "com.google.Maps", "com.autonavi.amap"],
                       "amap": ["com.autonavi.amap"] },
    "locked":        { "true": ["true"], "false": ["false"] }
  },

  "alarms": {
    "window": { "start": "...", "end": "..." },
    "sweep":   "true",
    "fixed":   [ { "label": "GateFix-...", "action": "on|off" } ],
    "dynamic": [ { "label": "GateDyn-...", "at": "YYYY-MM-DD HH:MM", "reason": "..." } ]
  },
  "trace": [ "..." ]
}
```

### 2.0 ⚠️ 为什么真值是字符串不是布尔

iOS 快捷指令把 JSON `true` 渲染成**本地化文本**——中文系统「是」、英文「Yes」，
历史上还出现过 `1`/`0`、`true`/`false`。**呈现方式随系统语言与 iOS 版本漂移，不是契约。**
手机端拿 `true` 比对必然失败，且是**静默失败**（条件永不成立，表现为"什么都没发生"）。

所以信封里 `alarms.sweep`、`fields.<x>.value` 等一切真值都下发**字符串 token**
`"true"` / `"false"`，与 `resolve.locked` 表保持一致。手机端全程只做文本相等。

有一条测试**递归扫描整个信封**，任何位置出现 boolean 就失败 —— 新增字段无法绕过。

> 注意：**iOS 自己动作产生的布尔**（如 `Device Is Locked`）服务端管不着，
> 手机端必须自建"语言无关隔离带"翻成死文本。见 `PHONE.md` 铁则7。

### 2.0b ⚠️ `alarms.sweep` —— 破坏性操作的授权位

手机端 sweep 的规则是"不在清单里就关掉"，而**空清单 = 全都不在 = 全关**。
所以服务端只要少给了条目（异常降级、某个外部源超时），就会关光所有动态闹钟。

而 `dynamic: []` 本身是**合法指令**（今天真的没有动态闹钟，就该全关），
**无法靠"空不空"识别故障** —— 只能由服务端显式声明这批数据够不够权威：

| `sweep` | 什么时候 | 手机端 |
|---|---|---|
| `"true"` | 正常 | 加法 + sweep 全做 |
| `"false"` | 降级信封 / 任一外部闹钟源拉取失败 | **只做加法**（有则开、无则建），跳过 sweep |

**手机端必须判 `is true`，不能判 `is not false`** —— 这样老服务端不发此字段、值拼错、
拿到空信封时，一律不 sweep。两侧都 fail-closed。

> 为什么用显式标志而不是"降级时省略 alarms 节"：省略靠的是"记得省略"，
> 将来有人写新路径忘了 → 发出空 alarms → 关光闹钟（**默认危险**）；
> 标志靠的是"记得置 true"，忘了 → 手机跳过 sweep → 什么都不做（**默认安全**）。

### 2.1 ⚠️ 缺席 ≠ null（**最容易搞错的一条**）

| 情况 | 信封 | 手机端动作 |
|---|---|---|
| 字段**整个不出现** | `fields` 里没这个键 | **什么都不做**（此刻没有关于它的指令） |
| 字段在，`value` 是 `null` | `"silent": {..., "value": null}` | **删除 `last_applied[silent]`**（规则显式释放主张） |

`value: null` 出现在长假白天这类场景——规则主动放手让你手动控制。删缓存是必须的，
否则假期结束重新主张时会被旧缓存判成"没变"而永不生效。

point 模式下没命中边界的字段一律缺席，所以刺客不会误删缓存。

---

## 3. 手机端读取逻辑（伪代码，照这个搭）

```
GetState(mode, now):                      ← 共享子指令：URL 的唯一改动点
    拉取 → 返回信封

CheckGuards(guards):                      ← 共享子指令：守卫逻辑的唯一改动点
    for each g in guards:                            # guards 恒为数组，可能长度 0
        actual = read(g.source)                      # ← 唯一需要按源分支的地方
            current_focus → Get Current Focus，取名字，过 Text
            app           → Get Current App，取 Bundle Identifier
            locked        → 锁定状态 → "true"/"false"
            其它          → 【输出 SKIP，直接结束】   ← fail-closed 兜底，必须有
        member = g.match 包含 actual                  # ← 服务端已展开好，单层循环
        if g.op == "in"     and not member → 输出 SKIP
        if g.op == "not_in" and     member → 输出 SKIP
    输出 PASS

ApplyX(field):                            ← 每个能力一个小指令，约 8 个块
    envelope = GetState(...)
    f = envelope.fields[X]
    if f 缺席                → 结束（什么都不做）
    if CheckGuards(f.guards) == SKIP → 结束（且【不落账】）
    expect = 签名(f.value)               # focus 用 "preset|action"，标量直接用值
    if expect == last_applied[X]  → 结束（apply=on_change）
    if f.value 为 null       → 删除 last_applied[X]，结束
    执行 iOS 动作
    last_applied[X] = expect
```

**关键收益**：因为两个模式读法一致，**边界刺客和轮询共用同一个 ApplyX**，只是调
`GetState` 时传的参数不同。不用搭两套。

### 3.1 为什么 CheckGuards 不需要 resolve

服务端已按本请求的 `?platform=` / `?locales=` 把 `value` 里的语义 token 展开成
`match[]`（本机比较集合）。手机端直接拿 `match` 比，**少一整层嵌套循环**，
且展开语义（token 查不到 = 空展开）由服务端测试覆盖，不在 Shortcuts 里裸奔。

`value[]` 保留语义 token 供你排查与跨平台阅读；`match[]` 是它在本机的投影。
`resolve` 现在**只剩 ApplyFocus 执行段**用（preset token → 本机名候选数组，喂 Set Focus）。

### 3.2 ApplyFocus 的执行段

`resolve.current_focus[preset]` 就是要喂给 `Set Focus` 的**本机名候选数组**，逐个试开、
用 `Get Current Focus` 验证、成功即止。（同一张表，守卫段用来做成员判断，执行段用来试开。）

⚠️ 候选名数组**绝不能过 `Text` 动作**——会变成 `"A, B"` 死文本，喂 Set Focus 必失效。

---

## 4. 四条铁则（沿用，仍然有效）

1. **文本比较**：任何比较先过 `Text` 动作。布尔在 iOS 里显示成 `Yes/No`，不可赌。
2. **判空用标记法**：`Text: X<变量>` → `If is X` 即为空。**永不用 `has any value`**（0 会被当空）。
3. **守卫拦截不落账**：SKIP 时不更新 `last_applied`，下轮重判。落了账等于把手动操作吃掉。
4. **一个变量名只 Set 一次**：其余取值存新变量。V2 的连环失效就是变量自我覆盖。

---

## 5. 以后加东西，手机端要不要动？

| 你以后想加 | 手机端 |
|---|---|
| 新规则 / 改时间 / 新假期逻辑 | **不动** |
| 新周期任务（宝箱、签到） | **不动**（提醒走 `GateDyn-` 闹钟，sweep 已通吃） |
| 新外部闹钟源 | **不动** |
| 新闹钟族 `GateDyn-<新族>-` | **不动**（单一前缀 sweep） |
| 新 App 加进守卫（如加个导航 App） | **不动**（服务端 `resolve.app` 加一行） |
| 新守卫源（如 charging / wifi） | 加一个读取分支；**没加之前 fail-closed 跳过，不会做错事** |
| 新设备能力（如屏幕亮度） | 加一个小 ApplyX（约 8 块），共享子指令不动 |

---

## 6. 服务端待你实测补的数据

`src/edge/resolve.js` 的 App 原子表只登记了高置信度条目（苹果地图/谷歌地图/高德/百度/
YouTube/Netflix/Apple Music/Spotify）。B站、爱奇艺、腾讯视频、优酷、网易云、QQ音乐留空并注释了。

**采集法（30 秒/个）**：新建快捷指令 → `Get Current App` → `Bundle Identifier` → `Show Result`，
打开目标 App 后从后台运行。

**表不全的后果**：`not_in ["maps"]` 里少一个导航 App → 守卫**通过** → 照常归零音量。
**静默少保护，不报错**。反过来多写一个不存在的 App 完全无害。

---

## 7. 本轮服务端改了什么

| 改动 | 为什么 |
|---|---|
| **point/segment 统一读 `fields.<x>.value`** | 原本 point 只有 `changes[]`，值在 `current_state.fields.<x>`（另一条路径、另一种形状）→ 手机要搭两套 |
| **`current_state` 退休** | 值只能有一个来源 |
| **`changes[]` 收进 `?debug=1`** | 手机端不该看见它，免得误依赖 |
| **撤回 `fields` 嵌套** | 嵌套让 `fields.cadence` 变成"没有 kind 的容器"，破坏同构。扁平键 `"cadence.ai_claude"` 对手机端是不透明字符串 |
| **删除 `i18n` 节** | 与 `resolve` 是同一份数据的两种形状 |
| **`resolve` 表名改成守卫 source 名** | 手机端 `resolve[g.source][token]` 零对照表 |
| **新增 `resolve.locked` 恒等表** | 让"无需翻译"的源也走同一句展开，手机端零分支 |
| **删除 `focus_name_to_token` 反查表** | 守卫改成员判断后，`current_focus` 与 `app` 完全同构，一套逻辑吃两种源 |

**没做**：`?guard_sources=` 能力自报。手机端 CheckGuards 的 fail-closed 兜底分支
（§3 伪代码里那行「其它 → 输出 SKIP」）效果等价且更彻底，服务端零复杂度。
