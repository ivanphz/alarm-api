/**
 * ==============================================================================
 * 🏫 school-break.js — 学校假期判定（寒/暑/春/秋假统一，RANGES − EXCLUDE）
 * ==============================================================================
 *
 * 日期格式自适应:
 *   "MM-DD"      (长度5)  = 每年重复，与 dateStr 的月日部分比较
 *   "YYYY-MM-DD" (长度10) = 特定年份，与完整 dateStr 比较
 *
 * 判定: 落在任一 RANGES 内 且 不落在任一 EXCLUDE 内 → 是学校假期
 *
 * 学校假期的作用（注意与 MANUAL_HOLIDAYS 的区别）:
 *   ① 工作日起床铃换组: Workday 组 → SchoolBreak 组（各铃时间见 config.FIXED_ALARMS）
 *   ② 废弃 FirstWorkday 首日并行逻辑
 *   ③ 周末上课: 按本假期的 key 到课表 periods 里找时间（没配 = 该假期不上课）
 *   它不改变"工作日"属性——大人照常上班，只是起得晚一点。
 *   MANUAL_HOLIDAYS 才是彻底放假（无任何工作闹钟）。
 * ==============================================================================
 */

import { CONFIG } from "./config.js";

/** 单条区间命中判定（自适应两种日期格式） */
function inRange(dateStr, range) {
  if (range.start.length === 5) {
    const md = dateStr.substring(5);               // 每年重复: 比较 MM-DD
    return md >= range.start && md <= range.end;
  }
  return dateStr >= range.start && dateStr <= range.end;   // 特定年份: 比较全串
}

/**
 * 是否处于学校假期
 * @returns {key: string, name: string} | null
 *   key  英文稳定标识(summer/winter/spring...)，供课表 periods 精确匹配（★不要用 name 去匹配，
 *        name 带年份/装饰会漂移；key 才是契约）。缺 key 的区间回退用 name 当 key 并在别处告警。
 *   name 人类可读假期名（供 trace 显示）
 */
export function getSchoolBreak(dateStr) {
  const hit = CONFIG.SCHOOL_BREAK.RANGES.find(r => inRange(dateStr, r));
  if (!hit) return null;
  const excluded = CONFIG.SCHOOL_BREAK.EXCLUDE.find(r => inRange(dateStr, r));
  if (excluded) return null;                       // 假期内挖洞: 这天不当假期
  return { key: hit.key || hit.name, name: hit.name };
}
