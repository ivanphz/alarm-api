/**
 * ==============================================================================
 * ⚙️ config.default.js — 默认配置层（由维护者更新，你【不要】改这个文件）
 * ==============================================================================
 *
 * 这里是所有参数的"出厂默认值"。迭代规则/加功能时更新的是本文件，
 * 每次都可能被新版覆盖，所以【不要】在这里改你的个人参数。
 *
 * 想改判定时间、闹钟时间、DND 时间、寒假日期、关键字等 → 全部去 config.user.js。
 * 那里写了什么就以那里为准（深合并覆盖），没写的项自动继承本文件的默认值。
 * 你在 config.user.js 里的改动，我推代码永远不会碰。
 * ==============================================================================
 */

export const DEFAULT_CONFIG = {

  // 🔌 鉴权开关默认值: false = 正常鉴权。日常切换请改 config.user.js 里的同名项。
  AUTH_DISABLED: false,

  // ───────────────────────────────────────────────────────────────────────────
  // 系统基础
  // ───────────────────────────────────────────────────────────────────────────
  SYSTEM: {
    TIMEZONE: "Asia/Shanghai",
    WINDOW_START_DELAY_SECONDS: 15,   // 死区滤波: 窗口起点 = now+15s，防整点触发把"当前这分钟"误判为未来
    WINDOW_END_BUFFER_SECONDS: 15     // 前瞻冗余: 窗口终点 = now+24h+15s，吞噬网络时差
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 🔐 鉴权密钥【不在本文件里】—— 存 GATEWAY_KEY（Secret 或明文 vars 皆可）
  //    默认: 所有请求 URL 必须带 ?key=<该密钥>，否则一律 401（fail-closed，绝不裸奔）。
  //
  //    配置（一次性）:
  //      Secret 方式: npx wrangler secret put GATEWAY_KEY
  //      明文方式:    Dashboard → 变量和密钥 → 添加 → 类型选"文本" → 名称 GATEWAY_KEY
  //                  （用明文 vars 时，wrangler.toml 必须有 keep_vars=true，否则部署被删）
  //    本地调试(.dev.vars 里补一行，该文件已被 .gitignore 忽略):
  //      GATEWAY_KEY=你的密钥
  //
  //    临时关闭鉴权(联调图方便，输网址即可): 加一个变量 AUTH_DISABLED=true。
  //      ⚠️ 这是"需主动打开"的开关；只删 GATEWAY_KEY 不会裸奔，会 401 锁死(安全方向)。
  //
  //    手机端 7 个快捷指令(搬运工 + 6刺客)的 URL 末尾统一加 ?key=你的密钥；
  //    浏览器调试时也要拼上 &key=你的密钥。
  //    密钥想换: 改 GATEWAY_KEY 的值，并把手机上 7 个 URL 同步改掉。
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // 数据源
  //
  // 🔐 家庭日历订阅链接【不在本文件里】—— 属于隐私数据，不能进 GitHub 公网仓库。
  //    它存放在 Cloudflare Worker Secret 中，变量名: CALENDAR_URLS
  //    多条链接用【英文逗号】或【换行】分隔，index.js 启动时自动读取拆分。
  //
  //    值的写法很宽容，以下都能识别:
  //      单条:      https://a.ics
  //      多条:      https://a.ics, https://b.ics  （逗号/分号/换行/空格任意混合分隔）
  //      JSON数组:  ["https://a.ics","https://b.ics"]
  //    自动去首尾空白、剥引号方括号，只保留 http(s) 开头的项。
  //
  //    ① 线上配置（一次性，执行后粘贴链接回车 + Ctrl-D 结束）:
  //         npx wrangler secret put CALENDAR_URLS
  //       或在 Cloudflare 控制台: Worker → Settings → Variables and Secrets →
  //       Add → 类型选 Secret → 名称 CALENDAR_URLS → 值粘贴链接（逗号分隔）
  //
  //    ② 本地调试（wrangler dev 用）: 项目根目录建 .dev.vars 文件，内容一行:
  //         CALENDAR_URLS=链接1,链接2,链接3
  //       该文件已列入 .gitignore，永远不会被 git 提交。
  // ───────────────────────────────────────────────────────────────────────────
  // (节假日数据源已迁入 workdays-core 私有库, 换源=core 发 patch, 本仓库零改动。)

  // ───────────────────────────────────────────────────────────────────────────
  // 固定闹钟注册表（共 7 个）
  //
  // ⚠️ 必须提前在 iPhone「时钟」App 中手工建好这 7 个闹钟:
  //    时间、铃声、震动模式、标签(Label) 都在手机上设置，
  //    快捷指令只能按 Label 找到闹钟做 开/关，无法修改任何属性。
  //
  // 📌 关于 scheduledAt（务必看懂，否则会被它误导）:
  //    · 闹钟【真正响几点】由手机本地那条闹钟决定 —— 这才是唯一真相源。
  //      要改响铃时间 → 直接改手机上的闹钟即可，【改这里的 scheduledAt 不会改变手机闹钟】。
  //    · scheduledAt 是那个时间在【代码侧的镜像】，仅用于两件事:
  //        ① 24h 窗口布防判断(决定这条铃提前多久 ON)  ② humanReadable 面板显示。
  //    · 这里是该时间在【整个代码里的唯一存放处】: rules.js / school-break.js 的日志
  //      都用 ftime() 从这里动态取值，不再另存字面时间。所以你只需改这一处。
  //    · 纪律: 在手机上改了闹钟时间，请顺手把这里的 scheduledAt 改成一样(纯为镜像忠实，
  //      不影响开关功能)，否则窗口判定与面板显示会和现实偏离。
  //
  // 命名规范: GateFix-[场景]-[用途]-[类型]
  //   Workday      = 普通工作日        FirstWorkday = 节后第一个工作日
  //   SchoolBreak  = 寒暑春秋假        Vib = 震动    Ring = 响铃
  // ───────────────────────────────────────────────────────────────────────────
  FIXED_ALARMS: [
    { label: "GateFix-Workday-WakeUp-Vib",       scheduledAt: "06:25", desc: "普通工作日起床·震动(先头)" },
    { label: "GateFix-Workday-WakeUp-Ring",      scheduledAt: "06:29", desc: "普通工作日起床·响铃(+4min兜底)" },
    { label: "GateFix-FirstWorkday-WakeUp-Ring", scheduledAt: "07:38", desc: "节后首个工作日·额外兜底响铃(与 Workday 起床组并行)" },
    { label: "GateFix-SchoolBreak-WakeUp-Vib",   scheduledAt: "07:20", desc: "寒暑假起床·震动(先头)" },
    { label: "GateFix-SchoolBreak-WakeUp-Ring",  scheduledAt: "07:24", desc: "寒暑假起床·响铃(+4min兜底)" },
    { label: "GateFix-Workday-NapEnd-Vib",       scheduledAt: "13:30", desc: "工作日午休结束·震动" },
    { label: "GateFix-Workday-OffWork-Vib",      scheduledAt: "17:28", desc: "工作日下班·震动" }
  ],

  // 联动开关: 主铃 ON 时副铃一并 ON（震动先响、响铃兜底，时差已在手机预设时间里体现）
  BUNDLED: {
    "GateFix-Workday-WakeUp-Vib":     "GateFix-Workday-WakeUp-Ring",
    "GateFix-SchoolBreak-WakeUp-Vib": "GateFix-SchoolBreak-WakeUp-Ring"
  },

  // 晨间闹钟组（被 LEAVE / WORK_EVENT 晨间碰撞时统一关闭的固定 Label 集合）
  MORNING_LABELS: [
    "GateFix-Workday-WakeUp-Vib",
    "GateFix-Workday-WakeUp-Ring",
    "GateFix-FirstWorkday-WakeUp-Ring",
    "GateFix-SchoolBreak-WakeUp-Vib",
    "GateFix-SchoolBreak-WakeUp-Ring"
  ],

  // ───────────────────────────────────────────────────────────────────────────
  // 动态闹钟（脚本新建，系统默认样式，无法自定义铃声/震动）
  //
  // 来源: 工作事件晨间碰撞新建的唤醒闹钟(GateDyn-Event) + 周末上课(Gate-Class)。
  // （上课闹钟 V11.1 起也是动态 GateDyn-Class-*，见 WEEKEND_CLASS。）
  //
  // 命名: 基名 + 响铃时间(HHMM)，如 06:10 事件 → "GateDyn-Event-0610"
  //   为什么把时间编进名字: 让每个时间点的闹钟有唯一身份，快捷指令靠"名字集合比对"
  //   做幂等对账，不用读闹钟时间做比较。（编日期没用且会破坏窗口内匹配，只编时间。）
  //
  // 生命周期【幂等对账】(绕开 iOS 删除闹钟的确认弹窗，且不产生"建了关关了建"的抖动):
  //   每次同步不再"全关再重建"，而是拿网关的目标清单和手机现有闹钟对账:
  //     · 目标里有、手机上已存在同名 → 保持开启（不动，无抖动）
  //     · 目标里有、手机上没有       → 新建（开启）
  //     · 手机上有、目标里没有(已取消/已过期) → 关闭（静默，不删除）
  //   响过的一次性闹钟 iOS 自动关闭，作为"关闭僵尸"留存不响，由手动「大扫除」定期清理。
  // ───────────────────────────────────────────────────────────────────────────
  DYNAMIC_LABELS: {
    EVENT: "GateDyn-Event"   // 事件闹钟基名，实际标签追加 -HHMM
  },

  // 上课闹钟的两种标签（同一节课可能走其中之一，取决于当天时段时间是否==锚时段时间）
  //   FIXED   预建可开关: GateFix-Class-<id>       ← 需手机预建，常驻可靠，不进 sweep
  //   DYNAMIC 网关动态建: GateDyn-Class-<星期>-<id>-<HHMM> ← 无需预建，时间编入标签，进 sweep
  CLASS_LABELS: {
    FIXED:   "GateFix-Class",
    DYNAMIC: "GateDyn-Class"
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 周末上课配置 —— 时段化 + 能固定就固定，固定不了自动动态（V11.2）
  //
  // 【要解决的真实问题】同一节课，寒暑假和平时时间常常不同；而 iOS 固定闹钟一个 label
  // 只能焊死一个时间。于是：用 fixed 指定"以哪个时段为锚"，锚时段的时间 = 你在手机预建的
  // 那条固定闹钟的时间；**凡是时间和锚相同的时段都复用这条固定闹钟(可靠常驻)，
  // 时间不同的时段自动降级走动态**。可靠与可变时间不再打架。
  //
  // 字段:
  //   day     JS 星期数字 (0=周日, 6=周六)
  //   id      稳定身份(进标签)，如 "sat-dance"。用稳定 id 不用序号，增删课不错位
  //   name    中文名，仅日志用
  //   periods 各【时段】的上课时间。键 = "normal"(非假期) 或 SCHOOL_BREAK 区间的 key
  //           (summer/winter/spring/autumn…)。
  //           ★ 没配的时段 = 那天不上课（不发任何闹钟）。无法归类的日子按 normal。
  //   fixed   可选。值 = 锚时段名(如 "normal"/"winter")。含义:
  //           · 你已在手机预建一条 GateFix-Class-<id>，时间 = periods[fixed]
  //           · 当天时段时间 == periods[fixed] → 走【固定】(开这条预建闹钟，常驻可靠)
  //           · 当天时段时间 != periods[fixed] → 走【动态】GateDyn-Class-<星期>-<id>-<HHMM>
  //           不写 fixed = 该课全部时段都走动态
  //
  // ⚠️ 固定那条的时间【真相在手机】: periods[fixed] 只是镜像 + 用于"该时段能否复用固定"判定。
  //    在手机改了 GateFix-Class-<id> 的时间，务必把 periods[fixed] 同步改，否则判定错位。
  //
  // 跳课条件（不发该课闹钟，trace 写明原因）:
  //   ① 当天时段未在 periods 里配时间
  //   ② 当天所在连续休息块 ≥ LONG_REST_DAYS（法定长假/全天请假拼周末）
  //   ③ 晨间碰撞（如周六上午请假）→ 落在晨间的课被清掉
  // ───────────────────────────────────────────────────────────────────────────
  WEEKEND_CLASS: {
    ENABLED: true,
    SCHEDULE: [
      // 舞蹈课: 平时/暑假都 07:45(复用固定)，寒假 08:45(时间不同→自动动态)
      { day: 6, id: "sat-dance", name: "舞蹈课",
        periods: { normal: "07:45", summer: "07:45", winter: "08:45" },
        fixed: "normal" }        // 手机预建: GateFix-Class-sat-dance @07:45

      // 示例·全动态(不预建任何闹钟):
      // { day: 0, id: "sun-calligraphy", name: "书法课",
      //   periods: { normal: "09:00", summer: "08:30" } }
    ]
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 碰撞时间段（LEAVE / WORK_EVENT 事件按此三区逐段判定影响范围）
  //   晨间: 事件开始时间 ≤ MORNING.end          → 关早间闹钟组
  //   午休: 事件与 [NOON.start, NOON.end] 重叠  → 关午休铃 + 静默午间DND
  //   傍晚: 事件结束时间 > EVENING.start        → 关下班铃
  //   全天事件（无具体时分）= 三区全部命中
  // ───────────────────────────────────────────────────────────────────────────
  ZONES: {
    MORNING: { start: "06:00", end: "08:00" },
    NOON:    { start: "12:15", end: "13:15" },
    EVENING: { start: "15:59", end: "17:30" }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // DND 勿扰体系
  //
  // ⚠️ 铁律: 网关只允许输出 WHITELIST 里的时间键。
  //    每个键对应 iPhone 上一条「特定时间」自动化（刺客）。
  //    刺客到点读 JSON: 有键按键执行 ON/OFF，无键 = 静默装死（不开也不关）。
  //    输出白名单之外的时间没有刺客接收，纯属无效指令，代码层已做校验拦截。
  //    如果你想把早间解除从 07:40 调到 07:50: 改这里的常量 + 手机上把刺客
  //    自动化的触发时间同步改掉，两边一致才生效。
  // ───────────────────────────────────────────────────────────────────────────
  DND: {
    NIGHT_ON_WORKDAY_EVE: "20:55",   // 明天上班 → 今晚提前静音
    NIGHT_ON_REST_EVE:    "22:25",   // 明天休息 → 今晚晚点静音
    MORNING_OFF_WORKDAY:  "07:40",   // 工作日早间解除（含出差日/半天假的正常上班半天）
    MORNING_OFF_WEEKEND:  "09:30",   // 普通周末(块<3天)早间解除
    NOON_ON:  "12:15",               // 工作日午休静音
    NOON_OFF: "13:29",               // 工作日午休解除
    WHITELIST: ["20:55", "22:25", "07:40", "09:30", "12:15", "13:29"]
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 设备状态引擎 DEVICE —— 【每个字段是独立个体，谁也不依附谁】
  //
  // 结构: 每个字段一节，各自拥有: ①自己的规则 ②自己的独立时刻表 OWN。
  //   最终时刻表 = 所有字段时刻的并集，逐时刻逐字段独立求值，无值=null=手机不动。
  // 匹配双模式(手机URL ?mode= 可覆盖默认):
  //   point   时点: 只在时刻键±容差内命中(适合定时刺客精确触发)
  //   segment 时段: 每字段独立回看最近一次取值,区间用前一状态填满(可跨昨天)
  //           → 手机重启/手动跑一次 = 恢复当前应有的完整状态(手动同步模式)
  // 加新字段: device-state.js 的 FIELD_REGISTRY 加一行 + 这里加一节 + 手机加 ApplyXxx。
  // ───────────────────────────────────────────────────────────────────────────
  DEVICE: {
    // 默认匹配模式: "point"(时点) 或 "segment"(时段)。URL ?mode=point|segment 随时覆盖。
    STATE_MODE_DEFAULT: "point",

    // 时点模式容差(分钟, 前后独立): 键已过去多少分钟内仍算命中 / 键还有多少分钟到也算命中
    POINT: { PAST_TOLERANCE_MIN: 3, FUTURE_TOLERANCE_MIN: 3 },

    // 时段模式: LOOKBACK_HOURS 回溯窗口(26h保证跨过昨晚) / FUTURE_SNAP_MIN 向前吸附(分钟)
    //           SYNC_ALARMS: 时段模式(状态重建)是否顺带跑一次闹钟对账(建议true)
    SEGMENT: { LOOKBACK_HOURS: 26, FUTURE_SNAP_MIN: 0, SYNC_ALARMS: true },

    // ── 字段注册表 FIELDS —— 每个字段声明: 订阅哪张规则 + 怎么微调 + 输出形态 ──
    //
    //   规则(schedule)由引擎产出、命名(见 device-state.js SCHEDULE_NAMES, 当前只有 "dnd")。
    //   字段用四个正交旋钮描述自己, 彼此零依赖(删任一字段不影响其它):
    //     KIND   "focus"=输出 focus 对象(带 mode/守卫/switch_to); "scalar"=输出标量或 null
    //     USE    订阅哪张规则名; null=不订阅, 只吃自己的 OWN
    //     MAP    规则值→本字段值 的映射(缺省恒等); 例 { ON:"ON", OFF:"OFF" }
    //     SKIP   复用规则但屏蔽这些时刻; 例 silent 不碰午间 12:15/13:29
    //     OWN    本字段独立时刻(最高优先级, 叠加/覆盖规则; 支持 falsy 0/空串)
    //            focus 的 OWN 见下方写法; scalar 的 OWN 值就是最终标量
    //
    //   👉 silent 与 focus 都 USE "dnd" = 复用同一张规则, 但互不依赖:
    //      删掉 focus 整节, silent 仍从 dnd 正常渲染。想让某字段独立→改它的 USE。
    //      没有字段 USE 某规则时, 审计日志会把它标为孤儿(可删)。
    FIELDS: {

      // focus(勿扰/专注): 订阅 dnd, 渲染成 focus 对象。MODE_NAME 必须是 iOS 真实 focus 名。
      //   OWN 写法(每时刻定制的唯一入口, 逐字段与规则合并):
      //     "22:00": "ON"                                  简写: 独立时刻直接开/关
      //     "07:40": { only_if_current: "Do Not Disturb" } 给规则动作挂守卫(action 继承规则)
      //     "23:30": { mode: "Sleep", action: "ON" }       独立时刻开别的 focus
      //     "13:29": { action: null }                      压制该时刻的规则动作(这个点闭嘴)
      //     "08:00": { action: "OFF", switch_to: "" }      预留: 清场语义(手机端识别 switch_to)
      focus: {
        KIND: "focus",
        USE: "dnd",
        MODE_NAME: "Do Not Disturb",
        OWN: {}
      },

      // silent(静音): 复用 dnd(与 focus 无关), 屏蔽午间。想解耦→USE 改别的规则或 null。
      //   MAP 缺省恒等(ON→静音开, OFF→静音关)。OWN: { "05:00": "ON" } 可任意时刻独立开关。
      silent: {
        KIND: "scalar",
        USE: "dnd",
        SKIP: ["12:15", "13:29"],
        OWN: {}
      },

      // media_volume(媒体音量): 不订阅任何规则(USE:null), 完全独立, 只吃 OWN。
      //   值域 0~1(手机端 Set Volume 按分数)。这些时刻归零, 想加时刻直接在 OWN 加一行。
      media_volume: {
        KIND: "scalar",
        USE: null,
        OWN: { "07:40": 0, "12:15": 0, "13:29": 0, "20:55": 0 }
      }
    },

    // ── 闹钟同步锚点 —— 特殊者(闹钟是前瞻性的,与即时状态不同) ────────────────
    //   这些时刻 sync_alarms:true,刺客读到就跑一次 SyncAlarms 对账。每天雷打不动。
    SYNC_ALARMS: {
      KEYS: ["07:40", "13:29", "22:25"]
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 外部闹钟源 EXTERNAL_ALARMS —— 乙方项目算好的【具体闹钟点】→ 手机闹钟
  //
  // 【定位/甲方规矩】只做"具体点搬运工": 收具体 date+time → 24h 裁剪 → 幂等对账。
  //   不做排期/循环/业务计算(工作日、间隔、自然月去重、跳节假日…由乙方算好再喂进来)。
  //   简单重复(每周/每月固定日)请用 iPhone 时钟 App 建重复闹钟, 不走此接口。
  // 【准入 = 强制识别; 完整对接契约见 docs/external-alarms.md, 内部机制见 external-alarms-internal.md】
  //   ICS : 事件【任意字段】放标签 [[ES:uid]](标题/备注/分类/X- 皆可, 括号在即准入,
  //         内含 uid; 裸 [[ES]] 回退 VEVENT 原生 UID)。markPattern 可覆盖默认正则。
  //   JSON: 每条必带 uid 字段。
  //   标签 = GateDyn-ES-<code>-<uid>-<HHMM>; 时间由【网关】拼(乙方uid不含时间)——手机端只能按名
  //   比对、无"改闹钟时间"动作, 故时间入label: 改时间→label变→旧的对账关闭、新时间重建。
  //   时区默认 Asia/Shanghai(可 Z/TZID/tz 换算); 只发未来24h。
  // 隐私分流: 公开 URL → SOURCES(明文); 带 token/隐私 → Secret env.EXTERNAL_ALARMS(项格式同)。
  //
  // 源字段: { name, type:"json"|"ics", url, code, enabled,
  //           markPattern?(ICS,覆盖识别正则), allDay?("skip"|"default"|"error",默认default),
  //           time?(全天兜底,默认09:30), tz?(默认Asia/Shanghai), timeoutMs?(默认5000) }
  // ───────────────────────────────────────────────────────────────────────────
  EXTERNAL_ALARMS: {
    SOURCES: [
      // { name: "签到",   type: "json", code: "checkin", url: "https://xxx/alarms.json", enabled: true },
      // { name: "信用卡", type: "ics",  code: "repay",   url: "https://xxx/repay.ics",
      //   allDay: "default", time: "09:30", enabled: true }
    ]
  },


  // ───────────────────────────────────────────────────────────────────────────
  // 日历关键字（必须用 [方括号] 包裹写在事件标题里，如 "[年假]全家出游"）
  //
  // 两组制，底层区别 = 上班 or 不上班:
  //   LEAVE      = 不上班（睡觉自由）: 碰撞关闹钟，不建动态闹钟，
  //                全天 LEAVE 计入休息块长度，DND 按休假决策树（rules.js R6.2）
  //   WORK_EVENT = 特殊形式的上班    : 碰撞关固定闹钟，晨间碰撞且有具体时间时
  //                新建 GateDyn-Event 叫你起床干活，早间 DND 照常 07:40
  //   GOD_MODE   = 完全手动接管当天（事件 DESCRIPTION 填 JSON，格式见 rules.js R1）
  // ───────────────────────────────────────────────────────────────────────────
  KEYWORDS: {
    GOD_MODE:   ["上帝模式", "JSON"],   // 完整用法/可复制模板见 docs/god-mode.md
    LEAVE:      ["休假", "请假", "年假"],
    WORK_EVENT: ["出差", "会议", "外勤", "风勘", "覆盖", "晚到", "早到", "早起"]
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 学校假期（寒/暑/春/秋假统一在 RANGES 里配置）
  //
  // 日期格式两种:
  //   "MM-DD"      = 每年重复（如暑假固定 07-01 ~ 08-31）
  //   "YYYY-MM-DD" = 特定年份（寒假每年不同，逐年填）
  //   单日假期: start = end 即可
  // EXCLUDE = 在假期里"挖洞"，洞里的日子不当假期（返校周/假期补课周）
  // 作用: 工作日起床铃从 Workday 组换成 SchoolBreak 组(各铃时间见 FIXED_ALARMS)，
  //       并废弃 FirstWorkday 首日并行逻辑；周末上课闹钟自动跳过。
  // ───────────────────────────────────────────────────────────────────────────
  //
  // ★ key = 英文稳定标识，是【课表 WEEKEND_CLASS.periods 的匹配契约】。
  //   同一类假期(如每年寒假)用同一个 key，name 可带年份随便写。
  //   常用: summer / winter / spring / autumn，新增假期自取即可(课表配上同名 key 就穿透)。
  // ───────────────────────────────────────────────────────────────────────────
  SCHOOL_BREAK: {
    RANGES: [
      { start: "07-01",      end: "08-31",      key: "summer", name: "暑假(每年固定)" },
      { start: "2026-01-20", end: "2026-02-15", key: "winter", name: "2026寒假" },
      { start: "2027-01-20", end: "2027-02-15", key: "winter", name: "2027寒假" }
      // { start: "2026-04-29", end: "2026-04-30", key: "spring", name: "春假示例" },
      // { start: "2026-11-12", end: "2026-11-12", key: "autumn", name: "秋假单日示例(start=end)" }
    ],
    EXCLUDE: [
      // { start: "2026-08-25", end: "2026-08-31", name: "暑假末返校周示例" }
    ]
  },

  // 手动整休息日（"YYYY-MM-DD"）: 校庆日/教研日/API数据出错兜底。
  // 效果等同法定假日: 当天无任何工作闹钟、计入休息块、参与跳课判定。
  // 目前留空，是与 SCHOOL_BREAK 不同的口子（SCHOOL_BREAK 只是换起床铃，这个是彻底放假）。
  MANUAL_HOLIDAYS: [],

  // 长休阈值: 连续休息块 ≥ 此天数 → 视为长假
  // 触发: ①周末上课跳课 ②早间 DND 解除键不输出(全手动，绝不吵醒)
  // 普通双休 = 2 天，永不触发
  LONG_REST_DAYS: 3
};
