// test/kernel/fields-null-release.test.js — focus: 规则显式释放主张(null) 不得被 OWN 吞掉
// ─────────────────────────────────────────────────────────────────────────────
// 背景: quiet 的 R6.2a/c（长假早晨）产出 null = 【释放主张】，不是"没有边界"：
//   · 白天归人管（字段不再主张"睡眠 on"）
//   · 当晚 null→on 因此是【真变化】→ 每晚照常重进安静（契约4: 执行器见 null 清 LA）
// 而 focus 的 OWN 在 07:40/09:30 只挂守卫（无 action），修复前会把这条 null 删掉，
// 于是白天仍主张 sleep on，且当晚的 on 与前值相同被归一化合并 → 夜里不再点火。
// silent / media_volume 一直是对的，本用例把 focus 拉齐到同一行为。
import test from "node:test";
import assert from "node:assert/strict";
import { buildFieldTimeline } from "../../src/kernel/fields.js";

const RANGE = { start: "2026-07-14", end: "2026-07-16" };
// 长假早晨: 07:40 释放主张；当晚 20:55 重新进入安静
const QUIET = [
  { from: "2026-07-14 20:55", value: "on" },
  { from: "2026-07-15 07:40", value: null },
  { from: "2026-07-15 20:55", value: "on" },
];
const FOCUS = {
  KIND: "focus", USE: "quiet", PRESET: "sleep",
  OWN: { "07:40": { only_if_current: "sleep" }, "09:30": { only_if_current: "sleep" } },
};
const at = (t, from) => t.find((s) => s.from === from);

test("长假早晨: focus 保留 null 释放主张（只挂守卫的 OWN 不吞边界）", () => {
  const t = buildFieldTimeline(FOCUS, { quiet: QUIET }, RANGE);
  const rel = at(t, "2026-07-15 07:40");
  assert.ok(rel, "07:40 的边界必须还在");
  assert.equal(rel.value, null, "值必须是 null（释放主张），不是 sleep on 延续");
});

test("释放之后，当晚 20:55 的 on 仍是真变化（不被归一化合并掉）", () => {
  const t = buildFieldTimeline(FOCUS, { quiet: QUIET }, RANGE);
  const night = at(t, "2026-07-15 20:55");
  assert.ok(night, "当晚 20:55 必须仍有边界，否则刺客到点无事可做");
  assert.equal(night.value.action, "on");
  assert.equal(night.value.preset, "sleep");
});

test("与 silent / media_volume 行为一致（三字段同源同结局）", () => {
  const sCfg = { KIND: "scalar", USE: "quiet", OWN: {} };
  const mCfg = { KIND: "scalar", USE: "quiet", MAP: { on: 0, off: null }, OWN: {} };
  for (const cfg of [sCfg, mCfg]) {
    const t = buildFieldTimeline(cfg, { quiet: QUIET }, RANGE);
    assert.equal(at(t, "2026-07-15 07:40").value, null);
    assert.ok(at(t, "2026-07-15 20:55"));
  }
});

// ── 反例: 压制语义必须原样保留 ────────────────────────────────────────────────
test("反例: OWN 显式 { action: null } 仍然压制该边界（不是释放）", () => {
  const cfg = { ...FOCUS, OWN: { "13:29": { action: null } } };
  const quiet = [
    { from: "2026-07-15 12:15", value: "on" },
    { from: "2026-07-15 13:29", value: "off" },
  ];
  const t = buildFieldTimeline(cfg, { quiet }, RANGE);
  assert.ok(!t.some((s) => s.from === "2026-07-15 13:29"), "显式压制的边界必须消失");
});

test("反例: OWN 带 action 时，照旧覆盖 null 基值（不被「释放优先」误伤）", () => {
  const cfg = { ...FOCUS, OWN: { "07:40": { action: "off", only_if_current: "sleep" } } };
  const t = buildFieldTimeline(cfg, { quiet: QUIET }, RANGE);
  const b = at(t, "2026-07-15 07:40");
  assert.ok(b && b.value, "OWN 自带 action → 应产出实值而非 null");
  assert.equal(b.value.action, "off");
  assert.equal(b.value.only_if_current, "sleep");
});

test("反例: OWN 时刻上根本没有基边界时，不得凭空产生 null", () => {
  const t = buildFieldTimeline(FOCUS, { quiet: QUIET }, RANGE);
  assert.ok(!t.some((s) => s.from.endsWith("09:30")), "09:30 无基边界 → 不该出现");
});
