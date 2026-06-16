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

## 子模块布局（M1.2）

```
src/cw_schemas/
├── __init__.py             # 顶层 re-export + __exported_models__
├── py.typed
├── types.py                # 基础类型 / 枚举（FailureType / Severity / NodeType / EdgeType / ...）
├── ids.py                  # ID 字段约束（ULID-shaped string）
├── metadata.py             # metadata 命名空间 helper
└── workflow/
    ├── __init__.py
    ├── graph.py            # WorkflowGraph + Edge + 顶层 Policy
    ├── nodes.py            # 8 类 WorkflowNode 差异化字段（start/end/exec/eval/repair/human/tool/memory/subflow）
    └── policies.py         # ExecutionPolicy / ReviewPolicy / WorkflowModelPolicy
```

后续 milestone 内追加：

```
src/cw_schemas/
├── contract/         # NodeContract（M1.2 W1.2.3）
├── packs/            # ContextPack / EvidencePack / ExecutionPack（M1.2 W1.2.4）
├── runtime/          # EvaluationResult / RepairPatch / NodeAttempt（M1.2 W1.2.5）
└── events/           # StreamEvent（M1.2 W1.2.6）
```
