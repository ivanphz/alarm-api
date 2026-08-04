# 03-CONTRACT — 信封契约（服务端 ↔ 手机端）

> **改这里 = 破坏性变更**，手机端必须跟着改。日常改规则不动这一篇，去 [02-RULES](02-RULES.md)。
> 最后更新 2026-07-31（全 pulse、telemetry 节、批量回传）。

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
      &device=<设备名>             多设备时区分 profile 与 la（缺省 default）
      &apply=enforce              可选: 人工推平（守卫仍然拦得住）
```

---

## 2. 响应（两个模式形状完全一致）

```json
{
  "version": "2",
  "generated_at": "2026-07-15 07:41",
  "mode": "point",
  "platform": "ios",

  "telemetry": { "ENABLED": true, "MODE": "intent", "SLOW_MS": 15000,
                 "KEEP_DAYS": 7, "run_id": "h2e14zfuz8", "server_at": "2026-07-31 08:29" },

  "fields": {
    "focus": {
      "kind": "focus",
      "apply": "on_change",
      "value": { "preset": "do_not_disturb", "action": "off", "switch_to": null },
      "from": "2026-07-15 07:44",
      "guards": [ { "source": "current_focus", "op": "in",
                    "value": ["do_not_disturb"],                    // 语义 token（人读/排查用）
                    "match": ["勿扰模式", "Do Not Disturb"] } ]      // 已按本机展开，直接比这个
    },
    "silent":       { "kind": "scalar", "apply": "on_change", "value": "off", "from": "..." },
    "media_volume": { "kind": "scalar", "apply": "on_change", "value": 0, "from": "...",
                      "channel": "media",
                      "guards": [ { "source": "app", "op": "not_in",
                                    "value": ["maps", "video", "music"],
                                    "match": ["com.apple.Maps", "com.google.Maps", "..."] } ] }
  },

  "resolve": {
    "current_focus": { "do_not_disturb": ["勿扰模式", "Do Not Disturb"], "sleep": ["睡眠", "Sleep"] },
    "app":           { "maps": ["com.apple.Maps", "com.google.Maps", "com.autonavi.amap"],
                       "amap": ["com.autonavi.amap"] },
    "locked":        { "true": ["true"], "false": ["false"] },
    "volume_channel":{ "media": ["媒体", "Media"], "ringtone": ["电话铃声", "Ringtone"] }
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
> 手机端必须自建"语言无关隔离带"翻成死文本。见 [04-PHONE](04-PHONE.md) §0 铁则7。

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

### 2.0c `telemetry` — 手机端埋点总入口（2026-07-31）

手机端**先读它再决定记不记日志**。服务端一改全跟，稳定后 `ENABLED: false` 即整段停写，
不用进快捷指令编辑器。

⚠️ **手机端必须有本地默认值**：它来自信封，而信封来自 GET；GET 失败那次拿不到配置，
**而那恰恰是最该记录的一次**。不能写成「取不到就不记」。

`run_id` 由服务端生成，手机端把它写进每行日志 —— 将来回传时两端记录能拼成一条链路。
详见 [04-PHONE](04-PHONE.md) §埋点。

### 2.0d `channel` — 通道是 token 不是写死的枚举

`media_volume.channel = "media"`，本机名走 `resolve.volume_channel` 按语言下发
（中文「媒体」「电话铃声」）。手机端 `Set [变量] volume` 喂变量即可。

**换通道（媒体→铃声）= 服务端改一个字段，手机端零改动。**

### 2.0e `resolve` 缺 `locales` 时降级而非缺席（2026-07-31 改）

原先缺 `?locales=` 就整表不下发 → 守卫 `match` 全空 → `in` 永远拦截 → **focus 整个报废**。
瘫痪比「少保护」糟得多，所以改为**降级全语言兜底表** + `locales_fallback` 告警。

代价：候选顺序不再以系统语言优先，`Set Focus` 要多试几个名字。
正解仍是手机端自报语言（Actions 的 `Get User Details`），兜底只是安全网。

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

## 5. 回传（POST /v2/fact）

**下发是一次连接，回传也必须是。** 锁屏后台预算只有 40–80 秒且掐尾部，三个字段各发一次
POST 就是三次往返。

```json
POST /v2/fact?device=iphone
{ "events": [
    { "stream": "applied_focus",  "at": "2026-07-31 07:44", "id": "a1" },
    { "stream": "applied_silent", "at": "2026-07-31 07:44", "id": "b1" }
] }
```

- 按 `stream` 分组，**两个 stream 只写一次 KV 不是三次**
- 逐条报告去重/失败，坏事件不拖垮好事件
- 单条老形状 `{stream, at, id}` 继续收，手机端可以慢慢迁
- 单批 ≤ 50 条

响应：`{ ok, batch: true, results: [{ id, ok, deduped }] }`

---

## 6. 加东西时手机端要不要动

| 改动 | 手机端 |
|---|---|
| 加一个字段（新的 `fields.<x>`） | ⚠️ 要改 —— SyncAll 按字段名分派 |
| 改某字段的**值/时刻/条件** | ✅ 不用 |
| 换 `channel`（媒体→铃声） | ✅ 不用 |
| 加 `resolve` 表 | ✅ 不用（守卫已展开成 `match`） |
| 加 `guards` 条目 | ✅ 不用（CheckGuards 是通用的） |
| 加信封顶层节（如 `telemetry`） | ⚠️ 要用才改，不读则无害（契约12：未知字段容忍） |

---

## 7. 全 pulse 之后的段查询语义（2026-07-31）

`focus` / `silent` / `media_volume` 的边界现在全部是 `pulse`：

- **`mode=point`**（刺客/门铃）→ 看得见，正常执行
- **`mode=segment`**（默认/手动跑）→ **字段一律缺席**

这是正确行为：pulse 段内无主张 = 白天你手动开的专注不会被误关。
手机端手动跑 SyncAll 不带 `mode=point` 时 focus 什么都不做，**不是 bug**。
