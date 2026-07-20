// ─────────────────────────────────────────────────────────────────────────────
// plugins/restdays.js — 事实插件: 法定/实际休息 + 休息块（V12 步骤②）
// ─────────────────────────────────────────────────────────────────────────────
// 前身: rest-days.js（判定语义一字未改，仅换壳为插件契约）。
// 值(日粒度 level，from = "D 00:00"):
//   { workday: 法定要不要上班, named_holiday: 命名假日,
//     rest: 实际在休息(法定休 OR 全天 leave), block: 所在连续休息块天数 }
// 产出跨度: range ±2 天（presence 需 ±1，quiet 又需读 presence 邻日）。
// 块扫描 ±14 天走原始输入(ctx.workdays/ctx.calendars)，不受产出跨度限制。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, dayOfWeek } from "../kernel/intervals.js";
import { matchGroup, vocabularyFromConfig } from "../domain/grammar.js";

export default {
  name: "restdays",
  kind: "level",
  scope: "shared",
  deps: [],

  produce(ctx, range) {
    const cfg = ctx.config;
    const vocab = vocabularyFromConfig(cfg);
    const holidayMap = new Map((ctx.workdays || []).map((d) => [d.date, d]));
    const manual = new Set(cfg.MANUAL_HOLIDAYS || []);

    // 全天 leave 实例按日期索引（edge/sources 已把重复/跨天事件解算成日实例）
    const fullLeave = new Set(
      (ctx.calendars || [])
        .filter((ev) => (ev.all_day || !ev.start_time) && matchGroup(ev.title, "leave", vocab))
        .map((ev) => ev.date),
    );

    const officialWorkday = (d) => {
      if (manual.has(d)) return false;
      const h = holidayMap.get(d);
      if (h) return !h.off;                    // workdays-core 数据优先（含调休补班）
      const w = dayOfWeek(d);
      return w !== 0 && w !== 6;               // 无数据按自然周末兜底
    };
    const namedHoliday = (d) => {
      if (manual.has(d)) return true;
      const h = holidayMap.get(d);
      return !!(h && h.off && h.name && !["周六", "周日"].includes(h.name));
    };
    const rest = (d) => !officialWorkday(d) || fullLeave.has(d);
    const block = (d) => {
      if (!rest(d)) return 0;
      let n = 1;
      for (let x = addDays(d, -1), i = 0; i < 14 && rest(x); i++, x = addDays(x, -1)) n++;
      for (let x = addDays(d, 1),  i = 0; i < 14 && rest(x); i++, x = addDays(x, 1))  n++;
      return n;
    };

    const out = [];
    const stop = addDays(range.end, 2);
    for (let d = addDays(range.start, -2); d <= stop; d = addDays(d, 1)) {
      out.push({
        from: `${d} 00:00`,
        value: {
          workday: officialWorkday(d),
          named_holiday: namedHoliday(d),
          rest: rest(d),
          block: block(d),
        },
      });
    }
    return out;
  },
};
