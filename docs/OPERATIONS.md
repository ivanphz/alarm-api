# OPERATIONS.md — 部署 · 密钥 · 冒烟 · 排错 · 交付纪律

> 由 v1 时代的 `DEPLOY-CHECKLIST.md` 与一次性的 `DEPLOY-V12.md` 合并而来，已更新到 V12/v2。
> 从零到跑通按 §1→§4 勾；日常排错看 §5；交给 AI 干活看 §6。

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

## 2. 依赖库联动（workdays-core，GitHub Packages）

- [ ] **B1** core 仓库已首发（见 core 的 `INTEGRATION.md` §2.3）。
- [ ] **B2** 本仓库已有 `.github/workflows/update-core.yml`，且 `GH_PAT` Secret 已配。
- [ ] **B3** Actions → Update workdays-core → Run 一次 → 确认提交了 `package.json` 依赖 + `package-lock.json`。
- [ ] **B4** 联动验证：core 发一次 patch → 本仓库应自动 bump 提交 → deploy 自动触发。
      不动？多半是 PAT scope / dispatch event_type / paths 三者之一。
      ⚠️ update-core 的 checkout 必须用 `GH_PAT`——`GITHUB_TOKEN` 的 push **不会触发** deploy.yml。

---

## 3. 手机端（本地，落地关键）

> 逐动作装配见 **`docs/PHONE.md`**（唯一真相源）。这里只列上线勾选项。

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
      （07:40 / 09:30 / 12:15 / 13:29 / 20:55 / 22:25），每条在自己的计划分钟触发、
      带 `?mode=point&now=<该时刻>`。**必须关掉"运行前询问"**（否则后台不触发）。
- [ ] **C7** 清掉旧命名的手动预建闹钟（`Gate-Fixed-*` / `Gate-Class-*` 老名）。
      改名对照表见 `_archive/RENAME-V0.7.md`。

---

## 4. 冒烟测试（上线当天验一遍）

- [ ] **D1** 老路径回归：打开原地址（不带前缀）→ 响应应与部署前**完全一致**（默认仍走 v1）。
- [ ] **D2** `/v1/…` 前缀路径 → 同上一致（剥前缀适配层）。
- [ ] **D3** `/v2/state?key=…` → 新信封（`version:"2"`，fields + alarms + reconcile_alarms + trace）。
- [ ] **D4** `/v2/timeline?key=…&date=<明天>&now=00:00` → 带 schedules 与 field_timelines 的内脏视图。
- [ ] **D5** 手机手动跑一次各 Apply\*（前台）→ 专注/静音/音量按预期变化。
- [ ] **D6** 真实等一个刺客时刻**后台自动触发** → 用 Append-to-Note 探针确认后台也生效
      （前台正常 ≠ 后台正常，见 DEVLOG §1.3）。
- [ ] **D7** 造一个不在清单的假 `GateDyn-ES-test-uid-0900` 闹钟 → 跑 SyncAlarms → 应被 sweep 关掉。
- [ ] **D8** 连观察 3~5 天（尤其叫醒闹钟不能漏），无异常再算真正上线。

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
| `audit/*` | warn | 孤儿规则 / 悬空订阅 / quiet 时刻不在 DND.WHITELIST |

### 5.3 整体降级信封

任何未接住的异常 → **HTTP 200** + `error:"internal_degraded"` + fields 空 + reconcile false。
**为什么 200 不是 500**：手机端 fetch 拿到 500 会让整条同步失效；200 + 空状态让手机
"安全地什么都不做"（契约9 fail-closed）。看到这个信封就去看 `detail` 与 `trace`。

### 5.4 构建失败：`Could not resolve ./v1-legacy.js`

/v1 冻结路径需要**五个文件**在 `src/` 根且文件名精确：
`v1-legacy.js`、`rules.js`、`rest-days.js`、`device-state.js`、`school-break.js`。
缺任一 → Cloudflare 构建期（解析全部 import）失败。
**单测不会暴露此问题**——用例只 import v2 的 router/plugins，永不走 legacy 分支。

---

## 6. 交付纪律（给 AI 干活时附上）

1. **只交付新增/修改的单个文件**，不打包（除非明确要整包）。
2. 每个改动配 `node --test` 用例，**含一个反例**。
3. 改线上契约（信封/端点）必**同步更新 PHONE.md** 与相关文档。
4. 新术语/新字段先查 KERNEL §18 术语表，查无先补表。
5. 完成后自查 HANDOFF §2 不变量 + KERNEL §15 验收九条。**碰 `kernel/` 目录 = 选错了层**。
6. **交付含双轨（冻结 + 现役）的包，必须做"从入口全图解析"校验**——
   从 `src/index.js` 出发递归解析全部 import，确认无缺失文件。教训见 §5.4。

---

## 7. 收口（v1 下线）

手机端全部改读 `/v2` 且稳定运行数日后：

1. `config.user.js` 加 `V2: { DEFAULT: true }` → 根路径切 v2。
2. 再稳定观察一段时间。
3. v1 择日下线：删 `v1-legacy.js` + `rules.js` + `device-state.js` + `rest-days.js`
   + `school-break.js`（根目录那份）。
   ⚠️ **`ics-parser.js` 与 `time-utils.js` 仍被 v2 复用，先留。**
