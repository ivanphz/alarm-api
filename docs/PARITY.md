# PARITY.md — v1/v2 对拍手册（把本文 + 两份 JSON 交给任何 AI 即可裁决）

> 用途: V12 迁移验收。对每个测试日 D，按 §1 取数、按 §2 映射对齐、
> 按 §3 白名单排除合法差异，剩下的任何不一致 = 需要上报的疑似 bug（§4 模板）。

## 1. 取数口径（⚠️ 锚点必须统一，否则闹钟窗口必然对不上）

```
v1:  <base>/?key=…&testDate=YYYY-MM-DD          （虚拟时钟锚到当日 00:00:00）
v2:  <base>/v2/timeline?key=…&date=YYYY-MM-DD&now=00:00
```
不带 `now=00:00` 的 v2 请求用真实此刻做窗口锚，与 v1 testDate 不可比（fixed/dynamic
的 on/off 会因窗口不同而大面积"不一致"，那不是 bug）。

## 2. 字段映射表（v1 → v2）

| v1 位置 | v2 位置 | 对齐要点 |
|---|---|---|
| `fixedAlarms[]` | `alarms.fixed[]` | label 逐一配对；`action` ON/OFF → on/off；`scheduledAt`→`scheduled_at` |
| `dynamicAlarms[]` | `alarms.dynamic[]` | label 集合相等；v2 多 `at` 全日期字段 |
| `device_schedule["HH:MM"].focus` | `field_timelines.focus[]` 中同日 `from` 尾 HH:MM 的项 | `mode` 本地化名→token（Do Not Disturb→do_not_disturb）；ON/OFF→on/off；only_if_current 同理 token 化 |
| `device_schedule["HH:MM"].silent` | `field_timelines.silent[]` | v1 `null`=该键此字段不动 → v2 表现为**该时刻无边界**（SKIP/无变化），两者等价 |
| `device_schedule["HH:MM"].media_volume` | `field_timelines.media_volume[]` | 见 §3-4 声明差异 |
| `device_schedule["HH:MM"].sync_alarms` | `RECONCILE_ALARMS` 键集（07:40/13:29/22:25） | true 的键集合应一致 |
| `humanReadable` 矩阵扫描 R 编号 | `schedules.quiet/presence/wake_alarms/weekend_class` | R→插件对照见 BLUEPRINT §④ 迁移表 |
| `meta.window*` | `alarms.window` | 统一锚点后应仅差秒级（§3-1） |

对齐方法: 逐日期把 v2 `field_timelines.*` 按 `from` 尾部 HH:MM 装回 v1 的键式视图再比。

## 3. 合法差异白名单（比对时直接排除）

1. **窗口秒级**: v1 起点 +15s / 终点 +24h15s；v2 = (锚+1分, 锚+24h]。分钟级等价。
2. **命名法**: v2 全小写 snake token（on/off/do_not_disturb）；ON/OFF、本地化 Focus 名属 v1。
3. **同值合并**: v2 相邻同值边界被归一化吸收（重申不是变化）；v1 可能重复出现。
4. **media_volume（契约15 改订阅的声明差异）**: v1 固定 OWN 四键每键归零；
   v2 跟随 quiet——进入安静时刻归零（休息日前夜在 22:25 而非 20:55），解除时刻
   (07:40/13:29) 释放为 null 不再补零（白天音量归人管）。
5. **长假 null 释放**: v1 长假早晨"无键"；v2 显式 `value:null` 边界（KERNEL v0.5）。
6. **v1 的"不输出"意外键**: v1 `device_schedule` 里 20:55 可能出现纯 media 行——
   那是 v1 静态 OWN 的副产品，v2 无此行属正常（见 4）。
7. **restdays/presence 段合并**: v2 相邻同值日合并成一段（采样语义不变）。
8. **trace 措辞**: 只比语义（该日命中哪些 R 分支），不比文案。
9. **2027 归档缺失 fallback 警告**: workdays-core 数据面问题，两版同源，非迁移差异。

## 4. 裁决模板（AI 输出格式）

```
日期 D / 场景: …
✅ 一致: alarms.fixed(8/8) · quiet 边界(n/n) · silent · focus(含守卫) · reconcile 键集
⚠️ 白名单差异: 引用 §3 条目号列出
❌ 疑似 bug: v1=…, v2=…, 复现 URL 两条, 涉及日期与字段
```

## 5. 已知历史判例（2026-07-17 周五场景已裁决）

- 闹钟大面积不一致 → 取数未带 now=00:00（§1），非 bug。
- audit 误报 ai_quota_reminder 孤儿 → 已修（豁免名单）。
- v2 focus 07:40 缺 only_if_current 守卫 → 已修（V2_DEFAULTS 继承 v1 用户配置）。
- 上帝模式双版解析失败 → 日历描述被 iOS 智能标点污染（弯引号），非迁移差异；
  v2 已加容错+大字报，重拍前先确认 trace 无 god_json_invalid。
- env.EXTERNAL_ALARMS 裸 URL 非法 → **v1/v2 同报**（外部闹钟两版均失效中），
  修法: CF 面板改为 `[{"name":"…","code":"…","type":"ics","url":"https://…","tz":"Asia/Shanghai"}]`。
