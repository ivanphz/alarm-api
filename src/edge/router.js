// ─────────────────────────────────────────────────────────────────────────────
// edge/router.js — /v2 路由 + 鉴权（V12 步骤③）
// ─────────────────────────────────────────────────────────────────────────────
// 端点:
//   GET /v2/state     采样（?mode=segment|point，默认 segment —— level 是主表示）
//   GET /v2/timeline  全时间线预览/审计（?debug 内容常开：schedules + 字段时间线）
// 参数: ?date=YYYY-MM-DD（锚日，缺省=上海今天，纯函数红利之任意日期预览）
//       ?now=HH:MM（采样钟，缺省=上海此刻） ?device=（契约11，现恒 default）
//       ?debug=1  ?testEvents=  ?skipCalendar=1（沙盒与 v1 同参）
// 鉴权与 v1 同制: GATEWAY_KEY 三传法、AUTH_DISABLED 裸奔开关、fail-closed、常量时间比较。
// "now"只存在于本采样端（契约7）: 时钟在此取一次，向下全是参数。
// ─────────────────────────────────────────────────────────────────────────────
import { CONFIG } from "../config.js";
import { addDays, addMinutes } from "../kernel/intervals.js";
import { buildTimeline } from "../kernel/registry.js";
import { buildFieldTimelines } from "../kernel/fields.js";
import { assembleState } from "./assemble.js";
import { toCanonical, applyCanonical, toTimeMajor, toFieldMajor, auditRuleRefs,
         deriveAutomations, renderRuleTable } from "../kernel/rules.js";
import { sweepDoorbells, barkDriver, pickDoorbells, pushPlan } from "./push.js";
import { buildResolve } from "./resolve.js";
import * as sources from "./sources.js";
import restdays from "../plugins/restdays.js";
import presence from "../plugins/presence.js";
import dayType from "../plugins/day-type.js";
import schoolBreak from "../plugins/school-break.js";
import godMode from "../plugins/god-mode.js";
import wakeAlarms from "../plugins/wake-alarms.js";
import weekendClass from "../plugins/weekend-class.js";
import { makeCadencePlugins } from "../plugins/cadence.js";
import { assembleAlarms } from "./assemble.js";
import { auditFieldSubscriptions } from "../kernel/audit.js";

// 晨间解除窗口的终点必须等于碰撞区终点 —— 它们是同一条"再晚归人管"的线。
// 两处各写一遍字符串，改一处忘另一处的后果是【静默的】: 解除窗口提前关闭，
// 漏发就补不上了，而且没有任何报错。规则表阶段会自动派生，在那之前用审计盯着。
function auditMorningWindow(fieldsCfg, config, trace) {
  const at = ((fieldsCfg || {}).focus || {}).RULES_AT || {};
  const edge = (((config || {}).ZONES || {}).MORNING || {}).end;
  const morning = ((config || {}).DND || {}).MORNING_OFF_WORKDAY;
  const win = (at[morning] || []).find((v) => v.until);
  if (!edge || !win) return;
  if (win.until !== edge) {
    trace.push({ level: "warn", plugin: "audit", ref: "morning_window",
      msg: `focus 晨间解除窗口 until=${win.until} 与 ZONES.MORNING.end=${edge} 不一致 —— ` +
           `窗口应与碰撞区终点同源。改 config.user.js 时两处要一起改` });
  }
}
import { schedulesFeeding } from "../kernel/registry.js";

// 核心插件（静态注册）。cadence 任务插件由 CADENCE.TASKS 配置【生成】，见 buildPlugins。
// quiet 已于 2026-07-29 退役: 三个字段全部迁进规则表后它再无消费者，
// 其 R6.1–R6.3 的分支判定搬进 day-type 的三根正交轴（覆盖见 test/plugins/day-type.e2e.test.js）
export const CORE_PLUGINS = [restdays, presence, dayType, schoolBreak, godMode, wakeAlarms, weekendClass];

/** 核心插件 + 由配置生成的 cadence 任务插件 */
export function buildPlugins(v2cfg) {
  return [...CORE_PLUGINS, ...makeCadencePlugins(v2cfg)];
}

// v2 缺省配置（config.user.js 里加 V2:{...} 深合并覆盖；键名不属于 API，沿用大写风格）

/** 由 CADENCE.TASKS 自动派生 cadence.<task> 字段（加任务无需手写字段配置） */
export function withCadenceFields(fields, v2cfg) {
  const tasks = (v2cfg.CADENCE || {}).TASKS || {};
  const out = { ...fields };
  for (const [name, task] of Object.entries(tasks)) {
    if (task && task.enabled === false) continue;   // 关闭的任务字段整体缺席（见 cadence.js 说明）
    const key = `cadence.${name}`;
    if (!out[key]) {
      out[key] = { KIND: "scalar", USE: `cadence_${name}`, APPLY: "on_change", OWN: {} };
    }
  }
  return out;
}

/** V2 配置 = config.default.js 的 V2 段，已由 config.js 的 deepMerge 逐层合并用户覆盖 */
export function v2Config() {
  return CONFIG.V2;
}

// 兼容导出（测试与旧引用）。注意它已是 default+user 合并后的结果，不再是"纯默认值"。
export const V2_DEFAULTS = CONFIG.V2;

// 本轮运行的分组键: 手机端把它写进每一行日志，多次运行的记录不会混在一起。
// 服务端生成而不是手机端 —— 这样服务端日志与手机端日志能对上同一个 id（P-观测要用）。
function runId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// ── 上海钟（中国无夏令时，UTC+8 固定平面）──
export function shanghaiNow() {
  const d = new Date(Date.now() + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
         ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 门铃：双端分工（Ivan 2026-07-29）
// ─────────────────────────────────────────────────────────────────────────────
//   主力 = 你自己的服务器。它能秒级调度: 先拉 /sweep/plan 拿未来一段时间的门铃
//          时刻表，本地定时器到点调 /sweep?at=<时刻>，误差在秒级。
//   兜底 = Worker 的 cron。cron 最细只到分钟，且窗口 SWEEP_MINUTES 意味着最坏晚
//          那么多分钟，所以它只负责【服务器没干成】的那部分 —— 靠 LAG_MINUTES
//          滞后一个安全期再扫，服务器正常工作时它扫到的永远是空。
//
//   为什么兜底不做去重: 门铃是幂等的（手机收到只会去 GET 一次权威状态），
//   重按最多浪费一次唤醒。要做真去重就得有共享状态(KV)，为这点收益不值当。
//   LAG 已经让重复概率很低: 服务器按过 → 手机已同步 → LAG 之后 cron 再按一次也无害。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 外部源清单: 服务器要盯的 URL（只用来算哈希判变更，不解析）。
 * 地址仍然只存在 Worker 一处 —— 服务器不配日历地址，也就不可能配错或配旧。
 */
function watchSources(env) {
  const out = [];
  for (const u of String((env && env.CALENDAR_URLS) || "").split(",")) {
    const url = u.trim();
    if (url) out.push({ kind: "ics", url });
  }
  for (const src of ((CONFIG.EXTERNAL_ALARMS || {}).SOURCES || [])) {
    if (src && src.enabled !== false && src.url) out.push({ kind: src.type || "ics", url: src.url });
  }
  return out;
}

/** 建门铃扫描所需的时间线（服务器与 cron 共用） */
async function buildSweepContext(env, loaders, date, trace) {
  const cfg = CONFIG.V2;
  const range = { start: addDays(date, -1), end: addDays(date, 1) };
  const wide = { start: addDays(range.start, -16), end: addDays(range.end, 16) };
  const workdays = await loaders.loadWorkdays(date, trace);
  const calendars = await loaders.loadCalendars(env, {}, wide, trace);
  const facts = await loaders.loadFacts(env, "default", [], trace);

  const canonical = toCanonical({ fields: cfg.FIELDS, boundaries: cfg.BOUNDARIES });
  const fieldsCfg = withCadenceFields(applyCanonical(cfg.FIELDS, canonical), cfg);
  const ctx = { config: { ...CONFIG, V2: cfg }, profile: "default", workdays, calendars, facts };
  const { schedules } = buildTimeline({ plugins: buildPlugins(cfg), ctx, range });
  return buildFieldTimelines(fieldsCfg, schedules, range);
}

/**
 * 门铃扫描。
 * @param opts { fromTs, toTs }  显式窗口（服务器精确触发用）；缺省 = [now-span-lag, now-lag]
 * @param opts.lagMinutes        滞后分钟数（cron 兜底用，默认取 PUSH.LAG_MINUTES）
 */
export async function handleSweep(env, loaders = sources, nowOverride = null, opts = {}) {
  const trace = [];
  const push = CONFIG.PUSH || {};
  try {
    const now = nowOverride || shanghaiNow();
    const lag = opts.lagMinutes != null ? Number(opts.lagMinutes) : Number(push.LAG_MINUTES || 0);
    const span = Number(push.SWEEP_MINUTES || 5);
    const toTs = opts.toTs || addMinutes(now, -lag);
    const fromTs = opts.fromTs || addMinutes(toTs, -span);

    const timelines = await buildSweepContext(env, loaders, toTs.slice(0, 10), trace);
    const key = env && env.BARK_KEY;
    const send = key && push.DRIVER === "bark"
      ? barkDriver({ baseUrl: push.BASE_URL, key, group: push.GROUP })
      : null;

    const res = await sweepDoorbells(push, {
      timelines, whitelist: (CONFIG.DND || {}).WHITELIST,
      fromTs, toTs, send, trace,
    });

    // 顺带把最新计划推给服务器（只在 cron 路径做；HTTP 手动触发时不打扰服务器）
    let plan = null;
    if (opts.withPlan) {
      const planCfg = { ...(push.PLAN || {}) };
      if (!planCfg.WEBHOOK_URL && env && env.PLAN_WEBHOOK) planCfg.WEBHOOK_URL = env.PLAN_WEBHOOK;
      const hours = Math.min(Number(planCfg.HOURS || 24), 48);
      const until = addMinutes(now, hours * 60);
      const doorbells = pickDoorbells(timelines, (CONFIG.DND || {}).WHITELIST, now, until);
      plan = await pushPlan(planCfg, {
        doorbells, now, until, key: env && env.GATEWAY_KEY, trace,
        // ★ 顺带告诉服务器【该盯哪些外部源】: 服务器只算内容哈希、不解析语义，
        //   哈希一变就来取新计划。这样日历地址仍然只存在 Worker 一处（Secret），
        //   服务器零配置，也绝不会出现"规则两份真相"。
        watch: watchSources(env),
      });
    }
    return json({ ok: true, window: [fromTs, toTs], lag_minutes: lag, ...res, plan, trace });
  } catch (e) {
    trace.push({ level: "warn", plugin: "sweep", ref: "failed", msg: String(e && e.message) });
    return json({ ok: false, error: String(e && e.message), trace });
  }
}

/**
 * 门铃时刻表：未来 N 小时内【没有刺客覆盖】的边界。
 * 你的服务器拉一次（比如每天或每次配置变更后），本地起秒级定时器，到点调
 * /sweep?at=<时刻>。这样精度归服务器，Bark key 仍然只存在 Worker 一处。
 */
export async function handleSweepPlan(request, env, loaders = sources) {
  const url = new URL(request.url);
  if (!authorize(request, url, env)) {
    return json({ error: "unauthorized",
      hint: "带 ?key= / X-Gateway-Key / Bearer" }, 401);
  }
  const trace = [];
  try {
    const now = url.searchParams.get("now") || shanghaiNow();
    const hours = Math.min(Number(url.searchParams.get("hours") || 24), 48);
    const toTs = addMinutes(now, hours * 60);
    const timelines = await buildSweepContext(env, loaders, now.slice(0, 10), trace);
    const due = pickDoorbells(timelines, (CONFIG.DND || {}).WHITELIST, now, toTs);
    return json({
      ok: true, now, until: toTs,
      hint: "到点调 /sweep?at=<at>（带 key）。有刺客覆盖的时刻不在此列，手机自己会醒",
      doorbells: due,
      trace,
    });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message), trace });
  }
}

// ── 鉴权（与 v1 同制）──
function constantTimeEqual(a, b) {
  const A = String(a), B = String(b);
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A.charCodeAt(i) ^ B.charCodeAt(i);
  return diff === 0;
}

export function authorize(request, url, env) {
  if (CONFIG.AUTH_DISABLED === true) return true;
  const expected = String((env && env.GATEWAY_KEY) || "").trim();
  const provided = (
    url.searchParams.get("key") ||
    request.headers.get("X-Gateway-Key") ||
    (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") ||
    ""
  ).trim();
  return expected.length > 0 && constantTimeEqual(provided, expected);
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status, headers: { "Content-Type": "application/json; charset=utf-8" },
});

// ── /v2/fact: 事实写入（POST）与调试列取（GET）（契约14: 管理操作=纠偏事实）──
const FACT_CAP = 200;                                  // 每流保留最近条数
const STREAM_RE = /^[a-z0-9_-]{1,32}$/;

/** 单条事实的校验，单发与批量共用（返回 null = 合法） */
function validateFact(ev) {
  const e = ev || {};
  if (!STREAM_RE.test(e.stream || "")) return { error: "bad_stream", hint: "小写 token [a-z0-9_-]{1,32}" };
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(e.at || "")) return { error: "bad_at", hint: "上海墙钟 YYYY-MM-DD HH:MM" };
  if (!e.id || String(e.id).length > 64) return { error: "bad_id", hint: "幂等键, ≤64 字符" };
  const t = e.type || "done";
  if (!["done", "reset", "set_next"].includes(t)) return { error: "bad_type" };
  if (t === "set_next" && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test((e.payload || {}).at || "")) {
    return { error: "bad_payload", hint: "set_next 需 payload.at 墙钟时间" };
  }
  return null;
}

export async function handleFact(request, env) {
  const url = new URL(request.url);
  if (!authorize(request, url, env)) {
    return json({ error: "unauthorized" }, 401);
  }
  const device = url.searchParams.get("device") || "default";
  const colo = (request.cf && request.cf.colo) || null;   // 延迟实验仪表: 边缘节点身份
  if (!env || !env.FACTS_KV) {
    return json({ error: "facts_storage_missing",
      hint: "wrangler.toml 加 [[kv_namespaces]] binding=\"FACTS_KV\" 并在 CF 面板建命名空间" }, 200);
  }

  if (request.method === "GET") {
    const stream = url.searchParams.get("stream") || "";
    if (!STREAM_RE.test(stream)) return json({ error: "bad_stream" }, 400);
    const raw = await env.FACTS_KV.get(`fact:${device}:${stream}`);
    return json({ device, stream, colo, events: raw ? JSON.parse(raw) : [] });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }

  // ── 批量回传（Ivan 2026-07-29）───────────────────────────────────────────
  //   下发是一次连接（SyncAll 一把梭），回传也必须是 —— 三个字段各发一次 POST
  //   就是三次往返，而锁屏后台预算只有 40–80 秒且掐尾部（CHANNELS §6.4）。
  //   形状: { events: [ {stream, at, id, type?, payload?}, ... ] }
  //   单条老形状继续收，手机端可以慢慢迁。
  if (Array.isArray(body && body.events)) {
    if (!body.events.length) return json({ error: "empty_events" }, 400);
    if (body.events.length > 50) return json({ error: "too_many_events", hint: "单批 ≤50" }, 400);
    const results = [];
    const byStream = new Map();
    for (const ev of body.events) {
      const bad = validateFact(ev);
      if (bad) { results.push({ id: (ev || {}).id ?? null, ok: false, ...bad }); continue; }
      if (!byStream.has(ev.stream)) byStream.set(ev.stream, []);
      byStream.get(ev.stream).push(ev);
    }
    // 按 stream 分组: 每个 stream 只读写一次 KV，批量的意义就在这里
    for (const [stream, evs] of byStream.entries()) {
      const k = `fact:${device}:${stream}`;
      let events = [];
      try { const raw = await env.FACTS_KV.get(k); events = raw ? JSON.parse(raw) : []; } catch { events = []; }
      const seen = new Set(events.map((e) => e.id));
      let added = 0;
      for (const ev of evs) {
        if (seen.has(ev.id)) { results.push({ id: ev.id, ok: true, deduped: true }); continue; }
        seen.add(ev.id);
        events.push({ at: ev.at, id: ev.id, type: ev.type || "done",
                      ...(ev.payload ? { payload: ev.payload } : {}),
                      received_at: shanghaiNow(), colo });
        added++;
        results.push({ id: ev.id, ok: true, deduped: false });
      }
      if (added) {
        events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
        if (events.length > FACT_CAP) events = events.slice(events.length - FACT_CAP);
        await env.FACTS_KV.put(k, JSON.stringify(events));
      }
    }
    return json({ ok: results.every((r) => r.ok), batch: true, colo, results });
  }

  // ── 单条（老形状，手机端可以慢慢迁到批量）──────────────────────────────
  const bad = validateFact(body);
  if (bad) return json(bad, 400);
  const { stream, at, id, type, payload } = body;
  const t = type || "done";
  const key = `fact:${device}:${stream}`;
  let events = [];
  try { const raw = await env.FACTS_KV.get(key); events = raw ? JSON.parse(raw) : []; } catch { events = []; }
  if (events.some((e) => e.id === id)) {
    return json({ ok: true, deduped: true, stream, count: events.length, colo });
  }
  // received_at/colo 为服务端附加观测字段（契约12 未知字段容忍; 延迟实验与漂移观测共用）
  events.push({ at, id, type: t, ...(payload ? { payload } : {}),
                received_at: shanghaiNow(), colo });
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (events.length > FACT_CAP) events = events.slice(events.length - FACT_CAP);
  await env.FACTS_KV.put(key, JSON.stringify(events));
  return json({ ok: true, deduped: false, stream, count: events.length, colo });
}

// ── /v2 处理器（loaders 可注入，测试无需网络）──
export async function handleV2(request, env, path, loaders = sources) {
  const url = new URL(request.url);
  if (!authorize(request, url, env)) {
    return json({ error: "unauthorized",
      hint: "带 ?key= / X-Gateway-Key / Bearer；或 config.user.js 设 AUTH_DISABLED:true" }, 401);
  }

  const trace = [];
  try {
    const cfg = v2Config();
    const nowWall = shanghaiNow();
    const dateRaw = url.searchParams.get("date");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw || "") ? dateRaw : nowWall.slice(0, 10);
    const nowRaw = url.searchParams.get("now");
    const hm = /^\d{1,2}:\d{2}$/.test(nowRaw || "")
      ? `${nowRaw.split(":")[0].padStart(2, "0")}:${nowRaw.split(":")[1]}`
      : nowWall.slice(11);
    const at = `${date} ${hm}`;
    const mode = (url.searchParams.get("mode") || "segment").toLowerCase() === "point"
      ? "point" : "segment";
    const device = url.searchParams.get("device") || "default";
    // 平台自报（DEVICE-ABSTRACTION §4.1）: 缺省/未知 → DEFAULT_PLATFORM + trace 提示，不报错
    const platRaw = (url.searchParams.get("platform") || "").toLowerCase().trim();
    let platform = platRaw || cfg.DEFAULT_PLATFORM;
    if (platRaw && !cfg.PLATFORMS[platRaw]) {
      trace.push({ level: "warn", plugin: "router", ref: "unknown_platform",
        msg: `未知 platform "${platRaw}"，回落 ${cfg.DEFAULT_PLATFORM}（新平台需在 V2.PLATFORMS 与 edge/resolve.js 登记）` });
      platform = cfg.DEFAULT_PLATFORM;
    }
    // 强制推平: ?apply=enforce 把所有字段的 apply 置为 enforce，
    // 手机端现成的「If ApplyMode is enforce → ShouldRun=1」直接生效，零改动。
    // 用途: 改完 bug 想把手机推到与云端一致，一次网络、一个原子动作，不碰任何本地文件。
    // 注意: 守卫仍然拦得住（契约3）—— enforce 只压"无变化跳过"，压不过守卫。
    const applyOverride = url.searchParams.get("apply") === "enforce" ? "enforce" : null;
    const debug = url.searchParams.get("debug") === "1" || path === "/timeline";
    const range = { start: addDays(date, -1), end: addDays(date, 1) };

    // I/O（契约7: 全部在采样端完成后注入）
    const span = { start: addDays(range.start, -16), end: addDays(range.end, 16) };
    const workdays = await loaders.loadWorkdays(date, trace);
    const calendars = await loaders.loadCalendars(env, {
      skipCalendar: url.searchParams.get("skipCalendar") === "1",
      testEventsRaw: url.searchParams.get("testEvents"),
    }, span, trace);
    // 要抓的事实流 = 全部已启用 cadence 任务的 stream（去重）。加任务自动带上，无需改这里。
    const factStreams = [...new Set(
      Object.entries((cfg.CADENCE || {}).TASKS || {})
        .filter(([, t]) => t.enabled !== false)
        .map(([name, t]) => t.stream || name),
    )];
    const facts = await loaders.loadFacts(env, device, factStreams, trace);

    const ctx = { config: { ...CONFIG, V2: cfg }, profile: device, workdays, calendars, facts };
    const plugins = buildPlugins(cfg);
    const { schedules, trace: ktrace } = buildTimeline({ plugins, ctx, range });
    trace.push(...ktrace);

    // 静态审计（纯诊断，KERNEL audit 纪律）
    // ── 规则翻译（加载期语义，不在热路径上做重活）ATOMIC-RULES §5.4 ──────────
    //   两种书写糖 → 规范形式 → 过渡适配成编译器现在吃的三张表。
    //   翻译失败（冲突/非法键）是【硬错】: 配置错了就该当场炸，不该带病上线。
    const canonical = toCanonical({ fields: cfg.FIELDS, boundaries: cfg.BOUNDARIES });
    const fieldsCfg = withCadenceFields(applyCanonical(cfg.FIELDS, canonical), cfg);
    auditFieldSubscriptions(fieldsCfg, schedules, trace, plugins);
    auditMorningWindow(fieldsCfg, CONFIG, trace);
    auditRuleRefs(fieldsCfg, Object.keys(schedules), trace);

    // 外部闹钟源（I/O 半场; 换算/标签/窗口在 assembleAlarms 半场完成）
    const externalItems = await loaders.loadExternalAlarms(env, CONFIG,
      [range.start, addDays(range.start, 1), range.end], trace);

    // 先组闹钟（其 trace 要赶上信封的出口渲染）
    // 闹钟来源名单由【插件自声明】导出，非硬编码（feeds:"alarms"，见 kernel/registry.js）
    const alarms = assembleAlarms({ config: CONFIG, schedules, range, at, externalItems, trace,
                                    alarmSchedules: schedulesFeeding(plugins, "alarms") });
    const locales = url.searchParams.get("locales");
    // ── 参数回显（诊断）──────────────────────────────────────────────────────
    // 把服务端【实际收到】的查询参数原样打进 trace。
    // 起因（2026-07-27 实案）: 手机端 URL 里混进不可见字符（零宽连接符等），
    //   参数名被污染成 "\u2060locales" → searchParams 取不到 → resolve.current_focus 整张表
    //   不下发 → ApplyFocus 查不到本机名候选 → 专注永远开不起来。
    // 而 mode/platform 的默认值恰好等于期望值，丢了也看不出来 —— 只有 locales 露了馅。
    // 有了这行，任何参数丢失/污染都一眼可见，不必再靠猜。
    const seen = [...url.searchParams.keys()];
    trace.push({ level: "info", plugin: "router", ref: "params",
      msg: `收到参数[${seen.length}]: ${seen.map((k) => `${k}=${url.searchParams.get(k)}`).join(" ") || "（无）"}` });
    if (seen.some((k) => /[^\x20-\x7e]/.test(k))) {
      trace.push({ level: "warn", plugin: "router", ref: "param_name_polluted",
        msg: `参数名含非 ASCII 字符（多半是 URL 里混进了不可见字符，如零宽连接符）：` +
             `${JSON.stringify(seen)} —— 请在手机端把 URL 文本删掉重新手打，不要粘贴` });
    }
    const resolve = buildResolve(platform, locales, trace);   // 先算，供 guards 展开 match[]
    if (path === "/schema") {
      // ?format=text → 人读的规则表（「07:44 到底发生了什么」的直接答案）
      if (url.searchParams.get("format") === "text") {
        const tl = buildFieldTimelines(fieldsCfg, schedules, range);
        return new Response(renderRuleTable(canonical, tl),
          { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      // 规范形式 + 两种视图的反向渲染（可逆检查）。给人看、给将来的 Pages 前端看。
      return json({
        canonical,
        // ★ 手机上需要建哪些自动化 —— 从规则自动算出来，不再靠人对着文档数
        automations: deriveAutomations(
          buildFieldTimelines(fieldsCfg, schedules, range),
          (CONFIG.DND || {}).WHITELIST, CONFIG.PUSH || {}),
        views: { by_time: toTimeMajor(canonical), by_field: toFieldMajor(canonical) },
        vocabulary: {
          shape: { level: "持续主张到下一个 level 边界；同值合并；可带 until 变有界电平",
                   pulse: "一次性事件；同值不合并；段查询看不见（= 主张时长 0）" },
          apply: { always: "收到就做（守卫仍可否决）→ 信封 enforce",
                   if_changed: "与本地 la 比，变了才做 → 信封 on_change",
                   if_differs: "与实测态比，不一致才做（手机端未实现）" },
          triggers: { "clock@HH:MM": "时间自动化（六个刺客）",
                      doorbell: "服务端推 Bark active（待第④步）",
                      alarm_stopped: "闹钟停止钩子", heartbeat: "低频地基" },
        },
        trace,
      });
    }

    const envelope = assembleState({
      resolve,
      fieldsConfig: fieldsCfg, schedules, range, at, mode, device, applyOverride,
      tolerances: { pastMinutes: cfg.POINT.PAST_TOLERANCE_MIN,
                    futureMinutes: cfg.POINT.FUTURE_TOLERANCE_MIN },
      debug, trace,
      triggerWhitelist: (CONFIG.DND || {}).WHITELIST,
    });
    envelope.alarms = alarms;
    envelope.platform = platform;
    // resolve 节: token → 本设备实际标识。
    // 守卫已由服务端展开成 guards[].match[]，故本节【只剩 ApplyFocus 执行段】还要用
    // （preset token → 本机名候选数组，喂 Set Focus 逐个试开）。CheckGuards 不再需要它。
    envelope.resolve = resolve;
    // 📊 埋点总入口: 手机端读它决定记不记、怎么记。服务端一改全跟。
    //    run_id 由服务端生成 —— 手机端拿它当本轮日志的分组键，多次运行不会串。
    envelope.telemetry = { ...(CONFIG.TELEMETRY || {}), run_id: runId(), server_at: shanghaiNow() };
    return json(envelope);
  } catch (e) {
    // 最外层兜底: 返回格式合法但安全的降级信封（宁可不动手机，契约9）
    return json({
      version: "2", generated_at: null, fields: {},
      // alarms 节形状恒定（法则1 同构），但 sweep 授权位置 false:
      //   手机端只做加法（这里 fixed/dynamic 都空，等于什么都不做），【绝不执行 sweep】。
      //   绝不能让降级信封触发 sweep —— 空清单会被读成"全都不该开" → 关光所有动态闹钟。
      alarms: { window: null, sweep: "false", fixed: [], dynamic: [] },
      error: "internal_degraded", detail: String(e && e.message || e),
      trace: trace.map((t) => typeof t === "string" ? t : `[${t.level}] ${t.plugin}/${t.ref}: ${t.msg}`),
    }, 200);
  }
}
