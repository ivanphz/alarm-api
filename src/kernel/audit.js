// ─────────────────────────────────────────────────────────────────────────────
// kernel/audit.js — 静态一致性审计（V12 步骤④）
// ─────────────────────────────────────────────────────────────────────────────
// 纯诊断零副作用。诊断总是携带 summary/reason（沿袭 calendar-api 治理层纪律）。
//   ① 字段订阅: 孤儿 schedule（无人订阅→其产生逻辑可安全删）/ 悬空 USE
//   ② quiet 边界白名单: 边界墙钟 ∉ DND.WHITELIST → 手机刺客自动化不存在，warn
// ─────────────────────────────────────────────────────────────────────────────

import { feedsOf, FEEDS_DEFAULT, FEEDS_KNOWN } from "./registry.js";

export function auditFieldSubscriptions(fieldsConfig, schedules, trace, plugins) {
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
  // 孤儿检查只针对【声明喂字段】的 schedule。喂闹钟/todo/其它插件的天然无字段订阅，不算孤儿。
  // 判据来自插件自声明 feeds（registry.js），内核【不再持有任何插件名单】。
  const declared = new Map((plugins || []).map((p) => [p.name, feedsOf(p)]));
  for (const p of produced) {
    const feeds = declared.get(p) ?? [FEEDS_DEFAULT];   // 未登记 → 按默认 fields 处理（响亮）
    // 开放枚举但校验已知项: 拼错的值（如 "field"）会静默豁免掉孤儿检查，必须告警
    for (const f of feeds) {
      if (!FEEDS_KNOWN.has(f)) {
        trace.push({ level: "warn", plugin: "audit", ref: "unknown_feeds",
          msg: `插件 "${p}" 声明了未知 feeds "${f}"（已知: ${[...FEEDS_KNOWN].join("/")}）` +
               `—— 若是拼写错误，该插件将被静默排除出所有消费方` });
      }
    }
    if (feeds.includes("fields") && !subs[p]) {
      trace.push({ level: "warn", plugin: "audit", ref: "orphan_schedule",
        msg: `schedule "${p}" 无字段订阅（孤儿，其产生逻辑可安全删除）；` +
             `若它本就不喂字段，请在插件里声明 feeds: "alarms"/"todos"/"plugins"` });
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
