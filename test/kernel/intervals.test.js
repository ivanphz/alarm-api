// ─────────────────────────────────────────────────────────────────────────────
// test/kernel/intervals.test.js — 区间代数测试（KERNEL §16: 先有测试后有消费者）
// 运行: node --test
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import {
  isTime, cmp, addMinutes, addDays, dayOfWeek, canonical, valueEquals,
  validate, normalize, sampleSegment, samplePoint, clampToRange, stack,
} from "../../src/kernel/intervals.js";

// ── 时间平面 ─────────────────────────────────────────────────────────────────

test("时间格式：合法与非法", () => {
  assert.ok(isTime("2026-07-16 20:55"));
  assert.ok(!isTime("2026-07-16T20:55"));   // ISO T 分隔不收
  assert.ok(!isTime("2026-7-16 8:55"));     // 必须零填充（字典序的前提）
  assert.ok(!isTime(null));
});

test("字典序即时间序", () => {
  assert.ok(cmp("2026-07-16 23:59", "2026-07-17 00:00") < 0); // 跨午夜
  assert.ok(cmp("2026-09-30 23:59", "2026-10-01 00:00") < 0); // 跨月且位数变化
  assert.equal(cmp("2026-07-16 08:00", "2026-07-16 08:00"), 0);
});

test("addMinutes：跨午夜与跨年", () => {
  assert.equal(addMinutes("2026-07-16 23:58", 3), "2026-07-17 00:01");
  assert.equal(addMinutes("2026-07-17 00:01", -3), "2026-07-16 23:58");
  assert.equal(addMinutes("2026-12-31 23:59", 2), "2027-01-01 00:01");
});

// ── 值语义 ───────────────────────────────────────────────────────────────────

test("canonical：对象键序无关（last_applied 比较基座）", () => {
  const a = { mode: "do_not_disturb", action: "on" };
  const b = { action: "on", mode: "do_not_disturb" };
  assert.equal(canonical(a), canonical(b));
  assert.ok(valueEquals(a, b));
  assert.ok(!valueEquals(a, { mode: "sleep", action: "on" }));
});

// ── 校验（契约6）────────────────────────────────────────────────────────────

test("validate：重复 from = producer bug，错误即数据不抛", () => {
  const r = validate([
    { from: "2026-07-16 20:55", value: "on" },
    { from: "2026-07-16 20:55", value: "off" },
    { from: "2026-07-16 99:99", value: "on" },
    { from: "2026-07-17 07:40" },
  ]);
  assert.equal(r.ok, false);
  const codes = r.errors.map((e) => e.code).sort();
  assert.deepEqual(codes, ["bad_from", "duplicate_from", "missing_value"]);
  assert.equal(validate("oops").ok, false);
});

// ── 归一化（契约8）──────────────────────────────────────────────────────────

test("normalize：乱序输入排序，相邻同值合并（含对象值、null 连段）", () => {
  const out = normalize([
    { from: "2026-07-16 22:00", value: { mode: "do_not_disturb", action: "on" } },
    { from: "2026-07-16 20:55", value: "on" },
    { from: "2026-07-16 21:30", value: "on" },                     // 与 20:55 同值 → 并
    { from: "2026-07-17 07:40", value: null },
    { from: "2026-07-17 09:00", value: null },                     // null 连段 → 并
  ]);
  assert.deepEqual(out.map((s) => s.from), [
    "2026-07-16 20:55", "2026-07-16 22:00", "2026-07-17 07:40",
  ]);
});

// ── segment 采样（契约2：本次重构的正典场景）────────────────────────────────

test("正典：1点静音，触发器1点半才跑 → silent=on 而非 null", () => {
  const silent = [
    { from: "2026-07-16 01:00", value: "on" },
    { from: "2026-07-16 07:00", value: "off" },
  ];
  const r = sampleSegment(silent, "2026-07-16 01:30");
  assert.equal(r.value, "on");
  assert.equal(r.from, "2026-07-16 01:00"); // 归因：来自 1:00 边界
});

test("首段之前 = 无主张（null 永不表示'迟到了'）", () => {
  const r = sampleSegment([{ from: "2026-07-16 20:55", value: "on" }], "2026-07-16 08:00");
  assert.equal(r.value, null);
  assert.equal(r.from, null);
});

test("跨午夜连续（22:25 on → 次日 07:40 off，凌晨采样仍 on）", () => {
  const quiet = [
    { from: "2026-07-16 22:25", value: "on" },
    { from: "2026-07-17 07:40", value: "off" },
  ];
  assert.equal(sampleSegment(quiet, "2026-07-17 03:00").value, "on");
  assert.equal(sampleSegment(quiet, "2026-07-17 07:40").value, "off"); // 边界含 from
});

// ── point 采样 ───────────────────────────────────────────────────────────────

test("point：±3 分钟容差的命中与未中", () => {
  const quiet = [
    { from: "2026-07-16 20:55", value: "on" },
    { from: "2026-07-17 07:40", value: "off" },
  ];
  // 过去侧：07:42 采样命中 07:40 边界，previous 归因正确
  assert.deepEqual(samplePoint(quiet, "2026-07-17 07:42"), [
    { at: "2026-07-17 07:40", value: "off", previous: "on" },
  ]);
  // 未来侧：07:38 采样命中
  assert.equal(samplePoint(quiet, "2026-07-17 07:38").length, 1);
  // 窗口外：07:44 未中
  assert.equal(samplePoint(quiet, "2026-07-17 07:44").length, 0);
  // 容差参数可调（KERNEL §6：参数属于采样端）
  assert.equal(samplePoint(quiet, "2026-07-17 07:44", { pastMinutes: 5 }).length, 1);
});

test("point：只报'值变化'——首段非空是变化，null 段维持 null 不是", () => {
  const s = [
    { from: "2026-07-16 08:00", value: null },   // 显式无主张，相对隐式 null 非变化
    { from: "2026-07-16 09:00", value: "on" },   // null → on 是变化
  ];
  assert.equal(samplePoint(s, "2026-07-16 08:01").length, 0);
  assert.deepEqual(samplePoint(s, "2026-07-16 09:01"), [
    { at: "2026-07-16 09:00", value: "on", previous: null },
  ]);
});

// ── 裁剪（LOOKBACK 的正式替代）──────────────────────────────────────────────

test("clampToRange：昨夜 22:00 的 on 在今日 00:00 重新锚定", () => {
  const s = [
    { from: "2026-07-15 22:00", value: "on" },
    { from: "2026-07-16 07:40", value: "off" },
    { from: "2026-07-17 22:00", value: "on" },
  ];
  const out = clampToRange(s, "2026-07-16 00:00", "2026-07-17 00:00");
  assert.deepEqual(out, [
    { from: "2026-07-16 00:00", value: "on" },   // 锚定段承载范围外历史
    { from: "2026-07-16 07:40", value: "off" },
  ]);
});

// ── 三层叠加（契约8）────────────────────────────────────────────────────────

test("stack：OWN > overlay > base，null 放行，overlay 结束后 base 复位", () => {
  const base = [
    { from: "2026-07-16 20:00", value: "on" },
    { from: "2026-07-17 07:00", value: "off" },
  ];
  const overlay = [                                  // god-mode: 22:00–23:00 强制 off
    { from: "2026-07-16 22:00", value: "off" },
    { from: "2026-07-16 23:00", value: null },       // 释放主张
  ];
  const own = [];                                    // 无 OWN
  assert.deepEqual(stack([own, overlay, base]), [
    { from: "2026-07-16 20:00", value: "on" },
    { from: "2026-07-16 22:00", value: "off" },      // overlay 覆盖
    { from: "2026-07-16 23:00", value: "on" },       // 释放 → base 复位
    { from: "2026-07-17 07:00", value: "off" },
  ]);
});

test("stack：全层无主张 → null", () => {
  const out = stack([[], [{ from: "2026-07-16 10:00", value: null }], []]);
  assert.deepEqual(out, [{ from: "2026-07-16 10:00", value: null }]);
});

test("addDays / dayOfWeek：日期平面算术", () => {
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(dayOfWeek("2026-07-18"), 6);   // 周六
  assert.equal(dayOfWeek("2026-07-19"), 0);   // 周日
});
