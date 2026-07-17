// test/domain/grammar.test.js — 词法（V11 语义回归）
import test from "node:test";
import assert from "node:assert/strict";
import { classify, matchGroup, vocabularyFromConfig, DEFAULT_VOCABULARY } from "../../src/domain/grammar.js";

test("恰好相等与全角空白归一", () => {
  assert.equal(classify("年假"), "leave");
  assert.equal(classify("　休假　"), "leave");          // 全角空格
});

test("成对括号命中，未配对不命中", () => {
  assert.equal(classify("[年假]"), "leave");
  assert.equal(classify("【会议】提前到"), "work_event");
  assert.equal(classify("[年假)"), null);               // 括号不配对
});

test("普通日程不误伤（V11 反例回归）", () => {
  assert.equal(classify("讨论年假政策"), null);
  assert.equal(classify("陪孩子请假去医院"), null);
});

test("裁决优先级 god_mode > leave > work_event", () => {
  assert.equal(classify("[上帝模式][请假]"), "god_mode");
});

test("vocabularyFromConfig 注入用户词表，缺省回落默认", () => {
  const v = vocabularyFromConfig({ KEYWORDS: { LEAVE: ["调休"] } });
  assert.equal(matchGroup("[调休]", "leave", v), true);
  assert.equal(matchGroup("[年假]", "leave", v), false); // 用户表整组覆盖
  assert.deepEqual(v.work_event, DEFAULT_VOCABULARY.work_event);
});
