// test/edge/assemble.test.js — 信封（契约12）与对账提示
import test from "node:test";
import assert from "node:assert/strict";
import { assembleState } from "../../src/edge/assemble.js";

const range = { start: "2026-07-14", end: "2026-07-16" };
const schedules = {
  quiet: [
    { from: "2026-07-13 20:55", value: "on" },     // 越界产物 → 裁剪锚定
    { from: "2026-07-15 07:40", value: "off" },
    { from: "2026-07-15 20:55", value: "on" },
  ],
};
const FIELDS = {
  focus:  { KIND: "focus", USE: "quiet", MODE: "do_not_disturb", APPLY: "on_change", OWN: {} },
  silent: { KIND: "scalar", USE: "quiet", APPLY: "on_change", OWN: {} },
};

test("segment 信封: 裁剪锚定生效 + 迟到采样 + 元信息齐全", () => {
  const env = assembleState({
    fieldsConfig: FIELDS, schedules, range,
    at: "2026-07-15 01:30", reconcileKeys: ["07:40"], trace: [],
  });
  assert.equal(env.version, "2");
  assert.equal(env.mode, "segment");
  assert.equal(env.fields.silent.value, "on");                       // 昨夜 on 延续
  assert.equal(env.fields.silent.from, "2026-07-14 00:00");          // 越界历史被锚定段承载
  assert.equal(env.fields.focus.value.action, "on");
  assert.equal(env.fields.focus.apply, "on_change");
  assert.equal(env.reconcile_alarms, true);                          // segment 恒 true
  assert.ok(!("schedules" in env));                                  // 非 debug 不带内脏
});

test("point 信封: 变化边界 + 对账锚点命中判定", () => {
  const hit = assembleState({
    fieldsConfig: FIELDS, schedules, range,
    at: "2026-07-15 07:42", mode: "point", reconcileKeys: ["07:40"], trace: [],
  });
  assert.deepEqual(hit.fields.silent.changes, [
    { at: "2026-07-15 07:40", value: "off", previous: "on" },
  ]);
  assert.equal(hit.reconcile_alarms, true);
  const miss = assembleState({
    fieldsConfig: FIELDS, schedules, range,
    at: "2026-07-15 10:00", mode: "point", reconcileKeys: ["07:40"], trace: [],
  });
  assert.equal(miss.fields.silent.changes.length, 0);
  assert.equal(miss.reconcile_alarms, false);
});

test("debug: 附 schedules 与字段时间线；trace 出口渲染为字符串", () => {
  const env = assembleState({
    fieldsConfig: FIELDS, schedules, range, at: "2026-07-15 08:00", debug: true,
    trace: [{ level: "info", plugin: "quiet", ref: "published", msg: "3 段" }],
  });
  assert.ok(Array.isArray(env.field_timelines.silent));
  assert.equal(env.trace[0], "[info] quiet/published: 3 段");
});
