/**
 * ==============================================================================
 * 📱 device-state.js — 设备状态引擎（字段独立 · 双模式匹配 · 接口预留）
 * ==============================================================================
 *
 * ── 核心原则（架构定案，勿违背）────────────────────────────────────────────
 *  1. 【每个字段是独立个体】谁也不是谁的依附。每个字段有:
 *       · 自己的规则(如 silent 的 FOLLOW_FOCUS 是它自己"选择"的规则，可随时关掉)
 *       · 自己的独立时刻表 OWN(任意时间独立动作，与其它字段无关)
 *  2. 【最终时刻表 = 所有字段时刻的并集】每个时刻逐字段独立求值，无值=null。
 *  3. 【双模式匹配】
 *       point   时点: 命中"离查询时间最近且在容差内"的键，返回该键状态。
 *               容差前后独立可调(POINT.PAST/FUTURE_TOLERANCE_MIN)。
 *       segment 时段: 每个字段独立回看"最近一次非null取值"(可跨昨天)，
 *               把区间用前一个状态填满 → 手机重启/手动跑一次即恢复当前应有状态。
 *               回溯窗口/向前吸附可调(SEGMENT.LOOKBACK_HOURS/FUTURE_SNAP_MIN)。
 *  4. 【加新字段】= FIELD_REGISTRY 加一行 + config.DEVICE 加一节 + 手机端加一个
 *     ApplyXxx 子件。输出契约(全称字段/null跳过/未知透传)不变。
 * ==============================================================================
 */

import { CONFIG } from "./config.js";
import { timeToMinutes, parseDateTime } from "./time-utils.js";

const KEY_RE = /^\d{1,2}:\d{2}$/;

/**
 * 🧩 字段注册表 —— 每个字段的独立求值规则。新增状态字段在此加一行。
 * evaluate(key, ctx) → 值 或 null(该时刻此字段不动)
 * ctx = { focusAction: 该时刻规则引擎的focus动作("ON"/"OFF"/null) }
 */
const FIELD_REGISTRY = {
  silent: (key, ctx) => {
    const c = CONFIG.DEVICE.SILENT;
    if (c.OWN && key in c.OWN) return c.OWN[key];               // 自己的独立时刻优先
    if (c.FOLLOW_FOCUS && ctx.focusAction && !(c.SKIP_KEYS || []).includes(key)) {
      return ctx.focusAction;                                   // 跟随规则(silent自己选的)
    }
    return null;
  },
  media_volume: (key /*, ctx */) => {
    const c = CONFIG.DEVICE.MEDIA_VOLUME;
    if (c.OWN && key in c.OWN) return c.OWN[key];               // 自己的独立时刻优先
    if ((c.ZERO_KEYS || []).includes(key)) return c.ZERO_VALUE; // 归零规则(不区分放假)
    return null;
  }
  // 未来: low_power: (key) => { ... }  ← 加一行即接入
};

/** focus 字段求值（独立于其它字段；OWN 优先于规则） */
function evalFocus(key, focusAction) {
  const fc = CONFIG.DEVICE.FOCUS;
  const own = (fc.OWN || {})[key];
  if (own) {
    return {
      mode: own.mode ?? fc.MODE_NAME, action: own.action ?? null,
      switch_to: own.switch_to ?? null, only_if_current: own.only_if_current ?? null
    };
  }
  if (focusAction) {
    return {
      mode: fc.MODE_NAME, action: focusAction,
      switch_to: null, only_if_current: (fc.GUARD || {})[key] || null
    };
  }
  return null;
}

/**
 * 生成某一天的设备状态时刻表（逐键逐字段独立求值）
 * @param dayMatrix 规则引擎产出的当日矩阵(用其 dnd_on/dnd_off 作为 focus 规则时刻)
 * @returns { "HH:MM": {focus, silent, media_volume, sync_alarms, ...透传字段} }
 */
export function buildDayDeviceEntries(dayMatrix, trace, dayLabel) {
  const D = CONFIG.DEVICE;

  // 1) focus 规则时刻（来自规则引擎，白名单校验只针对规则键）
  const focusAt = {};
  dayMatrix.dnd_on.forEach(t => { focusAt[t] = "ON"; });
  dayMatrix.dnd_off.forEach(t => { focusAt[t] = "OFF"; });
  for (const t of Object.keys(focusAt)) {
    if (!CONFIG.DND.WHITELIST.includes(t)) {
      trace.push(`[校验🚨] ${dayLabel} 规则键 ${t} 不在白名单内，已拦截（请检查规则）`);
      delete focusAt[t];
    }
  }

  // 2) 键并集 = focus规则键 ∪ 各字段OWN ∪ 同步锚点 ∪ 跨字段CUSTOM_ACTIONS
  const keys = new Set(Object.keys(focusAt));
  for (const k of Object.keys(D.FOCUS.OWN || {})) keys.add(k);
  for (const k of Object.keys(D.SILENT.OWN || {})) keys.add(k);
  for (const k of Object.keys(D.MEDIA_VOLUME.OWN || {})) keys.add(k);
  for (const k of (D.SYNC_ALARMS.KEYS || [])) keys.add(k);
  for (const k of Object.keys(D.CUSTOM_ACTIONS || {})) keys.add(k);

  // 3) 逐键逐字段独立求值
  const out = {};
  for (const key of keys) {
    if (!KEY_RE.test(key)) {
      trace.push(`[校验🚨] ${dayLabel} 时刻键 "${key}" 非 HH:MM 格式，已跳过`);
      continue;
    }
    const ctx = { focusAction: focusAt[key] || null };
    const entry = {
      focus: evalFocus(key, ctx.focusAction),
      sync_alarms: (D.SYNC_ALARMS.KEYS || []).includes(key)
    };
    for (const [field, evaluate] of Object.entries(FIELD_REGISTRY)) {
      entry[field] = evaluate(key, ctx);
    }
    // 4) CUSTOM_ACTIONS 跨字段覆盖层(最高优先级; 未知字段原样透传给手机)
    const spec = (D.CUSTOM_ACTIONS || {})[key];
    if (spec) {
      for (const [field, val] of Object.entries(spec)) {
        if (field === "focus" && val && typeof val === "object") {
          entry.focus = {
            mode: val.mode ?? null, action: val.action ?? null,
            switch_to: val.switch_to ?? null, only_if_current: val.only_if_current ?? null
          };
        } else {
          entry[field] = val;
        }
      }
    }
    out[key] = entry;
  }
  return out;
}

/** 空状态（全字段null；字段全称契约: 所有已知字段始终存在） */
export function emptyState() {
  const s = { focus: null, sync_alarms: false };
  for (const field of Object.keys(FIELD_REGISTRY)) s[field] = null;
  return s;
}

/**
 * 当前时刻匹配（双模式）
 * @param mode "point" | "segment"
 * @param deviceToday / deviceYesterday  今/昨两天的时刻表
 * @returns current_state 对象（全称字段，state 永远是完整对象）
 */
export function matchState({ mode, rawNow, nowSource, baseDate, yesterdayDate,
                             deviceToday, deviceYesterday, trace }) {
  const nm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(rawNow).trim());
  const base = {
    matched: false, error: null, now: rawNow, now_source: nowSource, mode,
    matched_key: null, diff_minutes: null, field_sources: null, state: emptyState()
  };
  if (!nm) {
    base.error = "bad_now_format";
    base.hint = "now 需为 HH:MM 或 HH:MM:SS";
    trace.push(`[now🚨] now="${rawNow}" 格式非法，state全null`);
    return base;
  }
  const nowMin = parseInt(nm[1], 10) * 60 + parseInt(nm[2], 10);

  if (mode === "segment") {
    // ── 时段模式: 每字段独立回看"最近一次非null"，区间用前一状态填满(可跨昨天) ──
    const seg = CONFIG.DEVICE.SEGMENT;
    const nowTs = parseDateTime(baseDate, `${nm[1].padStart(2, "0")}:${nm[2]}`).getTime();
    const horizon = nowTs + (seg.FUTURE_SNAP_MIN || 0) * 60000;       // 向前吸附
    const floor = nowTs - (seg.LOOKBACK_HOURS || 26) * 3600000;      // 回溯窗口
    const timeline = [];
    for (const [d, entries] of [[yesterdayDate, deviceYesterday], [baseDate, deviceToday]]) {
      for (const [key, entry] of Object.entries(entries || {})) {
        const ts = parseDateTime(d, key).getTime();
        if (ts >= floor && ts <= horizon) timeline.push({ ts, d, key, entry });
      }
    }
    timeline.sort((a, b) => a.ts - b.ts);
    const state = emptyState();
    const sources = {};
    const fields = ["focus", ...Object.keys(FIELD_REGISTRY)];
    for (const field of fields) {
      sources[field] = null;
      for (let i = timeline.length - 1; i >= 0; i--) {              // 从最近往回找
        const v = timeline[i].entry[field];
        if (v !== null && v !== undefined) {
          state[field] = v;
          sources[field] = `${timeline[i].d} ${timeline[i].key}`;
          break;
        }
      }
    }
    state.sync_alarms = seg.SYNC_ALARMS !== false;                   // 状态重建默认顺带对账闹钟
    const any = fields.some(f => state[f] !== null);
    base.matched = any;
    base.error = any ? null : "no_state_in_lookback";
    base.field_sources = sources;
    base.state = state;
    trace.push(`[now] 🧭 segment: now=${rawNow}(${nowSource}) 逐字段回看 → ` +
      fields.map(f => `${f}:${sources[f] || "—"}`).join(" "));
    return base;
  }

  // ── 时点模式: 离 now 最近且在前后容差内的键 ─────────────────────────────
  const pt = CONFIG.DEVICE.POINT;
  let best = null, bestDiff = Infinity;
  for (const key of Object.keys(deviceToday)) {
    const d = timeToMinutes(key) - nowMin;                           // >0=键在未来, <0=键已过去
    const ok = d >= 0 ? d <= (pt.FUTURE_TOLERANCE_MIN ?? 3)
                      : -d <= (pt.PAST_TOLERANCE_MIN ?? 3);
    if (ok && Math.abs(d) < bestDiff) { best = key; bestDiff = Math.abs(d); }
  }
  if (best) {
    base.matched = true;
    base.matched_key = best;
    base.diff_minutes = bestDiff;
    base.state = deviceToday[best];
    trace.push(`[now] ✅ point: now=${rawNow}(${nowSource}) 命中 ${best}(相差${bestDiff}分)`);
  } else {
    base.error = "no_slot_in_tolerance";
    base.hint = `当前时间不在任何时刻键容差内(过去${pt.PAST_TOLERANCE_MIN}分/未来${pt.FUTURE_TOLERANCE_MIN}分)，state全null`;
    trace.push(`[now] ⚪ point: now=${rawNow}(${nowSource}) 无键在容差内 → state全null`);
  }
  return base;
}
