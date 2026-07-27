# MIGRATION.md — 文档整理落库清单（GitHub 网页操作）

> 本次整理: **27 份 → 14 份现役 + 12 份归档**。
> 全部操作可在 GitHub 网页完成，无需本地环境。**建议按 §1→§5 顺序做**，
> 这样任何一步中断，仓库都处于"链接不断"的状态。
>
> **网页操作提要**
> · 新建: `Add file → Create new file`，文件名里打 `/` 会自动建目录
> · 覆盖: 打开文件 → ✏️ → 全选粘贴 → Commit
> · **改名/移动: 打开文件 → ✏️ → 直接改上方的文件名框（可含路径）→ Commit**（保留 git 历史，别用删了重建）
> · 删除: 打开文件 → 🗑
> · 目录不能单独删；里面文件删光目录自动消失

---

## §1 先建新文档（4 份全新，建完再动别的，避免中途出现死链）

| # | 操作 | 路径 |
|---|---|---|
| 1 | 新建 | `docs/OPERATIONS.md` |
| 2 | 新建 | `docs/EXTERNAL-SOURCES.md` |
| 3 | 新建 | `docs/GOD-MODE.md` |
| 4 | 新建 | `docs/TODO-CHANNEL.md` |

---

## §2 覆盖已有文档（9 份，内容全替换）

| # | 操作 | 路径 | 主要变化 |
|---|---|---|---|
| 5 | 覆盖 | `README.md` | **整体重写**（原文停留在 V11：文件结构是旧扁平布局，7 条文档链接全指向已归档文件） |
| 6 | 覆盖 | `docs/KERNEL.md` | 升 v0.7；**补入缺失的 §17.5 两类铁律**；改名表补 v0.7 批次；契约数勘误；**新增 §19 数据结构附录** |
| 7 | 覆盖 | `docs/HANDOFF.md` | **并入原 INDEX.md**（地图+路线图）；75 用例；契约数更正；补跨平台不变量第 11 条 |
| 8 | 覆盖 | `docs/DEVLOG.md` | 重构为 踩坑总账/决策考古/时间线 三段；**并入 BLUEPRINT 的裁决流水** |
| 9 | 覆盖 | `docs/RULEBOOK.md` | Gate 标签更新；上帝模式段指向 GOD-MODE.md；标准包不再要求翻施工史 |
| 10 | 覆盖 | `docs/CHANNELS.md` | Gate 标签更新；`mode`→`landing` 并注明改名理由 |
| 11 | 覆盖 | `docs/HORIZON.md` | 路线图对齐 HANDOFF §6；P0 设备抽象置顶 |
| 12 | 覆盖 | `docs/FEEDBACK-SELFHEAL.md` | 去 V13 字样；交叉引用更新 |
| 13 | 覆盖 | `docs/DEVICE-ABSTRACTION.md` | 标为 **P0 首要任务**；迁移清单里的文档名更新 |

---

## §3 改名（1 份，同时改文件名 + 内容，一次提交）

| # | 操作 | 原路径 → 新路径 |
|---|---|---|
| 14 | 改名+覆盖 | `docs/PHONE-V2.md` → **`docs/PHONE.md`** |

> 打开 `docs/PHONE-V2.md` → ✏️ → 上方文件名框改成 `PHONE.md` → 内容全选粘贴新版 → Commit。
> （v1 那份 PHONE.md 已归档为 `PHONE-v1.md`，所以不再需要 `-V2` 后缀消歧。
>  ⚠️ **先做 §4 的第 17 项**，把老的 `_archive-v1/PHONE.md` 挪走，避免同名冲突。）

---

## §4 移动到归档（11 份，纯移动，内容不动）

> 全部用"改文件名框"的方式移动，**保留 git 历史**。
> 注意新目录名是 `_archive`（不带 `-v1`），因为归档区现在不只装 v1 文档。

**v1 时代文档（6 份，从 `docs/_archive-v1/` 移出并加 `-v1` 后缀）**

| # | 原路径 → 新路径 |
|---|---|
| 15 | `docs/_archive-v1/ARCHITECTURE.md` → `docs/_archive/ARCHITECTURE-v1.md` |
| 16 | `docs/_archive-v1/god-mode.md` → `docs/_archive/god-mode-v1.md` |
| 17 | `docs/_archive-v1/PHONE.md` → `docs/_archive/PHONE-v1.md` ← **先做这条**（见 §3 提示） |
| 18 | `docs/_archive-v1/external-alarms.md` → `docs/_archive/external-alarms-v1.md` |
| 19 | `docs/_archive-v1/external-alarms-internal.md` → `docs/_archive/external-alarms-internal-v1.md` |
| 20 | `docs/_archive-v1/DEPLOY-CHECKLIST.md` → `docs/_archive/DEPLOY-CHECKLIST-v1.md` |

做完这 6 条，`docs/_archive-v1/` 目录会自动消失。

**一次性任务文档（5 份，任务已完成）**

| # | 原路径 → 新路径 | 归档理由 |
|---|---|---|
| 21 | `docs/BLUEPRINT.md` → `docs/_archive/BLUEPRINT.md` | schema 已提升进 KERNEL §19；流水已并入 DEVLOG |
| 22 | `docs/PARITY.md` → `docs/_archive/PARITY.md` | 对拍已收官（2026-07-17） |
| 23 | `docs/PHONE-FEASIBILITY.md` → `docs/_archive/PHONE-FEASIBILITY.md` | 门禁 P1–P7 全过；⚠️ 该文实测记录栏是空模板 |
| 24 | `docs/RENAME-V0.7.md` → `docs/_archive/RENAME-V0.7.md` | 服务端已完成；手机改名对照表仍被 OPERATIONS §3 C7 引用 |
| 25 | `docs/GUARDS-AND-PARITY.md` → `docs/_archive/GUARDS-AND-PARITY.md` | §1 已被 DEVICE-ABSTRACTION 取代；§2 审计表仍被 HANDOFF §2.10 引用 |

**归档区说明（新建）**

| # | 操作 | 路径 |
|---|---|---|
| 26 | 新建 | `docs/_archive/README.md` |

---

## §5 删除（6 份，内容已全部并入现役文档，零丢失）

| # | 删除 | 去向 |
|---|---|---|
| 27 | `docs/INDEX.md` | 并入 `HANDOFF.md` —— 原本与 HANDOFF 双份维护路线图，两份还都写错了契约数 |
| 28 | `docs/PROMPT-alarm-api-todo-channel.md` | 并入 `TODO-CHANNEL.md` 第一部分 |
| 29 | `docs/PROMPT-phone-synctodos.md` | 并入 `TODO-CHANNEL.md` 第二部分 |
| 30 | `docs/V12-ADDENDUM.md` | **坐标翻译已直接写进 TODO-CHANNEL.md 正文** —— 补丁文件是纯文档债，翻译完就该消失 |
| 31 | `docs/_RECREATE_NOTE.txt` | 早已失效（所述文件除 calendar-api 那份外均已入库） |
| 32 | `DEPLOY-V12.md`（**仓库根目录**） | 并入 `OPERATIONS.md` |

---

## §6 顺手项（可选，不属文档整理，但改名后这些注释会指向死文件）

**必要（4 处源码注释指向已改名的文档）**

| # | 文件:行 | 改什么 |
|---|---|---|
| 33 | `src/config.default.js:306` | `docs/external-alarms.md` → `docs/EXTERNAL-SOURCES.md` |
| 34 | `src/config.default.js:339` | `docs/god-mode.md` → `docs/GOD-MODE.md` |
| 35 | `src/config.user.js:143` | `docs/god-mode.md` → `docs/GOD-MODE.md` |
| 36 | `src/v1-legacy.js:440` | `docs/external-alarms.md` → `docs/EXTERNAL-SOURCES.md` ⚠️ **v1 冻结路径**，只改注释不碰逻辑；不想动就跳过 |

**建议（本次核对源码时查出的死代码）**

| # | 操作 | 说明 |
|---|---|---|
| 37 | 删除 `src/edge/fields.js` | 与 `src/kernel/fields.js` **内容逐字节相同**，且**无任何文件 import 它**（`assemble.js` 引的是 `../kernel/fields.js`）。删除零风险 —— 删后跑一次 `node --test` 应仍是 75 用例全绿 |

---

## §7 落库后自检（2 分钟）

1. 仓库根只剩 `README.md` 一份 md（`DEPLOY-V12.md` 已删）。
2. `docs/` 下 14 份现役 md + `_archive/` 一个目录（12 份）。
3. `docs/_archive-v1/` 已消失。
4. 打开 `README.md`，逐条点文档索引里的链接，应全部可达。
5. 若做了第 37 项：Actions 跑一次 `node --test` → **75 用例全绿**。

---

## 附：整理后的文档地图

```
README.md                          总入口（面向人）
docs/
├── HANDOFF.md                     ⭐ 接力开发入口（防偏移契约 + 地图 + 路线图）
│
├── KERNEL.md                      宪法: 15契约 · 两类铁律 · 命名法 · 术语表 · 数据结构
├── RULEBOOK.md                    改法手册: 事实词汇表 · 变更配方 · 委托模板
├── PHONE.md                       手机端唯一真相源: 逐动作脚本 · 铁则 · 坑表
├── CHANNELS.md                    iPhone 打断/提醒/触发能力总册 + 实测台账
│
├── OPERATIONS.md                  部署 · 密钥 · KV · 冒烟 · 排错 · 交付纪律
├── EXTERNAL-SOURCES.md            外部闹钟源: §A 对接协议(可外发) / §B 内部机制
├── GOD-MODE.md                    上帝模式: 触发 · JSON 模板 · 验证
│
├── DEVICE-ABSTRACTION.md          ⬅ P0 下一步主任务
├── TODO-CHANNEL.md                todo 通道 + Bark（服务端 + 手机端完整契约）
├── FEEDBACK-SELFHEAL.md           回传 + 闹钟对账自愈（三阶段）
├── HORIZON.md                     远期方向账本
│
├── DEVLOG.md                      踩坑总账 · 决策考古 · 版本时间线
└── _archive/                      12 份（含 README.md 说明每份为何在此、结论去哪了）
```
