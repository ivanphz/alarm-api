// ─────────────────────────────────────────────────────────────────────────────
// edge/push.js — 门铃（原子化第④步，ATOMIC-RULES §3）
// ─────────────────────────────────────────────────────────────────────────────
// 服务端唯一能【主动发起】的入口。Cloudflare Worker 平时只被动响应请求，
// 所以主动性来自 cron 触发器（wrangler.toml [triggers]）→ 本模块 → Bark → 手机
// 的「收到通知」自动化 → 跑 SyncAll → GET 拿权威状态。
//
// ── 三条纪律（CHANNELS.md §5，实测背书）────────────────────────────────────
//   1. 门铃一律 active 档 —— 呈现被 DND 拦、触发照跑（台账 B1）。
//      零打扰是它能用在夜里/清晨的前提；critical 只留给必须叫醒人的事。
//   2. 门铃不是信件 —— 通知内容只做【路由】，永不作为指令内容。
//      被触发的指令一律带 key 去 GET 拿权威状态。泄露 Bark key 最坏 = 骚扰门铃。
//   3. 关键词带分隔符 —— iOS 通知触发的过滤是 contains（子串匹配，铁则5）。
//      写 |SYNCALL| 而不是 SYNCALL，否则将来加 SYNC 会互相命中。
//
// ── 它解决什么 ─────────────────────────────────────────────────────────────
//   有些边界【没有任何刺客覆盖】: 有界电平的窗口终点、出差日按日历算出的动态解除
//   时刻。这些边界生成了也送不出去 —— 2026-07-28 出差死锁就是这么来的。
//   门铃扫描把它们捡起来，按时推一条 active，手机自己来取。
// ─────────────────────────────────────────────────────────────────────────────

/** (from, to] 内、没有时钟刺客覆盖的边界 → 需要门铃 */
export function pickDoorbells(timelines, whitelist, fromTs, toTs) {
  const allow = new Set(whitelist || []);
  const exact = fromTs === toTs;                        // 服务器精确触发: 只捡这一刻
  const out = [];
  for (const [field, segs] of Object.entries(timelines || {})) {
    for (const seg of segs || []) {
      const inWindow = exact ? seg.from === toTs : (seg.from > fromTs && seg.from <= toTs);
      if (!inWindow) continue;
      const hm = String(seg.from).slice(11, 16);
      if (hm === "00:00") continue;                       // 窗口锚定产生的伪边界，不是真指令
      if (allow.has(hm)) continue;                        // 已有刺客覆盖 → 手机自己会醒
      out.push({ field, at: seg.from, hm, released: seg.value === null });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Bark 驱动。driver 可换: 只要实现 send({title, body, level, group}) → Response */
export function barkDriver({ baseUrl, key, group }) {
  return async function send({ title, body, level }) {
    const u = new URL(`${String(baseUrl).replace(/\/+$/, "")}/${key}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`);
    u.searchParams.set("level", level);                   // active = 零打扰仍触发
    if (group) u.searchParams.set("group", group);
    u.searchParams.set("isArchive", "0");                 // 门铃不入档，省得刷屏
    return fetch(u.toString(), { method: "GET" });
  };
}

/**
 * 门铃扫描: 找出本轮该按的门铃并推送。
 * @param cfg   CONFIG.PUSH
 * @param deps  { timelines, whitelist, fromTs, toTs, send, trace }
 * @returns { pushed: [...], skipped: 原因 }
 */
export async function sweepDoorbells(cfg, { timelines, whitelist, fromTs, toTs, send, trace }) {
  const push = cfg || {};
  if (push.ENABLED === false) return { pushed: [], skipped: "PUSH.ENABLED=false" };
  if (!send) return { pushed: [], skipped: "未配置推送驱动（缺 BARK_KEY?）" };

  const due = pickDoorbells(timelines, whitelist, fromTs, toTs);
  if (!due.length) return { pushed: [], skipped: null };

  // 一次扫描只按一次门铃 —— 门铃不携带内容，按几次手机都是同一个动作（去 GET）。
  // 多按只会浪费一次唤醒，还可能撞上"单槽忙丢"把别的触发挤掉（台账 B3/B4）。
  const fields = [...new Set(due.map((d) => d.field))].join(",");
  const keyword = push.KEYWORD || "|SYNCALL|";
  try {
    await send({
      title: keyword,                                     // ← 手机端通知自动化按这个 contains 过滤
      body: `${due[0].at} ${fields}`,                     // 只是给人看的线索，手机不解析
      level: push.LEVEL || "active",
    });
    trace && trace.push({ level: "info", plugin: "push", ref: "doorbell",
      msg: `门铃已按: ${due.map((d) => `${d.hm}/${d.field}${d.released ? "(释放)" : ""}`).join(" ")}` });
    return { pushed: due, skipped: null };
  } catch (e) {
    trace && trace.push({ level: "warn", plugin: "push", ref: "doorbell_failed",
      msg: `门铃推送失败: ${e && e.message} —— 推是快路径，丢了退回等下一个入口（CHANNELS §4）` });
    return { pushed: [], skipped: String(e && e.message) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 计划推送（Worker → 你的服务器）
// ─────────────────────────────────────────────────────────────────────────────
// 为什么不是"服务器来拉": 拉就是轮询，而且计划会过期 —— 你 15:00 在日历里加了
// 出差，服务器 00:00 拉的表就是错的。
//
// 物理约束（先说清，免得以为还有更好的）: Worker 自己也【没有】主动能力，它只在
// 被请求或 cron 时运行；日历是 ICS，只能拉不能订阅。所以"周期性去看一眼"消不掉，
// 能选的只是谁来看。把它放在 Worker 的 cron 里 —— cron 本来就要跑（兜底扫描），
// 顺手把最新计划推给服务器，于是【你那侧是纯推送，一次轮询都没有】。
//
// 无状态设计: 每轮 cron 推【全量】计划，服务器收到就整体替换自己的定时器集合。
// 不做增量、不存"上次推了什么" —— 幂等，省掉 KV，也不会因为状态漂移而漏推。
// 服务器可用 version 判断内容有没有变，没变就不用重排定时器。
// ─────────────────────────────────────────────────────────────────────────────

/** 计划内容的指纹，供服务器判断"要不要重排定时器" */
export function planVersion(doorbells) {
  const s = (doorbells || []).map((d) => `${d.at}|${d.field}|${d.released ? 1 : 0}`).join(";");
  let h = 2166136261;                                   // FNV-1a，够用且不引依赖
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/**
 * 把门铃计划推给服务器。失败不抛 —— 服务器收不到就退回 Worker cron 兜底。
 * @param cfg  CONFIG.PUSH.PLAN
 * @param deps { doorbells, now, until, key, trace, fetchImpl }
 */
export async function pushPlan(cfg, { doorbells, now, until, key, trace, fetchImpl, watch } = {}) {
  const plan = cfg || {};
  if (!plan.WEBHOOK_URL) return { sent: false, skipped: "未配置 PLAN.WEBHOOK_URL" };
  const body = {
    kind: "doorbell_plan",
    version: planVersion(doorbells),
    now, until,
    doorbells,                                          // [{ at, field, hm, released }]
    // 服务器盯这些 URL 的【内容哈希】，变了就来取新计划。它不解析内容 —— 规则的
    // 解释权仍然只在 Worker，服务器只是一双眼睛。
    watch: watch || [],
    hint: "到点调 GET /sweep?at=<at>&key=<GATEWAY_KEY>；本计划为全量，收到即整体替换。" +
          "watch 里的 URL 内容哈希一变就来 GET /sweep/plan 取新计划",
  };
  try {
    const f = fetchImpl || fetch;
    const res = await f(plan.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "X-Gateway-Key": key } : {}),        // 服务器据此验来源
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`webhook ${res.status}`);
    trace && trace.push({ level: "info", plugin: "push", ref: "plan_pushed",
      msg: `计划已推送: ${doorbells.length} 个门铃时刻, version=${body.version}` });
    return { sent: true, version: body.version, count: doorbells.length };
  } catch (e) {
    trace && trace.push({ level: "warn", plugin: "push", ref: "plan_push_failed",
      msg: `计划推送失败: ${e && e.message} —— 服务器收不到就退回 Worker cron 兜底扫描` });
    return { sent: false, skipped: String(e && e.message) };
  }
}
