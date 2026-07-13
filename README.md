# ios-alarm-api · Smart Schedule Gateway

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
                    规则引擎 → 设备状态 + 闹钟清单(JSON)
                                     ▼  HTTP GET
                    iPhone 快捷指令（本地执行，见 docs/PHONE.md）
              DNDTick → ApplyFocus / ApplySilent / ApplyVolume + SyncAlarms
```

- **线上**（本仓库）：无状态、可随时重算，出错有多层兜底（外部输入各自隔离 + 最外层降级网）。
- **本地**（手机）：落地的唯一执行者。**线上再好，本地错了照样出问题**——所以手机端有独立权威文档。
- **节假日判定**：抽成私有 npm 包 `workdays-core`，换数据源=发 patch，本仓库零改动。

---

## 文件结构

```
ios-alarm-api/
├── README.md                    ← 你在这（总入口 / 地图）
├── src/                         ← 网关代码（ES 模块，wrangler 打包部署）
│   ├── index.js          (658)  主 handler：鉴权→时间→拉数据→跑规则→算状态→出JSON；含【最外层兜底网】
│   ├── rules.js          (253)  规则决策引擎 R1~R6（上帝模式/底色/上课/碰撞/DND）。闹钟响错来这查
│   ├── device-state.js   (236)  设备状态引擎：命名规则 + 字段订阅（focus/silent/volume 各自独立）
│   ├── config.default.js (358)  出厂默认配置（所有开关都在这，含大量就地注释）
│   ├── config.user.js    (99)   个人配置层：纯增量，只写和默认不同的项（deepMerge 覆盖）
│   ├── config.js         (43)   配置合并器：default ← user 深合并，导出单一 CONFIG
│   ├── rest-days.js       (115)  休息日/调休/请假判定；关键字匹配
│   ├── school-break.js    (42)   寒暑春秋假区间判定
│   ├── ics-parser.js      (105)  ICS 解析（VEVENT → 标题/uid/时间/时区/全天/全字段扫描）
│   └── time-utils.js      (60)   上海时区日期/时钟、时刻换算
├── docs/                        ← 文档（见下方索引）
├── .github/workflows/
│   ├── deploy.yml               push main → 部署到 Cloudflare（带私有源 npm ci）
│   └── update-core.yml          workdays-core 发版 → 自动 bump 依赖并触发部署
├── package.json                 依赖（@OWNER/workdays-core）与脚本
├── wrangler.toml                Cloudflare Worker 部署配置
├── .dev.vars.example            本地密钥模板（复制为 .dev.vars 填真实值）
└── .gitignore                   （.dev.vars 私密日历链接，绝不提交）
```

> **占位符 `@OWNER`**：全库 6 处，部署前替换成你的 GitHub 用户名（全小写）。见 `docs/DEPLOY-CHECKLIST.md` A1。

---

## 怎么上手（按你的角色选路径）

**🧭 第一次接触这个项目（人或 AI）** → 读 `docs/ARCHITECTURE.md`（分层、解耦、闹钟可靠性模型），
再按需翻其它。**动手改之前，务必读 `docs/DEVLOG.md` §2/§3**——iOS 快捷指令的行为不符合直觉，
里面是踩过的坑，别用"常识"推断它。

**🚀 要部署上线** → 照 `docs/DEPLOY-CHECKLIST.md` 逐项勾（A 网关 → B 依赖库 → C 手机端 → D 冒烟）。

**📱 要建/改手机端快捷指令** → `docs/PHONE.md`（逐动作真实逻辑 + 流程图）。**这是手机端唯一真相源**。

**🔌 别的项目想把闹钟接进来** → 把 `docs/external-alarms.md` 发给对接方（对外协议，不含内部机制）。

**改行为速查**：开关在 `config.default.js`（个人差异写进 `config.user.js`，纯增量）；
决策逻辑看 `rules.js`（humanReadable 日志里的 `[R编号]` ↔ 代码同编号）；字段订阅看 `device-state.js`。

**测试回路**：浏览器开 `<域名>/?testDate=YYYY-MM-DD&testTime=HH:MM`（now 会互填），
看返回 JSON 的 `humanReadable` 面板 + DEEPLOG；`?testEvents=` 可注入虚拟日历事件。

---

## 文档索引

| 文档 | 内容 | 读者 |
|---|---|---|
| `README.md` | 总入口、文件结构、上手路径（本文） | 所有人 |
| `docs/ARCHITECTURE.md` | 分层、解耦、闹钟可靠性模型、线上↔本地契约、失败降级 | 你 / 未来维护者 / AI |
| `docs/PHONE.md` | **手机端权威**：逐动作真实逻辑 + 流程图 + 建法（单一真相源，按 UI 写） | 你 / 未来维护者 |
| `docs/DEVLOG.md` | 决策考古：踩过的坑、否决项（如 between）、欠账清单 | 你 / 未来 AI 会话 |
| `docs/DEPLOY-CHECKLIST.md` | 上线勾选清单（独立可跑通） | 你 |
| `docs/external-alarms.md` | 外部闹钟**对接协议**（uid/标签/时区/全天） | **乙方项目**（对外） |
| `docs/external-alarms-internal.md` | 外部闹钟内部机制、源配置、排错 | 你（对内，勿外发） |
| `docs/god-mode.md` | 上帝模式：日历接管当天的 JSON 写法与模板 | 你 |
| （`workdays-core` 的 `INTEGRATION.md`） | 节假日库接入、发版、CI 联动 | 你（运维 core 与下游） |

---

## 三个最容易踩错的点（先记住，细节看对应文档）

1. **闹钟分两类，别混**（`ARCHITECTURE.md` §4）：需自定义震动/铃声 **或 绝不能漏响（叫醒）→ 预建
   `Gate-Fixed-*`**（常驻，24h 内一次同步成功即响）；时间会变、漏了不致命 → **动态 `Gate-ES/Class/Dynamic-Event-*`**
   （最近一次同步须成功）。

2. **`only_if_current` 是设计不是 bug**（`PHONE.md` §3）：focus 的 OFF 时，**有守卫值→只在当前==该值才关；
   为空→到点清掉当前任何 focus**。字段存在就是为了让网关按需挑 focus，别当成缺陷"修掉"。

3. **快捷指令 JSON 导出不完整**（`DEVLOG.md` §2.7）：导出会漏字段（如 Set Focus 的 On/Off 标志）。
   **手机端以 UI 实际显示为准，`PHONE.md` 是文字真相源**，别只信导出。

---

## 技术栈

Cloudflare Workers（`wrangler` 部署）· ES Modules · GitHub Actions（部署 + 依赖联动）·
GitHub Packages（私有 `workdays-core`）· iOS 快捷指令（本地执行端）。数据源：家庭日历 ICS、
中国法定节假日、可选外部项目端点。全程无数据库，状态无（网关）/ 常驻手机（预建闹钟）。
