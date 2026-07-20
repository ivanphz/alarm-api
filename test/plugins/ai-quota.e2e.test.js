// ─────────────────────────────────────────────────────────────────────────────
// test/plugins/ai-quota.e2e.test.js — 步骤⑤: 事实流 → 配额 level → 字段/提醒派生
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import { handleV2, handleFact } from "../../src/edge/router.js";
import { addDays } from "../../src/kernel/intervals.js";

const AIQ = { ENABLED: true, STREAM: "ai_claude", COOLDOWN_MINUTES: 300,
              WEEKLY_RESET: { day: 1, time: "08:00" }, REMINDER: true };

function loaders(factEvents, extra = {}) {
  return {
    async loadWorkdays() {
      const out = [];
      for (let d = "2026-06-29"; d <= "2026-08-02"; d = addDays(d, 1)) {
        const w = new Date(d + "T00:00:00Z").getUTCDay();
        out.push({ date: d, off: w === 0 || w === 6, name: "" });
      }
      return out;
    },
    async loadCalendars() { return []; },
    async loadExternalAlarms() { return []; },
    async loadFacts() { return { streams: { ai_claude: factEvents }, degraded: [] }; },
    ...extra,
  };
}
// 经 config.user.js 无法在测试改 V2 → 用注入: handleV2 读 CONFIG.V2, 我们借 user 配置的
// 深合并路径不可行, 改走 loaders + 环境: 直接篡改 CONFIG.V2（测试专用, 单进程安全）
import { CONFIG } from "../../src/config.js";
CONFIG.V2 = { AI_QUOTA: AIQ };

const call = async (qs, ld) => {
  const res = await handleV2(new Request(`https://x.dev/v2/state?${qs}`), {}, "/state", ld);
  return res.json();
};

test("done 事件: 冷却窗内 false, 5小时后恢复 true + GateDyn-CAD 提醒", async () => {
  const ld = loaders([{ at: "2026-07-15 09:00", id: "u1", type: "done" }]);
  const mid = await call("date=2026-07-15&now=11:00", ld);
  assert.equal(mid.fields["cadence.ai_claude"].value, false);
  const after = await call("date=2026-07-15&now=14:01", ld);
  assert.equal(after.fields["cadence.ai_claude"].value, true);
  assert.equal(after.fields["cadence.ai_claude"].from, "2026-07-15 14:00");   // 09:00+300min
  // 提醒闹钟: 恢复时刻在窗口内（now=11:00 → 窗口含 14:00）
  const dyn = mid.alarms.dynamic.filter((a) => a.label.startsWith("GateDyn-CAD"));
  assert.deepEqual(dyn, [{ label: "GateDyn-CAD-ai_claude-1400", at: "2026-07-15 14:00",
                           reason: "AI额度恢复(ai_claude)" }]);
});

test("重叠 done 合并 + 周一 08:00 周重置截断冷却", async () => {
  const ld = loaders([
    { at: "2026-07-15 09:00", id: "a", type: "done" },
    { at: "2026-07-15 11:00", id: "b", type: "done" },      // 与上重叠 → 合并到 16:00
    { at: "2026-07-20 06:30", id: "c", type: "done" },      // 周一(7-20)06:30 → 08:00 被周重置截断
  ]);
  const merged = await call("date=2026-07-15&now=15:30", ld);
  assert.equal(merged.fields["cadence.ai_claude"].value, false);            // 14:00 已被 b 延到 16:00
  const monday = await call("date=2026-07-20&now=08:01", ld);
  assert.equal(monday.fields["cadence.ai_claude"].value, true);
  assert.equal(monday.fields["cadence.ai_claude"].from, "2026-07-20 08:00"); // 周重置而非 11:30
});

test("纠偏事实: reset 立即恢复；set_next 手动指定", async () => {
  const ld = loaders([
    { at: "2026-07-15 09:00", id: "a", type: "done" },
    { at: "2026-07-15 10:00", id: "r", type: "reset" },
    { at: "2026-07-15 12:00", id: "m", type: "set_next", payload: { at: "2026-07-15 18:30" } },
  ]);
  const b = await call("date=2026-07-15&now=10:30", ld);
  assert.equal(b.fields["cadence.ai_claude"].value, true);                   // reset 截断
  const c = await call("date=2026-07-15&now=17:00", ld);
  assert.equal(c.fields["cadence.ai_claude"].value, false);                  // set_next 阻塞中
  const d = await call("date=2026-07-15&now=18:31", ld);
  assert.equal(d.fields["cadence.ai_claude"].value, true);
});

test("事实源降级 → ai_available 无主张(null)，其余字段不受影响", async () => {
  const ld = loaders([], { async loadFacts() { return { streams: {}, degraded: ["ai_claude"] }; } });
  const b = await call("date=2026-07-15&now=11:00", ld);
  assert.equal(b.fields["cadence.ai_claude"].value, null);
  assert.equal(typeof b.fields.silent.value, "string");
});

test("/v2/fact: 写入、幂等去重、校验、GET 列取（假 KV）", async () => {
  const store = new Map();
  const env = { FACTS_KV: {
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
  } };
  const post = (body) => handleFact(new Request("https://x.dev/v2/fact", {
    method: "POST", body: JSON.stringify(body) }), env);

  let r = await (await post({ stream: "ai_claude", at: "2026-07-15 09:00", id: "u1" })).json();
  assert.deepEqual({ ok: r.ok, deduped: r.deduped, count: r.count }, { ok: true, deduped: false, count: 1 });
  assert.equal(r.colo, null);                                        // 测试环境无 cf 对象
  r = await (await post({ stream: "ai_claude", at: "2026-07-15 09:00", id: "u1" })).json();
  assert.equal(r.deduped, true);                                     // 快捷指令重试不重复计数
  assert.equal(r.count, 1);
  r = await (await post({ stream: "AI!!", at: "2026-07-15 09:00", id: "x" })).json();
  assert.equal(r.error, "bad_stream");
  r = await (await post({ stream: "ai_claude", at: "9点", id: "x" })).json();
  assert.equal(r.error, "bad_at");
  r = await (await post({ stream: "ai_claude", at: "2026-07-15 12:00", id: "m",
                          type: "set_next", payload: {} })).json();
  assert.equal(r.error, "bad_payload");
  const g = await (await handleFact(new Request(
    "https://x.dev/v2/facts?stream=ai_claude"), env)).json();
  assert.equal(g.events.length, 1);
  assert.ok("received_at" in g.events[0]);                           // 服务端观测字段已附加
  assert.equal(store.has("fact:default:ai_claude"), true);           // 契约11 命名空间
});

test("KV 未绑定: /v2/fact 明确报缺 + 采样端优雅降级", async () => {
  const r = await (await handleFact(new Request("https://x.dev/v2/fact",
    { method: "POST", body: "{}" }), {})).json();
  assert.equal(r.error, "facts_storage_missing");
});
