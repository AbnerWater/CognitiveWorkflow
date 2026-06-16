"""cw_schemas.contract.human_gate — HumanGateContract.

来源：specs/schemas/node_contract.md §1.2.4
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..types import HumanDecisionKey, TimeoutAction
from .base import NodeContractBase


class HumanDecision(BaseModel):
    """人工决策定义（HumanGateContract.decisions[*]）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    key: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="标准枚举：continue/reject/edit/escalate；自定义必须以 custom_ 前缀",
    )
    label: str | None = Field(default=None, max_length=64, description="UI 显示标签")


class HumanGateContract(NodeContractBase):
    """人工检查点契约（§1.2.4）。"""

    contract_kind: Literal["human_gate"] = "human_gate"

    decisions: list[HumanDecision] = Field(
        ...,
        min_length=1,
        description="用户可选决策；至少含 continue",
    )
    prompt_to_user: str = Field(..., min_length=1, description="UI 上展示给用户的指引")
    present_artifacts: list[str] = Field(
        default_factory=lambda: ["primary_artifact"],
        description="展示给用户审阅的产物字段",
    )
    present_evidence: bool = Field(default=True, description="是否同时展示 EvidencePack")
    timeout_seconds: int | None = Field(default=None, ge=1, description="等待超时；null = 无限等待")
    timeout_action: TimeoutAction = Field(default=TimeoutAction.HOLD, description="超时兜底")

    @model_validator(mode="after")
    def _check_decisions(self) -> Self:
        # 必须至少含 continue（标准枚举或 custom_）
        keys = {d.key for d in self.decisions}
        valid_standard = {k.value for k in HumanDecisionKey}
        for k in keys:
            if k not in valid_standard and not k.startswith("custom_"):
                raise PydanticCustomError(
                    "NC_L2_HUMAN_GATE_INVALID_DECISION_KEY",
                    f"decision key={k!r} 非法：必须 ∈ {valid_standard} 或以 custom_ 开头",
                )
        if HumanDecisionKey.CONTINUE.value not in keys:
            raise PydanticCustomError(
                "NC_L2_HUMAN_GATE_MISSING_CONTINUE",
                "human_gate decisions 必须含 continue（用户审批通过路径）",
            )
        return self


__all__ = ["HumanDecision", "HumanGateContract"]
