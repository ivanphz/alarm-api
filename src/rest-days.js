/**
 * ==============================================================================
 * 🛌 rest-days.js — 休息日统一判定引擎（法定假日 + 日历休假 + 手动假日 三源合一）
 * ==============================================================================
 *
 * 两个核心概念（务必区分）:
 *
 *   isOfficialWorkday(date)   法定意义上要不要上班
 *     判定顺序: MANUAL_HOLIDAYS → 节假日API(含调休补班) → 自然周末推演
 *     用途: 底色闹钟注入（当天该不该有工作闹钟）、调休补班的周六照常响铃
 *
 *   isEffectiveRestDay(date)  这个人实际在不在休息
 *     = 法定休息日 OR 当天有【全天】LEAVE 类日历事件（半天假不算整休息日）
 *     用途: 休息块长度计数、FirstWorkday 首日判定、明晚 DND 时间选择
 *
 * 休息块 getBlockLength(date): 以 date 为起点【向前+向后】双向扫描
 *   连续 isEffectiveRestDay 的天数（各限14天，覆盖春节国庆超长假）。
 *   例: 假期为周四~周六，站在周六向前扫到周四 → 块长 3 ✓
 *   例: 周五全天年假+周六+周日 → 块长 3 → 触发长假规则+周六跳课 ✓
 *   例: 周五下午半天假+双休 → 半天不计入 → 块长 2 → 普通周末 ✓
 * ==============================================================================
 */

import { CONFIG } from "./config.js";
import { getSafeDayOfWeek, addDaysToDateString } from "./time-utils.js";
import { isEventOnDate } from "./ics-parser.js";

/** 判断事件标题是否命中某关键字组（关键字需带 [方括号] 出现在标题中） */
export function matchKeywordGroup(title, group) {
  return CONFIG.KEYWORDS[group].some(kw => (title || "").includes(`[${kw}]`));
}

/**
 * 构造休息日判定器（一次构造，三日矩阵共享）
 * @param holidayData 节假日 API 的 days 数组 [{date, isOffDay, name}]
 * @param allEvents   全量日历事件（含虚拟事件）
 */
export function makeRestDayChecker(holidayData, allEvents) {

  // 全天 LEAVE 事件预索引（只索引全天的；半天假不改变"整休息日"属性）
  const fullDayLeaveEvents = allEvents.filter(
    ev => !ev.startTime && matchKeywordGroup(ev.title, "LEAVE")
  );

  const holidayMap = new Map(holidayData.map(d => [d.date, d]));

  /** 法定意义上是否工作日 */
  function isOfficialWorkday(dateStr) {
    if (CONFIG.MANUAL_HOLIDAYS.includes(dateStr)) return false;
    const d = holidayMap.get(dateStr);
    if (d) return !d.isOffDay;                       // API 数据优先（含调休补班周末=工作日）
    const dow = getSafeDayOfWeek(dateStr);
    return dow !== 0 && dow !== 6;                   // 无数据时按自然周末兜底
  }

  /** 是否命名法定假日（非普通周六/周日的官方假期，或手动假日） */
  function isNamedHoliday(dateStr) {
    if (CONFIG.MANUAL_HOLIDAYS.includes(dateStr)) return true;
    const d = holidayMap.get(dateStr);
    return !!(d && d.isOffDay && d.name && !["周六", "周日"].includes(d.name));
  }

  /** 实际是否休息日（法定休息 或 全天请假） */
  function isEffectiveRestDay(dateStr) {
    if (!isOfficialWorkday(dateStr)) return true;
    return fullDayLeaveEvents.some(ev => isEventOnDate(ev, dateStr));
  }

  /** 包含 dateStr 的连续休息块总天数（0 = 当天不是休息日） */
  function getBlockLength(dateStr) {
    if (!isEffectiveRestDay(dateStr)) return 0;
    let len = 1;
    let d = addDaysToDateString(dateStr, -1);        // 向前扫描
    for (let i = 0; i < 14 && isEffectiveRestDay(d); i++) {
      len++;
      d = addDaysToDateString(d, -1);
    }
    d = addDaysToDateString(dateStr, 1);             // 向后扫描
    for (let i = 0; i < 14 && isEffectiveRestDay(d); i++) {
      len++;
      d = addDaysToDateString(d, 1);
    }
    return len;
  }

  return { isOfficialWorkday, isNamedHoliday, isEffectiveRestDay, getBlockLength };
}
