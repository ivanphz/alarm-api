# 06-OPERATIONS — 部署 · 密钥 · 推送 · 排错

> 最后更新 2026-07-31。**当前状态: 服务端就绪未部署。**

---

## 0. 本轮部署清单（按顺序做）

> ⛔ **部署前必查**：`config.user.js` 里 `AUTH_DISABLED: true` **必须改回 false**
> —— 它现在是开着的（调试用）。带着它上公网 = 任何人知道 URL 就能读你的日程与状态。

### 步骤 1: 只部服务端，先不开门铃

```bash
npx wrangler deploy
```

`config.user.js` 里：
```js
PUSH: { ENABLED: false },     // 先关，看清楚再开
```

部署后看三个端点：

| 端点 | 看什么 |
|---|---|
| `/v2/schema` | `automations` 段 —— **手机上要建哪些自动化** |
| `/v2/timeline?date=2026-08-05&debug=1` | 某天几点发生什么；`day_type` 四根轴对不对 |
| `/sweep/plan?hours=48&key=...` | 门铃时刻表。**平时应该是空的** |

⚠️ 手机上把刺客 **07:40 改成 07:44**。

### 步骤 2: 建通知自动化 + 开门铃

```bash
npx wrangler secret put PUSH_TARGETS      # 见 §推送配置
```
```js
PUSH: { ENABLED: true },
```

手机：自动化 → App → **收到通知 → 标题包含 `|SYNCALL|` → 运行 SyncAll**，
关掉「运行前询问」。

验证：造一个明天带具体时间的出差事件 → `/sweep/plan` 应列出解除时刻 → 等它触发。

### 步骤 3（可选）: 服务器提精度

只有嫌 cron 延迟大时才做。见 [07-ROADMAP](07-ROADMAP.md)。

---

## 0.1 推送配置

### 单目标（简单）

```bash
npx wrangler secret put BARK_KEY
```
```js
PUSH: { BASE_URL: "https://bark.你的域名" },   // 自建 Bark 服务端改这里
```

### 多目标 / 多平台（推荐，为将来留口）

```bash
npx wrangler secret put PUSH_TARGETS
```
值是一段 JSON：
```json
[
  { "driver":"bark", "base":"https://bark.你的域名", "key":"xxx", "note":"iPhone" },
  { "driver":"bark", "base":"https://bark.你的域名", "key":"yyy", "note":"iPad" },
  { "driver":"ntfy", "base":"https://ntfy.你的域名", "topic":"alarm", "note":"安卓" }
]
```

- **整个放 secret**，不放 `config.default.js` —— 那文件推代码时会被覆盖
- 各目标**并发推、各自失败各自记**，一个挂了不影响别的
- 加平台 = 加一个 driver 函数（只需实现 `send({title, body, level})`）
- 安卓推荐 **ntfy**（开源可自建，和 Bark 同思路）

### cron 间隔

`wrangler.toml` 的 `crons`。门铃延迟 = 0 ~ 一个 cron 间隔。

| 间隔 | 延迟 | Worker 请求/天 | 占免费额度 |
|---|---|---|---|
| `*/5 * * * *` | 0–5 分钟 | 288 | 0.3% |
| `* * * * *` | 0–60 秒 | 1440 | 1.4% |

**免费额度 100,000/天，怎么调都够。** 真正该在意的是 ICS 抓取频率 —— 已加边缘缓存
（`sources.js` 的 `CALENDAR_CACHE_TTL = 300` 秒），日历改动最多晚 5 分钟生效。

---

## 0.2 外部闹钟源

把别处的提醒（信用卡还款、订阅到期等）接进闹钟体系。

```js
EXTERNAL_ALARMS: {
  SOURCES: [
    { name:"信用卡", type:"ics", code:"repay",
      url:"https://xxx/repay.ics", enabled:true, leadDays:1 },
    { name:"签到",   type:"json", code:"checkin",
      url:"https://xxx/alarms.json", enabled:true },
  ],
}
```

- **公开 URL** 写 `config.user.js`；**带 token/隐私的**放 secret `EXTERNAL_ALARMS`（项格式相同）
- 每源独立 try + 5 秒超时，**一个挂了不影响别的**
- ⚠️ 任一源拉取失败 → 信封 `alarms.sweep = "false"` → 手机端**只做加法不 sweep**
  （否则会关光所有动态闹钟，见 [03-CONTRACT](03-CONTRACT.md) §2.0b）
- `code` 是稳定标识，会编进闹钟 label；**改 code = 旧闹钟被清、新的重建**

---

## 0.3 CI 工作流分工（谁在什么时候跑）

| 工作流 | 触发 | 干什么 |
|---|---|---|
| `test.yml` | **任何** push / PR | `npm test`（194 用例）。**改文档也跑** —— `docs.test.js` 检查的就是文档 |
| `deploy.yml` | 只在 `src/` `test/` `package*.json` `wrangler.toml` 改动时 | 先 `npm test`，**通过才部署** |
| `doorbell-image.yml` | 只在 `server/**` 改动时 | 构建门铃调度器镜像推 GHCR |
| `update-core.yml` | `workdays-core` 发版时（repository_dispatch） | 自动 bump 依赖 |

**两条设计考虑**：

1. **改文档不触发部署** —— 既省额度，也避免把一份内容完全相同的代码重新推上去。
2. **部署前必跑测试** —— Ivan 只用 GitHub 网页、没有本地环境，
   **CI 是唯一会执行 `npm test` 的地方**。少了这道闸门，194 个用例等于不存在。

> ⚠️ 2026-07-31 之前：`deploy.yml` 无 paths 过滤（改个错别字也部署），
> 且**没有任何工作流跑测试** —— 那批"机械保障"其实从未执行过。

---

## 1. 网关部署（Cloudflare Worker）

- [ ] **A1** 私有包作用域 `@ivanphz/workdays-core` 已全库固化，无需替换任何占位符。
- [ ] **A2** GitHub 仓库 Secrets（Settings → Secrets and variables → Actions）：
      `CF_API_TOKEN`、`CF_ACCOUNT_ID`（Cloudflare 部署凭据）、`GH_PAT`（读私有包）。
- [ ] **A3** Worker Secret（在 Cloudflare 侧，命令行一次）：
      `wrangler secret put CALENDAR_URLS`（家庭日历私密链接）。
      带 token 的外部闹钟源另配 `wrangler secret put EXTERNAL_ALARMS`
      （**必须是 JSON 数组字符串**，格式见 EXTERNAL-SOURCES §B1）。
      本地调试用 `.dev.vars`（已在 `.gitignore`，**绝不进 git**）。
- [ ] **A4** 鉴权：确认 `config.user.js` 里 `AUTH_DISABLED` 的取值符合你的部署。
      ⚠️ **当前仓库里是 `AUTH_DISABLED: true`（家庭内网自用）。公网部署务必删掉这行恢复鉴权**
      （fail-closed，别裸奔）。
- [ ] **A5** 先跑一次 update-core（见 §2）生成 `package-lock.json`，再让 deploy 跑
      （否则 `npm ci` 报缺 lockfile）。
- [ ] **A6** `wrangler.toml` 里 `keep_vars = true` —— CF 面板手填的变量不会被部署覆盖。

### 1.1 CI 加测试守门（建议）

`node --test` 是这个项目唯一的"本地"。在 `deploy.yml` 的 wrangler 步骤**之前**加一步：

```yaml
      - run: node --test
```

### 1.2 KV 绑定（启用 cadence / 事实流才需要）

CF 面板建 KV 命名空间 → `wrangler.toml` 取消注释并填 id：

```toml
[[kv_namespaces]]
binding = "FACTS_KV"
id = "<namespace id>"
```

不绑不影响其余功能（`cadence.ai_claude` 恒 null，`/v2/fact` 明确返回 `facts_storage_missing`）。
烟测：`POST /v2/fact` 一条 → `GET /v2/facts?stream=ai_claude` 能读回。

---

> ⚠️ **首次部署的顺序陷阱**：必须**先跑一次 update-core**（见 §2）生成 `package-lock.json`，
> 再让 deploy 跑。否则 `npm ci` 报缺 lockfile，构建直接失败。

## 2. 依赖库联动（workdays-core，GitHub Packages）

- [ ] **B1** core 仓库已首发（见 core 的 `INTEGRATION.md` §2.3）。
- [ ] **B2** 本仓库已有 `.github/workflows/update-core.yml`，且 `GH_PAT` Secret 已配。
- [ ] **B3** Actions → Update workdays-core → Run 一次 → 确认提交了 `package.json` 依赖 + `package-lock.json`。
- [ ] **B4** 联动验证：core 发一次 patch → 本仓库应自动 bump 提交 → deploy 自动触发。
      不动？多半是 PAT scope / dispatch event_type / paths 三者之一。
      ⚠️ update-core 的 checkout 必须用 `GH_PAT`——`GITHUB_TOKEN` 的 push **不会触发** deploy.yml。

---

## 3. 手机端（本地，落地关键）

> 逐动作装配见 **[04-PHONE](04-PHONE.md)**（唯一真相源）。这里只列上线勾选项。

- [ ] **C1** 预建全部 `GateFix-*` 固定闹钟（7 个 + 每条配了 `fixed` 锚的课一条
      `GateFix-Class-<id>`，时间 = `periods[fixed]`）。**每条在时钟 App 里配好时间、铃声、
      震动、Label**（Label 与 `config.FIXED_ALARMS` 逐字一致，大小写敏感）。
- [ ] **C2** 建快捷指令：`CheckGuards`（通用子指令，先建）、`ApplySilent`、`ApplyVolume`、
      `ApplyFocus`、`SyncAlarms`；可选 `RunAll`。
- [ ] **C3** 各 Apply\* 的 URL 填对，`&locales=` 首位 = 系统语言；
      **清掉测试残留的写死 `?now=`**。
- [ ] **C4** `last_applied` **每字段独立文件**（`la_silent.json` / `la_focus.json` / `la_volume.json`），
      路径**只填文件名**（预设根目录已是 Shortcuts，再写前缀会套娃）。
- [ ] **C5** SyncAlarms 的 sweep 前缀已收敛为**单一** `GateDyn-`
      （v0.7 起所有动态族同前缀，一扫全清；加新族不用再改手机端）。
      固定闹钟前缀 `GateFix-` 天然不进 sweep。
- [ ] **C6** 建边界刺客自动化：`DND.WHITELIST` 每个时刻各一条
      （07:44 / 09:30 / 12:15 / 13:29 / 20:55 / 22:25），每条在自己的计划分钟触发、
      带 `?mode=point&now=<该时刻>`。**必须关掉"运行前询问"**（否则后台不触发）。
- [ ] **C7** 清掉旧命名的手动预建闹钟（`Gate-Fixed-*` / `Gate-Class-*` 老名）。
      （v0.7 的改名对照表已随归档删除，需要时查 git history）

---

## 4. 冒烟测试（上线当天验一遍）

- [ ] **D1** 裸路径与带前缀等价：`/state` 与 `/v2/state`、`/timeline` 与 `/v2/timeline` 输出一致。
- [ ] **D2** 看 trace 里的 `router/params` 回显，确认 locales/platform 等参数**服务端确实收到**
      （URL 混进不可见字符会污染参数名，症状是专注开不起来，见 [08-LESSONS](08-LESSONS.md) §一）。
- [ ] **D3** `/v2/state?key=…&locales=zh,en&platform=ios` → 新信封（`version:"2"`，
      fields + alarms + resolve + trace）。**`alarms.sweep` 应是字符串 `"true"/"false"`**（`reconcile_alarms` 已退休）。
- [ ] **D4** `/v2/timeline?key=…&date=<明天>&now=00:00` → 带 schedules 与 field_timelines 的内脏视图。
- [ ] **D5** 手机手动跑一次各 Apply\*（前台）→ 专注/静音/音量按预期变化。
- [ ] **D6** 真实等一个刺客时刻**后台自动触发** → 用 Append-to-Note 探针确认后台也生效
      （前台正常 ≠ 后台正常，见 DEVLOG §1.3）。
- [ ] **D7** 造一个不在清单的假 `GateDyn-ES-test-uid-0900` 闹钟 → 跑 SyncAlarms → 应被 sweep 关掉。
- [ ] **D8** 连观察 3~5 天（尤其叫醒闹钟不能漏），无异常再算真正上线。

---

## 4.1 失败降级速查

出事时系统会怎样 —— **每一行都是刻意设计的，不是碰巧**：

| 出事 | 系统行为 |
|---|---|
| 某条日历 URL 拉失败 | 该日历跳过，其余照常，trace 告警 |
| 某个外部闹钟源超时/脏 | 该源跳过 + 记拒收计数；**`alarms.sweep=false`** → 手机只加不扫（否则会关光动态闹钟） |
| `workdays-core` 异常/空 | 退自然周末推演（调休失效），主流程仍出结果 |
| 任何未预料的内部异常 | 最外层兜底：**HTTP 200 + 合法降级响应**，fields 空 → 手机空转不误动 |
| 某次手机同步没跑成 | `GateFix-*` 常驻仍响；`GateDyn-*` 当次可能漏响（见 [01-CONCEPTS](01-CONCEPTS.md) §7.1） |
| 鉴权密钥缺失/错误 | 401 锁死（fail-closed，绝不静默裸奔） |
| `?locales=` 缺失 | 降级全语言兜底表 + 告警（**不瘫痪** —— 瘫痪比少保护糟） |
| 门铃推送失败 | 记 trace，等下一个入口；推是快路径，丢了退回现状 |

> **为什么内部异常返回 200 而不是 500**：手机端 fetch 拿到 500 会让整条同步失效；
> 200 + 空状态让手机「安全地什么都不做」。

---

## 5. 排错入口

### 5.1 看内脏

```
/v2/timeline?key=…&date=YYYY-MM-DD&now=HH:MM
```
返回里三样东西：`schedules`（各规则的原始时间线）、`field_timelines`（字段渲染后的边界）、
`trace`（结构化诊断）。**⚠️ 预览非今天的日期必带 `now=`**，否则闹钟窗口锚在真实此刻，
`fixed` 的开关状态会大面积"看起来不对"——那不是 bug。

### 5.2 常见 trace ref 速查

| ref | level | 含义 |
|---|---|---|
| `god_mode/god_json_invalid` | error | 上帝模式 JSON 写坏，该日回落常规（含日期与报错位置） |
| `sources/external_env_invalid` | error | `env.EXTERNAL_ALARMS` 非法 JSON，外部闹钟**整体失效** |
| `sources/external_failed` | warn | 某外部源拉取失败/超时，已跳过 |
| `assemble/external_filtered` | info | 外部候选被过滤的分类计数 |
| `sources/facts_kv_missing` | warn | FACTS_KV 未绑定，事实流全部降级 |
| `guards/bad_guard` | warn | 守卫声明非法（source/op 白名单外，或 in/not_in 的 value 不是数组），该条丢弃 |
| `audit/needs_doorbell` | info | 某边界不在刺客白名单 → 依赖门铃送达。**若 `PUSH.ENABLED=false` 则该刻永远送不出去** |
| `audit/unknown_rule_ref` | warn | 规则的 `at.from` 引用了不存在的规则名 → 时刻算不出，静默回落 fallback |
| `audit/morning_window` | warn | 晨间窗口终点与 `ZONES.MORNING.end` 不一致（两处应同源） |
| `resolve/locales_fallback` | warn | 缺 `?locales=` → 已降级全语言兜底表；功能不瘫痪但专注切换会变慢 |
| `guards/empty_match` | warn | 守卫展开为空 → `in` 永远拦截 / `not_in` 形同虚设 |
| `push/doorbell` · `push/plan_pushed` | info | 门铃已按 / 计划已推给服务器 |
| `push/doorbell_failed` · `push/plan_push_failed` | warn | 推送失败，退回等下一个入口 |
| `audit/*` 其余 | warn | 孤儿规则 / 悬空订阅 |

### 5.3 整体降级信封

任何未接住的异常 → **HTTP 200** + `error:"internal_degraded"` + fields 空 + reconcile false。
**为什么 200 不是 500**：手机端 fetch 拿到 500 会让整条同步失效；200 + 空状态让手机
"安全地什么都不做"（契约9 fail-closed）。看到这个信封就去看 `detail` 与 `trace`。

### 5.4 构建失败：`Could not resolve ...`

v1 那批文件已于 2026-07-27 全部删除，此类报错现在只可能来自**真正缺失的文件**。
交付前跑"从入口全图解析"校验（§6.6）：从 `src/index.js` 递归解析全部 import。
**当前基线：24 个本地文件可达。**

---

## 6. 交付纪律（给 AI 干活时附上）

1. **只交付新增/修改的单个文件**，不打包（除非明确要整包）。
2. 每个改动配 `node --test` 用例，**含一个反例**。
3. 改线上契约（信封/端点）必**同步更新 04-PHONE.md** 与相关文档。
4. 新术语/新字段先查 [09-KERNEL](09-KERNEL.md) §18 术语表，查无先补表。
5. 完成后自查 HANDOFF §2 不变量 + KERNEL §15 验收九条。**碰 `kernel/` 目录 = 选错了层**。
6. **交付含双轨（冻结 + 现役）的包，必须做"从入口全图解析"校验**——
   从 `src/index.js` 出发递归解析全部 import，确认无缺失文件。教训见 §5.4。

---

