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
import { buildResolve } from "./resolve.js";
import * as sources from "./sources.js";
import restdays from "../plugins/restdays.js";
import presence from "../plugins/presence.js";
import quiet from "../plugins/quiet.js";
import schoolBreak from "../plugins/school-break.js";
import godMode from "../plugins/god-mode.js";
import wakeAlarms from "../plugins/wake-alarms.js";
import weekendClass from "../plugins/weekend-class.js";
import { makeCadencePlugins } from "../plugins/cadence.js";
import { assembleAlarms } from "./assemble.js";
import { auditFieldSubscriptions, auditQuietWhitelist } from "../kernel/audit.js";
import { schedulesFeeding } from "../kernel/registry.js";

// 核心插件（静态注册）。cadence 任务插件由 CADENCE.TASKS 配置【生成】，见 buildPlugins。
export const CORE_PLUGINS = [restdays, presence, quiet, schoolBreak, godMode, wakeAlarms, weekendClass];

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
    const fieldsCfg = withCadenceFields(cfg.FIELDS, cfg);
    auditFieldSubscriptions(fieldsCfg, schedules, trace, plugins);
    auditQuietWhitelist(schedules.quiet, (CONFIG.DND || {}).WHITELIST, trace);

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
    const resolve = buildResolve(platform, locales);     // 先算，供 guards 展开 match[]
    const envelope = assembleState({
      resolve,
      fieldsConfig: fieldsCfg, schedules, range, at, mode, device, applyOverride,
      tolerances: { pastMinutes: cfg.POINT.PAST_TOLERANCE_MIN,
                    futureMinutes: cfg.POINT.FUTURE_TOLERANCE_MIN },
      debug, trace,
    });
    envelope.alarms = alarms;
    envelope.platform = platform;
    // resolve 节: token → 本设备实际标识。
    // 守卫已由服务端展开成 guards[].match[]，故本节【只剩 ApplyFocus 执行段】还要用
    // （preset token → 本机名候选数组，喂 Set Focus 逐个试开）。CheckGuards 不再需要它。
    envelope.resolve = resolve;
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
