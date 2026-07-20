// ─────────────────────────────────────────────────────────────────────────────
// lib/time.js — 时钟归一化与时区换算（V12 步骤④，包形: 零依赖不 import CONFIG）
// 从 v1 index.js 逐字移植（normClock / ianaOffsetMinutes / toShanghaiWall）。
// 步骤⑦与 lib/ics 一起提包 publish（calendar-api 是第二消费者）。
// ─────────────────────────────────────────────────────────────────────────────

/** 时钟归一化: "7"→"07:00" "7:5"→"07:05"；非法/越界→null */
export function normClock(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?$/.exec(s);
  if (!m) return null;
  const h = +m[1], mi = m[2] != null ? +m[2] : 0, se = m[3] != null ? +m[3] : 0;
  if (h > 23 || mi > 59 || se > 59) return null;
  const p = (n) => String(n).padStart(2, "0");
  return m[3] != null ? `${p(h)}:${p(mi)}:${p(se)}` : `${p(h)}:${p(mi)}`;
}

/** 某 IANA 时区在给定墙上时间处的 UTC 偏移(分钟, 东为正); 失败 null */
export function ianaOffsetMinutes(tz, dateStr, timeStr) {
  try {
    const [Y, Mo, D] = dateStr.split("-").map(Number);
    const [h, mi] = timeStr.split(":").map(Number);
    const asUTC = Date.UTC(Y, Mo - 1, D, h, mi);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(asUTC));
    const g = (t) => +parts.find((p) => p.type === t).value;
    const shown = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
    return Math.round((shown - asUTC) / 60000);
  } catch { return null; }
}

/** 源时区墙上时间 → 上海(+8)墙上时间（可能跨天）；无法识别 tz → 原样 + tzWarn */
export function toShanghaiWall(dateStr, timeStr, tz) {
  const SH = 8 * 60;
  if (tz == null || tz === "" || tz === "Asia/Shanghai" ||
      tz === "+08:00" || tz === "+0800" || tz === "Asia/Hong_Kong") {
    return { date: dateStr, time: timeStr };
  }
  let off = null;
  const z = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (tz === "Z" || tz === "UTC") off = 0;
  else if (z) off = (z[1] === "-" ? -1 : 1) * (+z[2] * 60 + +z[3]);
  else off = ianaOffsetMinutes(tz, dateStr, timeStr);
  if (off == null) return { date: dateStr, time: timeStr, tzWarn: true };
  const [Y, Mo, D] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const sh = new Date(Date.UTC(Y, Mo - 1, D, h, mi) - off * 60000 + SH * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return {
    date: `${sh.getUTCFullYear()}-${p(sh.getUTCMonth() + 1)}-${p(sh.getUTCDate())}`,
    time: `${p(sh.getUTCHours())}:${p(sh.getUTCMinutes())}`,
  };
}
