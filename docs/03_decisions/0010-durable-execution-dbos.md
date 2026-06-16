# ADR-0010: Durable Execution 选 dbos

| 项 | 值 |
|---|---|
| Status | Proposed |
| Date | 2026-06-15 |
| Decision Drivers | 嵌入式部署；Pydantic AI durable_exec 已内置；本地优先 |
| Related ADR | ADR-0004 |
| Related Spec | specs/state_machines/workflow_run.md（Checkpoint 部分） |

## 1. 背景与问题

CW 长流程任务可能跨小时 / 跨天；需要 Durable Execution（持久化 + 崩溃恢复）。Phase 1 用 LangGraph checkpointer + jsonl 即可；Phase 3 起需要更强的 durable 保障。

## 2. 候选方案

1. **Temporal** — ❌ 需要起独立服务（temporal-server）；桌面端不友好
2. **Prefect 3** — ❌ 偏向数据流编排
3. **DBOS** — ✅ 嵌入式（不需要单独服务）；Pydantic AI 已内置 `durable_exec/dbos`；与本地优先策略契合

## 3. 决策（Proposed）

倾向选 **DBOS**，但 Phase 1 不启用——Phase 1 仅依赖 LangGraph SQLite checkpointer + jsonl。

DBOS 启用计划：
- Phase 3 第一周做 spike：DBOS embedded + Pydantic AI durable_exec/dbos 集成
- 通过 spike 后转 Accepted；否则评估备选

## 4. 影响

- 正面（启用后）：长流程任务跨进程崩溃可完整恢复；与 Pydantic AI 集成成本低
- 负面：DBOS 是相对较新的依赖；社区与 Temporal 比成熟度差距
- 后续验证：Phase 3 spike 报告

## 5. 关联

- specs/state_machines/workflow_run.md §4
- pydantic-ai/pydantic_ai_slim/pydantic_ai/durable_exec/dbos/

## 更新历史

| 日期 | 状态变更 | 备注 |
|---|---|---|
| 2026-06-15 | Proposed | 初稿；待 Phase 3 spike |
