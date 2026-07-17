# DEPLOY-V12.md — 部署与验收清单

## 1. 入库（本包 = 完整仓库树，直接整体替换）

- 本包已完成 `src/index.js → src/v1-legacy.js` 原地改名 + 新入口就位，**无需手工 rename**。
- ⚠️ `src/config.user.js` 以你仓库现行版本为准（本包内是修过逗号的那版）；
  v2 **不要求**改任何 config——`V2` 块可选，缺省全走 router.js 内置默认。
- workflow 建议在 wrangler 部署步骤**之前**加一步（CI 即唯一本地，测试守门）:
  ```yaml
      - run: node --test
  ```

## 1.5 KV 绑定（启用 AI 额度试点才需要）

CF 面板建 KV 命名空间 → wrangler.toml 加:
```toml
[[kv_namespaces]]
binding = "FACTS_KV"
id = "<namespace id>"
```
不绑不影响其余功能。烟测: `POST /v2/fact` 一条 → `GET /v2/facts?stream=ai_claude` 能读回。

## 2. 部署后烟测（5 分钟）

1. 老路径回归: 打开原地址（不带 /v1 前缀）→ 响应应与部署前**完全一致**（默认仍走 v1）。
2. `/v1/…` 前缀路径 → 同上一致（剥前缀适配）。
3. `/v2/state?key=…` → 新信封（version:"2"，fields + alarms + reconcile_alarms + trace）。
4. `/v2/timeline?key=…&date=<明天>` → 带 schedules 与 field_timelines 的内脏视图。

## 3. 对拍（验收关，建议 5 个典型日）

对每个日期 D，取 v1 `?testDate=D` 与 v2 `/v2/timeline?date=D` 各一份，核对:

| 场景 | 核对点 |
|---|---|
| 平常工作日 | fixed 集合、quiet 四键(07:40/12:15/13:29/20:55) |
| 周五→周末 | 夜间 22:25、周末 09:30、周六课(固定形态 on) |
| 长假(造 testEvents 三天块) | R6.2c 不解除→v2 整段 on；R3.2 跳课 |
| 请假日/晨间会议 | 早间组灭、Gate-Dynamic-Event、午间键静默 |
| 上帝模式日 | 集合与 quiet 全按 JSON |

已知合法差异（BLUEPRINT §③④"语义微调"）: 窗口 ±15 秒级、v2 值为小写 token、
同值边界被合并、v1 的"不输出"在 v2 表现为整段延续。除此之外任何不一致 → 把两份 JSON 发回。

## 4. 手机端改造

按 `docs/PHONE-V2.md` 执行（词典 → last_applied → 主轮询 → 闹钟对账 → 灰度切换）。

## 5. 收口

手机全部改读 /v2 且稳定运行数日后: `config.user.js` 加 `V2: { DEFAULT: true }`，
根路径切 v2；v1 择日下线（删 v1-legacy.js + rules.js + device-state.js + rest-days.js
+ school-break.js 旧件，ics-parser/time-utils 仍被 v2 复用先留）。
