// ─────────────────────────────────────────────────────────────────────────────
// edge/sources.js — 输入源 I/O 层（V12 步骤③）
// ─────────────────────────────────────────────────────────────────────────────
// 契约7 的守门员: 一切网络与解析在此完成，插件只见纯数据。
// 本文件唯一"重活" = resolveInstances: 把 ICS 事件（含跨天/全天）解算成
// 逐日实例（ctx.calendars 形状，BLUEPRINT §② 钉死），RRULE/exclusive-DTEND
// 复杂度到此为止。workdays-core 动态 import（故障隔离 + 测试无需安装）。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays } from "../kernel/intervals.js";
import { parseICS, isEventOnDate, parseTestEvents } from "../ics-parser.js";

/** 宽容解析 URL 清单: 单条/多条(逗号分号换行空格)/JSON 数组皆可 */
export function parseUrlList(raw) {
  if (!raw) return [];
  let items = [];
  const s = String(raw).trim();
  if (s.startsWith("[")) {
    try { items = JSON.parse(s); } catch { items = []; }
  }
  if (items.length === 0) items = s.split(/[\s,;]+/);
  return items.map((u) => String(u).trim()).filter((u) => /^https?:\/\//.test(u));
}

/** ICS 事件 → 逐日实例（纯函数，可测）。span 含两端。 */
export function resolveInstances(events, spanStart, spanEnd) {
  const out = [];
  for (let d = spanStart; d <= spanEnd; d = addDays(d, 1)) {
    for (const ev of events) {
      if (!isEventOnDate(ev, d)) continue;
      out.push({
        date: d,
        title: ev.title || "",
        description: ev.description,
        start_time: ev.startTime || null,
        end_time: ev.endTime || null,
        all_day: !ev.startTime,
      });
    }
  }
  return out;
}

/** 日历: 真实 ICS + 虚拟 testEvents → 日实例 */
export async function loadCalendars(env, { skipCalendar, testEventsRaw }, span, trace) {
  const T = (level, ref, msg) => trace.push({ level, plugin: "sources", ref, msg });
  let events = [];
  const urls = parseUrlList(env && env.CALENDAR_URLS);
  if (skipCalendar) {
    T("info", "calendar_skipped", "skipCalendar=1: 跳过真实日历（纯虚拟事件测试）");
  } else if (urls.length === 0) {
    T("error", "calendar_urls_missing", "CALENDAR_URLS 未配置，日历事件功能整体失效");
  } else {
    for (const u of urls) {
      try {
        const res = await fetch(u);
        if (res.ok) {
          const parsed = parseICS(await res.text());
          events = events.concat(parsed);
          T("info", "calendar_loaded", `日历流解析 ${parsed.length} 条`);
        } else {
          T("warn", "calendar_http_error", `日历流 HTTP ${res.status}`);
        }
      } catch {
        T("warn", "calendar_fetch_failed", "日历流拉取失败，请检查 URL 及网络");
      }
    }
  }
  const testEvents = parseTestEvents(testEventsRaw, addDays);
  if (testEvents.length) {
    events = events.concat(testEvents);
    T("info", "test_events", `虚拟事件注入 ${testEvents.length} 条`);
  }
  return resolveInstances(events, span.start, span.end);
}

/** workdays 事实: workdays-core（动态 import；抛错→[]，restdays 自动落自然周末兜底） */
export async function loadWorkdays(anchorDate, trace) {
  const T = (level, ref, msg) => trace.push({ level, plugin: "sources", ref, msg });
  try {
    const { createHolidayHub } = await import("@ivanphz/workdays-core");
    const y = Number(anchorDate.slice(0, 4));
    const hub = await createHolidayHub(["CN"], [y - 1, y, y + 1]);
    (hub.loadLogs || []).forEach((l) => T("info", "workdays_core", l));
    const days = (hub.listDays("CN") || []).filter(
      (d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && typeof d.isOffDay === "boolean",
    );
    if (days.length === 0) T("warn", "workdays_empty", "节假日数据为空，降级为自然周末推演（调休判断失效）");
    return days.map((d) => ({ date: d.date, off: d.isOffDay, name: d.name || "" }));
  } catch (e) {
    T("error", "workdays_failed", `workdays-core 加载失败: ${String(e && e.message || e)}，降级自然周末`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 外部闹钟源（V12 步骤④移植）——"具体点搬运工"的 I/O 半场:
// 拉取 + 识别标签准入 + 统一成候选 { code, uid, date, time, tz, reason }。
// 时区换算/标签构造/窗口裁剪是采样期概念，归 edge/assemble 半场。
// 单源超时(默认5s)/失败/脏数据只记 trace，绝不拖垮主流程（契约9）。
// ─────────────────────────────────────────────────────────────────────────────
import { ES_MARK_DEFAULT } from "../domain/alarm-labels.js";
import { normClock } from "../lib/time.js";

export async function loadExternalAlarms(env, config, days, trace) {
  const T = (level, ref, msg) => trace.push({ level, plugin: "sources", ref, msg });
  const cfgSources = (config.EXTERNAL_ALARMS || {}).SOURCES || [];
  let envSources = [];
  if (env && env.EXTERNAL_ALARMS) {
    try {
      const p = JSON.parse(env.EXTERNAL_ALARMS);
      envSources = Array.isArray(p) ? p : (p.SOURCES || []);
      T("info", "external_env", `env.EXTERNAL_ALARMS 解析出 ${envSources.length} 个隐私源`);
    } catch (e) {
      T("error", "external_env_invalid", `env.EXTERNAL_ALARMS 非法 JSON，整体忽略: ${e.message}`);
    }
  }

  const items = [];
  for (const src of [...cfgSources, ...envSources]) {
    if (!src || src.enabled === false || !src.url) continue;
    const nm = src.name || src.url;
    const code = src.code || src.name || "src";
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), src.timeoutMs || 5000);
      let res;
      try { res = await fetch(src.url, { signal: ctrl.signal }); }
      finally { clearTimeout(to); }
      if (!res.ok) throw new Error("HTTP " + res.status);

      let added = 0, rejMark = 0, rejAllDay = 0;
      if (src.type === "ics") {
        const markRe = src.markPattern ? new RegExp(src.markPattern) : ES_MARK_DEFAULT;
        const evs = parseICS(await res.text());
        for (const d of days) {
          for (const ev of evs) {
            if (!isEventOnDate(ev, d)) continue;
            const m = markRe.exec(ev._scan || "");
            if (!m) { rejMark++; continue; }                       // 无标签不准入
            const uid = (m[1] && m[1].trim()) || ev.uid;
            let time = normClock(ev.startTime);
            if (!time) {                                           // 全天策略
              const policy = src.allDay || "default";
              if (policy === "skip") { rejAllDay++; continue; }
              if (policy === "error" && !src.time) { rejAllDay++; continue; }
              time = normClock(src.time || "09:30");
            }
            items.push({ code, uid, date: d, time: time.slice(0, 5),
                         tz: ev.startTZ || src.tz || null, reason: `${nm}:${ev.title || ""}` });
            added++;
          }
        }
      } else {                                                     // json
        const j = await res.json();
        const arr = Array.isArray(j) ? j : (j.alarms || []);
        for (const x of arr) {
          const t = normClock(x.time);
          items.push({ code, uid: x.uid, date: x.date, time: t ? t.slice(0, 5) : null,
                       tz: x.tz || src.tz || null, reason: `${nm}:${x.reason || ""}` });
          added++;
        }
      }
      const rej = [];
      if (rejMark) rej.push(`无标签${rejMark}`);
      if (rejAllDay) rej.push(`全天${rejAllDay}`);
      T("info", "external_loaded", `${nm}(${code}): 候选${added}` + (rej.length ? ` (拒:${rej.join("/")})` : ""));
    } catch (e) {
      const why = e.name === "AbortError" ? `超时>${src.timeoutMs || 5000}ms` : e.message;
      T("warn", "external_failed", `${nm} 拉取失败(${why})，已跳过不影响主流程`);
    }
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// 事实流（V12 步骤⑤）—— KV: fact:<device>:<stream>（契约11 命名空间）
// 读失败/绑定缺失 → 该流标记 degraded（插件据此输出无主张，宁可不知道不编造）。
// ─────────────────────────────────────────────────────────────────────────────
export async function loadFacts(env, device, streams, trace) {
  const T = (level, ref, msg) => trace.push({ level, plugin: "sources", ref, msg });
  const out = { streams: {}, degraded: [] };
  if (!streams || streams.length === 0) return out;
  if (!env || !env.FACTS_KV) {
    out.degraded = [...streams];
    T("warn", "facts_kv_missing", `FACTS_KV 未绑定，事实流 {${streams.join(",")}} 全部降级（wrangler.toml 加 kv_namespaces）`);
    return out;
  }
  for (const s of streams) {
    try {
      const raw = await env.FACTS_KV.get(`fact:${device}:${s}`);
      out.streams[s] = raw ? JSON.parse(raw) : [];
      T("info", "facts_loaded", `事实流 ${s}: ${out.streams[s].length} 条`);
    } catch (e) {
      out.degraded.push(s);
      T("error", "facts_load_failed", `事实流 ${s} 读取失败: ${e.message} → 降级`);
    }
  }
  return out;
}
