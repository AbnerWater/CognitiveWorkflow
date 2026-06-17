"""cw_schemas.contract.evaluation — EvaluationContract + 子对象。

来源：specs/schemas/node_contract.md §1.2.2 / §9
"""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..ids import LooseId
from ..types import ArbitrationMode, CriterionKind, Severity
from .base import NodeContractBase

# =============================================================================
# EvaluationCriterion
# =============================================================================


class EvaluationCriterion(BaseModel):
    """单条审查规则（§9.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    criterion_id: LooseId = Field(..., description="节点内唯一")
    description: str = Field(..., min_length=1, description="业务语言描述")
    kind: CriterionKind = Field(..., description="校验形式")
    severity: Severity = Field(default=Severity.MAJOR, description="失败严重程度")
    weight: float = Field(default=1.0, ge=0.0, le=1.0, description="用于综合评分")
    expression: str | dict[str, Any] | None = Field(
        default=None,
        description="具体表达：rubric 文本 / JSON Logic / 正则 / JSON Schema 路径 / 阈值表达式",
    )


# =============================================================================
# PassCondition / FailCondition
# =============================================================================


class _ConditionBase(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    combinator: Literal["all_pass", "any_pass", "weighted_score", "custom"] = Field(
        ...,
        description="组合方式",
    )
    threshold: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="当 combinator=weighted_score 时必填；综合分通过阈值",
    )
    must_pass_blockers: bool = Field(
        default=True,
        description="任意 severity=blocker 失败一律视为失败 / 通过判定",
    )

    @model_validator(mode="after")
    def _check_threshold(self) -> Self:
        if self.combinator == "weighted_score" and self.threshold is None:
            raise PydanticCustomError(
                "NC_L2_EVAL_BAD_PASS_THRESHOLD",
                "combinator=weighted_score 时必须提供 threshold",
            )
        return self


class PassCondition(_ConditionBase):
    """通过条件（§9.2）。"""


class FailCondition(_ConditionBase):
    """失败条件（§9.2）。

    与 PassCondition 互斥但不必互补：可以同时存在"未通过 + 未失败"的中间态，
    由 Engine 驱动重试或人工介入。
    """


# =============================================================================
# EvaluationContract
# =============================================================================


class EvaluationContract(NodeContractBase):
    """评价任务契约（§1.2.2）。"""

    contract_kind: Literal["evaluation"] = "evaluation"

    criteria: list[EvaluationCriterion] = Field(
        ...,
        json_schema_extra={"minItems": 1},
        description="审查规则集；至少 1 条",
    )
    pass_condition: PassCondition = Field(..., description="通过条件")
    fail_condition: FailCondition = Field(..., description="失败条件")
    failure_diagnosis_schema: dict[str, Any] = Field(
        default_factory=dict,
        description="EvaluationResult 中 failure_diagnosis 字段的 schema",
    )
    arbitration: ArbitrationMode = Field(
        default=ArbitrationMode.SINGLE_JUDGE,
        description="LLM-as-judge / 多角色辩论 / 程序化校验优先（架构 §9）",
    )
    review_targets: list[str] = Field(
        default_factory=lambda: ["primary_artifact"],
        description="审查对象的产物字段名",
    )

    @model_validator(mode="after")
    def _check_evaluation_invariants(self) -> Self:
        # NC_L2_EVAL_NO_CRITERIA — Pydantic min_length=1 已覆盖；这里再断言便于错误码反查
        if not self.criteria:
            raise PydanticCustomError(
                "NC_L2_EVAL_NO_CRITERIA",
                "evaluation contract 缺 criteria 或 criteria 为空",
            )

        # NC_L2_MISSING_PROMPT — evaluation 必须有 prompt
        if self.prompt is None:
            raise PydanticCustomError(
                "NC_L2_MISSING_PROMPT",
                "evaluation contract 必须提供 prompt",
            )

        # criterion_id 唯一性
        seen: set[str] = set()
        for c in self.criteria:
            if c.criterion_id in seen:
                raise ValueError(f"criterion_id 重复：{c.criterion_id}")
            seen.add(c.criterion_id)

        return self


__all__ = [
    "EvaluationContract",
    "EvaluationCriterion",
    "FailCondition",
    "PassCondition",
]
