# cw_schemas

CognitiveWorkflow 的共享 Pydantic v2 schema 包——**单一真理来源**（ADR-0003）。

## 职责

承载 CW 全部对象的 Pydantic 模型实现：
- `WorkflowGraph / WorkflowNode / WorkflowEdge`
- `NodeContract / ContextRequirement / EvidenceRequirement / SkillRef / MCPToolRef / NodeModelPolicy / RetryPolicy / ValidatorPolicy`
- `ContextPack / ContextFragment / ContextBudget`
- `EvidencePack / Evidence / EvidenceCoverage / EvidenceConflict / RequirementResolution`
- `EvaluationResult / CriterionResult / Finding / FailureDiagnosis / RecommendedAction / ArbitrationOutcome`
- `RepairPatch / Operation / ReversalHint`
- `StreamEvent / EventCategory / EventPhase / ArtifactRef / FailureType`

## 强约束

- 仅依赖 `pydantic>=2.10`
- **严禁**依赖 `cw_runtime / pydantic-ai / fastapi / httpx / langgraph` 等运行时库（ADR-0003 §3）
- 本包内部不允许 IO 操作；模型必须 JSON-serializable

## 派生

`packages/schemas-ts`（npm `@cw/schemas`）由本包 + `make codegen` 自动生成；**不允许**手改 TS 类型。

## 测试

`tests/` 内每条 spec 错误码 / 状态枚举至少 1 条契约测试。
