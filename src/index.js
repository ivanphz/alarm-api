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
import { handleV2, handleFact, handleSweep, handleSweepPlan, authorize } from "./edge/router.js";

export default {
  async fetch(request, env, ctx) {
    let path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (path.startsWith("/v2/")) path = path.slice(3);      // 剥可选前缀 → /state | /timeline | ...
    else if (path === "/v2") path = "/";

    if (path === "/fact" || path === "/facts") return handleFact(request, env);
    if (path === "/timeline") return handleV2(request, env, "/timeline");
    if (path === "/schema") return handleV2(request, env, "/schema");      // 规则规范形式 + 两种视图
    // ── 门铃：双端 ────────────────────────────────────────────────────────
    //   /sweep/plan  未来一段时间的门铃时刻表 → 你的服务器拉去做秒级调度
    //   /sweep?at=X  为某一刻按门铃（服务器到点调用；不带 at 则用滞后窗口）
    if (path === "/sweep/plan") return handleSweepPlan(request, env);
    if (path === "/sweep") {
      const url = new URL(request.url);
      if (!authorize(request, url, env)) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      const at = url.searchParams.get("at");
      // 服务器精确触发: 窗口收成 (at-1分钟, at]，只捡这一刻的边界，不误伤邻近的
      const opts = at
        ? { fromTs: at.slice(0, 16), toTs: at.slice(0, 16), lagMinutes: 0, exact: true }
        : { lagMinutes: Number(url.searchParams.get("lag") || 0) };
      return handleSweep(env, undefined, url.searchParams.get("now") || null, opts);
    }
    return handleV2(request, env, "/state");
  },

  // ── cron 触发器（wrangler.toml [triggers]）────────────────────────────────
  //   服务端唯一的主动动作。平时 Worker 只被动响应请求，主动性全靠这里。
  //   每轮扫「上一个扫描窗口内、没有刺客覆盖的边界」→ 有就按一次门铃。
  //   典型对象: 有界电平的窗口终点、出差日按日历算出的动态解除时刻。
  //   ⚠️ cron 是【兜底】不是主力: 它最细只到分钟，且窗口 SWEEP_MINUTES 意味着最坏
  //      晚那么多分钟。主力是你自己的服务器（拉 /sweep/plan 做秒级调度）。
  //      LAG_MINUTES 让 cron 滞后一个安全期再扫 —— 服务器正常时它扫到的永远是空。
  //   两件事: ①兜底扫描漏掉的门铃 ②把最新计划【主动推】给你的服务器
  //      —— 服务器只接收、从不轮询，本地起秒级定时器，到点调 /sweep?at=<时刻>。
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleSweep(env, undefined, null, { withPlan: true }));
  },
};
