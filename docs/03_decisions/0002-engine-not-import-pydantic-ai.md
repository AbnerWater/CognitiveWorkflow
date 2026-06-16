# ADR-0002: Engine 不直接依赖 pydantic-ai，必须经 AgentAdapter

| 项 | 值 |
|---|---|
| Status | Accepted |
| Date | 2026-06-15 |
| Decision Drivers | 多 Agent 兼容；替换面收敛；测试可控 |
| Related ADR | ADR-0005（Pydantic AI 作为基座） |
| Related Spec | specs/protocols/agent_adapter.md |

## 1. 背景与问题

CW 设计上需要兼容多种执行 Agent（Pydantic AI / Claude Code / Codex / Hermes / LiteLLM 等）。如果 Engine、Compiler、MCCL 各模块直接 `import pydantic_ai`，会出现两个问题：

1. Pydantic AI API 升级（v2、v3）会扩散到整个 codebase
2. 接入其它 Agent 时无法在不动 Engine 的情况下做替换

## 2. 候选方案

1. **直接 import pydantic_ai**——简单、扁平 — ❌ 替换面爆炸
2. **薄 wrapper 包裹 pydantic_ai 类**——继承 Agent 加几个方法 — ❌ 仍然耦合具体类型
3. **正交协议层 AgentAdapter**——只暴露 `prepare/run/resume/cancel/finalize` 五件套 — ✅ 替换面收敛在 adapters 子包

## 3. 决策

定义 `AgentAdapter` 协议（`specs/protocols/agent_adapter.md`），约束：

- Engine / Compiler / MCCL **不得**直接 `import pydantic_ai`
- 所有 LLM 调用经 `AgentAdapter` 协议
- 五家首发 Adapter（PydanticAI / ClaudeCode / Codex / Hermes / LiteLLM）共享同一协议
- entry_points `cw.adapters` 插件式注册

## 4. 影响

- 正面：未来替换 Pydantic AI（如升级 v3）只需改 `apps/runtime/src/cw_runtime/adapters/pydantic_ai_adapter.py`；新增 Adapter 不动 Engine
- 负面：Adapter 层有 thin overhead（每次调用多一层翻译）；Engine 不能利用 Pydantic AI 内部优化（如某些 streaming hook）
- 后续验证：A1 spec-conformance-reviewer 在 Phase 1 检查 Engine 模块是否含 `import pydantic_ai` 字符串

## 5. 关联

- specs/protocols/agent_adapter.md
- AGENTS.md §6.1
- 跨会话记忆 [[project_pydantic_ai_mapping]]
