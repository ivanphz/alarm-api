/**
 * ==============================================================================
 * 🔗 config.js — 配置合并器（自动生成 CONFIG，通常不用改这个文件）
 * ==============================================================================
 *
 * 两层配置合并成最终的 CONFIG，供全项目 import:
 *   config.default.js (DEFAULT_CONFIG)  出厂默认值，维护者更新，别改
 *   config.user.js    (USER_CONFIG)     你的个人覆盖，只有你改
 *
 * 合并规则（deepMerge）:
 *   · 普通对象 → 逐层深合并（你只写想改的字段，其余继承默认）
 *   · 数组     → 整段替换（要改就写全，便于"删除某项"）
 *   · 其它值   → 用户值覆盖默认值
 * ==============================================================================
 */

import { DEFAULT_CONFIG } from "./config.default.js";
import { USER_CONFIG } from "./config.user.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 深合并: override 覆盖 base；对象递归合并，数组整段替换 */
function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    // 数组或标量: 用户端有值就整体替换，否则用默认
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const key of Object.keys(override)) {
    const b = base[key];
    const o = override[key];
    if (isPlainObject(b) && isPlainObject(o)) {
      out[key] = deepMerge(b, o);       // 对象递归
    } else {
      out[key] = o;                     // 数组/标量: 整体覆盖
    }
  }
  return out;
}

export const CONFIG = deepMerge(DEFAULT_CONFIG, USER_CONFIG || {});
