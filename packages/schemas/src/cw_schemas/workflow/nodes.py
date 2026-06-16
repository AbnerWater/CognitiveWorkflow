"""cw_schemas.workflow.nodes — 8 类 WorkflowNode 的差异化字段。

来源：specs/schemas/workflow_graph.md §2

设计要点：
- 公共字段 → WorkflowNodeBase
- 类型差异化 → 各子类用 type 字段做 discriminator
- 路由字段（on_pass_next_node_id 等）保留在节点级声明；与边声明互斥/合并由 graph.py 校验
- contract 字段在 M1.2 W1.2.3 完成后已升级为 NodeContract（discriminated union）

实现注意：discriminator 的 type 字段用字符串 Literal（mypy strict 兼容），
不直接用 Literal[NodeType.X]——后者在 mypy 严格模式下会被拒绝。
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..contract import NodeContract
from ..ids import LooseId
from ..metadata import MetadataDict
from ..types import (
    NodeType,
    StartTrigger,
    TimeoutAction,
)

# NodeType ↔ ContractKind 必须一一对应（与 node_contract.md §2 表对齐）
_NODE_TYPE_TO_CONTRACT_KIND: dict[str, str] = {
    NodeType.EXECUTION_TASK.value: "execution",
    NodeType.EVALUATION_TASK.value: "evaluation",
    NodeType.REPAIR_TASK.value: "repair",
    NodeType.HUMAN_CHECKPOINT.value: "human_gate",
    NodeType.TOOL_TASK.value: "tool",
    NodeType.MEMORY_TASK.value: "memory",
}

# 这些节点类型 contract 必填
_NODE_TYPES_REQUIRING_CONTRACT: set[str] = set(_NODE_TYPE_TO_CONTRACT_KIND.keys())


class NodePosition(BaseModel):
    """Canvas 位置；Engine 不读取，仅前端使用。"""

    model_config = ConfigDict(extra="forbid")

    x: float = 0.0
    y: float = 0.0


class WorkflowNodeBase(BaseModel):
    """所有 WorkflowNode 的公共字段（workflow_graph.md §2.1）。

    `type` 字段在子类中由 `Literal[...]` 收紧；本基类仅占位为 `str`，
    实际值必须在 `NodeType` 枚举值集合内（运行时由 Pydantic discriminator 验证）。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    node_id: LooseId = Field(
        ...,
        description="节点 ID；草案阶段允许 LooseId，实例化后必须是 ULID/UUIDv7",
    )
    type: str = Field(
        ...,
        description="节点类型；子类用 Literal 收紧，必须在 NodeType 枚举值内",
    )
    title: str = Field(..., min_length=1, max_length=120, description="Canvas 标签")
    description: str | None = Field(default=None, max_length=2000, description="节点说明")
    position: NodePosition | None = Field(default=None, description="Canvas 位置；Engine 忽略")
    tags: list[str] = Field(default_factory=list, description="自由标签，用于过滤")
    metadata: MetadataDict = Field(default_factory=dict, description="命名空间化扩展字段（D-WG-4）")
    contract: NodeContract | None = Field(
        default=None,
        description=(
            "节点契约；NodeContract 6 类 discriminated union（contract_kind）。"
            "start/end/subflow 必须为 None；execution/evaluation/repair/human_checkpoint/tool/memory 必填。"
        ),
    )

    @model_validator(mode="after")
    def _check_node_contract_kind_match(self) -> Self:
        """校验 NodeType ↔ ContractKind 一致性（NC_L2_KIND_MISMATCH）。

        - start/end/subflow：contract 必须为 None
        - 其它节点：contract 必填，且 contract.contract_kind 与 NodeType 对应表一致
        """
        # contract = None 时
        if self.contract is None:
            if self.type in _NODE_TYPES_REQUIRING_CONTRACT:
                raise PydanticCustomError(
                    "NC_L2_CONTRACT_REQUIRED",
                    f"节点 type={self.type} 必填 contract，但实际为 None",
                )
            return self

        # contract != None 时
        if self.type not in _NODE_TYPE_TO_CONTRACT_KIND:
            # start/end/subflow 不应有 contract
            raise PydanticCustomError(
                "NC_L2_KIND_MISMATCH",
                f"节点 type={self.type} 不应有 contract（仅执行/评价/修复/人工/工具/记忆类节点支持）",
            )

        expected_kind = _NODE_TYPE_TO_CONTRACT_KIND[self.type]
        if self.contract.contract_kind != expected_kind:
            raise PydanticCustomError(
                "NC_L2_KIND_MISMATCH",
                f"节点 type={self.type} 与 contract.contract_kind={self.contract.contract_kind} 不匹配；"
                f"预期 contract_kind={expected_kind}",
            )

        return self


# =============================================================================
# 8 类节点的差异化字段
#
# discriminator 的 `type` 字段使用字符串 Literal（与 NodeType 枚举值字符串一致），
# 这样 mypy strict 与 Pydantic v2 discriminated union 都能正确识别。
# =============================================================================


class StartNode(WorkflowNodeBase):
    """图入口节点（§2.3.1）。"""

    type: Literal["start"] = "start"
    trigger: StartTrigger = Field(default=StartTrigger.MANUAL, description="Phase 1 仅允许 manual")
    initial_input_schema: dict[str, Any] | None = Field(
        default=None,
        description="用户在启动 Run 时输入的结构化数据形态（JSON Schema）",
    )


class ArchiveAction(BaseModel):
    """end 节点的归档动作。"""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(..., description="例：export_markdown / git_tag / write_memory")
    to: str | None = Field(default=None, description="目标路径或 tag 名")
    options: dict[str, Any] = Field(default_factory=dict)


class EndNode(WorkflowNodeBase):
    """图终点（§2.3.2）。"""

    type: Literal["end"] = "end"
    archive_actions: list[ArchiveAction] = Field(default_factory=list, description="归档动作列表")


class ExecutionTaskNode(WorkflowNodeBase):
    """执行任务节点（§2.2 / §6.3）。"""

    type: Literal["execution_task"] = "execution_task"


class EvaluationTaskNode(WorkflowNodeBase):
    """评价任务节点（§2.3.3）。"""

    type: Literal["evaluation_task"] = "evaluation_task"
    target_node_id: LooseId = Field(..., description="被审查的节点 ID")
    on_pass_next_node_id: LooseId | None = Field(default=None, description="二选一：本字段或对应 pass 边")
    on_fail_next_node_id: LooseId | None = Field(default=None, description="二选一：本字段或对应 fail 边")
    max_retry: int = Field(..., ge=0, description="不通过后允许的回流次数；超过转 human_checkpoint")


class RepairTaskNode(WorkflowNodeBase):
    """修复任务节点（§2.3.4）。"""

    type: Literal["repair_task"] = "repair_task"
    repair_target_node_id: LooseId = Field(..., description="被修复的执行节点 ID")
    failure_input_ref: str = Field(
        ...,
        min_length=1,
        max_length=256,
        description="EvaluationResult ID 或占位符（如 $last_evaluation）",
    )
    on_repair_next_node_id: LooseId = Field(..., description="修复后回到的节点（通常 = repair_target_node_id）")


class HumanDecisionDef(BaseModel):
    """human_checkpoint 节点的决策定义。"""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="标准枚举：continue/reject/edit/escalate；自定义必须以 custom_ 前缀",
    )
    label: str | None = Field(default=None, max_length=64, description="UI 显示标签")


class HumanCheckpointNode(WorkflowNodeBase):
    """人工检查点节点（§2.3.5）。"""

    type: Literal["human_checkpoint"] = "human_checkpoint"
    decisions: list[HumanDecisionDef] = Field(
        ...,
        min_length=1,
        description="用户可选择的决策枚举；至少含 continue",
    )
    routing_map: dict[str, LooseId] = Field(
        ...,
        min_length=1,
        description="每个决策 key → 下游节点映射",
    )
    timeout_action: TimeoutAction | None = Field(default=None, description="用户长时间无响应时的兜底")


class ToolTaskNode(WorkflowNodeBase):
    """确定性工具节点（§2.2 表）。"""

    type: Literal["tool_task"] = "tool_task"


class MemoryTaskNode(WorkflowNodeBase):
    """项目级 Memory 读写节点（§2.2 表 + D-RH-2）。"""

    type: Literal["memory_task"] = "memory_task"


class SubflowNode(WorkflowNodeBase):
    """子工作流嵌入（§2.2，Phase 4 启用）。"""

    type: Literal["subflow"] = "subflow"
    subflow_workflow_id: LooseId | None = Field(default=None, description="被嵌入的 Workflow ID")


# =============================================================================
# Discriminated union：WorkflowNode
# =============================================================================

WorkflowNode = Annotated[
    StartNode
    | EndNode
    | ExecutionTaskNode
    | EvaluationTaskNode
    | RepairTaskNode
    | HumanCheckpointNode
    | ToolTaskNode
    | MemoryTaskNode
    | SubflowNode,
    Field(discriminator="type"),
]
"""8 类 WorkflowNode 判别式联合。"""


# 重新导出 NodeType 便于其它模块按 NodeType 比较 .type 字段（运行时枚举值即字符串相等）
__all__ = [
    "ArchiveAction",
    "EndNode",
    "EvaluationTaskNode",
    "ExecutionTaskNode",
    "HumanCheckpointNode",
    "HumanDecisionDef",
    "MemoryTaskNode",
    "NodePosition",
    "NodeType",
    "RepairTaskNode",
    "StartNode",
    "SubflowNode",
    "ToolTaskNode",
    "WorkflowNode",
    "WorkflowNodeBase",
]
