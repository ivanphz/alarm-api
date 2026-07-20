// ─────────────────────────────────────────────────────────────────────────────
// kernel/intervals.js — 区间代数 + 双模采样器（V12 第一刀）
// ─────────────────────────────────────────────────────────────────────────────
// 契约依据: KERNEL.md §1(level 语义) §6(采样) 契约2(null=无主张)
//           契约6(重复 from=producer bug) 契约7(纯函数) 契约8(叠加/归一化)
//
// 铁律（违反任何一条即回炉）:
//   1. 零依赖。不 import 任何模块，不 import CONFIG。
//   2. 不读时钟。"now" 永远由调用方作为参数传入。
//   3. 时间平面 = "YYYY-MM-DD HH:MM" 上海墙钟。格式定宽零填充，
//      字典序 === 时间序；本模块唯一的日期算术是 addMinutes（容差窗口用）。
//   4. 错误即数据，不抛异常（契约9 的处置权在内核，不在这里）。
// ─────────────────────────────────────────────────────────────────────────────

export const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

export function isTime(s) {
  if (typeof s !== "string" || !TIME_RE.test(s)) return false;
  const mo = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  const h = Number(s.slice(11, 13)), mi = Number(s.slice(14, 16));
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59;
}

// 字典序即时间序（格式定宽零填充，见铁律3）
export function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 纯日历算术：把墙钟当 UTC 平面运算，全程不涉及任何真实时区
export function addMinutes(t, minutes) {
  const ms = Date.UTC(
    Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)),
    Number(t.slice(11, 13)), Number(t.slice(14, 16)),
  ) + minutes * 60000;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
         ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const mo = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

// 日期加减（同一 UTC 平面技巧，返回 "YYYY-MM-DD"）
export function addDays(dateStr, days) {
  const ms = Date.UTC(
    Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)),
  ) + days * 86400000;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// 星期几（0=周日 … 6=周六），纯日历事实
export function dayOfWeek(dateStr) {
  return new Date(Date.UTC(
    Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)),
  )).getUTCDay();
}

// 规范序列化：键排序的确定性 JSON。
// 对象值相等判定与未来哈希（CRC32）的统一基座（契约8，服务执行器 last_applied 比较）
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

export function valueEquals(a, b) {
  return canonical(a) === canonical(b);
}

// ── 校验 ─────────────────────────────────────────────────────────────────────
// 插件产出的形状校验。重复 from = 同 owner 区间重叠 = producer bug（契约6）。
export function validate(segments) {
  if (!Array.isArray(segments)) {
    return { ok: false, errors: [{ code: "not_array", index: -1 }] };
  }
  const errors = [];
  const seen = new Set();
  segments.forEach((seg, i) => {
    if (seg === null || typeof seg !== "object" || Array.isArray(seg)) {
      errors.push({ code: "bad_segment", index: i });
      return;
    }
    if (!isTime(seg.from)) errors.push({ code: "bad_from", index: i, from: seg.from });
    if (!("value" in seg)) errors.push({ code: "missing_value", index: i });
    if (seen.has(seg.from)) errors.push({ code: "duplicate_from", index: i, from: seg.from });
    seen.add(seg.from);
  });
  return { ok: errors.length === 0, errors };
}

// ── 归一化 ───────────────────────────────────────────────────────────────────
// 排序 + 相邻同值合并（契约8）。合并保留首段的附加键（reason 等）。
export function normalize(segments) {
  const sorted = [...segments].sort((a, b) => cmp(a.from, b.from));
  const out = [];
  for (const seg of sorted) {
    const last = out[out.length - 1];
    if (last && valueEquals(last.value, seg.value)) continue;
    out.push({ ...seg });
  }
  return out;
}

// ── segment 采样 ─────────────────────────────────────────────────────────────
// 最后一个 from ≤ at 的段（二分）。level 语义：迟到采样、漏采样天然正确。
// 首段之前 = 无主张（契约2）→ { value: null, from: null }
export function sampleSegment(segments, at) {
  let lo = 0, hi = segments.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(segments[mid].from, at) <= 0) { hit = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (hit === -1) return { value: null, from: null };
  return { value: segments[hit].value, from: segments[hit].from };
}

// ── point 采样 ───────────────────────────────────────────────────────────────
// 容差窗口 [at−past, at+future] 内的「值变化边界」。
// 返回 [{ at, value, previous }]；previous = 边界前一刻的值（首段之前视为 null）。
// 只给"只想在边沿动作"的消费者；容差默认值由采样端参数传入（KERNEL §6）。
export function samplePoint(segments, at, { pastMinutes = 3, futureMinutes = 3 } = {}) {
  const lo = addMinutes(at, -pastMinutes);
  const hi = addMinutes(at, futureMinutes);
  const hits = [];
  let previous = null;
  for (const seg of segments) {
    if (cmp(seg.from, hi) > 0) break;
    if (cmp(seg.from, lo) >= 0 && !valueEquals(seg.value, previous)) {
      hits.push({ at: seg.from, value: seg.value, previous });
    }
    previous = seg.value;
  }
  return hits;
}

// ── 裁剪 ─────────────────────────────────────────────────────────────────────
// 裁剪到 [startAt, endAt)。跨界段在 startAt 重新锚定（level 值在边界处保持），
// 这是 LOOKBACK 机制的正式替代：范围外的历史由锚定段一格承载。
export function clampToRange(segments, startAt, endAt) {
  const out = [];
  const anchor = sampleSegment(segments, startAt);
  if (anchor.from !== null && cmp(anchor.from, startAt) < 0) {
    out.push({ from: startAt, value: anchor.value });
  }
  for (const seg of segments) {
    if (cmp(seg.from, startAt) < 0) continue;
    if (cmp(seg.from, endAt) >= 0) break;
    out.push({ ...seg });
  }
  return normalize(out);
}

// ── 三层叠加 ─────────────────────────────────────────────────────────────────
// layers 按优先级从高到低（OWN → god-mode overlay → base，契约8）。
// 每层 null = 无主张 = 放行下层；全 null 则结果为 null。
export function stack(layers) {
  const boundarySet = new Set();
  for (const layer of layers) for (const seg of layer) boundarySet.add(seg.from);
  const boundaries = [...boundarySet].sort(cmp);
  const out = [];
  for (const at of boundaries) {
    let value = null;
    for (const layer of layers) {
      const v = sampleSegment(layer, at).value;
      if (v !== null) { value = v; break; }
    }
    out.push({ from: at, value });
  }
  return normalize(out);
}
