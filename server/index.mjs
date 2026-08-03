// ─────────────────────────────────────────────────────────────────────────────
// server/index.mjs — 门铃调度器（服务器侧，秒级）
// ─────────────────────────────────────────────────────────────────────────────
// 它只做三件事，一行规则都不懂:
//   ① 收计划     Worker 的 cron 每 5 分钟 POST 全量计划过来（基线，永不撤）
//   ② 盯变更     按计划里的 watch 清单拉外部源，只算【内容哈希】不解析语义；
//                哈希变了就去取新计划 —— 这是快路径，把新鲜度从 5 分钟拉到 WATCH_SECONDS
//   ③ 到点按铃   本地定时器精确到秒，到点 GET /sweep?at=<时刻>，由 Worker 发 Bark
//
// ★ 为什么服务器不解析 ICS: 一旦它要判断"这个变化影不影响计划"，就得懂关键词、
//   区带、日型 —— 规则立刻变成两份真相。哈希是唯一不需要理解内容的变更信号。
// ★ 为什么日历地址不配在这里: 它在计划的 watch 字段里，由 Worker 下发。
//   地址只存在 Worker 一处（Secret），服务器不可能配错或配旧。
// ★ 为什么不自己发 Bark: key 只存在 Worker 一处，服务器到点回调即可（多一跳几百毫秒）。
// ─────────────────────────────────────────────────────────────────────────────
import http from "node:http";
import crypto from "node:crypto";

const CFG = {
  port:        Number(process.env.PORT || 8787),
  workerBase:  (process.env.WORKER_BASE || "").replace(/\/+$/, ""),  // https://xxx.workers.dev
  gatewayKey:  process.env.GATEWAY_KEY || "",
  watchSeconds: Number(process.env.WATCH_SECONDS || 30),
  pullMinutes: Number(process.env.PULL_MINUTES || 30),   // 兜底自检: 计划太旧就主动拉一次
};

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

// 上海钟（UTC+8 固定平面，与 Worker 同制）→ epoch ms
function shanghaiToEpoch(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(ts));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 8 * 3600e3;
}

const state = {
  version: null,
  doorbells: [],
  watch: [],
  hashes: new Map(),       // url → 上次内容哈希
  timers: [],
  lastPlanAt: 0,
  rang: [],                // 最近按过的铃，健康检查用
};

// ── ③ 到点按铃 ───────────────────────────────────────────────────────────────
function disarm() { for (const t of state.timers) clearTimeout(t); state.timers = []; }

// setTimeout 的延迟超过 2^31-1 毫秒(约 24.8 天)会溢出成【立即触发】—— 这是 Node 的
// 老坑，实跑撞到过。计划只有 48 小时，所以超出这个范围的一定是畸形数据，跳过并喊出来。
const MAX_DELAY = 2 ** 31 - 1;

function arm(plan) {
  disarm();
  const now = Date.now();
  let armed = 0, skipped = 0;
  for (const d of plan.doorbells || []) {
    const delay = shanghaiToEpoch(d.at) - now;
    if (!Number.isFinite(delay)) { skipped++; log(`时刻解析不了，跳过: ${d.at}`); continue; }
    if (delay < -60e3) { skipped++; continue; }                  // 已过去 1 分钟以上
    if (delay > MAX_DELAY) {
      skipped++;
      log(`⚠️ ${d.at} 距今超过 24 天，畸形计划，跳过（若非畸形则是 Worker 时刻算错了）`);
      continue;
    }
    state.timers.push(setTimeout(() => ring(d), Math.max(delay, 0)));
    armed++;
  }
  log(`已排定 ${armed} 个门铃${skipped ? `，跳过 ${skipped}` : ""} (version=${plan.version})`);
}

async function ring(d, attempt = 1) {
  const url = `${CFG.workerBase}/sweep?at=${encodeURIComponent(d.at)}&key=${encodeURIComponent(CFG.gatewayKey)}`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    log(`门铃 ${d.at}/${d.field} → pushed=${(body.pushed || []).length}`);
    state.rang.unshift({ at: d.at, field: d.field, ok: true, ts: new Date().toISOString() });
  } catch (e) {
    log(`门铃 ${d.at} 第 ${attempt} 次失败: ${e.message}`);
    // 推是快路径，但本地重试很便宜: 退避重试 3 次，仍不行就交给 Worker cron 兜底
    if (attempt < 3) return void setTimeout(() => ring(d, attempt + 1), attempt * 5000);
    state.rang.unshift({ at: d.at, field: d.field, ok: false, ts: new Date().toISOString() });
  }
  state.rang = state.rang.slice(0, 20);
}

// ── ① 收计划 / 主动取计划 ────────────────────────────────────────────────────
function adopt(plan, from) {
  state.lastPlanAt = Date.now();
  if (plan.version && plan.version === state.version) {
    log(`计划未变 (version=${plan.version}, 来自 ${from})，定时器不动`);
    return;
  }
  state.version = plan.version || null;
  state.doorbells = plan.doorbells || [];
  state.watch = plan.watch || [];
  arm(plan);
}

async function pullPlan(reason) {
  if (!CFG.workerBase) return;
  const url = `${CFG.workerBase}/sweep/plan?hours=24&key=${encodeURIComponent(CFG.gatewayKey)}`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    if (body.ok) adopt(body, `拉取(${reason})`);
    else log(`拉计划失败: ${body.error}`);
  } catch (e) { log(`拉计划异常: ${e.message}`); }
}

// ── ② 盯变更（只算哈希，不解析）──────────────────────────────────────────────
async function watchTick() {
  if (!state.watch.length) return;
  let changed = null;
  for (const w of state.watch) {
    try {
      const res = await fetch(w.url, { headers: { "Cache-Control": "no-cache" } });
      const h = sha(await res.text());
      const prev = state.hashes.get(w.url);
      state.hashes.set(w.url, h);
      if (prev && prev !== h) changed = w.url;
    } catch (e) { log(`盯源失败 ${w.url}: ${e.message}`); }   // 拉不到就跳过，下一轮再说
  }
  if (changed) {
    log(`外部源变了 → 取新计划: ${changed}`);
    await pullPlan("源变更");
  }
}

// ── HTTP: 收 Worker 推来的计划 + 健康检查 ───────────────────────────────────
http.createServer((req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj, null, 2));
  };
  if (req.method === "GET" && req.url.startsWith("/health")) {
    return send(200, {
      ok: true, version: state.version,
      armed: state.timers.length, watching: state.watch.length,
      plan_age_seconds: state.lastPlanAt ? Math.round((Date.now() - state.lastPlanAt) / 1000) : null,
      recent: state.rang,
    });
  }
  if (req.method === "POST" && req.url.startsWith("/plan")) {
    // 验来源: Worker 推送时带 X-Gateway-Key
    if (CFG.gatewayKey && req.headers["x-gateway-key"] !== CFG.gatewayKey) {
      return send(401, { error: "unauthorized" });
    }
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try {
        const plan = JSON.parse(raw);
        if (plan.kind !== "doorbell_plan") return send(400, { error: "kind 不对" });
        adopt(plan, "推送");
        send(200, { ok: true, version: state.version, armed: state.timers.length });
      } catch (e) { send(400, { error: e.message }); }
    });
    return;
  }
  send(404, { error: "not found" });
}).listen(CFG.port, () => log(`门铃调度器已启动 :${CFG.port} → ${CFG.workerBase || "(未配 WORKER_BASE)"}`));

// 启动即拉一次（别等第一次推送），然后进入盯变更循环
await pullPlan("启动");
setInterval(watchTick, CFG.watchSeconds * 1000);
// 兜底自检: 计划太久没更新（推送和拉取都失败过）就主动拉一次
setInterval(() => {
  if (Date.now() - state.lastPlanAt > CFG.pullMinutes * 60e3) pullPlan("计划过期自检");
}, 60e3);
