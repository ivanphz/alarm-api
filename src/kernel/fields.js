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
//   APPLY always | if_changed | if_differs（不进时间线，随信封下发，契约5）
//
// ── 边界级形状（2026-07-28 原子化第①步，ATOMIC-RULES §2.1.1）────────────────
//   SHAPE     缺省形状（"level" | "pulse"），字段级
//   SHAPE_AT  { "HH:MM": "pulse" | { until:"HH:MM" } } 按边界覆盖
//
//   level  电平: 值持续到下一个 level 边界；相邻同值合并；心跳/巡检看得见
//   level + until  有界电平: 窗口内持续主张，到 until 自动产一条 null（撤销主张）
//                  ← 这是漏发兜底的正解: 07:40 那一下没跑成，窗口内任何一次调用都能补
//   pulse  脉冲: 一次性事件；同值【不】合并；**只有点查询看得见，段查询看不见**
//                （= 主张时长为 0 的有界电平，ATOMIC-RULES §2.1.1）
//
// 时间线里每条边界都带 shape。采样侧据此过滤（ATOMIC-RULES §3.2.1 可见性过滤器）:
//   点查询(刺客/门铃)  看全部，pulse 恒为独立事件
//   段查询(心跳/巡检)  只看 level
//
// focus 值形态: { preset:token, action:"on"|"off"|token, switch_to, only_if_current:token }
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, addMinutes, cmp, normalize, sampleSegment } from "./intervals.js";
import { whenMatches } from "./rules.js";

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
    return { preset: cfg.PRESET ?? null, action: out, switch_to: null, only_if_current: null };
  }
  return out;
}

// 边界形状解析: SHAPE_AT[HH:MM] 优先，回落字段级 SHAPE，再回落 level
function shapeOf(cfg, from) {
  const raw = (cfg.SHAPE_AT || {})[timeOfDay(from)] ?? cfg.SHAPE ?? "level";
  if (raw === "pulse") return { shape: "pulse", until: null };
  if (typeof raw === "object" && raw) {
    return { shape: raw.shape || "level", until: raw.until ? padHM(raw.until) : null };
  }
  return { shape: raw, until: null };
}

// focus 合并: OWN 微调焊在订阅边界上 / 独立成障。返回 null 表示"此边界应被移除"。
function renderFocus(cfg, baseObj, ownVal) {
  let own = ownVal;
  if (typeof own === "string") own = { action: own };        // 简写 "on" → { action:"on" }
  own = own || {};
  const action = ("action" in own) ? own.action : (baseObj ? baseObj.action : null);
  const switch_to = own.switch_to ?? null;
  if (action == null && switch_to == null) return null;      // 光有守卫无动作 = 压制/无事可做
  const v = {
    preset: own.preset ?? (baseObj ? baseObj.preset : null) ?? cfg.PRESET ?? null,
    action,
    switch_to,
    only_if_current: own.only_if_current ?? null,
  };
  if (Array.isArray(own.guards)) v.guards = own.guards;   // OWN 直接声明 guards 数组（透传给 assemble 校验）
  return v;
}

// ── 规则路径（原子化第③步）: 值由 (触发因, 日型) 直接给，不再订阅 schedule ────
//    每天逐条求值 when；命中 0 条 = 该日该时刻无边界；命中 >1 条 = 日型矛盾，硬错。
//    god 模式日整日旁路（R1 原语义）: 该日边界全部由 god.quiet 给。
// 规则时刻求值: 字面量直接用；对象则去另一条规则的产出里取，加偏移，取不到走 fallback。
// 返回 null = 今天这条规则没有落点（既没锚点也没兜底）→ 不产边界。
function resolveAt(spec, schedules, day) {
  const at = spec.at;
  if (!at) return null;
  if (typeof at === "string") return padHM(at);
  const src = sampleSegment(schedules[at.from] || [], `${day} 00:00`).value;
  const anchor = src && src[at.pick];
  if (!anchor) return at.fallback ? padHM(at.fallback) : null;
  const off = Number(at.offset || 0);
  return off ? addMinutes(`${day} ${padHM(anchor)}`, off).slice(11, 16) : padHM(anchor);
}

function boundariesFromRules(cfg, schedules, range) {
  const boundaries = new Map();
  const dayTypes = schedules.day_type || [];
  const gods = schedules.god_mode || [];

  for (let d = addDays(range.start, -1); d <= range.end; d = addDays(d, 1)) {
    const god = sampleSegment(gods, `${d} 00:00`).value;
    if (god) {                                             // R1: 上帝模式接管该日
      for (const [hm, v] of Object.entries(god.quiet || {})) {
        boundaries.set(`${d} ${padHM(hm)}`, { spec: { value: v }, god: true });
      }
      continue;
    }
    const dt = sampleSegment(dayTypes, `${d} 00:00`).value;
    for (const [key, variants] of Object.entries(cfg.RULES_AT || {})) {
      const hit = variants.filter((v) => whenMatches(v.when, dt));
      if (!hit.length) continue;                           // 今天这一刻没有规则启用
      if (hit.length > 1) {
        throw new Error(
          `日型矛盾: ${d} ${key} 有 ${hit.length} 条规则同时命中（日型 ` +
          `${JSON.stringify(dt)}）—— when 必须互斥，否则不知道用哪条`,
        );
      }
      const spec = hit[0];
      // 键以 @ 开头 = 具名规则，时刻由 spec.at 算出；否则键本身就是时刻
      const hm = key.startsWith("@") ? resolveAt(spec, schedules, d) : padHM(key);
      if (!hm) continue;                                   // 今天算不出落点
      boundaries.set(`${d} ${hm}`, { spec, god: false });
    }
  }
  return boundaries;
}

// 规格 → 字段值（focus 升成对象，标量原样；null = 释放主张）
function valueFromSpec(cfg, spec) {
  const v = "value" in spec ? spec.value : null;
  if (v === null || v === undefined) return null;
  if (cfg.KIND !== "focus") return cfg.MAP && Object.prototype.hasOwnProperty.call(cfg.MAP, v)
    ? cfg.MAP[v] : v;
  const out = {
    preset: spec.preset ?? cfg.PRESET ?? null,
    action: v,
    switch_to: spec.switch_to ?? null,
    only_if_current: spec.guard ?? null,
  };
  if (Array.isArray(spec.guards)) out.guards = spec.guards;
  return out;
}

/** 单字段: schedule 世界 → 字段时间线（未裁剪；裁剪归 edge/assemble） */
export function buildFieldTimeline(cfg, schedules, range) {
  // ── 规则路径 ──
  if (cfg.RULES_AT) {
    const hits = boundariesFromRules(cfg, schedules, range);
    const out = [];
    for (const [from, { spec, god }] of hits.entries()) {
      const shape = god ? (cfg.SHAPE ?? "level") : (spec.shape ?? cfg.SHAPE ?? "level");
      const value = valueFromSpec(cfg, spec);
      // apply 随边界走: 一格可能有多条变体、各带各的判据，只有编译期知道今天中的是哪条
      const apply = god ? cfg.APPLY : (spec.apply ?? cfg.APPLY);
      const entry = { from, value };
      if (shape === "pulse") entry.shape = shape;
      if (apply) entry.apply = apply;
      out.push(entry);
      // until 支持相对偏移 { offset: N } —— 动态时刻场景必须用相对，否则闹钟一晚
      // 就可能把窗口挤成负的（解除 08:30、until 08:30 = 零窗口，漏发补不上）
      if (!god && shape === "level" && spec.until && value !== null) {
        const stop = typeof spec.until === "string"
          ? `${from.slice(0, 10)} ${padHM(spec.until)}`
          : addMinutes(from, Number(spec.until.offset));
        if (cmp(stop, from) > 0 && !hits.has(stop)) out.push({ from: stop, value: null });
      }
    }
    out.sort((a, b) => cmp(a.from, b.from));
    return normalize(out);
  }
  return buildFieldTimelineLegacy(cfg, schedules, range);
}

/** 订阅路径（五旋钮，第③步之后只剩 silent / media_volume / cadence.* 在用） */
function buildFieldTimelineLegacy(cfg, schedules, range) {
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
        // ⚠️ "边界存在但值为 null"（规则【显式释放主张】，如长假早晨 R6.2a/c）
        //    ≠ "没有边界"。OWN 只挂守卫/换 preset 时不得把这条释放吞掉 ——
        //    吞掉后白天仍主张"睡眠 on"，且当晚同值被归一化合并 → 夜里不再重进（契约4 失效）。
        //    要压制该边界仍照旧: 显式写 { action: null }。
        const hasBase = boundaries.has(from);
        const base = boundaries.get(from) ?? null;
        const ownDeclaresAction =
          typeof ownVal === "string" ||
          (ownVal && typeof ownVal === "object" &&
           ("action" in ownVal || ownVal.switch_to != null));
        if (hasBase && base === null && !ownDeclaresAction) continue;   // 释放主张原样保留
        const merged = renderFocus(cfg, base, ownVal);
        if (merged === null) boundaries.delete(from);        // 压制
        else boundaries.set(from, merged);
      } else {
        if (ownVal === null) boundaries.delete(from);        // 压制（v1 的 OWN:null 覆盖语义
        else boundaries.set(from, ownVal);                   //  在 v2 改为压制，见 BLUEPRINT）
      }
    }
  }

  // ③ 打形状标签 + 有界电平自动产撤销边界
  const out = [];
  for (const [from, value] of boundaries.entries()) {
    const { shape, until } = shapeOf(cfg, from);
    // level 是缺省形状 → 不打标签（省得每条都带一个恒等键，也让既有对拍逐字节不变）
    out.push(shape === "pulse" ? { from, value, shape } : { from, value });
    if (shape === "level" && until && value !== null) {
      const stop = `${from.slice(0, 10)} ${until}`;
      // until 必须在同日且晚于起点（跨午夜的窗口没有场景，留给规则表阶段）
      if (cmp(stop, from) > 0 && !boundaries.has(stop)) {
        out.push({ from: stop, value: null });                   // 窗口到期 → 撤销主张
      }
    }
  }
  out.sort((a, b) => cmp(a.from, b.from));
  // 归一化只作用于 level（同值合并是电平语义）；pulse 是独立事件，永不合并
  return normalize(out);
}

/** 全字段: { 字段名: 时间线 }。孤儿/悬空审计归 kernel/audit.js（步骤④）。 */
export function buildFieldTimelines(fieldsConfig, schedules, range) {
  const out = {};
  for (const [name, cfg] of Object.entries(fieldsConfig || {})) {
    out[name] = buildFieldTimeline(cfg, schedules, range);
  }
  return out;
}
