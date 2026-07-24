# _archive/ — 归档区

> **这里的东西都不再维护**。放进来的判据只有两条：
> ① 它描述的是 v1 时代、已被 v2 文档取代的机制；
> ② 它是一次性任务（迁移清单/对拍手册/门禁模板），任务已完成。
>
> **凡是仍在跑的功能，文档就不该在这里** —— 那是重构对象，不是归档对象。
> （本次整理把外部闹钟、上帝模式两份"现役功能被误归档"的文档移了回去。）
>
> 每份都注明**有效结论去哪了**，这样考古时不必通读。

---

## v1 时代文档（已被 v2 取代）

| 文件 | 取代者 | 有效结论去向 |
|---|---|---|
| `ARCHITECTURE-v1.md` | `KERNEL.md` | 分层/解耦/闹钟可靠性模型 → KERNEL §0/§1/§12；README 已重写 |
| `PHONE-v1.md` | `PHONE.md` | ⚠️ **仍有考古价值**：它是"Set Focus 吃文本变量"的实证来源（DEVLOG §1.9 据此翻案）。能力对等审计的基线也是它 |
| `god-mode-v1.md` | **`GOD-MODE.md`**（现役） | 全部内容已翻译到 v2 坐标（GateFix/GateDyn 标签、v2 JSON 词汇、trace 排错） |
| `external-alarms-v1.md` | **`EXTERNAL-SOURCES.md` §A** | 对接协议原样保留（协议本身几乎没变），只更新了自检入口 |
| `external-alarms-internal-v1.md` | **`EXTERNAL-SOURCES.md` §B** | 配置路径 `config.SOURCES`→`EXTERNAL_ALARMS.SOURCES`、标签 `Gate-ES-`→`GateDyn-ES-`、排错从 humanReadable 改结构化 trace |
| `DEPLOY-CHECKLIST-v1.md` | `OPERATIONS.md` | CF/GitHub 密钥配置、依赖联动、冒烟项全部迁入并更新到 v2 |

## 一次性任务文档（任务已完成）

| 文件 | 任务 | 状态 / 有效结论去向 |
|---|---|---|
| `BLUEPRINT.md` | V12 分步施工图 | 各步骤钉死的 **schema 已提升为 `KERNEL.md` §19 数据结构附录**（那是契约不是历史）；裁决流水已并入 `DEVLOG.md` §3/§4 |
| `PARITY.md` | v1↔v2 对拍手册 | **对拍已收官**（2026-07-17）。判例已进 DEVLOG §2.3；取数口径"必带 `now=00:00`"这条常识已进 OPERATIONS §5.1 |
| `PHONE-FEASIBILITY.md` | V12 前置能力门禁 | **P1–P7 全过**（2026-07-16）。⚠️ 注意本文的「实测记录」栏**从未回填**，是空模板；真正的实测结果在 `KERNEL.md` §7 的冻结表与 `CHANNELS.md` §6 台账 |
| `RENAME-V0.7.md` | v0.7 改名迁移清单 | 服务端已完成（代码里全是 GateFix-/GateDyn-）。**手机端预建闹钟改名对照表仍有用** → OPERATIONS §3 C7 指向本文 |
| `GUARDS-AND-PARITY.md` | 守卫泛化设计 + v1→v2 能力对等审计 | §1 守卫结构**已被 `DEVICE-ABSTRACTION.md` 取代**（该文自己头部就声明了）；§3 多语言已定案并落 PHONE.md；⚠️ **§2 能力对等审计表仍有价值** —— HANDOFF §2 第 10 条引用它作为"大版本迁移必做清点"的范例 |

---

## 本次整理删除（未归档）的文件

以下文件已合并进现役文档，**内容零丢失**，故直接删除而非归档：

| 原文件 | 去向 |
|---|---|
| `INDEX.md` | 并入 `HANDOFF.md`（文档地图 + 路线图）—— 原本与 HANDOFF 双份维护，且两份都写错了契约数 |
| `PROMPT-alarm-api-todo-channel.md` | 并入 `TODO-CHANNEL.md` 第一部分（服务端） |
| `PROMPT-phone-synctodos.md` | 并入 `TODO-CHANNEL.md` 第二部分（手机端） |
| `V12-ADDENDUM.md` | **坐标翻译已直接应用到 `TODO-CHANNEL.md` 正文** —— 补丁文件是纯文档债，翻译完就该消失 |
| `DEPLOY-V12.md`（仓库根） | 并入 `OPERATIONS.md` |
| `_RECREATE_NOTE.txt` | 早已失效（所述四份文件除 calendar-api 那份外均已入库） |
| `PHONE-V2.md` | 改名为 `PHONE.md`（v1 那份已归档，不再需要 -V2 后缀消歧） |
