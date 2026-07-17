// test/edge/sources.test.js — 日实例解算（RRULE/exclusive-DTEND 挡在 edge）
import test from "node:test";
import assert from "node:assert/strict";
import { resolveInstances, parseUrlList } from "../../src/edge/sources.js";

test("全天事件 DTEND exclusive: 只落在起始日", () => {
  const ev = { title: "[年假]", startDate: "2026-07-17", endDate: "2026-07-18" };
  const inst = resolveInstances([ev], "2026-07-16", "2026-07-19");
  assert.deepEqual(inst.map((i) => i.date), ["2026-07-17"]);
  assert.equal(inst[0].all_day, true);
  assert.equal(inst[0].start_time, null);
});

test("跨天全天事件: exclusive 次日不含", () => {
  const ev = { title: "[休假]", startDate: "2026-07-16", endDate: "2026-07-19" }; // 16,17,18
  const inst = resolveInstances([ev], "2026-07-15", "2026-07-20");
  assert.deepEqual(inst.map((i) => i.date), ["2026-07-16", "2026-07-17", "2026-07-18"]);
});

test("带时分事件跨天: DTEND 真实结束日含端", () => {
  const ev = { title: "[出差]", startDate: "2026-07-16", endDate: "2026-07-17",
               startTime: "18:00", endTime: "09:00" };
  const inst = resolveInstances([ev], "2026-07-15", "2026-07-18");
  assert.deepEqual(inst.map((i) => i.date), ["2026-07-16", "2026-07-17"]);
  assert.equal(inst[0].all_day, false);
});

test("parseUrlList 宽容解析", () => {
  assert.equal(parseUrlList("https://a.com/x.ics,\n https://b.com/y.ics").length, 2);
  assert.equal(parseUrlList('["https://a.com/x.ics"]').length, 1);
  assert.equal(parseUrlList("webcal-nope").length, 0);
});
