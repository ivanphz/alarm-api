// ─────────────────────────────────────────────────────────────────────────────
// plugins/ai-quota.js — AI 冷却配额（V12 步骤⑤，cadence 的第一个任务·特例试点）
// ─────────────────────────────────────────────────────────────────────────────
// 值(level): true(可用) | false(冷却中) | null(无主张: 功能关闭/事实源降级)
// 事实流(契约14): { at, id, type: "done"|"reset"|"set_next", payload }
//   done     使用一次 → 阻塞 [at, min(at+COOLDOWN, 下个周重置)]
//   reset    纠偏: 立即恢复（截断覆盖 at 的阻塞段）
//   set_next 纠偏: 手动指定下次可用 → 阻塞 [at, payload.at]
// 周重置: WEEKLY_RESET {day(0-6), time} —— 额度周期性回满，天然截断冷却。
// 事实源降级(degraded) → 全程 null（宁可不知道，不可编造，契约9/10）。
// V13 泛化方向: 本文件的区间构造抽成 kinds 库，任务变纯配置（KERNEL §10）。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, addMinutes, dayOfWeek, cmp } from "../kernel/intervals.js";

/** 严格晚于 t 的下一个周重置时刻 */
export function nextWeeklyReset(t, weekly) {
  if (!weekly) return null;
  const day = t.slice(0, 10);
  for (let i = 0; i <= 7; i++) {
    const d = addDays(day, i);
    if (dayOfWeek(d) !== weekly.day) continue;
    const w = `${d} ${weekly.time}`;
    if (cmp(w, t) > 0) return w;
  }
  return null;
}

export default {
  name: "ai_quota",
  kind: "level",
  scope: "per-device",
  deps: [],

  produce(ctx, range) {
    const cfg = (ctx.config.V2 || {}).AI_QUOTA || {};
    const base = `${addDays(range.start, -1)} 00:00`;
    const horizon = `${addDays(range.end, 2)} 00:00`;
    if (!cfg.ENABLED) {
      return [{ from: base, value: null }];                       // 功能关: 无主张
    }
    const facts = ctx.facts || {};
    if ((facts.degraded || []).includes(cfg.STREAM)) {
      return [{ from: base, value: null }];                       // 源降级: 无主张
    }
    const events = [...(facts.streams?.[cfg.STREAM] || [])]
      .filter((e) => e && e.at && e.id)
      .sort((a, b) => cmp(a.at, b.at));

    // ① 阻塞区间
    let blocks = [];
    for (const e of events) {
      const type = e.type || "done";
      if (type === "done") {
        let end = addMinutes(e.at, cfg.COOLDOWN_MINUTES ?? 300);
        const w = nextWeeklyReset(e.at, cfg.WEEKLY_RESET);
        if (w && cmp(w, end) < 0) end = w;
        blocks.push({ start: e.at, end });
      } else if (type === "set_next" && e.payload && e.payload.at) {
        if (cmp(e.payload.at, e.at) > 0) blocks.push({ start: e.at, end: e.payload.at });
      } else if (type === "reset") {
        blocks = blocks.map((b) =>
          cmp(b.start, e.at) <= 0 && cmp(e.at, b.end) < 0 ? { ...b, end: e.at } : b);
      }
    }
    // ② 合并重叠
    blocks.sort((a, b) => cmp(a.start, b.start));
    const merged = [];
    for (const b of blocks) {
      const last = merged[merged.length - 1];
      if (last && cmp(b.start, last.end) <= 0) {
        if (cmp(b.end, last.end) > 0) last.end = b.end;
      } else merged.push({ ...b });
    }
    // ③ 区间 → 阶跃（同刻后写者胜: end==next.start 已被合并消除）
    const out = [{ from: base, value: true }];
    for (const b of merged) {
      if (cmp(b.end, base) <= 0 || cmp(b.start, horizon) >= 0) continue;
      out.push({ from: cmp(b.start, base) > 0 ? b.start : base, value: false });
      if (cmp(b.end, horizon) < 0) out.push({ from: b.end, value: true });
    }
    // base 落在阻塞内时修正首段
    if (merged.some((b) => cmp(b.start, base) <= 0 && cmp(base, b.end) < 0)) out[0].value = false;
    const dedup = new Map(out.map((s) => [s.from, s.value]));     // 同刻后写者胜
    return [...dedup.entries()].map(([from, value]) => ({ from, value }));
  },
};
