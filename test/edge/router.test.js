// test/edge/router.test.js — /v2 端到端 HTTP（注入假 loader，无网络）
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
const req = (qs) => new Request(`https://x.workers.dev/v2/state?${qs}`);

test("e2e: 鉴权关闭时段采样，信封齐全（AUTH_DISABLED=true 来自 config.user.js）", async () => {
  const res = await handleV2(req("date=2026-07-15&now=01:30"), {}, "/state", fakeLoaders());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.version, "2");
  assert.equal(body.fields.silent.value, "on");                 // 正典: 昨夜静音延续
  assert.equal(body.fields.focus.value.preset, "do_not_disturb"); // token，永无本地化名
  assert.equal(body.fields.media_volume.value, 0);              // 订阅 quiet: 夜间安静→归零
  assert.equal(body.reconcile_alarms, true);
});

test("契约15: media_volume 订阅 quiet——安静归零, 解除无主张(白天音量归人管)", async () => {
  const day = await call_mv("15:00");                            // 午休后~夜前: quiet off
  assert.equal(day.fields.media_volume.value, null);
  const night = await call_mv("21:00");                          // 20:55 后: quiet on
  assert.equal(night.fields.media_volume.value, 0);
  assert.equal(night.fields.media_volume.from, "2026-07-15 20:55");  // 归因: 来自 quiet 边界
});
async function call_mv(now) {
  const res = await handleV2(req(`date=2026-07-15&now=${now}`), {}, "/state", fakeLoaders());
  return res.json();
}

test("对拍回归: focus 07:40 守卫继承 + reminder 不再误报孤儿", async () => {
  const b = await call_mv("08:00");
  // only_if_current 已翻译成统一 guards（手机只认 guards），原字段不再出现
  assert.equal(b.fields.focus.value.only_if_current, undefined);
  assert.equal(b.fields.focus.value.guards, undefined);          // 不在 value 内
  assert.deepEqual(b.fields.focus.guards,                        // 在字段级
    [{ source: "current_focus", op: "is", value: "do_not_disturb" }]);
  assert.equal(b.fields.focus.value.action, "off");
  assert.ok(!b.trace.some((x) => x.includes("orphan") && x.includes("ai_quota_reminder")));
});

test("e2e: point 模式命中 07:40 边界与对账锚点", async () => {
  const res = await handleV2(req("date=2026-07-15&now=07:42&mode=point"), {}, "/state", fakeLoaders());
  const body = await res.json();
  assert.equal(body.fields.silent.changes[0].value, "off");
  assert.equal(body.reconcile_alarms, true);
});

test("i18n 下发: ?locales=zh,en 合并反查表; 不带参数信封无此节", async () => {
  const withI18n = await handleV2(req("date=2026-07-15&locales=zh,en"), {}, "/state", fakeLoaders());
  const b1 = await withI18n.json();
  assert.equal(b1.i18n.focus_name_to_token["勿扰模式"], "do_not_disturb");
  assert.equal(b1.i18n.focus_name_to_token["Do Not Disturb"], "do_not_disturb");
  assert.deepEqual(b1.i18n.focus_token_to_name["do_not_disturb"], ["勿扰模式", "Do Not Disturb"]);  // 候选数组, zh 优先
  const plain = await handleV2(req("date=2026-07-15"), {}, "/state", fakeLoaders());
  const b2 = await plain.json();
  assert.ok(!("i18n" in b2));                          // 不请求不下发, 信封保持精瘦
});

test("e2e: /timeline 常开 debug 内脏", async () => {
  const res = await handleV2(req("date=2026-07-15"), {}, "/timeline", fakeLoaders());
  const body = await res.json();
  assert.ok(Array.isArray(body.schedules.quiet));
  assert.ok(Array.isArray(body.field_timelines.silent));
});

test("e2e: 虚拟事件全链路——周五全天年假=长假块，周六上午采样仍静音", async () => {
  const sources = await import("../../src/edge/sources.js");
  const loaders = { ...fakeLoaders(), loadCalendars: sources.loadCalendars }; // skipCalendar 下零网络
  const res = await handleV2(
    req("date=2026-07-18&now=10:30&testEvents=" + encodeURIComponent("[年假]|2026-07-17||") + "&skipCalendar=1"),
    {}, "/state", loaders);
  const body = await res.json();
  assert.equal(body.fields.silent.value, null);                 // R6.2c 白天释放主张(手动自由)
});

test("e2e: loader 全炸也返回合法降级信封（宁可不动手机）", async () => {
  const res = await handleV2(req("date=2026-07-15"), {}, "/state", {
    async loadWorkdays() { throw new Error("net down"); },
    async loadCalendars() { return []; },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.error, "internal_degraded");
  assert.deepEqual(body.fields, {});
  assert.equal(body.reconcile_alarms, false);
});
