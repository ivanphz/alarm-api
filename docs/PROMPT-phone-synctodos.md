# 实施提示词 —— 手机侧 SyncTodos（升级 PHONE.md 时并入）

> 用法：本文是手机端待办同步的**行为契约**，据此产出 PHONE.md 新章节 + 建快捷指令的
> 逐步说明。全部机制均有实测支撑（CHANNELS.md §6），实施时不得凭直觉翻案。

## 0. 铁律（先背再建）

1. **完成语义归人**：任何指令永不把「Is Completed」置为真。
2. **无人值守只建只改，绝不删**：Remove 需人工确认（实测），只出现在人工清扫仪式。
3. **过去归用户**：已过期条目一概不碰——"你漏了这件事"正是待办的价值。
4. **关键动作不置尾，正确性不依赖"跑完"**：后台预算 40~80 秒非确定被掐、掐尾部（E1）。
   upsert 幂等天然免疫：掐哪儿算哪儿，下轮补齐。

## 1. SyncTodos 对账（upsert）

网络调用**有且仅有一次**：拉网关 todos 全集（网关已做完时区换算与 severity→mode 映射）。
对每条（marker/title/notes/list/dueDate/dueTime/mode）：

1. `Find Reminders where URL contains <marker>`——**不加完成状态过滤**
   （已完成的也要命中，否则用户勾完的条目会被重建成僵尸）。
2. **无命中** → Add Reminder：列表=list、标题/备注、到期=dueDate+dueTime、URL=marker，
   mode：urgent→开 Urgent；alert→Alert At Time；silent→No Alert。
3. **命中且已完成** → 跳过（铁律 1 的另一面：不覆盖、不改期、不复活）。
4. **命中且未完成** → Set Detail 幂等覆写 Due Date / Title / Notes。
   改期在此自然生效：**铃伴生于日期，改期即改铃**（R4 实测），无需删旧建新。
5. **mode 变更**（下发 mode ≠ 现存形态，如 normal↔high）：Urgent 是出生属性、
   Set Detail 改不了 → 走 §2 墓碑三连 + 按新 mode 新建，全程静默。

## 2. 归档 = 墓碑三连（处理"取消"与"换壳"）

语义：网关全集里没有、但清单里有、且到期在未来、且未完成 = 已取消。

**查询**：URL contains `gate-td://` ∧ Is Not Completed ∧ Due Date **is in the next** N 天
（N=采纳窗口 leadDays；此运算符同时表达"在未来"与"在窗口内"，天然排除过期条目）
∧ 逐条比对不在本次下发全集。

**对每条命中执行三连**：
1. **Set List → 「归档」**（离开视野）
2. **Set Due Date → 喂固定串 `none`**（任意非日期文本即清空日期——日期没了铃就没了，
   E2 实测：这是**唯一可靠的静默消铃手段**，移列表本身不消铃）
3. **Set URL → 前缀改写** `gate-td://` → `gate-tdx://`（墓碑对一切在役查询隐形）

**复活即重生**：上游若重新吐同一 uid，去重查询（gate-td://）查不到墓碑 → 自然全新建，
Urgent 等出生属性全套齐整。不做原地救活，不需要任何特判。

## 3. 清扫仪式（人工，低频）

手动跑：Find URL contains `gate-tdx://` 全部 → Remove（**会弹一次人工确认，
这是设计的一部分**——破坏性动作留人一道闸）。可顺带清 Completion Date 早于 90 天的
已完成老条目，同一次确认。归档列表平时就是待清扫暂存区，堆着无害。

## 4. 触发器布线

- **定时 = 电平地基**：已知边界时刻 + 低频心跳（2~4 小时）。
- **门铃 = Bark active 档**（零打扰、照触发，B1 实测）：
  `收到 Bark 通知 ∧ Title contains <关键词>` → 对应指令。Automation 开、Notify 关。
  单槽忙丢（B3/B4）：门铃可能蒸发，靠网关回响推送 + 心跳兜底，手机侧无须任何处理。
- **起床钩子**：`When Any Alarm Is Stopped` → 取 **Shortcut Input** 的 Label
  判 `Gate-Fixed-` 前缀分流（勿用 Goes Off——那是响起未醒；勿在选择器绑死具体闹钟对象；
  ES 动态闹钟停止会进同一触发器，靠 Label 前缀滤掉）。
- **盲窗认知**：重启后首次解锁前动作不落地（E3），解锁后首次心跳/门铃幂等补齐，不做特殊处理。
- SyncTodos 与 SyncAlarms 分开两条指令，各自失败互不拖累。

## 5. 执行预算三规则（E1）

单轮目标 < 30 秒（预算 40~80s 的三倍余量内）；网络调用一次；
日志（Append to Note 台账）只做观测、永不承载正确性。

## 6. 预建物清单（一次性）

各源提醒事项列表（如「账单」）、「归档」列表、Bark App + 自托管 server、
门铃自动化若干（active 档）、起床钩子自动化、提醒事项"闹钟"权限（Urgent 需要）、
观测台账 Note。

## 7. 待建时自明项（唯一）

Add Reminder 的 List 参数是否吃变量（字符串→列表）：吃 = 平铺循环照契约；
不吃 = 网关按 list 分组下发、手机按列表分支写死。契约不变，仅实现分叉。
