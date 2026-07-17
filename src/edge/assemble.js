// ─────────────────────────────────────────────────────────────────────────────
// edge/assemble.js — /v2 信封组装（V12 步骤③）
// ─────────────────────────────────────────────────────────────────────────────
// 契约12: { version, generated_at, range, fields, trace }，双向未知字段容忍。
// 裁剪在此发生（发布给依赖方的是未裁剪产物，见 registry 注释）。
// trace 在此出口渲染成字符串（契约: 结构化存储，出口渲染，KERNEL §13）。
// reconcile_alarms: 对账调度提示（原 SYNC_ALARMS 更名，命名法 §2）——
//   point 模式 = 采样时刻命中锚点±容差；segment 模式 = 恒 true（状态重建顺带对账）。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, addMinutes, clampToRange, sampleSegment, samplePoint } from "../kernel/intervals.js";
import { buildFieldTimelines } from "../kernel/fields.js";

export function renderTrace(trace) {
  return (trace || []).map((t) =>
    typeof t === "string" ? t : `[${t.level}] ${t.plugin}/${t.ref}: ${t.msg}`);
}

export function assembleState({
  fieldsConfig, schedules, range, at,
  mode = "segment", device = "default",
  reconcileKeys = [], tolerances = {}, debug = false, trace = [],
}) {
  const clampStart = `${range.start} 00:00`;
  const clampEnd = `${addDays(range.end, 1)} 00:00`;

  const raw = buildFieldTimelines(fieldsConfig, schedules, range);
  const timelines = {};
  for (const [name, segs] of Object.entries(raw)) {
    timelines[name] = clampToRange(segs, clampStart, clampEnd);
  }

  const fields = {};
  for (const [name, segs] of Object.entries(timelines)) {
    const cfg = fieldsConfig[name] || {};
    const meta = { kind: cfg.KIND ?? "scalar", apply: cfg.APPLY ?? "on_change" };
    fields[name] = mode === "point"
      ? { ...meta, changes: samplePoint(segs, at, tolerances) }
      : { ...meta, ...sampleSegment(segs, at) };             // { value, from }
  }

  // point 便捷视图 current_state（v1 直观性回归）: 同一份 changes 的"时刻优先"投影。
  // 命中容差内值变化最近的一个时刻 → 全字段值包（无变化字段 = null = 不动, v1 同义）。
  let current_state = null;
  if (mode === "point") {
    const moments = new Map();
    for (const [name, f] of Object.entries(fields)) {
      for (const c of f.changes || []) {
        if (!moments.has(c.at)) moments.set(c.at, {});
        moments.get(c.at)[name] = c.value;
      }
    }
    if (moments.size > 0) {
      const ms = (t) => Date.UTC(+t.slice(0,4), +t.slice(5,7)-1, +t.slice(8,10), +t.slice(11,13), +t.slice(14,16));
      const best = [...moments.keys()].sort((a, b) =>
        Math.abs(ms(a) - ms(at)) - Math.abs(ms(b) - ms(at)) || (a < b ? -1 : 1))[0];
      const bundle = {};
      for (const name of Object.keys(fields)) bundle[name] = moments.get(best)[name] ?? null;
      current_state = { at: best, fields: bundle,
                        reconcile_alarms: reconcileKeys.includes(best.slice(11)) };
    }
  }

  // 对账提示
  let reconcile_alarms;
  if (mode === "point") {
    const past = tolerances.pastMinutes ?? 3;
    const future = tolerances.futureMinutes ?? 3;
    const lo = addMinutes(at, -past), hi = addMinutes(at, future);
    const day = at.slice(0, 10);
    reconcile_alarms = reconcileKeys.some((hm) => {
      const t = `${day} ${hm}`;
      return t >= lo && t <= hi;
    });
  } else {
    reconcile_alarms = true;                                 // 状态重建默认顺带对账（沿袭 V11）
  }

  return {
    version: "2",
    generated_at: at,
    device,
    mode,
    range,
    fields,
    ...(mode === "point" ? { current_state } : {}),
    reconcile_alarms,
    trace: renderTrace(trace),
    ...(debug ? { schedules, field_timelines: timelines } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 闹钟组装（V12 步骤④）——"闹钟即状态"的采样半场:
//   期望集合来自 wake_alarms ∪ weekend_class（日粒度 level），外部候选在此完成
//   时区换算 → 标签构造 → 24h 窗口裁剪 → 幂等去重。窗口是采样期权限边界。
// v2 窗口 = (at, at+24h]（分钟平面: 排除当前分钟 ≈ v1 的 +15s 死区滤波）。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays as _addDays, addMinutes as _addMinutes } from "../kernel/intervals.js";
import { sampleSegment as _sampleSegment } from "../kernel/intervals.js";
import { buildToggleRegistry, esLabel } from "../domain/alarm-labels.js";
import { toShanghaiWall } from "../lib/time.js";

export const ALARM_SCHEDULES = ["wake_alarms", "weekend_class", "ai_quota_reminder"];

export function assembleAlarms({ config, schedules, range, at, externalItems = [],
                                 alarmSchedules = ALARM_SCHEDULES, trace = [] }) {
  const T = (level, ref, msg) => trace.push({ level, plugin: "alarms", ref, msg });
  const winStart = _addMinutes(at, 1);
  const winEnd = _addMinutes(at, 24 * 60);
  const inWindow = (t) => t >= winStart && t <= winEnd;

  // 逐日期望集合（wake_alarms ∪ weekend_class；god 日已由插件内联接管）
  const days = [];
  for (let d = range.start; d <= range.end; d = _addDays(d, 1)) days.push(d);
  const dayValue = (name, d) => _sampleSegment(schedules[name] || [], `${d} 00:00`).value;

  // ① 可开关闹钟: 注册表全量 on/off（label 预设时间落窗才 on）
  const registry = buildToggleRegistry(config);
  const labelTime = new Map(registry.map((a) => [a.label, a.scheduled_at]));
  const activeInWindow = new Set();
  for (const d of days) {
    for (const name of alarmSchedules) {
      const v = dayValue(name, d);
      for (const label of (v && v.fixed) || []) {
        const t = labelTime.get(label);
        if (t && inWindow(`${d} ${t}`)) activeInWindow.add(label);
        else if (!t) T("warn", "unknown_fixed_label",
          `${name} 产出未知固定标签 "${label}"（不在注册表，可能是 god JSON 拼写或缺预建）`);
      }
    }
  }
  const fixed = registry.map((a) => ({
    label: a.label,
    action: activeInWindow.has(a.label) ? "on" : "off",
    scheduled_at: a.scheduled_at,
    kind: a.kind,
  }));

  // ② 动态期望集合: 内部(日值展开) + 外部(换算→标签→窗口) ，label 幂等去重
  const dynamic = [];
  const seen = new Set();
  for (const d of days) {
    for (const name of alarmSchedules) {
      const v = dayValue(name, d);
      for (const a of (v && v.dynamic) || []) {
        const atAbs = `${d} ${a.time}`;
        if (!inWindow(atAbs) || seen.has(a.label)) continue;
        seen.add(a.label);
        dynamic.push({ label: a.label, at: atAbs, reason: a.reason });
      }
    }
  }
  let rejUid = 0, rejFmt = 0, rejWin = 0, tzWarn = 0;
  for (const it of externalItems) {
    if (!it.date || !it.time || !/^\d{4}-\d{2}-\d{2}$/.test(it.date) || !/^\d{2}:\d{2}$/.test(it.time)) { rejFmt++; continue; }
    const w = toShanghaiWall(it.date, it.time, it.tz);
    if (w.tzWarn) tzWarn++;
    const label = esLabel(it.code, it.uid, w.time);
    if (!label) { rejUid++; continue; }
    const atAbs = `${w.date} ${w.time}`;
    if (!inWindow(atAbs)) { rejWin++; continue; }
    if (seen.has(label)) continue;
    seen.add(label);
    dynamic.push({ label, at: atAbs, reason: it.reason });
  }
  if (rejUid || rejFmt || rejWin || tzWarn) {
    T("info", "external_filtered",
      `外部候选过滤: 无uid${rejUid} 格式${rejFmt} 窗口外${rejWin} 时区未识别${tzWarn}`);
  }
  dynamic.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return { window: { start: winStart, end: winEnd }, fixed, dynamic };
}
