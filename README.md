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
                    iPhone 快捷指令（本地执行，见 docs/04-PHONE.md）
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
| 架构 | **V12 插件化内核**（v1 已于 2026-07-27 下线，v2 为唯一路径） |
| 测试 | `node --test` **102 用例全绿** |
| 手机端 | **待装配**——服务端契约已冻结，照 `docs/04-PHONE.md` 装配（先做 §0 列的三件） |
| 路由 | **`/v2` 前缀可选**：`/state` 与 `/v2/state` 等价（v1 下线后前缀已无区分作用） |
| 下一步 | **部署 → 装配手机端 → 真机 debug**（部署步骤见 `docs/06-OPERATIONS.md` §0） |

---

## 文件结构

```
alarm-api/
├── README.md                    ← 你在这（总入口 / 地图）
├── src/
│   ├── index.js           (24)  入口: 剥可选 /v2 前缀 → /state | /timeline | /fact
│   ├── kernel/                  ← 内核（业务语义零知识；改这里 = 你选错了层）
│   │   ├── intervals.js  (180)  区间代数: 归一化/合并/叠加/采样（零依赖，先有测试后有消费者）
│   │   ├── registry.js   (100)  插件加载 → deps 拓扑排序 → 校验 → 发布 → trace
│   │   ├── fields.js      (98)  字段订阅五旋钮渲染（USE/MAP/SKIP/OWN/APPLY）
│   │   ├── registry.js          插件加载/拓扑/校验 + feeds 自声明查询（内核零插件名）
│   │   └── audit.js       (44)  静态审计: 孤儿规则 / 悬空订阅 / 白名单一致性
│   ├── plugins/                 ← 决策层（纯函数，禁 I/O 禁读时钟）
│   │   ├── restdays.js          休息日/调休/请假/连休块
│   │   ├── presence.js          三区在场判定（work/free/leave/out）
│   │   ├── quiet.js             安静决策（v1 的 R6）
│   │   ├── school-break.js      寒暑春秋假区间
│   │   ├── god-mode.js          日历接管当天（v1 的 R1，overlay）
│   │   ├── wake-alarms.js       起床闹钟集合（v1 的 R2）
│   │   ├── weekend-class.js     周末课闹钟（v1 的 R3）
│   │   └── cadence.js           周期任务超级插件（CADENCE.TASKS 生成，含 kinds 库）
│   ├── edge/                    ← I/O 与组装（一切网络在此，插件只见纯数据）
│   │   ├── router.js     (228)  /v2 路由 + 鉴权 + 插件挂载 + 信封组装
│   │   ├── sources.js    (199)  日历/节假日/外部闹钟/事实 的拉取与解析
│   │   ├── assemble.js          字段/闹钟组装 + 守卫校验展开 + 窗口裁剪 + 布尔 token 化
│   │   └── resolve.js           token→本机标识解析表（按 ?platform= / ?locales=）
│   ├── domain/
│   │   ├── alarm-labels.js (59) ★ Gate 标签唯一构造点（语法冻结，见 KERNEL §12）
│   │   └── grammar.js     (56)  日历标题词法 → 类型化事实
│   ├── lib/time.js        (57)  时区/墙钟工具（稳定后提包）
│   ├── config.default.js         出厂默认 —— ⭐ **所有旋钮都在这**，含 V2 段
│   │                             （字段/守卫/apply/cadence；2026-07-27 从 router.js 迁入）
│   ├── config.user.js    (145)  个人配置层：纯增量，只写和默认不同的项
│   ├── config.js          (43)  合并器: default ← user 深合并
│   ├── ics-parser.js     (110)  ICS 解析（v1/v2 共用）
│   └── ics-parser.js     (110)  ICS 解析（v2 复用；v1 那批文件已全部删除）
├── test/                        node --test，102 用例
├── docs/                        文档（见下方索引）
├── .github/workflows/
│   ├── deploy.yml               push main → 部署到 Cloudflare（带私有源 npm ci）
│   └── update-core.yml          workdays-core 发版 → 自动 bump 依赖并触发部署
├── package.json                 依赖（@ivanphz/workdays-core）与脚本
├── wrangler.toml                Cloudflare Worker 部署配置
└── .gitignore                   （.dev.vars 私密日历链接，绝不提交）
```

---

## 文档

**从 [`docs/00-README.md`](docs/00-README.md) 开始** —— 那里有完整地图和当前状态。

| 我想… | 看 |
|---|---|
| 搞懂这个项目怎么运作 | [`docs/01-CONCEPTS.md`](docs/01-CONCEPTS.md) |
| **改几点做什么** | [`docs/02-RULES.md`](docs/02-RULES.md) |
| 改服务端↔手机端接口 | [`docs/03-CONTRACT.md`](docs/03-CONTRACT.md) |
| 建/改手机端快捷指令 | [`docs/04-PHONE.md`](docs/04-PHONE.md) |
| 查手机到底能做什么 | [`docs/05-FACTS.md`](docs/05-FACTS.md) ⭐ 实测台账，**不要查外部资料** |
| 部署上线 / 排错 | [`docs/06-OPERATIONS.md`](docs/06-OPERATIONS.md) |
| 知道还有什么没做 | [`docs/07-ROADMAP.md`](docs/07-ROADMAP.md) |
| **出了怪事** | [`docs/08-LESSONS.md`](docs/08-LESSONS.md) ⭐ 踩坑总账 |
| 改架构 / 查 `契约N` | [`docs/09-KERNEL.md`](docs/09-KERNEL.md) |
| 把别的项目的闹钟接进来 | [`docs/12-EXTERNAL-SOURCES.md`](docs/12-EXTERNAL-SOURCES.md)（可直接发给对接方） |
| 想拆掉某个设计 | [`docs/13-HISTORY.md`](docs/13-HISTORY.md) —— 先看当初为什么这么定 |

🤖 **接力开发的新会话（AI 或人）**：读 `docs/00-README.md` 的
「三条纪律」+「十一条不变量」，再读 `02-RULES` 和 `05-FACTS`。**先读完再动代码。**


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
