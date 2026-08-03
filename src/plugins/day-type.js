// ─────────────────────────────────────────────────────────────────────────────
// plugins/day-type.js — 日型分类器（原子化第③步，ATOMIC-RULES §1「条件」）
// ─────────────────────────────────────────────────────────────────────────────
// 把散在 quiet.js 里的日型判定提成【显式的、可查询的事实】。规则表的 when 条件
// 断言的就是这里的三根轴。
//
// ★ 为什么是三根【正交】的轴而不是一个标签:
//   一天同时有"晨间属于哪一类""午间上不上班""今晚是不是休息日前夜"，三者独立。
//   压成单标签就是 5×2×2=20 种组合，加一个维度就翻倍 —— 那是组合爆炸不是分类。
//
//   morning  晨间解除属于哪一类（决定时刻与值）
//     work            普通上班日（含出差日、半天假的正常上班半天）→ 早解除
//     leave_short     请假晨碰 且 昨日休息块 < 阈值               → 早解除（用户拍板: 早点解除）
//     leave_long_tail 请假晨碰 且 昨日休息块 ≥ 阈值               → 释放主张（长假尾巴，归人管）
//     rest_short      实际休息 且 所在块 < 阈值                   → 晚解除
//     rest_long       实际休息 且 所在块 ≥ 阈值                   → 释放主张（长假中段，绝不吵醒）
//
//   noon     午间两键要不要（法定工作日 且 中午确实在上班）
//     work | off
//     ⚠️ 出差事件占了午间区带 → noon=off → 没有午间两键。2026-07-28 事故的成因之一。
//
//   eve      今晚属于哪一类（决定夜间进入的时刻）
//     workday | rest       明天实际休息 → 晚点进；否则早点进
//
// 上帝模式日: 本插件照常产出日型（它只是事实），是否被采纳由规则表决定。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, sampleSegment } from "../kernel/intervals.js";

export default {
  name: "day_type",
  kind: "level",
  scope: "per-device",
  deps: [{ name: "presence", required: true }],

  produce(ctx, range) {
    const longRest = ctx.config.LONG_REST_DAYS;
    const P = (d) => sampleSegment(ctx.schedules.presence, `${d} 00:00`).value;

    const out = [];
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      const p = P(d);
      if (!p) { out.push({ from: `${d} 00:00`, value: null }); continue; }  // presence 无主张 → 传染

      let morning;
      if (p.morning === "leave") {
        const yesterdayBlock = (P(addDays(d, -1)) || {}).block ?? 0;
        morning = yesterdayBlock < longRest ? "leave_short" : "leave_long_tail";
      } else if (p.rest) {
        morning = p.block < longRest ? "rest_short" : "rest_long";
      } else {
        morning = "work";
      }

      out.push({
        from: `${d} 00:00`,
        value: {
          morning,
          noon: (p.workday && p.noon === "work") ? "work" : "off",
          eve: ((P(addDays(d, 1)) || {}).rest) ? "rest" : "workday",
        },
      });
    }
    return out;
  },
};
