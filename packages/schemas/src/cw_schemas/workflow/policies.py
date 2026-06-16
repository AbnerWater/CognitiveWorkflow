"""cw_schemas.workflow.policies — WorkflowGraph 全局策略对象。

来源：specs/schemas/workflow_graph.md §5.1 / §5.2 / §5.3
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from ..types import ExecutionMode, OnNodeFailure


class ExecutionPolicy(BaseModel):
    """全局执行策略（workflow_graph.md §5.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    mode: ExecutionMode = Field(
        default=ExecutionMode.SEMI_AUTO,
        description="执行模式，与 UIUX FR-007 三种模式对齐",
    )
    max_concurrent_nodes: int = Field(
        default=1,
        ge=1,
        description="全局并发上限；Phase 1 默认 1",
    )
    default_timeout_seconds: int = Field(
        default=600,
        ge=1,
        description="节点级未声明 timeout 时的默认值",
    )
    on_node_failure: OnNodeFailure = Field(
        default=OnNodeFailure.HUMAN,
        description="非审查类节点本身失败时的处理",
    )


class ReviewPolicy(BaseModel):
    """全局审查策略（workflow_graph.md §5.2）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    default_max_retry: int = Field(
        default=2,
        ge=0,
        description="evaluation_task 未声明 max_retry 时使用",
    )
    escalate_after_repairs: int = Field(
        default=3,
        ge=0,
        description="累计 repair 次数超过此值进入 human_checkpoint",
    )
    evidence_required_for_factual_outputs: bool = Field(
        default=True,
        description="事实性输出强制要求 EvidencePack 覆盖",
    )


class WorkflowModelPolicy(BaseModel):
    """全局模型策略（workflow_graph.md §5.3）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    default_model_profile_id: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="节点未声明模型时使用；ModelProfile 全局唯一 ID",
    )
    escalation_chain: list[str] = Field(
        default_factory=list,
        description="模型升级链；ModelRouter 在 model_capability_limit 触发时按序升级",
    )
    forbid_remote_for_sensitive: bool = Field(
        default=True,
        description="metadata.sensitive=true 的节点禁止使用远程 Provider",
    )


__all__ = [
    "ExecutionPolicy",
    "ReviewPolicy",
    "WorkflowModelPolicy",
]
