"""cw_schemas.workflow — WorkflowGraph 主链 schema 落地。

子模块：
- policies.py — ExecutionPolicy / ReviewPolicy / WorkflowModelPolicy
- nodes.py    — 8 类 WorkflowNode 的差异化字段（discriminated union）
- graph.py    — 顶层 WorkflowGraph + WorkflowEdge + DraftSource

落地依据：specs/schemas/workflow_graph.md（v0.1.0 Accepted）
"""

from __future__ import annotations

from .graph import (
    DraftSource,
    EdgeCondition,
    EdgeStyle,
    WorkflowEdge,
    WorkflowGraph,
)
from .nodes import (
    ArchiveAction,
    EndNode,
    EvaluationTaskNode,
    ExecutionTaskNode,
    HumanCheckpointNode,
    HumanDecisionDef,
    MemoryTaskNode,
    NodePosition,
    RepairTaskNode,
    StartNode,
    SubflowNode,
    ToolTaskNode,
    WorkflowNode,
    WorkflowNodeBase,
)
from .policies import (
    ExecutionPolicy,
    ReviewPolicy,
    WorkflowModelPolicy,
)

__all__ = [
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
    "WorkflowModelPolicy",
    "WorkflowNode",
    "WorkflowNodeBase",
]
