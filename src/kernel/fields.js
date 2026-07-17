// ─────────────────────────────────────────────────────────────────────────────
// kernel/fields.js — 字段订阅五旋钮渲染器（V12 步骤③）
// ─────────────────────────────────────────────────────────────────────────────
// 把命名 schedule 渲染成【字段时间线】（KERNEL §5）。字段消费零依赖（契约1）:
// 每个字段产出一条自足的阶跃函数，采样与 schedule 世界再无瓜葛。
//
// 五旋钮（V11 语义移植到区间世界，差异点见 BLUEPRINT §③）:
//   KIND  focus | scalar（输出形态）
//   USE   订阅哪张 schedule（null = 纯 OWN）
//   MAP   规则值→字段值映射（缺省恒等；输出必须仍是 token/数值，命名法约束）
//   SKIP  ["HH:MM"...] 屏蔽这些"每日时刻"的订阅边界（边界移除 → 前值延续）
//   OWN   { "HH:MM": 值 } 每日独立主张，最高层（含 falsy 0/空串）:
//           焊在订阅边界同刻 → 合并微调（focus 挂守卫/换模式，动作缺省继承规则）
//           独立时刻          → 独立主张（focus 无动作无 switch_to = 无事可做，不产边界）
//           显式 null / {action:null} → 压制该边界（该点闭嘴，前值延续）
//   APPLY on_change | enforce（不进时间线，随信封下发，契约5）
//
// focus 值形态: { mode:token, action:"on"|"off"|token, switch_to, only_if_current:token }
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, cmp, normalize } from "./intervals.js";

const timeOfDay = (from) => from.slice(11);
const padHM = (hm) => {
  const [h, m] = String(hm).split(":");
  return `${String(h).padStart(2, "0")}:${String(m ?? "00").padStart(2, "0")}`;
};

// 订阅基值映射: null 原样传递（无主张会传染）; MAP 命中换值; focus 把 on/off 升成对象
function mapBase(cfg, v) {
  if (v === null || v === undefined) return null;
  let out = v;
  if (cfg.MAP && Object.prototype.hasOwnProperty.call(cfg.MAP, v)) out = cfg.MAP[v];
  if (cfg.KIND === "focus" && (out === "on" || out === "off")) {
    return { mode: cfg.MODE ?? null, action: out, switch_to: null, only_if_current: null };
  }
  return out;
}

// focus 合并: OWN 微调焊在订阅边界上 / 独立成障。返回 null 表示"此边界应被移除"。
function renderFocus(cfg, baseObj, ownVal) {
  let own = ownVal;
  if (typeof own === "string") own = { action: own };        // 简写 "on" → { action:"on" }
  own = own || {};
  const action = ("action" in own) ? own.action : (baseObj ? baseObj.action : null);
  const switch_to = own.switch_to ?? null;
  if (action == null && switch_to == null) return null;      // 光有守卫无动作 = 压制/无事可做
  return {
    mode: own.mode ?? (baseObj ? baseObj.mode : null) ?? cfg.MODE ?? null,
    action,
    switch_to,
    only_if_current: own.only_if_current ?? null,
  };
}

/** 单字段: schedule 世界 → 字段时间线（未裁剪；裁剪归 edge/assemble） */
export function buildFieldTimeline(cfg, schedules, range) {
  const boundaries = new Map();                              // from → value

  // ① 订阅层: 经 SKIP / MAP
  const base = cfg.USE ? (schedules[cfg.USE] || []) : [];
  const skip = new Set((cfg.SKIP || []).map(padHM));
  for (const seg of base) {
    if (skip.has(timeOfDay(seg.from))) continue;             // 边界移除 → 前值延续
    boundaries.set(seg.from, mapBase(cfg, seg.value));
  }

  // ② OWN 层: 每日展开（含前一天，供跨午夜迟到采样承接昨日主张）
  const own = cfg.OWN || {};
  for (let d = addDays(range.start, -1); d <= range.end; d = addDays(d, 1)) {
    for (const [hm, ownVal] of Object.entries(own)) {
      const from = `${d} ${padHM(hm)}`;
      if (cfg.KIND === "focus") {
        const merged = renderFocus(cfg, boundaries.get(from) ?? null, ownVal);
        if (merged === null) boundaries.delete(from);        // 压制
        else boundaries.set(from, merged);
      } else {
        if (ownVal === null) boundaries.delete(from);        // 压制（v1 的 OWN:null 覆盖语义
        else boundaries.set(from, ownVal);                   //  在 v2 改为压制，见 BLUEPRINT）
      }
    }
  }

  const segments = [...boundaries.entries()]
    .map(([from, value]) => ({ from, value }))
    .sort((a, b) => cmp(a.from, b.from));
  return normalize(segments);
}

/** 全字段: { 字段名: 时间线 }。孤儿/悬空审计归 kernel/audit.js（步骤④）。 */
export function buildFieldTimelines(fieldsConfig, schedules, range) {
  const out = {};
  for (const [name, cfg] of Object.entries(fieldsConfig || {})) {
    out[name] = buildFieldTimeline(cfg, schedules, range);
  }
  return out;
}
