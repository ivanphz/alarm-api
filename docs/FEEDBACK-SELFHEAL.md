# FEEDBACK-SELFHEAL.md — 手机状态回传与闹钟对账自愈（方向定稿，V13+ 分步实施）

> **本文是方向宪法，不是实施提示词。** 目的: 现在把接口形状、数据语义、权威归属定死，
> 使将来分步实施时**手机端与服务端结构都不需要大改**——每步都是往既定接口里填肉。
> 与 KERNEL §17.5 强绑定: 回传是"事实(已发生事件)"可进云端，绝不作"实况(决策依据)"用。
> 与 CHANNELS.md 强绑定: 自愈的输出通道(reminder/Bark)选型服从其实测台账。

---

## 0. 一句话愿景

手机把"我实际是什么样"(闹钟集合、专注态、执行结果)回传为**事实流**，
服务端把它与"应该是什么样"(期望集合)做 diff，发现漂移 → 按严重度走 todo/Bark
提醒你，甚至自动补建动态闹钟。**上传手机状态让主动纠错成为可能**——这是回传的真正价值，
远超"只为省一次采样"。

---

## 1. 三阶段路线（渐进，每阶段独立可用，后阶段不推翻前阶段）

| 阶段 | 服务端 | 手机端 | 权威 | 价值 |
|---|---|---|---|---|
| **P-观测** | 收 applied_state 事实 + /v2/timeline 并排"期望 vs 实测" + audit 漂移 warn | ApplyState/SyncAlarms 成功后追加一次回传 POST | 本地 | "昨晚到底执行没有""闹钟被误删没"有了答案 |
| **P-建议** | 信封附 advisory diff（云端算出的差异清单，仅建议） | 照旧本地判断，人肉比对一段时间 | 本地 | 验证 diff 逻辑正确，攒延迟数据 |
| **P-自愈** | diff → 漂移分级 → 走 reconcile_todos / Bark 门铃提醒 / 自动补建动态闹钟 | 退化为纯执行 + 回传 | 本地仍是最终裁判 | 主动纠错闭环 |

**权威铁律（三阶段不变）**: 本地 last_applied / 手机实际态**永远是最终真相**；
云端 diff 永远是"观点(advisory)"。云不可用 = 安全退回现状(照旧本地对账)，绝不因为
云端说"该改"就盲改。理由: KV 最终一致(§8)会让"云端决策"震荡；且守卫必须执行时读本地。

---

## 2. 回传数据模型（事实流，复用 /v2/fact，服务端零新端点）

手机回传 = 往既有 `/v2/fact` POST，stream 分三条(命名空间隔离，互不干扰)：

### 2.1 `applied_state` — 字段执行回执（ApplyState 用）
```json
{ "stream": "applied_state", "at": "2026-07-22 07:40", "id": "<UUID>",
  "payload": { "field": "silent", "value": "on", "result": "ok" } }
```
- 每字段动手成功后一条; result: ok | guard_skip | failed。
- 用途: P-观测显示"期望 on / 实测 on ✓"; 连续 failed → audit warn。

### 2.2 `alarm_inventory` — 闹钟实际清单（SyncAlarms 用，闹钟对账的核心）
```json
{ "stream": "alarm_inventory", "at": "2026-07-22 07:41", "id": "<UUID>",
  "payload": {
    "fixed":   [ { "label": "GateFix-Workday-WakeUp-Vib", "time": "06:25", "enabled": true } ],
    "dynamic": [ { "label": "GateDyn-Event-0730", "time": "07:30", "enabled": true } ]
  } }
```
- **delta 优先**(省流量、省单槽预算): 正常心跳只传"与上次回传的差异"; 定期(如每日一次)
  或首次传全量快照。payload 加 `"mode": "full" | "delta"` 标记。
- 手机取数: Find Alarms → 读 Label/Time/Is Enabled(实测可读，见 CHANNELS §6)→ 拼此结构。

### 2.3 `manual_override` — 用户手动改动信号（可选，进阶）
```json
{ "stream": "manual_override", "at": "...", "id": "...",
  "payload": { "field": "silent", "detected": "off", "expected": "on" } }
```
- 手机若能侦测"我改了但与期望不符"，回传此信号 → 服务端**抑制**该字段的漂移告警
  (你故意改的，别烦你)。无侦测能力时省略，服务端按保守策略(见 §4)。

---

## 3. 闹钟对账 diff（服务端，这是你点名要补的核心）

服务端已知**期望集合**(assembleAlarms 的输出: fixed 开关态 + dynamic 应存在集)。
收到 `alarm_inventory` 后，逐类 diff：

### 3.1 固定闹钟(GateFix-)对账
期望态 = 该 label 此刻应 on/off。实测 = 手机回传的 enabled + time。三种漂移：
| 漂移 | 判定 | 处置(分级见 §4) |
|---|---|---|
| **缺失** | 期望存在，实测清单里没有(被误删) | 高: reminder + Bark，提示重建(不自动建固定闹钟——固定需预建含铃震配置) |
| **状态错** | 期望 on，实测 enabled=false(或反) | 中: reminder 提示开关; 或下发一条"请开启"待办 |
| **时间错** | label 对，实测 time ≠ 预设 scheduled_at | 高: reminder，提示改回(时间错会导致该响不响) |

### 3.2 动态闹钟(GateDyn-)对账
期望 = 窗口内应存在的 GateDyn-* 集合。实测 = 手机清单里的 GateDyn-*。
| 漂移 | 判定 | 处置 |
|---|---|---|
| **应有缺失** | 期望集里有、实测没有 | **可自动补建**(动态闹钟无需预建铃配置)→ 下发补建指令 + Bark 门铃催同步 |
| **应删残留** | 实测有、期望集没有(过期未清) | 中: 指示手机 sweep 关闭(SyncAlarms 本就会做，漂移告警只是兜底) |
| **时间偏移** | 同 label 时间不符 | 动态时间入 label，理论上不会偏(偏=手机被手动动过)→ 低: 记录 |

**自愈动作纪律(铁律)**:
- **自动只"建"不"删"**: 补建动态闹钟可自动; 删除永远需人工确认(CHANNELS §6 实测)。
- **固定闹钟永不自动建**: 它需要预设铃声/震动/贪睡，自动建的是哑闹钟。缺失只提醒不代建。
- **提醒即够，纠正可选**: 最小实现只发 reminder/Bark 让你知道; 自动补建是增强，可后加。

---

## 4. 漂移分级与通道路由（服务端，接 severity → CHANNELS）
| 漂移类 | severity | 通道(CHANNELS §2) |
|---|---|---|
| 固定闹钟缺失/时间错(该响不响) | critical/high | Bark critical + reconcile_todos(urgent) |
| 固定状态错、动态应删残留 | normal | reconcile_todos(alert) |
| 动态应有缺失 | normal + 自动补建 | 补建下发 + Bark active(机器门铃催同步) |
| 字段连续执行失败 | high | Bark + 待办 |
| 命中 manual_override | 抑制 | 不告警 |

**无 manual_override 能力时的保守策略**: 字段类漂移默认"你可能手动改了"→ 只在
**连续 N 轮**(如 3 轮)持续偏离才告警(真误删不会自己恢复，手动改你迟早改回)；
闹钟类漂移(尤其固定缺失/时间错)不适用宽限——那是配置事故，立即提醒。

---

## 5. 接口预留清单（现在定死，实施时只填肉，不改形状）

**服务端**(全部是既有结构的扩展，非重构):
- `/v2/fact` 收三条新 stream(applied_state/alarm_inventory/manual_override) —— 端点已存在。
- edge 新增 `reconcile.js`: 读 alarm_inventory 事实 + 期望集 → diff → 分级 → 产 todo/Bark。
  挂在采样期(与 assembleAlarms 同层)，**不进插件**(纯度红线，契约7)。
- 信封预留 `drift` 节(P-建议起启用): `{ fixed:[…], dynamic:[…] }` advisory，默认不下发。
- `/v2/state` 已有 `?device=` —— 多设备回传天然隔离(fact:<device>:<stream>)。

**手机端**(全部是新增独立指令 + 现有指令尾部追加一步，**不回插 ApplyState 中段**):
- ApplyState 尾部 +1 步: 每字段动手后 POST applied_state(§2.1)。
- SyncAlarms 尾部 +1 步: Find Alarms 拼清单 → POST alarm_inventory(§2.2)。
- 新指令 ApplyDrift(P-自愈): 读信封 drift 节 → 补建动态闹钟(只建不删)。独立指令。
- 全部回传失败只记日志，绝不重试成风暴(CHANNELS §5 纪律)。

**命名(遵 KERNEL §18)**: stream 名 snake_case; drift 分级 token critical/high/normal;
自愈补建的闹钟仍走 GateDyn-* 既有标签族(不新增前缀)。

---

## 6. 与其他线的关系（防冲突）
- **与延迟实验(PHONE-V2 §7.5)同源**: applied_state 回传顺带就是延迟探针的被动数据;
  colo/received_at 已在 /v2/fact 埋好(BLUEPRINT 记录)。P-观测启用 = 延迟数据自动开始积累。
- **与 cadence(P4)正交**: cadence 产 todo/闹钟是"计划内生成"; 自愈是"计划外纠偏"。
  两者都汇入 todos 节/闹钟集，但来源不同、互不依赖。
- **与 todo 通道(P1)复用**: 自愈的 reminder 走的就是 P1 建好的 reconcile_todos 通道，
  所以**实施顺序: P1 todo 通道 → P2 Bark → P-观测回传 → P-自愈**，自愈是最后拼装，
  前面每块都为它备好了零件。

---

## 7. 实施顺序建议（并入 INDEX 路线图）
```
P1 todo 通道 → P2 Bark → P-观测(回传+timeline并排, 服务端 reconcile.js 只读不动作)
→ P-建议(drift 节下发, 人肉比对 + 延迟数据够了做决策)
→ P-自愈(分级路由 + 动态补建; 固定只提醒)
每步手机端: 老指令尾部 +1 步 或 新建独立指令; ApplyState 中段永不回插。
每步服务端: /v2/fact 收新 stream + reconcile.js 加逻辑; 不碰 kernel/、不碰插件。
```
