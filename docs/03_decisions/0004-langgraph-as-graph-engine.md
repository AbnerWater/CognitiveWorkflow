# ADR-0004: LangGraph 作为图调度内核

| 项 | 值 |
|---|---|
| Status | Accepted |
| Date | 2026-06-15 |
| Decision Drivers | 生态成熟；interrupt/persistence；与 Pydantic AI 互补 |
| Related ADR | ADR-0005、ADR-0010 |
| Related Spec | specs/state_machines/workflow_run.md |

## 1. 背景与问题

CW 需要一个图调度内核来驱动跨节点的 Workflow 执行（与节点内部回合不同——后者由 Pydantic AI 内部图承担）。该内核需要支持：

- 节点级 interrupt + resume（HITL）
- Checkpoint 持久化与恢复
- 条件 / 并行 / 循环边
- 与 SSE 流式输出协同

## 2. 候选方案

1. **自研图引擎**——完全可控 — ❌ 12+ 周工作量；状态机踩坑成本高
2. **Prefect 3** — ❌ 数据流偏向重；HITL 不是一等公民
3. **Temporal** — ❌ 需要起服务；桌面端不友好
4. **LangGraph** — ✅ 生态成熟；interrupt/persistence 一等公民；与 Python 异步生态契合

## 3. 决策

采用 **LangGraph** 作为底层图调度内核。

- WorkflowGraph → LangGraph StateGraph（一对一编译）
- 不嵌套 LangGraph subgraph 表达 evaluation/repair；CW Compiler 自己生成 pass/fail/repair 边
- LangGraph checkpoint 是恢复加速器；CW jsonl 是真理（D-WR-8）

## 4. 影响

- 正面：节省 12 周内核开发；interrupt 机制对 HITL 完美契合
- 负面：LangGraph API 演进会传染（缓解：仅在 Engine 编译层使用，不外泄）
- 后续验证：Phase 1 末检查 LangGraph 仅出现在 `apps/runtime/src/cw_runtime/engine/`

## 5. 关联

- specs/state_machines/workflow_run.md
- specs/protocols/agent_adapter.md（Adapter 内部承担节点回合）
