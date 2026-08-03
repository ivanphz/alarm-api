// test/kernel/day-type-coverage.test.js — 七个日型场景 × 三个字段的行为快照
// ─────────────────────────────────────────────────────────────────────────────
// 前身是「规则路径 vs quiet 订阅路径」的影子对拍。第③步完成后 focus/silent/
// media_volume 全部迁进规则表，quiet 再没有消费者，对拍失去参照物 —— 而且晨间
// 解除时刻已【故意改成锚定起床闹钟】，与 quiet 的固定 07:40 本就不该相等。
//
// 所以改成显式快照: 每个日型下三个字段各产哪些边界，一眼可读、一改就红。
// 它同时是这套规则的【行为说明书】—— 看这个文件比看配置更快知道某天会发生什么。
import test from "node:test";
import assert from "node:assert/strict";
import { handleV2 } from "../../src/edge/router.js";
import { addDays, sampleSegment } from "../../src/kernel/intervals.js";

const HOL = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];

function loaders({ holiday = [], trip = [], leave = [] } = {}) {
  const H = new Set(holiday);
  return {
    async loadWorkdays() {
      const out = [];
      for (let d = "2026-06-20"; d <= "2026-08-20"; d = addDays(d, 1)) {
        const w = new Date(d + "T00:00:00Z").getUTCDay();
        out.push({ date: d, off: H.has(d) || w === 0 || w === 6, name: H.has(d) ? "长假" : "" });
      }
      return out;
    },
    async loadCalendars() {
      return [
        ...trip.map((t) => (typeof t === "string" ? { title: "出差", date: t, all_day: true } : t)),
        ...leave.map((d) => ({ title: "请假", date: d, all_day: true })),
      ];
    },
    async loadExternalAlarms() { return []; },
    async loadFacts() { return { streams: {}, degraded: [] }; },
  };
}

/** 把某日某字段的边界压成可读串: "07:44=off 08:34=∅" */
function sketch(timeline, date) {
  return (timeline || [])
    .filter((s) => s.from.startsWith(date))
    .map((s) => {
      const v = s.value;
      const txt = v === null ? "∅"
        : (v && v.action) ? `${v.preset}:${v.action}` : String(v);
      return `${s.from.slice(11)}=${txt}`;
    })
    .join(" ");
}

async function scene(date, opts) {
  const res = await handleV2(new Request(`https://x/v2/timeline?date=${date}&debug=1`),
                             {}, "/timeline", loaders(opts));
  const b = await res.json();
  const dt = sampleSegment(b.schedules.day_type, `${date} 12:00`).value;
  return {
    dayType: dt ? `${dt.morning}/${dt.noon}/${dt.eve}/${dt.night}` : "null",
    focus: sketch(b.field_timelines.focus, date),
    silent: sketch(b.field_timelines.silent, date),
    volume: sketch(b.field_timelines.media_volume, date),
  };
}

const EXPECT = [
  ["普通工作日", "2026-07-15", {}, {
    dayType: "work/work/workday/home",
    focus:  "07:44=sleep:off 12:15=do_not_disturb:on 13:29=do_not_disturb:off 20:55=sleep:on",
    silent: "07:44=off 20:55=on",
    volume: "07:44=∅ 12:15=0 13:29=∅ 20:55=0",
  }],
  ["休息日前夜（周五）", "2026-07-17", {}, {
    dayType: "work/work/rest/home",
    focus:  "07:44=sleep:off 12:15=do_not_disturb:on 13:29=do_not_disturb:off 22:25=sleep:on",
    silent: "07:44=off 22:25=on",
    volume: "07:44=∅ 12:15=0 13:29=∅ 22:25=0",
  }],
  ["普通周末", "2026-07-18", {}, {
    dayType: "rest_short/off/rest/home",
    focus:  "09:30=sleep:off 22:25=sleep:on",
    silent: "09:30=off 22:25=on",
    volume: "09:30=∅ 22:25=0",
  }],
  // ★ 长假: 早上【不产任何边界】= 绝不吵醒（全 pulse 后不再需要 null 打断合并）
  ["长假中段（绝不吵醒: 早上无边界）", "2026-07-15", { holiday: HOL }, {
    dayType: "rest_long/off/rest/home",
    focus:  "22:25=sleep:on",
    silent: "22:25=on",
    volume: "22:25=0",
  }],
  ["长假尾巴", "2026-07-17", { holiday: HOL }, {
    dayType: "rest_long/off/rest/home",
    focus:  "22:25=sleep:on",
    silent: "22:25=on",
    volume: "22:25=0",
  }],
  ["出差日（全天事件: 无动态闹钟→吸附下限; 人不在家→夜间吸附 22:25）", "2026-07-28",
   { trip: ["2026-07-27", "2026-07-28"] }, {
    dayType: "work/off/workday/away",  // ★ noon=off: 出差占了午间区带，没有午间两键
    focus:  "07:44=sleep:off 22:25=sleep:on",   // 全天事件无动态闹钟 → 解除吸附到下限 07:44
    silent: "07:44=off 22:25=on",               // 夜间 away → 吸附到 22:25，不新建刺客
    volume: "07:44=∅ 22:25=0",
  }],
  ["请假日（短假晨碰）", "2026-07-22", { leave: ["2026-07-22"] }, {
    dayType: "leave_short/off/workday/home",
    focus:  "07:44=sleep:off 20:55=sleep:on",
    silent: "07:44=off 20:55=on",
    volume: "07:44=∅ 20:55=0",
  }],
];

for (const [label, date, opts, want] of EXPECT) {
  test(`日型覆盖: ${label}`, async () => {
    assert.deepEqual(await scene(date, opts), want);
  });
}

// ── 动态锚定: 带具体时间的出差事件 ───────────────────────────────────────────
test("★ 出差事件有具体时间 → 解除锚定到闹钟后 20 分钟（08:10 → 08:30）", async () => {
  const got = await scene("2026-07-29", {
    trip: [{ title: "出差", date: "2026-07-29", start_time: "08:10", end_time: "18:00" }],
  });
  assert.match(got.focus, /^08:30=sleep:off/);           // 动态时刻，靠门铃投递
  assert.match(got.silent, /^08:30=off/);                // silent 跟着一起延后
  assert.match(got.volume, /^08:30=∅/);
});

// ── night 轴: 今晚人不在家 → 夜间进入安静整体延后（Ivan 2026-07-31）─────────
test("★ 出差覆盖到傍晚 → 夜间从 20:55 延到 22:25（吸附已有刺客）", async () => {
  const away = await scene("2026-07-29", {
    trip: [{ title: "出差", date: "2026-07-29", start_time: "08:10", end_time: "22:00" }],
  });
  assert.match(away.dayType, /\/away$/);
  assert.match(away.focus, /22:25=sleep:on$/);     // 吸附到已有刺客，不新建 21:30
  assert.match(away.silent, /22:25=on$/);          // 三个字段一起延后
  assert.match(away.volume, /22:25=0$/);
});

test("★ 反例: 出差最后一天傍晚已到家 → 仍是 20:55，不延后", async () => {
  const home = await scene("2026-07-29", {
    trip: [{ title: "出差", date: "2026-07-29", start_time: "08:10", end_time: "15:00" }],
  });
  assert.match(home.dayType, /\/home$/);           // 事件 15:00 就结束了，晚上在家
  assert.match(home.focus, /20:55=sleep:on$/);
});

test("反例: 不在家时不看明天上不上班（away 一律 22:25）", async () => {
  const friday = await scene("2026-07-31", {      // 周五，明天休息，在家本该 22:25
    trip: [{ title: "出差", date: "2026-07-31", start_time: "08:10", end_time: "22:00" }],
  });
  assert.match(friday.dayType, /\/rest\/away$/);   // eve=rest 且 night=away，两条变体互斥
  assert.match(friday.focus, /22:25=sleep:on$/);   // 同一时刻，走 away 那条变体
});

test("反例: 三个字段的晨间解除时刻必须一致（共用同一份骨架，不许各走各的）", async () => {
  for (const [, date, opts] of EXPECT) {
    const g = await scene(date, opts);
    const hm = (s) => (s.split(" ")[0] || "").split("=")[0];
    assert.equal(hm(g.silent), hm(g.focus), `${date} silent 与 focus 解除时刻不一致`);
    assert.equal(hm(g.volume), hm(g.focus), `${date} volume 与 focus 解除时刻不一致`);
  }
});
