// ─────────────────────────────────────────────────────────────────────────────
// plugins/cadence.js — 周期任务超级插件（KERNEL §10）
// ─────────────────────────────────────────────────────────────────────────────
// 由 V2.CADENCE.TASKS 配置【生成】插件，一个任务 = 一张自己的 schedule:
//     cadence_<task>            level: true(可用) | false(冷却中) | null(无主张)
//     cadence_<task>_reminder   闹钟集合（channel:"alarm" 且 reminder 时才生成）
//
// 为什么一任务一 schedule（而不是一张 schedule 装所有任务）:
//   ① 单一 owner（契约6）天然成立，任务间零耦合，删一个任务不影响别的
//   ② 字段订阅用现成的五旋钮 USE: "cadence_<task>" —— 【kernel/fields.js 零改动】
//   ③ 每任务可有自己的 feeds/channel（将来 channel:"todo" 只影响那一个任务）
//
// 事实流（契约14）: { at, id, type: "done"|"reset"|"set_next", payload }
//   done     使用一次 → 阻塞 [at, min(at+cooldown, 下个周重置)]
//   reset    纠偏: 立即恢复（截断覆盖 at 的阻塞段）
//   set_next 纠偏: 手动指定下次可用 → 阻塞 [at, payload.at]
// 事实源降级 → 全程 null（宁可不知道，不可编造，契约9/10）。
//
// 加一个新周期任务 = CADENCE.TASKS 加一节【纯配置】，本文件与内核都不用改（验收九条 #9）。
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, addMinutes, dayOfWeek, cmp } from "../kernel/intervals.js";
import { cadenceLabel } from "../domain/alarm-labels.js";

/** 严格晚于 t 的下一个周重置时刻 */
export function nextWeeklyReset(t, weekly) {
  if (!weekly) return null;
  const day = t.slice(0, 10);
  for (let i = 0; i <= 7; i++) {
    const d = addDays(day, i);
    if (dayOfWeek(d) !== weekly.day) continue;
    const w = `${d} ${weekly.time}`;
    if (cmp(w, t) > 0) return w;
  }
  return null;
}

// ─── kinds 库 ────────────────────────────────────────────────────────────────
// 开放枚举。每个 kind = 一个"事实流 → 阻塞区间[]"的纯函数，区间→阶跃由下方统一完成。
// ⚠️ 只实现【当前真在用】的 kind。ladder / weekly_reset 等 KERNEL §10 提到的玩法
//    等真有任务需要时再写 —— 预先实现是过早抽象（explicit over speculative）。
//    未知 kind 不静默降级，报响亮错误（见 produce 里的 notes）。
export const KINDS = {
  /** 滚动冷却: 每次 done 阻塞固定时长；可选周重置提前截断 */
  rolling_cooldown(events, task) {
    const blocks = [];
    for (const e of events) {
      const type = e.type || "done";
      if (type === "done") {
        let end = addMinutes(e.at, task.cooldown_minutes ?? 300);
        const w = nextWeeklyReset(e.at, task.weekly_reset);
        if (w && cmp(w, end) < 0) end = w;                 // 周重置提前回满
        blocks.push({ start: e.at, end });
      } else if (type === "set_next" && e.payload && e.payload.at) {
        if (cmp(e.payload.at, e.at) > 0) blocks.push({ start: e.at, end: e.payload.at });
      } else if (type === "reset") {
        for (const b of blocks) {
          if (cmp(b.start, e.at) <= 0 && cmp(e.at, b.end) < 0) b.end = e.at;   // 截断
        }
      }
    }
    return blocks;
  },
};

/** 阻塞区间[] → level 阶跃（true=可用 / false=冷却中） */
function blocksToSteps(blocks, base, horizon) {
  blocks.sort((a, b) => cmp(a.start, b.start));
  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && cmp(b.start, last.end) <= 0) {
      if (cmp(b.end, last.end) > 0) last.end = b.end;
    } else merged.push({ ...b });
  }
  const out = [{ from: base, value: true }];
  for (const b of merged) {
    if (cmp(b.end, base) <= 0 || cmp(b.start, horizon) >= 0) continue;
    out.push({ from: cmp(b.start, base) > 0 ? b.start : base, value: false });
    if (cmp(b.end, horizon) < 0) out.push({ from: b.end, value: true });
  }
  if (merged.some((b) => cmp(b.start, base) <= 0 && cmp(base, b.end) < 0)) out[0].value = false;
  const dedup = new Map(out.map((s) => [s.from, s.value]));   // 同刻后写者胜
  return [...dedup.entries()].map(([from, value]) => ({ from, value }));
}

/** 读取任务配置（含缺省），返回 null = 该任务不存在 */
function taskCfg(ctx, name) {
  const tasks = ((ctx.config.V2 || {}).CADENCE || {}).TASKS || {};
  const t = tasks[name];
  if (!t) return null;
  return { stream: name, kind: "rolling_cooldown", channel: "alarm", reminder: true, ...t };
}

/** 生成"任务状态"插件 */
function makeTaskPlugin(name) {
  return {
    name: `cadence_${name}`,
    kind: "level",
    scope: "per-device",
    // feeds 默认 "fields" —— 字段 cadence.<task> 订阅它
    deps: [],

    produce(ctx, range) {
      const task = taskCfg(ctx, name);
      const base = `${addDays(range.start, -1)} 00:00`;
      const horizon = `${addDays(range.end, 2)} 00:00`;
      const nothing = [{ from: base, value: null }];

      if (!task || task.enabled === false) return nothing;         // 未配置/关闭: 无主张
      const facts = ctx.facts || {};
      if ((facts.degraded || []).includes(task.stream)) {
        return { segments: nothing, notes: [{ level: "warn", ref: "stream_degraded",
          msg: `事实流 "${task.stream}" 降级 → 全程无主张（不编造）` }] };
      }
      const impl = KINDS[task.kind];
      if (!impl) {                                                 // 未知 kind: 响亮失败
        return { segments: nothing, notes: [{ level: "error", ref: "unknown_kind",
          msg: `任务 "${name}" 的 kind "${task.kind}" 未实现（已实现: ${Object.keys(KINDS).join("/")}）` +
               ` → 全程无主张。新玩法需在 plugins/cadence.js 的 KINDS 里实现` }] };
      }
      const events = [...(facts.streams?.[task.stream] || [])]
        .filter((e) => e && e.at && e.id)
        .sort((a, b) => cmp(a.at, b.at));
      return blocksToSteps(impl(events, task), base, horizon);
    },
  };
}

/** 生成"恢复提醒"插件（纯派生: 只读任务时间线的 false→true 跳变，不重算任何冷却逻辑） */
function makeReminderPlugin(name) {
  const src = `cadence_${name}`;
  return {
    name: `${src}_reminder`,
    kind: "level",
    scope: "per-device",
    feeds: "alarms",                                    // 被 assembleAlarms 消费
    deps: [{ name: src, required: true }],

    produce(ctx, range) {
      const task = taskCfg(ctx, name);
      const segs = ctx.schedules[src] || [];
      const byDay = new Map();
      let prev = null;
      for (const s of segs) {
        if (s.value === true && prev === false) {        // 恢复时刻
          const d = s.from.slice(0, 10), t = s.from.slice(11);
          const label = cadenceLabel(name, t);           // GateDyn-CAD-<task>-<HHMM>
          if (label) {
            if (!byDay.has(d)) byDay.set(d, []);
            byDay.get(d).push({ label, time: t, reason: `${task?.title || name}恢复` });
          }
        }
        prev = s.value;
      }
      const on = task && task.enabled !== false && task.reminder !== false;
      const out = [];
      for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
        out.push({ from: `${d} 00:00`,
                   value: { fixed: [], dynamic: on ? (byDay.get(d) || []) : [] } });
      }
      return out;
    },
  };
}

/**
 * 由配置生成全部 cadence 插件。
 * channel 决定提醒落到哪个通道:
 *   "alarm"        → 生成 reminder 插件（feeds:"alarms"）—— 当前唯一已建成的通道
 *   "todo"         → todos 节尚未建成，生成一个只报警告的占位（不静默吞掉配置）
 *   "notification" → 同上（Bark 通道尚未建成）
 */
export function makeCadencePlugins(v2cfg) {
  const tasks = (v2cfg.CADENCE || {}).TASKS || {};
  const out = [];
  for (const [name, raw] of Object.entries(tasks)) {
    out.push(makeTaskPlugin(name));
    // 注意: 插件【集合】不随 enabled/reminder 变化，只有【产出】变化。
    // 否则关掉一个任务会让 schedule 凭空消失，下游 deps 与 audit 都要跟着抖。
    const channel = raw.channel || "alarm";
    if (channel === "alarm") {
      out.push(makeReminderPlugin(name));
    } else {
      // 通道未建成: 产出空闹钟集合 + 响亮告警，绝不静默当作"配了就生效"
      out.push({
        name: `cadence_${name}_reminder`, kind: "level", scope: "per-device",
        feeds: "alarms", deps: [],
        produce(_ctx, range) {
          const segs = [];
          for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
            segs.push({ from: `${d} 00:00`, value: { fixed: [], dynamic: [] } });
          }
          return { segments: segs, notes: [{ level: "warn", ref: "channel_not_built",
            msg: `任务 "${name}" 配了 channel:"${channel}"，但该通道尚未建成 → 提醒不会下发。` +
                 `当前可用: alarm。todo 通道见 docs/TODO-CHANNEL.md` }] };
        },
      });
    }
  }
  return out;
}
