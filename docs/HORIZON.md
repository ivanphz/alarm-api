# HORIZON.md — 远期方向与预留账本（很远，但现在定形状防返工）

> 本文管"三年后可能做"的事。原则同 KERNEL 预留哲学: **只钉接口形状与不变量，不写实现。**
> 每条注明"已铺哪些路"(现有设计天然支持的部分) 与 "到时才做什么"(实施时填的肉)。
> 现在读它的唯一目的: 今天的每个设计决定不要**堵死**这些方向。

---

## 1. 网页端配置规则（取代手改 config）

**愿景**: 规则不再手写 JS/config，而是网页拖拽/表单生成 → 存后端 → 网关加载。

**已铺的路**:
- 插件本就是纯对象 `{name, deps, produce}` —— 工厂可批量从数据生成插件，内核零改。
- 时间线是 `(inputs, config)` 纯函数 —— 配置来自文件还是 KV 还是网页，产物一致、可预览。
- config 深合并链已存在 —— 网页配置只是合并链上再加一层 `web-config`。
- RULEBOOK 已定义"事实词汇表" —— 网页 UI 的条件下拉就是对这张表的可视化。

**到时才做**:
- 规则 DSL(声明式条件→emit)，一个解释器插件把 DSL 实例化成普通插件对象。
- 配置存 KV(`config:<device>:*`) + 读写端点 + audit 违宪校验(token合法/单owner/白名单)。
- **红线(现在就定)**: DSL 不追求图灵完备，覆盖八成场景，剩两成保留"写代码插件"逃生门，
  否则解释器长成第二个内核。事实层(碰撞/块扫描/god解析)永远是代码，UI 只组合事实之上的决策。

**不堵死的纪律**: 今天任何新规则逻辑，能表达成"查事实词汇表 + 产 on/off/null 边界"的，
就别写成只有代码能表达的怪逻辑 —— 保持决策层可被 DSL 描述。

## 2. 可视化（只读，先于配置能力）

**愿景**: 甘特轨道图显示各字段/闹钟时间线 + "为什么是这个值"归因。

**已铺的路**: `/v2/timeline` 已全量吐 schedules + field_timelines + 结构化 trace(带插件名/
规则编号)。前端拿它直接画，后端唯一改动 = 加 CORS 头。

**到时才做**: Pages 纯前端(otc-rate-suite 套路)，读 timeline 画图、读 /v2/facts 显示事实流、
写 /v2/fact 做纠偏控制台。**对内核零侵入**(纯消费现有端点)。

## 3. 多设备（profile，非租户）

**已铺的路**: `?device=` 参数三阶段全程带; KV 命名空间 `fact:<device>:*` 已就绪;
config 深合并支持 `PROFILES.<device>` 分层; 插件 `scope: per-device | shared` 已声明;
闹钟标签天然按设备隔离(各手机对账自己的 GateFix/GateDyn 集)。

**到时才做**: config 加 `PROFILES.<device>` 一节(每设备 FIELDS 订阅/OWN/启用哪些插件/
订哪些日历源); 内核按请求 device 惰性构建时间线。**加设备 = 加配置一节 + 手机跑一遍装配，
零代码。** 跨设备联动(A写shared事实→B插件订阅)已被 facts+scope 机制覆盖，无需新机制。

**不堵死的纪律**: 任何新端点从第一天带 `?device=`; 任何 KV 键带 `<device>` 段;
per-device 数据绝不进他设备的 ctx 与 trace(含隐私)。

## 4. 多用户（远于多设备，非当前目标）

**已铺的路**: device 维度已是"多主体"的雏形; 无状态云端 + 本地权威使"每主体各算各"天然成立。

**到时才做（若真需要）**: device 之上加 user 维度(`fact:<user>:<device>:*`); 但**明确不做**
用户表/权限系统/多租户隔离 —— 那是产品化的事，单人+家庭用 device+scope 足够。
维持"配置维度而非租户"的定性。

## 5. 外部接口最大兼容（格式识别器）—— 见 §7 外部源统一

**愿景**: 别人丢一个 URL，网关自己认它是 json 还是 ics，不要求声明 type。

**已铺的路**: 外部日历已容忍逗号/分号/空格/换行/JSON数组多种分隔(parseUrlList);
外部闹钟已有 json/ics 两条解析路径。

**到时才做**: 
- **格式嗅探器**: 拉到内容后 —— 试 `JSON.parse` 成功→json; 失败且含 `BEGIN:VCALENDAR`→ics;
  再失败→报错记 trace。type 字段从"必填"降为"可选覆盖"(嗅探不准时手动指定)。
- 统一到所有外部源(闹钟/todo/未来的日历事件源)，一个 `sniffFormat()` 全线复用。
- **不变量**: 嗅探失败绝不猜、绝不静默 —— 报响亮错误(同治理哲学)。

---

## 6. 术语歧义总清扫（你指出改得不够 —— 这批全改，属未来 todo）

> 现在不改代码(避免打断灰度)，但**方向定死**: 下次动外部源/todo 通道时一并改名。

| 现状(有歧义) | 改为 | 理由 |
|---|---|---|
| **`todo` 一词指三样东西(核心歧义)** | 见下方"todo 三层定义"分别命名 | 聊天说"做todo"分不清指方向/通道/字段; 且todo↔reminder贴太近 |
| `reminder`/reminders 在服务端出现 | 服务端一律 `todo`; `reminder` 只存在于手机端文档(落地成"提醒事项") | 平台中性铁律: 网关不说 iPhone 概念 |
| `EXTERNAL_ALARMS`(config/env) | `EXTERNAL_ALARM_SOURCES` 或纳入统一 `EXTERNAL_SOURCES.alarm` | 与未来 todo 源/日历源统一为"外部源"家族 |
| `Gate-ES`(外部源闹钟) | 已改 `GateDyn-ES`; ES 语义"external source"保留 | v0.7 已做 |
| 外部源 `type: 'ics'|'json'` 必填 | 降为可选(嗅探优先，见 §5) | 最大兼容 |
| todo 提示词 `mode` | 已定 `landing` | v0.7 附录已定 |
| `switch_to`(focus, 未实装) | 保留但文档标注"未实装，非null执行器忽略不报错" | 已在术语表 |
| `severity` vs `landing` vs 分级 token | severity=域声明重要度(high/normal/low/critical); landing=落地形态(urgent/alert/silent); 二者不同层，映射在网关源配置 | 明确两者非同义 |

### todo 三层定义（钉死，聊天与代码都按此）

| 层 | 唯一术语 | 定义 | 出现在 |
|---|---|---|---|
| 开发方向/里程碑 | **"todo 通道"** 或 **"提醒事项能力"**（禁止单说 todo） | 一整块开发工作(接入提醒事项) | 聊天、路线图、DEVLOG |
| 网关侧通道/字段 | **`todo` / `todos`** | 与 alarm 平级的输出通道，产出**平台中性**条目 | 服务端代码、/v2 信封 |
| 手机侧落地物 | **reminder / 提醒事项** | iPhone Reminders App 的实体 | 手机端文档、快捷指令 |

**边界翻译铁律**: `todo` 与 `reminder` 是**同一件事在边界两侧的两个名字**。
过"网关↔手机"边界，词必须换 —— 网关永远说 todo(它不知道iPhone)，手机永远说 reminder
(它在操作那个App)。翻译发生在 SyncTodos 指令里(读信封 todos → 落地成 reminder)，
与 focus 的 preset→Set Focus 同构。**聊天中一律说"todo 通道"，不单说 todo。**

**歧义防复发机制(纳入 KERNEL §18 纲领)**: 任何跨"网关/手机"边界的词，必须能回答
"它属于哪一侧概念"——网关侧禁用一切 iPhone 词汇(列表/urgent/alert/归档/提醒事项)，
这些只在手机端文档出现。新增字段前问一句"这词在对话里会不会指两个东西"。

---

## 6.5 多 focus preset（睡眠/工作模式，手机已备开启分支）

现状: quiet 规则只产 on/off，focus 字段 PRESET 恒 do_not_disturb。手机 §3.2 F52+ 已
预留多 preset 开启分支(关闭 Turn Off 通杀天然支持)。
到时才做(服务端): 让某规则产出带 preset 的 focus 值——两条路:
① 新决策规则(如 sleep-mode.js)产出 focus 值 `{preset:"sleep", action:"on"}`，字段 OWN 或
   独立 focus 字段订阅它; ② 或 MAP 把规则 token 映射到不同 preset。
手机侧零改(F52+ 已备); 只是服务端多一条规则/配置。**不堵死**: focus 值的 preset 字段
已是自由 token, 产什么挡位都行。

## 7. 外部源统一家族（把闹钟/todo/日历源收敛成一个心智模型）

**远期形状**(现在别做，但按此方向别堵死):
```
EXTERNAL_SOURCES: [
  { name, url, kind: 'alarm'|'todo'|'calendar',   // kind=业务类型
    format: 'auto'|'json'|'ics',                   // auto=嗅探(§5), 默认 auto
    code, leadDays?, severityMap?, ... }           // 类型专属字段
]
```
- 一个拉取器 + 一个嗅探器 + 按 kind 分派处理，取代现在闹钟源/todo源各写一套。
- **已铺的路**: 闹钟源与(未来)todo源的 sources→assemble 分工已同构; 收敛只是提取公共壳。
- **到时才做**: 重构三类源到统一登记表; 老 EXTERNAL_ALARMS 迁移(带兼容期或一次切)。

---

## 8. 这些方向的共同不变量（今天就守，别哪天违反）

1. 云端无状态(除 KV 事实/聚合); 本地/手机是实况最终权威。
2. 时间线是纯函数 —— 配置来源无论演化成什么(文件/KV/网页)，可预览可测不变。
3. 消费者只认规则名，规则不属于任何消费者(契约15) —— 可视化/DSL 都不许打破。
4. 网关侧零 iPhone 概念 —— 多设备/多用户/网页配置都不改这条。
5. 外部输入嗅探优先、失败响亮报错、绝不猜。
6. 预留只留形状不留功能; 每个"到时才做"都是往既定接口填肉，非重构。

---

## 9. 实施优先级中的位置（相对 INDEX P1–P8）
```
近: P1 todo通道 → P2 Bark → P-观测/建议/自愈(FEEDBACK-SELFHEAL) → P4 cadence
中: 格式嗅探器(§5, 随 todo 源一起做最省) → 术语清扫(§6, 随外部源改名一起)
远: P6 可视化(只读) → 网页配置DSL(§1) → PROFILES多设备(P8)
极远: 多用户(§4, 可能永不做)
```
