// test/edge/router.test.js — /v2 端到端 HTTP（注入假 loader，无网络）
import test from "node:test";
import assert from "node:assert/strict";
import { handleV2, handleFact } from "../../src/edge/router.js";
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
  // 全 pulse 之后段查询无主张 —— 字段缺席才是正确的（白天/夜里都归人管）
  assert.equal(body.fields.silent, undefined);
  const pt = await (await handleV2(req("date=2026-07-14&now=20:55&mode=point"), {}, "/state", fakeLoaders())).json();
  assert.equal(pt.fields.focus.value.preset, "sleep");          // token，永无本地化名
  assert.equal(pt.fields.media_volume.value, 0);                // 夜间进入安静 → 归零
});

test("契约15: media_volume 安静归零, 解除无主张(白天音量归人管)", async () => {
  // 全 pulse 之后只有刺客时刻看得到主张（段查询一律无主张）
  const night = await call_mv("20:55", "&mode=point");
  assert.equal(night.fields.media_volume.value, 0);              // 进入安静 → 归零
  const morning = await call_mv("07:44", "&mode=point");
  assert.equal(morning.fields.media_volume.value, null);         // 解除 → 无主张
  const day = await call_mv("15:00");
  assert.equal(day.fields.media_volume, undefined);              // 白天段查询: 字段缺席
});
async function call_mv(now, extra = "") {
  const res = await handleV2(req(`date=2026-07-15&now=${now}${extra}`), {}, "/state", fakeLoaders());
  return res.json();
}

test("对拍回归: focus 07:40 守卫继承 + reminder 不再误报孤儿", async () => {
  const b = await call_mv("07:44", "&mode=point");   // focus 现在只在刺客时刻在场
  // only_if_current 已翻译成统一 guards（手机只认 guards），原字段不再出现
  assert.equal(b.fields.focus.value.only_if_current, undefined);
  assert.equal(b.fields.focus.value.guards, undefined);          // 不在 value 内
  assert.equal(b.fields.focus.guards.length, 1);                 // 在字段级
  assert.equal(b.fields.focus.guards[0].source, "current_focus");
  assert.equal(b.fields.focus.guards[0].op, "in");                // is→in 单元素
  assert.deepEqual(b.fields.focus.guards[0].value, ["sleep"]);
  assert.ok(b.fields.focus.guards[0].match.includes("睡眠"));      // 缺 locales → 全语言兜底
  assert.equal(b.fields.focus.value.action, "off");
  assert.ok(!b.trace.some((x) => x.includes("orphan") && x.includes("cadence_ai_claude_reminder")));
});

test("e2e: point 模式命中 07:40 边界", async () => {
  const res = await handleV2(req("date=2026-07-15&now=07:42&mode=point"), {}, "/state", fakeLoaders());
  const body = await res.json();
  assert.equal(body.fields.silent.value, "off");        // 与 segment 同一读取路径
});

test("resolve 下发: 表名=守卫source名; locked 恒等表恒发", async () => {
  const r1 = await handleV2(req("date=2026-07-15&locales=zh,en"), {}, "/state", fakeLoaders());
  const b1 = await r1.json();
  assert.deepEqual(b1.resolve.current_focus.sleep.slice(0, 2), ["睡眠", "Sleep"]);
  assert.deepEqual(b1.resolve.locked, { true: ["true"], false: ["false"] });
  assert.ok(!("i18n" in b1));                          // 旧 i18n 节已彻底删除

  const r2 = await handleV2(req("date=2026-07-15"), {}, "/state", fakeLoaders());
  const b2 = await r2.json();
  // 不传 locales → 全语言兜底（不再缺席），并附降级告警（2026-07-31）
  assert.ok(b2.resolve.current_focus.sleep.includes("睡眠"));
  assert.ok(b2.trace.some((x) => x.includes("locales_fallback")));
  assert.ok(b2.resolve.locked);                        // 恒等表照发
});

test("e2e: /timeline 常开 debug 内脏", async () => {
  const res = await handleV2(req("date=2026-07-15"), {}, "/timeline", fakeLoaders());
  const body = await res.json();
  assert.ok(Array.isArray(body.schedules.day_type));   // quiet 已退役
  assert.ok(Array.isArray(body.field_timelines.silent));
});

test("e2e: 虚拟事件全链路——周五全天年假=长假块，周六上午采样仍静音", async () => {
  const sources = await import("../../src/edge/sources.js");
  const loaders = { ...fakeLoaders(), loadCalendars: sources.loadCalendars }; // skipCalendar 下零网络
  const res = await handleV2(
    req("date=2026-07-18&now=10:30&testEvents=" + encodeURIComponent("[年假]|2026-07-17||") + "&skipCalendar=1"),
    {}, "/state", loaders);
  const body = await res.json();
  // 长假块的周六上午: 早上不产解除边界（绝不吵醒），段查询也无主张
  assert.equal(body.fields.silent, undefined);
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
  assert.equal(body.alarms.sweep, "false");   // ★ 降级 → 撤销 sweep 授权，手机只加不关
});

test("platform 自报: 缺省回落 ios; 未知平台告警回落", async () => {
  const base = await (await handleV2(req("date=2026-07-15&now=08:00&locales=zh,en"), {}, "/state", fakeLoaders())).json();
  assert.equal(base.platform, "ios");                         // 缺省 = DEFAULT_PLATFORM
  assert.ok(base.resolve.app && base.resolve.current_focus);
  assert.ok(!base.trace.some((x) => x.includes("unknown_platform")));

  const bad = await (await handleV2(req("date=2026-07-15&now=08:00&platform=symbian"), {}, "/state", fakeLoaders())).json();
  assert.equal(bad.platform, "ios");                          // 未知 → 回落，不报错（§4.1）
  assert.ok(bad.trace.some((x) => x.includes("unknown_platform")));

  const nolocale = await (await handleV2(req("date=2026-07-15&now=08:00"), {}, "/state", fakeLoaders())).json();
  assert.ok(nolocale.resolve.app);                            // app 表与 locales 无关，照发
});

test("★铁律: 信封里【任何位置】都不得出现裸布尔（iOS 会本地化成 是/否）", async () => {
  // 实测来源 DEVLOG §1.4: JSON true 经快捷指令 Text 渲染成 "是"(中文系统)/"Yes"(英文)，
  // 历史上还出现过 1/0。呈现方式不是契约 → 手机端拿 true 比对必然【静默失败】。
  // 本用例全量递归扫描，新增字段/新增节点无法绕过这条铁律。
  const walk = (node, path, hits) => {
    if (typeof node === "boolean") { hits.push(`${path} = ${node}`); return; }
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`, hits));
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, hits);
    }
  };
  for (const qs of ["date=2026-07-15&now=07:41&mode=segment&locales=zh,en",
                    "date=2026-07-15&now=07:41&mode=point&locales=zh,en",
                    "date=2026-07-15&now=07:41&mode=point&debug=1"]) {
    const body = await (await handleV2(req(qs), {}, "/state", fakeLoaders())).json();
    const hits = [];
    walk(body.fields, "fields", hits);
    walk(body.alarms, "alarms", hits);
    walk(body.resolve, "resolve", hits);
    hits.length === 0 || assert.fail(`[${qs}] 裸布尔: ${hits.join(", ")}`);        // "true"/"false"
  }
});


test("★回归(真bug): 降级信封【绝不能】带 alarms 节 —— 否则手机 sweep 会关光所有动态闹钟", async () => {
  // 事故链: 服务端任何未接住的异常 → 降级信封。若它带 alarms:{dynamic:[]}，
  // 手机 SyncAlarms 的 sweep 规则是"不在清单里就关掉"，空清单 = 全都不在 = 【全关】。
  // fields 发 {} 是安全的（逐键判缺席），alarms 是集合语义 —— 空数组是【合法指令】
  // （今天真的没有动态闹钟），所以不能靠"空"识别故障，只能靠【整节缺席】。
  const res = await handleV2(req("date=2026-07-15"), {}, "/state", {
    async loadWorkdays() { throw new Error("boom"); },
    async loadCalendars() { return []; },
  });
  const b = await res.json();
  assert.equal(res.status, 200);                 // 200 而非 500: 手机拿到 500 会整条同步失效
  assert.equal(b.error, "internal_degraded");
  assert.equal(b.alarms.sweep, "false");         // ★ 撤销 sweep 授权 → 手机只加不关
  assert.deepEqual(b.alarms.dynamic, []);        // 空清单本身合法，靠 sweep 位识别故障
  assert.deepEqual(b.fields, {});                // fields 空是安全的（逐键判缺席）
});

test("?apply=enforce: 强制推平全部字段（守卫仍然拦得住）", async () => {
  const at = (qs) => handleV2(req(qs), {}, "/state", fakeLoaders()).then((r) => r.json());
  const norm = await at("date=2026-07-15&now=20:55&mode=point");
  assert.equal(norm.fields.silent.apply, "on_change");

  const forced = await at("date=2026-07-15&now=20:55&mode=point&apply=enforce");
  for (const f of Object.values(forced.fields)) assert.equal(f.apply, "enforce");
  // 守卫原样下发 —— enforce 只压"无变化跳过"，压不过守卫（契约3）
  assert.deepEqual(forced.fields.focus.guards, norm.fields.focus.guards);
});


test("★sweep 授权: 外部闹钟源失败 → 撤销授权（只加不关，不误关那个源的闹钟）", async () => {
  const ok = await (await handleV2(req("date=2026-07-15&now=08:00"), {}, "/state", fakeLoaders())).json();
  assert.equal(ok.alarms.sweep, "true");                    // 正常 → 授权

  const bad = await (await handleV2(req("date=2026-07-15&now=08:00"), {}, "/state", {
    ...fakeLoaders(),
    async loadExternalAlarms(_env, _cfg, _dates, trace) {
      trace.push({ level: "warn", plugin: "sources", ref: "external_failed", msg: "超时" });
      return [];                                            // 拉取失败，返回空
    },
  })).json();
  assert.equal(bad.alarms.sweep, "false");                  // ★ 少了条目 → 不许 sweep
  assert.ok(bad.trace.some((x) => x.includes("sweep_withheld")));
  assert.ok(Array.isArray(bad.alarms.fixed));               // 加法部分照常下发
});

test("★fail-closed: 手机端判 `is true`，任何非 true 值都不该 sweep", async () => {
  // 本用例锁的是【服务端只会输出 "true"/"false" 两个值】这一契约，
  // 使手机端可以安全地写「If sweep is true → 执行 sweep」，其余一律跳过。
  for (const qs of ["date=2026-07-15&now=08:00", "date=2026-07-15&now=08:00&mode=point"]) {
    const b = await (await handleV2(req(qs), {}, "/state", fakeLoaders())).json();
    assert.ok(["true", "false"].includes(b.alarms.sweep), `sweep=${b.alarms.sweep} 不在枚举内`);
  }
});

// ── 批量回传（Ivan 2026-07-29: 下发一次连接，回传也该一次）────────────────────
test("/v2/fact 批量: 一次 POST 收多条，按 stream 分组只写一次 KV", async () => {
  const store = new Map();
  let puts = 0;
  const env = { FACTS_KV: {
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { puts++; store.set(k, v); },
  } };
  const post = (body) => handleFact(new Request("https://x/v2/fact?device=d", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);

  const res = await post({ events: [
    { stream: "applied_focus",  at: "2026-07-15 07:44", id: "a1" },
    { stream: "applied_focus",  at: "2026-07-15 20:55", id: "a2" },
    { stream: "applied_silent", at: "2026-07-15 20:55", id: "b1" },
  ] });
  const b = await res.json();
  assert.equal(b.ok, true);
  assert.equal(b.batch, true);
  assert.equal(b.results.length, 3);
  assert.equal(puts, 2, "两个 stream 只该写两次 KV，不是三次");
});

test("批量: 幂等去重逐条报告，坏事件不拖垮好事件", async () => {
  const store = new Map();
  const env = { FACTS_KV: { async get(k) { return store.get(k) ?? null; },
                            async put(k, v) { store.set(k, v); } } };
  const post = (body) => handleFact(new Request("https://x/v2/fact?device=d", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);

  await post({ events: [{ stream: "s", at: "2026-07-15 07:44", id: "dup" }] });
  const b = await (await post({ events: [
    { stream: "s", at: "2026-07-15 07:44", id: "dup" },        // 重复
    { stream: "s", at: "2026-07-15 08:00", id: "new" },        // 新的
    { stream: "s", at: "坏时间", id: "bad" },                   // 非法
  ] })).json();
  assert.equal(b.results.find((r) => r.id === "dup").deduped, true);
  assert.equal(b.results.find((r) => r.id === "new").deduped, false);
  assert.equal(b.results.find((r) => r.id === "bad").ok, false);
  assert.equal(b.ok, false, "有坏事件时整体 ok=false，但好的照样落库");
  assert.equal(JSON.parse(store.get("fact:d:s")).length, 2);
});

test("反例: 单条老形状继续收（手机端可以慢慢迁）", async () => {
  const store = new Map();
  const env = { FACTS_KV: { async get(k) { return store.get(k) ?? null; },
                            async put(k, v) { store.set(k, v); } } };
  const res = await handleFact(new Request("https://x/v2/fact?device=d", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stream: "s", at: "2026-07-15 07:44", id: "x1" }),
  }), env);
  const b = await res.json();
  assert.equal(b.ok, true);
  assert.equal(b.batch, undefined);
});
