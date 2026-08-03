// ─────────────────────────────────────────────────────────────────────────────
// plugins/wake-alarms.js — 决策插件: 工作日闹钟集合（V12 步骤④，R2 + R4/R5 闹钟效应归宿）
// ─────────────────────────────────────────────────────────────────────────────
// 值(日粒度): { fixed: [label...], dynamic: [{label, time:"HH:MM", reason}] }
//   —— "当日期望集合"（闹钟即状态，KERNEL §1）。窗口裁剪归 edge/assemble（窗口是
//   采样期权限边界，不是生产期概念）。
//
// 与 V11 对位:
//   R2.1/2.2 起床组(BUNDLED 联动) · R2.3 节后首日兜底 · R2.4 午休/下班铃
//   R4.1/R5.1 晨间碰撞 → 早间组不注入（v1 是先加后删，v2 直接按 presence 分区判定不加）
//   R5.1 晨间 work_event 有具体时间 → GateDyn-Event-<HHMM>（任何日子都建，与 v1 同）
//   R4.2/R5.2 午休碰撞 → 无午休铃；R4.3/R5.3 傍晚碰撞 → 无下班铃
//   R1 上帝模式日 → 完全播 god 集合（fixed/dynamic 均以 god 为准）
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, sampleSegment } from "../kernel/intervals.js";
import { classify, vocabularyFromConfig } from "../domain/grammar.js";
import { eventLabel } from "../domain/alarm-labels.js";
import { computeCollisions } from "./presence.js";

// ── last_wake: 当日【最晚的起床闹钟】时刻 ────────────────────────────────────
// 给规则表当锚点用: "解除时刻 = 最晚起床闹钟 + N 分钟"（ATOMIC-RULES §4）。
// 之前 focus/silent 的解除写死 07:40 —— 那是"覆盖所有场景的最晚闹钟 + 余量"的
// 手工值: 普通工作日最晚 06:29、寒暑假 07:24、节后首日 07:38、出差 08:10。
// 写死的代价是出差日闹钟 08:10 才响、状态却 07:40 就解除了（2026-07-28 实案）。
// 锚定之后自动适应，加新闹钟组也不用回头改解除时刻。
//
// 只认【起床】类: 午休结束(NapEnd)、下班(OffWork) 不算，否则解除会被拖到傍晚。
// 动态闹钟一律算起床（它们本来就是为了叫醒而建的）。
function lastWake(ctx, fixedLabels, dynamic) {
  const table = new Map((ctx.config.FIXED_ALARMS || []).map((a) => [a.label, a.scheduledAt]));
  const times = [];
  for (const label of fixedLabels || []) {
    if (!/WakeUp/i.test(label)) continue;
    const t = table.get(label);
    if (t) times.push(t);
  }
  for (const d of dynamic || []) if (d && d.time) times.push(d.time);
  return times.length ? times.sort().at(-1) : null;
}

export default {
  name: "wake_alarms",
  kind: "level",
  scope: "per-device",
  feeds: "alarms",                 // 闹钟集合，被 edge/assemble 的 assembleAlarms 消费
  deps: [
    { name: "restdays", required: true },
    { name: "presence", required: true },
    { name: "school_break", required: true },
    { name: "god_mode", required: false },
  ],

  produce(ctx, range) {
    const cfg = ctx.config;
    const vocab = vocabularyFromConfig(cfg);
    const S = (name, d) => sampleSegment(ctx.schedules[name] || [], `${d} 00:00`).value;

    const byDate = new Map();
    for (const ev of ctx.calendars || []) {
      if (!byDate.has(ev.date)) byDate.set(ev.date, []);
      byDate.get(ev.date).push(ev);
    }

    const out = [];
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      const god = S("god_mode", d);
      if (god) {                                             // R1: 完全接管
        out.push({ from: `${d} 00:00`,
          value: { fixed: [...god.fixed], dynamic: [...god.dynamic],
                   last_wake: lastWake(ctx, god.fixed, god.dynamic) } });
        continue;
      }
      const p = S("presence", d);
      if (!p) { out.push({ from: `${d} 00:00`, value: null }); continue; }
      const sb = S("school_break", d);

      const fixed = [];
      const addFixed = (label) => {
        fixed.push(label);
        if (cfg.BUNDLED[label]) fixed.push(cfg.BUNDLED[label]);   // 副铃联动
      };

      // ── R2 底色（仅法定工作日；分区≠work 即 v1 的"碰撞后删除"）──
      if (p.workday) {
        if (p.morning === "work") {
          if (sb) {
            addFixed("GateFix-SchoolBreak-WakeUp-Vib");               // R2.1
          } else {
            addFixed("GateFix-Workday-WakeUp-Vib");                   // R2.2
            const yRest = (S("presence", addDays(d, -1)) || {}).rest;
            if (yRest) addFixed("GateFix-FirstWorkday-WakeUp-Ring");  // R2.3
          }
        }
        if (p.noon === "work")    fixed.push("GateFix-Workday-NapEnd-Vib");   // R2.4/R4.2
        if (p.evening === "work") fixed.push("GateFix-Workday-OffWork-Vib");  // R2.4/R4.3
      }

      // ── R5.1 晨间 work_event 事件闹钟（任何日子；全天事件无时间不建）──
      const dynamic = [];
      const seen = new Set();
      for (const ev of byDate.get(d) || []) {
        if (classify(ev.title, vocab) !== "work_event") continue;
        if (ev.all_day || !ev.start_time) continue;
        if (!computeCollisions(ev, cfg.ZONES).morning) continue;
        const label = eventLabel(cfg, ev.start_time);
        if (seen.has(label)) continue;
        seen.add(label);
        dynamic.push({ label, time: ev.start_time, reason: ev.title });
      }

      out.push({ from: `${d} 00:00`, value: { fixed, dynamic, last_wake: lastWake(ctx, fixed, dynamic) } });
    }
    return out;
  },
};
