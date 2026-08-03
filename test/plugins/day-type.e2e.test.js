// ─────────────────────────────────────────────────────────────────────────────
// test/plugins/day-type.e2e.test.js — 日型分类器全链路场景
// ─────────────────────────────────────────────────────────────────────────────
// 前身是 quiet.e2e.test.js。第③步后 quiet 退役，它那套 R6.1–R6.3 的分支判定
// 全部搬进 day-type 的三根正交轴，这里把原来的七个场景【逐条移植】过来 ——
// 退役一个插件不该顺手丢掉它的覆盖。
//   morning: work | leave_short | leave_long_tail | rest_short | rest_long
//   noon:    work | off          eve: workday | rest
// 夹具日历: 2026-07 第三周，周一13 … 周日19；法定 = 自然周末
import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, sampleTimeline } from "../../src/kernel/registry.js";
import { sampleSegment, addDays } from "../../src/kernel/intervals.js";
import restdays from "../../src/plugins/restdays.js";
import presence from "../../src/plugins/presence.js";
import dayType from "../../src/plugins/day-type.js";

const CONFIG = {
  ZONES: {
    MORNING: { start: "06:00", end: "08:00" },
    NOON:    { start: "12:15", end: "13:15" },
    EVENING: { start: "15:59", end: "17:30" },
  },
  LONG_REST_DAYS: 3,
  MANUAL_HOLIDAYS: [],
  KEYWORDS: {
    GOD_MODE: ["上帝模式"], LEAVE: ["休假", "请假", "年假"],
    WORK_EVENT: ["出差", "会议", "外勤"],
  },
};

function makeWorkdays() {
  const out = [];
  for (let d = "2026-06-29"; d <= "2026-08-02"; d = addDays(d, 1)) {
    const w = new Date(d + "T00:00:00Z").getUTCDay();
    out.push({ date: d, off: w === 0 || w === 6, name: w === 6 ? "周六" : w === 0 ? "周日" : "" });
  }
  return out;
}
function run(calendars, range) {
  const ctx = { config: CONFIG, profile: "default", workdays: makeWorkdays(), calendars, facts: {} };
  return buildTimeline({ plugins: [dayType, presence, restdays], ctx, range });  // 故意乱序传入
}
const axes = (schedules, d) => {
  const v = sampleSegment(schedules.day_type, `${d} 12:00`).value;
  return v && { morning: v.morning, noon: v.noon, eve: v.eve };
};

test("场景A 平凡工作日: work / work / workday", () => {
  const { schedules, failed } = run([], { start: "2026-07-14", end: "2026-07-16" });
  assert.deepEqual(failed, []);
  assert.deepEqual(axes(schedules, "2026-07-15"), { morning: "work", noon: "work", eve: "workday" });
});

test("场景B 周末: 周五 eve=rest；周六周日 rest_short 且午间关闭；周日夜 eve=workday", () => {
  const { schedules } = run([], { start: "2026-07-17", end: "2026-07-19" });
  assert.equal(axes(schedules, "2026-07-17").eve, "rest");        // 明天休 → 晚点进
  assert.deepEqual(axes(schedules, "2026-07-18"),
    { morning: "rest_short", noon: "off", eve: "rest" });         // 周末无午间键
  assert.equal(axes(schedules, "2026-07-19").eve, "workday");     // 周日夜: 明天上班
});

test("场景C 长假块(周五年假→3天): 首日 leave_short，中段 rest_long", () => {
  const leave = [{ date: "2026-07-17", title: "[年假]", all_day: true,
                   start_time: null, end_time: null }];
  const { schedules } = run(leave, { start: "2026-07-17", end: "2026-07-19" });
  const p = sampleSegment(schedules.presence, "2026-07-17 00:00").value;
  assert.equal(p.morning, "leave");
  assert.equal(p.rest, true);
  assert.equal(p.block, 3);
  // 周五本身: 昨日(周四)块=0 < 3 → leave_short → 照常早解除
  assert.equal(axes(schedules, "2026-07-17").morning, "leave_short");
  // 周六周日: 身处 ≥3 天块中 → rest_long → 晨间只释放主张，绝不吵醒
  assert.equal(axes(schedules, "2026-07-18").morning, "rest_long");
  assert.equal(axes(schedules, "2026-07-19").morning, "rest_long");
});

test("场景D 半天假(午后): 晨间仍 work，午间因碰撞关闭，不算整休息日", () => {
  const leave = [{ date: "2026-07-15", title: "请假", all_day: false,
                   start_time: "13:00", end_time: "18:00" }];
  const { schedules } = run(leave, { start: "2026-07-15", end: "2026-07-15" });
  const p = sampleSegment(schedules.presence, "2026-07-15 00:00").value;
  assert.deepEqual(
    { morning: p.morning, noon: p.noon, evening: p.evening, rest: p.rest },
    { morning: "work", noon: "leave", evening: "leave", rest: false },
  );
  assert.deepEqual(axes(schedules, "2026-07-15"),
    { morning: "work", noon: "off", eve: "workday" });
});

test("场景E 晨间会议(work_event): presence=out，但日型仍是 work（照常早解除）", () => {
  const events = [{ date: "2026-07-15", title: "【会议】", all_day: false,
                    start_time: "07:30", end_time: "09:00" }];
  const { schedules } = run(events, { start: "2026-07-15", end: "2026-07-15" });
  assert.equal(sampleSegment(schedules.presence, "2026-07-15 00:00").value.morning, "out");
  assert.equal(axes(schedules, "2026-07-15").morning, "work");
});

test("场景F 裁决优先级: 同区 leave 与 work_event 并存 → leave 优先", () => {
  const events = [
    { date: "2026-07-15", title: "[请假]", all_day: false, start_time: "07:00", end_time: "08:00" },
    { date: "2026-07-15", title: "[会议]", all_day: false, start_time: "07:30", end_time: "09:00" },
  ];
  const { schedules } = run(events, { start: "2026-07-15", end: "2026-07-15" });
  assert.equal(sampleSegment(schedules.presence, "2026-07-15 00:00").value.morning, "leave");
  assert.equal(axes(schedules, "2026-07-15").morning, "leave_short");
});

test("日型是电平流: 相邻同型的日子会被归一化合并（采样而不是找边界）", () => {
  const { schedules } = run([], { start: "2026-07-13", end: "2026-07-16" });
  // 周一到周四日型完全相同 → 只留一条边界
  assert.equal(schedules.day_type.filter((s) => s.from <= "2026-07-16 23:59").length, 1);
  // 但采样任何一天都拿得到
  for (const d of ["2026-07-14", "2026-07-15", "2026-07-16"]) {
    assert.equal(axes(schedules, d).morning, "work");
  }
});

test("sampleTimeline: segment 与 point 两种问法出自同一份数据", () => {
  const { schedules } = run([], { start: "2026-07-15", end: "2026-07-15" });
  const seg = sampleTimeline(schedules, "2026-07-15 13:00");
  assert.equal(seg.day_type.value.noon, "work");
  const pt = sampleTimeline(schedules, "2026-07-15 00:00", { mode: "point" });
  assert.ok(Array.isArray(pt.day_type));
});
