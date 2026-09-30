# dsh-task-complete-sound

**English** | [中文](#dsh-web-gui-插件按事件分类的任务完成提示音--可选桌面通知)

A [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) Web GUI plugin that plays **synthesized notification cues when a task / agent turn completes** — no audio assets, no network requests — plus optional desktop notifications with click-to-jump, tab-title flashing, per-session muting, and quiet hours. Configuration syncs across browsers via the host settings namespace.

**Compatibility:** tested on dsh `0.1.7` and `0.2.0-rc.1` (web profile). The browser half targets the public `dsh.client` injection surface (`@deepseek-ai/dsh-client-runtime` / `@deepseek-ai/dsh-client-connection`); the optional source-classification feature degrades gracefully when the schedule bundle is absent.

## Features

- **Four event classes**, each with its own sound (or silence):

| Event | Trigger | Default sound |
|---|---|---|
| Turn end | a session's turn ends normally (mux `turn/end`, reason = completed / max-tokens / blocked); manual stops stay silent | Chime |
| Background done | a session finishes while not open (the sidebar's green "done" mark) | Ding |
| Approval pending | a tool request needs approval (**always audible**, exempt from quiet hours and burst merging) | Bubble |
| Error end | a turn ends with reason = error | Storm alarm |

- **8 synthesized tones** (Web Audio API: chime / ding / bell / bubble / shimmer / woodblock / storm alarm / silence) with per-event preview buttons
- **Desktop notifications** with click-to-jump-to-session, foreground suppression, and burst merging (2s tag buckets so rapid events are never silently swallowed)
- **Tab-title flashing** (✅ / ⚠️ / ⛔ prefixes) while the page is hidden
- **Quiet hours** (crosses midnight), **current-session muting**, and **mute by title keyword** (approvals & errors always get through)
- **Source classification**: notifications tell you whether the completion came from the main session, a subagent, or a scheduled automation task
- **处理结果行 (event trace)**: the settings card logs where each event went — played / muted / merged / gated — so "test works but real events don't" is always diagnosable
- **Config sync**: persisted through the host settings namespace, shared across browsers and the dsh desktop client (localStorage fallback)

---

<a id="dsh-web-gui-插件按事件分类的任务完成提示音--可选桌面通知"></a>
## 中文简介

DSH Web GUI 插件：**按事件分类的任务完成提示音 + 可选桌面通知**。当 GUI 里发生回合结束、后台完成、工具审批、错误结束四类事件时，播放 Web Audio 实时合成的提示音（无需音频资源、无网络请求），并支持桌面通知点击跳转会话、标签页标题闪烁、免打扰时段、按会话关键词静音、完成来源区分（主会话 / 子代理 / 自动化任务）、跨浏览器配置同步。功能明细与版本沿革见下方「版本沿革」。

## Install / 安装

Prerequisites: a running dsh web profile (`profiles/web`). PowerShell 5+ (bundled with Windows).

1. Clone this repo anywhere:

    ```
    git clone https://github.com/CityNanFlower/dsh-task-complete-sound.git
    cd dsh-task-complete-sound
    ```

2. Run the installer (idempotent, safe to re-run):

    ```
    .\install-task-complete-sound.bat
    ```

    The script copies the package into `<dsh-home>\profiles\web\node_modules\@local\dsh-task-complete-sound` and inserts the plugin row into the profile's `cordis.patch.yml`. It resolves the DSH home directory as `$env:DSH_HOME` if set, otherwise `~\.dsh`.

3. Wait ~2 seconds for the host to hot-reload the patch (no dsh restart needed), then refresh the GUI page (F5 / Ctrl+F5). Configure under **Settings → Web UI plugins → 任务完成提示音**.

4. Optional sanity check: `.\verify-task-complete-sound.ps1` (checks the boot manifest and the served client bundle; pass `-BaseUrl` for a non-default port).

> The settings schema is registered host-side, so the very first save needs the schema loaded — if the settings card is missing right after install, restart dsh once, then it hot-reloads forever after.

## Uninstall / 卸载

```
.\uninstall-task-complete-sound.bat
```

(Removes the plugin row from the profile patch — hot-effective — and deletes the deployed copy; refresh the GUI page afterwards.)

## How it works

- **Host half** (`lib/index.js`): no runtime behavior; exists to register the `dsh.client` declaration and the schemastery `Config` schema (settings namespace).
- **Browser half** (`lib/client.js`) watches four redundant signals:
  1. mux SSE `turn/end` (primary channel, with end reason for classification);
  2. `uiSession.sessionStatus` pendingInteraction (approval detection);
  3. session-list running/completed edges (SSE-failure fallback);
  4. current-conversation snapshot edges + 800 ms poll.
- Sounds are synthesized with the Web Audio API. Config lives under the host settings namespace (fallback: localStorage key `dsh.taskCompleteSound.v1`), edited in the settings card (with per-event preview and a debug log toggle).
- Failure policy: everything is best-effort and never throws — a sound plugin must not take the web shell down (the shell fails boot when an apply throws). Any service surface that is not in `inject` is accessed guardedly (getter access can throw on un-injected optional services — learned the hard way, see v0.4.1).

## 版本沿革（Changelog）

## v0.4.1 修复（插件整体失效：可选服务探测未防护）

- **根因**：v0.4.0 的启动探测 `remoteFace.schedule` 没有 try/catch 保护。schedule 服务来自可选的 schedule 插件，cordis 客户端访问器对未注入的可选服务是「访问即抛错」——探测一抛，整个 apply 中断：提示音监视器、设置卡注册全部没执行，插件在 Web UI 里表现为「消失」。
- **修复**：schedule 探测与目录拉取全部改为守卫式访问——getter 抛错时视为「服务不存在」，一次性降级（来源区分退化为仅主会话/子代理），其余功能不受任何影响。不能把 schedule 加进 inject：可选服务不满足注入条件会让插件彻底拒绝加载。
- 教训沉淀：**cordis 客户端里任何非 inject 直属的服务面属性，访问即可能抛错，必须包 try/catch**；`node --check` 查不出这类问题，只能靠运行时验证。

## v0.4.0 新增（完成事件来源区分）

桌面通知与处理结果行现在会标注完成事件来自**主会话 / 子代理 / 自动化任务**。判定链（按优先级）：

1. **子代理**：会话行 `origin === 'subagent'` 或带 `parentId`（宿主权威字段）；
2. **自动化任务**：经 `remote.schedule.catalog()` 拉取定时任务目录（60s 缓存），会话绑定有 active 任务、且本轮 `turn/start` 时间窗内没有新的人类发言（`sessionListMetadata.lastPromptAt` 早于回合开始或缺失）→ 判为自动化触发；
3. 其余 → **主会话**。

通知标题加前缀（如「【子代理】回合完成」），gateLine 追加「（来源：…）」。schedule-bundle 未加载时自动降级（只区分主会话/子代理），控制台有探针日志。

## v0.3.7 新增（前台不弹横幅）

「桌面通知」开启后新增子开关**「前台不弹横幅」**（默认开）：页面正在前台（可见且有焦点）时，完成类事件（含审批）只响声音、闪标题，**不发系统通知**；切到后台/最小化后的事件才弹横幅——人在盯着页面时横幅纯冗余。「测试通知」按钮不受影响，始终弹出。处理结果行新增对应判定「前台不弹横幅，未发系统通知」；与「仅标签页不在前台时播放」的区别：那个连声音一起静音，这个只拦横幅。

## v0.3.6 修复（横幅时弹时不弹）

根因：桌面通知用了**固定 `tag`**——Chromium 规则是同 `tag` 的新通知会**静默替换**旧通知（只更新 Win+N 里那条，**不重新弹横幅**），且 `new Notification()` 构造器路径不支持 `renotify`。于是只要前一条 DSH 通知还在 toast 活跃窗口内，下一条（真实事件也好、测试键也好）就被无声吞掉——「第一次弹、后面全不弹」「测试也时灵时不灵」全是它。修复：`tag` 改为按 2 秒时间窗分桶（`dsh-tcs-<窗口号>`），快速连发的重复事件仍合并为一条，但每个新事件都能拿到自己的横幅。

## v0.3.5 新增（完成事件处理结果可见）

设置卡顶部新增**处理结果行**：每次完成事件（回合结束/后台完成/审批/错误）的实际去向都会记录并显示——「已完整提醒」/「被免打扰时段静音」/「仅后台模式前台不提醒」/「当前会话免响」/「关键词过滤」/「防抖合并」/「声音已响但桌面通知开关未开」，带时间戳。**测试按钮走直通路径（绕过全部静音闸门），所以「测试弹、真实事件不弹」时看这行就知道被哪个闸门拦了**——事件发生后重新展开卡片即可刷新显示。

## v0.3.4 修复（卡片打不开）

v0.3.3 漏声明了 `var testResult = testResultState[0]`——设置卡展开渲染到测试结果行时抛 ReferenceError，React 把整个卡片卸载（表现为 tab 点开即消失）。已补上；并新增渲染路径审计（t()/tr() 文案键全量核对 + 卡片作用域标识符声明检查），当前全绿。

## v0.3.3 新增（测试通知全程反馈）

「测试通知」按钮每次点击都在卡片内输出一行结果，覆盖全部六种出路：无通知 API（非 localhost）/ 正在请求权限 / Edge 安静请求拦截（没弹授权框就拒了）/ 已交给系统（没弹就是 Windows 层吞）/ 权限被拒 / Notification 构造抛错（原文展示）。`showNotification` 改为返回结果状态串（'sent' / 'no-api' / 'not-granted' / 'error: …'），构造器报错不再被吞。

## v0.3.2 新增（通知可诊断化）

- **设置卡内权限状态**：「桌面通知」行实时显示权限状态——不支持（非 localhost 的 http 访问时无 Notification API）/ 未请求 / 已授予 / 已拒绝（附 Edge 修复路径：地址栏锁图标 → 网站权限 → 通知）。
- **「测试通知」按钮**：点击即走完整链路（必要时请求权限 → 立即弹一条测试通知），不用等真实事件；授权结果即时刷新状态显示。
- **最后的静默失败点补日志**：`Notification` API 不存在的来源（非安全上下文）现在会输出一次性控制台诊断；`services:` 探针行也追加 `notifications=` 字段。
- Edge 实测提示：Edge 的网页通知走 Windows 系统通知通道，**勿扰模式（Win+N）开着会静默吞掉 toast**（通知中心里能翻到）；效率模式的**睡眠标签页**会冻结后台标签页（JS 全停），需在 `edge://settings/system` 把 dsh 地址加入「从不让这些网站进入睡眠状态」。

## v0.3.1 修复（实测反馈：通知 / 闪烁 / 审批全部失效）

- **根因（审批音效失效）**：浏览器半边的 `inject` 只声明了 `['sessions', 'slots']`，而 `apply` 里探测的 `ctx.uiSession` / `ctx.uiWorkspace` / `ctx.remote` 都不在注入列表里，永远是 undefined——审批监听、通知点击跳转、宿主配置同步三条路径全部静默死亡。已补齐注入（对照官方模板与 uiSession/uiWorkspace 源码核实的服务名），刷新页面即生效。
- **标题闪烁「看起来没触发」**：隐藏标签页的定时器会被 Chrome 节流（约 5 分钟后最低 1 次/分钟），原实现等第一个 interval tick 才改标题，节流时看起来像没触发。现改为事件到达**立即**置标题前缀，interval 只负责后续交替。
- **通知权限失败完全静默**：权限未授权/被拒时通知一声不吭，无从排查。现会在控制台输出一次性诊断（权限请求中 / 权限被拒提示）；`apply` 时也有一条 always-on 的服务探针报告（`services: uiSession= ... uiWorkspace= ... remote.settings= ...`），不用开 debug 就能确认四类能力是否就位。

## v0.3.0 新增（三项功能）

- **配置宿主同步**：宿主半边声明 schemastery Config schema（`lib/index.js`），settings 系统据此为本插件注册持久化命名空间；浏览器半边经 `ctx.remote.settings.describe/update` 在启动时采纳宿主配置（宿主无数据时反向播种本浏览器的 localStorage 配置），保存时双向写。**跨浏览器 / dsh-desk 桌面端配置一致**；宿主面不可用时静默回落 localStorage（原行为）。注意：schema 注册需重启 dsh 生效（组合变更），之后正常保存即可同步。
- **标签页标题闪烁**：标签页不在前台时，事件触发会让标题栏闪现前缀（✅ 完成 / ⚠️ 审批 / ⛔ 错误），切回即停；审批即使在免打扰时段也闪（只闪不出声）。设置卡可关。
- **静音会话（标题关键词）**：设置卡新增文本框，标题含任一关键词的会话，其回合结束 / 后台完成不响、不通知、不闪标题；**审批与错误不受影响**（异常和卡住永远值得知道）。每行或逗号分隔一个关键词。

## v0.2.4 调整（听感反馈）

- **移除**：海浪（噪声涌浪，差评淘汰）、水滴（清亮双滴，淘汰）；旧配置里存的选择自动回落默认。
- **新增**：木鱼（双敲）——两声短促清脆的敲击（980/740Hz 三角波，音头快速下滑），与长音类音色区分明显。
- **修复**：COPY 文案表里 v0.2.1 遗留的重复键（drop/bell 各两条，JS 后键覆盖前键，导致界面一直显示旧文案）。

## v0.2.3 调整（听感反馈）

- **移除**：鲸歌（滑音，差评淘汰）；旧配置里存的「鲸歌」自动回落为海风铃。
- **新增**：波光（上行琶音）——C6→E6→G6→C7 大和弦琶音，短促明亮。
- **泡泡增强**：峰值增益 0.4→0.7，并加到 5 颗气泡，不再偏小声。

## v0.2.2 新增（海洋主题音色）

- **保留并更名**：海风铃（原叮咚）、珊瑚叮（原单音）、灯塔钟（原钟声）——你点名的三个好听的。
- **重做**：水滴 → 清亮双滴（原来 1150→380Hz 偏低偏闷）；错误 → 风暴警报（原低鸣整体提亮一个八度，659→440Hz，能穿透而不是闷在底下）。
- **新增海洋音色**：海浪（滤波噪声涌浪，约 1.4s）、泡泡（四个上升气泡音）、鲸歌（260→520→340Hz 滑音 + 5.5Hz vibrato，致敬 DSH 小鲸鱼）。
- **移除**：轻快（pop，上升音，差评）；旧配置里存的「轻快」自动回落为新默认（审批 = 泡泡）。

## v0.2.1 新增

- **免打扰时段**：设起止时间（默认 23:00–08:00，支持跨零点）；时段内完成类提示（音效+通知+合并通知）整体静音；**审批仍会弹通知但不出声**（不阻塞感知，也不吵人）。
- **当前会话免响**：开启后，正在查看的会话自己跑回合结束不响；后台会话照常提示。
- **新增音色**：水滴（快速下滑音）、钟声（双分音长衰减），加上原有的叮咚/轻快/叮/低鸣/静音，四类事件各有 7 种选择。**切换下拉框立即试听**；每个音效行还带独立「试听」按钮（选「静音」时置灰）可重放；底部「试听」按钮按顺序播一遍全部四类（间隔 0.8s，静音跳过）。

## v0.2.0 新增

- **事件分类 + 差异化音效**：上表四类事件各自可配（叮咚 / 轻快 / 叮 / 低鸣 / 静音）；旧版单一音效配置自动迁移为「回合结束」音效。
- **桌面通知**：完成 / 审批时弹系统 Notification（默认关；开启时请求权限），点击通知聚焦窗口并**跳转到对应会话**（经 `uiWorkspace.openSession`，服务不可用时仅聚焦）。通知静音，音效由本插件负责。
- **连发合并**：防抖窗口（最小间隔）内连发的完成被静默吞掉，≥2 项时补一条「合并 N 项完成提醒」通知，不补音。
- **皮肤注释色修复**：卡片描述 / 提示 / 注释文字从 `label-tertiary` 改为 `label-secondary`，与 web-all 家族卡片一致——部分皮肤（如 whale-song 亮色）把 tertiary 定义成高饱和蓝色，曾导致注释看起来像链接。

