# @cw/desktop

CognitiveWorkflow Electron 桌面 Shell（M1.5 milestone 落地）。

## 三段式架构（ADR-0006）

```
src/
├── main/         # 主进程：sidecar spawn / 菜单 / 窗口管理 / Git via simple-git
├── preload/      # preload：window.cw.* 暴露特权能力（contextIsolation=true）
└── renderer/     # 渲染进程：React 18 + React Flow + Zustand + TanStack Query
    ├── canvas/   # Workflow Canvas
    ├── chat/     # 底部 Chat Box
    ├── stream/   # 流式输出折叠面板
    ├── drawer/   # 节点详情 / 文件树 / 参考库 / Skill / 版本快照
    ├── shell/    # AppShell / LeftDock / ExecutionToolbar
    ├── stores/   # Zustand stores
    ├── ipc/      # 与 runtime 的 SSE/HTTP 客户端
    └── theme/    # design tokens
```

## 强约束

- contextIsolation=true + sandbox=true + 严格 CSP
- renderer 不持 Node API；通过 `window.cw.*` 调用主进程
- renderer **禁用** localStorage / sessionStorage（Cowork 限制；用 Zustand 持久化插件 + IPC）
- 直连 sidecar `localhost:<port>/cw/v1`，自动注入主进程提供的 Bearer token
