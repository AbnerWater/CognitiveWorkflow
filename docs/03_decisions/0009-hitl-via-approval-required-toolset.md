# ADR-0009: HITL 落到 ApprovalRequiredToolset + AG-UI 通道

| 项 | 值 |
|---|---|
| Status | Accepted |
| Date | 2026-06-15 |
| Decision Drivers | Pydantic AI 原生 HITL；DeferredToolResults 续跑；AG-UI 跨 renderer 一致 |
| Related ADR | ADR-0005、ADR-0008 |
| Related Spec | specs/state_machines/workflow_run.md、specs/schemas/stream_event.md |

## 1. 背景与问题

CW UIUX FR-018：半自动审查模式下，审查节点或高风险节点必须能暂停等待用户确认。需要选定 HITL 实现路径。

## 2. 候选方案

1. **自研 HITL 中间件** — ❌ Pydantic AI 已内置
2. **Pydantic AI ApprovalRequiredToolset + DeferredToolResults** — ✅ 一等公民；通过 raise `ApprovalRequired` 异常传递控制流
3. **同步阻塞模型调用** — ❌ 与异步 runtime 冲突

## 3. 决策

采用 **Pydantic AI ApprovalRequiredToolset**，转译为 CW 事件流：

```
节点 toolset 含 ApprovalRequiredToolset
  → 模型选用受批准工具 → pydantic-ai 抛 ApprovalRequired
  → Adapter 转译：发 tool.approval_required (parent) + human.gate_required (child)
  → 前端展示决策卡片
  → 用户决策 → POST /workflow/{id}/node/{node_id}/decisions
  → Adapter 用 DeferredToolResults 续跑
```

约束：

- 所有 MCP / 高风险工具默认走 ApprovalRequiredToolset 包装
- 节点级 `requires_human_approval=true` 时，Compiler 自动注入隐式 human_checkpoint 节点（D-NC-5）
- HITL 路径必须发 `human.gate_required / human.gate_resolved / human.gate_timeout` StreamEvent

## 4. 影响

- 正面：复用 Pydantic AI 内置；UI 协议简洁
- 负面：ClaudeCodeAdapter / CodexAdapter 需要自实现 HITL 转译（非 Pydantic AI 原生）
- 后续验证：Phase 1 ClaudeCodeAdapter 的 permission prompt → human.gate_required 转译

## 5. 关联

- specs/protocols/agent_adapter.md §6.3
- specs/state_machines/workflow_run.md
- specs/schemas/stream_event.md §2.7
