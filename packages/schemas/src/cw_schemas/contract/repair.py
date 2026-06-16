"""cw_schemas.contract.repair — RepairContract + RepairStrategy.

来源：specs/schemas/node_contract.md §1.2.3 / §10
"""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..types import FailureType, RepairKind
from .base import NodeContractBase


class RepairStrategy(BaseModel):
    """修复策略声明（§10）。

    Phase 1 RepairAgent **仅可输出**：
        prompt_patch / context_patch / evidence_patch / model_escalation
    workflow_patch / human_checkpoint 由 Engine 直接生成（D-NC-4）。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    kind: RepairKind = Field(..., description="6 类 patch_kind 之一")
    applies_to_failure_types: list[FailureType] = Field(
        ...,
        min_length=1,
        description="适用的失败类型子集",
    )
    max_uses: int = Field(default=1, ge=1, description="单次执行链路中本策略最多被使用几次")
    guarded_by: str | dict[str, Any] | None = Field(
        default=None,
        description="触发条件（如 'attempts >= 2'）；JSON Logic 或简单表达式",
    )


class RepairContract(NodeContractBase):
    """修复任务契约（§1.2.3）。"""

    contract_kind: Literal["repair"] = "repair"

    repair_strategies: list[RepairStrategy] = Field(
        ...,
        min_length=1,
        description="允许的修复路径（与失败类型对应）",
    )
    output_patch_schema: dict[str, Any] = Field(
        default_factory=dict,
        description="RepairPatch 的 schema（节点可在 repair_patch.md schema 基础上缩窄）",
    )
    attempts_window: int = Field(default=5, ge=1, description="看回最近 N 次 attempts 作为修复输入")
    model_escalation_allowed: bool = Field(
        default=True,
        description="允许 RepairAgent 选择 model_escalation 策略",
    )

    @model_validator(mode="after")
    def _check_repair_invariants(self) -> Self:
        if not self.repair_strategies:
            raise PydanticCustomError(
                "NC_L2_REPAIR_NO_STRATEGIES",
                "repair contract 缺 repair_strategies 或为空",
            )

        if self.prompt is None:
            raise PydanticCustomError(
                "NC_L2_MISSING_PROMPT",
                "repair contract 必须提供 prompt",
            )

        return self


__all__ = ["RepairContract", "RepairStrategy"]
