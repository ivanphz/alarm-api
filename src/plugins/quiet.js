// ─────────────────────────────────────────────────────────────────────────────
// plugins/quiet.js — 决策插件: "此刻手机该不该安静"（V12 步骤②，R6 归宿）
// ─────────────────────────────────────────────────────────────────────────────
// 值 token: "on" | "off"。消费者经字段订阅（focus/silent/media_volume，KERNEL §5）。
// level 语义要点:
//   V11 的"不输出"（R6.2a/c 长假不吵醒）在这里 = 不产生 off 边界 → 上一晚的 on
//   一直保持；相邻同值由归一化合并。手动解除在 on_change 策略下赢到下一次值变化。
// R6 决策树逐条对位，编号保留:
//   R6.1  夜间 on: 明天实际休息→NIGHT_ON_REST_EVE，否则→NIGHT_ON_WORKDAY_EVE
//   R6.2a leave晨碰 且 昨日块≥阈值 → 不输出（长假尾巴，手动）
//   R6.2b leave晨碰 且 昨日块<阈值 → MORNING_OFF_WORKDAY（用户拍板: 早点解除）
//   R6.2c 实际休息 且 所在块≥阈值  → 不输出（长假中段，绝不吵醒）
//   R6.2d 实际休息 且 所在块<阈值  → MORNING_OFF_WEEKEND
//   R6.2e 其余（工作日/出差日/半天假正常上班半天）→ MORNING_OFF_WORKDAY
//   R6.3  午间两键: 法定工作日 且 noon==="work" → NOON_ON on + NOON_OFF off
// 时间常量取自 ctx.config.DND（config 键名不属于 API，维持原状；WHITELIST 一致性
// 审计移交 kernel/audit.js，见 BLUEPRINT 步骤②遗留项）。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, sampleSegment } from "../kernel/intervals.js";

export default {
  name: "quiet",
  kind: "level",
  scope: "per-device",
  deps: [
    { name: "presence", required: true },
    { name: "god_mode", required: false },   // R1: 上帝模式日 quiet 完全按 god JSON
  ],

  produce(ctx, range) {
    const dnd = ctx.config.DND;
    const longRest = ctx.config.LONG_REST_DAYS;
    const P = (d) => sampleSegment(ctx.schedules.presence, `${d} 00:00`).value;

    const out = [];
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      // ── R1 上帝模式接管（该日 quiet 全按 god.quiet，R6 整体旁路）──
      const god = sampleSegment(ctx.schedules.god_mode || [], `${d} 00:00`).value;
      if (god) {
        for (const [hm, v] of Object.entries(god.quiet || {})) {
          out.push({ from: `${d} ${hm}`, value: v });
        }
        continue;
      }
      const p = P(d);
      if (!p) continue;                                    // presence 无主张 → 本日无主张

      // ── R6.2 早间解除 ──
      // a/c 分支产出 null=释放主张（非"无边界"）: 白天归人管, 且夜间 null→on 恢复为
      // 真变化 → 每晚照常重进安静（对齐 v1 刺客夜夜点火; 契约4: 执行器见 null 清 LA）
      if (p.morning === "leave") {
        const yesterdayBlock = (P(addDays(d, -1)) || {}).block ?? 0;
        out.push({ from: `${d} ${dnd.MORNING_OFF_WORKDAY}`,
                   value: yesterdayBlock < longRest ? "off" : null });   // R6.2b / R6.2a释放
      } else if (p.rest) {
        out.push({ from: `${d} ${dnd.MORNING_OFF_WEEKEND}`,
                   value: p.block < longRest ? "off" : null });          // R6.2d / R6.2c释放
      } else {
        out.push({ from: `${d} ${dnd.MORNING_OFF_WORKDAY}`, value: "off" });     // R6.2e
      }

      // ── R6.3 午间两键 ──
      if (p.workday && p.noon === "work") {
        out.push({ from: `${d} ${dnd.NOON_ON}`,  value: "on"  });
        out.push({ from: `${d} ${dnd.NOON_OFF}`, value: "off" });
      }

      // ── R6.1 夜间 on ──
      const tomorrowRest = (P(addDays(d, 1)) || {}).rest;
      const nightTime = tomorrowRest ? dnd.NIGHT_ON_REST_EVE : dnd.NIGHT_ON_WORKDAY_EVE;
      out.push({ from: `${d} ${nightTime}`, value: "on" });
    }
    return out;
  },
};
