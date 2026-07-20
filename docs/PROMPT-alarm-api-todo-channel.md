# 实施提示词 —— alarm-api 增加 todo 执行通道 + Bark 推送命令通道

> 用法：把本文连同仓库交给实施会话。现状真相源：docs/ARCHITECTURE.md、
> external-alarms(-internal).md、PHONE.md。配套文档：docs/CHANNELS.md（通道总册，
> 本次一并入库）。冲突先问。两个通道**可分两次手术**，todo 通道先行。

## 手术 A：todo 执行通道（与外部闹钟平行的第二通道）

### 分工

网关负责：拉源、净化校验、时区换算、拼身份标记、算"当前应存在的未来 todo 全集"、
下发给手机。手机负责：upsert + 归档（见 PROMPT-phone）。**一源一通道**：todo 源是
独立登记项（`type: 'todo-json' | 'todo-ics'`），闹钟协议 v1 一字不动。

### 源配置新增字段（源级，iPhone 概念全住这里）

```js
{
  name: '还款待办', type: 'todo-json', code: 'repay',
  url: 'https://<calendar-api>/?cal=card&format=todo',
  list: '账单',            // 落到哪个提醒事项列表（手机侧须预建）
  leadDays: 3,             // 采纳窗口：到期前 N 天开始出现在清单（todo 的 horizon，与闹钟 2 天窗口无关）
  severityMap: {           // severity → 落地形态（缺省即此，可覆盖）
    high: 'urgent', normal: 'alert', low: 'silent'
  },
  defaultTime: '09:30',    // 无 time 条目的到期钟点兜底
  enabled: true, timeoutMs: 5000
}
```

### 身份标记（同 label 哲学：uid 纯身份，网关拼落地形态）

- 提醒事项 **URL 字段** = `gate-td://<code>/<uid>`（全 ASCII；净化同 ES：code≤16、uid≤40）。
- 标记**不含时间**（与 `Gate-ES-*-HHMM` 相反！）：铃伴生于日期、改期即改铃（实测），身份无需换壳。
- 墓碑前缀 `gate-tdx://` 预留给手机侧归档机制（对在役查询隐形），网关永不生成、永不下发。
- Title/Notes = 源条目的 title/notes 原样（人话归人话，标记归 URL，互不污染）。

### 下发契约（网关 → 手机）

响应新增 `todos` 段 + `sync_todos_flag`（与 sync_alarms_flag 同构）。每条：
`{ marker, title, notes, list, dueDate, dueTime, mode: 'urgent'|'alert'|'silent' }`
—— 网关已做完时区换算与 severity 映射，手机零判断照单执行。
**全集语义**：todos 段 = "此刻应存在的全部未来 todo"（leadDays 窗口内），
手机据此 upsert + 归档。过期条目网关不下发也不指示删除（过去归用户）。

### 治理与降级（沿用既有哲学）

- 逐源 try/catch + 超时；拒收计数进 humanReadable：
  `[待办] 📋 还款(repay): 候选N 窗口内M (拒:无uid a/格式 b/窗口外 c/时区 d)`
- 违规条目响亮熔断该条，绝不静默修复；最外层兜底网语义不变（todos 缺省空数组）。

## 手术 B：Bark 推送命令通道（推/拉分工见 CHANNELS.md §4-5）

- 网关新增出站模块：向自托管 bark-server POST。Bark key 走 **Cloudflare Secret**。
- 消息形状：`title = 路由关键词`（手机侧按 Title contains 分流）、`body = 人话摘要`
  （给人看的，**不是指令**）、`level` 分两类：**机器门铃一律 active**（零打扰、
  照触发，实测）；给人的紧急事件才 timeSensitive/critical。
- **推送语义（实测）**：边沿触发、不可靠、手机侧单槽忙碌即丢。据此：
  关键变更（god-mode、请假）**回响双发**——同一幂等门铃发两次，间隔 ≥ 2 分钟
  （大于单轮同步最坏时长）；普通变更单发即可。推送失败/丢失的最坏后果 =
  延迟到下个心跳，心跳地基永不撤。
- **纪律内嵌实现与注释**（CHANNELS.md §5）：内容只做路由；被触发的手机指令
  一律带 key 回 GET 网关拿权威状态；推送失败只记日志、绝不重试成风暴。
- 触发时机（首批保守）：god-mode 变更、请假写入、上游数据缺口告警。以后再扩。

## 交付物

- 两通道实现 + config.default.js 新增段（含逐项注释）+ CHANNELS.md 入库 docs/（已定稿随附，含全部实测台账，入库即可）
- external-todos.md（对外协议，供乙方）+ external-todos-internal.md 或并入 internal 文档
- PHONE.md 联动更新指引（真相源规矩：改线上契约必同步 PHONE 文档与本地指令）
- 测试：源解析/净化/窗口/severity 映射/降级各一组
- **只交付新增/修改的单个文件**，不打包

## 留给实施会话与 Ivan 现场裁决

- todos 段是并入主响应还是独立端点（倾向并入，省一次拉取；确认体积与超时预算）
- ICS 途径 `[[TD:uid]]` 首批做不做（calendar-api 走 JSON 正门，ICS 只为未来乙方）
- Bark level 与事件类型的映射表定稿
