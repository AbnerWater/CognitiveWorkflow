# ADR — Architecture Decision Records

> 本目录承载 CognitiveWorkflow 的全部架构决策记录。任何"会影响多个模块的设计选择"必须先在此处落 ADR，再改代码 / spec。
>
> 命名规范：`NNNN-kebab-case-title.md`，编号单调递增。
>
> 每条 ADR 一旦 Accepted 就不修改正文；变更通过新增 ADR + 标注上游 ADR 为 Superseded 实现。

## 索引

| ID                                                    | 标题                                                          | 状态     | 日期       |
| ----------------------------------------------------- | ------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-record-architecture-decisions.md)         | 用 ADR 记录架构决策                                           | Accepted | 2026-06-15 |
| [0002](0002-engine-not-import-pydantic-ai.md)         | Engine 不直接依赖 pydantic-ai，必须经 AgentAdapter            | Accepted | 2026-06-15 |
| [0003](0003-schema-single-source-of-truth.md)         | Schema 单一真理在 `packages/schemas`，前端类型由 codegen 派生 | Accepted | 2026-06-15 |
| [0004](0004-langgraph-as-graph-engine.md)             | LangGraph 作为图调度内核                                      | Accepted | 2026-06-15 |
| [0005](0005-pydantic-ai-as-base-agent.md)             | Pydantic AI 作为默认基础 chat agent                           | Accepted | 2026-06-15 |
| [0006](0006-electron-desktop-shell.md)                | 桌面 Shell 选 Electron 35.x                                   | Accepted | 2026-06-15 |
| [0007](0007-persistence-three-layer.md)               | 持久化采用 SQLite + JSON Manifest + Git via simple-git        | Accepted | 2026-06-15 |
| [0008](0008-stream-event-protocol.md)                 | StreamEvent 协议与 AgentStreamEvent 转译                      | Accepted | 2026-06-15 |
| [0009](0009-hitl-via-approval-required-toolset.md)    | HITL 落到 ApprovalRequiredToolset + AG-UI 通道                | Accepted | 2026-06-15 |
| [0010](0010-durable-execution-dbos.md)                | Durable Execution 选 dbos                                     | Proposed | 2026-06-15 |
| [0011](0011-runtime-flow-desktop-actions-contract.md) | Runtime Flow Desktop Actions Contract                         | Proposed | 2026-06-26 |

## 模板

`_template.md`
