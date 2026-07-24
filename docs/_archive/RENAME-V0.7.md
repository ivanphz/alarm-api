# RENAME-V0.7.md — 改名总表与手机预建闹钟改名清单（2026-07 冻结批次）

> 本批改名直接改到 v2 现役代码，无兼容层。服务端由 AI 完成（本包已含）；
> 手机侧只两件事: 时钟 App 改预建闹钟名（下表）+ SyncAlarms 前缀常量改字。

## 1. 服务端字段/概念改名（信封路径变化，手机取值改 key 文本框）

| 类别 | 旧 | 新 | 手机侧影响 |
|---|---|---|---|
| focus 值键 | `fields.focus.value.mode` | `fields.focus.value.preset` | 取 preset 的 Get Dictionary Value 改 key 字符串 |
| 术语 mode | （多处） | **全系统退役**（?mode=URL参数除外） | — |
| AI 字段 | `fields.ai_available` | `fields.cadence.ai_claude`（命名空间就绪） | 该字段灰度未用，零成本 |
| todo 落地键 | `mode`（提示词旧） | `landing` | 尚未实现 |

## 2. Gate 标签改名（前缀两族，后段全称保留）

| 旧前缀 | 新前缀 | 示例 |
|---|---|---|
| `Gate-Fixed-` | `GateFix-` | GateFix-Workday-WakeUp-Vib |
| `Gate-Dynamic-` | `GateDyn-` | GateDyn-Event-0730 |
| `Gate-ES-` | `GateDyn-ES-` | GateDyn-ES-hsbc-bill77-0630 |
| `Gate-Class-` | `GateDyn-Class-` | GateDyn-Class-Sat-Dance-0845 |
| `Gate-AIQ-` | `GateDyn-CAD-` | GateDyn-CAD-ai_claude-1400（cadence 归位） |

## 3. 手机预建闹钟改名清单（时钟 App 逐条改，约 7 条）

| 现闹钟名 | 改为 | 时间(不变) |
|---|---|---|
| Gate-Fixed-Workday-WakeUp-Vib | **GateFix-Workday-WakeUp-Vib** | 06:25 |
| Gate-Fixed-Workday-WakeUp-Ring | **GateFix-Workday-WakeUp-Ring** | 06:29 |
| Gate-Fixed-FirstWorkday-WakeUp-Ring | **GateFix-FirstWorkday-WakeUp-Ring** | 07:38 |
| Gate-Fixed-SchoolBreak-WakeUp-Vib | **GateFix-SchoolBreak-WakeUp-Vib** | 07:20 |
| Gate-Fixed-SchoolBreak-WakeUp-Ring | **GateFix-SchoolBreak-WakeUp-Ring** | 07:24 |
| Gate-Fixed-Workday-NapEnd-Vib | **GateFix-Workday-NapEnd-Vib** | 13:30 |
| Gate-Fixed-Workday-OffWork-Vib | **GateFix-Workday-OffWork-Vib** | 17:28 |
| Gate-Fixed-Class-Sat-Dance（若已预建） | **GateFix-Class-Sat-Dance** | 07:45 |

（动态闹钟无需预建，网关按新前缀下发，手机 SyncAlarms 自动建/删，不用手工改。）

## 4. SyncAlarms 指令改字（不插动作）

- 固定 sweep 前缀常量: `Gate-Fixed-` → `GateFix-`
- 动态 sweep 前缀清单: 原 `Gate-Dynamic-Event / Gate-ES / Gate-Class / Gate-AIQ`
  统一成**一个前缀** `GateDyn-`（所有动态闹钟同族，一扫全清，维护更简）。

## 5. 校验

部署后 `/v2/timeline?date=<任意工作日>&now=00:00` → alarms.fixed 的 label 应全部
GateFix- 开头; 造 god-mode/外部源可见 GateDyn- 动态。手机改名后 SyncAlarms 跑一次，
确认固定闹钟按新名命中开关。
