// ─────────────────────────────────────────────────────────────────────────────
// plugins/school-break.js — 事实插件: 学校假期（V12 步骤④，语义零改动移植）
// 值(日粒度): { key, name } | null。key 是契约（periods 精确匹配），name 只供显示。
// 它不改变"工作日"属性——大人照常上班；MANUAL_HOLIDAYS 才是彻底放假。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays } from "../kernel/intervals.js";

function inRange(dateStr, range) {
  if (range.start.length === 5) {                    // "MM-DD" 每年重复
    const md = dateStr.substring(5);
    return md >= range.start && md <= range.end;
  }
  return dateStr >= range.start && dateStr <= range.end;
}

export function schoolBreakOf(dateStr, cfg) {
  const sb = cfg.SCHOOL_BREAK || { RANGES: [], EXCLUDE: [] };
  const hit = (sb.RANGES || []).find((r) => inRange(dateStr, r));
  if (!hit) return null;
  if ((sb.EXCLUDE || []).find((r) => inRange(dateStr, r))) return null;
  return { key: hit.key || hit.name, name: hit.name };
}

export default {
  name: "school_break",
  kind: "level",
  scope: "shared",
  deps: [],
  produce(ctx, range) {
    const out = [];
    const stop = addDays(range.end, 1);
    for (let d = addDays(range.start, -1); d <= stop; d = addDays(d, 1)) {
      out.push({ from: `${d} 00:00`, value: schoolBreakOf(d, ctx.config) });
    }
    return out;
  },
};
