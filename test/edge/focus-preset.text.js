// test/edge/focus-preset.test.js — focus 夜/昼两挡（sleep / do_not_disturb）+ 空守卫告警
// ─────────────────────────────────────────────────────────────────────────────
// 契约（Ivan 2026-07-27）: 晚上开【睡眠】，白天午休开【勿扰】。同一条 quiet 规则，
// 挡位差异由 FIELDS.focus.OWN 在午间两个边界上"换 preset"表达，手机端零改动。
// 反例同样重要: ① 夜间不许被换成勿扰 ② 周末没有午间键时不许凭空多出一个边界。
import test from "node:test";
import assert from "node:assert/strict";
import { handleV2 } from "../../src/edge/router.js";
import { addDays } from "../../src/kernel/intervals.js";

function fakeLoaders() {
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
  };
}
async function call(qs) {
  const res = await handleV2(new Request(`https://x.workers.dev/v2/state?${qs}`), {}, "/state", fakeLoaders());
  return res.json();
}
const WED = "2026-07-15";   // 普通工作日
const SAT = "2026-07-18";   // 普通周末（休息块 2 天 < LONG_REST_DAYS）

test("夜间挡位 = sleep（20:55 开）", async () => {
  const b = await call(`date=${WED}&now=21:30&locales=zh`);
  assert.equal(b.fields.focus.value.preset, "sleep");
  assert.equal(b.fields.focus.value.action, "on");
  assert.equal(b.fields.focus.from, `${WED} 20:55`);
});

test("午间挡位 = do_not_disturb（12:15 开，白天不开睡眠）", async () => {
  const b = await call(`date=${WED}&now=12:30&locales=zh`);
  assert.equal(b.fields.focus.value.preset, "do_not_disturb");   // ★ 本次修的就是这里
  assert.equal(b.fields.focus.value.action, "on");
  assert.equal(b.fields.focus.from, `${WED} 12:15`);
  // 反例: 午间绝不能是 sleep
  assert.notEqual(b.fields.focus.value.preset, "sleep");
});

test("午休解除 13:29: 挡位与守卫都指向 do_not_disturb", async () => {
  const b = await call(`date=${WED}&now=14:00&locales=zh`);
  assert.equal(b.fields.focus.value.action, "off");
  assert.equal(b.fields.focus.value.preset, "do_not_disturb");
  assert.deepEqual(b.fields.focus.guards, [
    { source: "current_focus", op: "in", value: ["do_not_disturb"], match: ["勿扰模式"] },
  ]);
});

test("早间解除 07:40 不受影响: 仍是 sleep + sleep 守卫（回归）", async () => {
  const b = await call(`date=${WED}&now=08:00&locales=zh`);
  assert.equal(b.fields.focus.value.action, "off");
  assert.equal(b.fields.focus.value.preset, "sleep");
  assert.deepEqual(b.fields.focus.guards, [
    { source: "current_focus", op: "in", value: ["sleep"], match: ["睡眠"] },
  ]);
});

test("四个边界的手机签名 preset|action 两两相邻不相等（on_change 才会逐个点火）", async () => {
  const sigs = [];
  for (const t of ["07:40", "12:15", "13:29", "20:55"]) {
    const b = await call(`date=${WED}&now=${t}&mode=point&locales=zh`);
    const v = b.fields.focus.value;
    sigs.push(`${v.preset || ""}|${v.action}`);
  }
  assert.deepEqual(sigs, ["sleep|off", "do_not_disturb|on", "do_not_disturb|off", "sleep|on"]);
  for (let i = 1; i < sigs.length; i++) assert.notEqual(sigs[i], sigs[i - 1]);
});

test("反例: 周末没有午间键 → OWN 的换挡行不产生幻影边界", async () => {
  const point = await call(`date=${SAT}&now=12:15&mode=point&locales=zh`);
  assert.equal(point.fields.focus, undefined);                  // 此刻无指令 = 字段缺席
  const seg = await call(`date=${SAT}&now=12:30&locales=zh`);
  assert.equal(seg.fields.focus.from, `${SAT} 09:30`);          // 仍是早间解除那一段
  assert.equal(seg.fields.focus.value.preset, "sleep");
});

// ── 空展开告警（fail-loud）───────────────────────────────────────────────────
// 2026-07-27 实案: URL 丢了 ?locales= → resolve.current_focus 不下发 → guards.match 空
// → 手机 CheckGuards 的 in 分支永远拦截 → 专注整天不解除，且 trace 一个字都没有。
test("URL 缺 ?locales= → 守卫 match 为空 → trace 响亮告警", async () => {
  const b = await call(`date=${WED}&now=08:00`);
  assert.deepEqual(b.fields.focus.guards[0].match, []);         // 展开确实为空
  const warned = b.trace.filter((x) => x.includes("empty_match"));
  assert.ok(warned.length > 0, "空展开必须告警");
  assert.ok(warned[0].includes("永远拦截"), "告警要写明后果");
  assert.ok(warned[0].includes("focus"), "告警要指名是哪个字段");
});

test("反例: 带 ?locales=zh 展开正常 → 不得有 empty_match 告警（避免狼来了）", async () => {
  const b = await call(`date=${WED}&now=08:00&locales=zh`);
  assert.deepEqual(b.fields.focus.guards[0].match, ["睡眠"]);
  assert.equal(b.trace.filter((x) => x.includes("empty_match")).length, 0);
});

// ── 多值守卫 + none token（"不打破手动开的现场"）────────────────────────────
// 语义: in:["none", 目标挡] = 当前没专注、或已经是目标挡，才动手。
// 手动开了别的专注 → SKIP 且不落账 → 下次轮询自动重试（不是永久失败）。
test("only_if_current 支持数组 → 下发 in + 多元素（不再被压成一个假 token）", async () => {
  const b = await call(`date=${WED}&now=20:55&mode=point&locales=zh`);
  const g = b.fields.focus.guards[0];
  assert.equal(g.op, "in");
  assert.deepEqual(g.value, ["none", "sleep"]);          // 反例: 不能是 ["none,sleep"]
  assert.equal(g.value.length, 2);
});

test("none token 展开为空字符串 = 手机 Get Current Focus 无专注时的返回", async () => {
  const b = await call(`date=${WED}&now=12:00&locales=zh`);
  assert.deepEqual(b.resolve.current_focus.none, [""]);
  const night = await call(`date=${WED}&now=20:55&mode=point&locales=zh`);
  assert.deepEqual(night.fields.focus.guards[0].match, ["", "睡眠"]);
});

test("两个夜间边界（工作日前夜 20:55 / 休息日前夜 22:25）都带守卫", async () => {
  const workEve = await call(`date=${WED}&now=20:55&mode=point&locales=zh`);
  const restEve = await call(`date=2026-07-17&now=22:25&mode=point&locales=zh`);   // 周五
  for (const b of [workEve, restEve]) {
    assert.equal(b.fields.focus.value.action, "on");
    assert.equal(b.fields.focus.value.preset, "sleep");
    assert.deepEqual(b.fields.focus.guards[0].value, ["none", "sleep"]);
  }
});

test("反例: 解除侧守卫不含 none（没专注时不该去执行一次关闭）", async () => {
  for (const t of ["07:40", "13:29"]) {
    const b = await call(`date=${WED}&now=${t}&mode=point&locales=zh`);
    assert.equal(b.fields.focus.value.action, "off");
    assert.ok(!b.fields.focus.guards[0].value.includes("none"),
      `${t} 的解除守卫混进了 none`);
    assert.equal(b.fields.focus.guards[0].value.length, 1);
  }
});

test("反例: 缺 ?locales= 时 none 也拿不到 → 整条守卫空展开并告警（不静默半生效）", async () => {
  const b = await call(`date=${WED}&now=20:55&mode=point`);
  assert.deepEqual(b.fields.focus.guards[0].match, []);
  assert.ok(b.trace.some((x) => x.includes("empty_match") && x.includes("永远拦截")));
});
