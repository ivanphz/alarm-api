// ─────────────────────────────────────────────────────────────────────────────
// edge/i18n.js — 本地化名下发（契约13 的云端半场；显示层，永不参与比较）
// ─────────────────────────────────────────────────────────────────────────────
// 铁律: token 是唯一权威值; 本表只服务"执行器守卫的文本反查"与将来 UI 显示。
// 数据即扩展: 加语言/加自定义 Focus = 本表加行, 零代码零手机改动。
// P2 实测表(2026-07-16 冻结)为种子; key 为系统语言下的 Focus 显示名原文。
// ─────────────────────────────────────────────────────────────────────────────
export const FOCUS_NAMES = {
  en: {
    "Do Not Disturb": "do_not_disturb", "Sleep": "sleep", "Personal": "personal",
    "Work": "work", "Driving": "driving", "Reduce Interruptions": "reduce_interruptions",
  },
  zh: {
    "勿扰模式": "do_not_disturb", "睡眠": "sleep", "个人": "personal",
    "工作": "work", "驾驶": "driving", "减少干扰": "reduce_interruptions",
  },
  // 占位: 换系统语言前, 用该语言在手机上读一次各 Focus 名填入即可（云端加数据, 手机零改）
  ja: {
    "おやすみモード": "do_not_disturb", "睡眠": "sleep", "パーソナル": "personal",
    "仕事": "work", "運転中": "driving", "集中モード": "reduce_interruptions",
  },
  ko: {
    "방해 금지": "do_not_disturb", "수면": "sleep", "개인": "personal",
    "업무": "work", "운전 중": "driving", "방해 줄이기": "reduce_interruptions",
  },
};

/**
 * ?locales=zh,en → 两张表:
 *   name_to_token { 本机名: token }  —— 守卫段: Get Current Focus 文本 → token
 *   token_to_name { token: [本机名候选...] } —— 执行段: 逐个试开验证，成功即止(穷举兜底)
 * 多语言合并时同一 token 可能多名; token_to_name 取"首个出现的语言"为准
 * (locales 顺序即优先级, 如 zh,en 则中文名优先——应与手机系统语言一致)。
 * 未知语言忽略; 空/非法 → null(信封省略 i18n 节)。
 */
export function buildFocusNameMaps(localesParam) {
  if (!localesParam) return null;
  const name_to_token = {};
  const token_to_name = {};                            // token → 候选名【数组】(按 locales 优先级)
  let hit = false;
  for (const loc of String(localesParam).toLowerCase().split(",")) {
    const key = loc.trim().split("-")[0];              // zh-CN → zh
    const tbl = FOCUS_NAMES[key];
    if (!tbl) continue;
    hit = true;
    for (const [name, token] of Object.entries(tbl)) {
      name_to_token[name] = token;                     // 守卫: 任意语言名都能反查 token
      (token_to_name[token] ||= []);
      if (!token_to_name[token].includes(name)) token_to_name[token].push(name);  // 穷举兜底
    }
  }
  return hit ? { name_to_token, token_to_name } : null;
}
