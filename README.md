# dsh-task-complete-sound

**简体中文** · [English](#english)（文末折叠区）

DSH Web GUI 插件：**按事件分类的任务完成提示音 + 可选桌面通知**。当 GUI 里发生回合结束、后台完成、工具审批、错误结束四类事件时，播放 Web Audio 实时合成的提示音——**无需音频资源、无网络请求**。另支持桌面通知点击跳转会话、标签页标题闪烁、免打扰时段、按会话关键词静音、完成来源区分（主会话 / 子代理 / 自动化任务）、跨浏览器配置同步。

## 功能特性

四类事件各自可配音效或静音：

| 事件 | 触发条件 | 默认音效 |
|---|---|---|
| 回合结束 | 任意会话回合正常结束（mux `turn/end`，reason = completed / max-tokens / blocked）；手动停止（aborted / interrupted）不响 | 海风铃 |
| 后台完成 | 未打开的会话在后台跑完（侧边栏绿色完成标记） | 珊瑚叮 |
| 等待审批 | 工具请求审批；**不受「仅后台」与防抖合并限制，免打扰时段也始终可听** | 泡泡 |
| 错误结束 | 回合因错误结束（reason = error），便于立刻发现异常 | 风暴警报 |

- **8 种合成音色**（海风铃 / 珊瑚叮 / 灯塔钟 / 泡泡 / 波光 / 木鱼 / 风暴警报 / 静音），切换即试听，每个音效行带独立试听按钮
- **桌面通知**：点击通知聚焦窗口并跳转到对应会话；「前台不弹横幅」——人在盯页面时只响声音，切到后台才弹横幅；2 秒时间窗分桶防抖，快速连发不会互相吞掉横幅
- **标签页标题闪烁**：页面在后台时，事件触发让标题闪现前缀（✅ 完成 / ⚠️ 审批 / ⛔ 错误），切回即停
- **免打扰时段**：设起止时间（支持跨零点），时段内完成类提示整体静音；审批仍弹通知（不出声）
- **静音会话**：按标题关键词静音某个会话的完成类提示；**审批与错误不受影响**（异常永远值得知道）
- **来源区分**：通知标题标注完成事件来自主会话 / 子代理 / 自动化任务；schedule-bundle 未加载时自动降级
- **处理结果行**：设置卡内记录每个事件的实际去向——已完整提醒 / 被免打扰静音 / 仅后台模式前台不提醒 / 当前会话免响 / 关键词过滤 / 防抖合并——「测试弹、真实事件不弹」时一眼看出被哪个闸门拦了
- **配置宿主同步**：配置经宿主 settings 命名空间持久化，跨浏览器、dsh-desk 桌面端一致（宿主不可用时回落 localStorage）

## 兼容性

实测 dsh `0.1.7` 与 `0.2.0-rc.1`（web profile）。浏览器半边基于公开的 `dsh.client` 注入面（`@deepseek-ai/dsh-client-runtime` / `@deepseek-ai/dsh-client-connection`）。

## 安装

前提：一个可用的 dsh web profile（`profiles/web`）；Windows 自带的 PowerShell 5+ 即可。

1. 克隆仓库到任意位置：

    ```
    git clone https://github.com/CityNanFlower/dsh-task-complete-sound.git
    cd dsh-task-complete-sound
    ```

2. 运行安装脚本（幂等，可重复执行）：

    ```
    .\install-task-complete-sound.bat
    ```

    脚本会把包复制到 `<dsh主目录>\profiles\web\node_modules\@local\dsh-task-complete-sound`，并把插件行写入 profile 的 `cordis.patch.yml`。主目录解析规则：设了 `DSH_HOME` 环境变量用它，否则用 `~\.dsh`。

3. 等约 2 秒让宿主热重载补丁（**无需重启 dsh**），然后刷新 GUI 页面（F5 / Ctrl+F5）。在 **设置 → Web UI 插件 → 任务完成提示音** 里配置。

4. 可选自检：`.\verify-task-complete-sound.ps1`（检查启动清单和已下发的客户端包；非默认端口传 `-BaseUrl`）。

> 设置 schema 是宿主侧注册的：装完若设置卡没出现，重启一次 dsh 让 schema 注册生效，之后即可一直热重载。

## 卸载

```
.\uninstall-task-complete-sound.bat
```

（从 profile 补丁里移除插件行——热生效——并删除已部署副本；之后刷新 GUI 页面。）

## 工作原理

- **宿主半边**（`lib/index.js`）：无运行时行为，只负责注册 `dsh.client` 声明和 schemastery `Config` schema（settings 命名空间）。
- **浏览器半边**（`lib/client.js`）四路信号冗余：
  1. mux SSE `turn/end`（主通道，带结束原因，据此分类）；
  2. `uiSession.sessionStatus` 的 pendingInteraction（审批检测）；
  3. 会话列表 running/completed 边沿（SSE 失效兜底）；
  4. 当前会话 conversation 快照 running / turnEnds 边沿（兜底）+ 800ms 轮询。
- 音效由 Web Audio API 实时合成；配置存宿主 settings 命名空间（回落 localStorage 键 `dsh.taskCompleteSound.v1`），设置卡内编辑（含试听与调试日志开关）。
- 失败策略：全程 best-effort、绝不抛错——提示音插件不能把 web shell 拖下水（shell 在 apply 抛错时会启动失败）。任何不在 `inject` 列表里的服务面属性，访问都必须带守卫（可选服务的 getter「访问即抛错」——血泪教训见版本沿革 v0.4.1）。

<a id="english"></a>
<details>
<summary><b>🌐 English</b></summary>

A DeepSeek Harness (dsh) Web GUI plugin that plays **synthesized notification cues when a task / agent turn completes** — no audio assets, no network requests, everything is generated live with the Web Audio API — plus optional desktop notifications with click-to-jump, tab-title flashing, per-session muting, and quiet hours. Configuration syncs across browsers via the host settings namespace.

**Features**

- **Four event classes**, each with its own sound (or silence):

| Event | Trigger | Default sound |
|---|---|---|
| Turn end | a session's turn ends normally (mux `turn/end`, reason = completed / max-tokens / blocked); manual stops stay silent | Chime |
| Background done | a session finishes while not open (the sidebar's green "done" mark) | Ding |
| Approval pending | a tool request needs approval (**always audible**, exempt from quiet hours and burst merging) | Bubble |
| Error end | a turn ends with reason = error | Storm alarm |

- **8 synthesized tones** with per-event preview buttons
- **Desktop notifications** with click-to-jump-to-session, foreground suppression, and 2-second burst merging
- **Tab-title flashing** (✅ / ⚠️ / ⛔) while the page is hidden
- **Quiet hours** (crosses midnight), current-session muting, mute-by-title-keyword (approvals & errors always get through)
- **Source classification**: main session / subagent / scheduled automation task, with graceful degradation
- **Event trace** in the settings card: every event's outcome (played / muted / merged / gated) is logged, so "test works but real events don't" is always diagnosable
- **Config sync** across browsers and the desktop client (localStorage fallback)

**Compatibility:** tested on dsh `0.1.7` and `0.2.0-rc.1` (web profile).

**Install** (Windows PowerShell; respects `DSH_HOME`, hot-reloads, no dsh restart needed):

```
git clone https://github.com/CityNanFlower/dsh-task-complete-sound.git
cd dsh-task-complete-sound
.\install-task-complete-sound.bat
```

Refresh the GUI page and configure under Settings → Web UI plugins → 任务完成提示音.

**How it works:** the host half registers the `dsh.client` declaration and the schemastery `Config` schema; the browser half watches four redundant signals (mux SSE `turn/end`, `uiSession.sessionStatus` approvals, session-list edges, conversation-snapshot edges + 800 ms poll). Everything is best-effort and never throws. Guard every optional service access — non-injected getters can throw on access (v0.4.1 lesson).

The detailed changelog below is in Chinese; each entry summarizes what the release changed.

</details>

## 版本沿革（Changelog）
