// ─────────────────────────────────────────────────────────────────────────────
// test/plugins/quiet.e2e.test.js — 三件套全链路场景（V12 步骤②契约验证）
// 夹具日历: 2026-07 第三周，周一13 … 周日19；法定 = 自然周末
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, sampleTimeline } from "../../src/kernel/registry.js";
import { sampleSegment, addDays } from "../../src/kernel/intervals.js";
import restdays from "../../src/plugins/restdays.js";
import presence from "../../src/plugins/presence.js";
import quiet from "../../src/plugins/quiet.js";

// ── 夹具 ─────────────────────────────────────────────────────────────────────
const CONFIG = {
  ZONES: {
    MORNING: { start: "06:00", end: "08:00" },
    NOON:    { start: "12:15", end: "13:15" },
    EVENING: { start: "15:59", end: "17:30" },
  },
  DND: {
    NIGHT_ON_WORKDAY_EVE: "20:55", NIGHT_ON_REST_EVE: "22:25",
    MORNING_OFF_WORKDAY: "07:40",  MORNING_OFF_WEEKEND: "09:30",
    NOON_ON: "12:15", NOON_OFF: "13:29",
  },
  LONG_REST_DAYS: 3,
  MANUAL_HOLIDAYS: [],
  KEYWORDS: {
    GOD_MODE: ["上帝模式"], LEAVE: ["休假", "请假", "年假"],
    WORK_EVENT: ["出差", "会议", "外勤"],
  },
};

// 自然周末的 workdays 事实（2026-06-29 ~ 2026-08-02，覆盖块扫描 ±14 天）
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
  return buildTimeline({ plugins: [quiet, presence, restdays], ctx, range }); // 故意乱序传入
}

// ── 场景A: 平凡工作日 ────────────────────────────────────────────────────────
test("场景A 工作日三日: 07:40关/午间两键/20:55开，正典迟到采样命中", () => {
  const { schedules, failed } = run([], { start: "2026-07-14", end: "2026-07-16" });
  assert.deepEqual(failed, []);
  const day = (d) => schedules.quiet.filter((s) => s.from.startsWith(d));
  assert.deepEqual(day("2026-07-15"), [
    { from: "2026-07-15 07:40", value: "off" },
    { from: "2026-07-15 12:15", value: "on" },
    { from: "2026-07-15 13:29", value: "off" },
    { from: "2026-07-15 20:55", value: "on" },
  ]);
  // 正典 e2e: 昨晚 20:55 静音，凌晨 01:30 采样 → on（迟到采样天然正确）
  assert.equal(sampleSegment(schedules.quiet, "2026-07-15 01:30").value, "on");
});

// ── 场景B: 周五→周末 ─────────────────────────────────────────────────────────
test("场景B 周末: 周五夜22:25，周六周日09:30解除，无午间键", () => {
  const { schedules } = run([], { start: "2026-07-17", end: "2026-07-19" });
  const q = schedules.quiet;
  assert.ok(q.some((s) => s.from === "2026-07-17 22:25" && s.value === "on"));   // R6.1 明天休
  assert.ok(q.some((s) => s.from === "2026-07-18 09:30" && s.value === "off"));  // R6.2d
  assert.ok(!q.some((s) => s.from.startsWith("2026-07-18 12:15")));              // 周末无午间键
  assert.ok(q.some((s) => s.from === "2026-07-19 20:55" && s.value === "on"));   // 周日夜: 明天上班
});

// ── 场景C: 周五全天年假 → 3天长假块 ─────────────────────────────────────────
test("场景C 长假块: R6.2b早解除 + R6.2c白天释放主张 + 夜夜重进", () => {
  const leave = [{ date: "2026-07-17", title: "[年假]", all_day: true,
                   start_time: null, end_time: null }];
  const { schedules } = run(leave, { start: "2026-07-17", end: "2026-07-19" });
  // presence: 周五全天 leave 三区全中，块=3
  const p = sampleSegment(schedules.presence, "2026-07-17 00:00").value;
  assert.equal(p.morning, "leave");
  assert.equal(p.rest, true);
  assert.equal(p.block, 3);
  // quiet 全表: 周五 07:40 off（R6.2b）+ 22:25 on; 周六周日块≥3 → 早晨 09:30 释放
  // 主张(null, 白天归人管), 夜间 null→on 为真变化 → 每晚重进安静（对齐 v1 刺客夜夜点火）
  assert.deepEqual(schedules.quiet, [
    { from: "2026-07-17 07:40", value: "off" },
    { from: "2026-07-17 22:25", value: "on" },
    { from: "2026-07-18 09:30", value: null },
    { from: "2026-07-18 22:25", value: "on" },
    { from: "2026-07-19 09:30", value: null },
    { from: "2026-07-19 20:55", value: "on" },   // 周日夜: 明天周一上班 → 工作日前夜键
  ]);
  // 长假中段周六上午采样 → null（无主张=手机不动=依然绝不吵醒; 手动状态存活）
  assert.equal(sampleSegment(schedules.quiet, "2026-07-18 10:30").value, null);
  // 深夜采样 → on（夜间重进生效）
  assert.equal(sampleSegment(schedules.quiet, "2026-07-18 23:00").value, "on");
});

// ── 场景D: 半天假（午后 13:00–18:00）────────────────────────────────────────
test("场景D 半天假: 晨间正常上班半天07:40解除，午间键静默，不算整休息日", () => {
  const leave = [{ date: "2026-07-15", title: "请假", all_day: false,
                   start_time: "13:00", end_time: "18:00" }];
  const { schedules } = run(leave, { start: "2026-07-15", end: "2026-07-15" });
  const p = sampleSegment(schedules.presence, "2026-07-15 00:00").value;
  assert.deepEqual(
    { morning: p.morning, noon: p.noon, evening: p.evening, rest: p.rest },
    { morning: "work", noon: "leave", evening: "leave", rest: false },
  );
  assert.deepEqual(schedules.quiet, [
    { from: "2026-07-15 07:40", value: "off" },   // R6.2e 正常上班半天
    { from: "2026-07-15 20:55", value: "on" },    // 无午间键（R6.3 被碰撞静默）
  ]);
});

// ── 场景E: 晨间会议（work_event）────────────────────────────────────────────
test("场景E 晨间会议: presence=out，DND 照常 07:40 解除（R6.2e）", () => {
  const events = [{ date: "2026-07-15", title: "【会议】", all_day: false,
                    start_time: "07:30", end_time: "09:00" }];
  const { schedules } = run(events, { start: "2026-07-15", end: "2026-07-15" });
  const p = sampleSegment(schedules.presence, "2026-07-15 00:00").value;
  assert.equal(p.morning, "out");
  assert.ok(schedules.quiet.some((s) => s.from === "2026-07-15 07:40" && s.value === "off"));
});

// ── 场景F: 同区 leave 与 work_event 并存 → leave 优先 ───────────────────────
test("场景F 裁决优先级: leave > out", () => {
  const events = [
    { date: "2026-07-15", title: "[请假]", all_day: false, start_time: "07:00", end_time: "08:00" },
    { date: "2026-07-15", title: "[会议]", all_day: false, start_time: "07:30", end_time: "09:00" },
  ];
  const { schedules } = run(events, { start: "2026-07-15", end: "2026-07-15" });
  assert.equal(sampleSegment(schedules.presence, "2026-07-15 00:00").value.morning, "leave");
});

// ── 双模采样接线 ─────────────────────────────────────────────────────────────
test("sampleTimeline: segment 与 point 两种问法出自同一份数据", () => {
  const { schedules } = run([], { start: "2026-07-15", end: "2026-07-15" });
  const seg = sampleTimeline(schedules, "2026-07-15 13:00");
  assert.equal(seg.quiet.value, "on");                       // 午休静音中
  const pt = sampleTimeline(schedules, "2026-07-15 13:30", { mode: "point" });
  assert.deepEqual(pt.quiet, [
    { at: "2026-07-15 13:29", value: "off", previous: "on" },
  ]);
});
