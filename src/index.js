// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  🔌 鉴权总开关·缺省值（config.user.js 里若设了 AUTH_DISABLED 则以它为准）    ║
// ║     false = 正常鉴权，请求 URL 必须带 ?key=你的密钥                          ║
// ║     true  = 关闭鉴权裸奔，输网址就能访问（联调图方便时用）                    ║
// ║  日常切换建议直接改 config.user.js 里的 AUTH_DISABLED；这里是兜底缺省。       ║
// ║  改完 git push，Actions 自动部署即生效。                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const AUTH_DISABLED_DEFAULT = false;

/**
 * ==============================================================================
 * 🚀 index.js — Smart Schedule Gateway 主入口 (V11 · 全解耦版)
 * ==============================================================================
 *
 * ── 鉴权（所有请求，含调试接口）────────────────────────────────────────────
 *
 *   默认: 每个请求 URL 必须带 ?key=你的密钥，否则一律 401 拒绝。
 *         密钥存 GATEWAY_KEY（Secret 或明文 vars 皆可，见 config.default.js 顶部说明）。
 *   临时关闭: config.user.js 里设 AUTH_DISABLED: true 即可裸奔(输网址就行)，联调用。
 *   Fail-closed 兜底: 未裸奔、GATEWAY_KEY 又空/未配 → 401 锁死，绝不静默裸奔。
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
 *   device_schedule 【今天这一天】的设备状态计划，键限于 DND.WHITELIST:
 *                 { "HH:MM": { focus:{mode,action,switch_to,only_if_current}, silent, media_volume } }
 *                 → 每个键位一条「特定时间」自动化(刺客): 到点抓本 JSON、读自己那个键，
 *                   逐字段处理: focus控勿扰/(未来)睡眠工作 · silent控静音 · media_volume控音量。
 *                   字段为 null = 该项不动(装死)。只需今天、不做前瞻。
 *                   focus.only_if_current: 期望的手机当前focus，刺客【本地现查】比对后决定执行。
 *                   🔑 刺客只处理它认识的字段、跳过不认识/null 的 → 网关与刺客可独立升级。
 * ==============================================================================
 */

import { CONFIG } from "./config.js";
import { createHolidayHub } from "@ivanphz/workdays-core";
import {
  getShanghaiDateString, getShanghaiClockString, addDaysToDateString, parseDateTime, formatShanghai, timeToMinutes
} from "./time-utils.js";
import { parseICS, isEventOnDate, parseTestEvents } from "./ics-parser.js";
import { makeRestDayChecker } from "./rest-days.js";
import { generateDayMatrix } from "./rules.js";
import { buildDayDeviceEntries, matchState, emptyState, auditFieldRules } from "./device-state.js";

/** 常量时间字符串比较（长度不同直接 false，长度相同则逐位异或累加，不提前返回） */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 时钟归一化。容忍手输，统一成 matchState 认得的 "HH:MM"（或带秒 "HH:MM:SS"）。
 *   "7"        → "07:00"   (只给小时，分钟补 :00)
 *   "7:5"      → "07:05"   (补零)
 *   "07:40"    → "07:40"
 *   "7:40:30"  → "07:40:30"
 *   非法/越界  → null      (交由调用方降级实时)
 */
function normClock(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?$/.exec(s);
  if (!m) return null;
  const h = +m[1], mi = m[2] != null ? +m[2] : 0, se = m[3] != null ? +m[3] : 0;
  if (h > 23 || mi > 59 || se > 59) return null;
  const p = n => String(n).padStart(2, "0");
  return m[3] != null ? `${p(h)}:${p(mi)}:${p(se)}` : `${p(h)}:${p(mi)}`;
}

/**
 * 外部源闹钟标签: Gate-ES-<源代号>-<uid>-<HHMM>。
 *   前缀自成一族(区别于内部动态闹钟 Gate-Dynamic-Event-), 短、可读、可溯源。
 *   ⚠️ 手机端 SyncAlarms 对账须同时认 Gate-Dynamic-Event* 与 Gate-ES* 两个前缀。
 *   身份 = uid + 时间: 手机端只按【名称】比对且无"改现有闹钟时间"的动作, 故把时间编进
 *     label —— 同 uid 改时间 → label 变 → 旧的(不在清单)被关、新时间重建, 时间才会真正更新。
 *     (若 label 不含时间, 改时间会因"同名已存在"只被 Turn On、时间永不更新, 这是必须避免的坑。)
 *   净化: 仅留 [A-Za-z0-9_.-]; code 截 16、uid 截 40; uid 空则判无效(拒收)。
 * @param {string} hhmm 已归一化的 "HH:MM"; 内部转 "HHMM" 拼接
 */
function esLabel(code, uid, hhmm) {
  const clean = s => String(s == null ? "" : s).trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  const c = clean(code).slice(0, 16) || "src";
  const u = clean(uid).slice(0, 40);
  if (!u) return null;
  const hm = /^(\d{2}):(\d{2})$/.test(hhmm || "") ? hhmm.replace(":", "") : "";
  return hm ? `Gate-ES-${c}-${u}-${hm}` : null;   // 无合法时间 → 无效(时间是身份的一部分)
}

/** 求某 IANA 时区在给定墙上时间处的 UTC 偏移(分钟, 东为正); 失败返回 null */
function ianaOffsetMinutes(tz, dateStr, timeStr) {
  try {
    const [Y, Mo, D] = dateStr.split("-").map(Number);
    const [h, mi] = timeStr.split(":").map(Number);
    const asUTC = Date.UTC(Y, Mo - 1, D, h, mi);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(new Date(asUTC));
    const g = t => +parts.find(p => p.type === t).value;
    const shown = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
    return Math.round((shown - asUTC) / 60000);
  } catch { return null; }
}

/**
 * 把"源时区的墙上时间"换算成"上海(+8)墙上时间"(手机闹钟按墙上时间响)。
 *   tz 缺省/Asia/Shanghai/+08:00 → 原样返回(绝大多数乙方都是 +8)。
 *   "Z"/"UTC" 或 ±HH:MM 固定偏移 → 精确换算; IANA 名 → Intl 求偏移。
 *   换算可能跨天 → date 会随之变化。无法识别的 tz → 原样返回并置 tzWarn。
 */
function toShanghaiWall(dateStr, timeStr, tz) {
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
  const p = n => String(n).padStart(2, "0");
  return {
    date: `${sh.getUTCFullYear()}-${p(sh.getUTCMonth() + 1)}-${p(sh.getUTCDate())}`,
    time: `${p(sh.getUTCHours())}:${p(sh.getUTCMinutes())}`
  };
}

/** 默认识别标签正则: [[ES:uid]] 放事件任意字段; 捕获 uid; 裸 [[ES]] 则回退原生 UID */
const ES_MARK_DEFAULT = /\[\[ES(?::\s*([^\]]+?))?\s*\]\]/;

/**
 * 宽容解析"URL 列表"配置，吃得下多种写法:
 *   · 单条:            https://a.ics
 *   · 多条(逗号/分号/换行/空格任意混合分隔): https://a.ics, https://b.ics
 *   · JSON 数组:       ["https://a.ics","https://b.ics"]
 *   · JSON 单串:       "https://a.ics"
 * 自动去首尾空白、剥掉包裹的引号/方括号，只保留 http/https 开头的项。
 */
function parseUrlList(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  // 先试 JSON（数组或字符串）
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) {
      return j.map(x => String(x).trim()).filter(s => /^https?:\/\//i.test(s));
    }
    if (typeof j === "string" && /^https?:\/\//i.test(j.trim())) {
      return [j.trim()];
    }
  } catch (_) { /* 非 JSON，走分隔符拆分 */ }
  // 按 逗号/分号/换行/空白 拆分（合法 URL 内不含空白，安全），剥引号方括号
  return text.split(/[\s,;]+/)
    .map(s => s.replace(/^["'\[\]]+|["'\[\]]+$/g, "").trim())
    .filter(s => /^https?:\/\//i.test(s));
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
   *            env.CALENDAR_URLS  = 家庭日历订阅链接（逗号或换行分隔多条）
   *            （鉴权开关 AUTH_DISABLED 现在读 config.user.js，不再走 env）
   *            配置方法见 config.default.js 顶部"数据源/鉴权"两节的说明
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── 0. 鉴权（一切处理之前）─────────────────────────────────────────────
    // 放行条件，从上到下:
    //   ① 鉴权开关为 true → 直接放行(裸奔)。开关取值优先级:
    //        config.user.js 里的 AUTH_DISABLED（若设了）> index.js 顶部缺省值
    //   ② 正常鉴权: 请求带密钥且与 GATEWAY_KEY 一致
    // 密钥兼容三种传法(任一即可): ?key=xxx / 请求头 X-Gateway-Key / Authorization: Bearer xxx
    // 两侧密钥都自动去首尾空白（防 CF 粘贴时带尾随换行/空格导致对不上）。
    // Fail-closed 兜底: 未裸奔、GATEWAY_KEY 又空/未配 → 一律 401 锁死。
    //   —— 误删 GATEWAY_KEY 只会锁死(安全方向)，绝不会因配置丢失而静默裸奔。
    // 常量时间比较，避免逐字符提前返回的（极微弱）计时侧信道。
    const authOff = (CONFIG.AUTH_DISABLED !== undefined)
      ? CONFIG.AUTH_DISABLED === true
      : AUTH_DISABLED_DEFAULT === true;
    if (!authOff) {
      const expectedKey = String((env && env.GATEWAY_KEY) || "").trim();
      const providedKey = (
        url.searchParams.get("key") ||
        request.headers.get("X-Gateway-Key") ||
        (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") ||
        ""
      ).trim();
      const keyOk = expectedKey.length > 0 && constantTimeEqual(providedKey, expectedKey);
      if (!keyOk) {
        return new Response(
          JSON.stringify({
            error: "unauthorized",
            hint: "请求需带正确密钥(?key= 或 X-Gateway-Key 头 或 Authorization: Bearer)；若想关闭鉴权，把 config.user.js 里 AUTH_DISABLED 设为 true"
          }, null, 2),
          { status: 401, headers: { "Content-Type": "application/json; charset=utf-8" } }
        );
      }
    }

    const trace = ["=== ⚡️ 网关全链路审计日志 (V11 全解耦版) ==="];

    // ── 🛡️ 最外层兜底网 ───────────────────────────────────────────────────
    // 外部输入(日历/外部闹钟/节假日)各自已有 try;这张是最后一道网:任何未被下游
    // 接住的意外(内部逻辑边界 / 没预料的输入组合 / 未来改代码引入的 bug)都到这里,
    // 绝不让请求崩。返回【格式合法但安全】的降级响应,手机照常能取到、且什么都不误做。
    try {

      // ── 1. 时间环境（生产 or 仿真沙盒）──────────────────────────────────────
      const rawTestDate = url.searchParams.get("testDate");

      // 统一时钟输入: now(POINT匹配时钟) 与 testTime(沙盒锚点) 归一化 + 互填 + 非法降级。
      //   归一化: "7"→"07:00"、"7:5"→"07:05" (normClock)
      //   非法(越界/乱码)→ 降级到实时上海时钟 (和 testDate 非法降级同理)
      //   互填: 只带 now 自动带出 testTime; 只带 testTime 自动带出 now。?linkTime=0 关闭。
      //         仅补「完全省略」的一侧, 两侧都显式给出时各自生效(允许故意让匹配/锚点错位)。
      const realShanghaiHM = () => getShanghaiClockString();
      const linkTime = url.searchParams.get("linkTime") !== "0";

      const nowRaw  = url.searchParams.get("now");
      const testRaw = url.searchParams.get("testTime");
      let clockNow  = normClock(nowRaw);
      let clockTest = normClock(testRaw);
      const nowBad  = nowRaw  != null && nowRaw.trim()  !== "" && clockNow  == null;
      const testBad = testRaw != null && testRaw.trim() !== "" && clockTest == null;

      if (nowBad)  { clockNow  = realShanghaiHM(); trace.push(`[环境] ⚠️ now="${nowRaw}" 非法 → 降级实时 ${clockNow}`); }
      if (testBad) { clockTest = realShanghaiHM(); trace.push(`[环境] ⚠️ testTime="${testRaw}" 非法 → 降级实时 ${clockTest}`); }

      if (linkTime) {
        if (clockNow && clockTest == null && testRaw == null) {
          clockTest = clockNow; trace.push(`[环境] 🔗 只带 now → 自动带出 testTime=${clockTest}`);
        } else if (clockTest && clockNow == null && nowRaw == null) {
          clockNow = clockTest; trace.push(`[环境] 🔗 只带 testTime → 自动带出 now=${clockNow}`);
        }
      }
      const testTime = clockTest;   // 下游锚点沿用归一化后的值

      // testDate 合法性校验: 必须 YYYY-MM-DD，月 01-12、日 01-31，且能构成真实日期。
      // 非法(如月/日为 00、2月30日、格式错) → 忽略 testDate，回退到实时 now。
      // 好处: 手动测试时随手打的 2026-07-00 / 2026-00-10 不会报错，直接当没带日期。
      let testDate = null;
      let testDateReject = null;
      if (rawTestDate) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawTestDate.trim());
        if (m) {
          const [, y, mo, d] = m;
          // 用 UTC 正午锚点回读: 若月/日被 JS 归一化(如 00→上月、32→下月)则说明非法
          const probe = new Date(`${rawTestDate}T12:00:00Z`);
          const roundTrip = !isNaN(probe) &&
            String(probe.getUTCMonth() + 1).padStart(2, "0") === mo &&
            String(probe.getUTCDate()).padStart(2, "0") === d &&
            String(probe.getUTCFullYear()) === y;
          if (roundTrip) testDate = rawTestDate.trim();
          else testDateReject = rawTestDate;
        } else {
          testDateReject = rawTestDate;
        }
      }

      const baseDate = testDate || getShanghaiDateString(0);
      let virtualNow = Date.now();

      if (testDateReject) {
        trace.push(`[环境] ⚠️ testDate="${testDateReject}" 非法(月/日为00或格式错)，已忽略 → 回退实时 now`);
      }
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

      // ── 2. 节假日数据（workdays-core 单一真相源;跨年寻址 + 多镜像降级都在核内）──
      // years 含 yesterday 的年份:顺带修复原实现在 1 月上旬"昨日矩阵/向后块扫描
      // 跨入上一年却没拉上一年数据"的潜伏边界(此前静默按周末兜底)。
      // 🛡️ 解耦护栏: core 万一抛错也【只降级不崩】—— 捕获后 holidayData=[],
      //    rest-days 自动退回自然周末推演(调休失效但主流程照常出结果)。
      const years = [...new Set([yesterday, baseDate, tomorrow].map(d => +d.substring(0, 4)))];
      let holidayData = [];
      try {
        const holidayHub = await createHolidayHub(['CN'], years);
        holidayData = holidayHub.listDays('CN');   // [{date,isOffDay,name}] 与原 API days[] 同形
        holidayHub.loadLogs.forEach(l => trace.push(`[网络] 🌐 节假日: ${l}`));
      } catch (e) {
        trace.push(`[网络🚨] workdays-core 取节假日异常(${e.message})，降级为自然周末推演（调休判断将失效，主流程继续）`);
      }
      if (holidayData.length === 0) {
        trace.push(`[网络⚠️] 节假日数据为空，降级为自然周末推演（调休判断将失效！）`);
      }

      // ── 3. 日历事件（真实 ICS + 虚拟 testEvents 合并）──────────────────────
      // 🔐 日历链接从环境变量读取（不进代码仓库）。宽容解析: 单条/多条(逗号分号换行空格)/JSON数组皆可
      const calendarUrls = parseUrlList(env && env.CALENDAR_URLS);

      let allEvents = [];
      if (url.searchParams.get("skipCalendar") === "1") {
        trace.push(`[日历] ⏭️ skipCalendar=1: 跳过真实日历拉取（纯虚拟事件测试模式）`);
      } else if (calendarUrls.length === 0) {
        trace.push(`[日历🚨] CALENDAR_URLS 未配置或没有解析出有效链接！日历事件功能整体失效。` +
          `请在 CF 面板/Secret 里配置 CALENDAR_URLS（单条或多条 http(s) 链接，详见 config.js 顶部说明）`);
      } else {
        trace.push(`[日历] 🔐 解析到 ${calendarUrls.length} 条订阅链接`);
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

      // ── 4.5 外部闹钟源 EXTERNAL_ALARMS(乙方项目的具体闹钟点 → 手机闹钟) ─────────
      // 【定位】本网关是"具体点搬运工": 只收乙方算好的具体 date+time, 做 24h 裁剪+幂等对账。
      //   不做任何排期/循环/业务计算(工作日、间隔、自然月去重…都由乙方算好再喂进来)。
      // 【准入 = 强制识别; 完整对接契约见 docs/external-alarms.md】:
      //   ICS  在事件【任意字段】(标题/备注/分类/X-)放一个自带 uid 的标签 [[ES:uid]] →
      //        标签在即准入, 括号内即 uid(可读或 crc32 随乙方; 裸 [[ES]] 则回退 VEVENT 原生 UID)。
      //        源级 markPattern 可覆盖默认正则(须含1个 uid 捕获组)。
      //   JSON 乙方全权构造 payload, 每条必带 uid 字段, 有合法 uid 即准入。
      //   标签统一 Gate-ES-<源code>-<uid>; 身份靠 uid(非时间), 同分钟可并存、跨天可对账。
      //   时区: 默认 Asia/Shanghai 墙上时间; ICS 遇 Z/TZID、JSON 带 tz → 换算到 +8。
      //   全天(ICS): 源级 allDay = skip | default(+time, 默认09:30) | error。
      // 源 = config.SOURCES(公开URL,明文) + env.EXTERNAL_ALARMS(隐私URL,Secret) 并集。
      // 单源超时(默认5s)/失败/脏数据只记日志, 绝不拖垮主流程。
      const cfgSources = (CONFIG.EXTERNAL_ALARMS || {}).SOURCES || [];
      let envSources = [];
      if (env && env.EXTERNAL_ALARMS) {
        try {
          const p = JSON.parse(env.EXTERNAL_ALARMS);
          envSources = Array.isArray(p) ? p : (p.SOURCES || []);
          trace.push(`[外部闹钟] 🔐 env.EXTERNAL_ALARMS 解析出 ${envSources.length} 个隐私源`);
        } catch (e) {
          trace.push(`[外部闹钟🚨] env.EXTERNAL_ALARMS 不是合法 JSON 数组，已整体忽略: ${e.message}`);
        }
      }
      for (const src of [...cfgSources, ...envSources]) {
        if (!src || src.enabled === false || !src.url) continue;
        const nm = src.name || src.url;
        const code = src.code || src.name || "src";
        const srcTz = src.tz || null;
        try {
          // 超时保护: 慢源不拖垮整体响应(串行拉取)
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), src.timeoutMs || 5000);
          let res;
          try { res = await fetch(src.url, { signal: ctrl.signal }); }
          finally { clearTimeout(to); }
          if (!res.ok) throw new Error("HTTP " + res.status);

          // 统一成候选项 { uid, date, time, reason, tz }
          let items = [];
          let rejMark = 0, rejAllDay = 0;
          if (src.type === "ics") {
            const markRe = src.markPattern ? new RegExp(src.markPattern) : ES_MARK_DEFAULT;
            const evs = parseICS(await res.text());
            for (const d of [yesterday, baseDate, tomorrow]) {
              for (const ev of evs) {
                if (!isEventOnDate(ev, d)) continue;
                const m = markRe.exec(ev._scan || "");     // 识别标签放【任意字段】都能命中
                if (!m) { rejMark++; continue; }           // 无标签 → 不准入(不误收无关事件)
                const uid = (m[1] && m[1].trim()) || ev.uid;   // 标签内 uid; 裸标签回退原生 UID
                // 时间: 有时分用之; 全天按策略
                let time = normClock(ev.startTime);
                if (!time) {
                  const policy = src.allDay || "default";
                  if (policy === "skip") { rejAllDay++; continue; }
                  if (policy === "error" && !src.time) { rejAllDay++; continue; }
                  time = normClock(src.time || "09:30");
                }
                items.push({ uid, date: d, time: time.slice(0, 5),
                             tz: ev.startTZ || srcTz, reason: `${nm}:${ev.title || ""}` });
              }
            }
          } else {   // json: [ { uid, date, time, reason, tz? } ] 或 { alarms:[...] }
            const j = await res.json();
            const arr = Array.isArray(j) ? j : (j.alarms || []);
            items = arr.map(x => {
              const t = normClock(x.time);
              return { uid: x.uid, date: x.date, time: t ? t.slice(0, 5) : null,
                       tz: x.tz || srcTz, reason: `${nm}:${x.reason || ""}` };
            });
          }

          // 统一: 格式校验 → 时区换算 → 用换算后时间生成label(时间入label) → 准入 → 窗口 → 去重
          let added = 0, rejUid = 0, rejFmt = 0, rejWin = 0, tzWarn = 0;
          for (const it of items) {
            if (!it.date || !it.time || !/^\d{4}-\d{2}-\d{2}$/.test(it.date) || !/^\d{2}:\d{2}$/.test(it.time)) { rejFmt++; continue; }
            const w = toShanghaiWall(it.date, it.time, it.tz);   // → 上海墙上时间(可能跨天)
            if (w.tzWarn) tzWarn++;
            const label = esLabel(code, it.uid, w.time);   // 时间取【换算后】墙上时间, 编入label
            if (!label) { rejUid++; continue; }            // uid 空 → 无效
            if (!inWindow(parseDateTime(w.date, w.time).getTime())) { rejWin++; continue; }
            if (seenDynamic.has(label)) continue;          // 按 uid+时间(label)去重
            seenDynamic.add(label);
            dynamicOut.push({ label, time: w.time, reason: it.reason });
            added++;
          }
          const rej = [];
          if (rejMark)   rej.push(`无标签${rejMark}`);
          if (rejAllDay) rej.push(`全天${rejAllDay}`);
          if (rejUid)    rej.push(`无uid${rejUid}`);
          if (rejFmt)    rej.push(`格式${rejFmt}`);
          if (rejWin)    rej.push(`窗口外${rejWin}`);
          if (tzWarn)    rej.push(`时区未识别${tzWarn}`);
          trace.push(`[外部闹钟] 🌐 ${nm}(${code}): 候选${items.length} 窗口内新增${added}` +
            (rej.length ? ` (拒/警:${rej.join("/")})` : ""));
        } catch (e) {
          const why = e.name === "AbortError" ? `超时>${src.timeoutMs || 5000}ms` : e.message;
          trace.push(`[外部闹钟⚠️] ${nm} 拉取失败(${why}), 已跳过不影响主流程`);
        }
      }

      // 可开关闹钟全量 ON/OFF 指令（固定7个 + 上课，顺序: 固定在前 上课在后）
      const fixedOut = toggleRegistry.map(a => ({
        label: a.label,
        action: activeFixedInWindow.has(a.label) ? "ON" : "OFF",
        scheduledAt: a.scheduledAt,
        kind: a.kind
      }));

      const todayMatrix = matrices[1];   // matrices = [昨天, 今天, 明天]
      // ── 5. 设备状态时刻表(字段独立引擎, 见 device-state.js) ────────────────
      // 今/昨两天各生成一份: 今天供时点匹配+全天调试输出; 昨天供时段模式跨夜回看。
      auditFieldRules(trace);            // 自检: 订阅关系 + 孤儿规则 + 悬空订阅
      const deviceOut = buildDayDeviceEntries(todayMatrix, trace, "今日");
      const deviceYesterday = buildDayDeviceEntries(matrices[0], trace, "昨日");

      // ── 5.5 当前时刻匹配 current_state(双模式) ──────────────────────────────
      // 模式: URL ?mode=point|segment 覆盖 > config DEVICE.STATE_MODE_DEFAULT。
      //   point   时点: 定时刺客用(±容差命中时刻键)
      //   segment 时段: 状态重建/手动同步用(每字段回看最近取值,区间填满,可跨昨夜)
      // now 来源: ?now= 显式 > (无testDate时)网关此刻自动。testDate且无now = 纯调试不匹配。
      let mode = (url.searchParams.get("mode") || CONFIG.DEVICE.STATE_MODE_DEFAULT || "point").toLowerCase();
      if (mode !== "point" && mode !== "segment") {
        trace.push(`[模式⚠️] ?mode="${mode}" 无效(仅 point/segment)，回退默认`);
        mode = CONFIG.DEVICE.STATE_MODE_DEFAULT || "point";
      }
      let currentState = null;
      let rawNow = clockNow;                          // 已归一化(含 testTime 互填 / 非法降级)
      let nowSource = clockNow ? "param" : "auto";
      if (!rawNow && !testDate) {
        rawNow = getShanghaiClockString(true);        // 生产: 网关此刻(带秒)
        nowSource = "auto";
      }
      if (rawNow) {
        currentState = matchState({
          mode, rawNow, nowSource, baseDate, yesterdayDate: yesterday,
          deviceToday: deviceOut, deviceYesterday, trace
        });
      }

      // ── 5.6 归一化: 给手机端一个确定的字符串旗标 ────────────────────────────
      //   为什么: JSON 布尔 → iOS Shortcuts「文本」的呈现不是契约保证的(见过 Yes/No、
      //   true/false、1/0 多种), 直接 `If Text is Yes` 会随系统版本静默失效。
      //   这里在 current_state.state 上追加 sync_alarms_flag: "yes"/"no" 字符串,
      //   手机端改读它、按字面比 "yes" 即可。原布尔 sync_alarms 原样保留,
      //   不影响 device_schedule / 面板 / Tasker 等既有布尔契约。
      if (currentState && currentState.state) {
        currentState.state.sync_alarms_flag = currentState.state.sync_alarms ? "yes" : "no";
      }

      // ── 6. 人类可读调试面板 ─────────────────────────────────────────────────
      let panel = `====================================\n`;
      panel += `⏰ Smart Schedule Gateway (V11)\n`;
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

      panel += `\n📱 设备状态·今日计划 (刺客到点读自己那个键; 只反映今天, 字段null=不动):\n`;
      const devKeys = Object.keys(deviceOut);
      if (devKeys.length === 0) {
        panel += `  -> ∅ (今日无任何设备状态指令, 全天手工掌控)\n`;
      } else {
        devKeys.sort().forEach(k => {
          const s = deviceOut[k];
          const fmt = v => (v === null ? "—" : v);
          const focusStr = s.focus ? `${s.focus.mode}=${s.focus.action}` : "—(纯同步)";
          panel += `  -> [${k}] focus:${focusStr}  silent:${fmt(s.silent)}  media_vol:${fmt(s.media_volume)}${s.sync_alarms ? "  🔄同步闹钟" : ""}\n`;
        });
      }

      panel += `\n🎯 当前时刻匹配 current_state (?mode=point|segment, ?now=可显式指定):\n`;
      if (!currentState) {
        panel += `  -> (本次未匹配: testDate调试且未带now; 生产/带now时自动输出)\n`;
      } else {
        const s = currentState.state;
        const fmt = v => (v === null || v === undefined ? "—" : (typeof v === "object" ? JSON.stringify(v) : v));
        const focusStr = s.focus ? `${s.focus.mode}=${s.focus.action}` : "—";
        panel += `  -> 模式:${currentState.mode}  now=${currentState.now}(${currentState.now_source})  ` +
          (currentState.matched ? `✅${currentState.matched_key ? "命中键[" + currentState.matched_key + "]" : "时段回看有值"}` :
            `⚪未匹配(${currentState.error})`) + `\n`;
        panel += `     focus:${focusStr}  silent:${fmt(s.silent)}  media_vol:${fmt(s.media_volume)}  sync_alarms:${s.sync_alarms}\n`;
        if (currentState.field_sources) {
          panel += `     来源: ` + Object.entries(currentState.field_sources)
            .map(([f, v]) => `${f}←${v || "—"}`).join("  ") + `\n`;
        }
      }

      panel += `\n🔍 DEEPLOG 审计追踪 (方括号内为规则编号, 对应 rules.js):\n` + trace.join("\n");

      // ── 7. 最终响应 ─────────────────────────────────────────────────────────
      return new Response(JSON.stringify({
        meta: {
          version: "V11-Decoupled",
          currentTime: formatShanghai(Date.now()),
          windowLeftBound: formatShanghai(windowStart),
          windowRightBound: formatShanghai(windowEnd)
        },
        fixedAlarms: fixedOut,
        dynamicAlarms: dynamicOut,
        device_schedule: deviceOut,
        current_state: currentState,
        humanReadable: panel
      }, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (err) {
      // 降级响应: state 全 null → 手机 Apply* 全部空转、不误改任何设备状态;
      // 预建固定闹钟常驻手机、不受影响; 错误进 error/humanReadable 便于排查。
      // HTTP 200: 保证手机端 fetch 成功拿到合法 JSON, 而非 500 导致整条同步失效。
      return new Response(JSON.stringify({
        error: "gateway_exception",
        message: String((err && err.stack) || err),
        meta: { version: "V11-Decoupled", currentTime: formatShanghai(Date.now()) },
        fixedAlarms: [],
        dynamicAlarms: [],
        device_schedule: {},
        current_state: { matched: false, error: "gateway_exception", now: null, now_source: null, mode: null, state: emptyState() },
        humanReadable: trace.join("\n") + "\n\n🚨 GATEWAY EXCEPTION（已被最外层兜底网接住，主流程未崩）:\n" + String((err && err.stack) || err)
      }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }
  }
};
