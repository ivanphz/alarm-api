/**
 * ==============================================================================
 * 🚀 index.js — Smart Schedule Gateway 主入口 (V9.0 多文件版)
 * ==============================================================================
 *
 * ── 调试接口（URL 查询参数，可任意组合）─────────────────────────────────────
 *
 *   ?testDate=2026-01-03                    仿真日期（从当日凌晨零点起算）
 *   ?testDate=2026-01-03&testTime=14:30     仿真到具体分钟
 *   ?testEvents=<虚拟事件>                   注入虚拟日历事件（不用真改日历）
 *   ?skipCalendar=1                          跳过真实日历网络拉取（配合 testEvents 提速）
 *
 *   testEvents 格式: 标题|日期|开始时间|结束时间  分号分隔多条，时间留空=全天
 *   示例（浏览器会自动做 URL 编码，直接粘中文即可）:
 *     ?testDate=2026-01-05&testEvents=[年假]|2026-01-05||
 *     ?testDate=2026-01-06&testEvents=[覆盖]外勤|2026-01-06|06:10|08:00;[请假]|2026-01-06|13:00|17:30
 *     ?testDate=2026-01-05&skipCalendar=1&testEvents=[出差]|2026-01-05|09:00|18:00
 *
 * ── 输出契约（iPhone 快捷指令 / 安卓 Tasker 共用同一份 JSON）───────────────
 *
 *   fixedAlarms   全部"可开关闹钟"【全量】列出（7个固定 + 预建上课闹钟），
 *                 每条 {label, action:"ON"/"OFF", scheduledAt, kind:"fixed"/"class"}
 *                 → 搬运工遍历: 按 label 找到手机上预建的闹钟，按 action 开/关（静默）
 *   dynamicAlarms 未来24h窗口内要新建的【事件】闹钟 [{label, time, reason}]
 *                 label 恒为 Gate-Dynamic-Event（不加日期/编号，靠关闭+重建管理）
 *                 → 搬运工: 先查找所有 Gate-Dynamic-Event 全部【关闭】(静默,不删除)，
 *                   再按本数组逐条新建（系统默认样式, 开启）。
 *                   过期闹钟以"关闭僵尸"留存不响，由手动「大扫除」指令定期清理。
 *   dnd_schedule  稀疏字典 {"HH:MM": "ON"/"OFF"}，键严格限于 DND.WHITELIST
 *                 → 每个键位一条「特定时间」自动化: 到点查键，有键执行，无键装死
 * ==============================================================================
 */

import { CONFIG } from "./config.js";
import {
  getShanghaiDateString, addDaysToDateString, parseDateTime, formatShanghai
} from "./time-utils.js";
import { parseICS, isEventOnDate, parseTestEvents } from "./ics-parser.js";
import { makeRestDayChecker } from "./rest-days.js";
import { generateDayMatrix } from "./rules.js";

export default {
  /**
   * @param env Cloudflare 运行时注入的环境变量/Secret 容器
   *            env.CALENDAR_URLS = 家庭日历订阅链接（Secret，逗号或换行分隔多条）
   *            配置方法见 config.js 顶部"数据源"一节的说明
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const trace = ["=== ⚡️ 网关全链路审计日志 (V9.0 多文件规则引擎版) ==="];

    // ── 1. 时间环境（生产 or 仿真沙盒）──────────────────────────────────────
    const testDate = url.searchParams.get("testDate");
    const testTime = url.searchParams.get("testTime");
    const baseDate = testDate || getShanghaiDateString(0);
    let virtualNow = Date.now();

    if (testDate && testTime) {
      const t = testTime.length === 5 ? `${testTime}:00` : testTime;
      virtualNow = new Date(`${testDate}T${t}+08:00`).getTime();
      trace.push(`[环境] 🛠️ 仿真沙盒: 锚定 ${testDate} ${testTime}`);
    } else if (testDate) {
      virtualNow = new Date(`${testDate}T00:00:00+08:00`).getTime();
      trace.push(`[环境] 🛠️ 全天排查: 锚定 ${testDate} 凌晨零点`);
    } else {
      trace.push(`[环境] 🟢 生产模式: 高精物理时钟`);
    }

    const yesterday = addDaysToDateString(baseDate, -1);
    const tomorrow  = addDaysToDateString(baseDate, 1);

    // ── 2. 节假日数据（跨年智能寻址 + 多镜像降级）───────────────────────────
    let holidayData = [];
    const years = [...new Set([baseDate.substring(0, 4), tomorrow.substring(0, 4)])];
    for (const year of years) {
      for (const apiUrl of CONFIG.API.HOLIDAY_URLS) {
        try {
          const res = await fetch(`${apiUrl}/${year}.json`);
          if (res.ok) {
            const data = await res.json();
            holidayData = holidayData.concat(data.days || []);
            trace.push(`[网络] 🌐 节假日数据: ${year}.json ✓`);
            break;
          }
        } catch (e) { /* 换下一个镜像 */ }
      }
    }
    if (holidayData.length === 0) {
      trace.push(`[网络⚠️] 节假日 API 全部失败，降级为自然周末推演（调休判断将失效！）`);
    }

    // ── 3. 日历事件（真实 ICS + 虚拟 testEvents 合并）──────────────────────
    // 🔐 日历链接从 Worker Secret 读取（不进代码仓库），逗号/换行分隔多条
    const calendarUrls = String((env && env.CALENDAR_URLS) || "")
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(s => s.startsWith("http"));

    let allEvents = [];
    if (url.searchParams.get("skipCalendar") === "1") {
      trace.push(`[日历] ⏭️ skipCalendar=1: 跳过真实日历拉取（纯虚拟事件测试模式）`);
    } else if (calendarUrls.length === 0) {
      trace.push(`[日历🚨] Secret CALENDAR_URLS 未配置或为空！日历事件功能整体失效。` +
        `请执行 npx wrangler secret put CALENDAR_URLS 配置（详见 config.js 顶部说明）`);
    } else {
      trace.push(`[日历] 🔐 从 Secret 读取到 ${calendarUrls.length} 条订阅链接`);
      for (const calUrl of calendarUrls) {
        try {
          const res = await fetch(calUrl);
          if (res.ok) {
            const parsed = parseICS(await res.text());
            allEvents = allEvents.concat(parsed);
            trace.push(`[网络] 📅 日历流解析: ${parsed.length} 条 ✓`);
          }
        } catch (e) {
          trace.push(`[网络⚠️] 日历流拉取失败，请检查 URL 及网络`);
        }
      }
    }
    const testEvents = parseTestEvents(url.searchParams.get("testEvents"), addDaysToDateString);
    if (testEvents.length > 0) {
      allEvents = allEvents.concat(testEvents);
      testEvents.forEach(ev => trace.push(
        `[日历] 🧪 虚拟事件注入: "${ev.title}" ${ev.startDate} ${ev.startTime ? ev.startTime + "-" + ev.endTime : "(全天)"}`
      ));
    }
    trace.push(`[日历] 📋 事件总库 ${allEvents.length} 条，Date Guard 按日过滤后分发`);

    // ── 4. 三日矩阵推演 ─────────────────────────────────────────────────────
    const rc = makeRestDayChecker(holidayData, allEvents);
    const eventsFor = (d) => allEvents.filter(ev => isEventOnDate(ev, d));

    const matrices = [yesterday, baseDate, tomorrow].map(
      d => generateDayMatrix(d, eventsFor(d), rc, trace)
    );

    // ── 5. 绝对时间轴展开 + 24h 死区窗口裁剪 ────────────────────────────────
    const windowStart = virtualNow + CONFIG.SYSTEM.WINDOW_START_DELAY_SECONDS * 1000;
    const windowEnd   = virtualNow + 864e5 + CONFIG.SYSTEM.WINDOW_END_BUFFER_SECONDS * 1000;
    const inWindow = (ts) => ts >= windowStart && ts <= windowEnd;

    // 统一"可开关注册表" = 7个固定闹钟 + 预建上课闹钟（都靠 label 开关，需要时间做窗口裁剪）
    const toggleRegistry = [
      ...CONFIG.FIXED_ALARMS.map(a => ({ label: a.label, scheduledAt: a.scheduledAt, kind: "fixed" })),
      ...CONFIG.WEEKEND_CLASS.SCHEDULE.map(s => ({ label: s.label, scheduledAt: s.time, kind: "class" }))
    ];
    const labelTime = new Map(toggleRegistry.map(a => [a.label, a.scheduledAt]));

    const activeFixedInWindow = new Set();
    const dynamicOut = [];
    const seenDynamic = new Set();
    const dndPoints = [];

    for (const m of matrices) {
      // 可开关闹钟: label 的预设时间落在窗口内 → ON
      for (const label of m.activeLabels) {
        const t = labelTime.get(label);
        if (t && inWindow(parseDateTime(m.dateStr, t).getTime())) {
          activeFixedInWindow.add(label);
        }
      }
      // 动态闹钟(仅事件): 窗口内的条目输出（label+time 去重）
      for (const a of m.dynamicAlarms) {
        if (inWindow(parseDateTime(m.dateStr, a.time).getTime())) {
          const key = `${a.label}-${a.time}`;
          if (!seenDynamic.has(key)) {
            seenDynamic.add(key);
            dynamicOut.push(a);
          }
        }
      }
      // DND 时间点
      m.dnd_on.forEach(t => dndPoints.push({ type: "ON", time: t, ts: parseDateTime(m.dateStr, t).getTime() }));
      m.dnd_off.forEach(t => dndPoints.push({ type: "OFF", time: t, ts: parseDateTime(m.dateStr, t).getTime() }));
    }

    // 可开关闹钟全量 ON/OFF 指令（固定7个 + 上课，顺序: 固定在前 上课在后）
    const fixedOut = toggleRegistry.map(a => ({
      label: a.label,
      action: activeFixedInWindow.has(a.label) ? "ON" : "OFF",
      scheduledAt: a.scheduledAt,
      kind: a.kind
    }));

    // DND 稀疏字典（窗口裁剪 + 白名单校验拦截）
    const dndOut = {};
    dndPoints
      .filter(p => inWindow(p.ts))
      .sort((a, b) => a.ts - b.ts)
      .forEach(p => {
        if (!CONFIG.DND.WHITELIST.includes(p.time)) {
          trace.push(`[校验🚨] DND 键 ${p.time} 不在白名单内，已拦截（无刺客接收，输出无意义，请检查规则）`);
          return;
        }
        dndOut[p.time] = p.type;
      });

    // ── 6. 人类可读调试面板 ─────────────────────────────────────────────────
    let panel = `====================================\n`;
    panel += `⏰ Smart Schedule Gateway (V9.0)\n`;
    panel += `====================================\n`;
    panel += `[环境快照]: ${formatShanghai(virtualNow)}\n`;
    panel += `[窗口起点]: ${formatShanghai(windowStart)}\n`;
    panel += `[窗口终点]: ${formatShanghai(windowEnd)}\n\n`;

    panel += `📳 可开关闹钟指令 (按label找手机预建闹钟, 按action开/关, 静默无弹窗):\n`;
    fixedOut.forEach(a => {
      const tag = a.kind === "class" ? "📚课" : "  固";
      panel += `  ${a.action === "ON" ? "🟢" : "⚫"} [${a.action.padEnd(3)}] ${tag} [${a.scheduledAt}] ${a.label}\n`;
    });

    panel += `\n⚡ 动态事件闹钟 (搬运工: 先"关闭"所有 Gate-Dynamic-Event 再按此新建; 绝不删除):\n`;
    if (dynamicOut.length === 0) {
      panel += `  -> ∅ (本窗口无动态事件闹钟)\n`;
    } else {
      dynamicOut.forEach(a => panel += `  🔔 [${a.time}] ${a.label} ← ${a.reason}\n`);
    }

    panel += `\n🔕 DND 盲切指令 (稀疏输出, 无键=刺客装死不动):\n`;
    const dndKeys = Object.keys(dndOut);
    if (dndKeys.length === 0) {
      panel += `  -> ∅ (未来24H无任何DND指令, 全天手工掌控)\n`;
    } else {
      dndKeys.forEach(k => panel += `  -> [${k}] ${dndOut[k]}\n`);
    }

    panel += `\n🔍 DEEPLOG 审计追踪 (方括号内为规则编号, 对应 rules.js):\n` + trace.join("\n");

    // ── 7. 最终响应 ─────────────────────────────────────────────────────────
    return new Response(JSON.stringify({
      meta: {
        version: "V9.0-RuleEngine",
        currentTime: formatShanghai(Date.now()),
        windowLeftBound: formatShanghai(windowStart),
        windowRightBound: formatShanghai(windowEnd)
      },
      fixedAlarms: fixedOut,
      dynamicAlarms: dynamicOut,
      dnd_schedule: dndOut,
      humanReadable: panel
    }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
