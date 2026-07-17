// ─────────────────────────────────────────────────────────────────────────────
// test/plugins/alarms.e2e.test.js — 步骤④闹钟全链路（R1/R2/R3/R4/R5 保真回归）
// 经 /v2 HTTP 走全管线（假 loader 无网络）。夹具日历同 quiet.e2e:
// 2026-07 第三周; 07-01 起为暑假(summer)。
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import { handleV2 } from "../../src/edge/router.js";
import { addDays } from "../../src/kernel/intervals.js";

function loaders(extra = {}) {
  return {
    async loadWorkdays() {
      const out = [];
      for (let d = "2026-06-29"; d <= "2026-08-02"; d = addDays(d, 1)) {
        const w = new Date(d + "T00:00:00Z").getUTCDay();
        out.push({ date: d, off: w === 0 || w === 6, name: w === 6 ? "周六" : w === 0 ? "周日" : "" });
      }
      return out;
    },
    async loadCalendars() { return []; },
    async loadExternalAlarms() { return []; },
    async loadFacts() { return { streams: {}, degraded: [] }; },
    ...extra,
  };
}
const call = async (qs, ld) => {
  const res = await handleV2(new Request(`https://x.dev/v2/state?${qs}`), {}, "/state", ld || loaders());
  return res.json();
};
const on = (b, label) => b.alarms.fixed.find((a) => a.label === label)?.action === "on";

test("R2.1 暑假工作日: SchoolBreak 起床组(含副铃) + 午休/下班铃; Workday 组 off", async () => {
  const b = await call("date=2026-07-15&now=20:00");   // 周三晚, 窗口覆盖周四早
  assert.ok(on(b, "Gate-Fixed-SchoolBreak-WakeUp-Vib"));
  assert.ok(on(b, "Gate-Fixed-SchoolBreak-WakeUp-Ring"));   // BUNDLED 联动
  assert.ok(on(b, "Gate-Fixed-Workday-NapEnd-Vib"));
  assert.ok(on(b, "Gate-Fixed-Workday-OffWork-Vib"));
  assert.ok(!on(b, "Gate-Fixed-Workday-WakeUp-Vib"));       // 暑假换组
});

test("R2.2/R2.3 非假期节后首日: Workday 组 + FirstWorkday 兜底并行", async () => {
  // 用 testEvents 无法关掉暑假，改锚到 9 月: 周一 2026-09-14, 昨日周日休
  const ld = loaders({ async loadWorkdays() {
    const out = [];
    for (let d = "2026-08-31"; d <= "2026-09-27"; d = addDays(d, 1)) {
      const w = new Date(d + "T00:00:00Z").getUTCDay();
      out.push({ date: d, off: w === 0 || w === 6, name: "" });
    }
    return out;
  } });
  const b = await call("date=2026-09-13&now=21:00", ld);     // 周日晚, 窗口含周一早
  assert.ok(on(b, "Gate-Fixed-Workday-WakeUp-Vib"));
  assert.ok(on(b, "Gate-Fixed-Workday-WakeUp-Ring"));
  assert.ok(on(b, "Gate-Fixed-FirstWorkday-WakeUp-Ring"));   // R2.3
});

test("R3 周六舞蹈课(合并后课表 id=Sat-Dance): 暑假==锚走固定; 寒假未配时段不上课", async () => {
  const b = await call("date=2026-07-17&now=22:00");         // 周五晚, 窗口含周六 07:45
  assert.ok(on(b, "Gate-Fixed-Class-Sat-Dance"));            // R3.1a summer 07:45==锚
  const w = await call("date=2026-01-23&now=22:00", loaders({ async loadWorkdays() {
    const out = [];
    for (let d = "2026-01-05"; d <= "2026-02-22"; d = addDays(d, 1)) {
      const wd = new Date(d + "T00:00:00Z").getUTCDay();
      out.push({ date: d, off: wd === 0 || wd === 6, name: "" });
    }
    return out;
  } }));                                                     // 2026-01-24 周六, 寒假(winter 未配)
  assert.ok(!on(w, "Gate-Fixed-Class-Sat-Dance"));           // R3.3 该时段不上课
  assert.ok(!w.alarms.dynamic.some((a) => a.label.startsWith("Gate-Class")));
});

test("R4 全天请假: 早间组/午休/下班全灭, 但夜里窗口内明天照常", async () => {
  const ld = loaders({ async loadCalendars(env, opts, span) {
    const s = await import("../../src/edge/sources.js");
    return s.resolveInstances(
      [{ title: "[年假]", startDate: "2026-07-15", endDate: "2026-07-16" }],
      span.start, span.end);
  } });
  const noon = await call("date=2026-07-15&now=05:00", ld);   // 窗口=周三全天+周四凌晨
  assert.ok(!on(noon, "Gate-Fixed-SchoolBreak-WakeUp-Vib"));
  assert.ok(!on(noon, "Gate-Fixed-Workday-NapEnd-Vib"));
  assert.ok(!on(noon, "Gate-Fixed-Workday-OffWork-Vib"));
  const night = await call("date=2026-07-15&now=20:00", ld);  // 窗口滑进周四 → 周四正常 on
  assert.ok(on(night, "Gate-Fixed-SchoolBreak-WakeUp-Vib"));
});

test("R5.1 晨间会议: 关早间组 + 建 Gate-Dynamic-Event-0730", async () => {
  const ld = loaders({ async loadCalendars(env, opts, span) {
    const s = await import("../../src/edge/sources.js");
    return s.resolveInstances(
      [{ title: "[会议]", startDate: "2026-07-15", startTime: "07:30", endTime: "09:00", endDate: "2026-07-15" }],
      span.start, span.end);
  } });
  const b = await call("date=2026-07-14&now=20:00", ld);      // 周二晚, 窗口含周三早
  assert.ok(!on(b, "Gate-Fixed-SchoolBreak-WakeUp-Vib"));     // 晨间碰撞不注入
  assert.deepEqual(b.alarms.dynamic.filter((a) => a.label.startsWith("Gate-Dynamic-Event")),
    [{ label: "Gate-Dynamic-Event-0730", at: "2026-07-15 07:30", reason: "[会议]" }]);
  assert.ok(on(b, "Gate-Fixed-Workday-NapEnd-Vib"));          // 午休/下班不受晨间碰撞影响
});

test("R1 上帝模式: 当日完全接管（闹钟集合与 quiet 全按 JSON）", async () => {
  const god = JSON.stringify({
    fixedAlarms: [{ label: "Gate-Fixed-Workday-WakeUp-Vib", action: "ON" }],
    dynamicAlarms: [{ label: "Gate-Dynamic-Event-0611", time: "06:11", reason: "god" }],
    dnd_schedule: { "21:00": "ON", "06:00": "OFF" },
  });
  const ld = loaders({ async loadCalendars(env, opts, span) {
    const s = await import("../../src/edge/sources.js");
    return s.resolveInstances(
      [{ title: "[上帝模式]", startDate: "2026-07-15", endDate: "2026-07-16", description: god }],
      span.start, span.end);
  } });
  const b = await call("date=2026-07-15&now=05:00&debug=1", ld);
  assert.ok(on(b, "Gate-Fixed-Workday-WakeUp-Vib"));          // 暑假日却按 god 开 Workday 组
  assert.ok(!on(b, "Gate-Fixed-SchoolBreak-WakeUp-Vib"));     // 常规 R2.1 被旁路
  assert.ok(!on(b, "Gate-Fixed-Workday-NapEnd-Vib"));         // god 没给 → off
  assert.ok(b.alarms.dynamic.some((a) => a.label === "Gate-Dynamic-Event-0611"));
  const q = b.schedules.quiet.filter((s) => s.from.startsWith("2026-07-15"));
  assert.deepEqual(q, [
    { from: "2026-07-15 06:00", value: "off" },
    { from: "2026-07-15 21:00", value: "on" },
  ]);
});

test("外部闹钟: 时区换算跨天 + uid 编入标签 + 窗口裁剪", async () => {
  const ld = loaders({ async loadExternalAlarms() {
    return [
      { code: "hsbc", uid: "bill#77", date: "2026-07-15", time: "22:30", tz: "UTC", reason: "repay" },
      { code: "hsbc", uid: "old", date: "2026-07-14", time: "09:00", tz: null, reason: "过期" },
    ];
  } });
  const b = await call("date=2026-07-15&now=20:00", ld);
  // UTC 22:30 → 上海 07-16 06:30, 在窗口内; uid 净化 bill-77
  assert.deepEqual(b.alarms.dynamic.filter((a) => a.label.startsWith("Gate-ES")),
    [{ label: "Gate-ES-hsbc-bill-77-0630", at: "2026-07-16 06:30", reason: "repay" }]);
});

test("audit: quiet 边界白名单一致性告警可见", async () => {
  // 06:07 off 相对前夜 on 是真变化(保留)；纯同值边界(如 21:03 on 接 20:55 on)会被
  // 归一化合并吃掉、审计不可见 —— 那是 level 语义的正确行为，不是漏报。
  const god = JSON.stringify({ dnd_schedule: { "06:07": "OFF", "21:03": "ON" } });
  const ld = loaders({ async loadCalendars(env, opts, span) {
    const s = await import("../../src/edge/sources.js");
    return s.resolveInstances(
      [{ title: "[上帝模式]", startDate: "2026-07-15", endDate: "2026-07-16", description: god }],
      span.start, span.end);
  } });
  const b = await call("date=2026-07-15&now=05:00", ld);
  assert.ok(b.trace.some((t) => t.includes("quiet_boundary_off_whitelist") && t.includes("21:03")));
});
