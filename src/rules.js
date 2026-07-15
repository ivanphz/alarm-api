/**
 * ==============================================================================
 * 🧠 rules.js — 规则决策引擎（★★ 闹钟响错了就来这里，按 trace 里的规则编号找函数）
 * ==============================================================================
 *
 * ┌──────── 规则编号速查表（trace 日志前缀与此一一对应）────────────────────────┐
 * │ R1   上帝模式: 日历事件 [上帝模式] DESCRIPTION 填 JSON，完全接管当天       │
 * │ R2   底色注入（仅法定工作日）:                                             │
 * │      R2.1 学校假期 → SchoolBreak 起床组，废弃首日逻辑                      │
 * │      R2.2 普通日   → Workday 起床组                                        │
 * │      R2.3 昨天实际休息 → 并行追加 FirstWorkday 兜底铃                      │
 * │      R2.4 午休铃 + 下班铃 + 午间 DND 两键 （各铃时间见 config.FIXED_ALARMS）│
 * │ R3   周末上课（动态闹钟 Gate-Dynamic-Class）:                              │
 * │      R3.1 星期匹配注入  R3.2 长休块≥阈值跳课  R3.3 学校假期跳课            │
 * │ R4   LEAVE 碰撞（不上班: 休假/请假/年假）:                                 │
 * │      R4.1 晨间→关早间组+清晨间动态  R4.2 午休→关午休铃+静默午间DND         │
 * │      R4.3 傍晚→关下班铃    （全天事件 = 三区全中；不新建动态闹钟）         │
 * │ R5   WORK_EVENT 碰撞（特殊上班: 出差/会议/外勤/风勘/覆盖/晚到/早到/早起）: │
 * │      R5.1 晨间→关早间组+清晨间动态+【有具体时间则新建 Gate-Dynamic-Event】 │
 * │      R5.2 午休→同R4.2   R5.3 傍晚→同R4.3                                   │
 * │ R6   DND 装配（最后执行，依赖前面的碰撞标记）:                             │
 * │      R6.1 夜间ON: 明天实际休息→22:25，否则→20:55（任何情况都输出）         │
 * │      R6.2 早间解除决策树:                                                  │
 * │        a) LEAVE晨间碰撞 且 昨日块≥阈值 → 不输出（长假尾巴，手动）          │
 * │        b) LEAVE晨间碰撞 且 昨日块<阈值 → 07:40（用户拍板: 早点解除）       │
 * │        c) 实际休息日 且 所在块≥阈值    → 不输出（长假中段，绝不吵醒）      │
 * │        d) 实际休息日 且 所在块<阈值    → 09:30（普通周末/上课日，铃穿透）  │
 * │        e) 其余（工作日/出差日/半天假的正常上班半天）→ 07:40                │
 * │      R6.3 午间两键: 仅法定工作日 且 午休未被碰撞 → 12:15 ON + 13:29 OFF    │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 迭代方法: 发现"该响没响 / 不该响却响了" → 看 humanReadable 的 DEEPLOG →
 *           找到写着 [R编号] 的那行决策 → 到本文件同编号处修改 → push 部署。
 * ==============================================================================
 */

import { CONFIG } from "./config.js";
import { timeToMinutes, addDaysToDateString, getSafeDayOfWeek } from "./time-utils.js";
import { matchKeywordGroup } from "./rest-days.js";
import { getSchoolBreak } from "./school-break.js";

/**
 * 取固定闹钟的参考时间(唯一存放处 = config.FIXED_ALARMS[].scheduledAt)。
 * 日志里所有"几点"都经此动态取值,不再把时间抄成字面文本 → 改一处即处处同步。
 * 注: 这是【展示/窗口判断】用的镜像时间; 闹钟真正响几点由手机本地那条闹钟决定。
 */
const ftime = (label) =>
  (CONFIG.FIXED_ALARMS.find(a => a.label === label)?.scheduledAt) || "?";

/**
 * 生成单日状态矩阵
 * @param dateStr  目标日期 "YYYY-MM-DD"
 * @param dayEvents 已经过 Date Guard 过滤的当日事件
 * @param rc       rest-days 判定器 { isOfficialWorkday, isNamedHoliday, isEffectiveRestDay, getBlockLength }
 * @param trace    审计日志数组
 * @returns { dateStr, activeLabels:Set, dynamicAlarms:[{label,time,reason}], dnd_on:[], dnd_off:[] }
 */
export function generateDayMatrix(dateStr, dayEvents, rc, trace) {
  const dow = getSafeDayOfWeek(dateStr);
  const isWorkday = rc.isOfficialWorkday(dateStr);
  const schoolBreak = getSchoolBreak(dateStr);
  const blockLen = rc.getBlockLength(dateStr);

  trace.push(
    `\n--- 📅 矩阵扫描 ${dateStr} 周${dow === 0 ? "日" : dow} | ` +
    `法定${isWorkday ? "工作日" : "休息日"} | 休息块=${blockLen}天 | ` +
    `学校假期=${schoolBreak ? schoolBreak.name : "否"} | 当日事件=${dayEvents.length}条 ---`
  );

  const activeLabels = new Set();       // 固定闹钟 ON 集合
  let dynamicAlarms = [];               // 动态闹钟 [{label,time,reason}]
  let dnd_on = [];
  let dnd_off = [];

  // 碰撞标记（供 R6 DND 装配使用）
  const flags = { morningLeave: false, noonCollided: false };

  /** 固定闹钟 ON（自动联动 BUNDLED 副铃） */
  const addFixed = (label) => {
    activeLabels.add(label);
    if (CONFIG.BUNDLED[label]) activeLabels.add(CONFIG.BUNDLED[label]);
  };

  // ═══ R1 上帝模式（命中即完全接管，直接返回）═════════════════════════════
  for (const ev of dayEvents) {
    if (matchKeywordGroup(ev.title, "GOD_MODE") && ev.description) {
      try {
        const god = JSON.parse(ev.description);
        trace.push(`  [R1] 👑 上帝模式 [${ev.title}]: 当天完全按手写 JSON 执行，常规规则旁路`);
        const godLabels = new Set(
          (god.fixedAlarms || []).filter(a => a.action !== "OFF").map(a => a.label)
        );
        const godDyn = god.dynamicAlarms || [];
        const gOn = [], gOff = [];
        for (const [k, v] of Object.entries(god.dnd_schedule || {})) {
          (v === "ON" ? gOn : gOff).push(k);
        }
        return { dateStr, activeLabels: godLabels, dynamicAlarms: godDyn, dnd_on: gOn, dnd_off: gOff };
      } catch (e) {
        trace.push(`  [R1] ❌ 上帝模式 JSON 解析失败 [${ev.title}]: ${e.message}，忽略并继续常规规则`);
      }
    }
  }

  // ═══ R2 底色注入（仅法定工作日；调休补班的周六走这里）══════════════════
  if (isWorkday) {
    if (schoolBreak) {
      // R2.1 学校假期: 起床铃换组，首日逻辑废弃
      addFixed("Gate-Fixed-SchoolBreak-WakeUp-Vib");
      trace.push(`  [R2.1] 🏫 ${schoolBreak.name}期间工作日: SchoolBreak 起床组 ON (${ftime("Gate-Fixed-SchoolBreak-WakeUp-Vib")}震动+${ftime("Gate-Fixed-SchoolBreak-WakeUp-Ring")}响铃)，首日并行逻辑废弃`);
    } else {
      // R2.2 普通工作日起床组
      addFixed("Gate-Fixed-Workday-WakeUp-Vib");
      trace.push(`  [R2.2] ⏰ 工作日: Workday 起床组 ON (${ftime("Gate-Fixed-Workday-WakeUp-Vib")}震动+${ftime("Gate-Fixed-Workday-WakeUp-Ring")}响铃)`);

      // R2.3 节后首日并行兜底（昨天"实际"在休息，含全天请假）
      const yesterday = addDaysToDateString(dateStr, -1);
      if (rc.isEffectiveRestDay(yesterday)) {
        addFixed("Gate-Fixed-FirstWorkday-WakeUp-Ring");
        trace.push(`  [R2.3] 🛡️ 节后首个工作日: 并行追加 FirstWorkday 兜底铃 ${ftime("Gate-Fixed-FirstWorkday-WakeUp-Ring")}（与 Workday 组三重保险）`);
      }
    }

    // R2.4 午休 + 下班 + 午间 DND
    addFixed("Gate-Fixed-Workday-NapEnd-Vib");
    addFixed("Gate-Fixed-Workday-OffWork-Vib");
    trace.push(`  [R2.4] 💼 午休铃${ftime("Gate-Fixed-Workday-NapEnd-Vib")} + 下班铃${ftime("Gate-Fixed-Workday-OffWork-Vib")} ON，午间DND待R6.3装配`);
  }

  // ═══ R3 周末上课（时段化: 能固定就固定，固定不了自动动态）═══════════════════
  // 时段 = normal(非假期) 或 SCHOOL_BREAK 区间的 key(summer/winter/...)。
  // periods 里没配该时段 → 不上课。时段时间 == periods[fixed](锚) → 复用预建固定闹钟(可靠常驻)；
  // 时间不同 → 固定闹钟表达不了(一个 label 只能焊一个时间) → 自动降级动态。
  if (CONFIG.WEEKEND_CLASS.ENABLED && !isWorkday) {
    const dayAbbr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow];
    const pKey  = schoolBreak ? schoolBreak.key  : "normal";
    const pName = schoolBreak ? schoolBreak.name : "平时";
    for (const s of CONFIG.WEEKEND_CLASS.SCHEDULE) {
      if (s.day !== dow) continue;                          // 只在该课的星期建
      if (blockLen >= CONFIG.LONG_REST_DAYS) {
        trace.push(`  [R3.2] 🚫 ${s.name} 跳过: 连续休息块 ${blockLen}天 ≥ 阈值 ${CONFIG.LONG_REST_DAYS}（长假默认不上课）`);
        continue;
      }
      const t = (s.periods || {})[pKey];
      if (!t) {
        trace.push(`  [R3.3] 🚫 ${s.name} 跳过: 当前时段 ${pName}[${pKey}] 未在 periods 配时间（该时段不上课）`);
        continue;
      }
      const anchorT = s.fixed ? (s.periods || {})[s.fixed] : null;
      if (s.fixed && !anchorT) {
        trace.push(`  [R3.4🚨] ${s.name}: fixed="${s.fixed}" 但 periods 无该时段时间（配置错误）→ 本次按动态处理`);
      }
      if (anchorT && t === anchorT) {
        const label = `${CONFIG.CLASS_LABELS.FIXED}-${s.id}`;
        activeLabels.add(label);
        trace.push(`  [R3.1a] 💃 ${s.name}: 时段${pName} ${t} == 锚[${s.fixed}] ${anchorT} → 走【固定】${label}（预建常驻，可靠）`);
      } else {
        const label = `${CONFIG.CLASS_LABELS.DYNAMIC}-${dayAbbr}-${s.id}-${t.replace(":", "")}`;
        dynamicAlarms.push({ label, time: t, reason: `${s.name}(${pName})` });
        const why = anchorT ? `时段${pName} ${t} ≠ 锚[${s.fixed}] ${anchorT}` : `未配 fixed`;
        trace.push(`  [R3.1b] 💃 ${s.name}: ${why} → 走【动态】${label} @ ${t}`);
      }
    }
  }

  // ═══ R4 / R5 事件碰撞遍历 ═══════════════════════════════════════════════
  const mornEnd  = timeToMinutes(CONFIG.ZONES.MORNING.end);
  const noonSt   = timeToMinutes(CONFIG.ZONES.NOON.start);
  const noonEd   = timeToMinutes(CONFIG.ZONES.NOON.end);
  const eveSt    = timeToMinutes(CONFIG.ZONES.EVENING.start);

  /** 计算事件命中的碰撞区（全天事件三区全中） */
  const getCollisions = (ev) => {
    if (!ev.startTime) return { morning: true, noon: true, evening: true, allDay: true };
    const s = timeToMinutes(ev.startTime);
    const e = timeToMinutes(ev.endTime || ev.startTime);
    return {
      morning: s <= mornEnd,
      noon: (s < noonEd && e > noonEd) || (s >= noonSt && s <= noonEd),
      evening: e > eveSt,
      allDay: false
    };
  };

  /** 晨间碰撞的公共动作: 关固定早间组 + 清掉落在晨间的【上课闹钟】(固定/动态两种形态都清) */
  const clearMorning = () => {
    for (const lb of CONFIG.MORNING_LABELS) activeLabels.delete(lb);
    // ① 固定形态的课(Gate-Fixed-Class-<id>): 按当天时段时间判断是否在晨间
    const pk = schoolBreak ? schoolBreak.key : "normal";
    for (const s of CONFIG.WEEKEND_CLASS.SCHEDULE) {
      const t = (s.periods || {})[pk];
      if (t && timeToMinutes(t) <= mornEnd) activeLabels.delete(`${CONFIG.CLASS_LABELS.FIXED}-${s.id}`);
    }
    // ② 动态形态的课(Gate-Class-*): 按前缀+时间过滤。
    //    WORK_EVENT 事件闹钟(Gate-Dynamic-Event-*)是碰撞自己的产物，不动。
    const dyn = CONFIG.CLASS_LABELS.DYNAMIC + "-";
    dynamicAlarms = dynamicAlarms.filter(
      a => !(a.label.startsWith(dyn) && timeToMinutes(a.time) <= mornEnd)
    );
  };

  for (const ev of dayEvents) {
    const isLeave = matchKeywordGroup(ev.title, "LEAVE");
    const isWork  = matchKeywordGroup(ev.title, "WORK_EVENT");
    if (!isLeave && !isWork) continue;

    const c = getCollisions(ev);
    const rangeDesc = c.allDay ? "全天" : `${ev.startTime}-${ev.endTime || ev.startTime}`;
    const rulePrefix = isLeave ? "R4" : "R5";
    const groupName  = isLeave ? "LEAVE请假" : "WORK特殊上班";

    if (c.morning) {
      clearMorning();
      if (isLeave) {
        flags.morningLeave = true;
        trace.push(`  [R4.1] 🛏️ ${groupName} [${ev.title}](${rangeDesc}) 晨间碰撞: 关闭全部早间闹钟（睡觉自由，DND见R6.2）`);
      } else {
        if (ev.startTime) {
          const evLabel = `${CONFIG.DYNAMIC_LABELS.EVENT}-${ev.startTime.replace(":", "")}`;
          dynamicAlarms.push({ label: evLabel, time: ev.startTime, reason: ev.title });
          trace.push(`  [R5.1] ⚡ ${groupName} [${ev.title}](${rangeDesc}) 晨间碰撞: 关早间固定组，目标动态闹钟 ${evLabel} @ ${ev.startTime}（时间已编入标签，供幂等对账）`);
        } else {
          trace.push(`  [R5.1] ⚡ ${groupName} [${ev.title}](全天) 晨间碰撞: 关早间固定组（全天事件无具体时间，不建动态闹钟，需要时手动设）`);
        }
      }
    }

    if (c.noon) {
      activeLabels.delete("Gate-Fixed-Workday-NapEnd-Vib");
      flags.noonCollided = true;
      trace.push(`  [${rulePrefix}.2] 🍜 [${ev.title}] 午休碰撞: 关午休铃，午间DND两键静默（12:15/13:29不输出）`);
    }

    if (c.evening) {
      activeLabels.delete("Gate-Fixed-Workday-OffWork-Vib");
      trace.push(`  [${rulePrefix}.3] 🌆 [${ev.title}] 傍晚碰撞: 关下班铃`);
    }
  }

  // ═══ R6 DND 装配（依赖上面的碰撞标记，必须最后执行）═════════════════════
  // R6.1 夜间 ON: 看"明天"是否实际休息（含明天全天请假 → 今晚 22:25 晚点静音）
  const tomorrow = addDaysToDateString(dateStr, 1);
  const nightKey = rc.isEffectiveRestDay(tomorrow)
    ? CONFIG.DND.NIGHT_ON_REST_EVE
    : CONFIG.DND.NIGHT_ON_WORKDAY_EVE;
  dnd_on.push(nightKey);
  trace.push(`  [R6.1] 🌙 夜间DND: ${nightKey} ON（明天${rc.isEffectiveRestDay(tomorrow) ? "休息" : "上班"}）`);

  // R6.2 早间解除决策树
  if (flags.morningLeave) {
    const yBlock = rc.getBlockLength(addDaysToDateString(dateStr, -1));
    if (yBlock >= CONFIG.LONG_REST_DAYS) {
      trace.push(`  [R6.2a] 🔒 早间DND不输出: 请假晨间碰撞且昨日休息块=${yBlock}天≥${CONFIG.LONG_REST_DAYS}（长假尾巴，睡到自然醒手动解除）`);
    } else {
      dnd_off.push(CONFIG.DND.MORNING_OFF_WORKDAY);
      trace.push(`  [R6.2b] ☀️ 早间DND: ${CONFIG.DND.MORNING_OFF_WORKDAY} OFF（请假晨间碰撞但昨日块=${yBlock}天<${CONFIG.LONG_REST_DAYS}，早点解除恢复推送）`);
    }
  } else if (rc.isEffectiveRestDay(dateStr)) {
    if (blockLen >= CONFIG.LONG_REST_DAYS) {
      trace.push(`  [R6.2c] 🔒 早间DND不输出: 休息块=${blockLen}天≥${CONFIG.LONG_REST_DAYS}（长假中段，绝不吵醒，全手动）`);
    } else {
      dnd_off.push(CONFIG.DND.MORNING_OFF_WEEKEND);
      trace.push(`  [R6.2d] ☀️ 早间DND: ${CONFIG.DND.MORNING_OFF_WEEKEND} OFF（普通休息日，块=${blockLen}天；上课日闹钟自行穿透DND）`);
    }
  } else {
    dnd_off.push(CONFIG.DND.MORNING_OFF_WORKDAY);
    trace.push(`  [R6.2e] ☀️ 早间DND: ${CONFIG.DND.MORNING_OFF_WORKDAY} OFF（标准工作日/出差日/半天假的正常上班半天）`);
  }

  // R6.3 午间两键（仅法定工作日 且 午休未被碰撞）
  if (isWorkday && !flags.noonCollided) {
    dnd_on.push(CONFIG.DND.NOON_ON);
    dnd_off.push(CONFIG.DND.NOON_OFF);
    trace.push(`  [R6.3] 🍚 午间DND: ${CONFIG.DND.NOON_ON} ON + ${CONFIG.DND.NOON_OFF} OFF`);
  }

  return { dateStr, activeLabels, dynamicAlarms, dnd_on, dnd_off };
}
