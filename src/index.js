// ─────────────────────────────────────────────────────────────────────────────
// index.js — 入口（v1 已下线，v2 为唯一路径）
// ─────────────────────────────────────────────────────────────────────────────
// 2026-07-26 收口: 删除 /v1 冻结轨道与 v1-legacy.js / rules.js / rest-days.js /
//   device-state.js / school-break.js（根目录那份）。ics-parser.js 仍被 v2 复用，保留。
// 路由:
//   /v2/state    采样（?mode=segment|point）
//   /v2/timeline 全时间线预览/审计（debug 常开）
//   /v2/fact     写事实（POST） · /v2/facts 调试列取
//   其余（含根路径）→ 一律走 /v2/state（旧的 V2.DEFAULT 开关随 v1 一起退休）
// ─────────────────────────────────────────────────────────────────────────────
import { handleV2, handleFact } from "./edge/router.js";

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;

    if (path === "/v2/fact" || path === "/v2/facts") return handleFact(request, env);
    if (path === "/v2/timeline") return handleV2(request, env, "/timeline");
    return handleV2(request, env, "/state");     // /v2/state 与根路径等一切其它路径
  },
};
