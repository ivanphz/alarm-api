// ─────────────────────────────────────────────────────────────────────────────
// index.js — 入口（v1 已下线，v2 为唯一路径）
// ─────────────────────────────────────────────────────────────────────────────
// 路由（★ `/v2` 前缀可选：v1 下线后它已无区分作用，带不带都走同一条路）:
//   /state    或 /v2/state     采样（?mode=segment|point）
//   /timeline 或 /v2/timeline  全时间线预览/审计（debug 常开）
//   /fact     或 /v2/fact      写事实（POST）；/facts 调试列取
//   其余（含根路径）→ /state
//
// ⚠️ 2026-07-27 修的 bug: 原来只认 `/v2/timeline`，裸 `/timeline` 落进兜底返回了
//    state 信封 —— 两个地址显示不同内容且无任何提示。前缀现已统一剥离。
// ─────────────────────────────────────────────────────────────────────────────
import { handleV2, handleFact } from "./edge/router.js";

export default {
  async fetch(request, env, ctx) {
    let path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (path.startsWith("/v2/")) path = path.slice(3);      // 剥可选前缀 → /state | /timeline | ...
    else if (path === "/v2") path = "/";

    if (path === "/fact" || path === "/facts") return handleFact(request, env);
    if (path === "/timeline") return handleV2(request, env, "/timeline");
    return handleV2(request, env, "/state");
  },
};
