// ─────────────────────────────────────────────────────────────────────────────
// plugins/weekend-class.js — 决策插件: 周末上课闹钟（V12 步骤④，R3 归宿）
// ─────────────────────────────────────────────────────────────────────────────
// 值(日粒度): { fixed: [label...], dynamic: [{label, time, reason}] }
// 与 V11 对位:
//   R3.1a 时段时间==锚 → 固定 Gate-Fixed-Class-<id>；R3.1b 不等/未配锚 → 动态
//   R3.2 长休块≥阈值跳课；R3.3 时段未配时间不上课；R3.4 锚配置错误按动态
//   晨间碰撞清课（v1 clearMorning 的课程部分）: presence 晨区 leave/out 且课时≤晨界 → 跳
//   R1 上帝模式日 → 静默（god 集合由 wake_alarms 全权播出，不重复）
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, dayOfWeek, sampleSegment } from "../kernel/intervals.js";
import { classFixedLabel, classDynamicLabel } from "../domain/alarm-labels.js";

export default {
  name: "weekend_class",
  kind: "level",
  scope: "shared",
  deps: [
    { name: "restdays", required: true },
    { name: "presence", required: true },
    { name: "school_break", required: true },
    { name: "god_mode", required: false },
  ],

  produce(ctx, range) {
    const cfg = ctx.config;
    const wc = cfg.WEEKEND_CLASS || {};
    const S = (name, d) => sampleSegment(ctx.schedules[name] || [], `${d} 00:00`).value;

    const out = [];
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      const value = { fixed: [], dynamic: [] };
      const god = S("god_mode", d);
      const p = S("presence", d);

      if (wc.ENABLED && !god && p && !p.workday) {
        const dow = dayOfWeek(d);
        const sb = S("school_break", d);
        const pKey = sb ? sb.key : "normal";
        const morningCollided = p.morning === "leave" || p.morning === "out";

        for (const s of wc.SCHEDULE || []) {
          if (s.day !== dow) continue;                                   // R3.1 星期匹配
          if (p.block >= cfg.LONG_REST_DAYS) continue;                   // R3.2 长假跳课
          const t = (s.periods || {})[pKey];
          if (!t) continue;                                              // R3.3 时段未配
          if (morningCollided && t <= cfg.ZONES.MORNING.end) continue;   // 晨间碰撞清课
          const anchorT = s.fixed ? (s.periods || {})[s.fixed] : null;   // R3.4 缺锚→动态
          if (anchorT && t === anchorT) {
            value.fixed.push(classFixedLabel(cfg, s.id));                // R3.1a
          } else {
            value.dynamic.push({                                        // R3.1b
              label: classDynamicLabel(cfg, dow, s.id, t),
              time: t,
              reason: `${s.name}(${sb ? sb.name : "平时"})`,
            });
          }
        }
      }
      out.push({ from: `${d} 00:00`, value });
    }
    return out;
  },
};
