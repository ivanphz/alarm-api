// test/kernel/rules.test.js — 规范形式 + 翻译器（ATOMIC-RULES §5）
// ─────────────────────────────────────────────────────────────────────────────
// 核心不变量: 两种书写形式只是视图，内部只存一种真相；同一格两份 → 报错不静默。
import test from "node:test";
import assert from "node:assert/strict";
import {
  toCanonical, canonicalToRuleMaps, applyCanonical, toTimeMajor, toFieldMajor, whenMatches,
} from "../../src/kernel/rules.js";

const FOCUS = { KIND: "focus", USE: "quiet", PRESET: "sleep" };

test("字段为主键的书写糖 → 规范形式（触发因为主键）", () => {
  const c = toCanonical({
    fields: { focus: { ...FOCUS, RULES: { "20:55": { shape: "level", guard: "none" } } } },
  });
  assert.deepEqual(Object.keys(c), ["clock@20:55"]);
  assert.deepEqual(c["clock@20:55"], [{ field: "focus", shape: "level", guard: "none" }]);
});

test("时刻为主键的书写糖 → 同一份规范形式", () => {
  const c = toCanonical({
    fields: { focus: FOCUS, silent: { KIND: "scalar" } },
    boundaries: { "20:55": { focus: { shape: "level" }, silent: { value: "on" } } },
  });
  assert.deepEqual(c["clock@20:55"].map((r) => r.field), ["focus", "silent"]);
});

test("★ 同一格两份真相 → 报错，绝不静默取一个", () => {
  assert.throws(() => toCanonical({
    fields: { focus: { ...FOCUS, RULES: { "20:55": { shape: "level" } } } },
    boundaries: { "20:55": { focus: { shape: "pulse" } } },
  }), /规则冲突.*20:55.*focus/);
});

test("反例: 不同字段写在同一时刻不算冲突", () => {
  assert.doesNotThrow(() => toCanonical({
    fields: { focus: { ...FOCUS, RULES: { "20:55": { shape: "level" } } }, silent: { KIND: "scalar" } },
    boundaries: { "20:55": { silent: { value: "on" } } },
  }));
});

test("非法输入当场炸: 未知键 / 非法 shape / pulse 带 until / guard+guards 并存", () => {
  const bad = (rules) => () => toCanonical({ fields: { focus: { ...FOCUS, RULES: rules } } });
  assert.throws(bad({ "07:40": { shapee: "level" } }), /未知键/);
  assert.throws(bad({ "07:40": { shape: "ramp" } }), /非法/);
  assert.throws(bad({ "07:40": { shape: "pulse", until: "08:00" } }), /pulse 不能有 until/);
  assert.throws(bad({ "07:40": { guard: "sleep", guards: [] } }), /二选一/);
  assert.throws(bad({ "07:40": { apply: "sometimes" } }), /apply.*非法/);
});

test("可逆: 规范形式能反向渲染出两种视图", () => {
  const rules = {
    "20:55": { shape: "level", apply: "if_changed", guard: "none" },
    "12:15": { shape: "pulse", apply: "always", preset: "do_not_disturb" },
  };
  const c = toCanonical({ fields: { focus: { ...FOCUS, RULES: rules } } });
  assert.deepEqual(toFieldMajor(c).focus["20:55"], rules["20:55"]);
  assert.deepEqual(toTimeMajor(c)["12:15"].focus, rules["12:15"]);
  // 时刻视图按时间排序（人读的时候要顺）
  assert.deepEqual(Object.keys(toTimeMajor(c)), ["12:15", "20:55"]);
});

test("规范形式 → 每字段的 RULES_AT（时刻 → 规格数组）", () => {
  const c = toCanonical({
    fields: {
      focus: {
        ...FOCUS,
        RULES: {
          "07:40": { value: "off", shape: "level", until: "08:00", apply: "always", guard: "sleep" },
          "12:15": { value: "on", shape: "pulse", apply: "always", preset: "do_not_disturb" },
        },
      },
    },
  });
  const m = canonicalToRuleMaps(c).focus;
  assert.equal(m["07:40"].length, 1);
  assert.deepEqual(m["07:40"][0],
    { value: "off", shape: "level", until: "08:00", apply: "always", guard: "sleep" });
  assert.equal(m["12:15"][0].preset, "do_not_disturb");
});

// ── when: 日型条件（三根正交轴）────────────────────────────────────────────
test("一格可以有多条变体，按日型互斥选择", () => {
  const c = toCanonical({
    fields: { focus: { ...FOCUS, RULES: { "07:40": [
      { when: { morning: ["work"] }, value: "off" },
      { when: { morning: ["leave_long_tail"] }, value: null },
    ] } } },
  });
  assert.equal(canonicalToRuleMaps(c).focus["07:40"].length, 2);
});

test("★ 多变体时每条都必须写 when（否则不知道哪天用哪条）", () => {
  assert.throws(() => toCanonical({
    fields: { focus: { ...FOCUS, RULES: { "07:40": [
      { when: { morning: ["work"] }, value: "off" },
      { value: null },                                     // 没写 when
    ] } } },
  }), /每条都必须写 when/);
});

test("when 的轴写错当场炸，不静默忽略", () => {
  assert.throws(() => toCanonical({
    fields: { focus: { ...FOCUS, RULES: { "07:40": { when: { mornin: ["work"] } } } } },
  }), /轴 "mornin" 不存在/);
  assert.throws(() => toCanonical({
    fields: { focus: { ...FOCUS, RULES: { "07:40": { when: { morning: [] } } } } },
  }), /非空数组/);
});

test("whenMatches: 三根轴取交集；日型无主张则一律不启用", () => {
  const dt = { morning: "work", noon: "work", eve: "rest" };
  assert.equal(whenMatches(undefined, dt), true);          // 缺省 = 总是
  assert.equal(whenMatches({ morning: ["work", "rest_short"] }, dt), true);
  assert.equal(whenMatches({ morning: ["work"], eve: ["workday"] }, dt), false);
  assert.equal(whenMatches({ morning: ["work"] }, null), false);   // 传染
});

test("applyCanonical: 没用 RULES 的字段原样不动", () => {
  const cfg = { focus: { ...FOCUS, RULES: { "20:55": { shape: "level" } } },
                silent: { KIND: "scalar", SKIP: ["12:15"], OWN: {} } };
  const out = applyCanonical(cfg, toCanonical({ fields: cfg }));
  assert.equal(out.silent, cfg.silent);                    // 同一个对象引用 = 一个字节没碰
  assert.ok(out.focus.RULES_AT["20:55"]);
});

// ── 派生「手机上需要建哪些自动化」───────────────────────────────────────────
test("自动化清单: 白名单内的走时间自动化，白名单外的走门铃", async () => {
  const { deriveAutomations } = await import("../../src/kernel/rules.js");
  const tl = {
    focus:  [{ from: "2026-07-15 20:55", value: 1 }, { from: "2026-07-15 07:44", value: 1 }],
    silent: [{ from: "2026-07-15 20:55", value: 1 }],
  };
  const a = deriveAutomations(tl, ["20:55", "09:30"], { KEYWORD: "|SYNCALL|" });
  assert.deepEqual(a.time_of_day.items.find((i) => i.at === "20:55").fields, ["focus", "silent"]);
  assert.deepEqual(a.via_doorbell, [{ at: "07:44", fields: ["focus"] }]);
  // 白名单里但本范围没边界的时刻仍要建（别的日型会用到）
  assert.ok(a.time_of_day.items.some((i) => i.at === "09:30" && i.note));
  assert.equal(a.notification.count, 1);
});

test("★ PUSH 关掉时明确警告: 那些时刻将永远送不出去", async () => {
  const { deriveAutomations } = await import("../../src/kernel/rules.js");
  const a = deriveAutomations(
    { focus: [{ from: "2026-07-15 07:44", value: 1 }] }, ["20:55"], { ENABLED: false });
  assert.equal(a.notification.count, 0);
  assert.ok(a.notification.items[0].warn.includes("永远送不出去"));
  assert.deepEqual(a.notification.items[0].blocked, [{ at: "07:44", fields: ["focus"] }]);
});

test("反例: 00:00 的锚定伪边界不算需要自动化的时刻", async () => {
  const { deriveAutomations } = await import("../../src/kernel/rules.js");
  const a = deriveAutomations({ f: [{ from: "2026-07-15 00:00", value: 1 }] }, [], {});
  assert.deepEqual(a.via_doorbell, []);
});

test("at.from 引用不存在的规则 → 审计告警（打字错会静默回落 fallback）", async () => {
  const { auditRuleRefs } = await import("../../src/kernel/rules.js");
  const trace = [];
  auditRuleRefs({ focus: { RULES_AT: { "@x": [{ at: { from: "wake_alarm", pick: "last_wake",
                                                      fallback: "07:40" } }] } } },
                ["wake_alarms", "presence"], trace);
  assert.equal(trace.length, 1);
  assert.ok(trace[0].msg.includes("wake_alarm"));
  assert.ok(trace[0].msg.includes("07:40"), "要说明会静默回落到哪里");
});

test("反例: 引用存在的规则不告警", async () => {
  const { auditRuleRefs } = await import("../../src/kernel/rules.js");
  const trace = [];
  auditRuleRefs({ focus: { RULES_AT: { "@x": [{ at: { from: "wake_alarms", pick: "last_wake" } }] } } },
                ["wake_alarms"], trace);
  assert.deepEqual(trace, []);
});
