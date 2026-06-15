# CognitiveWorkflow

一款面向复杂、长流程、高风险、需审查、需复现的认知任务的 Agent Workflow 工作台。

将复杂任务从一次性 Agent 对话，转化为**可编排、可验证、可复现、可修复**的认知型工作流：节点契约化、Plan-Act-Review-Repair 闭环、模型能力补偿层（MCCL）、可视化 Node Canvas、跨模型交付一致性、兼容多种执行 Agent（Pydantic AI / Claude Code / Codex / Hermes 等）。

## 当前阶段

第一阶段：技术选型与开发路线讨论，**暂不进入编码**。

## 仓库结构（当前）

```
.
├── 00_Concept.md                                              # 产品理念与核心定义
├── AI_Agent_Workflow_技术架构设计说明书_v1.0.docx              # 技术架构基线
└── AI_Agent_Workflow工作台_UIUX详细设计规范与需求规格说明书_v1.1_新增Workflow编排.docx  # UI/UX 与需求
```

## 关键技术选型（讨论中的当前共识）

- 桌面 Shell：Electron 35.x（Forge + Vite + electron-builder） + React + TypeScript + React Flow
- Python Runtime 作为 sidecar：PyInstaller one-file，由主进程 spawn，HTTP+SSE 通讯
- Runtime 主语言：Python 3.10+（FastAPI + Pydantic v2 + asyncio）
- 图调度内核：LangGraph + 自研 Cognitive Workflow 编译器
- 基础 chat agent：**Pydantic AI**（作为 90% 节点的默认执行单元）
- 模型 Provider：LiteLLM（已被 pydantic-ai 内置 `LiteLLMProvider`）
- 多 Agent 适配：自研 `AgentAdapter` 协议（PydanticAI / ClaudeCode / Codex / Hermes / LiteLLM 五类）
- 持久化：SQLite + JSON Manifest + Git；向量库 LanceDB；MCP 走官方 SDK；HITL 走 ApprovalRequiredToolset

## License

待定（建议 Apache-2.0 或 MIT，发布前确认）。
