// test/docs.test.js — 文档不烂掉的机械保障
// ─────────────────────────────────────────────────────────────────────────────
// 这个项目的文档烂过一次: 加了日型轴、改了时刻、改了形状，而手册里还写着旧时刻、
// 旧机制。烂掉不是因为写得差，是因为【没人在改代码时顺手改文档】。
//
// 所以把「文档说的和代码做的一致」变成会红的测试。它只查【机械可查】的部分 ——
// 时刻、刺客清单、字段名。语义正确性仍然要人写，但至少不会出现"文档说 07:40、
// 代码是 07:44"这种低级不一致。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { CONFIG } from "../src/config.js";

const DOCS = new URL("../docs/", import.meta.url);
const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, DOCS), "utf-8");
const readRoot = (f) => readFileSync(new URL(f, ROOT), "utf-8");

// ⚠️ 2026-07-31: 根目录的 CHANGELOG / MIGRATION / README 长期没人管，因为所有检查
// 都只扫 docs/。**检查范围本身也会有盲区** —— 加这条把根目录纳进来。
test("仓库根目录只允许 README.md（其余文档归 docs/ 或删除）", () => {
  const stray = readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
    .map((e) => e.name);
  assert.deepEqual(stray, [],
    `根目录多出文档: ${stray} —— 一次性纪要（CHANGELOG/MIGRATION 之类）用完就该删，` +
    `长期内容归 docs/ 并编号`);
});

test("README 的 docs/ 链接必须指向真实存在的编号文档", () => {
  const files = new Set(readdirSync(DOCS));
  for (const m of readRoot("README.md").matchAll(/docs\/([\w.-]+\.md)/g)) {
    assert.ok(files.has(m[1]), `README 链接到不存在的 docs/${m[1]}`);
  }
});

test("顶层文档都有编号前缀（子目录不管 —— 那是你的自由）", () => {
  const stray = readdirSync(DOCS, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !/^\d\d-/.test(e.name))
    .map((e) => e.name);
  assert.deepEqual(stray, [], `顶层文档缺编号前缀: ${stray}`);
});

test("刺客白名单: 02-RULES 与 04-PHONE 里写的必须与代码一致", () => {
  const whitelist = [...CONFIG.DND.WHITELIST].sort();
  for (const doc of ["02-RULES.md", "04-PHONE.md"]) {
    const text = read(doc);
    for (const hm of whitelist) {
      assert.ok(text.includes(hm), `${doc} 没提到刺客时刻 ${hm}`);
    }
  }
});

test("已退役的时刻不该被【当作现行值】写在文档里", () => {
  // 07:40 是旧的晨间解除时刻，2026-07-31 改成 07:44。
  // 允许的写法: 同一行里出现新值（"07:40 → 07:44"、"从 07:40 改 07:44"）—— 那是迁移说明。
  // 禁止的写法: 裸用旧值当例子或清单项 —— 那是没改干净。
  const retired = [["07:40", "07:44"]];
  // 只查【面向当下】的文档。09-KERNEL 的示例、10/11 的设计稿、13-HISTORY 的考古
  // 里出现旧时刻是正常的 —— 它们记的是当时的状态，不是现在该照做的值。
  const CURRENT = /^0[0-8]-.*\.md$/;
  for (const f of readdirSync(DOCS).filter((x) => CURRENT.test(x))) {
    read(f).split("\n").forEach((line, i) => {
      for (const [old, now] of retired) {
        if (line.includes(old) && !line.includes(now)) {
          assert.fail(`${f}:${i + 1} 裸用了已退役的时刻 ${old}（现行是 ${now}）\n  ${line.trim()}`);
        }
      }
    });
  }
});

test("字段名: 03-CONTRACT 必须覆盖所有实际下发的字段", () => {
  const contract = read("03-CONTRACT.md");
  for (const name of Object.keys(CONFIG.V2.FIELDS)) {
    if (name.startsWith("cadence.")) continue;          // 动态派生的，契约里讲的是形状
    assert.ok(contract.includes(name), `03-CONTRACT 没提到字段 ${name}`);
  }
});

test("日型四轴: 01-CONCEPTS 写的必须与 kernel 白名单一致", async () => {
  const concepts = read("01-CONCEPTS.md");
  for (const axis of ["morning", "noon", "eve", "night"]) {
    assert.ok(concepts.includes(`\`${axis}\``), `01-CONCEPTS 没讲日型轴 ${axis}`);
  }
});

test("代码里引用的契约编号，09-KERNEL 里必须真的有", () => {
  // 代码注释里到处写「契约12」「KERNEL §13」。删改 KERNEL 条目时容易留下断链，
  // 而断链的表现是「照着注释去查，查不到」—— 悄无声息地浪费后来者的时间。
  const kernel = read("09-KERNEL.md");
  const cited = new Set();
  for (const f of ["../src/edge/router.js", "../src/edge/assemble.js",
                   "../src/kernel/fields.js", "../src/edge/sources.js"]) {
    const code = readFileSync(new URL(f, DOCS), "utf-8");
    for (const m of code.matchAll(/契约(\d+)/g)) cited.add(Number(m[1]));
  }
  assert.ok(cited.size > 0, "没抓到任何契约引用，正则可能失效了");
  for (const n of [...cited].sort((a, b) => a - b)) {
    assert.ok(kernel.includes(`${n}.`) || kernel.includes(`契约${n}`),
      `代码引用了「契约${n}」但 09-KERNEL 里找不到它`);
  }
});

test("现役文档里的 .md 链接必须真实存在（防断链）", () => {
  // 文档合并/改名时最容易留下断链: 照着引用去查，查不到 —— 悄无声息浪费后来者的时间。
  // 13-HISTORY 的「去向表」里故意保留旧文件名（那是历史记录），所以豁免。
  // 认得 docs/ 里的，也认得根目录的 README.md（它是项目门面，合法引用对象）
  const files = new Set([
    ...readdirSync(DOCS).filter((f) => f.endsWith(".md")),
    ...readdirSync(ROOT).filter((f) => f.endsWith(".md")),
  ]);
  const docFiles = readdirSync(DOCS).filter((f) => f.endsWith(".md"));
  for (const f of docFiles) {              // 只遍历 docs/，但 files 名单含根目录（合法引用对象）
    if (f === "13-HISTORY.md") continue;   // 去向表里故意保留旧名
    const text = read(f);
    for (const m of text.matchAll(/\]\(([\w.-]+\.md)(?:#[^)]*)?\)/g)) {
      assert.ok(files.has(m[1]), `${f} 链接到不存在的 ${m[1]}`);
    }
    // 裸写的旧文件名（反引号包住的）也算断链 —— 但要分辨【使用】和【提及】。
    // 「`X.md` 已删除」是在讲历史，不是断链；`core 的 X.md` 指别的仓库。
    // 判据放在整行上: 该行只要在谈论文件的消失/归属，就放行。
    // （这条豁免被两次实践逼出来 —— 检查器困住写文档的人两回了。）
    const MENTION = /已(全部)?(清除|删除|退役|移除|完成|做完)|不存在|死文件|引用已删|曾引用|core 的|仓库的|另一个|去向|原文档|一次性纪要/;
    for (const line of text.split("\n")) {
      if (MENTION.test(line)) continue;
      for (const m of line.matchAll(/`([A-Z][A-Z-]+\.md)`/g)) {
        assert.ok(files.has(m[1]) || f === "00-README.md",
          `${f} 引用了已删除的 ${m[1]}`);
      }
    }
  }
});

test("入口文档存在且指向所有编号文档", () => {
  const readme = read("00-README.md");
  for (const f of readdirSync(DOCS).filter((x) => /^\d\d-.*\.md$/.test(x) && x !== "00-README.md")) {
    assert.ok(readme.includes(f), `00-README 没有链接到 ${f}`);
  }
});

// ── 文档断言 vs 代码实际（不是查链接，是查「文档说的对不对」）──────────────
// 前面几条查的是文档【内部】一致性（链接、编号、时刻）。这几条查的是文档
// 【对外】的真实性 —— 它描述的行为，代码到底是不是这样。
// 起因: 2026-07-31 通读发现 09-KERNEL 契约5 写「当前无字段声明 enforce」，
// 而实际 focus 六个边界全是 always —— 代码引用的宪法在说假话，读它的人会被带偏。
test("文档提到的 src/ 路径必须真实存在", () => {
  // 放行「叙述某文件已消失」的语境 —— 那不是断链，是在讲历史。
  // 判据: 同一行里出现了「已删除/不存在/死文件/引用已删的…」这类词。
  const skip = /已(全部)?(清除|删除|退役|移除)|不存在|死文件|引用已删|曾引用/;
  for (const f of readdirSync(DOCS).filter((x) => x.endsWith(".md"))) {
    read(f).split("\n").forEach((line, i) => {
      if (skip.test(line)) return;                       // 「XX 已删除」这类叙述放行
      for (const m of line.matchAll(/`(src\/[\w/.-]+\.js)`/g)) {
        assert.ok(existsSync(new URL("../" + m[1], DOCS)),
          `${f}:${i + 1} 提到不存在的 ${m[1]}`);
      }
    });
  }
});

test("★ 文档描述的核心行为，必须与代码实际一致", async () => {
  const { handleV2 } = await import("../src/edge/router.js");
  const { addDays } = await import("../src/kernel/intervals.js");
  const L = {
    async loadWorkdays() {
      const o = [];
      for (let d = "2026-10-25"; d <= "2026-12-31"; d = addDays(d, 1)) {
        const w = new Date(d + "T00:00:00Z").getUTCDay();
        o.push({ date: d, off: w === 0 || w === 6, name: "" });
      }
      return o;
    },
    async loadCalendars() { return []; },
    async loadExternalAlarms() { return []; },
    async loadFacts() { return { streams: {}, degraded: [] }; },
  };
  const get = async (qs, p = "/state") =>
    (await handleV2(new Request(`https://x/v2${p}?${qs}`), {}, p, L)).json();

  // 02-RULES §2.2 的时刻表
  assert.equal((await get("date=2026-11-04&now=07:44&mode=point&locales=zh"))
    .fields.focus.value.action, "off", "文档说工作日 07:44 解除");
  assert.equal((await get("date=2026-11-04&now=20:55&mode=point&locales=zh"))
    .fields.focus.value.action, "on", "文档说工作日 20:55 进入");

  // 01-CONCEPTS §3.1 / 03-CONTRACT §7: 全 pulse → 段查询看不见
  assert.equal((await get("date=2026-11-04&now=15:00&locales=zh")).fields.focus,
    undefined, "文档说段查询一律看不见 focus");

  // 02-RULES §4: 三字段共用骨架 → 解除时刻必须一致
  const t = await (await handleV2(
    new Request("https://x/v2/timeline?date=2026-11-04&debug=1"), {}, "/timeline", L)).json();
  const first = (k) => (t.field_timelines[k] || [])
    .filter((x) => x.from.startsWith("2026-11-04"))[0]?.from.slice(11);
  assert.equal(new Set([first("focus"), first("silent"), first("media_volume")]).size, 1,
    "文档说三个字段解除时刻一致");

  // 00-README §2 / 02-RULES §1: /v2/schema 提供 automations 与 canonical
  const sc = await get("date=2026-11-04", "/schema");
  assert.ok(sc.canonical, "文档说 /v2/schema 给规范形式");
  assert.ok(sc.automations?.time_of_day?.items?.length, "文档说 /v2/schema 列出要建的自动化");
});

test("06-OPERATIONS 的 AUTH_DISABLED 警告与实际状态一致", () => {
  const warned = read("06-OPERATIONS.md").includes("AUTH_DISABLED");
  // 还开着就必须有警告；关掉了就该把警告撤掉（免得变成狼来了）
  assert.equal(warned, CONFIG.AUTH_DISABLED === true,
    CONFIG.AUTH_DISABLED
      ? "AUTH_DISABLED 还开着，06-OPERATIONS 必须留警告"
      : "AUTH_DISABLED 已关闭，请把 06-OPERATIONS 里的警告撤掉");
});
