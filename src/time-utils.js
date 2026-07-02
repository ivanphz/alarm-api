/**
 * ==============================================================================
 * 🕐 time-utils.js — 工业级时间工具集（稳定模块，基本不需要改动）
 * ==============================================================================
 *
 * 核心原则: 【UTC 正午锚点】
 *   所有日期字符串运算一律用 `${dateStr}T12:00:00Z` 构造 Date 对象，
 *   使时间点落在目标日的正中央，任何时区偏移(±12h内)都不会跨日翻转，
 *   彻底免疫 Cloudflare 机房时区漂移。永远不要直接 new Date(dateStr)。
 * ==============================================================================
 */

import { CONFIG } from "./config.js";

/** "HH:MM" → 当日分钟数（用于碰撞区间比较） */
export function timeToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(":")) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/** 取上海时区的今天日期字符串 "YYYY-MM-DD"（offsetDays 可偏移） */
export function getShanghaiDateString(offsetDays = 0) {
  const targetTime = Date.now() + offsetDays * 864e5;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.SYSTEM.TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(targetTime);
}

/** 日期字符串加减天数（UTC 正午锚点，跨月跨年安全） */
export function addDaysToDateString(dateStr, offsetDays) {
  const ms = new Date(dateStr + "T12:00:00Z").getTime();
  return new Date(ms + offsetDays * 864e5).toISOString().split("T")[0];
}

/** 星期数字 0=周日 … 6=周六（UTC 正午锚点，免疫时区） */
export function getSafeDayOfWeek(dateStr) {
  return new Date(dateStr + "T12:00:00Z").getUTCDay();
}

/** 日期 + "HH:MM" → 北京时间绝对时间戳的 Date 对象 */
export function parseDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00+08:00`);
}

/** 时间戳 → 上海时区人类可读字符串（用于面板展示） */
export function formatShanghai(timestamp) {
  return new Date(timestamp).toLocaleString("zh-CN", { timeZone: CONFIG.SYSTEM.TIMEZONE });
}
