/**
 * ==============================================================================
 * 📅 ics-parser.js — 日历解析 + Date Guard 日期过滤 + 虚拟事件注入（稳定模块）
 * ==============================================================================
 *
 * 事件对象统一结构:
 *   { title, description?, startDate:"YYYY-MM-DD", endDate?, startTime?:"HH:MM", endTime? }
 *   全天事件: 有 startDate 无 startTime；ICS 规范其 DTEND 为最后一天的"次日"(exclusive)
 *
 * Date Guard: 每日矩阵只接收与当日日期重合的事件（isEventOnDate 过滤），
 *             历史 [出差] 事件永远不会污染今日闹钟。
 * ==============================================================================
 */

/** 解析 ICS 文本 → 事件数组（同时提取日期与时间，供 Date Guard 使用） */
export function parseICS(icsText) {
  const events = [];
  const unfolded = icsText.replace(/\r?\n /g, "");   // 展开 ICS 折行
  const lines = unfolded.split(/\r?\n/);
  let cur = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      cur = {};
    } else if (line.startsWith("SUMMARY:")) {
      if (cur) cur.title = line.substring(8);
    } else if (line.startsWith("DESCRIPTION:")) {
      if (cur) cur.description = line.substring(12).replace(/\\n/g, "\n");
    } else if (line.startsWith("DTSTART")) {
      if (cur) {
        const dm = line.match(/(\d{4})(\d{2})(\d{2})/);
        if (dm) cur.startDate = `${dm[1]}-${dm[2]}-${dm[3]}`;
        const tm = line.match(/T(\d{2})(\d{2})/);
        if (tm) cur.startTime = `${tm[1]}:${tm[2]}`;
      }
    } else if (line.startsWith("DTEND")) {
      if (cur) {
        const dm = line.match(/(\d{4})(\d{2})(\d{2})/);
        if (dm) cur.endDate = `${dm[1]}-${dm[2]}-${dm[3]}`;
        const tm = line.match(/T(\d{2})(\d{2})/);
        if (tm) cur.endTime = `${tm[1]}:${tm[2]}`;
      }
    } else if (line.startsWith("END:VEVENT")) {
      if (cur && cur.title) events.push(cur);
      cur = null;
    }
  }
  return events;
}

/**
 * Date Guard: 判断事件是否覆盖 dateStr 这一天
 * 全天事件 DTEND 是 exclusive(次日)，用严格大于；有时分事件 DTEND 是真实结束日，用大于等于
 */
export function isEventOnDate(event, dateStr) {
  if (!event.startDate) return false;
  if (event.startDate === dateStr) return true;
  if (event.endDate && event.startDate < dateStr) {
    return event.startTime ? event.endDate >= dateStr : event.endDate > dateStr;
  }
  return false;
}

/**
 * 🧪 虚拟事件注入（testEvents 调试接口专用）
 *
 * URL 参数格式（分号分隔多条，竖线分隔字段，时间留空 = 全天事件）:
 *   ?testEvents=[年假]|2026-01-05||;[覆盖]外勤|2026-01-06|06:10|08:00
 *
 * 字段: 标题 | 日期(YYYY-MM-DD) | 开始时间(HH:MM或空) | 结束时间(HH:MM或空)
 * 全天事件自动按 ICS 规范设 endDate = 次日（exclusive）
 */
export function parseTestEvents(raw, addDaysFn) {
  const events = [];
  if (!raw) return events;
  for (const chunk of raw.split(";")) {
    const parts = chunk.split("|").map(s => s.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    const [title, date, start, end] = parts;
    const ev = { title, startDate: date };
    if (start) {
      ev.startTime = start;
      ev.endTime = end || start;
      ev.endDate = date;
    } else {
      ev.endDate = addDaysFn(date, 1);   // 全天事件: exclusive 次日
    }
    events.push(ev);
  }
  return events;
}
