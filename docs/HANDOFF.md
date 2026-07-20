# HANDOFF.md — 换对话接力开发的防偏移契约（todo 通道 / cadence 优先）

> **读者**: 接手 alarm-api 后续开发的新会话(可能是别的 AI)。你没有此前对话的记忆，
> 只有本仓库文档。**本文是你的行为契约与阅读顺序，先读完再动任何代码。**
> 违反本文任一条 = 偏移。偏移的代价见每条括注。

---

## 0. 三十秒定位

alarm-api 已完成 V12 插件化重构(双轨: /v1 冻结、/v2 现役，72 用例全绿)。
你接手的是**在 /v2 上新增能力**，不是改架构。三层生态:
workdays-core(事实) → **calendar-api**(决策，另一仓库) → **alarm-api**(执行，本仓库)。

## 1. 强制阅读顺序（跳读 = 偏移，后果: 重复已废弃的方案）

```
1. docs/INDEX.md          ← 文档地图 + P1–P8 路线图，找到你的任务在第几步
2. docs/KERNEL.md         ← 宪法。重点: §17.5 两类铁律、十六契约、§18 术语表(含边界双名制)
3. docs/RULEBOOK.md       ← 改规则/加插件/加字段的配方 + 事实词汇表 + 委托模板
4. 你的任务专属文档(见 §3)
5. docs/BLUEPRINT.md      ← 只在需要某 schema 精确定义时查(施工史，不必通读)
```

## 2. 不可违反的不变量（KERNEL 契约的浓缩，违反即架构损伤）

1. **/v1 冻结**: `src/v1-legacy.js` 及其依赖只修 bug，绝不加功能。新能力**只进 /v2**。
   (违反: 把新字段加进冻结轨道，将来 v1 下线时连累新功能)
2. **插件纯函数**: `produce(ctx, range)` 禁读时钟(`Date.now()`)、禁 I/O(`fetch`)。
   所有 I/O 在 edge 层，now 只在采样端。(违反: golden 测试失效、`?date=` 预览崩)
3. **消费者只认规则名**(契约15): 字段/下游插件只订阅 schedule 名，不碰生产者内部，
   不看其他字段的值。想"看别人的值"→ 升格为命名规则让双方订阅。
   (违反: 删一个模块炸另一个，回到 V11 耦合地狱)
4. **token 唯一权威**: API 全小写 snake_case token; 显示名/本地化永不参与比较、不入 LA。
   (违反: 换语言全字段重放、比较随 iOS 版本漂移)
5. **单一 owner**(契约6): 每个 schedule 一个 owner 插件，同 owner 区间不重叠。
6. **回传是事实非实况**(§17.5): 手机回传可作"已发生事件"进 KV，绝不作"决策依据"。
   云端 diff 永远 advisory，本地是最终裁判。(违反: KV 最终一致致控制回路震荡)
7. **Gate 标签冻结**(§12, v0.7): `GateFix-`/`GateDyn-` 两族，后段全称。演进只许加
   `GateDyn-<新族>-`，既有格式动一字 = 全设备重录。构造唯一入口 domain/alarm-labels.js。
8. **网关零 iPhone 概念**: 服务端禁用 列表/urgent/alert/归档/提醒事项 等词。
   见 §18 边界双名制: 网关 `todo` ⇄ 手机 `reminder`。
9. **验收九条**: 任何改动完成，`node --test` 全绿 + 新逻辑有用例(含反例) +
   kernel/ 目录 diff 为零。碰 kernel/ = 你选错了层，回 RULEBOOK 重选。
10. **大版本迁移必做能力对等清点**: 迁移(如 v2→v3)前逐条核对旧版能力文档，
    不能只搬"当前配置用到的部分"(教训: v1→v2 曾丢 Set Focus 变量机制与守卫完整能力，
    见 docs/GUARDS-AND-PARITY.md §2)。审计表模板在该文档。

## 3. 两个优先任务的专属契约

### 3.A todo 通道（P1）—— 读 PROMPT-alarm-api-todo-channel.md + **必配 V12-ADDENDUM.md**
- ⚠️ 那份提示词是 **v1 坐标系**写的。**坐标翻译强制走 V12-ADDENDUM.md**:
  `sync_todos_flag`→`reconcile_todos`; humanReadable→结构化 trace; todo条目`mode`→`landing`;
  真相源换 KERNEL/RULEBOOK/PHONE-V2; 落点是 /v2 信封 `todos` 节(与 alarms 节并列)。
- **术语**(HORIZON §6 三层定义): 网关侧代码/信封说 `todo`; 手机侧文档说 reminder;
  聊天说"todo 通道"。**严禁在服务端代码出现 reminder/提醒事项字样。**
- 落点: `edge/sources.js` 加 loadTodoSources(I/O) + `edge/assemble.js` 加 assembleTodos
  (窗口/severity→landing 映射) + `domain/alarm-labels.js` 加 tdMarker()。**不进插件**。
- 手机侧: 新建独立 SyncTodos 指令(PROMPT-phone-synctodos.md)，遵 PHONE-V2 铁则四条
  (文本比较/标记判空/守卫不落账/八名封顶)。**不回插 ApplyState。**
- 外部 todo 源: type 首选嗅探(HORIZON §5)，但首批可先要求声明 json/ics，嗅探留后。

### 3.B cadence（P4）—— 读 KERNEL §10(cadence 设计) + BLUEPRINT 步骤⑤(ai_quota 范本)
- **cadence 是通用周期任务插件; ai_quota 是它的第一个特例(已实现)，命名已归位:**
  字段 `fields.cadence.<task>.*`、标签族 `GateDyn-CAD-*`、`cadenceLabel()`。
- 泛化 = 把 ai-quota.js 的区间构造(冷却/周重置/纠偏事实)抽成 **kinds 库**
  (`rolling_cooldown` | `weekly_reset` | `ladder` | …)，任务变**纯配置** `CADENCE.TASKS`。
- 每任务声明 `channel`: `alarm`(走 GateDyn 闹钟) | `todo`(走 todos 节，需先做 3.A) |
  `notification`(走 Bark/通知)。channel=todo 时**产物汇入 todos 节**，与自愈/calendar 并集。
- 管理操作(重置/手动改期) = 往事实流写纠偏事件(`reset`/`set_next`)，**不加新端点**(契约14)。
- **真嵌套字段**(`fields.cadence.<task>.available`)需改 fields 渲染核心(现是扁平字符串键
  `"cadence.ai_claude"`)。这是 cadence 泛化的一部分，此时才做，别在别处顺手改 fields.js。

## 4. 每个任务的服务端落点速查（别放错层）

| 要加什么 | 放哪 | 禁止放哪 |
|---|---|---|
| 外部数据拉取/解析 | edge/sources.js | 插件(纯度红线) |
| 时区换算/窗口/severity映射/标签构造 | edge/assemble.js + domain/alarm-labels.js | 插件 |
| 新决策规则(内生的) | src/plugins/新文件 | kernel/ |
| 新事实(内生的) | src/plugins/新文件 或 presence 扩展 | edge |
| diff/漂移/推送 | edge/reconcile.js(新) + edge/push.js(新) | 插件 |
| 新配置 | config.default.js(零配置值) + config.user.js(用户领地) | 硬编码进 src |
| 信封新字段 | edge/assemble.js 组装 | kernel/ |

## 5. 交付纪律（同既往）

- 只交付新增/修改的**单个文件**，不打包(除非明确要整包)。
- 每个改动配 node --test 用例(含一个反例)。
- 改线上契约(信封/端点)必同步更新 PHONE-V2.md 与相关文档。
- 新术语/新字段先查 KERNEL §18，查无先补表 —— 尤其过边界的词走双名制。
- 完成后自查 §2 九条不变量 + RULEBOOK 验收九条。

## 6. 疑似要改架构时（停）

如果你发现任务"必须"改 kernel/、必须破契约、必须动 Gate 标签语法、必须让插件读时钟或
让服务端存实况 —— **停下来，先问 Ivan**。90% 情况是选错了层(回 §4 重选)或误解了需求。
真需要破契约的，是架构决策，不是实施细节，必须 Ivan 拍板并记入 KERNEL/DEVLOG。

---

## 附: 当前状态锚点（交接时点）
- KERNEL v0.7 / 72 用例全绿 / v2 未正式切默认(手机灰度中，ApplyState 拼装阶段)
- 已实现: 全部决策插件 + 字段 + 闹钟 + ai_quota(cadence 特例) + i18n下发 + /v2/fact
- 方向已定稿未实施: todo通道(P1)、Bark(P2)、回传自愈(P3,FEEDBACK-SELFHEAL.md)、
  cadence泛化(P4)、可视化/网页配置/多设备(HORIZON.md)、格式嗅探/术语清扫(HORIZON§5-6)
- 待你补入仓库的对话产出文档: CHANNELS.md、三份 PROMPT-*(见 docs/_RECREATE_NOTE.txt)
