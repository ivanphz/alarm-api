// ─────────────────────────────────────────────────────────────────────────────
// plugins/ai-quota-reminder.js — 配额恢复提醒（V12 步骤⑤）
// ─────────────────────────────────────────────────────────────────────────────
// 纯派生插件: 不重算任何配额逻辑，只读 ai_quota 的 level 时间线，
// 在 false→true 跳变处产出 Gate-AIQ 提醒闹钟（时间入标签，幂等对账）。
// 值 schema 与 wake_alarms 同形 { fixed:[], dynamic:[...] }，由 assembleAlarms 并集。
// 配额逻辑单点在 ai-quota.js —— 这正是"字段/提醒都是 level 的派生视图"的示范。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays } from "../kernel/intervals.js";
import { aiqLabel } from "../domain/alarm-labels.js";

export default {
  name: "ai_quota_reminder",
  kind: "level",
  scope: "per-device",
  deps: [{ name: "ai_quota", required: true }],

  produce(ctx, range) {
    const cfg = (ctx.config.V2 || {}).AI_QUOTA || {};
    const segs = ctx.schedules.ai_quota || [];
    // 逐日装桶: false→true 的跳变 = 恢复时刻
    const byDay = new Map();
    let prev = null;
    for (const s of segs) {
      if (s.value === true && prev === false) {
        const d = s.from.slice(0, 10), t = s.from.slice(11);
        if (!byDay.has(d)) byDay.set(d, []);
        const label = aiqLabel(cfg.STREAM, t);
        if (label) byDay.get(d).push({ label, time: t, reason: `AI额度恢复(${cfg.STREAM})` });
      }
      prev = s.value;
    }
    const out = [];
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      out.push({ from: `${d} 00:00`, value: {
        fixed: [],
        dynamic: (cfg.ENABLED && cfg.REMINDER !== false) ? (byDay.get(d) || []) : [],
      } });
    }
    return out;
  },
};
