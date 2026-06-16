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
- W1.2.3 ⏳ contract（NodeContract）
- W1.2.4 ⏳ packs（ContextPack / EvidencePack）
- W1.2.5 ⏳ runtime（EvaluationResult / RepairPatch）
- W1.2.6 ⏳ events（StreamEvent）
"""

from __future__ import annotations

from . import ids, metadata, types
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

# codegen 入口：scripts/codegen/generate-json-schemas.py 会迭代本字典，
# 把每个 Pydantic 模型 dump 为 JSON Schema → 派生 TS 类型。
# M1.2 后续 milestone 内陆续注册 NodeContract / ContextPack / EvaluationResult / 等
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
}

__all__ = [
    "CURRENT_SCHEMA_VERSION",
    "ArchiveAction",
    "DraftSource",
    "EdgeCondition",
    "EdgeStyle",
    "EndNode",
    "EvaluationTaskNode",
    "ExecutionPolicy",
    "ExecutionTaskNode",
    "HumanCheckpointNode",
    "HumanDecisionDef",
    "MemoryTaskNode",
    "NodePosition",
    "RepairTaskNode",
    "ReviewPolicy",
    "StartNode",
    "SubflowNode",
    "ToolTaskNode",
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
