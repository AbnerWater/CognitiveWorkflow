"""cw_schemas.workflow.graph — WorkflowGraph 顶层结构 + WorkflowEdge + 不变量校验。

来源：specs/schemas/workflow_graph.md §1 / §3 / §11

不变量（§1.2 + §10）由 model_validator(mode='after') 实现。
错误码 WG_L2_* 通过 ValueError(code='WG_L2_...') 抛出。
"""

from __future__ import annotations

import re
from typing import Any, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)
from pydantic_core import PydanticCustomError

from ..ids import LooseId, is_valid_id
from ..metadata import MetadataDict, validate_namespaced_metadata
from ..types import CreatedBy, EdgeType, NodeType
from .nodes import EvaluationTaskNode, RepairTaskNode, WorkflowNode
from .policies import ExecutionPolicy, ReviewPolicy, WorkflowModelPolicy

# SemVer 简版（major.minor.patch；接受 -prerelease 后缀）
_SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[A-Za-z0-9.-]+)?$")

CURRENT_SCHEMA_VERSION = "0.1.0"


# =============================================================================
# WorkflowEdge & 子对象
# =============================================================================


class EdgeStyle(BaseModel):
    """渲染样式提示；Engine 忽略。"""

    model_config = ConfigDict(extra="forbid")

    color: str | None = None
    dashed: bool = False
    width: float | None = None


class EdgeCondition(BaseModel):
    """仅 optional / 扩展条件型边使用（§3.3）。"""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(
        ...,
        description="expression / capability / artifact_present / always_false",
    )
    expression: dict[str, Any] | None = Field(default=None, description="JSON Logic 子集；当 kind=expression 时必填")
    requires_capability: str | None = Field(default=None, description="例：mcp.search.web；当 kind=capability 时必填")
    requires_artifact_id: str | None = Field(default=None, description="当 kind=artifact_present 时必填")

    @model_validator(mode="after")
    def _check_kind_field_present(self) -> Self:
        if self.kind == "expression" and self.expression is None:
            raise PydanticCustomError(
                "edge_condition_missing_field",
                "EdgeCondition.kind=expression 时必须提供 expression",
            )
        if self.kind == "capability" and self.requires_capability is None:
            raise PydanticCustomError(
                "edge_condition_missing_field",
                "EdgeCondition.kind=capability 时必须提供 requires_capability",
            )
        if self.kind == "artifact_present" and self.requires_artifact_id is None:
            raise PydanticCustomError(
                "edge_condition_missing_field",
                "EdgeCondition.kind=artifact_present 时必须提供 requires_artifact_id",
            )
        return self


class WorkflowEdge(BaseModel):
    """图边（§3.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    edge_id: LooseId
    source_node_id: LooseId
    target_node_id: LooseId
    type: EdgeType
    condition: EdgeCondition | None = None
    label: str | None = Field(default=None, max_length=64)
    style: EdgeStyle | None = None
    metadata: MetadataDict = Field(default_factory=dict)


# =============================================================================
# DraftSource
# =============================================================================


class DraftSource(BaseModel):
    """草案来源（§4.2）。"""

    model_config = ConfigDict(extra="forbid")

    planning_session_id: str | None = None
    draft_version: int | None = Field(default=None, ge=0)
    applied_patches: list[str] = Field(default_factory=list)
    template_id: str | None = None


# =============================================================================
# WorkflowGraph 顶层
# =============================================================================


class WorkflowGraph(BaseModel):
    """CW Workflow 有向图顶层结构（§1.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    workflow_id: LooseId = Field(..., description="ULID/UUIDv7；草案阶段允许 LooseId")
    version: str = Field(
        ...,
        description="SemVer；草案版本由 draft.version: int 区分（D-WG-1）",
    )
    schema_version: str = Field(
        default=CURRENT_SCHEMA_VERSION,
        description="本 spec 版本号；用于未来兼容性升级判定",
    )
    title: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)

    nodes: list[WorkflowNode] = Field(..., min_length=2)
    edges: list[WorkflowEdge] = Field(default_factory=list)

    entry_node_id: LooseId
    terminal_node_ids: list[LooseId] = Field(..., min_length=1)

    global_context_refs: list[str] = Field(default_factory=list)
    execution_policy: ExecutionPolicy
    review_policy: ReviewPolicy
    model_policy: WorkflowModelPolicy

    created_by: CreatedBy
    draft_source: DraftSource | None = None

    created_at: str = Field(..., description="ISO-8601 UTC")
    last_modified_at: str = Field(..., description="ISO-8601 UTC")
    metadata: MetadataDict = Field(default_factory=dict)

    # ---------------------------------------------------------------------
    # 不变量与 L1/L2 校验（错误码命名空间 WG_*，与 spec §11 一致）
    # ---------------------------------------------------------------------

    @model_validator(mode="after")
    def _validate_invariants(self) -> Self:
        # ---- §1.2 不变量 ----

        # schema_version 必须是已知版本
        if self.schema_version != CURRENT_SCHEMA_VERSION:
            raise PydanticCustomError(
                "WG_L2_BAD_SCHEMA_VERSION",
                f"schema_version={self.schema_version!r} 未知；当前支持 {CURRENT_SCHEMA_VERSION!r}",
            )

        # version 必须是合法 SemVer
        if not _SEMVER_RE.fullmatch(self.version):
            raise PydanticCustomError(
                "WG_L2_BAD_SCHEMA_VERSION",
                f"version={self.version!r} 不是合法 SemVer",
            )

        # ID 形态校验（兜底；StringConstraints 已粗筛）
        for nid in [self.workflow_id, self.entry_node_id, *self.terminal_node_ids]:
            if not is_valid_id(nid):
                raise ValueError(f"ID 不合法：{nid!r}")

        # ---- §11 校验：节点 ID 唯一 ----
        seen_node_ids: set[str] = set()
        for n in self.nodes:
            if n.node_id in seen_node_ids:
                raise PydanticCustomError(
                    "WG_L2_DUP_NODE_ID",
                    f"节点 ID 重复：{n.node_id}",
                )
            seen_node_ids.add(n.node_id)

        # ---- §11 校验：边 ID 唯一 ----
        seen_edge_ids: set[str] = set()
        for e in self.edges:
            if e.edge_id in seen_edge_ids:
                raise PydanticCustomError(
                    "WG_L2_DUP_EDGE_ID",
                    f"边 ID 重复：{e.edge_id}",
                )
            seen_edge_ids.add(e.edge_id)

        # ---- §11 校验：entry / terminals 必须存在且类型正确 ----
        node_by_id: dict[str, WorkflowNode] = {n.node_id: n for n in self.nodes}

        if self.entry_node_id not in node_by_id:
            raise PydanticCustomError(
                "WG_L2_MISSING_ENTRY_NODE",
                f"entry_node_id={self.entry_node_id} 不在 nodes 内",
            )
        entry = node_by_id[self.entry_node_id]
        if entry.type != NodeType.START.value:
            raise PydanticCustomError(
                "WG_L2_MISSING_ENTRY_NODE",
                f"entry_node_id={self.entry_node_id} 不是 start 节点（实际 type={entry.type})",
            )

        # 多 start 检测（D-WG-2）
        start_node_ids = [n.node_id for n in self.nodes if n.type == NodeType.START.value]
        if len(start_node_ids) > 1:
            raise PydanticCustomError(
                "WG_L3_MULTIPLE_ENTRIES",
                f"出现多个 start 节点（{start_node_ids}）；CW 不允许多 entry，多入口由 subflow 表达",
            )

        for tid in self.terminal_node_ids:
            if tid not in node_by_id:
                raise PydanticCustomError(
                    "WG_L2_MISSING_TERMINAL_NODES",
                    f"terminal_node_ids 中 {tid} 不在 nodes 内",
                )
            if node_by_id[tid].type != NodeType.END.value:
                raise PydanticCustomError(
                    "WG_L2_MISSING_TERMINAL_NODES",
                    f"terminal_node_ids 中 {tid} 不是 end 节点（实际 type={node_by_id[tid].type})",
                )

        # ---- §11 校验：边的 source / target 必须在 nodes 内 ----
        for e in self.edges:
            if e.source_node_id not in node_by_id:
                raise PydanticCustomError(
                    "WG_L2_DUP_EDGE_ID",
                    f"边 {e.edge_id} 的 source_node_id={e.source_node_id} 不在 nodes 内",
                )
            if e.target_node_id not in node_by_id:
                raise PydanticCustomError(
                    "WG_L2_DUP_EDGE_ID",
                    f"边 {e.edge_id} 的 target_node_id={e.target_node_id} 不在 nodes 内",
                )

        # ---- §11 校验：evaluation_task 路由（节点声明 ↔ 边声明合并） ----
        for n in self.nodes:
            if isinstance(n, EvaluationTaskNode):
                self._validate_evaluation_routing(n)
            elif isinstance(n, RepairTaskNode):
                self._validate_repair_target_exists(n, node_by_id)

        # ---- §11 校验：metadata 命名空间化（D-WG-4） ----
        violations = validate_namespaced_metadata(self.metadata, allow_top_level_cw_keys=True)
        if violations:
            raise PydanticCustomError(
                "WG_L2_METADATA_NOT_NAMESPACED",
                f"WorkflowGraph.metadata 不合规：{violations}",
            )
        for n in self.nodes:
            v = validate_namespaced_metadata(n.metadata, allow_top_level_cw_keys=True)
            if v:
                raise PydanticCustomError(
                    "WG_L2_METADATA_NOT_NAMESPACED",
                    f"节点 {n.node_id}.metadata 不合规：{v}",
                )
        for e in self.edges:
            v = validate_namespaced_metadata(e.metadata, allow_top_level_cw_keys=True)
            if v:
                raise PydanticCustomError(
                    "WG_L2_METADATA_NOT_NAMESPACED",
                    f"边 {e.edge_id}.metadata 不合规：{v}",
                )

        return self

    def _validate_evaluation_routing(self, n: EvaluationTaskNode) -> None:
        """evaluation_task 必须有 pass / fail 路由（§11 WG_L2_EVAL_NO_PASS_ROUTE / FAIL）。

        允许两种来源：
        - 节点声明（on_pass_next_node_id / on_fail_next_node_id）
        - 显式 Edge（type=pass / fail，source=该节点）
        - 节点声明与边声明的目标必须一致；冲突则 *_MISMATCH
        """
        # 找出该节点的 pass / fail 边
        pass_edges = [e for e in self.edges if e.source_node_id == n.node_id and e.type == EdgeType.PASS]
        fail_edges = [e for e in self.edges if e.source_node_id == n.node_id and e.type == EdgeType.FAIL]

        # ---- pass 路由 ----
        node_pass = n.on_pass_next_node_id
        edge_pass = pass_edges[0].target_node_id if pass_edges else None

        if node_pass is None and edge_pass is None:
            raise PydanticCustomError(
                "WG_L2_EVAL_NO_PASS_ROUTE",
                f"evaluation_task {n.node_id} 缺 pass 路由（节点未声明且无 pass 边）",
            )
        if node_pass is not None and edge_pass is not None and node_pass != edge_pass:
            raise PydanticCustomError(
                "WG_L2_EVAL_PASS_ROUTE_MISMATCH",
                f"evaluation_task {n.node_id} 节点声明 pass={node_pass} 与边声明 pass={edge_pass} 冲突",
            )

        # ---- fail 路由 ----
        node_fail = n.on_fail_next_node_id
        edge_fail = fail_edges[0].target_node_id if fail_edges else None

        if node_fail is None and edge_fail is None:
            raise PydanticCustomError(
                "WG_L2_EVAL_NO_FAIL_ROUTE",
                f"evaluation_task {n.node_id} 缺 fail 路由（节点未声明且无 fail 边）",
            )
        if node_fail is not None and edge_fail is not None and node_fail != edge_fail:
            raise PydanticCustomError(
                "WG_L2_EVAL_FAIL_ROUTE_MISMATCH",
                f"evaluation_task {n.node_id} 节点声明 fail={node_fail} 与边声明 fail={edge_fail} 冲突",
            )

        # ---- target_node_id 必须在 nodes 内 ----
        # （由 _validate_invariants 主流程在节点 ID set 内做更宽校验；此处只断言非空）
        if not n.target_node_id:
            raise PydanticCustomError(
                "WG_L2_EVAL_MISSING_TARGET",
                f"evaluation_task {n.node_id} 缺 target_node_id",
            )

    def _validate_repair_target_exists(
        self,
        n: RepairTaskNode,
        node_by_id: dict[str, WorkflowNode],
    ) -> None:
        if n.repair_target_node_id not in node_by_id:
            raise PydanticCustomError(
                "WG_L2_REPAIR_MISSING_TARGET",
                f"repair_task {n.node_id} 的 repair_target_node_id={n.repair_target_node_id} 不在 nodes 内",
            )


__all__ = [
    "CURRENT_SCHEMA_VERSION",
    "DraftSource",
    "EdgeCondition",
    "EdgeStyle",
    "WorkflowEdge",
    "WorkflowGraph",
]
