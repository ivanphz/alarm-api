// test/kernel/fields.test.js — 五旋钮渲染（V11 语义移植回归）
import test from "node:test";
import assert from "node:assert/strict";
import { buildFieldTimeline } from "../../src/kernel/fields.js";

const R = { start: "2026-07-15", end: "2026-07-15" };
const quiet = [
  { from: "2026-07-15 07:40", value: "off" },
  { from: "2026-07-15 12:15", value: "on" },
  { from: "2026-07-15 13:29", value: "off" },
  { from: "2026-07-15 20:55", value: "on" },
];

test("focus: 订阅 quiet，token 升成 focus 对象（mode 用 token 永不带本地化名）", () => {
  const t = buildFieldTimeline(
    { KIND: "focus", USE: "quiet", PRESET: "do_not_disturb", OWN: {} },
    { quiet }, R,
  );
  assert.deepEqual(t[0], { from: "2026-07-15 07:40",
    value: { preset: "do_not_disturb", action: "off", switch_to: null, only_if_current: null } });
  assert.equal(t.length, 4);
});

test("silent: SKIP 午间两键 → 边界移除前值延续，归一化合并", () => {
  const t = buildFieldTimeline(
    { KIND: "scalar", USE: "quiet", SKIP: ["12:15", "13:29"], OWN: {} },
    { quiet }, R,
  );
  assert.deepEqual(t, [
    { from: "2026-07-15 07:40", value: "off" },
    { from: "2026-07-15 20:55", value: "on" },
  ]);
});

test("OWN 守卫焊在订阅边界: action 继承规则，only_if_current 附着区间（契约3）", () => {
  const t = buildFieldTimeline(
    { KIND: "focus", USE: "quiet", PRESET: "do_not_disturb",
      OWN: { "07:40": { only_if_current: "do_not_disturb" } } },
    { quiet }, R,
  );
  const b = t.find((s) => s.from === "2026-07-15 07:40");
  assert.deepEqual(b.value, { preset: "do_not_disturb", action: "off",
    switch_to: null, only_if_current: "do_not_disturb" });
});

test("OWN 独立时刻换模式 + 简写字符串 + 同值吸收", () => {
  const t = buildFieldTimeline(
    { KIND: "focus", USE: "quiet", PRESET: "do_not_disturb",
      OWN: { "23:30": { preset: "sleep", action: "on" }, "22:00": "on", "06:00": "on" } },
    { quiet }, R,
  );
  assert.ok(t.some((s) => s.from === "2026-07-15 23:30" && s.value.preset === "sleep"));
  // 06:00 独立开（此前无主张 → 是变化，保留）
  assert.ok(t.some((s) => s.from === "2026-07-15 06:00" && s.value.action === "on"
    && s.value.preset === "do_not_disturb"));
  // 22:00 与 20:55 规则值完全同值 → 被归一化吸收（level 语义: 重申不是变化）
  assert.ok(!t.some((s) => s.from === "2026-07-15 22:00"));
});

test("OWN 压制: focus {action:null} 与 scalar null 都移除边界（前值延续）", () => {
  const f = buildFieldTimeline(
    { KIND: "focus", USE: "quiet", PRESET: "do_not_disturb", OWN: { "13:29": { action: null } } },
    { quiet }, R,
  );
  assert.ok(!f.some((s) => s.from === "2026-07-15 13:29"));
  const s = buildFieldTimeline(
    { KIND: "scalar", USE: "quiet", OWN: { "12:15": null } },
    { quiet }, R,
  );
  assert.ok(!s.some((x) => x.from === "2026-07-15 12:15"));
});

test("纯 OWN 字段（USE:null）: falsy 0 是合法主张，且含前一日展开", () => {
  const t = buildFieldTimeline(
    { KIND: "scalar", USE: null, OWN: { "20:55": 0 } },
    {}, R,
  );
  assert.deepEqual(t, [{ from: "2026-07-14 20:55", value: 0 }]);  // 相邻同值合并成首段
});

test("MAP: 规则 token → 字段 token（输出仍是 token，命名法约束）", () => {
  const t = buildFieldTimeline(
    { KIND: "scalar", USE: "quiet", MAP: { on: "muted", off: "ringing" }, OWN: {} },
    { quiet }, R,
  );
  assert.equal(t.find((s) => s.from === "2026-07-15 07:40").value, "ringing");
});
