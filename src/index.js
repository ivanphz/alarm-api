// ─────────────────────────────────────────────────────────────────────────────
// index.js — V12 双轨入口（步骤③）
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ 入库前置操作（GitHub 网页一次 rename）:
//    旧 src/index.js → src/edge/v1-legacy.js（内容零改动，V11 全逻辑冻结在内，
//    其自带鉴权/参数/trace 原样生效）。然后本文件放到 src/index.js。
//
// 路由:
//   /v1/*  → 冻结适配层（剥掉 /v1 前缀转交 legacy，老快捷指令零感知）
//   /v2/state /v2/timeline → 新内核（KERNEL v0.3 全契约生效）
//   其余（含根路径）→ 由 config.user.js 的 V2.DEFAULT 手控:
//       false(缺省) = 走 legacy（现有手机流程不受任何影响）
//       true        = 走 /v2/state（全部迁移后翻转，v1 择日下线）
// ─────────────────────────────────────────────────────────────────────────────
import legacy from "./edge/v1-legacy.js";
import { handleV2, handleFact, v2Config } from "./edge/router.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/v2/state" || path === "/v2/timeline") {
      return handleV2(request, env, path.slice(3));
    }
    if (path === "/v2/fact" || path === "/v2/facts") {
      return handleFact(request, env);
    }

    if (path === "/v1" || path.startsWith("/v1/")) {
      const stripped = new URL(request.url);
      stripped.pathname = path.slice(3) || "/";
      return legacy.fetch(new Request(stripped, request), env, ctx);
    }

    if (v2Config().DEFAULT === true) {
      return handleV2(request, env, "/state");
    }
    return legacy.fetch(request, env, ctx);
  },
};
