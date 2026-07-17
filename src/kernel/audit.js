// ─────────────────────────────────────────────────────────────────────────────
// kernel/audit.js — 静态一致性审计（V12 步骤④）
// ─────────────────────────────────────────────────────────────────────────────
// 纯诊断零副作用。诊断总是携带 summary/reason（沿袭 calendar-api 治理层纪律）。
//   ① 字段订阅: 孤儿 schedule（无人订阅→其产生逻辑可安全删）/ 悬空 USE
//   ② quiet 边界白名单: 边界墙钟 ∉ DND.WHITELIST → 手机刺客自动化不存在，warn
// ─────────────────────────────────────────────────────────────────────────────

export function auditFieldSubscriptions(fieldsConfig, schedules, trace) {
  const produced = new Set(Object.keys(schedules));
  const subs = {};
  for (const [name, cfg] of Object.entries(fieldsConfig || {})) {
    if (cfg.USE) (subs[cfg.USE] ||= []).push(name);
  }
  for (const [use, names] of Object.entries(subs)) {
    if (!produced.has(use)) {
      trace.push({ level: "error", plugin: "audit", ref: "dangling_subscription",
        msg: `字段 {${names.join(",")}} 订阅了不存在的 schedule "${use}"（检查 FIELDS.*.USE 或插件注册）` });
    }
  }
  // 集合类/事实类 schedule 不参与字段订阅，不算孤儿
  const exempt = new Set(["restdays", "presence", "school_break", "god_mode",
                          "wake_alarms", "weekend_class"]);
  for (const p of produced) {
    if (!subs[p] && !exempt.has(p)) {
      trace.push({ level: "warn", plugin: "audit", ref: "orphan_schedule",
        msg: `schedule "${p}" 无字段订阅（孤儿，其产生逻辑可安全删除）` });
    }
  }
}

export function auditQuietWhitelist(quietSegments, whitelist, trace) {
  if (!Array.isArray(whitelist) || whitelist.length === 0) return;
  const allow = new Set(whitelist);
  for (const seg of quietSegments || []) {
    const hm = seg.from.slice(11);
    if (!allow.has(hm)) {
      trace.push({ level: "warn", plugin: "audit", ref: "quiet_boundary_off_whitelist",
        msg: `quiet 边界 ${seg.from} 不在 DND.WHITELIST 内 —— point 刺客无此自动化将漏触发；` +
             `segment 轮询不受影响。请补自动化或检查规则` });
    }
  }
}
