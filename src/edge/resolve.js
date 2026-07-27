// ─────────────────────────────────────────────────────────────────────────────
// edge/resolve.js — 语义 token → 本设备实际标识 的解析表下发
// ─────────────────────────────────────────────────────────────────────────────
// 契约: DEVICE-ABSTRACTION.md §2。铁律 —— 契约(fields/guards)里只有语义 token，
// 永不出现包名/本地化名/平台特有词; 一切平台与语言差异由本文件的【数据】消化。
//
// 下发形状 —— 【表名 = 守卫的 source 名】，于是手机端展开恒定一句:
//     展开(token) = resolve[guard.source][token]        ← 零"源→表"对照表
//   resolve.current_focus = { <preset token>: [本机显示名...] }   受 ?locales= 影响
//   resolve.app           = { <app token>:    [平台标识...]   }   受 ?platform= 影响
//   resolve.locked        = { "true":["true"], "false":["false"] }  恒等表
//
// 恒等表 locked 看着多余，但它让手机端【没有"这个源不需要展开"的分支】——
// 所有源一律走同一句展开。少一个分支 = 少一处以后会忘记同步的地方（法则1 同构）。
//
// ⚠️ resolve.current_focus 同时服务两条路径，别被名字迷惑:
//     守卫段  读当前专注名 → 判断是否 ∈ 展开集合
//     执行段  ApplyFocus 拿 preset token → 得到本机名候选数组 → 逐个试开
//   同一份数据，两种用法。表名跟随 source 是为了让守卫端零对照。
//
// ⭐ 本文件相对 DEVICE-ABSTRACTION §2.2 做了一处【结构修正】(Ivan 已确认):
//    原设计是"类别表 + 具体App表"两张平表并列, 同一个 bundle id 要写两遍
//    (com.autonavi.amap 既在 maps 里又在 amap 里) —— 同一事实两处维护, 违背单一变更点。
//    现改为两层组合:
//      APPS   原子层: 一个 App 一行, bundle id 全系统【只写一次】, 按 platform 分表
//      GROUPS 类别层: 只写成员 token, 【不含任何平台标识】→ 天然平台无关
//    下发前 buildResolve 把两层拍平成上面的线格式 —— 手机端零感知, 契约不变。
//    收益: ① 加一个 App = 原子层加一行 + 类别加一个 token 名, bundle id 不重复
//          ② 加安卓只需填原子层, GROUPS 直接复用(apple_maps 不在安卓表里就自动消失,
//             正是 §2.2 规则2「只列该平台真实存在的」+ 规则3「查不到=空展开」)
//          ③ guards 写 ["maps"] 或 ["amap"] 都行, 粒度随时切换, 表里早已备好, 不返工
//
// 数据即扩展: 加语言/加 App/加平台 = 本文件加行, 零代码零手机改动。
// ─────────────────────────────────────────────────────────────────────────────

// ── Focus 显示名（P2 实测表 2026-07-16 冻结为种子; key = 系统语言下的显示名原文）──
// 注: 内置专注的名字随系统语言变, 所以需要这张表; 用户【自建】的自定义专注名不随语言变
//     —— 想彻底免维护, 可自建一个自定义专注替代内置勿扰, 表里加一行固定名即可(KERNEL §7)。
export const FOCUS_NAMES = {
  en: {
    "Do Not Disturb": "do_not_disturb", "Sleep": "sleep", "Personal": "personal",
    "Work": "work", "Driving": "driving", "Reduce Interruptions": "reduce_interruptions",
  },
  zh: {
    "勿扰模式": "do_not_disturb", "睡眠": "sleep", "个人": "personal",
    "工作": "work", "驾驶": "driving", "减少干扰": "reduce_interruptions",
  },
  ja: {
    "おやすみモード": "do_not_disturb", "睡眠": "sleep", "パーソナル": "personal",
    "仕事": "work", "運転中": "driving", "集中モード": "reduce_interruptions",
  },
  ko: {
    "방해 금지": "do_not_disturb", "수면": "sleep", "개인": "personal",
    "업무": "work", "운전 중": "driving", "방해 줄이기": "reduce_interruptions",
  },
};

// ── 原子层: App token → 该平台的本地标识 ──────────────────────────────────────
// ⚠️ 纪律(沿用 workdays-core 的数据铁律): 标识符是【实测数据, 不是记忆】。
//    下表只登记高置信度条目; 其余一律留空并由 Ivan 用下面的采集法实测后补入。
//    宁可表不全, 不可写错 —— 写错的后果是守卫【静默失效】(见文末"表不全的后果")。
//
// 📱 采集法(30 秒, 每个 App 一次):
//    新建快捷指令 → ① Get Current App → ② Bundle Identifier → ③ Show Result
//    设为"共享表单"或加到主屏; 打开目标 App 后运行, 弹出的就是它的 bundle id。
//    (若 Get Current App 在前台取不到自身, 改用: 打开目标 App → 从后台运行该指令。)
export const APPS = {
  ios: {
    // 导航/地图 —— 高置信度
    apple_maps:  "com.apple.Maps",
    google_maps: "com.google.Maps",
    amap:        "com.autonavi.amap",       // 高德地图
    baidu_maps:  "com.baidu.BaiduMap",      // 百度地图

    // 视频 —— 高置信度
    youtube:     "com.google.ios.youtube",
    netflix:     "com.netflix.Netflix",
    // ⬇ 待实测补入(按采集法取到后填这里, 再把 token 加进下方 GROUPS.video)
    // bilibili:      "",                   // 哔哩哔哩
    // iqiyi:         "",                   // 爱奇艺
    // tencent_video: "",                   // 腾讯视频
    // youku:         "",                   // 优酷

    // 音乐 —— 高置信度
    apple_music: "com.apple.Music",
    spotify:     "com.spotify.client",
    // ⬇ 待实测补入
    // netease_music: "",                   // 网易云音乐
    // qq_music:      "",                   // QQ音乐
  },

  // 安卓: 空壳 + 注释(Ivan 已确认建空壳)。到时只填本层, GROUPS 无需任何改动 ——
  // 这正是两层拆分的收益。安卓包名与 iOS 完全不同, 例: 高德安卓是 com.autonavi.minimap。
  android: {},
};

// ── 类别层: 只写成员 token, 不含任何平台标识 → 平台无关, 加平台时零改动 ─────────
// 成员写全无妨: 某 token 在该平台的 APPS 表里没有 → 拍平时自动跳过(空展开语义)。
export const GROUPS = {
  maps:  ["apple_maps", "google_maps", "amap", "baidu_maps"],
  video: ["youtube", "netflix", "bilibili", "iqiyi", "tencent_video", "youku"],
  music: ["apple_music", "spotify", "netease_music", "qq_music"],
};

/**
 * focus preset token → 本机显示名候选数组（按 ?locales= 的顺序 = 优先级）。
 * ⚠️ 【已删除】反查表 name_to_token —— 守卫改成"成员判断"后不再需要反查:
 *    旧: 把当前专注名翻译成 token 再比较（需要反查表，且翻译失败就哑火）
 *    新: 把 guard 里的 token 展开成本机名集合，判断当前名是否 ∈ 集合
 *    好处: 与 app 守卫【完全同构】(都是 token→标识数组→成员判断)，手机端一套逻辑吃两种源。
 */
export function buildFocusTable(localesParam) {
  if (!localesParam) return null;
  const token_to_name = {};
  let hit = false;
  for (const loc of String(localesParam).toLowerCase().split(",")) {
    const key = loc.trim().split("-")[0];              // zh-CN → zh
    const tbl = FOCUS_NAMES[key];
    if (!tbl) continue;
    hit = true;
    for (const [name, token] of Object.entries(tbl)) {
      (token_to_name[token] ||= []);
      if (!token_to_name[token].includes(name)) token_to_name[token].push(name);
    }
  }
  // ── 语义 token `none` = 【当前没有任何专注】────────────────────────────────
  // 依据: PHONE §3 G11 / §7 F24 —— `Get Current Focus` 在无专注时返回【空】。
  // 于是"无专注"在本机的投影就是空字符串，它不随语言变（没有显示名可翻译）。
  // 用途: 守卫写 in:["none","sleep"] = "当前没专注、或已经是睡眠，才动手" ——
  //       手动开着别的专注时整条指令让路，不打破你的现场（KERNEL 契约3）。
  // 为什么仍然放在 locales 分支内（而不是恒发）: 若恒发，缺 ?locales= 时
  //   in:["none","sleep"] 会退化成"仅当无专注"且 match 非空 → 空展开告警不响 →
  //   静默少了一半语义。放在里面则整表缺失 → match 空 → 响亮告警（fail-loud 优先）。
  if (hit) token_to_name.none = [""];
  return hit ? token_to_name : null;
}

/** locked 恒等表: 让"无需展开"的源也走同一句展开逻辑，手机端零分支 */
export const LOCKED_TABLE = { true: ["true"], false: ["false"] };

/**
 * 拍平 APPS(原子) + GROUPS(类别) → { token: [平台标识...] }（恒为数组，§2.2 规则1）
 * · 原子 token: 长度 1 的数组
 * · 类别 token: 成员在本平台存在的那些标识之并集; 一个都不存在 → 该 token 不下发
 *   (等价于查不到 → 空展开 → in 拦截 / not_in 通过, §2.2 规则3 语义自动正确)
 * · 去重且保持 GROUPS 声明顺序（可预期, 便于对拍）
 */
export function buildAppTable(platform) {
  const atoms = APPS[platform];
  if (!atoms) return null;
  const out = {};
  for (const [token, id] of Object.entries(atoms)) {
    if (id) out[token] = [id];                          // 原子层: 单值也是数组
  }
  for (const [group, members] of Object.entries(GROUPS)) {
    const ids = [];
    for (const m of members) {
      const id = atoms[m];
      if (id && !ids.includes(id)) ids.push(id);         // 本平台不存在的成员自动跳过
    }
    if (ids.length) out[group] = ids;                    // 全空则不下发该类别 token
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 信封 resolve 节。`?platform=` 决定 app 表；`?locales=` 决定 focus_preset 表。
 * 两者互不影响（包名不本地化，显示名不随平台变）。
 * 返回 null = 无可下发内容，信封省略 resolve 节。
 */
export function buildResolve(platform, localesParam) {
  const node = { locked: LOCKED_TABLE };                 // 恒等表恒发（常量，零成本）
  const focus = buildFocusTable(localesParam);
  if (focus) node.current_focus = focus;                 // 表名 = 守卫 source 名
  const app = buildAppTable(platform);
  if (app) node.app = app;
  return node;
}

// ─────────────────────────────────────────────────────────────────────────────
// 表不全的后果（写在这里防止将来有人以为"少一行没关系"）:
//   guards 写 {source:"app", op:"not_in", value:["maps"]} 意为"这些 App 前台时别动手"。
//   若某导航 App 不在表里 → 它不参与展开 → 守卫【通过】→ 照常归零音量。
//   即: 表不全 = 守卫静默【少保护】, 不报错、不告警。这是采集法必须跑一遍的理由。
//   反向(表里多写一个不存在的 App)则无害: 永不匹配, 纯多余数据。
// ─────────────────────────────────────────────────────────────────────────────
