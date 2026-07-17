/**
 * ==============================================================================
 * 📱 device-state.js — 设备状态引擎（命名规则 · 字段订阅 · 全解耦）
 * ==============================================================================
 *
 * ── 核心模型（V11 架构定案）──────────────────────────────────────────────────
 *  1. 【规则(schedule)是独立命名产物】规则引擎(rules.js)把决策结果产出成一张
 *     命名时刻表: { "HH:MM": 值 }。目前唯一规则 = "dnd"(开关时刻表, 来自 R6)。
 *     规则不知道谁在用它, 也不依赖任何字段。SCHEDULE_NAMES 是规则名的唯一清单。
 *
 *  2. 【字段(focus/silent/…)通过 USE 订阅规则】—— 依赖是"字段→规则", 不是"字段→字段"。
 *       focus:  USE "dnd"  → 把 dnd 渲染成 focus 对象
 *       silent: USE "dnd"  → 把【同一张】dnd 渲染成 ON/OFF, 并 SKIP 掉午间
 *     silent 复用 dnd 纯属"恰好合用", 与 focus 毫无关系:
 *       · 删掉 focus 字段 → silent 照常从 dnd 渲染, 不受影响
 *       · silent 想独立 → USE 改成别的规则名, 或 USE:null 只吃自己的 OWN
 *       · 规则没人 USE → auditFieldRules 报"孤儿", 可安全删掉其产生逻辑
 *
 *  3. 【每字段可复用同规则又各自微调】三个正交旋钮:
 *       USE   订阅哪张规则 (null=不订阅, 纯 OWN)
 *       MAP   规则值 → 本字段值 的映射 (缺省恒等; 例 { ON:"静音", OFF:"响铃" })
 *       SKIP  复用规则但屏蔽这些时刻 (例 silent 不碰午间)
 *       OWN   本字段独立时刻, 叠加/覆盖规则结果 (最高优先级, 含 falsy 0/空串)
 *
 *  4. 【加字段 = 纯配置, 不改引擎】DEVICE.FIELDS 加一节(KIND: focus|scalar) +
 *     手机加 ApplyXxx。scalar 字段引擎全自动, 无需碰代码。
 *
 *  匹配双模式(手机 ?mode=): point 时点(±容差命中) / segment 时段(逐字段回看填满)。
 * ==============================================================================
 */

import { CONFIG } from "./config.js";
import { timeToMinutes, parseDateTime } from "./time-utils.js";

const KEY_RE = /^\d{1,2}:\d{2}$/;

/** 规则引擎当前产出的所有命名规则(唯一清单; 加规则在此登记 + 在 buildSchedules 产出) */
export const SCHEDULE_NAMES = ["dnd"];

/**
 * 把当日矩阵转成【命名规则时刻表】。规则 = { "HH:MM": 值 }，不含任何字段概念。
 *   dnd: 由 rules.js R6 决策出的开关时刻(仅允许 DND.WHITELIST 内的键)
 */
function buildSchedules(dayMatrix, trace, dayLabel) {
  const dnd = {};
  const put = (t, v) => {
    if (!CONFIG.DND.WHITELIST.includes(t)) {
      trace.push(`[校验🚨] ${dayLabel} 规则键 ${t} 不在白名单内，已拦截（请检查规则）`);
      return;
    }
    dnd[t] = v;
  };
  dayMatrix.dnd_on.forEach(t => put(t, "ON"));
  dayMatrix.dnd_off.forEach(t => put(t, "OFF"));
  return { dnd };
}

/** 取某字段在某时刻的"订阅规则基值"(经 SKIP/MAP 处理; 未订阅或跳过 = null) */
function subscribedBase(cfg, key, schedules) {
  const sched = cfg.USE ? schedules[cfg.USE] : null;
  if (!sched || (cfg.SKIP || []).includes(key) || !(key in sched)) return null;
  let v = sched[key];
  if (cfg.MAP && (v in cfg.MAP)) v = cfg.MAP[v];   // 规则值 → 本字段值
  return v;
}

/** focus 形态渲染: 把"基动作(ON/OFF/null) + OWN 定制"合成 focus 对象或 null */
function renderFocus(cfg, baseAction, ownVal) {
  if (ownVal == null && baseAction == null) return null;
  let own = ownVal;
  if (typeof own === "string") own = { action: own };   // 简写 "ON" → { action:"ON" }
  own = own || {};
  const action = ("action" in own) ? own.action : (baseAction ?? null);  // OWN 没写则继承规则
  const switch_to = own.switch_to ?? null;
  if (action == null && switch_to == null) return null;  // 光有守卫无动作 = 无事可做
  return {
    mode: own.mode ?? cfg.MODE_NAME,
    action, switch_to,
    only_if_current: own.only_if_current ?? null
  };
}

/** 单字段渲染: KIND 决定输出形态。scalar 引擎全自动, focus 走对象合成。 */
function renderField(cfg, key, schedules) {
  const base = subscribedBase(cfg, key, schedules);
  const ownHas = cfg.OWN && Object.prototype.hasOwnProperty.call(cfg.OWN, key);
  const ownVal = ownHas ? cfg.OWN[key] : undefined;

  if (cfg.KIND === "focus") return renderFocus(cfg, base, ownVal);
  // scalar: OWN 覆盖(含 0/空串等 falsy), 否则订阅规则基值(可能是标量或 null)
  return ownHas ? ownVal : base;
}

/**
 * 启动自检: 打印订阅关系, 报出"孤儿规则"(无人订阅→可删)与"悬空订阅"(订阅了不存在的规则)。
 * 每次请求调一次即可; 纯静态, 零副作用。
 */
export function auditFieldRules(trace) {
  const FIELDS = CONFIG.DEVICE.FIELDS || {};
  const produced = new Set(SCHEDULE_NAMES);
  const subs = {};
  for (const [name, cfg] of Object.entries(FIELDS)) {
    if (cfg.USE) (subs[cfg.USE] ||= []).push(name);
  }
  for (const use of Object.keys(subs)) {
    if (!produced.has(use)) {
      trace.push(`[规则🚨] 字段 {${subs[use].join(",")}} 订阅了不存在的规则 "${use}"（检查 FIELDS.*.USE 或 SCHEDULE_NAMES）`);
    }
  }
  for (const p of produced) {
    if (!subs[p]) trace.push(`[规则] 💤 规则 "${p}" 当前无字段订阅（孤儿，其产生逻辑可安全删除）`);
  }
  trace.push(`[规则] 🔗 订阅关系: ` +
    (SCHEDULE_NAMES.map(r => `${r}←{${(subs[r] || []).join(",") || "—"}}`).join("  ") || "（无）"));
}

/**
 * 生成某一天的设备状态时刻表（逐键逐字段独立渲染）
 * @returns { "HH:MM": { <每个FIELDS字段>, sync_alarms } }
 */
export function buildDayDeviceEntries(dayMatrix, trace, dayLabel) {
  const D = CONFIG.DEVICE;
  const FIELDS = D.FIELDS || {};
  const schedules = buildSchedules(dayMatrix, trace, dayLabel);

  // 键并集 = 各字段(订阅规则键∖SKIP ∪ 自己OWN键) ∪ 闹钟同步锚点
  const keys = new Set();
  for (const cfg of Object.values(FIELDS)) {
    const sched = cfg.USE ? schedules[cfg.USE] : null;
    if (sched) for (const k of Object.keys(sched)) if (!(cfg.SKIP || []).includes(k)) keys.add(k);
    for (const k of Object.keys(cfg.OWN || {})) keys.add(k);
  }
  for (const k of (D.SYNC_ALARMS.KEYS || [])) keys.add(k);

  const out = {};
  for (const key of keys) {
    if (!KEY_RE.test(key)) {
      trace.push(`[校验🚨] ${dayLabel} 时刻键 "${key}" 非 HH:MM 格式，已跳过`);
      continue;
    }
    const entry = { sync_alarms: (D.SYNC_ALARMS.KEYS || []).includes(key) };
    for (const [name, cfg] of Object.entries(FIELDS)) {
      entry[name] = renderField(cfg, key, schedules);
    }
    out[key] = entry;
  }
  return out;
}

/** 空状态（全字段null；字段全称契约: 所有已知字段始终存在） */
export function emptyState() {
  const s = { sync_alarms: false };
  for (const field of Object.keys(CONFIG.DEVICE.FIELDS || {})) s[field] = null;
  return s;
}

/**
 * 当前时刻匹配（双模式）
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
    const fields = Object.keys(CONFIG.DEVICE.FIELDS || {});
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
