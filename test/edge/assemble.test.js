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
  focus:  { KIND: "focus", USE: "quiet", PRESET: "do_not_disturb", APPLY: "on_change", OWN: {} },
  silent: { KIND: "scalar", USE: "quiet", APPLY: "on_change", OWN: {} },
};

test("segment 信封: 裁剪锚定生效 + 迟到采样 + 元信息齐全", () => {
  const env = assembleState({
    fieldsConfig: FIELDS, schedules, range,
    at: "2026-07-15 01:30", trace: [],
  });
  assert.equal(env.version, "2");
  assert.equal(env.mode, "segment");
  assert.equal(env.fields.silent.value, "on");                       // 昨夜 on 延续
  assert.equal(env.fields.silent.from, "2026-07-14 00:00");          // 越界历史被锚定段承载
  assert.equal(env.fields.focus.value.action, "on");
  assert.equal(env.fields.focus.apply, "on_change");                          // segment 恒 true
  assert.ok(!("schedules" in env));                                  // 非 debug 不带内脏
});

test("★结构冻结: point 与 segment 产出【完全相同的键集】(法则3 单路径)", () => {
  const call = (mode, at) => assembleState({
    fieldsConfig: FIELDS, schedules, range, at, mode, trace: [],
  });
  const seg = call("segment", "2026-07-15 07:42");
  const pt  = call("point",   "2026-07-15 07:42");     // 命中 07:40 边界

  // 手机端读法恒定: fields.<x>.value —— 两模式键集必须一致，否则要搭两套逻辑
  assert.deepEqual(Object.keys(pt.fields.silent).sort(), Object.keys(seg.fields.silent).sort());
  assert.equal(pt.fields.silent.value, "off");
  assert.equal(pt.fields.silent.from, "2026-07-15 07:40");

  // 非 debug 时不带 changes 明细（手机端不该看见它，免得误依赖）
  assert.ok(!("changes" in pt.fields.silent));
  // current_state 已退休：值只有一个来源
  assert.ok(!("current_state" in pt));
});

test("★缺席 ≠ null: 此刻无指令的字段【整个不出现】", () => {
  const miss = assembleState({
    fieldsConfig: FIELDS, schedules, range,
    at: "2026-07-15 10:00", mode: "point", trace: [],
  });
  // 10:00 附近没有任何边界 → 字段缺席 → 手机什么都不做
  assert.equal(miss.fields.silent, undefined);
  // 对照: segment 模式一定有值（可能是 null=显式释放主张，那是另一种语义）
  const seg = assembleState({
    fieldsConfig: FIELDS, schedules, range, at: "2026-07-15 10:00", mode: "segment", trace: [],
  });
  assert.ok("value" in seg.fields.silent);
});

test("debug 时才下发 changes 明细（诊断用，手机端不读）", () => {
  const d = assembleState({
    fieldsConfig: FIELDS, schedules, range,
    at: "2026-07-15 07:42", mode: "point", debug: true, trace: [],
  });
  assert.deepEqual(d.fields.silent.changes, [
    { at: "2026-07-15 07:40", value: "off", previous: "on", guards: [] },
  ]);
});

test("guards 校验: in/not_in 接受数组; 未知 op/source 丢弃并告警; is/is_not 翻译为单元素 in/not_in", () => {
  const strip = (gs) => gs.map(({ match, ...rest }) => rest);   // 本用例只验校验/翻译，展开另测
  const run = (guards) => {
    const tr = [];
    const F = { focus: { KIND: "focus", USE: "quiet", PRESET: "do_not_disturb",
                         APPLY: "on_change", OWN: { "07:40": { action: "off", guards } } } };
    const out = assembleState({
      fieldsConfig: F, schedules, range,
      at: "2026-07-15 08:00", mode: "segment", trace: tr,
    });
    return { g: out.fields.focus.guards, trace: tr };
  };
  let r = run([{ source: "app", op: "in", value: ["com.a", "com.b"] }]);
  assert.deepEqual(strip(r.g), [{ source: "app", op: "in", value: ["com.a", "com.b"] }]);  // in 保留数组
  r = run([{ source: "app", op: "not_in", value: "com.a" }]);
  assert.equal(r.g, undefined);                                  // not_in 非数组 → 丢弃
  assert.ok(r.trace.some((x) => x.ref === "bad_guard" && (x.msg||"").includes("必须是数组")));
  r = run([{ source: "app", op: "startsWith", value: "com" }]);
  assert.ok(r.trace.some((x) => (x.msg||"").includes("未知 guard.op")));
  r = run([{ source: "gyroscope", op: "is", value: "x" }]);
  assert.ok(r.trace.some((x) => (x.msg||"").includes("未知 guard.source")));
  r = run([{ source: "locked", op: "is", value: true }]);
  assert.deepEqual(strip(r.g), [{ source: "locked", op: "in", value: ["true"] }]);  // is→in 单元素数组+转文本
  r = run([{ source: "app", op: "is_not", value: "com.a" }]);
  assert.deepEqual(strip(r.g), [{ source: "app", op: "not_in", value: ["com.a"] }]);       // is_not→not_in
  // 反例: 手机端永不应见到 is/is_not —— 出参 op 只可能是 in/not_in
  for (const sugar of ["is", "is_not"]) {
    const out = run([{ source: "locked", op: sugar, value: "false" }]);
    assert.ok(!["is", "is_not"].includes(out.g[0].op), `${sugar} 未被翻译，手机端会漏实现分支`);
    assert.ok(Array.isArray(out.g[0].value), "翻译后 value 必须是数组(手机端只有一种展开逻辑)");
  }
});


test("恒常守卫 GUARDS_ALWAYS: 标量字段(volume)下发到字段级，手机读法同 focus", () => {
  const mk = (key) => ({
    media_volume: { KIND: "scalar", USE: "quiet", MAP: { on: 0, off: null }, APPLY: "on_change",
                    [key]: [{ source: "app", op: "not_in", value: ["maps", "video"], match: [] }] },
  });
  const tr = [];
  const out = assembleState({
    fieldsConfig: mk("GUARDS_ALWAYS"), schedules, range,
    at: "2026-07-15 21:00", mode: "segment", trace: tr,   // 20:55 后 quiet on → volume 0
  });
  assert.equal(out.fields.media_volume.value, 0);          // 值仍是裸标量
  assert.deepEqual(out.fields.media_volume.guards,         // 守卫在字段级(与 fields.focus.guards 同位)
    [{ source: "app", op: "not_in", value: ["maps", "video"], match: [] }]);  // 值是语义 token，非包名
  assert.ok(!tr.some((x) => x.ref === "deprecated_guards_key"), "新键名不应告警");

  // 旧键名 GUARDS: 过渡期照用但响亮告警（不静默换语义）
  const tr2 = [];
  const old = assembleState({
    fieldsConfig: mk("GUARDS"), schedules, range,
    at: "2026-07-15 21:00", mode: "segment", trace: tr2,
  });
  assert.deepEqual(old.fields.media_volume.guards,
    [{ source: "app", op: "not_in", value: ["maps", "video"], match: [] }]);
  assert.ok(tr2.some((x) => x.ref === "deprecated_guards_key"), "旧键名必须告警");
});

test("回归(真bug): point 模式守卫此前完全丢失 —— 两模式 fields.<x>.guards 必须一致", () => {
  const F = {
    media_volume: { KIND: "scalar", USE: "quiet", MAP: { on: 0, off: null }, APPLY: "on_change",
                    GUARDS_ALWAYS: [{ source: "app", op: "not_in", value: ["maps"], match: [] }] },
    focus: { KIND: "focus", USE: "quiet", PRESET: "do_not_disturb", APPLY: "on_change",
             OWN: { "07:40": { only_if_current: "do_not_disturb" } } },
  };
  const call = (mode, at) => assembleState({
    fieldsConfig: F, schedules, range, at, mode,
    tolerances: { pastMinutes: 3, futureMinutes: 3 }, trace: [],
  });
  const seg = call("segment", "2026-07-15 07:41");
  const pt  = call("point",   "2026-07-15 07:41");     // 命中 07:40 边界

  // ① 恒常守卫在两模式都必须下发（旧行为: point 模式为 undefined → 导航时照样归零）
  assert.deepEqual(pt.fields.media_volume.guards, seg.fields.media_volume.guards);
  assert.deepEqual(pt.fields.media_volume.guards,
    [{ source: "app", op: "not_in", value: ["maps"], match: [] }]);

  // ② 时点守卫(only_if_current)在两模式都必须下发
  //    旧行为: 刺客(point)拿不到 → 07:40 会误关手动开启的睡眠/工作专注
  assert.deepEqual(pt.fields.focus.guards, seg.fields.focus.guards);
  assert.deepEqual(pt.fields.focus.guards,
    [{ source: "current_focus", op: "in", value: ["do_not_disturb"], match: [] }]);

  // ③ 反例: 未命中任何时刻 → 字段缺席（不是"有字段但守卫为空"）
  const miss = call("point", "2026-07-15 10:00");
  assert.equal(miss.fields.media_volume, undefined);
  assert.equal(miss.fields.focus, undefined);
});
