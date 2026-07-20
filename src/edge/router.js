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
import { addDays } from "../kernel/intervals.js";
import { buildTimeline } from "../kernel/registry.js";
import { assembleState } from "./assemble.js";
import { buildFocusNameMaps } from "./i18n.js";
import * as sources from "./sources.js";
import restdays from "../plugins/restdays.js";
import presence from "../plugins/presence.js";
import quiet from "../plugins/quiet.js";
import schoolBreak from "../plugins/school-break.js";
import godMode from "../plugins/god-mode.js";
import wakeAlarms from "../plugins/wake-alarms.js";
import weekendClass from "../plugins/weekend-class.js";
import aiQuota from "../plugins/ai-quota.js";
import aiQuotaReminder from "../plugins/ai-quota-reminder.js";
import { assembleAlarms } from "./assemble.js";
import { auditFieldSubscriptions, auditQuietWhitelist } from "../kernel/audit.js";

export const PLUGINS = [restdays, presence, quiet, schoolBreak, godMode, wakeAlarms, weekendClass, aiQuota, aiQuotaReminder];

// v2 缺省配置（config.user.js 里加 V2:{...} 深合并覆盖；键名不属于 API，沿用大写风格）
export const V2_DEFAULTS = {
  DEFAULT: false,                       // true = 根路径默认走 v2（迁移完成后手动翻转）
  FIELDS: {
    focus:  { KIND: "focus",  USE: "quiet", PRESET: "do_not_disturb", APPLY: "on_change",
              // 继承 v1 用户配置: 早间解除仅当此刻确为勿扰（不误杀手动开的睡眠等，契约3）
              OWN: { "07:40": { only_if_current: "do_not_disturb" } } },
    silent: { KIND: "scalar", USE: "quiet", SKIP: ["12:15", "13:29"], APPLY: "on_change", OWN: {} },
    media_volume: {
      KIND: "scalar", USE: "quiet", APPLY: "on_change",
      MAP: { on: 0, off: null },   // 该安静→归零(每次进入重申); 解除→无主张(白天音量归人管)
      OWN: {},                     // 单位: 整数 0–100（契约§5）。契约15: 订阅声明取代抄数字
    },
    "cadence.ai_claude": { KIND: "scalar", USE: "ai_quota", APPLY: "on_change", OWN: {} },
  },
  RECONCILE_ALARMS: ["07:40", "13:29", "22:25"],
  POINT: { PAST_TOLERANCE_MIN: 3, FUTURE_TOLERANCE_MIN: 3 },
  // 步骤⑤: AI 冷却试点（cadence 特例）。默认关，config.user.js 里 V2.AI_QUOTA.ENABLED 开。
  AI_QUOTA: {
    ENABLED: false,
    STREAM: "ai_claude",
    COOLDOWN_MINUTES: 300,                 // 5 小时滚动冷却
    WEEKLY_RESET: { day: 1, time: "08:00" },  // 周一 08:00 额度回满（day: 0=周日…6=周六）
    REMINDER: true,                        // 恢复时刻建 GateDyn-CAD 提醒闹钟
  },
};

export function v2Config() {
  const user = CONFIG.V2 || {};
  return {
    ...V2_DEFAULTS, ...user,
    FIELDS: user.FIELDS || V2_DEFAULTS.FIELDS,
    POINT: { ...V2_DEFAULTS.POINT, ...(user.POINT || {}) },
    AI_QUOTA: { ...V2_DEFAULTS.AI_QUOTA, ...(user.AI_QUOTA || {}) },
  };
}

// ── 上海钟（中国无夏令时，UTC+8 固定平面）──
export function shanghaiNow() {
  const d = new Date(Date.now() + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
         ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
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
  const { stream, at, id, type, payload } = body || {};
  if (!STREAM_RE.test(stream || "")) return json({ error: "bad_stream", hint: "小写 token [a-z0-9_-]{1,32}" }, 400);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at || "")) return json({ error: "bad_at", hint: "上海墙钟 YYYY-MM-DD HH:MM" }, 400);
  if (!id || String(id).length > 64) return json({ error: "bad_id", hint: "幂等键, ≤64 字符" }, 400);
  const t = type || "done";
  if (!["done", "reset", "set_next"].includes(t)) return json({ error: "bad_type" }, 400);
  if (t === "set_next" && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test((payload || {}).at || "")) {
    return json({ error: "bad_payload", hint: "set_next 需 payload.at 墙钟时间" }, 400);
  }

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
    const debug = url.searchParams.get("debug") === "1" || path === "/timeline";
    const range = { start: addDays(date, -1), end: addDays(date, 1) };

    // I/O（契约7: 全部在采样端完成后注入）
    const span = { start: addDays(range.start, -16), end: addDays(range.end, 16) };
    const workdays = await loaders.loadWorkdays(date, trace);
    const calendars = await loaders.loadCalendars(env, {
      skipCalendar: url.searchParams.get("skipCalendar") === "1",
      testEventsRaw: url.searchParams.get("testEvents"),
    }, span, trace);
    const factStreams = cfg.AI_QUOTA.ENABLED ? [cfg.AI_QUOTA.STREAM] : [];
    const facts = await loaders.loadFacts(env, device, factStreams, trace);

    const ctx = { config: { ...CONFIG, V2: cfg }, profile: device, workdays, calendars, facts };
    const { schedules, trace: ktrace } = buildTimeline({ plugins: PLUGINS, ctx, range });
    trace.push(...ktrace);

    // 静态审计（纯诊断，KERNEL audit 纪律）
    auditFieldSubscriptions(cfg.FIELDS, schedules, trace);
    auditQuietWhitelist(schedules.quiet, (CONFIG.DND || {}).WHITELIST, trace);

    // 外部闹钟源（I/O 半场; 换算/标签/窗口在 assembleAlarms 半场完成）
    const externalItems = await loaders.loadExternalAlarms(env, CONFIG,
      [range.start, addDays(range.start, 1), range.end], trace);

    // 先组闹钟（其 trace 要赶上信封的出口渲染）
    const alarms = assembleAlarms({ config: CONFIG, schedules, range, at, externalItems, trace });
    const focusMaps = buildFocusNameMaps(url.searchParams.get("locales"));
    const envelope = assembleState({
      fieldsConfig: cfg.FIELDS, schedules, range, at, mode, device,
      reconcileKeys: cfg.RECONCILE_ALARMS,
      tolerances: { pastMinutes: cfg.POINT.PAST_TOLERANCE_MIN,
                    futureMinutes: cfg.POINT.FUTURE_TOLERANCE_MIN },
      debug, trace,
    });
    envelope.alarms = alarms;
    if (focusMaps) envelope.i18n = {
      focus_name_to_token: focusMaps.name_to_token,   // 守卫: 本机名→token
      focus_token_to_name: focusMaps.token_to_name,   // 执行: token→本机名(喂 Set Focus)
    };
    return json(envelope);
  } catch (e) {
    // 最外层兜底: 返回格式合法但安全的降级信封（宁可不动手机，契约9）
    return json({
      version: "2", generated_at: null, fields: {},
      alarms: { window: null, fixed: [], dynamic: [] }, reconcile_alarms: false,
      error: "internal_degraded", detail: String(e && e.message || e),
      trace: trace.map((t) => typeof t === "string" ? t : `[${t.level}] ${t.plugin}/${t.ref}: ${t.msg}`),
    }, 200);
  }
}
