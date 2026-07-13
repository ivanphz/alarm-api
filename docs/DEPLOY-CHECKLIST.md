# 上线检查清单（独立可勾选）

> 从零到跑通，按顺序勾。分三段：**A 网关(Cloudflare)** · **B 依赖库联动(GitHub)** · **C 手机端(本地)**。
> 手机端细节见 `PHONE.md`。私有包作用域 `@ivanphz/workdays-core` 已固化，无需再替换。

## A. 网关部署（Cloudflare Worker）

- [ ] **A1** （包作用域 `@ivanphz/workdays-core` 已全库固化，无需替换任何占位符）。
- [ ] **A2** GitHub 仓库 Secrets（Settings → Secrets and variables → Actions）加：
      `CF_API_TOKEN`、`CF_ACCOUNT_ID`（Cloudflare 部署凭据）、`GH_PAT`（读私有包，见 INTEGRATION §2.2）。
- [ ] **A3** Worker Secret（在 Cloudflare 侧，命令行一次）：`wrangler secret put CALENDAR_URLS`
      （家庭日历私密链接；本地调试用 `.dev.vars`，格式见 `.dev.vars.example`，**绝不进 git**）。
      带 token 的外部闹钟源另配 `wrangler secret put EXTERNAL_ALARMS`（可选，见 external-alarms-internal）。
- [ ] **A4** 鉴权：确认 `config.user.js` 里 `AUTH_DISABLED` 的取值符合你的部署——
      **公网部署务必删掉 `AUTH_DISABLED:true` 恢复鉴权**（fail-closed，别裸奔）。
- [ ] **A5** 先跑一次 update-core（见 B）生成 `package-lock.json`，再让 deploy 跑（否则 `npm ci` 报缺 lockfile）。
- [ ] **A6** 部署后浏览器开带 key 的 URL，看返回 JSON 有 `current_state`、`humanReadable` 面板正常。

## B. 依赖库联动（workdays-core，GitHub Packages）

- [ ] **B1** core 仓库已首发（见 INTEGRATION §2.3，首发 major = v1.0.0）。
- [ ] **B2** 本仓库已有 `.github/workflows/update-core.yml`（本项目已含），且 `GH_PAT` Secret 已配。
- [ ] **B3** Actions → Update workdays-core → Run 一次 → 确认提交了 `package.json` 依赖 + `package-lock.json`。
- [ ] **B4** 联动验证：core 发一次 patch → 本仓库应自动 bump 提交 → deploy 自动触发。
      不动？查 INTEGRATION §8 故障表（多半是 PAT scope / dispatch event_type / paths）。

## C. 手机端（本地，落地关键）

- [ ] **C1** 预建 `Gate-Fixed-*` 全部固定闹钟（7 个 + 周六/周日起床铃），
      **每条在手机时钟 App 里配好时间、铃声、震动、Label**（Label 与 config.FIXED_ALARMS 逐字一致）。
- [ ] **C2** 导入/建好快捷指令：DNDTick、ApplyFocus、ApplyFocus-CheckFocusGuard、
      ApplySilent、ApplyVolume、SyncAlarms（结构见 PHONE.md）。
- [ ] **C3** DNDTick 里的 Worker URL 填对，**清掉测试残留的写死 `?now=13:29`**，
      改为由各时间自动化传入自己的计划时间（见 PHONE.md §2/§7）。
- [ ] **C4** DNDTick 三个 `Run Apply*` 确认**显式传入 `MyState`**（不是靠上一步输出串联）。
- [ ] **C5** DNDTick 读 `sync_alarms_flag`（不是旧的 `sync_alarms`），`If Text is yes` 才 Run SyncAlarms。
- [ ] **C6** SyncAlarms 的 sweep（关闭清单外闹钟）条件改成最终形态：
      **`名称 contains "Gate-Dynamic-Event" 或 "Gate-ES" 或 "Gate-Class"`**（Any，显式多前缀）。
      （已在旧的 Gate-Dynamic-Event 基础上加了 Gate-ES、Gate-Class。加新动态族时来这加前缀。）
- [ ] **C7** 建时间自动化「刺客」：DND.WHITELIST 每个时刻各一条（07:40/09:30/12:15/13:29/20:55/22:25…），
      每条在**自己的计划分钟**触发、Run DNDTick 并传入该时刻（见 PHONE.md §1）。
      **设为"运行时不询问"**（否则后台不触发）。
- [ ] **C8** 删掉手机上旧的手动预建 class 闹钟（如 `Gate-Class-Sat-Dance`），
      未来上课闹钟走动态（当前暂缓，见 DEVLOG §5.1）。

## D. 冒烟测试（上线当天验一遍）

- [ ] **D1** 浏览器 `?testDate=<工作日>&testTime=07:40` → `current_state.state.focus` 应为 DND 解除 + 守卫。
- [ ] **D2** 手机手动跑一次 DNDTick（前台）→ DND/静音/音量按预期变化。
- [ ] **D3** 真实等一个刺客时刻**后台自动触发** → 用 Append-to-Note 探针确认后台也生效（见 DEVLOG §2.3）。
- [ ] **D4** 拿一个不在清单的假 `Gate-ES-测试-uid-0900` 闹钟 → 跑 SyncAlarms → 应被 sweep 关掉。
- [ ] **D5** 连观察 3~5 天（尤其叫醒闹钟不能漏），无异常再算真正上线。
