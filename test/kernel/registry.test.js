// test/kernel/registry.test.js — 内核运行器: 拓扑/隔离/降级（契约9）
import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline } from "../../src/kernel/registry.js";

const seg = (from, value) => [{ from, value }];
const R = { start: "2026-07-15", end: "2026-07-15" };

test("拓扑: 传入顺序无关，依赖先行", () => {
  const order = [];
  const a = { name: "a", deps: [], produce: () => { order.push("a"); return seg("2026-07-15 08:00", 1); } };
  const b = { name: "b", deps: [{ name: "a", required: true }],
              produce: () => { order.push("b"); return seg("2026-07-15 09:00", 2); } };
  const { failed } = buildTimeline({ plugins: [b, a], ctx: {}, range: R });
  assert.deepEqual(order, ["a", "b"]);
  assert.deepEqual(failed, []);
});

test("隔离: 插件抛错 → 自身无主张，required 下游跳过，旁支不受影响", () => {
  const boom = { name: "boom", deps: [], produce: () => { throw new Error("炸"); } };
  const down = { name: "down", deps: [{ name: "boom", required: true }], produce: () => seg("2026-07-15 08:00", 1) };
  const side = { name: "side", deps: [], produce: () => seg("2026-07-15 08:00", "ok") };
  const { schedules, failed, trace } = buildTimeline({ plugins: [down, boom, side], ctx: {}, range: R });
  assert.deepEqual(schedules.boom, []);
  assert.deepEqual(schedules.down, []);
  assert.equal(schedules.side.length, 1);
  assert.deepEqual(failed.sort(), ["boom", "down"]);
  assert.ok(trace.some((t) => t.level === "error" && t.plugin === "boom" && t.ref === "produce_throw"));
  assert.ok(trace.some((t) => t.level === "warn" && t.plugin === "down" && t.ref === "dependency_failed"));
});

test("非法产物（重复 from）被拒收 = 无主张", () => {
  const bad = { name: "bad", deps: [], produce: () => [
    { from: "2026-07-15 08:00", value: 1 }, { from: "2026-07-15 08:00", value: 2 },
  ] };
  const { schedules, trace } = buildTimeline({ plugins: [bad], ctx: {}, range: R });
  assert.deepEqual(schedules.bad, []);
  assert.ok(trace.some((t) => t.ref === "invalid_product"));
});

test("optional 依赖失败不拖累下游", () => {
  const boom = { name: "boom", deps: [], produce: () => { throw new Error("x"); } };
  const down = { name: "down", deps: [{ name: "boom", required: false }],
                 produce: (ctx) => seg("2026-07-15 08:00", ctx.schedules.boom.length) };
  const { schedules, failed } = buildTimeline({ plugins: [boom, down], ctx: {}, range: R });
  assert.deepEqual(schedules.down, [{ from: "2026-07-15 08:00", value: 0 }]);
  assert.deepEqual(failed, ["boom"]);
});

test("依赖成环 → 整环无主张", () => {
  const a = { name: "a", deps: [{ name: "b", required: true }], produce: () => [] };
  const b = { name: "b", deps: [{ name: "a", required: true }], produce: () => [] };
  const { failed, trace } = buildTimeline({ plugins: [a, b], ctx: {}, range: R });
  assert.deepEqual(failed.sort(), ["a", "b"]);
  assert.ok(trace.filter((t) => t.ref === "dependency_cycle").length === 2);
});
