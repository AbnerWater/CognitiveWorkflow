# ADR-0005: Pydantic AI 作为默认基础 chat agent

| 项 | 值 |
|---|---|
| Status | Accepted |
| Date | 2026-06-15 |
| Decision Drivers | Pydantic v2 一等公民；deps_type 与 ContextPack 1:1 映射；MCP / HITL / structured output 内置 |
| Related ADR | ADR-0002（Engine 不直接 import） |
| Related Spec | specs/protocols/agent_adapter.md |

## 1. 背景与问题

CW 节点执行需要"基础 chat agent"。候选包括 Pydantic AI、OpenAI Agents SDK、Hermes Agent、AutoGen、CrewAI、SmolAgents 等。

## 2. 候选方案（详见跨会话记忆 [[project_pydantic_ai_mapping]]）

1. **Pydantic AI** — ✅ 库形态、Pydantic 原生、deps_type + RunContext 与 CW ContextPack/EvidencePack 几乎 1:1
2. **OpenAI Agents SDK** — 备选；handoff/MCP 强但 schema 弱于 Pydantic AI
3. **AutoGen / CrewAI** — ❌ 自带编排范式，会与 LangGraph 冲突
4. **Hermes Agent** — ❌ 完整 Agent 产品（同 Claude Code / Codex 同级），不适合做基座；应作为 AgentAdapter 的目标
5. **SmolAgents** — code-as-action 太特化

## 3. 决策

采用 **Pydantic AI**（pydantic-ai-slim）作为默认基础 chat agent。

- 90% 节点经 PydanticAIAdapter 执行
- 仅装 `[anthropic, openai, google, mcp, fastmcp, retries, evals, ag-ui, web]` extras
- 不装 pydantic-ai 全包（避免拖入 outlines / huggingface 等不必要依赖）

## 4. 影响

- 正面：开发速度最快；Pydantic v2 / MCP / HITL / structured output 一站式
- 负面：与 Pydantic AI v 大版本绑定（缓解：ADR-0002 隔离）
- 后续验证：Phase 1 PydanticAIAdapter 实测能力快照与 capabilities() 声明无差异

## 5. 关联

- specs/protocols/agent_adapter.md
- 跨会话记忆 [[project_pydantic_ai_mapping]] / [[project_tech_stack_consensus]]
