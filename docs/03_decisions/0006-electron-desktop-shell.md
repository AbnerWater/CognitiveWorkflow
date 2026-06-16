# ADR-0006: 桌面 Shell 选 Electron 35.x

| 项 | 值 |
|---|---|
| Status | Accepted |
| Date | 2026-06-15 |
| Decision Drivers | 团队 Python+TS 储备；高度可视化 GUI 工程化路径；Chromium 统一渲染 |
| Related ADR | ADR-0007、ADR-0009 |
| Related Spec | specs/api/http_sse.md §7、specs/runtime_harness.md |

## 1. 背景与问题

CW 是高度可视化的桌面端 GUI 程序（Workflow Canvas + 多 Drawer + 流式输出 + 富文件对话框）。需要选定桌面 Shell。

## 2. 候选方案

1. **Tauri 2** — 包体小（~30 MB）；Rust 后端 — ❌ 团队无 Rust 储备；Linux WebKitGTK 兼容差
2. **Electron 35.x** — 包体大（~130 MB）；Chromium 统一；Node 后端 — ✅ 团队主力 Python+TS；React Flow / 多 Drawer / 多窗口 / 富文件对话框工程化路径短
3. **Web 应用** — ❌ 不符合"高度可视化桌面端"产品定位

## 3. 决策

采用 **Electron 35.x**（Forge + Vite + electron-builder）。

- 严格 main / preload / renderer 三段式
- contextIsolation=true + sandbox=true + 严格 CSP
- 渲染进程不直接持 Node API；特权能力经 preload 暴露的 `window.cw.*`
- Python Runtime 通过 PyInstaller one-file 打入 `apps/desktop/resources/runtime/`
- 主进程 `child_process.spawn` 拉起 sidecar，端口 OS 选；通过 IPC 告知 renderer
- electron-updater + GitHub Releases，Phase 1 即启用自动更新

## 4. 影响

- 正面：工程路径短；前后端语言一致；Chromium 渲染稳定
- 负面：包体 ~130 MB；冷启动较慢（缓解：sidecar 异步启动）
- 后续验证：A9 cross-platform-validator 三平台安装包跑通

## 5. 关联

- specs/api/http_sse.md §7（与 Electron 主进程交互）
- specs/runtime_harness.md
- 跨会话记忆 [[project_tech_stack_consensus]]
