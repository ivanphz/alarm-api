# alarm-api · Smart Schedule Gateway

一个 **Cloudflare Worker 网关**：根据日历、请假、法定节假日/调休、外部项目数据，算出"此刻家里各设备
（勿扰/静音/媒体音量/闹钟）应该是什么状态"，输出 JSON；iPhone 上的一组**快捷指令**定时来拉、照着执行。

> **网关只出结论、不碰手机；手机只执行、不做判断。** 两侧靠 JSON 契约通信，各自可独立升级。

---

## 60 秒理解

```
 [家庭日历 / 请假 / 上帝模式]   [外部项目: 还款/签到...]   [workdays-core: 节假日]
            └────────────────────────┬────────────────────────┘
                                     ▼
                    Cloudflare Worker（本仓库 src/）
        插件产出命名规则 → 内核合并采样 → 设备字段 + 闹钟清单(JSON)
                                     ▼  HTTP GET
                    iPhone 快捷指令（本地执行，见 docs/PHONE.md）
        ApplySilent / ApplyFocus / ApplyVolume + SyncAlarms + 边界刺客
```

- **线上**（本仓库）：无状态、可随时重算，出错有多层兜底（外部输入各自隔离 + 最外层降级网）。
- **本地**（手机）：落地的唯一执行者。**线上再好，本地错了照样出问题**——手机端有独立权威文档。
- **节假日判定**：抽成私有 npm 包 `workdays-core`，换数据源=发 patch，本仓库零改动。

**三层生态**: `workdays-core`（事实）→ `calendar-api`（决策，另一仓库）→ **`alarm-api`（执行，本仓库）**。

---

## 当前状态（2026-07）

| 项 | 状态 |
|---|---|
| 架构 | **V12 插件化内核**，双轨: `/v1` 冻结（只修 bug）· `/v2` 现役 |
| 测试 | `node --test` **75 用例全绿** |
| 手机端 | ApplyState 灰度中（v3.0 独立模块架构，见 `docs/PHONE.md`） |
| 默认路由 | 仍指 v1（`config.user.js` 设 `V2:{DEFAULT:true}` 后翻转） |
| 下一步 | **设备抽象层重构**（`docs/DEVICE-ABSTRACTION.md`，设计已定稿待实施） |

---

## 文件结构

```
alarm-api/
├── README.md                    ← 你在这（总入口 / 地图）
├── src/
│   ├── index.js           (41)  双轨入口: /v1 剥前缀转 legacy · /v2 转 router
│   ├── kernel/                  ← 内核（业务语义零知识；改这里 = 你选错了层）
│   │   ├── intervals.js  (180)  区间代数: 归一化/合并/叠加/采样（零依赖，先有测试后有消费者）
│   │   ├── registry.js   (100)  插件加载 → deps 拓扑排序 → 校验 → 发布 → trace
│   │   ├── fields.js      (98)  字段订阅五旋钮渲染（USE/MAP/SKIP/OWN/APPLY）
│   │   └── audit.js       (44)  静态审计: 孤儿规则 / 悬空订阅 / 白名单一致性
│   ├── plugins/                 ← 决策层（纯函数，禁 I/O 禁读时钟）
│   │   ├── restdays.js          休息日/调休/请假/连休块
│   │   ├── presence.js          三区在场判定（work/free/leave/out）
│   │   ├── quiet.js             安静决策（v1 的 R6）
│   │   ├── school-break.js      寒暑春秋假区间
│   │   ├── god-mode.js          日历接管当天（v1 的 R1，overlay）
│   │   ├── wake-alarms.js       起床闹钟集合（v1 的 R2）
│   │   ├── weekend-class.js     周末课闹钟（v1 的 R3）
│   │   └── ai-quota{,-reminder}.js  cadence 首个任务（冷却 + 派生提醒）
│   ├── edge/                    ← I/O 与组装（一切网络在此，插件只见纯数据）
│   │   ├── router.js     (228)  /v2 路由 + 鉴权 + 插件挂载 + 信封组装
│   │   ├── sources.js    (199)  日历/节假日/外部闹钟/事实 的拉取与解析
│   │   ├── assemble.js   (225)  字段/闹钟组装 + 守卫校验归一化 + 窗口裁剪
│   │   └── i18n.js        (53)  Focus 本机名映射下发（按 ?locales=）
│   ├── domain/
│   │   ├── alarm-labels.js (59) ★ Gate 标签唯一构造点（语法冻结，见 KERNEL §12）
│   │   └── grammar.js     (56)  日历标题词法 → 类型化事实
│   ├── lib/time.js        (57)  时区/墙钟工具（稳定后提包）
│   ├── config.default.js (382)  出厂默认（所有开关都在这，含大量就地注释）
│   ├── config.user.js    (145)  个人配置层：纯增量，只写和默认不同的项
│   ├── config.js          (43)  合并器: default ← user 深合并
│   ├── ics-parser.js     (110)  ICS 解析（v1/v2 共用）
│   └── v1-legacy.js + rules.js + rest-days.js + device-state.js + school-break.js
│                                ⚠️ /v1 冻结路径，五个文件缺一构建失败（KERNEL §11）
├── test/                        node --test，75 用例
├── docs/                        文档（见下方索引）
├── .github/workflows/
│   ├── deploy.yml               push main → 部署到 Cloudflare（带私有源 npm ci）
│   └── update-core.yml          workdays-core 发版 → 自动 bump 依赖并触发部署
├── package.json                 依赖（@ivanphz/workdays-core）与脚本
├── wrangler.toml                Cloudflare Worker 部署配置
└── .gitignore                   （.dev.vars 私密日历链接，绝不提交）
```

---

## 怎么上手（按你的角色选路径）

| 你是 | 从哪开始 |
|---|---|
| 🤖 **接力开发的新会话（AI 或人）** | **`docs/HANDOFF.md`** —— 强制阅读顺序 + 不变量 + 落点速查 + 路线图。**先读完再动任何代码。** |
| 🧭 想搞懂架构 | `docs/KERNEL.md`（宪法: 十五条契约、命名法、术语表、数据结构附录） |
| 🔧 想改行为 | `docs/RULEBOOK.md`（改什么 → 动哪层 → 给 AI 哪些文件 → 验收标准） |
| 📱 要建/改手机端快捷指令 | `docs/PHONE.md`（逐动作脚本，**手机端唯一真相源**） |
| 🚀 要部署上线 | `docs/OPERATIONS.md`（密钥、KV、冒烟、排错、交付纪律） |
| 🔌 别的项目想把闹钟接进来 | 把 `docs/EXTERNAL-SOURCES.md` **第一部分**发给对接方 |
| 🕹 想手工接管某一天 | `docs/GOD-MODE.md` |

**改行为速查**: 开关在 `config.default.js`（个人差异写进 `config.user.js`，纯增量）；
决策逻辑在 `src/plugins/<规则名>.js`；字段订阅在 `router.js` 的 `V2_DEFAULTS.FIELDS`。

**测试回路**: `<域名>/v2/timeline?key=…&date=YYYY-MM-DD&now=HH:MM` 看内脏
（schedules + field_timelines + 结构化 trace）；`?testEvents=` 可注入虚拟日历事件。

---

## 文档索引

**契约层**（改之前必读）
| 文档 | 内容 |
|---|---|
| `docs/KERNEL.md` | 宪法: 十五条契约、命名法、两类铁律、术语表、数据结构附录 |
| `docs/RULEBOOK.md` | 操作手册: 事实词汇表 + 变更配方表 + 委托 AI 模板 |
| `docs/PHONE.md` | 手机端权威: 逐动作脚本 + 铁则 + 坑表 |
| `docs/CHANNELS.md` | iPhone 打断/提醒/触发能力总册（新"想被提醒"需求先查此表） |

**接口与运维**
| 文档 | 内容 | 读者 |
|---|---|---|
| `docs/OPERATIONS.md` | 部署、密钥、KV、冒烟、排错、交付纪律 | 你 |
| `docs/EXTERNAL-SOURCES.md` | 外部闹钟源: §A 对接协议（可外发）/ §B 内部机制 | 乙方 / 你 |
| `docs/GOD-MODE.md` | 上帝模式: 触发条件 + JSON 模板 + 排错 | 你 |

**待做（设计已定稿）**
| 文档 | 内容 |
|---|---|
| `docs/DEVICE-ABSTRACTION.md` | ⬅ **下一步主任务**: 语义 token + resolve 解析表，跨平台前提 |
| `docs/TODO-CHANNEL.md` | todo 执行通道 + Bark 推送通道（服务端 + 手机端完整契约） |
| `docs/FEEDBACK-SELFHEAL.md` | 手机回传 + 闹钟对账自愈（三阶段，接口形状已冻结） |
| `docs/HORIZON.md` | 远期方向账本: 可视化/网页配置/多设备/格式嗅探（只钉形状不写码） |

**交接与历史**
| 文档 | 内容 |
|---|---|
| `docs/HANDOFF.md` | ⭐ 接力开发防偏移契约 + 路线图 + 落点速查 |
| `docs/DEVLOG.md` | 踩坑总账（iOS/Worker）+ 决策考古 + 版本时间线 |
| `docs/_archive/` | 已完成的一次性文档与 v1 时代文档（有效结论已迁出，仅供考古） |

---

## 三个最容易踩错的点（先记住，细节看对应文档）

1. **闹钟分两类，别混**（`KERNEL.md` §12）：需自定义震动/铃声 **或 绝不能漏响（叫醒）→ 预建
   `GateFix-*`**（常驻，网关只开关、从不碰时间）；时间会变、漏了不致命 → 动态 `GateDyn-*`
   （时间编进标签，改时间=关旧建新）。**标签语法冻结，改一字 = 全家设备重录。**

2. **守卫拦截时不落账**（`PHONE.md` 铁则3）：守卫不满足 → 跳过该字段且**不更新 last_applied**，
   下轮重判。enforce 只压"无变化跳过"，不压守卫拦截。守卫的意义是保护手动操作，
   落了账就等于把手动操作吃掉了。

3. **快捷指令 JSON 导出不完整**（`DEVLOG.md` §1.7）：导出会漏字段（如 Set Focus 的 On/Off 标志）。
   **手机端以 UI 实际显示为准，`PHONE.md` 是文字真相源**，别只信导出。

---

## 技术栈

Cloudflare Workers（`wrangler` 部署）· ES Modules · GitHub Actions（部署 + 依赖联动）·
GitHub Packages（私有 `@ivanphz/workdays-core`）· Cloudflare KV（事实流）· iOS 快捷指令（执行端）。
数据源：家庭日历 ICS、中国法定节假日、可选外部项目端点。无数据库；网关无状态，实况常驻手机。
