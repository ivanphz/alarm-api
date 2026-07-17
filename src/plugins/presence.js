// ─────────────────────────────────────────────────────────────────────────────
// plugins/presence.js — 事实插件: 三区在场状态（V12 步骤②，R4/R5 碰撞逻辑归宿）
// ─────────────────────────────────────────────────────────────────────────────
// 值(日粒度 level，from = "D 00:00"):
//   { workday, rest, block,                          ← 转录自 restdays（供下游一站取用）
//     morning|noon|evening: "work"|"free"|"leave"|"out" }
//     work  = 正常上班    free = 正常休息
//     leave = leave 事件碰撞该区（原 R4 flags.morningLeave 等价于 morning==="leave"）
//     out   = work_event 事件碰撞该区（出差/会议/外勤…）
// 同区多事件裁决优先级: leave > out > 底色。
// 碰撞公式与 V11 逐字对位（全天事件三区全中；区带边界比较为同日 HH:MM 字典序）。
// R1 上帝模式事件在此忽略 —— overlay 是 god-mode 插件的职权（契约8，步骤④）。
// 产出跨度: range ±1 天（quiet 需读昨天 block 与明天 rest）。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, sampleSegment } from "../kernel/intervals.js";
import { classify, vocabularyFromConfig } from "../domain/grammar.js";

// 事件 × 区带 碰撞判定（导出供 wake-alarms 步骤④复用，单一变更点）
export function computeCollisions(ev, zones) {
  if (ev.all_day || !ev.start_time) return { morning: true, noon: true, evening: true };
  const s = ev.start_time;
  const e = ev.end_time || ev.start_time;
  return {
    morning: s <= zones.MORNING.end,
    noon: (s < zones.NOON.end && e > zones.NOON.end) ||
          (s >= zones.NOON.start && s <= zones.NOON.end),
    evening: e > zones.EVENING.start,
  };
}

const RANK = { leave: 2, out: 1 };   // 底色(work/free) rank 0

export default {
  name: "presence",
  kind: "level",
  scope: "per-device",
  deps: [{ name: "restdays", required: true }],

  produce(ctx, range) {
    const zones = ctx.config.ZONES;
    const vocab = vocabularyFromConfig(ctx.config);
    const restdays = ctx.schedules.restdays;

    const byDate = new Map();
    for (const ev of ctx.calendars || []) {
      if (!byDate.has(ev.date)) byDate.set(ev.date, []);
      byDate.get(ev.date).push(ev);
    }

    const out = [];
    const stop = addDays(range.end, 1);
    for (let d = addDays(range.start, -1); d <= stop; d = addDays(d, 1)) {
      const rd = sampleSegment(restdays, `${d} 00:00`).value;
      if (!rd) continue;                                   // 事实缺失 → 本日无主张（契约2）

      const base = rd.workday ? "work" : "free";
      const zone = { morning: base, noon: base, evening: base };

      for (const ev of byDate.get(d) || []) {
        const kind = classify(ev.title, vocab);
        if (kind !== "leave" && kind !== "work_event") continue;
        const tok = kind === "leave" ? "leave" : "out";
        const c = computeCollisions(ev, zones);
        for (const z of ["morning", "noon", "evening"]) {
          if (c[z] && RANK[tok] > (RANK[zone[z]] || 0)) zone[z] = tok;
        }
      }

      out.push({
        from: `${d} 00:00`,
        value: { workday: rd.workday, rest: rd.rest, block: rd.block, ...zone },
      });
    }
    return out;
  },
};
