// test/kernel/feeds.test.js — 插件自声明 feeds（契约破口修复；验收九条 #3 的兑现）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schedulesFeeding, feedsOf, FEEDS_DEFAULT } from "../../src/kernel/registry.js";
import { auditFieldSubscriptions } from "../../src/kernel/audit.js";
import { buildPlugins, v2Config } from "../../src/edge/router.js";

const PLUGINS = buildPlugins(v2Config());

test("feeds 归一化: 缺省=fields; 字符串/数组皆可", () => {
  assert.deepEqual(feedsOf({ name: "x" }), ["fields"]);            // 默认（刻意: 忘声明会被查出）
  assert.equal(FEEDS_DEFAULT, "fields");
  assert.deepEqual(feedsOf({ feeds: "alarms" }), ["alarms"]);
  assert.deepEqual(feedsOf({ feeds: ["alarms", "todos"] }), ["alarms", "todos"]);  // 将来可喂两处
});

test("闹钟名单从插件自声明导出，与旧硬编码名单等价", () => {
  const derived = schedulesFeeding(PLUGINS, "alarms");
  // 旧的 edge/assemble.js 里写死的就是这三个 —— 现在由插件自己说了算
  // 出厂配置里 ai_claude 是关闭的 → 整体不生成插件，故不出现在闹钟名单里
  assert.deepEqual(derived.sort(), ["wake_alarms", "weekend_class"]);
  assert.deepEqual(schedulesFeeding(PLUGINS, "todos"), []);        // 尚无 todo 插件
  assert.ok(schedulesFeeding(PLUGINS, "plugins").includes("restdays"));  // 事实类
});

test("孤儿检查: 只查声明喂字段的; 喂闹钟/插件的不算孤儿", () => {
  const plugins = [
    { name: "quiet" },                                    // 默认 fields
    { name: "lonely" },                                   // 默认 fields，但无人订阅 → 孤儿
    { name: "wake_alarms", feeds: "alarms" },             // 喂闹钟，无字段订阅属正常
    { name: "restdays", feeds: "plugins" },               // 喂插件，同上
  ];
  const schedules = { quiet: [], lonely: [], wake_alarms: [], restdays: [] };
  const trace = [];
  auditFieldSubscriptions({ silent: { USE: "quiet" } }, schedules, trace, plugins);

  const orphans = trace.filter((x) => x.ref === "orphan_schedule").map((x) => x.msg);
  assert.equal(orphans.length, 1);
  assert.ok(orphans[0].includes("lonely"));
  for (const n of ["wake_alarms", "restdays"]) {
    assert.ok(!orphans.some((m) => m.includes(`"${n}"`)), `${n} 不应被误报孤儿`);
  }
});

test("feeds 拼错必须响亮告警（静默豁免是最坏结果）", () => {
  const trace = [];
  // "field" 少个 s: 既不会被孤儿检查覆盖，也不会进任何消费方 → 插件静默失踪
  auditFieldSubscriptions({}, { typo: [] }, trace, [{ name: "typo", feeds: "field" }]);
  assert.ok(trace.some((x) => x.ref === "unknown_feeds" && x.msg.includes("field")));
});

test("未登记的 schedule 按默认 fields 处理（不静默放过）", () => {
  const trace = [];
  auditFieldSubscriptions({}, { ghost: [] }, trace, []);      // plugins 里没有 ghost
  assert.ok(trace.some((x) => x.ref === "orphan_schedule" && x.msg.includes("ghost")));
});

test("契约: kernel/ 与 edge/assemble 不得再出现任何插件名硬编码", () => {
  // 这是本次修复的【实质】——验收九条 #3「新插件 = 内核零改动」由此才真正成立。
  // 若有人日后又往内核塞名单，本用例会立刻失败。
  const names = PLUGINS.map((p) => p.name);
  const guarded = [
    "src/kernel/audit.js", "src/kernel/registry.js",
    "src/kernel/intervals.js", "src/kernel/fields.js",
    "src/edge/assemble.js",
  ];
  for (const file of guarded) {
    const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    // 去掉注释行后再查（注释里提历史名单是允许的，代码里不行）
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const n of names) {
      assert.ok(!code.includes(`"${n}"`),
        `${file} 出现插件名硬编码 "${n}" —— 应改为插件自声明 feeds`);
    }
  }
});
