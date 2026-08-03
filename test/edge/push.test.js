// test/edge/push.test.js — 门铃（ATOMIC-RULES §3 / CHANNELS §5 三条纪律）
import test from "node:test";
import assert from "node:assert/strict";
import { pickDoorbells, sweepDoorbells, barkDriver } from "../../src/edge/push.js";
import { handleSweep } from "../../src/edge/router.js";
import { addDays } from "../../src/kernel/intervals.js";

const WHITELIST = ["20:55", "22:25", "07:40", "09:30", "12:15", "13:29"];
const TL = {
  focus: [
    { from: "2026-07-15 08:00", value: null },                // ★ 窗口终点，无刺客
    { from: "2026-07-15 20:55", value: { action: "on" } },    // 有刺客
  ],
  silent: [{ from: "2026-07-15 08:12", value: null }],        // 动态时刻，无刺客
};

test("只捡【没有刺客覆盖】的边界 —— 白名单内的手机自己会醒", () => {
  const due = pickDoorbells(TL, WHITELIST, "2026-07-15 07:00", "2026-07-15 21:00");
  assert.deepEqual(due.map((d) => `${d.hm}/${d.field}`), ["08:00/focus", "08:12/silent"]);
  assert.equal(due[0].released, true);                        // 值为 null = 释放主张
});

test("窗口是左开右闭 (from, to] —— 相邻两轮扫描不重不漏", () => {
  const a = pickDoorbells(TL, WHITELIST, "2026-07-15 07:55", "2026-07-15 08:00");
  const b = pickDoorbells(TL, WHITELIST, "2026-07-15 08:00", "2026-07-15 08:05");
  assert.deepEqual(a.map((d) => d.hm), ["08:00"]);
  assert.deepEqual(b.map((d) => d.hm), []);                   // 反例: 不能被扫第二次
});

test("反例: 00:00 的锚定伪边界不按门铃", () => {
  const due = pickDoorbells({ f: [{ from: "2026-07-15 00:00", value: 1 }] }, WHITELIST,
                            "2026-07-14 23:00", "2026-07-15 01:00");
  assert.deepEqual(due, []);
});

test("一轮扫描只按一次门铃（多按会撞上单槽忙丢，把别的触发挤掉）", async () => {
  const sent = [];
  const res = await sweepDoorbells({ KEYWORD: "|SYNCALL|" }, {
    timelines: TL, whitelist: WHITELIST,
    fromTs: "2026-07-15 07:00", toTs: "2026-07-15 21:00",
    send: async (m) => { sent.push(m); }, trace: [],
  });
  assert.equal(sent.length, 1);
  assert.equal(res.pushed.length, 2);                          // 两条边界，一次门铃
});

test("★ 纪律1: 一律 active 档（零打扰仍触发；critical 会把人吵醒）", async () => {
  const sent = [];
  await sweepDoorbells({}, {
    timelines: TL, whitelist: WHITELIST,
    fromTs: "2026-07-15 07:00", toTs: "2026-07-15 09:00",
    send: async (m) => { sent.push(m); }, trace: [],
  });
  assert.equal(sent[0].level, "active");
});

test("★ 纪律3: 关键词带分隔符（contains 是子串匹配，SYNC 会命中 SYNCALL）", async () => {
  const sent = [];
  await sweepDoorbells({ KEYWORD: "|SYNCALL|" }, {
    timelines: TL, whitelist: WHITELIST,
    fromTs: "2026-07-15 07:00", toTs: "2026-07-15 09:00",
    send: async (m) => { sent.push(m); }, trace: [],
  });
  assert.equal(sent[0].title, "|SYNCALL|");
  assert.ok(sent[0].title.startsWith("|") && sent[0].title.endsWith("|"));
});

test("★ 纪律2: 门铃不是信件 —— 通知里不得出现可执行的状态值", async () => {
  const sent = [];
  await sweepDoorbells({}, {
    timelines: TL, whitelist: WHITELIST,
    fromTs: "2026-07-15 07:00", toTs: "2026-07-15 21:00",
    send: async (m) => { sent.push(m); }, trace: [],
  });
  const text = JSON.stringify(sent[0]);
  for (const t of ["sleep", "do_not_disturb", '"on"', '"off"']) {
    assert.ok(!text.includes(t), `门铃里不该出现指令内容: ${t}`);
  }
});

test("推送失败不抛 —— 推是快路径，丢了退回等下一个入口", async () => {
  const trace = [];
  const res = await sweepDoorbells({}, {
    timelines: TL, whitelist: WHITELIST,
    fromTs: "2026-07-15 07:00", toTs: "2026-07-15 09:00",
    send: async () => { throw new Error("网络挂了"); }, trace,
  });
  assert.deepEqual(res.pushed, []);
  assert.ok(trace.some((t) => t.ref === "doorbell_failed"));
});

test("没配驱动 → 明确说明原因，不静默什么都不做", async () => {
  const res = await sweepDoorbells({}, {
    timelines: TL, whitelist: WHITELIST,
    fromTs: "2026-07-15 07:00", toTs: "2026-07-15 09:00", send: null, trace: [],
  });
  assert.match(res.skipped, /BARK_KEY/);
});

test("barkDriver: URL 形状与 active 档参数", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { seen.push(u); return new Response("ok"); };
  try {
    await barkDriver({ baseUrl: "https://api.day.app/", key: "K", group: "g" })
      ({ title: "|SYNCALL|", body: "x", level: "active" });
  } finally { globalThis.fetch = realFetch; }
  assert.ok(seen[0].startsWith("https://api.day.app/K/"));
  assert.ok(seen[0].includes("level=active"));
  assert.ok(seen[0].includes("group=g"));
});

// ── 端到端: cron 入口 ─────────────────────────────────────────────────────────
function loaders() {
  return {
    async loadWorkdays() {
      const out = [];
      for (let d = "2026-07-01"; d <= "2026-08-15"; d = addDays(d, 1)) {
        const w = new Date(d + "T00:00:00Z").getUTCDay();
        out.push({ date: d, off: w === 0 || w === 6, name: "" });
      }
      return out;
    },
    async loadCalendars() { return []; },
    async loadExternalAlarms() { return []; },
    async loadFacts() { return { streams: {}, degraded: [] }; },
  };
}

async function sweep(now, opts) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { sent.push(u); return new Response("ok"); };
  try {
    const res = await handleSweep({ BARK_KEY: "K" }, loaders(), now, opts);
    return { body: await res.json(), sent };
  } finally { globalThis.fetch = realFetch; }
}

// ★ 2026-07-31 吸附之后: 常规日子所有边界都落在刺客上 → cron 扫到的是空。
//   门铃只为【真正动态】的时刻存在（出差日算出来的解除时刻）。
test("cron 兜底: 常规日子扫不到任何门铃（边界已吸附到刺客）", async () => {
  const { body, sent } = await sweep("2026-07-15 07:54", { lagMinutes: 10 });
  assert.equal(body.ok, true);
  assert.equal(body.lag_minutes, 10);
  assert.deepEqual(body.pushed, [], "常规日子不该按门铃");
  assert.equal(sent.length, 0);
});

test("★ 出差日: 算出来的 08:30 没有刺客 → 门铃按下", async () => {
  const trip = { ...loaders(),
    async loadCalendars() {
      return [{ title: "出差", date: "2026-07-15", start_time: "08:10", end_time: "22:00" }];
    } };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { sent.push(u); return new Response("ok"); };
  let body;
  try {
    const res = await handleSweep({ BARK_KEY: "K" }, trip, "2026-07-15 08:40", { lagMinutes: 10 });
    body = await res.json();
  } finally { globalThis.fetch = realFetch; }
  assert.ok(body.pushed.some((d) => d.hm === "08:30"));
  assert.equal(sent.length, 1);
});

test("★ 服务器精确触发: ?at= 只捡那一刻，不误伤邻近边界", async () => {
  const trip = { ...loaders(),
    async loadCalendars() {
      return [{ title: "出差", date: "2026-07-15", start_time: "08:10", end_time: "22:00" }];
    } };
  const run = async (at) => {
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { sent.push(u); return new Response("ok"); };
    try {
      const res = await handleSweep({ BARK_KEY: "K" }, trip, null, { fromTs: at, toTs: at });
      return { body: await res.json(), sent };
    } finally { globalThis.fetch = realFetch; }
  };
  const hit = await run("2026-07-15 08:30");
  assert.ok(hit.body.pushed.length > 0);
  assert.ok(hit.body.pushed.every((d) => d.hm === "08:30"));
  const miss = await run("2026-07-15 08:31");
  assert.deepEqual(miss.body.pushed, []);            // 反例: 差一分钟就不该按
  assert.equal(miss.sent.length, 0);
});

test("反例: 刺客覆盖得到的时刻不按门铃（20:55 有时间自动化）", async () => {
  const { body } = await sweep("2026-07-15 21:05", { lagMinutes: 10 });
  assert.deepEqual(body.pushed, []);
});

test("门铃时刻表: 服务器拉一次就能做秒级调度", async () => {
  const { handleSweepPlan } = await import("../../src/edge/router.js");
  const res = await handleSweepPlan(
    new Request("https://x/sweep/plan?now=2026-07-15%2000:00&hours=24"),
    { GATEWAY_KEY: "" }, loaders(),
  );
  const b = await res.json();
  assert.equal(b.ok, true);
  assert.deepEqual(b.doorbells, [], "常规日子的边界全部吸附到刺客 → 时刻表为空");
  assert.ok(!b.doorbells.some((d) => WHITELIST.includes(d.hm)), "有刺客的时刻不该出现在表里");
});

// ── 计划推送: Worker 主动 POST 给服务器（服务器零轮询）────────────────────────
test("planVersion: 内容不变则指纹不变，变一个字段就变", async () => {
  const { planVersion } = await import("../../src/edge/push.js");
  const a = [{ at: "2026-07-15 08:00", field: "focus", released: true }];
  const b = [{ at: "2026-07-15 08:00", field: "focus", released: true }];
  const c = [{ at: "2026-07-15 08:01", field: "focus", released: true }];
  assert.equal(planVersion(a), planVersion(b));
  assert.notEqual(planVersion(a), planVersion(c));
});

test("推全量计划 + version，服务器收到即整体替换", async () => {
  const { pushPlan } = await import("../../src/edge/push.js");
  const seen = [];
  const res = await pushPlan({ WEBHOOK_URL: "https://my.server/plan" }, {
    doorbells: [{ at: "2026-07-15 08:00", field: "focus", hm: "08:00", released: true }],
    now: "2026-07-15 00:00", until: "2026-07-16 00:00", key: "GK", trace: [],
    fetchImpl: async (u, init) => { seen.push({ u, init }); return { ok: true, status: 200 }; },
  });
  assert.equal(res.sent, true);
  assert.equal(seen[0].u, "https://my.server/plan");
  assert.equal(seen[0].init.headers["X-Gateway-Key"], "GK");   // 服务器据此验来源
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.kind, "doorbell_plan");
  assert.equal(body.doorbells.length, 1);
  assert.ok(body.version);
});

test("推送失败不抛 —— 服务器收不到就退回 Worker cron 兜底", async () => {
  const { pushPlan } = await import("../../src/edge/push.js");
  const trace = [];
  const res = await pushPlan({ WEBHOOK_URL: "https://my.server/plan" }, {
    doorbells: [], now: "x", until: "y", trace,
    fetchImpl: async () => { throw new Error("服务器挂了"); },
  });
  assert.equal(res.sent, false);
  assert.ok(trace.some((t) => t.ref === "plan_push_failed"));
});

test("反例: 没配 webhook 就不推，且说明原因（不静默）", async () => {
  const { pushPlan } = await import("../../src/edge/push.js");
  const res = await pushPlan({}, { doorbells: [], trace: [] });
  assert.match(res.skipped, /WEBHOOK_URL/);
});

test("cron 路径才推计划；HTTP 手动触发不打扰服务器", async () => {
  const posts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (init && init.method === "POST") posts.push(u);
    return new Response("ok");
  };
  try {
    await handleSweep({ BARK_KEY: "K", PLAN_WEBHOOK: "https://my.server/plan" },
                      loaders(), "2026-07-15 08:12", { lagMinutes: 10 });
    assert.equal(posts.length, 0, "手动触发不该推计划");
    await handleSweep({ BARK_KEY: "K", PLAN_WEBHOOK: "https://my.server/plan" },
                      loaders(), "2026-07-15 08:12", { lagMinutes: 10, withPlan: true });
    assert.equal(posts.length, 1, "cron 路径应推一次计划");
  } finally { globalThis.fetch = realFetch; }
});
