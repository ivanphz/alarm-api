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
  const b = await call(`date=${WED}&now=20:55&mode=point&locales=zh`);
  assert.equal(b.fields.focus.value.preset, "sleep");
  assert.equal(b.fields.focus.value.action, "on");
  assert.equal(b.fields.focus.from, `${WED} 20:55`);
});

test("午间挡位 = do_not_disturb（12:15 开，白天不开睡眠）", async () => {
  const b = await call(`date=${WED}&now=12:15&mode=point&locales=zh`);
  assert.equal(b.fields.focus.value.preset, "do_not_disturb");   // ★ 本次修的就是这里
  assert.equal(b.fields.focus.value.action, "on");
  assert.equal(b.fields.focus.from, `${WED} 12:15`);
  // 反例: 午间绝不能是 sleep
  assert.notEqual(b.fields.focus.value.preset, "sleep");
});

test("午休两端都不设守卫（到点即接管，到点即归还）", async () => {
  for (const [t, act] of [["12:15", "on"], ["13:29", "off"]]) {
    const b = await call(`date=${WED}&now=${t}&mode=point&locales=zh`);
    assert.equal(b.fields.focus.value.action, act);
    assert.equal(b.fields.focus.value.preset, "do_not_disturb");
    assert.equal(b.fields.focus.guards, undefined, `${t} 不该有守卫（信封不发空数组）`);
  }
});

test("早间解除 07:40 不受影响: 仍是 sleep + sleep 守卫（回归）", async () => {
  const b = await call(`date=${WED}&now=07:44&mode=point&locales=zh`);
  assert.equal(b.fields.focus.value.action, "off");
  assert.equal(b.fields.focus.value.preset, "sleep");
  assert.equal(b.fields.focus.guards[0].op, "in");
  assert.deepEqual(b.fields.focus.guards[0].value, ["sleep"]);
  assert.equal(b.fields.focus.guards[0].match[0], "睡眠");        // 系统语言优先
});

test("四个边界的手机签名 preset|action 两两相邻不相等（on_change 才会逐个点火）", async () => {
  const sigs = [];
  for (const t of ["07:44", "12:15", "13:29", "20:55"]) {
    const b = await call(`date=${WED}&now=${t}&mode=point&locales=zh`);
    const v = b.fields.focus.value;
    sigs.push(`${v.preset || ""}|${v.action}`);
  }
  assert.deepEqual(sigs, ["sleep|off", "do_not_disturb|on", "do_not_disturb|off", "sleep|on"]);
  for (let i = 1; i < sigs.length; i++) assert.notEqual(sigs[i], sigs[i - 1]);
});


// ── 空展开告警（fail-loud）───────────────────────────────────────────────────
// 2026-07-27 实案: URL 丢了 ?locales= → resolve.current_focus 不下发 → guards.match 空
// → 手机 CheckGuards 的 in 分支永远拦截 → 专注整天不解除，且 trace 一个字都没有。
// ★ 缺 locales 不再瘫痪: 降级为全语言兜底（Ivan 2026-07-31）
// 原先 fail-closed —— 整表不下发 → match 全空 → in 永远拦截 → focus 整个报废。
// 瘫痪比"少保护"糟得多，所以改成兜底 + 响亮告警。
test("URL 缺 ?locales= → 降级全语言兜底，功能不瘫痪，但告警响亮", async () => {
  const b = await call(`date=${WED}&now=07:44&mode=point`);
  const match = b.fields.focus.guards[0].match;
  assert.ok(match.includes("睡眠") && match.includes("Sleep"), "全语言都要在，守卫才命中得了");
  assert.equal(b.trace.filter((x) => x.includes("empty_match")).length, 0, "不该再是空展开");
  const warned = b.trace.filter((x) => x.includes("locales_fallback"));
  assert.ok(warned.length > 0, "降级必须告警，否则就是静默凑合");
  assert.ok(warned[0].includes("不瘫痪"), "告警要说清后果");
});

test("反例: 带 ?locales=zh 展开正常 → 不得有 empty_match 告警（避免狼来了）", async () => {
  const b = await call(`date=${WED}&now=07:44&mode=point&locales=zh`);
  assert.equal(b.fields.focus.guards[0].match[0], "睡眠");     // 系统语言优先
  assert.ok(b.fields.focus.guards[0].match.includes("Sleep")); // 其余语言追加兜底
  assert.equal(b.trace.filter((x) => x.includes("empty_match")).length, 0);
});

// ── 多值守卫 + none token（"不打破手动开的现场"）────────────────────────────
// 语义: in:["none", 目标挡] = 当前没专注、或已经是目标挡，才动手。
// 手动开了别的专注 → SKIP 且不落账 → 下次轮询自动重试（不是永久失败）。
test("only_if_current 支持数组 → 下发 in + 多元素（能力仍在，当前配置未用）", async () => {
  const { assembleState } = await import("../../src/edge/assemble.js");
  const env = assembleState({
    fieldsConfig: {
      focus: { KIND: "focus", USE: "quiet", PRESET: "sleep", APPLY: "on_change",
               OWN: { "20:55": { only_if_current: ["none", "sleep"] } } },
    },
    schedules: { quiet: [{ from: "2026-07-15 20:55", value: "on" }] },
    range: { start: "2026-07-15", end: "2026-07-16" },
    at: "2026-07-15 20:55", mode: "point",
    resolve: { current_focus: { none: [""], sleep: ["睡眠"] } }, trace: [],
  });
  const g = env.fields.focus.guards[0];
  assert.equal(g.op, "in");
  assert.deepEqual(g.value, ["none", "sleep"]);          // 反例: 不能是 ["none,sleep"] 这个假 token
  assert.deepEqual(g.match, ["", "睡眠"]);
});

test("none token 展开为空字符串 = 手机 Get Current Focus 无专注时的返回", async () => {
  const b = await call(`date=${WED}&now=12:15&mode=point&locales=zh`);
  assert.deepEqual(b.resolve.current_focus.none, [""]);
  const night = await call(`date=${WED}&now=20:55&mode=point&locales=zh`);
  assert.deepEqual(night.fields.focus.guards[0].match, [""]);   // 单 none → 只认"没专注"
});

test("两个夜间边界（工作日前夜 20:55 / 休息日前夜 22:25）守卫都是单 none", async () => {
  const workEve = await call(`date=${WED}&now=20:55&mode=point&locales=zh`);
  const restEve = await call(`date=2026-07-17&now=22:25&mode=point&locales=zh`);   // 周五
  for (const b of [workEve, restEve]) {
    assert.equal(b.fields.focus.value.action, "on");
    assert.equal(b.fields.focus.value.preset, "sleep");
    assert.deepEqual(b.fields.focus.guards, [
      { source: "current_focus", op: "in", value: ["none"], match: [""] },
    ]);
  }
});

test("反例: 早间解除守卫是 sleep 且不含 none（没专注时不该去执行一次关闭）", async () => {
  for (const t of ["07:44", "09:30"]) {
    const d = t === "07:44" ? WED : SAT;
    const b = await call(`date=${d}&now=${t}&mode=point&locales=zh`);
    assert.equal(b.fields.focus.value.action, "off");
    assert.deepEqual(b.fields.focus.guards[0].value, ["sleep"]);
  }
});

test("反例: 缺 locales 时 none 照样拿得到（它是空字符串，不随语言变）", async () => {
  const b = await call(`date=${WED}&now=20:55&mode=point`);
  assert.deepEqual(b.fields.focus.guards[0].match, [""]);
  assert.ok(b.trace.some((x) => x.includes("locales_fallback")));
});

// ── apply=once: 边界是一次性动作，不是持续期望态 ──────────────────────────────
// 前提（2026-07-27 修正）: 没有周期轮询，SyncAll 只在 6 个刺客 + 少数事件时跑。
// 于是"段"不是被巡检的期望态，而是上一次动手之后的余波；拿余波指挥后来的调用会误伤。
// once = 到点必执行（守卫仍可否决），过后不再有主张 → 白天手动开的专注安全。
// 副产品: once/enforce 都不查 la → focus 字段彻底不依赖本地 la。




test("APPLY_AT: 单个边界可改判据（任意字段、任意时刻自己指定）", async () => {
  const { assembleState } = await import("../../src/edge/assemble.js");
  const base = { KIND: "focus", USE: "quiet", PRESET: "sleep", SHAPE: "level",
                 APPLY: "always", OWN: {} };
  const schedules = { quiet: [{ from: "2026-07-15 20:55", value: "on" },
                              { from: "2026-07-16 07:40", value: "off" }] };
  const range = { start: "2026-07-15", end: "2026-07-17" };
  const call = (cfg, at) => assembleState({ fieldsConfig: { focus: cfg }, schedules, range, at, trace: [] });
  // 默认 always → 该段下发 enforce
  assert.equal(call(base, "2026-07-15 23:00").fields.focus.apply, "enforce");
  // 只把 20:55 这一个边界改成"比记忆"，07:40 那个不受影响
  const cfg2 = { ...base, APPLY_AT: { "20:55": "if_changed" } };
  assert.equal(call(cfg2, "2026-07-15 23:00").fields.focus.apply, "on_change");
  assert.equal(call(cfg2, "2026-07-16 09:00").fields.focus.apply, "enforce");
});


test("长假五连休: 每晚刺客都拿得到 focus（脉冲不合并同值，无需 null 收尾）", async () => {
  const H = new Set(["2026-07-13","2026-07-14","2026-07-15","2026-07-16","2026-07-17"]);
  const holiday = {
    async loadWorkdays() {
      const out = [];
      for (let d = "2026-06-29"; d <= "2026-08-02"; d = addDays(d, 1)) {
        const w = new Date(d + "T00:00:00Z").getUTCDay();
        out.push({ date: d, off: H.has(d) || w === 0 || w === 6, name: H.has(d) ? "长假" : "" });
      }
      return out;
    },
    async loadCalendars() { return []; },
    async loadExternalAlarms() { return []; },
    async loadFacts() { return { streams: {}, degraded: [] }; },
  };
  for (const d of ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16"]) {
    const res = await handleV2(new Request(`https://x/v2/state?date=${d}&now=22:25&mode=point&locales=zh`),
                               {}, "/state", holiday);
    const b = await res.json();
    assert.ok(b.fields.focus, `${d} 夜间 focus 缺席 —— 长假会连着几晚不进睡眠`);
    assert.equal(b.fields.focus.value.action, "on");
    assert.equal(b.fields.silent.value, "on");        // silent 是电平，一直是对的
  }
});

// ═══ 边界级形状（ATOMIC-RULES §2.1.1）════════════════════════════════════════
// 夜间 level+if_changed / 晨间 有界电平+always / 午休 pulse+always
test("形状与判据: 六个边界各按自己的配置下发", async () => {
  const cases = [
    [WED, "07:44", "sleep", "off", "enforce"],
    [WED, "12:15", "do_not_disturb", "on", "enforce"],
    [WED, "13:29", "do_not_disturb", "off", "enforce"],
    [WED, "20:55", "sleep", "on", "on_change"],
    ["2026-07-17", "22:25", "sleep", "on", "on_change"],
    [SAT, "09:30", "sleep", "off", "enforce"],
  ];
  for (const [d, t, preset, action, apply] of cases) {
    const b = await call(`date=${d}&now=${t}&mode=point&locales=zh`);
    assert.equal(b.fields.focus.value.preset, preset, `${t} preset`);
    assert.equal(b.fields.focus.value.action, action, `${t} action`);
    assert.equal(b.fields.focus.apply, apply, `${t} apply`);
  }
});






test("长假五连休: 每晚刺客都拿得到 focus（null 释放主张未被 OWN 吞掉）", async () => {
  const H = new Set(["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"]);
  const holiday = {
    async loadWorkdays() {
      const out = [];
      for (let d = "2026-06-29"; d <= "2026-08-02"; d = addDays(d, 1)) {
        const w = new Date(d + "T00:00:00Z").getUTCDay();
        out.push({ date: d, off: H.has(d) || w === 0 || w === 6, name: H.has(d) ? "长假" : "" });
      }
      return out;
    },
    async loadCalendars() { return []; },
    async loadExternalAlarms() { return []; },
    async loadFacts() { return { streams: {}, degraded: [] }; },
  };
  for (const d of ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16"]) {
    const res = await handleV2(new Request(`https://x/v2/state?date=${d}&now=22:25&mode=point&locales=zh`),
                               {}, "/state", holiday);
    const b = await res.json();
    assert.ok(b.fields.focus, `${d} 夜间 focus 缺席 —— 长假会连着几晚不进睡眠`);
    assert.equal(b.fields.focus.value.action, "on");
    assert.equal(b.fields.silent.value, "on");
  }
});

test("窗口终点与碰撞区终点不一致 → 审计响亮告警（fail-loud）", async () => {
  const b = await call(`date=${WED}&now=21:00&locales=zh`);
  // 晨间解除改为锚定起床闹钟后，窗口不再与 ZONES.MORNING.end 绑定，该审计自然沉默
  assert.equal(b.trace.filter((x) => x.includes("morning_window")).length, 0);
});

// ★ 吸附之后: 常规日子【零门铃】—— 所有边界都落在已有刺客上（Ivan 2026-07-31）
test("常规工作日不需要任何门铃（边界全部落在已有刺客上）", async () => {
  const b = await call(`date=${WED}&now=20:55&mode=point&locales=zh`);
  assert.equal(b.trace.filter((x) => x.includes("needs_doorbell")).length, 0,
    "常规日子不该有任何依赖门铃的边界");
});

test("反例: 出差日的动态解除时刻仍需门铃（那才是门铃存在的理由）", async () => {
  const trip = {
    async loadWorkdays() {
      const out = [];
      for (let d = "2026-07-01"; d <= "2026-08-02"; d = addDays(d, 1)) {
        const w = new Date(d + "T00:00:00Z").getUTCDay();
        out.push({ date: d, off: w === 0 || w === 6, name: "" });
      }
      return out;
    },
    async loadCalendars() {
      return [{ title: "出差", date: WED, start_time: "08:10", end_time: "22:00" }];
    },
    async loadExternalAlarms() { return []; },
    async loadFacts() { return { streams: {}, degraded: [] }; },
  };
  const res = await handleV2(new Request(`https://x/v2/state?date=${WED}&now=08:30&mode=point&locales=zh`),
                             {}, "/state", trip);
  const b = await res.json();
  const hit = b.trace.filter((x) => x.includes("needs_doorbell"));
  assert.ok(hit.some((x) => x.includes("08:30")), "08:30 是算出来的，没有刺客覆盖");
});

test("通道抽象: media_volume 带 channel token，resolve 给本机名", async () => {
  const b = await call(`date=${WED}&now=20:55&mode=point&locales=zh`);
  assert.equal(b.fields.media_volume.channel, "media");     // 不是写死的枚举
  assert.equal(b.resolve.volume_channel.media[0], "媒体");        // 系统语言优先
  assert.equal(b.resolve.volume_channel.ringtone[0], "电话铃声");
});

// ═══ 全 pulse 契约（Ivan 2026-07-31）═════════════════════════════════════════
// 六个边界全部是【一次性事件】: 到点做一次，之后没有任何主张。
//   · 白天/夜里的段查询一律看不见 focus → 手动开的专注永不被误关
//   · 每晚都是独立事件 → 长假连着几晚照常进睡眠（同值不合并）
//   · 常规日子的时刻都落在刺客上 → 零门铃；只有出差的动态时刻才用门铃
test("段查询一律看不见 focus（pulse 段内无主张）", async () => {
  for (const t of ["06:00", "08:00", "10:00", "12:30", "15:00", "21:00", "23:00"]) {
    const b = await call(`date=${WED}&now=${t}&locales=zh`);
    assert.equal(b.fields.focus, undefined, `${t} 不该有 focus 主张`);
  }
});

test("反例: silent 也是 pulse，段查询同样看不见；但 media_volume 的午间归零仍在点上", async () => {
  const seg = await call(`date=${WED}&now=15:00&locales=zh`);
  assert.equal(seg.fields.silent, undefined);
  const pt = await call(`date=${WED}&now=12:15&mode=point&locales=zh`);
  assert.equal(pt.fields.media_volume.value, 0);
});

test("六个边界的时刻: 工作日 07:44 / 周末 09:30 / 夜间 20:55 或 22:25", async () => {
  const at = async (d, t) => (await call(`date=${d}&now=${t}&mode=point&locales=zh`)).fields.focus;
  assert.equal((await at(WED, "07:44")).value.action, "off");
  assert.equal((await at(WED, "20:55")).value.action, "on");
  assert.equal((await at(SAT, "09:30")).value.action, "off");
  assert.equal((await at(SAT, "22:25")).value.action, "on");
  // 反例: 旧的 07:40 已不再是边界（下限提到 07:44）
  assert.equal(await at(WED, "07:36"), undefined);
});

test("?apply=enforce 仍然压得过一切（人工推平时 pulse 也要能被取到）", async () => {
  const b = await call(`date=${WED}&now=07:44&mode=point&locales=zh&apply=enforce`);
  assert.equal(b.fields.focus.apply, "enforce");
});
