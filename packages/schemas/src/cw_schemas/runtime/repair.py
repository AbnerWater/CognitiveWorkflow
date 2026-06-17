"""cw_schemas.runtime.repair — RepairPatch + 6 类 Operation discriminated union.

来源：specs/schemas/repair_patch.md §1~§7
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..contract import ContextRequirement
from ..ids import LooseId
from ..metadata import MetadataDict
from ..types import FailureType, PatchScope, Priority, RepairKind, ReversalMode, RiskLevel
from .usage import RunUsage

REPAIR_PATCH_SCHEMA_VERSION = "0.1.0"


# =============================================================================
# Operation Union — 6 类 patch_kind 各自的 op 集合
# =============================================================================

# ---- 1) prompt_patch ops ----


class _OpBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AppendToSystemPromptOp(_OpBase):
    op: Literal["append_to_system_prompt"] = "append_to_system_prompt"
    text: str = Field(..., min_length=1)


class AppendToInstructionsOp(_OpBase):
    op: Literal["append_to_instructions"] = "append_to_instructions"
    text: str = Field(..., min_length=1)


class AppendToUserPromptTemplateOp(_OpBase):
    op: Literal["append_to_user_prompt_template"] = "append_to_user_prompt_template"
    text: str = Field(..., min_length=1)


class AddFewShotExampleOp(_OpBase):
    op: Literal["add_few_shot_example"] = "add_few_shot_example"
    example_input: dict[str, Any]
    example_output: dict[str, Any]
    rationale: str = Field(..., min_length=1)


class AddOutputFormatHintOp(_OpBase):
    op: Literal["add_output_format_hint"] = "add_output_format_hint"
    kind: Literal["schema_only", "schema_with_example", "few_shot"]
    examples: list[dict[str, Any]] = Field(default_factory=list)
    style_notes: str | None = None


class TightenConstraintOp(_OpBase):
    op: Literal["tighten_constraint"] = "tighten_constraint"
    constraint_text: str = Field(..., min_length=1)


# ---- 2) context_patch ops ----


class AddContextRequirementOp(_OpBase):
    op: Literal["add_context_requirement"] = "add_context_requirement"
    requirement: ContextRequirement


class RemoveContextRequirementOp(_OpBase):
    op: Literal["remove_context_requirement"] = "remove_context_requirement"
    requirement_key: str = Field(..., min_length=1)


class UpdateContextRequirementOp(_OpBase):
    op: Literal["update_context_requirement"] = "update_context_requirement"
    requirement_key: str = Field(..., min_length=1)
    patch: dict[str, Any]


class BumpPriorityOp(_OpBase):
    op: Literal["bump_priority"] = "bump_priority"
    fragment_kind: str | None = None
    from_: Priority = Field(..., alias="from")
    to: Priority


class SummarizeLongFragmentsOp(_OpBase):
    op: Literal["summarize_long_fragments"] = "summarize_long_fragments"
    above_tokens: int = Field(..., ge=1)
    target_tokens: int = Field(..., ge=1)


class PinUpstreamArtifactOp(_OpBase):
    op: Literal["pin_upstream_artifact"] = "pin_upstream_artifact"
    from_node_id: LooseId
    artifact_field: str = Field(..., min_length=1)
    as_key: str = Field(..., min_length=1)


# ---- 3) evidence_patch ops ----


class AddTopicCoverageOp(_OpBase):
    op: Literal["add_topic_coverage"] = "add_topic_coverage"
    topic: str = Field(..., min_length=1)
    min_evidences: int | None = Field(default=None, ge=1)


class ReplaceEvidenceSetOp(_OpBase):
    op: Literal["replace_evidence_set"] = "replace_evidence_set"
    criterion_id: LooseId
    min_count: int = Field(..., ge=1)


class TightenRelevanceThresholdOp(_OpBase):
    op: Literal["tighten_relevance_threshold"] = "tighten_relevance_threshold"
    min_relevance: float = Field(..., ge=0.0, le=1.0)


class TightenConfidenceThresholdOp(_OpBase):
    op: Literal["tighten_confidence_threshold"] = "tighten_confidence_threshold"
    min_confidence: float = Field(..., ge=0.0, le=1.0)


class MarkConflictResolvedOp(_OpBase):
    op: Literal["mark_conflict_resolved"] = "mark_conflict_resolved"
    conflict_id: LooseId
    resolution_note: str = Field(..., min_length=1)


class InjectEvidenceLookupToolOp(_OpBase):
    op: Literal["inject_evidence_lookup_tool"] = "inject_evidence_lookup_tool"


# ---- 4) model_escalation ops ----


class SwitchToModelProfileOp(_OpBase):
    op: Literal["switch_to_model_profile"] = "switch_to_model_profile"
    model_profile_id: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=1)


class BumpTemperatureOp(_OpBase):
    op: Literal["bump_temperature"] = "bump_temperature"
    delta: float
    min: float | None = None
    max: float | None = None


class EnableThinkingOp(_OpBase):
    op: Literal["enable_thinking"] = "enable_thinking"
    level: Literal["low", "medium", "high"]


class ExtendMaxOutputTokensOp(_OpBase):
    op: Literal["extend_max_output_tokens"] = "extend_max_output_tokens"
    value: int = Field(..., ge=1)


# ---- 5) workflow_patch ops（Phase 1 仅 Engine 内部使用；D-NC-4）----


class InsertNodeOp(_OpBase):
    op: Literal["insert_node"] = "insert_node"
    node: dict[str, Any]  # WorkflowNode dict；M1.3 由 Engine 反序列化为强类型
    after_node_id: LooseId


class RemoveNodeOp(_OpBase):
    op: Literal["remove_node"] = "remove_node"
    node_id: LooseId


class UpdateNodeOp(_OpBase):
    op: Literal["update_node"] = "update_node"
    node_id: LooseId
    changes: dict[str, Any]


class InsertEdgeOp(_OpBase):
    op: Literal["insert_edge"] = "insert_edge"
    edge: dict[str, Any]


class RemoveEdgeOp(_OpBase):
    op: Literal["remove_edge"] = "remove_edge"
    edge_id: LooseId


class RelaxReviewRuleOp(_OpBase):
    op: Literal["relax_review_rule"] = "relax_review_rule"
    evaluation_node_id: LooseId
    criterion_id: LooseId
    new_severity: Literal["blocker", "major", "minor", "info"]


class SplitNodeOp(_OpBase):
    op: Literal["split_node"] = "split_node"
    node_id: LooseId
    split_into: list[dict[str, Any]] = Field(..., min_length=2)


# ---- 6) human_checkpoint ops（Phase 1 仅 Engine 内部使用；D-NC-4）----


class RequestUserDecisionOp(_OpBase):
    op: Literal["request_user_decision"] = "request_user_decision"
    prompt_to_user: str = Field(..., min_length=1)
    decisions: list[dict[str, Any]] = Field(..., min_length=1)
    default_decision: str | None = None


class RequestUserEditOp(_OpBase):
    op: Literal["request_user_edit"] = "request_user_edit"
    target_artifact_path: str = Field(..., min_length=1)
    edit_hint: str = Field(..., min_length=1)


class RequestUserInputOp(_OpBase):
    op: Literal["request_user_input"] = "request_user_input"
    input_schema: dict[str, Any]
    prompt_to_user: str = Field(..., min_length=1)


class RequestUserClarificationOp(_OpBase):
    op: Literal["request_user_clarification"] = "request_user_clarification"
    question: str = Field(..., min_length=1)
    candidate_answers: list[dict[str, Any]] = Field(default_factory=list)


# ---- discriminated union ----

Operation = Annotated[
    AppendToSystemPromptOp
    | AppendToInstructionsOp
    | AppendToUserPromptTemplateOp
    | AddFewShotExampleOp
    | AddOutputFormatHintOp
    | TightenConstraintOp
    | AddContextRequirementOp
    | RemoveContextRequirementOp
    | UpdateContextRequirementOp
    | BumpPriorityOp
    | SummarizeLongFragmentsOp
    | PinUpstreamArtifactOp
    | AddTopicCoverageOp
    | ReplaceEvidenceSetOp
    | TightenRelevanceThresholdOp
    | TightenConfidenceThresholdOp
    | MarkConflictResolvedOp
    | InjectEvidenceLookupToolOp
    | SwitchToModelProfileOp
    | BumpTemperatureOp
    | EnableThinkingOp
    | ExtendMaxOutputTokensOp
    | InsertNodeOp
    | RemoveNodeOp
    | UpdateNodeOp
    | InsertEdgeOp
    | RemoveEdgeOp
    | RelaxReviewRuleOp
    | SplitNodeOp
    | RequestUserDecisionOp
    | RequestUserEditOp
    | RequestUserInputOp
    | RequestUserClarificationOp,
    Field(discriminator="op"),
]
"""RepairPatch.operations 内的所有 op 类型（30+ 个）的判别式联合。"""


# ---- patch_kind → allowed op set 表 ----

_KIND_TO_OPS: dict[RepairKind, set[str]] = {
    RepairKind.PROMPT_PATCH: {
        "append_to_system_prompt",
        "append_to_instructions",
        "append_to_user_prompt_template",
        "add_few_shot_example",
        "add_output_format_hint",
        "tighten_constraint",
    },
    RepairKind.CONTEXT_PATCH: {
        "add_context_requirement",
        "remove_context_requirement",
        "update_context_requirement",
        "bump_priority",
        "summarize_long_fragments",
        "pin_upstream_artifact",
    },
    RepairKind.EVIDENCE_PATCH: {
        "add_topic_coverage",
        "replace_evidence_set",
        "tighten_relevance_threshold",
        "tighten_confidence_threshold",
        "mark_conflict_resolved",
        "inject_evidence_lookup_tool",
    },
    RepairKind.MODEL_ESCALATION: {
        "switch_to_model_profile",
        "bump_temperature",
        "enable_thinking",
        "extend_max_output_tokens",
    },
    RepairKind.WORKFLOW_PATCH: {
        "insert_node",
        "remove_node",
        "update_node",
        "insert_edge",
        "remove_edge",
        "relax_review_rule",
        "split_node",
    },
    RepairKind.HUMAN_CHECKPOINT: {
        "request_user_decision",
        "request_user_edit",
        "request_user_input",
        "request_user_clarification",
    },
}


# =============================================================================
# ReversalHint
# =============================================================================


class ReversalHint(BaseModel):
    """反向操作提示（§4）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    mode: ReversalMode
    inverse_operations: list[Operation] | None = Field(
        default=None, description="mode=explicit 时手动写出反向 Operation"
    )
    notes: str | None = None

    @model_validator(mode="after")
    def _check_explicit_has_inverse(self) -> Self:
        if self.mode == ReversalMode.EXPLICIT and not self.inverse_operations:
            raise ValueError("ReversalHint.mode=explicit 时必须提供 inverse_operations")
        return self


# =============================================================================
# RepairProvenance
# =============================================================================


class RepairProvenance(BaseModel):
    """修复过程源信息（§6）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    repair_started_at: str = Field(..., description="ISO-8601")
    repair_finished_at: str = Field(..., description="ISO-8601")
    repair_model_profile_id: str = Field(..., min_length=1)
    attempts_window_used: int = Field(..., ge=1)
    evaluation_id: LooseId = Field(..., description="与顶层 evaluation_id 一致（冗余便于检索）")
    usage: RunUsage | None = None
    patch_hash: str = Field(..., min_length=1, description="RepairPatch 整体（去时间戳）的稳定 hash")


# =============================================================================
# RepairPatch
# =============================================================================


class RepairPatch(BaseModel):
    """修复补丁（§1）。

    强约束（D-RP-1）：6 类 patch_kind 固定；Phase 1 RepairAgent 仅允许 4 类。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    patch_id: LooseId
    schema_version: Literal["0.1.0"] = Field(default="0.1.0")
    repair_node_id: LooseId
    repair_attempt_id: LooseId
    target_node_id: LooseId
    evaluation_id: LooseId
    run_id: LooseId

    patch_kind: RepairKind
    addresses_failure_types: list[FailureType] = Field(..., min_length=1)
    operations: list[Operation] = Field(..., json_schema_extra={"minItems": 1})
    expected_effect: str = Field(..., min_length=1, max_length=2000)
    rationale: str | None = Field(default=None, max_length=4000)
    applies_to_attempts: list[LooseId] = Field(default_factory=list)
    scope: PatchScope = Field(default=PatchScope.UNTIL_PASS)
    expires_at: str | None = Field(default=None, description="ISO-8601")
    risk_level: RiskLevel
    reversal_hint: ReversalHint | None = None
    provenance: RepairProvenance
    metadata: MetadataDict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_invariants(self) -> Self:
        # operations 必须非空
        if not self.operations:
            raise PydanticCustomError(
                "RP_BUILD_EMPTY_OPERATIONS",
                "operations 为空",
            )

        # ops 必须属于 patch_kind 允许集合（D-RP-2）
        allowed = _KIND_TO_OPS[self.patch_kind]
        for op in self.operations:
            op_name = op.op  # discriminator
            if op_name not in allowed:
                raise PydanticCustomError(
                    "RP_BUILD_BAD_OPERATION_SCHEMA",
                    f"patch_kind={self.patch_kind.value} 不允许 op={op_name}；允许的 ops={sorted(allowed)}",
                )

        # D-RP-4: risk_level=high 时 scope 不允许 persistent_for_workflow
        if self.risk_level == RiskLevel.HIGH and self.scope == PatchScope.PERSISTENT_FOR_WORKFLOW:
            raise PydanticCustomError(
                "RP_BUILD_RISK_HIGH_PERSISTENT_FORBIDDEN",
                "risk_level=high 时不允许 scope=persistent_for_workflow（D-RP-4）",
            )

        # model_escalation 不允许 scope=this_attempt_only
        if self.patch_kind == RepairKind.MODEL_ESCALATION and self.scope == PatchScope.THIS_ATTEMPT_ONLY:
            raise ValueError("model_escalation 不允许 scope=this_attempt_only（升级后必须至少 until_pass）")

        # workflow_patch 必须 reversal_hint.mode=explicit
        if self.patch_kind == RepairKind.WORKFLOW_PATCH:
            if self.reversal_hint is None or self.reversal_hint.mode != ReversalMode.EXPLICIT:
                raise PydanticCustomError(
                    "RP_BUILD_REVERSAL_NEEDED",
                    "workflow_patch 必须显式提供 reversal_hint.mode=explicit",
                )

        return self


__all__ = [
    "REPAIR_PATCH_SCHEMA_VERSION",
    "AddContextRequirementOp",
    "AddFewShotExampleOp",
    "AddOutputFormatHintOp",
    "AddTopicCoverageOp",
    "AppendToInstructionsOp",
    "AppendToSystemPromptOp",
    "AppendToUserPromptTemplateOp",
    "BumpPriorityOp",
    "BumpTemperatureOp",
    "EnableThinkingOp",
    "ExtendMaxOutputTokensOp",
    "InjectEvidenceLookupToolOp",
    "InsertEdgeOp",
    "InsertNodeOp",
    "MarkConflictResolvedOp",
    "Operation",
    "PinUpstreamArtifactOp",
    "RelaxReviewRuleOp",
    "RemoveContextRequirementOp",
    "RemoveEdgeOp",
    "RemoveNodeOp",
    "RepairPatch",
    "RepairProvenance",
    "ReplaceEvidenceSetOp",
    "RequestUserClarificationOp",
    "RequestUserDecisionOp",
    "RequestUserEditOp",
    "RequestUserInputOp",
    "ReversalHint",
    "SplitNodeOp",
    "SummarizeLongFragmentsOp",
    "SwitchToModelProfileOp",
    "TightenConfidenceThresholdOp",
    "TightenConstraintOp",
    "TightenRelevanceThresholdOp",
    "UpdateContextRequirementOp",
    "UpdateNodeOp",
]
