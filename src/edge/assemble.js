// ─────────────────────────────────────────────────────────────────────────────
// edge/assemble.js — /v2 信封组装（V12 步骤③）
// ─────────────────────────────────────────────────────────────────────────────
// 契约12: { version, generated_at, range, fields, trace }，双向未知字段容忍。
// 裁剪在此发生（发布给依赖方的是未裁剪产物，见 registry 注释）。
// trace 在此出口渲染成字符串（契约: 结构化存储，出口渲染，KERNEL §13）。
import { addDays, addMinutes, clampToRange, sampleSegment, samplePoint } from "../kernel/intervals.js";
import { buildFieldTimelines } from "../kernel/fields.js";

// 点号键展开为嵌套对象: fields["cadence.ai_claude"] → fields.cadence.ai_claude
// 【通用规则，不认识任何具体字段名】—— 任何含点的字段键都按层级展开。
// 为什么: 手机端 Shortcuts 里「取 fields.cadence 再遍历 keys」远比
//        「把全部 fields 键按 "cadence." 前缀过滤」容易。趁手机端未搭定形，零迁移成本。
// ─────────────────────────────────────────────────────────────────────────────
// 信封里【永不出现裸布尔】—— 实测铁律，来自 DEVLOG §1.4
// ─────────────────────────────────────────────────────────────────────────────
// iOS 快捷指令把 JSON boolean 渲染成【本地化文本】: 中文系统 "是/否"、英文 "Yes/No"，
// 历史上还出现过 1/0 与 true/false —— 呈现方式【不是契约】，随系统语言与版本漂移。
// 手机端拿 true 去比对必然失败，而且是【静默失败】（条件永不成立，什么都不发生）。
//
// 定案: 凡真值一律下发【小写字符串 token】"true" / "false"。
//   与 resolve.locked 表（{"true":["true"],"false":["false"]}）保持一致，
//   手机端全程只做文本相等，无需任何类型体操。
// 这条由 assemble.test.js 的"信封零裸布尔"用例全量扫描守着，新字段无法绕过。
function boolToken(v) {
  return typeof v === "boolean" ? String(v) : v;
}

export function nestDotted(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat || {})) {
    if (!k.includes(".")) { out[k] = v; continue; }
    const parts = k.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}

export function renderTrace(trace) {
  return (trace || []).map((t) =>
    typeof t === "string" ? t : `[${t.level}] ${t.plugin}/${t.ref}: ${t.msg}`);
}

// guards 词表（KERNEL §18 登记；开放枚举但校验已知项，未知项响亮告警不静默放行）
const GUARD_OPS = new Set(["is", "is_not", "in", "not_in"]);        // 未来: gt/lt
const GUARD_SOURCES = new Set(["current_focus", "app", "locked"]); // 未来: charging/wifi/battery

// 校验并归一化单条 guard：op/source 合法性 + in/not_in 的 value 必须数组。
// 非法 → 返回 null(丢弃该条) + 记 trace，绝不静默放行一条坏守卫（治理硬失败哲学）。
//
// ⭐ op 收敛（DEVICE-ABSTRACTION §2.4）: is/is_not 是"单元素集合"的语法糖，
//    【服务端翻译成 in/not_in + 单元素数组下发】—— 手机端 CheckGuards 只需实现两个分支。
//    入参侧仍接受 is/is_not（老配置不破），出参侧恒为 in/not_in + 数组。
const OP_SUGAR = { is: "in", is_not: "not_in" };

// 服务端把语义 token 展开成【本机比较集合】match[]。
// 为什么在服务端做（而不是手机端查 resolve 表展开）:
//   ① 手机端 CheckGuards 少一整层嵌套循环（守卫→token→名 变成 守卫→match）
//   ② CheckGuards 不再需要 resolve/整包信封，输入退化成"一个 guards 数组"
//   ③ 展开语义（token 查不到 = 空展开）由服务端测试覆盖，不用在 Shortcuts 里裸奔
// 契约不破: value[] 保留语义 token（人读/排查/跨平台不变），match[] 只是它在本机的投影。
// 空展开语义: token 在本平台不存在 → 不贡献成员; 整张表缺失 → match=[] →
//   in 拦截(不可能属于空集) / not_in 通过(没有要躲的)，与手机端展开的结果完全一致。
function expandGuard(g, resolve, trace, field) {
  const table = (resolve && resolve[g.source]) || {};
  const match = [];
  for (const tok of g.value) {
    for (const id of table[tok] || []) if (!match.includes(id)) match.push(id);
  }
  // ── 空展开告警（fail-loud）────────────────────────────────────────────────
  // 空展开的【语义】是对的（in 拦不住任何东西=全拦, not_in 没什么要躲=全放），
  // 但它对得很安静 —— 这正是 2026-07-27 实案的形状: URL 里混进不可见字符 →
  // ?locales= 收不到 → resolve.current_focus 整表不下发 → focus 的守卫 match 全空 →
  // 早间解除【永远拦截】→ 专注整天不解除，而 trace 里一个字都没有。
  // 表不全 = 少保护(resolve.js 文末)是【已知可接受】的，但也要看得见，故一律告警。
  if (match.length === 0 && trace) {
    trace.push({ level: "warn", plugin: "guards", ref: "empty_match",
      msg: `字段 "${field}" 的守卫 ${g.source}/${g.op} [${g.value.join(",")}] 展开为空 —— ` +
           (g.op === "in"
             ? "该守卫将【永远拦截】，此字段到点不会动手"
             : "该守卫将【永远放行】，等于这层保护不存在") +
           `；检查 URL 是否带 ?locales= / ?platform=，以及 edge/resolve.js 里有无这些 token` });
  }
  return { ...g, match };
}
function validateGuard(g, trace) {
  const T = (msg) => trace && trace.push({ level: "warn", plugin: "guards", ref: "bad_guard", msg });
  if (!g || typeof g !== "object") { T(`守卫非对象，已丢弃: ${JSON.stringify(g)}`); return null; }
  if (!GUARD_SOURCES.has(g.source)) { T(`未知 guard.source "${g.source}"，已丢弃（合法: ${[...GUARD_SOURCES].join("/")}）`); return null; }
  if (!GUARD_OPS.has(g.op)) { T(`未知 guard.op "${g.op}"，已丢弃（合法: ${[...GUARD_OPS].join("/")}）`); return null; }
  if (g.op === "in" || g.op === "not_in") {
    if (!Array.isArray(g.value)) { T(`guard.op ${g.op} 的 value 必须是数组，实为 ${typeof g.value}，已丢弃`); return null; }
    return { source: g.source, op: g.op, value: g.value.map(String) };
  }
  // is/is_not → 语法糖展开为 in/not_in 单元素数组（手机端永不见 is/is_not）
  return { source: g.source, op: OP_SUGAR[g.op], value: [String(g.value)] };
}

// 守卫归一化 → 返回 { value, guards }（guards 提到【字段级】，与 value 同级，三字段路径一致）。
// only_if_current 是单守卫语法糖: 翻译成 current_focus 条目并入 guards、从 value 移除。
//   · 标量 "sleep"            → is  → 下发 in + 单元素数组
//   · 数组 ["none","sleep"]   → in  → 下发 in + 多元素数组（"当前是这几种之一才动手"）
// 数组以前会被 String() 压成 "none,sleep" 这一个假 token → 展开必空 → 守卫永远拦截，
// 且（在空展开告警之前）毫无迹象。现在直接支持，不再有这个坑。
// 手机端一律读 fields.<x>.guards，永不读 only_if_current，也不从 value 内部取 guards。
function extractGuards(value, trace) {
  const raw = [];
  let outValue = value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.guards)) raw.push(...value.guards);
    if (value.only_if_current != null) {
      const oic = value.only_if_current;
      raw.push(Array.isArray(oic)
        ? { source: "current_focus", op: "in", value: oic }        // 多值
        : { source: "current_focus", op: "is", value: oic });      // 单值（下游糖化成 in）
    }
    const { guards: _g, only_if_current: _o, ...rest } = value;
    outValue = rest;
  }
  // 逐条校验归一化；非法条目丢弃并告警（不静默放行坏守卫）
  const guards = raw.map((g) => validateGuard(g, trace)).filter(Boolean);
  return { value: outValue, guards };   // 空数组=手机 CheckGuards 见空即 PASS
}

export function assembleState({
  resolve = null,                       // token→本机标识 解析表（用于展开 guards 的 match[]）
  applyOverride = null,                 // "enforce" = 强制推平本次全部字段（?apply=enforce）
  fieldsConfig, schedules, range, at,
  mode = "segment", device = "default",
  tolerances = {}, debug = false, trace = [],
}) {
  const clampStart = `${range.start} 00:00`;
  const clampEnd = `${addDays(range.end, 1)} 00:00`;

  const raw = buildFieldTimelines(fieldsConfig, schedules, range);
  const timelines = {};
  for (const [name, segs] of Object.entries(raw)) {
    timelines[name] = clampToRange(segs, clampStart, clampEnd);
  }

  const fields = {};
  // ─────────────────────────────────────────────────────────────────────────
  // 字段组装 —— 【两个模式产出完全相同的形状】(结构冻结·法则3 单路径)
  //   fields.<x> = { kind, apply, value, from, guards? }
  // 手机端读法恒定一句: fields.<x>.value + fields.<x>.guards，与 mode 无关。
  // 于是边界刺客(point) 与轮询(segment) 可以【共用同一个 ApplyX 指令】，只是 URL 不同。
  //
  // 两个模式的唯一差别是"给你哪个值":
  //   segment  当前所处区段的值（一定有）
  //   point    命中时刻的值；该字段在此刻【无指令】→ 整个字段不出现（见下"缺席"语义）
  //
  // ⚠️ 缺席 vs null —— 两者语义不同，绝不可混（旧版把两者都表达成 null，是隐患）:
  //   字段缺席        = 此刻没有关于它的指令 → 手机【什么都不做】
  //   value: null    = 规则显式释放主张（如长假白天）→ 手机【删除 last_applied】(契约4)
  // ─────────────────────────────────────────────────────────────────────────
  const alwaysGuards = {};        // 每字段的恒常守卫（GUARDS_ALWAYS）
  const metaOf = {};
  const pointChanges = {};        // point 模式的明细，仅 debug 时下发
  for (const [name, segs] of Object.entries(timelines)) {
    const cfg = fieldsConfig[name] || {};
    metaOf[name] = { kind: cfg.KIND ?? "scalar", apply: applyOverride || cfg.APPLY || "on_change" };
    // 恒常作用域守卫（整个字段永远适用）；时点作用域守卫在值内，由 extractGuards 取出
    let alwaysRaw = cfg.GUARDS_ALWAYS;
    if (!Array.isArray(alwaysRaw) && Array.isArray(cfg.GUARDS)) {
      alwaysRaw = cfg.GUARDS;     // 旧键名过渡兼容：照用但响亮告警
      trace && trace.push({ level: "warn", plugin: "guards", ref: "deprecated_guards_key",
        msg: `字段 "${name}" 使用了旧键名 GUARDS，请改为 GUARDS_ALWAYS（恒常作用域）` });
    }
    alwaysGuards[name] = Array.isArray(alwaysRaw)
      ? alwaysRaw.map((g) => validateGuard(g, trace)).filter(Boolean)
                 .map((g) => expandGuard(g, resolve, trace, name)) : [];

    if (mode === "point") {
      pointChanges[name] = samplePoint(segs, at, tolerances).map((c) => {
        const { value, guards } = extractGuards(c.value, trace);
        return { ...c, value, guards };
      });
    } else {
      const seg = sampleSegment(segs, at);                   // { value, from }
      const { value, guards } = extractGuards(seg.value, trace);
      fields[name] = { ...metaOf[name], value: boolToken(value), from: seg.from };
      const all = [...guards.map((g) => expandGuard(g, resolve, trace, name)), ...alwaysGuards[name]];
      if (all.length) fields[name].guards = all;
    }
  }

  if (mode === "point") {
    // 选中时刻: 容差窗内离 at 最近的那个边界（多字段可能在同一刻变化）
    const moments = new Set();
    for (const cs of Object.values(pointChanges)) for (const c of cs) moments.add(c.at);
    let best = null;
    if (moments.size > 0) {
      const ms = (x) => Date.UTC(+x.slice(0,4), +x.slice(5,7)-1, +x.slice(8,10), +x.slice(11,13), +x.slice(14,16));
      best = [...moments].sort((a, b) =>
        Math.abs(ms(a) - ms(at)) - Math.abs(ms(b) - ms(at)) || (a < b ? -1 : 1))[0];
    }
    for (const name of Object.keys(metaOf)) {
      const hit = best ? pointChanges[name].find((c) => c.at === best) : null;
      if (!hit) continue;                                    // 此刻无指令 → 字段缺席
      fields[name] = { ...metaOf[name], value: boolToken(hit.value), from: hit.at };
      const all = [...(hit.guards || []).map((g) => expandGuard(g, resolve, trace, name)), ...alwaysGuards[name]];
      if (all.length) fields[name].guards = all;
      if (debug) fields[name].changes = pointChanges[name];   // 明细仅诊断用，手机端不读
    }
  }

  // 对账提示
  // ⚠️ reconcile_alarms 已退休（2026-07-26）。
  //    它原本回答"何时执行昂贵的本地对账"，而"昂贵"里最大的一块（单独一次网络往返）
  //    已被刺客统一拉取消灭，剩下的只是本地 Find Alarms 循环，几秒钟。
  //    "何时对账"这个决定服务端并不比手机知道得多（轮询频率与刺客时刻本就在手机侧定），
  //    故搬回手机端：每轮同步都顺带对账。将来若真需要节流，再作为字段加回。
  return {
    version: "2",
    generated_at: at,
    device,
    mode,
    range,
    // 扁平键（如 "cadence.ai_claude"）—— 键名对手机端是【不透明字符串】，不解析不拆分。
    // 曾短暂改成嵌套，但那让 fields.cadence 变成"没有 kind 的容器"，破坏同构，已撤回。
    fields,
    trace: renderTrace(trace),
    ...(debug ? { schedules, field_timelines: timelines } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 闹钟组装（V12 步骤④）——"闹钟即状态"的采样半场:
//   期望集合来自 wake_alarms ∪ weekend_class（日粒度 level），外部候选在此完成
//   时区换算 → 标签构造 → 24h 窗口裁剪 → 幂等去重。窗口是采样期权限边界。
// v2 窗口 = (at, at+24h]（分钟平面: 排除当前分钟 ≈ v1 的 +15s 死区滤波）。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays as _addDays, addMinutes as _addMinutes } from "../kernel/intervals.js";
import { sampleSegment as _sampleSegment } from "../kernel/intervals.js";
import { buildToggleRegistry, esLabel } from "../domain/alarm-labels.js";
import { toShanghaiWall } from "../lib/time.js";

// ⚠️ 此处【曾经】有一张硬编码名单 ALARM_SCHEDULES = ["wake_alarms", ...]。
//    已移除: 名单改由插件自声明 feeds:"alarms" 得出（kernel/registry.js 的 schedulesFeeding）。
//    调用方（router）负责传入。这样加一个产闹钟的插件 = 只写插件文件，edge 与 kernel 都不用改。
//    todo 通道将来同理用 feeds:"todos"，【不会】再出现第二张硬编码名单。
export function assembleAlarms({ config, schedules, range, at, externalItems = [],
                                 alarmSchedules = [], trace = [] }) {
  const T = (level, ref, msg) => trace.push({ level, plugin: "alarms", ref, msg });
  const winStart = _addMinutes(at, 1);
  const winEnd = _addMinutes(at, 24 * 60);
  const inWindow = (t) => t >= winStart && t <= winEnd;

  // 逐日期望集合（wake_alarms ∪ weekend_class；god 日已由插件内联接管）
  const days = [];
  for (let d = range.start; d <= range.end; d = _addDays(d, 1)) days.push(d);
  const dayValue = (name, d) => _sampleSegment(schedules[name] || [], `${d} 00:00`).value;

  // ① 可开关闹钟: 注册表全量 on/off（label 预设时间落窗才 on）
  const registry = buildToggleRegistry(config);
  const labelTime = new Map(registry.map((a) => [a.label, a.scheduled_at]));
  const activeInWindow = new Set();
  for (const d of days) {
    for (const name of alarmSchedules) {
      const v = dayValue(name, d);
      for (const label of (v && v.fixed) || []) {
        const t = labelTime.get(label);
        if (t && inWindow(`${d} ${t}`)) activeInWindow.add(label);
        else if (!t) T("warn", "unknown_fixed_label",
          `${name} 产出未知固定标签 "${label}"（不在注册表，可能是 god JSON 拼写或缺预建）`);
      }
    }
  }
  const fixed = registry.map((a) => ({
    label: a.label,
    action: activeInWindow.has(a.label) ? "on" : "off",
    scheduled_at: a.scheduled_at,
    kind: a.kind,
  }));

  // ② 动态期望集合: 内部(日值展开) + 外部(换算→标签→窗口) ，label 幂等去重
  const dynamic = [];
  const seen = new Set();
  for (const d of days) {
    for (const name of alarmSchedules) {
      const v = dayValue(name, d);
      for (const a of (v && v.dynamic) || []) {
        const atAbs = `${d} ${a.time}`;
        if (!inWindow(atAbs) || seen.has(a.label)) continue;
        seen.add(a.label);
        dynamic.push({ label: a.label, at: atAbs, reason: a.reason });
      }
    }
  }
  let rejUid = 0, rejFmt = 0, rejWin = 0, tzWarn = 0;
  for (const it of externalItems) {
    if (!it.date || !it.time || !/^\d{4}-\d{2}-\d{2}$/.test(it.date) || !/^\d{2}:\d{2}$/.test(it.time)) { rejFmt++; continue; }
    const w = toShanghaiWall(it.date, it.time, it.tz);
    if (w.tzWarn) tzWarn++;
    const label = esLabel(it.code, it.uid, w.time);
    if (!label) { rejUid++; continue; }
    const atAbs = `${w.date} ${w.time}`;
    if (!inWindow(atAbs)) { rejWin++; continue; }
    if (seen.has(label)) continue;
    seen.add(label);
    dynamic.push({ label, at: atAbs, reason: it.reason });
  }
  if (rejUid || rejFmt || rejWin || tzWarn) {
    T("info", "external_filtered",
      `外部候选过滤: 无uid${rejUid} 格式${rejFmt} 窗口外${rejWin} 时区未识别${tzWarn}`);
  }
  dynamic.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  // ── sweep 授权（★ 破坏性操作的开关，fail-closed）────────────────────────────
  // "true"  = 本次数据权威完整 → 手机可执行 sweep（把不在清单里的动态闹钟关掉）
  // "false" = 数据可能不全 → 手机【只做加法】（有则开、无则建），跳过 sweep
  //
  // 为什么要有它（真实事故链）: 手机 sweep 的规则是"不在清单就关掉"，
  // 而空清单 = 全都不在 = 【全关】。所以一旦服务端因为任何原因少给了条目，
  // 就会关光你的动态闹钟。而 dynamic:[] 本身是【合法指令】（今天真没有动态闹钟），
  // 无法靠"空"识别故障 —— 只能由服务端显式声明"这批数据够不够权威"。
  //
  // 为什么用显式标志而不是"降级时省略 alarms 节":
  //   省略 → 将来有人写新路径忘了省略 → 发出空 alarms → 关光闹钟（默认危险）
  //   标志 → 将来有人忘了置 true     → 手机跳过 sweep → 什么都不做（默认安全）
  // 手机端判 `is true`（不是 `is not false`）: 老服务端不发此字段时也自动跳过。
  let sweep = "true";
  const failed = (trace || []).filter((x) => x && x.ref === "external_failed");
  if (failed.length) {
    sweep = "false";
    T("info", "sweep_withheld",
      `${failed.length} 个外部闹钟源本次拉取失败 → 撤销 sweep 授权（只加不关，避免误关它们的闹钟）`);
  }
  return { window: { start: winStart, end: winEnd }, sweep, fixed, dynamic };
}
