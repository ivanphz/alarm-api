# RULEBOOK.md — 规则说明书（以后怎么改，把什么交给 AI）

> 定位: KERNEL.md 是宪法（不许违反什么），BLUEPRINT.md 是施工史（当时怎么建的），
> 本文档是**操作手册**（今后想改 X → 动哪层 → 给 AI 哪些文件 → 验收标准是什么）。

---

## 1. 三十秒心智模型

```
人生事实（上班/放假/年假/长假/出差/会议/暑假/上帝模式/AI额度）
      ↓ 事实插件翻译成【事实词汇表】（§2，全系统共用，永不重复实现）
决策规则（quiet / wake_alarms / weekend_class / 将来的 silence…）
      ↓ 每条规则 = 一个插件文件，只查词汇表，产出一条 on/off/null 时间线
字段（focus / silent / media_volume / ai_available）
      ↓ 五旋钮订阅某条规则（USE/MAP/SKIP/OWN/APPLY，纯配置）
手机执行器（PHONE-V2.md）
```

改动永远问自己: 我改的是**事实**（世界是什么样）、**决策**（该做什么）、
还是**订阅**（哪个开关听哪条决策）？三层对应三种改法，成本递减。

## 2. 事实词汇表（决策规则可查询的全部谓词）

| 事实 | 谓词 | 含义 / 生活对应 |
|---|---|---|
| restdays | `workday` | 法定要上班（含调休补班，workdays-core 数据） |
| | `rest` | 实际在休息 = 法定休 或 全天请假/年假 |
| | `block` | 所在连续休息块天数 → `block >= LONG_REST_DAYS(3)` 即"三天以上特殊放假" |
| | `named_holiday` | 命名假日（国庆/春节…，非普通周末） |
| presence | `morning/noon/evening` | 三区在场: `work`上班 / `free`休 / `leave`请假碰撞 / `out`出差·会议·外勤 |
| school_break | `{key,name}\|null` | 暑假/寒假（影响起床组与课表时段） |
| god_mode | `null\|接管声明` | 当日完全手工接管 |
| ai_quota | `true/false/null` | AI 额度可用性（事实流驱动） |
| （邻日）| `P(d±1)` | 任何规则可查昨天/明天的上述一切（如"明天休→今晚 22:25"） |

你说的场景全部已在表内: 年休假→`morning==="leave"`+`rest`；三天以上→`block>=3`；
出差/会议→`out`；上班/放假→`workday`/`rest`。**新决策规则一律查表，禁止自算**（契约15）。

## 3. 变更配方表（改什么 → 动哪 → 给 AI 什么）

| 想改什么 | 动哪一层 | 给 AI 的文件 | 备注 |
|---|---|---|---|
| 改时刻常量(07:40→07:50) | config | 不需要 AI | config.default/user 的 DND + 手机白名单刺客同步改 |
| 加/改标题关键词("调休") | config | 不需要 AI | KEYWORDS.LEAVE 加词即可 |
| 字段换订阅/映射/屏蔽/策略 | 订阅(config) | 不需要 AI | V2.FIELDS 五旋钮，KERNEL §5 |
| **新独立决策规则**(如 silence) | 决策(新插件) | §4 标准包 + quiet.js 当范本 | 内核零改动，验收九条#3 |
| 改现有决策树(quiet 分支) | 决策 | §4 标准包 + quiet.js + quiet.e2e.test.js | 改逻辑必改测试 |
| 新人生事实(如"旅行中") | 事实(新插件/presence) | §4 标准包 + presence.js + grammar.js | 新词→grammar，新谓词→本表登记 |
| 闹钟集合口径 | 决策 | §4 标准包 + wake-alarms.js 或 weekend-class.js | 标签语法冻结(KERNEL §12) |
| 新周期任务(宝箱/签到) | V13 cadence | §4 标准包 + ai-quota.js 当范本 | 泛化前照 ai-quota 抄形态 |
| 新手机能力字段 | 订阅 + 手机 | V2.FIELDS + PHONE-V2.md | 手机侧新指令 |
| 改信封/端点/采样 | edge | 慎: §4 标准包 + router/assemble | 动手机契约，需灰度 |
| 想动 kernel/ 目录 | ⛔ | 先停 | 违反验收九条 = 设计错了，回本表重选层 |

## 4. 委托 AI 的标准包与开场白

**标准包（每次都给）**: `docs/KERNEL.md`（宪法）+ `docs/RULEBOOK.md`（本文）+
目标层的 1 个范本文件 + 对应测试文件。按配方表补目标文件。BLUEPRINT 通常不用给
（历史），除非涉及 ctx/值 schema 细节（其 §② §③ §④ 各有 schema 定义）。

**开场白模板（复制可用）**:
> 这是我的 alarm-api V12（Cloudflare Worker，插件化内核）。KERNEL.md 是宪法，
> 十五条契约不可违反，重点: 插件纯函数禁 I/O 禁读钟(契约7)、消费者只认规则名(契约15)、
> null 三义=无主张/压制/释放(契约2/4)、API 全 snake_case token(命名法)、
> Gate 标签语法冻结(§12)、单 owner(契约6)。事实词汇表见 RULEBOOK §2，禁止自算节假日。
> 任务: 【写清楚要什么，用 §2 的谓词描述条件】。
> 交付: 插件/配置改动 + node --test 测试（照附上的测试文件风格），
> 并自查 RULEBOOK §3 的层位与 KERNEL §15 验收九条——碰 kernel/ 即返工。

## 5. 实操示例: silent 独立（你问过的那个）

给 AI: 标准包 + `src/plugins/quiet.js`(范本) + `src/plugins/presence.js`(要消费的事实)
+ `test/plugins/quiet.e2e.test.js`(测试范本)。需求这样写（全用 §2 词汇，AI 不会跑偏）:

> 新写决策规则 silence（plugins/silence.js, name:"silence", deps: presence）:
> - 工作日(workday) 且 noon==="work": 12:15 on, 13:29 off
> - 任意日 21:30 on; rest 且 block<3: 次日 09:00 off; block>=3: 次日 09:00 释放(null)
> - morning==="out"(出差/会议): 当日 08:30 提前 off
> （↑示例，按真实需求写）
> 然后 V2.FIELDS.silent 的 USE 从 "quiet" 改 "silence"。quiet 保留（focus 还在订阅）。

AI 应交付: silence.js + silence.e2e.test.js + router.js 的 PLUGINS 挂载一行 +
FIELDS.silent 一行。**独立 quiet 不存在这个任务**——quiet 本来就是独立规则，
没有任何消费者能改动它。

## 6. 验收铁三条（任何改动完成后自查）

1. `node --test` 全绿，且新逻辑有自己的用例（含一个反例）。
2. 改动落在 §3 声明的层位，kernel/ 目录 diff 为零。
3. 新事实谓词已登记进本文 §2；新时刻已核对 DND.WHITELIST（或接受 audit warn）。
