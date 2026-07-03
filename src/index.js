/**
 * ==============================================================================
 * 🚀 index.js — Smart Schedule Gateway 主入口 (V9.1 多文件版·含鉴权)
 * ==============================================================================
 *
 * ── 鉴权（所有请求，含调试接口）────────────────────────────────────────────
 *
 *   默认: 每个请求 URL 必须带 ?key=你的密钥，否则一律 401 拒绝。
 *         密钥存 GATEWAY_KEY（Secret 或明文 vars 皆可，见 config.js 顶部说明）。
 *   临时关闭: 设 AUTH_DISABLED=true 即可裸奔(输网址就行)，联调用。
 *   Fail-closed 兜底: 没显式关闭、GATEWAY_KEY 又空/未配 → 401 锁死，绝不静默裸奔。
 *   浏览器调试(鉴权开着时)把 &key=... 一起拼上，例:
 *     YOUR_URL?key=abc123&testDate=2026-01-03&testTime=14:30
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
 *   dynamicAlarms 未来24h窗口内【期望存在并开启】的事件闹钟 [{label, time, reason}]
 *                 label = Gate-Dynamic-Event-HHMM（时间编入名字，作为幂等身份）
 *                 → 搬运工做【对账】而非重建（无抖动、绝不删除）:
 *                   ①取得所有闹钟，名字含 Gate-Dynamic-Event 的:
 *                      在本清单里→保持/开启; 不在本清单里→关闭(静默)
 *                   ②本清单里、手机上还没有的同名闹钟→新建(开启)
 *                   过期/取消的以"关闭僵尸"留存不响，由手动「大扫除」定期清理。
 *   dnd_schedule  【今天这一天】的 DND 计划 {"HH:MM": "ON"/"OFF"}，键限于 DND.WHITELIST
 *                 → 每个键位一条「特定时间」自动化(刺客): 到点抓本 JSON、读自己那个键，
 *                   有键执行 ON/OFF，无键装死。DND 是到点即时执行，只需今天、不做前瞻，
 *                   故不套用闹钟那个 24h 窗口（否则刺客触发那刻今天的键会被窗口挤掉）。
 * ==============================================================================
 */

import { CONFIG } from "./config.js";
import {
  getShanghaiDateString, addDaysToDateString, parseDateTime, formatShanghai
} from "./time-utils.js";
import { parseICS, isEventOnDate, parseTestEvents } from "./ics-parser.js";
import { makeRestDayChecker } from "./rest-days.js";
import { generateDayMatrix } from "./rules.js";

/** 常量时间字符串比较（长度不同直接 false，长度相同则逐位异或累加，不提前返回） */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  /**
   * @param env Cloudflare 运行时注入的环境变量/Secret 容器
   *            env.CALENDAR_URLS = 家庭日历订阅链接（Secret，逗号或换行分隔多条）
   *            配置方法见 config.js 顶部"数据源"一节的说明
   */
  /**
   * @param env Cloudflare 运行时注入的环境变量/Secret 容器
   *            env.GATEWAY_KEY    = 访问密钥（鉴权用，Secret 或明文 vars 皆可）
   *            env.AUTH_DISABLED  = "true" 则关闭鉴权（联调用，可选）
   *            env.CALENDAR_URLS  = 家庭日历订阅链接（逗号或换行分隔多条）
   *            配置方法见 config.js 顶部"数据源/鉴权"两节的说明
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── 0. 鉴权（一切处理之前）─────────────────────────────────────────────
    // 两种放行方式，从上到下:
    //   ① 显式关闭鉴权: Secret/vars 里设 AUTH_DISABLED = "true"（必须字面量 true）
    //      → 直接放行，输网址即可。这是个"需要主动打开"的明确动作。
    //   ② 正常鉴权(默认): 请求带 ?key=<密钥> 且与 GATEWAY_KEY 完全一致才放行。
    // Fail-closed 兜底: 若既没显式关闭、GATEWAY_KEY 又空/未配 → 一律 401 锁死。
    //   —— 误删 GATEWAY_KEY 只会锁死(安全方向)，绝不会因配置丢失而静默裸奔。
    // 常量时间比较，避免逐字符提前返回的（极微弱）计时侧信道。
    const authDisabled = String((env && env.AUTH_DISABLED) || "") === "true";
    if (!authDisabled) {
      const expectedKey = (env && env.GATEWAY_KEY) || "";
      const providedKey = url.searchParams.get("key") || "";
      const keyOk = expectedKey.length > 0 && constantTimeEqual(providedKey, expectedKey);
      if (!keyOk) {
        return new Response(
          JSON.stringify({
            error: "unauthorized",
            hint: "请求需带正确的 ?key= 参数；若想临时关闭鉴权，设 AUTH_DISABLED=true；若刚部署，先配置 GATEWAY_KEY"
          }, null, 2),
          { status: 401, headers: { "Content-Type": "application/json; charset=utf-8" } }
        );
      }
    }

    const trace = ["=== ⚡️ 网关全链路审计日志 (V9.1 多文件规则引擎版) ==="];

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

    // 闹钟部分: 仍用三日矩阵 + 24h 前瞻窗口（闹钟要提前把明天的开好）
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
    }

    // 可开关闹钟全量 ON/OFF 指令（固定7个 + 上课，顺序: 固定在前 上课在后）
    const fixedOut = toggleRegistry.map(a => ({
      label: a.label,
      action: activeFixedInWindow.has(a.label) ? "ON" : "OFF",
      scheduledAt: a.scheduledAt,
      kind: a.kind
    }));

    // ── DND 稀疏字典 ────────────────────────────────────────────────────────
    // ⚠️ DND 是"到点即时执行": 每个刺客在【自己那个时间点当天】触发时抓 JSON 读键。
    //    所以 DND 只取 baseDate(今天) 这一天的决策，绝不能套用给闹钟用的 24h 前瞻窗口
    //    —— 否则刺客触发那刻，今天的键刚好被 now+15s 的窗口左边界挤掉，读成明天的键，
    //    造成日期错位（如周五晚 22:25 读不到、晚间 DND 消失）。
    //    今天全天的键都输出（含已过去的），各刺客只读自己那个键，互不干扰。
    const todayMatrix = matrices[1];   // matrices = [昨天, 今天, 明天]
    const dndOut = {};
    const applyDnd = (time, type) => {
      if (!CONFIG.DND.WHITELIST.includes(time)) {
        trace.push(`[校验🚨] DND 键 ${time} 不在白名单内，已拦截（无刺客接收，请检查规则）`);
        return;
      }
      dndOut[time] = type;
    };
    todayMatrix.dnd_on.forEach(t => applyDnd(t, "ON"));
    todayMatrix.dnd_off.forEach(t => applyDnd(t, "OFF"));

    // ── 6. 人类可读调试面板 ─────────────────────────────────────────────────
    let panel = `====================================\n`;
    panel += `⏰ Smart Schedule Gateway (V9.1)\n`;
    panel += `====================================\n`;
    panel += `[环境快照]: ${formatShanghai(virtualNow)}\n`;
    panel += `[窗口起点]: ${formatShanghai(windowStart)}\n`;
    panel += `[窗口终点]: ${formatShanghai(windowEnd)}\n\n`;

    panel += `📳 可开关闹钟指令 (按label找手机预建闹钟, 按action开/关, 静默无弹窗):\n`;
    fixedOut.forEach(a => {
      const tag = a.kind === "class" ? "📚课" : "  固";
      panel += `  ${a.action === "ON" ? "🟢" : "⚫"} [${a.action.padEnd(3)}] ${tag} [${a.scheduledAt}] ${a.label}\n`;
    });

    panel += `\n⚡ 动态事件闹钟·期望态 (搬运工对账: 名字含Gate-Dynamic-Event的,在此清单→开,不在→关;缺的→建):\n`;
    if (dynamicOut.length === 0) {
      panel += `  -> ∅ (本窗口无动态事件闹钟, 手机上现有的应全部关闭)\n`;
    } else {
      dynamicOut.forEach(a => panel += `  🔔 [${a.time}] ${a.label} ← ${a.reason}\n`);
    }

    panel += `\n🔕 DND 今日计划 (刺客到点读自己那个键; 只反映今天, 无键=装死不动):\n`;
    const dndKeys = Object.keys(dndOut);
    if (dndKeys.length === 0) {
      panel += `  -> ∅ (今日无任何DND指令, 全天手工掌控)\n`;
    } else {
      dndKeys.sort().forEach(k => panel += `  -> [${k}] ${dndOut[k]}\n`);
    }

    panel += `\n🔍 DEEPLOG 审计追踪 (方括号内为规则编号, 对应 rules.js):\n` + trace.join("\n");

    // ── 7. 最终响应 ─────────────────────────────────────────────────────────
    return new Response(JSON.stringify({
      meta: {
        version: "V9.1-RuleEngine-Auth",
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
