"""cw_schemas — CognitiveWorkflow shared Pydantic v2 schemas.

单一真理来源（ADR-0003）：所有 CW 对象的 Pydantic 模型在此定义。
派生的 TS 类型在 `packages/schemas-ts`（@cw/schemas），由 `make codegen` 自动生成。

强约束：
- 仅依赖 pydantic v2
- 禁止依赖 cw_runtime / pydantic-ai / fastapi 等运行时库
- 内部禁止 IO 操作

M1.2 进度（2026-06-15）：
- W1.2.1 ✅ types / ids / metadata
- W1.2.2 ✅ workflow.graph + nodes + policies
- W1.2.3 ✅ contract（NodeContract 6 类）
- W1.2.4 ⏳ packs（ContextPack / EvidencePack）
- W1.2.5 ⏳ runtime（EvaluationResult / RepairPatch）
- W1.2.6 ⏳ events（StreamEvent）
"""

from __future__ import annotations

from . import ids, metadata, types
from .contract import (
    ContextRequirement,
    ContextSelector,
    EvaluationContract,
    EvaluationCriterion,
    EvidenceRequirement,
    ExecutionContract,
    ExtraValidatorRef,
    FailCondition,
    HumanDecision,
    HumanGateContract,
    MCPToolRef,
    MemoryContract,
    NodeContract,
    NodeContractBase,
    NodeModelPolicy,
    PassCondition,
    ProjectMemorySelector,
    PromptSection,
    ReferenceSelector,
    RepairContract,
    RepairStrategy,
    RetryPolicy,
    SkillRef,
    StaticTextSelector,
    ToolContract,
    UpstreamArtifactSelector,
    UserInputSelector,
    ValidatorPolicy,
)
from .workflow import (
    ArchiveAction,
    DraftSource,
    EdgeCondition,
    EdgeStyle,
    EndNode,
    EvaluationTaskNode,
    ExecutionPolicy,
    ExecutionTaskNode,
    HumanCheckpointNode,
    HumanDecisionDef,
    MemoryTaskNode,
    NodePosition,
    RepairTaskNode,
    ReviewPolicy,
    StartNode,
    SubflowNode,
    ToolTaskNode,
    WorkflowEdge,
    WorkflowGraph,
    WorkflowModelPolicy,
    WorkflowNode,
)
from .workflow.graph import CURRENT_SCHEMA_VERSION

__version__ = "0.1.0"

# codegen 入口
__exported_models__: dict[str, type] = {
    # workflow
    "WorkflowGraph": WorkflowGraph,
    "WorkflowEdge": WorkflowEdge,
    "EdgeCondition": EdgeCondition,
    "EdgeStyle": EdgeStyle,
    "DraftSource": DraftSource,
    "ExecutionPolicy": ExecutionPolicy,
    "ReviewPolicy": ReviewPolicy,
    "WorkflowModelPolicy": WorkflowModelPolicy,
    # nodes
    "StartNode": StartNode,
    "EndNode": EndNode,
    "ExecutionTaskNode": ExecutionTaskNode,
    "EvaluationTaskNode": EvaluationTaskNode,
    "RepairTaskNode": RepairTaskNode,
    "HumanCheckpointNode": HumanCheckpointNode,
    "ToolTaskNode": ToolTaskNode,
    "MemoryTaskNode": MemoryTaskNode,
    "SubflowNode": SubflowNode,
    "HumanDecisionDef": HumanDecisionDef,
    "ArchiveAction": ArchiveAction,
    "NodePosition": NodePosition,
    # contract — 6 类
    "ExecutionContract": ExecutionContract,
    "EvaluationContract": EvaluationContract,
    "RepairContract": RepairContract,
    "HumanGateContract": HumanGateContract,
    "ToolContract": ToolContract,
    "MemoryContract": MemoryContract,
    # contract 子对象
    "PromptSection": PromptSection,
    "ContextRequirement": ContextRequirement,
    "EvidenceRequirement": EvidenceRequirement,
    "EvaluationCriterion": EvaluationCriterion,
    "PassCondition": PassCondition,
    "FailCondition": FailCondition,
    "RepairStrategy": RepairStrategy,
    "HumanDecision": HumanDecision,
    "SkillRef": SkillRef,
    "MCPToolRef": MCPToolRef,
    "ExtraValidatorRef": ExtraValidatorRef,
    "NodeModelPolicy": NodeModelPolicy,
    "RetryPolicy": RetryPolicy,
    "ValidatorPolicy": ValidatorPolicy,
}

__all__ = [
    "CURRENT_SCHEMA_VERSION",
    "ArchiveAction",
    "ContextRequirement",
    "ContextSelector",
    "DraftSource",
    "EdgeCondition",
    "EdgeStyle",
    "EndNode",
    "EvaluationContract",
    "EvaluationCriterion",
    "EvaluationTaskNode",
    "EvidenceRequirement",
    "ExecutionContract",
    "ExecutionPolicy",
    "ExecutionTaskNode",
    "ExtraValidatorRef",
    "FailCondition",
    "HumanCheckpointNode",
    "HumanDecision",
    "HumanDecisionDef",
    "HumanGateContract",
    "MCPToolRef",
    "MemoryContract",
    "MemoryTaskNode",
    "NodeContract",
    "NodeContractBase",
    "NodeModelPolicy",
    "NodePosition",
    "PassCondition",
    "ProjectMemorySelector",
    "PromptSection",
    "ReferenceSelector",
    "RepairContract",
    "RepairStrategy",
    "RepairTaskNode",
    "RetryPolicy",
    "ReviewPolicy",
    "SkillRef",
    "StartNode",
    "StaticTextSelector",
    "SubflowNode",
    "ToolContract",
    "ToolTaskNode",
    "UpstreamArtifactSelector",
    "UserInputSelector",
    "ValidatorPolicy",
    "WorkflowEdge",
    "WorkflowGraph",
    "WorkflowModelPolicy",
    "WorkflowNode",
    "__exported_models__",
    "__version__",
    "ids",
    "metadata",
    "types",
]
