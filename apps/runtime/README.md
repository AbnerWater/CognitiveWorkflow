# cw_runtime

CognitiveWorkflow Python sidecar——`FastAPI` + `LangGraph` 编译器 + `AgentAdapter` 五件套。

## 模块边界

```
src/cw_runtime/
├── api/          # FastAPI routers（HTTP + SSE）— 与 specs/api/http_sse.md 对齐
├── engine/       # CW 核心调度内核（compiler / scheduler / state_machine / checkpointer）
├── nodes/        # 节点 Runner（execution / evaluation / repair / human_checkpoint / tool_node / memory_node）
├── adapters/     # AgentAdapter 协议 + 各家实现
├── mccl/         # 模型能力补偿层 10 组件
├── planning/     # PlanningSession 5 子 Agent
├── memory/       # ProjectMemory / ReferenceLibrary / SkillRegistry
├── stream/       # StreamEvent 编解码 + AG-UI 桥接
├── persistence/  # SQLite + JSON Manifest + libgit2/simple-git
├── tools/        # 内置 Tool / Skill 注册表
├── observability/# OTel + 指标导出
├── cli.py        # cw-runtime CLI 入口
└── settings.py
```

## 强约束

- `engine/`、`nodes/`、`mccl/`、`memory/` 等模块**禁止** `import pydantic_ai`（ADR-0002）
- 所有 LLM 调用必须经 `adapters/` 协议
- LangGraph 仅出现在 `engine/`（ADR-0004）

## 入口

- HTTP/SSE：`cw-runtime --http-port=0` 由主进程注入端口
- 直接 dev：`uv run cw-runtime --dev`
