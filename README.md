# dsh-fast-term

DSH（DeepSeek Harness）右侧边栏里的**高速终端**：专用 PTY WebSocket，直连、无帧确认，目标是把「按键 → 回显」的峰值延迟压到最低。

![screenshot](docs/screenshot.png)

```
右侧边栏 → 开始（空面板）→ 高速终端
```

## 为什么

DSH 自带终端的输出要先经过网关 mux（所有 Typert Remote 流共用一条物理 WebSocket），每一帧还要等浏览器 ack；宿主同时把同样的输出再喂给一份 headless xterm，用于重连快照。空闲时这套开销只有十几毫秒，但一旦主线程被聊天流 / Markdown 渲染占住，帧就会排队，按键回显能拖到秒级。

dsh-fast-term 把 PTY 输出直接推到一条专用 WebSocket，不排队、不等 ack、宿主也不做 headless 镜像；xterm 在会话标签里直接渲染。

同一台 Windows 机器、隔离的 web profile、Playwright 驱动、按 WebSocket 帧时间戳计时：

| 场景 | DSH 自带终端 | dsh-fast-term |
| --- | --- | --- |
| 冷启动到出提示符 | 3.1–3.2 s | ~0.12 s（复用已存在的 PTY） |
| 空闲按键回显 | 11.7–12.9 ms | 9.9–14.7 ms |
| 主线程 75% 合成负载下 | 43–46 ms | 4.8–35.7 ms |
| 2.99 MB 输出洪水中 | 12.8 s | 2.9 s |

> 数字来自隔离 profile 的对照实验；真实使用时如果聊天记录很大，渲染线程仍然会拖慢任何 web 终端——这是浏览器单线程的代价，不是传输层的。

## 功能

- 会话级右侧栏标签，位置与自带终端一致（`sidebar.right.pane.tab` 槽位）
- 每个标签一个独立 PTY；标签切换、页面刷新后自动重连并回放快照，PTY 不随标签卸载退出（`keepMounted`）
- 新标签的工作目录 = 会话工作目录（读 `workingDirectory` 投影）
- 关闭标签会结束对应 PTY（`sidebarRight.registerCloseHandler` + `POST /api/dsh-fast-term/close`）
- Windows 默认 PowerShell：pwsh → Windows PowerShell → ComSpec 依次回退，可用 `DSH_FAST_TERM_SHELL` 覆盖
- 过滤 xterm 的 Device Attributes 应答，避免 PowerShell 把 `[?1;2c` 当输入回显

## 安装

市场（推荐）：

```
设置 → 插件市场 → 搜索 dsh-fast-term
```

CLI：

```
dsh plugin --profile desktop add dsh-fast-term
# 或本地目录 / tarball
dsh plugin --profile desktop add "file:D:/path/to/dsh-fast-term"
```

安装后需要重启 DSH 宿主（右侧栏的客户端半在刷新页面后生效）。

## 使用

1. 打开右侧边栏
2. 在新标签页面板里点「高速终端」，或点已有标签栏的「开始」再选「高速终端」
3. 直接输入命令即可；关闭标签 = 结束该 PTY

## 安全

- WebSocket 与关闭路由只接受 loopback（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`），并校验 Origin 的 host 与请求 host 一致
- 终端进程以当前用户身份、无沙箱运行（与系统终端一致），不要在不可信页面同源环境里暴露该端口

## 已知限制

- Windows 优先支持；POSIX 走 `$SHELL -l`
- 重连快照上限 4 MiB，超出后丢弃最旧输出
- 依赖 DSH 的 `sidebarRightTabs` 与 `sidebar.right.pane.tab` 槽位（在 0.2.1-rc.2 上验证）
- 标签标题目前固定为「高速终端」

## 开发

```
npm install
node build.mjs          # 把 src/client.js 打包成 lib/client.js
node --check lib/index.js
dsh plugin --profile web add "file:D:/path/to/dsh-fast-term"
```

- `lib/index.js`（宿主半）：`ctx.subprocess.spawnTerminal` 起 PTY，`webServer.registerUpgrade` 挂 `/api/dsh-fast-term/ws`，按 `sessionId/tabId` 维护常驻会话与回放缓冲
- `src/client.js`（浏览器半）：xterm.js + FitAddon，注册右侧栏标签与三个槽位；打包时用 `window.__ModuleLoader__.load` 包装，`react` 外置

## English

`dsh-fast-term` is an in-layout terminal for DSH's right sidebar. It spawns a real PTY through DSH's `subprocess` service and streams raw output over a dedicated WebSocket (`/api/dsh-fast-term/ws`), bypassing the shared Typert gateway mux and frame acknowledgements. Sessions persist across tab switches and page reloads (`keepMounted` + replay buffer), closing a tab terminates its PTY, and new tabs start in the session working directory.

Measured on Windows: cold prompt 0.12 s vs 3.1 s native, flood-echo 2.9 s vs 12.8 s native.

## License

MIT
