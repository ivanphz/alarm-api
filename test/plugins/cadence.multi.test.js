// test/plugins/cadence.multi.test.js — 泛化验收: 加任务=纯配置; 嵌套字段; 未知 kind 响亮
import test from "node:test";
import assert from "node:assert/strict";
import { handleV2, buildPlugins, withCadenceFields, V2_DEFAULTS } from "../../src/edge/router.js";
import { schedulesFeeding } from "../../src/kernel/registry.js";
import { addDays } from "../../src/kernel/intervals.js";
import { CONFIG } from "../../src/config.js";

const TASKS = {
  ai_claude:  { enabled: true, kind: "rolling_cooldown", cooldown_minutes: 300,
                channel: "alarm", title: "AI额度" },
  game_chest: { enabled: true, kind: "rolling_cooldown", cooldown_minutes: 420,
                channel: "alarm", title: "宝箱" },
};

function loaders(streams) {
  return {
    async loadWorkdays() {
      const out = [];
      for (let d = "2026-07-13"; d <= "2026-07-18"; d = addDays(d, 1)) out.push({ date: d, off: false, name: "" });
      return out;
    },
    async loadCalendars() { return []; },
    async loadExternalAlarms() { return []; },
    async loadFacts() { return { streams, degraded: [] }; },
  };
}
const call = async (qs, ld) =>
  (await handleV2(new Request(`https://x.dev/v2/state?${qs}`), {}, "/state", ld)).json();

test("加一个任务 = 只加配置: 插件/字段/事实流/闹钟全部自动到位", () => {
  const cfg = { CADENCE: { TASKS } };
  const names = buildPlugins(cfg).map((p) => p.name);
  // 每个任务自动获得 状态插件 + 提醒插件
  for (const t of ["ai_claude", "game_chest"]) {
    assert.ok(names.includes(`cadence_${t}`), `缺少 cadence_${t}`);
    assert.ok(names.includes(`cadence_${t}_reminder`), `缺少 cadence_${t}_reminder`);
  }
  // 闹钟名单自动包含两个提醒（无需任何硬编码名单）
  const alarms = schedulesFeeding(buildPlugins(cfg), "alarms");
  assert.ok(alarms.includes("cadence_ai_claude_reminder"));
  assert.ok(alarms.includes("cadence_game_chest_reminder"));
  // 字段自动派生
  const fields = withCadenceFields({}, cfg);
  assert.deepEqual(fields["cadence.game_chest"],
    { KIND: "scalar", USE: "cadence_game_chest", APPLY: "on_change", OWN: {} });
});

test("插件集合与 enabled 解耦: 关掉任务不会让 schedule 凭空消失", () => {
  const off = { CADENCE: { TASKS: { ai_claude: { ...TASKS.ai_claude, enabled: false } } } };
  const names = buildPlugins(off).map((p) => p.name);
  assert.ok(names.includes("cadence_ai_claude"));           // 仍注册
  assert.ok(names.includes("cadence_ai_claude_reminder"));  // 仍注册，只是产出为空
});

test("e2e 多任务: 两个任务各自独立冷却，字段用扁平键 cadence.<task>", async () => {
  const prev = CONFIG.V2;
  CONFIG.V2 = { CADENCE: { TASKS } };
  try {
    const ld = loaders({
      ai_claude:  [{ at: "2026-07-15 09:00", id: "a1", type: "done" }],   // +300min → 14:00
      game_chest: [{ at: "2026-07-15 09:00", id: "g1", type: "done" }],   // +420min → 16:00
    });
    const at12 = await call("date=2026-07-15&now=12:00", ld);
    assert.equal(at12.fields["cadence.ai_claude"].value, "false");
    assert.equal(at12.fields["cadence.game_chest"].value, "false");

    const at15 = await call("date=2026-07-15&now=15:00", ld);
    assert.equal(at15.fields["cadence.ai_claude"].value, "true");    // 14:00 已恢复
    assert.equal(at15.fields["cadence.game_chest"].value, "false");  // 16:00 才恢复 —— 任务间零串扰

    // 两条提醒闹钟各自独立，标签含各自任务名与时间
    const labels = (at12.alarms.dynamic || []).map((a) => a.label);
    assert.ok(labels.includes("GateDyn-CAD-ai_claude-1400"));
    assert.ok(labels.includes("GateDyn-CAD-game_chest-1600"));
  } finally { CONFIG.V2 = prev; }
});

test("未知 kind 响亮报错，绝不静默降级", async () => {
  const prev = CONFIG.V2;
  CONFIG.V2 = { CADENCE: { TASKS: { weird: { enabled: true, kind: "ladder", channel: "alarm" } } } };
  try {
    const b = await call("date=2026-07-15&now=12:00", loaders({ weird: [] }));
    assert.equal(b.fields["cadence.weird"].value, null);          // 无主张（不编造）
    assert.ok(b.trace.some((x) => x.includes("unknown_kind") && x.includes("ladder")));
  } finally { CONFIG.V2 = prev; }
});

test("channel 未建成时响亮告警（配了 todo 不会被静默当成生效）", async () => {
  const prev = CONFIG.V2;
  CONFIG.V2 = { CADENCE: { TASKS: { x: { enabled: true, kind: "rolling_cooldown", channel: "todo" } } } };
  try {
    const b = await call("date=2026-07-15&now=12:00", loaders({ x: [] }));
    assert.ok(b.trace.some((t) => t.includes("channel_not_built") && t.includes("todo")));
  } finally { CONFIG.V2 = prev; }
});

test("出厂默认: ai_claude 任务存在但关闭（不影响未配置的用户）", () => {
  assert.equal(V2_DEFAULTS.CADENCE.TASKS.ai_claude.enabled, false);
});
