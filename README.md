# dsh-fast-term

DSH（DeepSeek Harness）右侧边栏里的**终端**：专用 PTY WebSocket，直连、无帧确认，目标是把「按键 → 回显」的峰值延迟压到最低。

它刻意做成自带终端的替代品：入口叫「新建终端」、占用同一个右栏标签槽位、接管 `Ctrl + \``，并配合一行 profile 补丁隐藏自带终端的按钮与 UI。

![screenshot](docs/screenshot.png)

```
右侧边栏 → 新建终端（或 Ctrl + `）
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

- 会话级右侧栏标签，位置与自带终端一致（`sidebar.right.pane.tab` 槽位），标签标题「终端」
- `Ctrl + \`` 新建终端（快捷键 id `fastterm.new`；隐藏自带终端后不会有冲突）
- 每个标签一个独立 PTY；标签切换、页面刷新后自动重连并回放快照，PTY 不随标签卸载退出（`keepMounted`）
- 新标签的工作目录 = 会话工作目录（读 `workingDirectory` 投影）
- 关闭标签会结束对应 PTY（`sidebarRight.registerCloseHandler` + `POST /api/dsh-fast-term/close`）
- Windows 默认 PowerShell：pwsh → Windows PowerShell → ComSpec 依次回退，可用 `DSH_FAST_TERM_SHELL` 覆盖
- 过滤 xterm 的 Device Attributes 应答，避免 PowerShell 把 `[?1;2c` 当输入回显

## 安装

当前仓库还未发布到 npm，先按本地目录安装：

```
dsh plugin --profile desktop add "file:D:/Projects/dsh-fast-term"
```

发布之后可以走市场：

```
设置 → 插件市场 → 搜索 dsh-fast-term
# 或
dsh plugin --profile desktop add dsh-fast-term
```

安装或更新后需要重启 DSH 宿主（右侧栏的客户端半在刷新页面后生效）。注意 `file:` 依赖在 pnpm 里是拷贝而不是软链，改了 `lib/` 之后要重新 `add` 一次（或手动把 `lib/index.js`、`lib/client.js` 覆盖到 profile 的 `node_modules/dsh-fast-term/lib/`）。

## 替代自带终端

想让「新建终端」按钮和终端 UI 完全由本插件接管，在 profile 的补丁层里关掉自带终端 UI（`C:\Users\<你>\.dsh\profiles\desktop\cordis.patch.yml`）：

```yaml
- id: ui-sidebar-terminal
  name: "@deepseek-ai/dsh-client-ui-sidebar-terminal"
  disabled: true
```

重启后：右栏「开始」页只剩「工作区文件」和「新建终端」，`Ctrl + \`` 打开的是本插件；关掉的是自带终端的**界面**，终端服务（`webTerminals` / `dsh-api-terminal-controller`）仍在，其它插件的终端不受影响。

不想替代、想并存也可以——删掉这三行即可，两个终端会各占一张卡片（自带终端仍显示为 `New terminal`）。

## 使用

1. 打开右侧边栏
2. 点「新建终端」，或直接按 `Ctrl + \``
3. 直接输入命令即可；关闭标签 = 结束该 PTY

## 安全

- WebSocket 与关闭路由只接受 loopback（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`），并校验 Origin 的 host 与请求 host 一致
- 终端进程以当前用户身份、无沙箱运行（与系统终端一致），不要在不可信页面同源环境里暴露该端口

## 已知限制

- Windows 优先支持；POSIX 走 `$SHELL -l`
- 重连快照上限 4 MiB，超出后丢弃最旧输出
- 依赖 DSH 的 `sidebarRightTabs` 与 `sidebar.right.pane.tab` 槽位（在 0.2.1-rc.2 上验证）
- 标签标题固定为「终端」，不显示当前 shell / 进程名
- 替代自带终端依赖 `ui-sidebar-terminal` 这个 bundle id；DSH 升级改名时补丁会失效（终端本身仍可用）

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

`dsh-fast-term` is an in-layout terminal for DSH's right sidebar, built as a drop-in replacement for the built-in terminal. It spawns a real PTY through DSH's `subprocess` service and streams raw output over a dedicated WebSocket (`/api/dsh-fast-term/ws`), bypassing the shared Typert gateway mux and frame acknowledgements. Sessions persist across tab switches and page reloads (`keepMounted` + replay buffer), closing a tab terminates its PTY, and new tabs start in the session working directory. It takes over `Ctrl + \`` and, with a one-entry profile patch disabling `ui-sidebar-terminal`, hides the built-in terminal's button and UI entirely.

Measured on Windows: cold prompt 0.12 s vs 3.1 s native, flood-echo 2.9 s vs 12.8 s native.

## License

MIT
