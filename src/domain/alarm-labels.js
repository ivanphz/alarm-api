// ─────────────────────────────────────────────────────────────────────────────
// domain/alarm-labels.js — Gate 标签契约唯一构造点（V12 步骤④，KERNEL §12 冻结）
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ 标签焊在每台手机手工预建的闹钟里，改语法 = 全家设备重录。
//    既有格式冻结；演进只许新增前缀族。本文件是全系统唯一的构造入口。
// ─────────────────────────────────────────────────────────────────────────────

/** 外部源识别标签缺省正则: [[ES:uid]] 任意字段；捕获 uid；裸 [[ES]] 回退原生 UID */
export const ES_MARK_DEFAULT = /\[\[ES(?::\s*([^\]]+?))?\s*\]\]/;

/** 外部源: Gate-ES-<源code>-<uid>-<HHMM>（时间是身份的一部分；uid 空 = 无效） */
export function esLabel(code, uid, hhmm) {
  const clean = (s) => String(s == null ? "" : s).trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  const c = clean(code).slice(0, 16) || "src";
  const u = clean(uid).slice(0, 40);
  if (!u) return null;
  const hm = /^(\d{2}):(\d{2})$/.test(hhmm || "") ? hhmm.replace(":", "") : "";
  return hm ? `Gate-ES-${c}-${u}-${hm}` : null;
}

/** 事件动态闹钟: Gate-Dynamic-Event-<HHMM> */
export function eventLabel(cfg, hhmm) {
  return `${cfg.DYNAMIC_LABELS.EVENT}-${hhmm.replace(":", "")}`;
}

/** 上课固定形态: Gate-Fixed-Class-<id> */
export function classFixedLabel(cfg, id) {
  return `${cfg.CLASS_LABELS.FIXED}-${id}`;
}

/** 上课动态形态: Gate-Class-<星期>-<id>-<HHMM> */
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function classDynamicLabel(cfg, dow, id, hhmm) {
  return `${cfg.CLASS_LABELS.DYNAMIC}-${DAY_ABBR[dow]}-${id}-${hhmm.replace(":", "")}`;
}

/** 可开关注册表 = 固定闹钟 + 配了 fixed 锚的课（label→预设时间，窗口裁剪用） */
export function buildToggleRegistry(cfg) {
  return [
    ...cfg.FIXED_ALARMS.map((a) => ({ label: a.label, scheduled_at: a.scheduledAt, kind: "fixed" })),
    ...cfg.WEEKEND_CLASS.SCHEDULE
      .filter((s) => s.fixed && (s.periods || {})[s.fixed])
      .map((s) => ({
        label: classFixedLabel(cfg, s.id),
        scheduled_at: s.periods[s.fixed],
        kind: "class",
      })),
  ];
}

/** AI 配额恢复提醒: Gate-AIQ-<stream>-<HHMM>（V12 步骤⑤新增前缀族，时间入标签幂等对账） */
export function aiqLabel(stream, hhmm) {
  const clean = (s) => String(s == null ? "" : s).trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  const st = clean(stream).slice(0, 24) || "ai";
  const hm = /^(\d{2}):(\d{2})$/.test(hhmm || "") ? hhmm.replace(":", "") : "";
  return hm ? `Gate-AIQ-${st}-${hm}` : null;
}
