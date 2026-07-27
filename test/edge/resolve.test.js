// test/edge/resolve.test.js — 语义 token → 平台标识 解析表（DEVICE-ABSTRACTION §2）
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAppTable, buildResolve, buildFocusTable, LOCKED_TABLE, APPS, GROUPS } from "../../src/edge/resolve.js";

test("两层组合: 原子 token 恒为长度1数组; 类别 token 是成员并集", () => {
  const t = buildAppTable("ios");
  // ① 原子层: 单个 App 也是数组（§2.2 规则1「token→数组恒定」，手机端无单值/数组分支）
  assert.deepEqual(t.apple_maps, ["com.apple.Maps"]);
  assert.ok(Array.isArray(t.amap) && t.amap.length === 1);
  // ② 类别层: 成员的并集，且保持 GROUPS 声明顺序（可预期，便于对拍）
  assert.deepEqual(t.maps,
    ["com.apple.Maps", "com.google.Maps", "com.autonavi.amap", "com.baidu.BaiduMap"]);
  // ③ bundle id 只在原子层写一次 —— 类别里出现的必定来自原子层，无第二处维护点
  for (const id of t.maps) {
    assert.ok(Object.values(APPS.ios).includes(id), `${id} 未登记在原子层 APPS.ios`);
  }
});

test("类别成员在本平台不存在 → 自动跳过（不是缺失，不需占位）", () => {
  // GROUPS.video 声明了 bilibili/iqiyi 等，但原子层尚未实测补入 → 不应出现在结果里
  const t = buildAppTable("ios");
  assert.ok(GROUPS.video.includes("bilibili"));
  assert.equal(t.bilibili, undefined);                 // 原子层没有 → 不下发该 token
  assert.ok(t.video.length >= 1);                      // 但已登记的成员照常并入
  for (const id of t.video) assert.ok(typeof id === "string" && id.length > 0);
});

test("空展开语义: 未知平台/空原子表 → null，信封省略该节", () => {
  assert.equal(buildAppTable("symbian"), null);        // 未登记平台
  assert.equal(buildAppTable("android"), null);        // 空壳表（§4.2 只留形状）
  // 语义自动正确（§2.2 规则3）: 手机端拿不到 token → 展开成空集
  //   not_in 空集 = 没有要躲的 → 通过 ✓    in 空集 = 不可能属于空集 → 拦截 ✓
  // 故安卓设备的 guards 里出现 apple_maps 无需任何特判
});

test("表名 = 守卫 source 名（手机端 resolve[guard.source][token] 零对照表）", () => {
  const r = buildResolve("ios", "zh,en");
  // 三张表的键，必须与 guards 里可能出现的 source 一一对应
  assert.deepEqual(Object.keys(r).sort(), ["app", "current_focus", "locked"]);
  assert.deepEqual(r.current_focus.do_not_disturb, ["勿扰模式", "Do Not Disturb"]);  // locales 顺序=优先级
  assert.deepEqual(r.locked, LOCKED_TABLE);            // 恒等表恒发 → 手机端零"免展开"分支
  // 法则2 恒数组: 每张表的每个值都必须是数组，无论几个元素
  for (const tbl of Object.values(r)) {
    for (const v of Object.values(tbl)) assert.ok(Array.isArray(v), `${JSON.stringify(v)} 不是数组`);
  }
});

test("platform 与 locales 互不影响（包名不本地化，显示名不随平台变）", () => {
  const a = buildResolve("ios", "zh,en");
  const b = buildResolve("ios", null);                 // 不要语言表
  assert.equal(b.current_focus, undefined);
  assert.deepEqual(b.app, a.app);                      // app 表不受 locales 影响

  const c = buildResolve("android", "zh,en");          // 安卓空表
  assert.equal(c.app, undefined);
  assert.deepEqual(c.current_focus, a.current_focus);  // focus 表不受 platform 影响
  assert.deepEqual(c.locked, LOCKED_TABLE);            // locked 恒在
});

test("focus 表: 多语言合并，候选名数组按 locales 优先级；反查表已删除", () => {
  const m = buildFocusTable("zh,en");
  assert.deepEqual(m.sleep, ["睡眠", "Sleep"]);
  assert.deepEqual(m.do_not_disturb, ["勿扰模式", "Do Not Disturb"]);
  assert.equal(buildFocusTable("klingon"), null);      // 未知语言 → null，不报错
  assert.equal(buildFocusTable(""), null);
  // 守卫改成员判断后不再需要 name→token 反查（与 app 守卫同构）
  assert.equal(typeof m.name_to_token, "undefined");
});

test("契约红线: 解析表里的 token 名不得含平台字符串", () => {
  // token 是语义锚点（如 maps/amap），本地标识只能出现在【值】里，绝不能爬进【键】。
  // 违反 = 平台细节漏进契约，安卓移植必返工（DEVICE-ABSTRACTION 不变量1）。
  for (const token of [...Object.keys(APPS.ios), ...Object.keys(GROUPS)]) {
    assert.ok(!token.includes("."), `token "${token}" 含点号，疑似把包名当了 token`);
    assert.ok(/^[a-z0-9_]+$/.test(token), `token "${token}" 不是小写 snake_case`);
  }
});

// ── guards 的 match[] 预展开（服务端做，手机端 CheckGuards 因此少一层循环）──
import { assembleState } from "../../src/edge/assemble.js";

test("★guards.match[]: 服务端把语义 token 展开成本机比较集合", () => {
  const F = { media_volume: { KIND: "scalar", USE: "q", MAP: { on: 0 }, APPLY: "on_change",
    GUARDS_ALWAYS: [{ source: "app", op: "not_in", value: ["maps", "spotify"] }] } };
  const env = assembleState({
    resolve: buildResolve("ios", "zh,en"),
    fieldsConfig: F, schedules: { q: [{ from: "2026-07-15 00:00", value: "on" }] },
    range: { start: "2026-07-15", end: "2026-07-15" }, at: "2026-07-15 12:00",
    mode: "segment", trace: [],
  });
  const g = env.fields.media_volume.guards[0];
  assert.deepEqual(g.value, ["maps", "spotify"]);          // 语义 token 保留（人读/排查/跨平台）
  assert.ok(g.match.includes("com.apple.Maps"));           // 类别展开
  assert.ok(g.match.includes("com.spotify.client"));       // 原子展开
  assert.equal(new Set(g.match).size, g.match.length);     // 去重
});

test("★空展开: token 查不到 → 不贡献成员; 整表缺失 → match=[]", () => {
  const mk = (resolve) => assembleState({
    resolve,
    fieldsConfig: { silent: { KIND: "scalar", USE: "q", MAP: { on: "on" },
      GUARDS_ALWAYS: [{ source: "app", op: "in", value: ["maps", "不存在的token"] }] } },
    schedules: { q: [{ from: "2026-07-15 00:00", value: "on" }] },
    range: { start: "2026-07-15", end: "2026-07-15" }, at: "2026-07-15 12:00",
    mode: "segment", trace: [],
  }).fields.silent.guards[0].match;

  const ios = mk(buildResolve("ios", null));
  assert.ok(ios.includes("com.apple.Maps"));
  assert.ok(!ios.some((x) => x.includes("不存在")));        // 查不到的 token 静默不贡献
  // 安卓 app 表为空壳 → match 全空 → in 拦截 / not_in 通过（语义自动正确，手机端零特判）
  assert.deepEqual(mk(buildResolve("android", null)), []);
  assert.deepEqual(mk(null), []);                          // 整个 resolve 缺失
});
