// ─────────────────────────────────────────────────────────────────────────────
// kernel/rules.js — 规则规范形式 + 翻译器（原子化第②步，ATOMIC-RULES §5）
// ─────────────────────────────────────────────────────────────────────────────
// 解决的问题: 一个边界的完整规格今天散在四张表里 —— SHAPE_AT / APPLY_AT / OWN /
// PRESET。想知道"20:55 到底会发生什么"要横跨四处对着看，改一处忘一处毫无提示。
// 这就是要根除的牛皮癣本身。
//
// ── 规范形式（内部唯一真相，触发因为主键）──────────────────────────────────
//   { "clock@20:55": [ { field, value?, preset?, shape, until?, apply, guards? }, ... ] }
//
//   为什么用触发因当主键而不是时刻: 时刻只是触发因的一种，它是唯一装得下
//   doorbell / alarm_stopped 的形状（ATOMIC-RULES §3）。第②步只产 clock@，
//   但结构现在就留出来，将来加动态触发因不用掀桌。
//
// ── 两种书写糖（都翻译到规范形式，加载期完成）──────────────────────────────
//   字段为主键 FIELDS.<字段>.RULES = { "HH:MM": 规格 }
//       字段有私有时刻时最直观（Ivan 2026-07-28 要求补上）
//   时刻为主键 V2.BOUNDARIES        = { "HH:MM": { <字段>: 规格 } }
//       多字段共用同一批时刻时最省（六个 DND 时刻就是这种）
//
//   ★ 同一个 (时刻, 字段) 在两处各写一份 → 报错，绝不静默取一个（ATOMIC-RULES §5.4）
//
// ── 一条规格的字段 ───────────────────────────────────────────────────────────
//   value?  字面量（"on"/"off"/数值）。省略 = 继承订阅规则在该时刻的值
//   preset? focus 换挡（token）
//   shape?  "level"(默认) | "pulse"
//   until?  有界电平的窗口终点 "HH:MM"（shape=level 时有效）
//   apply?  "always" | "if_changed" | "if_differs"（省略 = 字段级 APPLY）
//   guard?  only_if_current 语法糖: "sleep" | ["none","sleep"]
//   guards? 完整守卫数组（与 guard 二选一）
// ─────────────────────────────────────────────────────────────────────────────

const padHM = (hm) => {
  const [h, m] = String(hm).split(":");
  return `${String(h).padStart(2, "0")}:${String(m ?? "00").padStart(2, "0")}`;
};
const SPEC_KEYS = new Set(["at", "when", "value", "preset", "shape", "until", "apply", "guard", "guards", "note"]);
const WHEN_AXES = new Set(["morning", "noon", "eve"]);      // 日型的三根正交轴（plugins/day-type.js）
const SHAPES = new Set(["level", "pulse"]);
const APPLIES = new Set(["always", "if_changed", "if_differs", "enforce", "on_change"]);

function validateSpec(where, spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`规则 ${where}: 规格必须是对象`);
  }
  for (const k of Object.keys(spec)) {
    if (!SPEC_KEYS.has(k)) {
      throw new Error(`规则 ${where}: 未知键 "${k}"（可用: ${[...SPEC_KEYS].join("/")}）`);
    }
  }
  if (spec.shape && !SHAPES.has(spec.shape)) {
    throw new Error(`规则 ${where}: shape="${spec.shape}" 非法（level|pulse）`);
  }
  if (spec.apply && !APPLIES.has(spec.apply)) {
    throw new Error(`规则 ${where}: apply="${spec.apply}" 非法`);
  }
  if (spec.shape === "pulse" && spec.until) {
    throw new Error(`规则 ${where}: pulse 不能有 until（脉冲的主张时长本来就是 0）`);
  }
  if (spec.until && spec.guards && spec.guard) {
    throw new Error(`规则 ${where}: guard 与 guards 二选一`);
  }
  if (spec.guard && spec.guards) {
    throw new Error(`规则 ${where}: guard 与 guards 二选一`);
  }
  // at: 时刻可以是【算出来的】（ATOMIC-RULES §4）
  //   "07:40"                                          字面量
  //   { from:"wake_alarms", pick:"last_wake",           锚定另一条规则的产出
  //     offset:20, fallback:"07:40" }                   + 偏移分钟 + 取不到时的兜底
  if (spec.at != null && typeof spec.at !== "string") {
    const a = spec.at;
    if (typeof a !== "object" || Array.isArray(a)) {
      throw new Error(`规则 ${where}: at 要么是 "HH:MM"，要么是 { from, pick, offset?, fallback? }`);
    }
    if (!a.from || !a.pick) throw new Error(`规则 ${where}: at 缺 from / pick`);
    if (a.offset != null && !Number.isFinite(Number(a.offset))) {
      throw new Error(`规则 ${where}: at.offset 必须是数字（分钟）`);
    }
  }
  // until: 字面量 "HH:MM" 或 { offset: N }（相对 at 偏移，动态时刻场景必须用相对）
  if (spec.until != null && typeof spec.until !== "string") {
    const u = spec.until;
    if (typeof u !== "object" || u.offset == null || !Number.isFinite(Number(u.offset))) {
      throw new Error(`规则 ${where}: until 要么是 "HH:MM"，要么是 { offset: 分钟数 }`);
    }
  }
  if (spec.when != null) {
    if (typeof spec.when !== "object" || Array.isArray(spec.when)) {
      throw new Error(`规则 ${where}: when 必须是对象，如 { morning: ["work"] }`);
    }
    for (const [axis, vals] of Object.entries(spec.when)) {
      if (!WHEN_AXES.has(axis)) {
        throw new Error(`规则 ${where}: when 的轴 "${axis}" 不存在（可用: ${[...WHEN_AXES].join("/")}）`);
      }
      if (!Array.isArray(vals) || !vals.length) {
        throw new Error(`规则 ${where}: when.${axis} 必须是非空数组`);
      }
    }
  }
}

/** 某日的日型是否满足一条规则的 when（缺省 = 总是满足） */
export function whenMatches(when, dayType) {
  if (!when) return true;
  if (!dayType) return false;                              // 日型无主张 → 规则不启用（传染）
  for (const [axis, vals] of Object.entries(when)) {
    if (!vals.includes(dayType[axis])) return false;
  }
  return true;
}

/**
 * 两种书写糖 → 规范形式。
 * @returns { canonical, conflicts } canonical = { "clock@HH:MM": [ {field, ...spec} ] }
 */
export function toCanonical({ fields = {}, boundaries = {} } = {}) {
  const canonical = {};
  const seen = new Map();                                  // "HH:MM|field" → 来源，用于冲突检测

  const put = (hm, field, spec, source) => {
    const key = padHM(hm);
    const dedup = `${key}|${field}`;
    if (seen.has(dedup)) {
      throw new Error(
        `规则冲突: (${key}, ${field}) 在 ${seen.get(dedup)} 和 ${source} 各写了一份。` +
        `两种书写形式只是视图，同一格不能有两份真相 —— 删掉其中一处`,
      );
    }
    seen.set(dedup, source);
    // 一格可以有多条变体（不同 when），但同一格不能被两种书写形式各写一份
    const variants = Array.isArray(spec) ? spec : [spec];
    for (const v of variants) {
      validateSpec(`${source} ${key}/${field}`, v);
      (canonical[`clock@${key}`] ||= []).push({ field, ...v });
    }
    if (variants.length > 1 && variants.some((v) => !v.when)) {
      throw new Error(
        `规则 ${source} ${key}/${field}: 一格有多条变体时，每条都必须写 when —— ` +
        `否则无法判断哪天用哪条`,
      );
    }
  };

  // 字段为主键
  for (const [field, cfg] of Object.entries(fields)) {
    for (const [hm, spec] of Object.entries((cfg || {}).RULES || {})) {
      put(hm, field, spec, `FIELDS.${field}.RULES`);
    }
  }
  // 时刻为主键
  for (const [hm, byField] of Object.entries(boundaries || {})) {
    for (const [field, spec] of Object.entries(byField || {})) {
      put(hm, field, spec, "V2.BOUNDARIES");
    }
  }

  for (const list of Object.values(canonical)) list.sort((a, b) => a.field.localeCompare(b.field));
  return canonical;
}

/**
 * 规范形式 → 各字段的编译输入 RULES_AT = { "HH:MM": [规格...] }。
 * 带 RULES_AT 的字段【不再订阅 schedule】，值由规则直接给（ATOMIC-RULES §1）。
 */
export function canonicalToRuleMaps(canonical) {
  const out = {};
  for (const [trigger, list] of Object.entries(canonical || {})) {
    if (!trigger.startsWith("clock@")) continue;           // 非时钟触发因归第④步
    const hm = trigger.slice("clock@".length);
    for (const { field, ...spec } of list) {
      ((out[field] ||= {})[hm] ||= []).push(spec);
    }
  }
  return out;
}

/** 把翻译结果挂到字段配置上（没写 RULES 的字段原样不动，继续走订阅路径）。 */
export function applyCanonical(fieldsConfig, canonical) {
  const maps = canonicalToRuleMaps(canonical);
  const out = {};
  for (const [name, cfg] of Object.entries(fieldsConfig || {})) {
    out[name] = maps[name] ? { ...cfg, RULES_AT: maps[name] } : cfg;
  }
  return out;
}

/** 反向渲染: 规范形式 → 时刻为主键视图（供 /v2/schema 与将来的 Pages 前端）。 */
export function toTimeMajor(canonical) {
  const out = {};
  for (const [trigger, list] of Object.entries(canonical || {})) {
    const hm = trigger.startsWith("clock@") ? trigger.slice("clock@".length) : trigger;
    for (const { field, ...spec } of list) (out[hm] ||= {})[field] = spec;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** 反向渲染: 规范形式 → 字段为主键视图。 */
export function toFieldMajor(canonical) {
  const out = {};
  for (const [trigger, list] of Object.entries(canonical || {})) {
    const hm = trigger.startsWith("clock@") ? trigger.slice("clock@".length) : trigger;
    for (const { field, ...spec } of list) (out[field] ||= {})[hm] = spec;
  }
  for (const field of Object.keys(out)) {
    out[field] = Object.fromEntries(Object.entries(out[field]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

/**
 * 审计: RULES 里 at.from 引用的规则名必须真实存在。
 * 打字错的后果是【静默回落到 fallback】—— 出差日照旧 07:40 解除，跟没配一样，
 * 而且一个字都不报。这正是本项目最恨的那类失败。
 */
export function auditRuleRefs(fieldsConfig, availablePlugins, trace) {
  if (!trace) return;
  const known = new Set(availablePlugins || []);
  for (const [field, cfg] of Object.entries(fieldsConfig || {})) {
    for (const [key, variants] of Object.entries((cfg || {}).RULES_AT || {})) {
      for (const v of variants) {
        const from = v && v.at && typeof v.at === "object" ? v.at.from : null;
        if (from && !known.has(from)) {
          trace.push({ level: "warn", plugin: "audit", ref: "unknown_rule_ref",
            msg: `字段 "${field}" 的规则 ${key} 引用了不存在的规则 "${from}" —— ` +
                 `时刻永远算不出来，会静默回落到 fallback（${v.at.fallback || "无 fallback → 该边界直接消失"}）。` +
                 `可用的规则: ${[...known].sort().join(", ")}` });
        }
      }
    }
  }
}

/**
 * 派生「手机上需要建哪些自动化」。
 * 这份清单以前只散在 PHONE.md 正文里，加一个边界就可能漏建一条自动化，
 * 而漏建的表现是那一刻【什么都不发生】，没有任何报错。现在从规则自动算出来。
 *
 * @param timelines 各字段的编译产物（要它才能看见算出来的动态时刻）
 */
export function deriveAutomations(timelines, whitelist, push = {}) {
  const allow = new Set(whitelist || []);
  const byTime = new Map();                              // HH:MM → Set(字段)
  for (const [field, segs] of Object.entries(timelines || {})) {
    for (const seg of segs || []) {
      const hm = String(seg.from).slice(11, 16);
      if (!hm || hm === "00:00") continue;
      if (!byTime.has(hm)) byTime.set(hm, new Set());
      byTime.get(hm).add(field);
    }
  }
  const timeOfDay = [];
  const viaDoorbell = [];
  for (const hm of [...byTime.keys()].sort()) {
    const fields = [...byTime.get(hm)].sort();
    (allow.has(hm) ? timeOfDay : viaDoorbell).push({ at: hm, fields });
  }
  // 白名单里但当前范围内没有边界的时刻: 自动化仍要建（别的日型会用到）
  for (const hm of [...allow].sort()) {
    if (!byTime.has(hm)) timeOfDay.push({ at: hm, fields: [], note: "本范围内无边界，其它日型会用到" });
  }
  timeOfDay.sort((a, b) => a.at.localeCompare(b.at));

  return {
    time_of_day: {
      count: timeOfDay.length,
      how: "快捷指令 → 自动化 → 个人自动化 → 时间 → 每天，关掉「运行前询问」→ 运行 SyncAll，" +
           "输入字典 { mode: point, now: <该时刻> }",
      items: timeOfDay,
    },
    notification: {
      count: push.ENABLED === false ? 0 : 1,
      how: `自动化 → App → 收到通知 → 标题包含「${push.KEYWORD || "|SYNCALL|"}」→ 运行 SyncAll，` +
           "关掉「运行前询问」。关键词两侧的竖线不能省 —— contains 是子串匹配",
      items: push.ENABLED === false
        ? [{ warn: "PUSH.ENABLED=false，下面这些时刻将永远送不出去", blocked: viaDoorbell }]
        : [{ contains: push.KEYWORD || "|SYNCALL|", covers: viaDoorbell }],
    },
    via_doorbell: viaDoorbell,
    summary: `${timeOfDay.length} 条时间自动化 + ${push.ENABLED === false ? 0 : 1} 条通知自动化；` +
             `其中 ${viaDoorbell.length} 个时刻靠门铃送达（多为算出来的动态时刻）`,
  };
}
