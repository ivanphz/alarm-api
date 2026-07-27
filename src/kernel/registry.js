// ─────────────────────────────────────────────────────────────────────────────
// kernel/registry.js — 最小内核运行器（V12 步骤②）
// ─────────────────────────────────────────────────────────────────────────────
// 职责（KERNEL §4 内核职责，且仅此）:
//   拓扑排序(deps) → 逐个 produce → 校验 → 归一化 → 发布 → 双模采样接线
// 故障隔离（契约9）:
//   produce 抛错 / 产物非法 → 该 schedule 发布为 []（全程无主张）+ trace 大字报；
//   required 依赖失败 → 下游跳过（同样发布 []）。宁可不动手机，不可胡动。
// trace 结构化（KERNEL §13）: { level, plugin, ref, msg }
// 注意: 发布给依赖方的是【未裁剪】的归一化产物（插件可越界产出邻日）；
//       裁剪到 range 属于输出组装（edge/assemble，步骤③）。
// ─────────────────────────────────────────────────────────────────────────────
import { validate, normalize, sampleSegment, samplePoint } from "./intervals.js";

// ─────────────────────────────────────────────────────────────────────────────
// 注册表查询: 插件自声明 feeds = "我的产物被谁消费"
// ─────────────────────────────────────────────────────────────────────────────
// 开放枚举（同 kind/scope/channel，KERNEL §18）:
//   "fields"  被字段订阅消费（默认）    "alarms"  被闹钟组装消费
//   "todos"   被 todo 组装消费（待建）   "plugins" 仅被其它插件经 deps 消费（事实类）
// 可以是字符串或数组（一个 schedule 将来可能同时喂两处）。
//
// ⭐ 为什么要有这个（契约破口修复）: 此前 kernel/audit.js 与 edge/assemble.js 各写了一张
//    【硬编码插件名单】。后果是「新增非字段订阅型插件必须去改 kernel/」——
//    直接违反验收九条 #3「新命名规则 = 新插件文件、内核零改动」。
//    改为自声明后，内核与 edge 都不再认识任何插件名，加插件真正做到内核零改动。
//
// ⚠️ 默认值选 "fields" 是【刻意】的: 忘记声明 → 落进孤儿检查 → 响亮告警提示补声明；
//    而不是静默豁免（静默豁免会让一个谁都不消费的插件永远躺在那没人发现）。
export const FEEDS_DEFAULT = "fields";
export const FEEDS_KNOWN = new Set(["fields", "alarms", "todos", "plugins"]);

export function feedsOf(plugin) {
  const f = (plugin && plugin.feeds) ?? FEEDS_DEFAULT;
  return Array.isArray(f) ? f : [f];
}

/** 产出被 target 消费的 schedule 名单（取代一切硬编码名单） */
export function schedulesFeeding(plugins, target) {
  return (plugins || []).filter((p) => feedsOf(p).includes(target)).map((p) => p.name);
}

export function buildTimeline({ plugins, ctx, range }) {
  const trace = [];
  const T = (level, plugin, ref, msg) => trace.push({ level, plugin, ref, msg });

  // ── 拓扑排序（Kahn）──
  const byName = new Map(plugins.map((p) => [p.name, p]));
  const indeg = new Map(plugins.map((p) => [p.name, 0]));
  const rdeps = new Map();                                  // dep → [下游...]
  for (const p of plugins) {
    for (const d of p.deps || []) {
      if (!byName.has(d.name)) continue;                    // 未注册依赖在执行期按失败处理
      indeg.set(p.name, indeg.get(p.name) + 1);
      if (!rdeps.has(d.name)) rdeps.set(d.name, []);
      rdeps.get(d.name).push(p.name);
    }
  }
  const queue = plugins.filter((p) => indeg.get(p.name) === 0).map((p) => p.name);
  const ordered = [];
  while (queue.length) {
    const n = queue.shift();
    ordered.push(n);
    for (const dn of rdeps.get(n) || []) {
      indeg.set(dn, indeg.get(dn) - 1);
      if (indeg.get(dn) === 0) queue.push(dn);
    }
  }
  const cyclic = plugins.map((p) => p.name).filter((n) => !ordered.includes(n));
  for (const n of cyclic) T("error", n, "dependency_cycle", "依赖成环，整环无主张");

  // ── 逐个生产 ──
  const schedules = {};
  const failed = new Set(cyclic);

  for (const name of ordered) {
    const p = byName.get(name);
    const bad = (p.deps || []).filter(
      (d) => d.required && (failed.has(d.name) || !(d.name in schedules)),
    );
    if (bad.length) {
      failed.add(name);
      schedules[name] = [];
      T("warn", name, "dependency_failed",
        `required 依赖不可用: ${bad.map((d) => d.name).join(",")} → 跳过（无主张）`);
      continue;
    }
    let product;
    try {
      product = p.produce({ ...ctx, schedules }, range);
      // 诊断通道: 插件可返回 { segments, notes } —— notes 是数据, 纯度不破（契约7/9）
      if (product && !Array.isArray(product) && Array.isArray(product.segments)) {
        for (const n of product.notes || []) {
          T(n.level || "warn", name, n.ref || "note", n.msg || "");
        }
        product = product.segments;
      }
    } catch (e) {
      failed.add(name);
      schedules[name] = [];
      T("error", name, "produce_throw", String(e && e.message || e));
      continue;
    }
    const v = validate(product);
    if (!v.ok) {
      failed.add(name);
      schedules[name] = [];
      T("error", name, "invalid_product", JSON.stringify(v.errors.slice(0, 5)));
      continue;
    }
    schedules[name] = normalize(product);
    T("info", name, "published", `${schedules[name].length} 段`);
  }

  return { schedules, trace, failed: [...failed] };
}

// ── 双模采样接线（point/segment 是同一份数据的两种问法，KERNEL §6）──
export function sampleTimeline(schedules, at, options = {}) {
  const { mode = "segment", pastMinutes, futureMinutes } = options;
  const out = {};
  for (const [name, segments] of Object.entries(schedules)) {
    out[name] = mode === "point"
      ? samplePoint(segments, at, { pastMinutes, futureMinutes })
      : sampleSegment(segments, at);
  }
  return out;
}
