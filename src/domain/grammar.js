// ─────────────────────────────────────────────────────────────────────────────
// domain/grammar.js — 日历标题词法（V12 步骤②）
// ─────────────────────────────────────────────────────────────────────────────
// 包形纪律: 零依赖，不 import CONFIG。用户词表由插件经 vocabularyFromConfig 注入。
// 判定法则（沿袭 V11 实测语义，一字未改）:
//   ① 标题(归一化后)恰好等于关键字 —— 如 "年假"、"　休假　"(全角空格)
//   ② 关键字被一对完全配对的同种括号包裹 —— 如 "[年假]" "【年假】" "（休假）"
// 反例安全: "讨论年假政策"、"陪孩子请假去医院" 不命中。
// 契约: 解析不出 = null = 无主张，不猜（KERNEL §0 grammar 行 + 契约9 精神）。
// ─────────────────────────────────────────────────────────────────────────────

const BRACKET_PAIRS = {
  "[": "]", "(": ")", "{": "}",
  "【": "】", "（": "）", "「": "」", "『": "』", "〔": "〕", "《": "》",
};

// 词汇表默认值（token 键名遵循命名法: snake_case 全称）
export const DEFAULT_VOCABULARY = {
  god_mode:   ["上帝模式", "JSON"],
  leave:      ["休假", "请假", "年假"],
  work_event: ["出差", "会议", "外勤", "风勘", "覆盖", "晚到", "早到", "早起"],
};

// 从现行 config（KEYWORDS 大写键）构造词表 —— config 键名不属于 API，维持原状
export function vocabularyFromConfig(cfg) {
  const k = (cfg && cfg.KEYWORDS) || {};
  return {
    god_mode:   k.GOD_MODE   || DEFAULT_VOCABULARY.god_mode,
    leave:      k.LEAVE      || DEFAULT_VOCABULARY.leave,
    work_event: k.WORK_EVENT || DEFAULT_VOCABULARY.work_event,
  };
}

function normalizeTitle(s) {
  return String(s || "").replace(/[\u3000\u00A0]/g, " ").trim();
}

export function matchGroup(title, group, vocab = DEFAULT_VOCABULARY) {
  const t = normalizeTitle(title);
  if (!t) return false;
  return (vocab[group] || []).some((kw) => {
    if (t === kw) return true;
    for (const [open, close] of Object.entries(BRACKET_PAIRS)) {
      if (t.includes(`${open}${kw}${close}`)) return true;
    }
    return false;
  });
}

// 分类。同题多词命中时的裁决优先级: god_mode > leave > work_event
export function classify(title, vocab = DEFAULT_VOCABULARY) {
  for (const g of ["god_mode", "leave", "work_event"]) {
    if (matchGroup(title, g, vocab)) return g;
  }
  return null;
}
