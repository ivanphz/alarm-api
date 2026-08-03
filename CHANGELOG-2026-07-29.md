# 本次改动纪要（2026-07-27 ~ 07-29）

> 全程 **177 用例绿**。手机端目前只需要**新建一条通知自动化**（见文末）。

## 一、修掉的 bug

| # | 症状 | 根因 |
|---|---|---|
| 1 | 午休开的是【睡眠】而不是【勿扰】 | `focus` 只有一个 `PRESET`，午间边界跟着夜间走 |
| 2 | 长假连着几晚不进睡眠 | 「同值=没变化」的电平假设硬编码在 kernel 三处；长假早晨的 `null`（释放主张）又被 OWN 守卫吞掉 |
| 3 | **出差期间 focus 彻底卡死**（`la_focus` 停在 7/27 不动） | 出差事件占了午间区带 → 无午间两键 → 晨间守卫拦下不落账 → `la` 冻结 → 夜间判「没变化」跳过。平时是 13:29 那条无守卫的边界在无意中当死锁解除器 |
| 4 | 白天手动小睡被误关 | 段被当成持续期望态，而实际没有高频巡检 |
| 5 | 出差日闹钟 08:10 才响，状态 07:40 就解除 | 解除时刻是写死的字面量 |
| 6 | `?locales=` 丢失 → 守卫 `match` 空 → 永远拦截，**毫无迹象** | 空展开没有告警 |
| 7 | `src/router.js` 是死文件（与 `edge/router.js` 一字不差，无人引用，自身 import 全断） | 复制品 |

## 二、架构

**三根正交的轴**（原先 `once/enforce/on_change` 三个名字是它们的混合投影）

- `SHAPE`（边界级）: `level` 电平 / `level+until` 有界电平 / `pulse` 脉冲
- `APPLY`（边界级）: `always` / `if_changed`（比本地 la）/ `if_differs`（比实测态，未实现）
- 守卫: 前置否决，**优先级高于一切，包括强制推平**

**日型三根轴**（`plugins/day-type.js`）

```
morning: work | leave_short | leave_long_tail | rest_short | rest_long
noon:    work | off              eve: workday | rest
```

**规则表**: 一个边界一行，两种书写形式（字段为主键 `RULES` / 时刻为主键 `BOUNDARIES`），
加载期翻译成规范形式（触发因为主键）。同一格写两份 → 报错，绝不静默取一个。

**时刻可以是算出来的**: `at: { from:"wake_alarms", pick:"last_wake", offset:20, fallback:"07:40" }`

**门铃**: 服务端唯一的主动入口。cron 兜底 + 你的服务器秒级主力。

## 三、行为对照

| 场景 | 解除时刻 | 说明 |
|---|---|---|
| 普通工作日 | 起床闹钟 + 20 分钟 | 寒暑假 07:24 → 07:44 |
| 出差（事件带时间） | 动态闹钟 + 20 分钟 | 08:10 → **08:30** |
| 出差（全天事件） | 07:40 | 无动态闹钟 → fallback |
| 周末 | 09:30 | 休息日没有起床闹钟可锚 |
| 长假中段/尾巴 | 不解除，只释放主张 | 白天归人管，夜里照常重进 |

解除后 50 分钟窗口自动撤销主张 → 白天手动小睡不被误伤。

## 四、退役

- `plugins/quiet.js` —— 三个字段全部迁进规则表后再无消费者。其 R6.1–R6.3 分支判定
  搬进 `day-type` 的三根轴，**七个场景用例逐条移植**到 `test/plugins/day-type.e2e.test.js`
- `kernel/audit.js` 的 `auditQuietWhitelist` —— 由 `assemble.js` 的 `needs_doorbell` 取代，
  且覆盖面更大（查所有字段的所有边界，不再局限于一条规则）
- `src/router.js` 死文件

## 五、新端点

| 端点 | 用途 |
|---|---|
| `/v2/schema` | 规则规范形式 + 两种视图 + **手机上需要建哪些自动化** |
| `/sweep` | 门铃扫描（`?at=` 精确触发，服务器用） |
| `/sweep/plan` | 未来 24h 的门铃时刻表（服务器拉去做秒级调度） |
| `POST /v2/fact` | 支持批量 `{ events: [...] }`，按 stream 分组只写一次 KV |

## 六、部署清单

```bash
npx wrangler secret put BARK_KEY        # 门铃
npx wrangler secret put PLAN_WEBHOOK    # 可选: 推计划给你的服务器
npx wrangler deploy
```

**没有服务器就把 `PUSH.LAG_MINUTES` 设 0**（默认 10 是给服务器当主力时留的兜底滞后）。

**手机端唯一要做的**: 新建一条通知自动化 —— 收到通知 → 标题包含 `|SYNCALL|` → 运行 SyncAll，
关掉「运行前询问」。竖线不能省，`contains` 是子串匹配。

先看 `/v2/schema` 的 `automations` 段，它会直接告诉你还缺哪几条自动化。

## 七、已知待办

- 回传自愈 P-观测（批量端点已就位，手机端每个 Apply 尾部加一步 POST）
- `if_differs` 判据（依赖上一条）
- 文档收口: `RULEBOOK.md` 重写、`KERNEL.md` §5 五旋钮退役、`CHANNELS.md` 补本次条目
- `ringtone_volume` 字段（配置已备，默认注释掉；手机端需复制一份 ApplyVolume）
- god 模式重做（等定型）
