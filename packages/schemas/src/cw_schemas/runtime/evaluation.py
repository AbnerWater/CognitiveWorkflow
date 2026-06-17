"""cw_schemas.runtime.evaluation — EvaluationResult + 子对象。

来源：specs/schemas/evaluation_result.md §1~§7
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..ids import LooseId
from ..metadata import MetadataDict
from ..types import (
    ArbitrationMode,
    CriterionKind,
    FailureType,
    RepairKind,
    Severity,
)
from .usage import RunUsage

EVALUATION_RESULT_SCHEMA_VERSION = "0.1.0"


# =============================================================================
# Finding & CriterionResult
# =============================================================================


class Finding(BaseModel):
    """单项发现（§2.2）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    finding_id: LooseId
    kind: Literal[
        "format_violation",
        "missing_field",
        "wrong_type",
        "unsupported_claim",
        "dangling_citation",
        "numeric_out_of_range",
        "regex_mismatch",
        "rubric_violation",
        "schema_violation",
    ]
    path: str | None = Field(default=None, description="JSONPath 指向被审产物中的具体位置")
    message: str = Field(..., min_length=1)
    severity: Severity = Field(default=Severity.MAJOR, description="该 finding 自身严重度（可低于 criterion.severity）")
    proposed_fix_hint: str | None = None
    related_evidence_ids: list[str] = Field(default_factory=list)


class CriterionResult(BaseModel):
    """单条审查规则的判定结果（§2.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    criterion_id: LooseId
    description: str = Field(..., min_length=1, description="复制自契约（便于审计快速阅读）")
    kind: CriterionKind
    severity: Severity
    weight: float = Field(..., ge=0.0, le=1.0)
    passed_for_this_criterion: bool
    score_for_this_criterion: float = Field(..., ge=0.0, le=1.0)
    evaluator_kind: Literal["llm_rubric", "programmatic_validator", "hybrid", "human"]
    evaluator_ref: str | None = Field(default=None, description="LLM judge profile_id 或 validator_id")
    findings: list[Finding] = Field(default_factory=list)
    evidence_used_ids: list[str] = Field(default_factory=list)
    tokens_estimate: int | None = Field(default=None, ge=0)
    latency_ms: int | None = Field(default=None, ge=0)


# =============================================================================
# FailureDiagnosis
# =============================================================================


class FailureDiagnosis(BaseModel):
    """失败诊断（§3）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    failure_type: FailureType
    failed_criteria: list[str] = Field(..., min_length=1, description="失败的 criterion_id（≥1）")
    severity: Severity
    summary: str = Field(..., min_length=1, max_length=2000)
    rationale: str | None = Field(default=None, max_length=4000)
    suggested_repair_targets: list[str] = Field(default_factory=list, description="JSONPath 列表")
    tags: list[str] = Field(default_factory=list)


# =============================================================================
# RecommendedAction
# =============================================================================


RecommendedActionKind = Literal[
    "pass_to_next",
    "repair_with_patch",
    "retry_same",
    "request_evidence",
    "human_checkpoint",
    "abort",
]


class RecommendedAction(BaseModel):
    """Engine 路由动作（§4）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    action: RecommendedActionKind
    target_repair_node_id: LooseId | None = Field(default=None, description="action=repair_with_patch 时必填")
    target_human_node_id: LooseId | None = Field(default=None, description="action=human_checkpoint 时必填")
    note_to_user: str | None = None

    @model_validator(mode="after")
    def _check_routing_targets(self) -> Self:
        if self.action == "repair_with_patch" and self.target_repair_node_id is None:
            raise PydanticCustomError(
                "ER_BUILD_DANGLING_REPAIR_TARGET",
                "action=repair_with_patch 时必须提供 target_repair_node_id",
            )
        if self.action == "human_checkpoint" and self.target_human_node_id is None:
            raise PydanticCustomError(
                "ER_BUILD_DANGLING_HUMAN_TARGET",
                "action=human_checkpoint 时必须提供 target_human_node_id",
            )
        return self


# =============================================================================
# ArbitrationOutcome & JudgeResult
# =============================================================================


class JudgeResult(BaseModel):
    """单个 judge 的独立判定（§5.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    judge_id: str = Field(..., min_length=1, description="claude-sonnet-judge / programmatic_v1 / 等")
    judge_kind: Literal["llm", "programmatic", "human"]
    passed: bool
    score: float = Field(..., ge=0.0, le=1.0)
    criterion_results: list[CriterionResult] = Field(default_factory=list)
    notes: str | None = None


class ArbitrationOutcome(BaseModel):
    """多 judge 仲裁过程记录（§5）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    mode: ArbitrationMode
    judge_count: int = Field(..., ge=1)
    judge_results: list[JudgeResult] = Field(..., min_length=1)
    aggregation: Literal["majority", "unanimous", "programmatic_overrides_llm", "weighted"]
    disagreement_score: float = Field(..., ge=0.0, le=1.0)
    final_decision_source: str = Field(..., min_length=1, description="决定 passed 的最终 judge / 规则标识")


# =============================================================================
# EvidenceFeedback
# =============================================================================


class EvidenceFeedback(BaseModel):
    """写回 EvidencePack 的反馈（§7）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    evidence_pack_id: LooseId
    unsupported_claim_estimates: int = Field(..., ge=0)
    dangling_citation_ids: list[str] = Field(default_factory=list)
    under_used_evidence_ids: list[str] = Field(default_factory=list)
    suggested_topics: list[str] = Field(default_factory=list)


# =============================================================================
# EvalProvenance
# =============================================================================


class EvalProvenance(BaseModel):
    """评价过程源信息（§6）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    eval_started_at: str = Field(..., description="ISO-8601")
    eval_finished_at: str = Field(..., description="ISO-8601")
    evaluator_model_profile_id: str = Field(..., min_length=1)
    programmatic_validators: list[str] = Field(default_factory=list, description="实际运行的程序化校验器 IDs")
    context_pack_id: LooseId
    evidence_pack_id: LooseId | None = None
    target_artifact_hash: str = Field(..., min_length=1, description="被审产物的稳定 hash")
    criteria_hash: str = Field(..., min_length=1)
    eval_hash: str = Field(..., min_length=1, description="EvaluationResult 整体（去时间戳）的稳定 hash")


# =============================================================================
# EvaluationResult
# =============================================================================


class EvaluationResult(BaseModel):
    """评价节点输出（§1）。

    强约束（D-ER-1）：写一次即不可变；多次评价由多次 attempt + ArbitrationOutcome 表达。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    eval_id: LooseId
    schema_version: Literal["0.1.0"] = Field(default="0.1.0")
    evaluator_node_id: LooseId
    target_node_id: LooseId
    target_attempt_id: LooseId
    evaluator_attempt_id: LooseId
    run_id: LooseId
    passed: bool
    score: float = Field(..., ge=0.0, le=1.0)
    criterion_results: list[CriterionResult] = Field(..., min_length=1)
    failure_diagnosis: FailureDiagnosis | None = Field(default=None, description="passed=false 时必填")
    recommended_strategy: RepairKind | None = Field(
        default=None, description="建议的修复策略；从 NodeContract.repair_strategies 中选择"
    )
    recommended_action: RecommendedAction
    arbitration: ArbitrationOutcome | None = None
    evidence_feedback: EvidenceFeedback | None = None
    usage: RunUsage | None = None
    provenance: EvalProvenance
    metadata: MetadataDict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_invariants(self) -> Self:
        # passed=false 必填 failure_diagnosis（§1.2）
        if not self.passed and self.failure_diagnosis is None:
            raise PydanticCustomError(
                "ER_BUILD_FAILURE_DIAGNOSIS_MISSING",
                "passed=false 时必须提供 failure_diagnosis",
            )

        # criterion_results 不允许 criterion_id 重复
        seen: set[str] = set()
        for c in self.criterion_results:
            if c.criterion_id in seen:
                raise PydanticCustomError(
                    "ER_BUILD_CRITERIA_MISMATCH",
                    f"criterion_id 重复：{c.criterion_id}",
                )
            seen.add(c.criterion_id)

        # blocker 一票否决（D-ER-3）
        any_blocker_failed = any(
            (c.severity == Severity.BLOCKER) and (not c.passed_for_this_criterion) for c in self.criterion_results
        )
        if any_blocker_failed and self.passed:
            raise ValueError("blocker criterion 失败但顶层 passed=true，违反 D-ER-3 一票否决")

        # disagreement_score ≥ 0.5 强制升级 human_checkpoint（D-ER-5）
        if (
            self.arbitration is not None
            and self.arbitration.disagreement_score >= 0.5
            and self.recommended_action.action != "human_checkpoint"
        ):
            raise ValueError("disagreement_score ≥ 0.5 必须 escalate 到 human_checkpoint（D-ER-5）")

        return self


__all__ = [
    "EVALUATION_RESULT_SCHEMA_VERSION",
    "ArbitrationOutcome",
    "CriterionResult",
    "EvalProvenance",
    "EvaluationResult",
    "EvidenceFeedback",
    "FailureDiagnosis",
    "Finding",
    "JudgeResult",
    "RecommendedAction",
    "RecommendedActionKind",
]
