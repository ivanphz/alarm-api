// ─────────────────────────────────────────────────────────────────────────────
// plugins/god-mode.js — 上帝模式（V12 步骤④，R1 归宿）
// ─────────────────────────────────────────────────────────────────────────────
// 事实插件: 日历事件 [上帝模式] + DESCRIPTION JSON → 当日完全接管声明。
// 值(日粒度): null(常态) | { fixed:[label...], dynamic:[{label,time,reason}],
//                            quiet: { "HH:MM": "on"|"off" } }
// 消费方式(契约8 的 overlay 实现): quiet/wake-alarms/weekend-class 均 deps 本插件，
// 命中日各自让位（quiet 改播 god.quiet；wake-alarms 改播 god 集合；weekend-class 静默）。
// JSON 兼容 v1 词汇: fixedAlarms(action!=="OFF")/dynamicAlarms/dnd_schedule(ON/OFF)。
// 解析失败 = 该日回落常规规则（R1 原语义: 忽略并继续）+ trace 由消费方可见 null。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays } from "../kernel/intervals.js";
import { matchGroup, vocabularyFromConfig } from "../domain/grammar.js";

function parseGod(description) {
  const god = JSON.parse(description);
  const fixed = (god.fixed || god.fixedAlarms || [])
    .filter((a) => a && a.label && String(a.action).toUpperCase() !== "OFF")
    .map((a) => a.label);
  const dynamic = (god.dynamic || god.dynamicAlarms || [])
    .filter((a) => a && a.label && a.time)
    .map((a) => ({ label: a.label, time: a.time, reason: a.reason || "god_mode" }));
  const quiet = {};
  for (const [k, v] of Object.entries(god.quiet || god.dnd_schedule || {})) {
    quiet[k] = String(v).toLowerCase() === "on" ? "on" : "off";
  }
  return { fixed, dynamic, quiet };
}

export default {
  name: "god_mode",
  kind: "level",
  scope: "per-device",
  deps: [],
  produce(ctx, range) {
    const vocab = vocabularyFromConfig(ctx.config);
    const byDate = new Map();
    for (const ev of ctx.calendars || []) {
      if (!matchGroup(ev.title, "god_mode", vocab) || !ev.description) continue;
      if (byDate.has(ev.date)) continue;                     // 同日多条: 首条生效（v1 同序）
      try { byDate.set(ev.date, parseGod(ev.description)); }
      catch { /* JSON 非法 → 该日回落常规（R1 原语义），值保持 null */ }
    }
    const out = [];
    const stop = addDays(range.end, 1);
    for (let d = addDays(range.start, -1); d <= stop; d = addDays(d, 1)) {
      out.push({ from: `${d} 00:00`, value: byDate.get(d) || null });
    }
    return out;
  },
};
