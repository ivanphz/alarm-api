# PHONE-V2.md — 执行器蓝图（V12 手机端改造，配合 /v2/state）

> 原则回顾: 云端说 token（契约13）、期望不变不动手（契约4）、守卫执行时评估（契约3）、
> 宁可不动不可胡动（契约9）。改造顺序 = 本文档章节顺序，每章可独立灰度。

---

## 0. 基础 URL

```
GET https://<你的worker>/v2/state?key=<KEY>&device=default
GET .../v2/state?...&mode=point            ← 刺客用
GET .../v2/timeline?...&date=YYYY-MM-DD    ← 预览/排障（人看，手机不用）
```

## 1. 双语反查词典（一次性，P2 实测表冻结）

新建 Data Jar 键 `focus_token_map`（或快捷指令内「词典」动作），内容:

```json
{ "Do Not Disturb": "do_not_disturb", "勿扰模式": "do_not_disturb",
  "Sleep": "sleep",                   "睡眠": "sleep",
  "Personal": "personal",             "个人": "personal",
  "Work": "work",                     "工作": "work",
  "Driving": "driving",               "驾驶": "driving",
  "Reduce Interruptions": "reduce_interruptions", "减少干扰": "reduce_interruptions" }
```

用法: `token = 词典[Get Current Focus 文本]`，取不到/空文本 → token = `none`。
换系统语言零维护；新自定义 Focus 加一行。

## 2. last_applied 存储（P3 路线1）

Shortcuts 文件夹存 `last_applied.json`（覆盖写），形如:
```json
{ "focus": "<canonical串>", "silent": "on", "media_volume": 0 }
```
比较用「字符串相等」即可——focus 值直接存 API 返回的 value 的 JSON 文本
（云端已保证键序规范化，同值必同串）。

## 3. 主轮询快捷指令 ApplyState（segment 模式，自动化每小时 + 手动可跑）

**防覆盖三层保证（先读再建）**:
① 边界之间绝不覆盖——期望没变就跳过(§3b)，手动操作赢到下一次期望值变化；
② 边界时刻按表执行——与 v1 刺客同义，是日程生效不是覆盖，focus 另有守卫(§3c)；
③ **迟到断言窗口**——整点轮询使边界断言最晚迟到 1 小时，边界后~下次轮询前的手动
操作会被迟到断言吃掉一次。堵法见 §5: **边界刺客长期保留并写同一份 last_applied**，
刺客准点代行 → 轮询到时已"无变化"跳过 → 窗口缩回 v1 的分钟级。
终态 = 互补双轨: 刺客管准时(边界断言)，每小时轮询管自愈(漏发补课)，不是替代关系。

```
1  GET /v2/state (mode 缺省 segment)
2  读 last_applied.json → LA（无文件 = 空词典）
3  对每个字段 f ∈ fields:
   3a  期望 = fields[f].value 的 JSON 文本；null → 跳过且【删除 LA[f]】
       （无主张=放下记忆；长假白天为 null, 夜里 null→on 才被识别为变化、每晚重进安静）
   3b  期望 == LA[f] → 跳过（on_change 默认防线；apply=="enforce" 则不跳）
   3c  f == focus 且 value.only_if_current 非空:
         cur = 词典[Get Current Focus] (空→none)
         cur != only_if_current → 跳过本次（下个采样点再议）
   3d  执行:
         focus: If value.mode == do_not_disturb → Set Focus[编辑器绑定·勿扰] value.action
                （每个用到的 mode 一个 If 分支；action on/off 对应 开/关）
         silent: value=="on" → Set Silent Mode On, "off" → Off
         media_volume: Set Volume (value ÷ 100)
   3e  成功 → LA[f] = 期望
4  reconcile_alarms == true → 运行 SyncAlarms（见 §4）
5  覆盖写回 last_applied.json
```

## 3.5 形态选择: 聚合 vs 按字段拆分（契约1/15 的手机端兑现）

ApplyState 是**便利聚合**, 不是架构要求。两种形态任选:

- **聚合**（§3 原样）: 一条指令管全部字段。动件少, 但"暂停某一个字段"做不到精细。
- **拆分**: ApplySilent / ApplyFocus / ApplyVolume 各一条, 各挂各的自动化。
  每条循环相同: GET /v2/state → 只读自己的字段 → 查【自己的】last_applied → 守卫 → 动手。
  ⚠️ 拆分后 last_applied 必须一字段一文件（la_silent.json / la_focus.json / la_volume.json）,
  共用一个文件会被并发读-改-写互相覆盖。

拆分后的暂停矩阵: 停任何一条 → 其余字段与闹钟零感知; 重新启用 → 下次轮询
level 语义自动收敛（期望 ≠ 过期 last_applied → 重新对齐）, 无需补课。

**旅行场景示例**（要 silent 不要 quiet, 如日本电车）三档:
① 轻: 暂停 ApplySilent, 手动管静音, 回国重启用 —— 一周内的旅行用这个;
② 中: config 临时改 `silent: { USE: null, OWN: {"00:00": "on"} }` 全天静音, 其余照旧;
③ 重(旅行频繁才值得): 日历 [旅行] 跨天事件 → travel 事实 → silent 独立决策规则(V13+)。

## 4. SyncAlarms 对账（改读 /v2 的 alarms 节）

```
1  GET /v2/state → A = alarms
2  固定闹钟: 对 A.fixed 每条 → Find Alarm(名称==label) → action=="on"?开:关
3  动态 sweep（前缀 Gate-Dynamic-Event / Gate-ES / Gate-Class / Gate-AIQ）:
   3a  手机现有该前缀闹钟, 名称不在 A.dynamic[].label 集合 → 关闭
   3b  A.dynamic 每条: 手机无同名 → Create Alarm(label, at 的 HH:MM 部分); 有 → 确保开
```
与 v1 对账逻辑同构，仅数据源换到 alarms 节、action 变小写。
锚点语义不变: 主轮询在 reconcile_alarms=true 时才跑本指令（昂贵操作调度提示）。

## 5. 刺客（point 自动化）过渡策略

现有各时刻刺客可整体保留，仅把 URL 换成 `/v2/state?mode=point`（now 可省，网关自取
上海此刻），读 **`current_state`**——与 v1 同构的"时刻优先"值包: null=装死；命中时
`current_state.fields.<f>` 逐字段执行（null=不动），`current_state.reconcile_alarms`
=true 时跑 SyncAlarms。刺客改造因此退化为: 换 URL + 认 token（on/off、
do_not_disturb），流程结构一行不改。`fields.*.changes[]` 保留为明细视图。**建议（修订）**: 先切主轮询（§3）灰度一周；刺客换 URL 后**长期保留**（至少
07:40/09:30/22:25 三个用户敏感边界），且刺客执行成功后同样更新对应字段的
last_applied——这是堵住 §3③"迟到断言窗口"的关键：刺客准点断言并落账,
整点轮询随后看到无变化即跳过, 边界后的手动操作因此存活。

## 6. 灰度切换顺序

```
① 部署后先不动手机 → DEPLOY-V12.md §3 对拍通过
② 建词典(§1) + last_applied(§2) → 新建 ApplyState(§3) 手动跑通对着 /v2/timeline 核对
③ ApplyState 挂每小时自动化, 与旧刺客并行一周（on_change 防线保证不打架:
   两边期望一致时后到者跳过）
④ SyncAlarms 切 /v2(§4) → 旧刺客退役/换 point(§5)
⑤ config.user.js 设 V2:{DEFAULT:true} 收口
```

## 7. AI 额度流（可选，V2.AI_QUOTA.ENABLED 后生效）

新建快捷指令 UseAI（想用 AI 前跑它）:
```
1  GET /v2/state → fields.ai_available.value
2  == false → 显示"冷却中"并结束（恢复提醒闹钟 Gate-AIQ 已在对账清单里）
3  == true  → 打开 AI App/网页 →
4  POST /v2/fact  body: {"stream":"ai_claude","at":"<当前上海时间 YYYY-MM-DD HH:MM>",
                          "id":"<UUID 动作生成>","type":"done"}
```
点错了/要纠偏: 同端点发 {"type":"reset"} 或 {"type":"set_next","payload":{"at":"..."}}。
id 用 UUID 保证重试不重复计数。

## 7.5 延迟实验（P3 上云与否的裁决数据, 部署后随时可跑）

**主动探针** LatencyProbe（手动跑或整点自动化, 收集数十条即可）:
```
1  t0 = 当前时间(含秒) → POST /v2/fact {stream:"latency_probe", at:<墙钟>, id:<UUID>}
   → 记响应里的 colo（写入节点）
2  循环: GET /v2/facts?stream=latency_probe → 找到该 id? 记 t1 与响应 colo（读取节点）并停;
   未找到 → 等 2 秒重试（最多 10 次）
3  记一行: 延迟=(t1-t0)秒, 写colo, 读colo, 是否同节点 —— 存 Data Jar / 备忘录
```
**被动观测**: ApplyState §3e 成功后追加 POST
`{stream:"applied_state", at, id:<UUID>, payload:{field, value}}`（失败无所谓, 纯观测）。

**读数**: 同 colo 应近乎瞬时; 不同 colo 才可能出现文档上限内(≤60s)的陈旧。
换 WiFi/蜂窝、旅行时多测几组。裁决: 尾部可接受→P3 可用 KV; 不可接受→P3 上
Durable Object（强一致, 免费版可用）。权威在此期间始终留本地（KERNEL §14）。

## 8. 排障

任何异常先看 `/v2/timeline?date=当天` 的 trace（结构化规则编号沿用 R 系: 见
BLUEPRINT §④迁移表）; error=="internal_degraded" = 云端兜底降级, 手机应表现为
"什么都不做"——固定保命闹钟常驻本机, 不受影响。
