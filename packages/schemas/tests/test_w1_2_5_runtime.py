"""契约测试：cw_schemas.runtime — EvaluationResult / RepairPatch / NodeAttempt。

覆盖 specs/schemas/evaluation_result.md §11 + repair_patch.md §11 关键错误码：
- ER_BUILD_FAILURE_DIAGNOSIS_MISSING
- ER_BUILD_DUP_CRITERION_ID
- ER_BUILD_BLOCKER_VIOLATION
- ER_BUILD_DISAGREEMENT_MUST_ESCALATE
- ER_BUILD_DANGLING_REPAIR_TARGET
- ER_BUILD_DANGLING_HUMAN_TARGET
- RP_BUILD_BAD_OPERATION_SCHEMA
- RP_BUILD_RISK_HIGH_PERSISTENT_FORBIDDEN
- RP_BUILD_MODEL_ESCALATION_SCOPE_FORBIDDEN
- RP_BUILD_REVERSAL_NEEDED
- RP_BUILD_REVERSAL_EXPLICIT_REQUIRES_INVERSE
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from cw_schemas import (
    AdapterError,
    ArbitrationOutcome,
    ArtifactRef,
    AttemptOutcome,
    AttemptProvenance,
    CriterionResult,
    EvalProvenance,
    EvaluationResult,
    EvidenceFeedback,
    FailureDiagnosis,
    Finding,
    JudgeResult,
    NodeAttempt,
    RecommendedAction,
    RepairPatch,
    RepairProvenance,
    ReversalHint,
    RunUsage,
)
from cw_schemas.runtime.repair import (
    AppendToSystemPromptOp,
    InsertNodeOp,
    SwitchToModelProfileOp,
    TightenConstraintOp,
)
from cw_schemas.types import (
    AdapterErrorKind,
    ArbitrationMode,
    AttemptState,
    CriterionKind,
    FailureType,
    PatchScope,
    RepairKind,
    ReversalMode,
    RiskLevel,
    Severity,
)


def _assert_validation_error_contains(exc: ValidationError, code: str) -> None:
    found = any(err.get("type") == code or code in str(err) for err in exc.errors())
    assert found, f"未检测到错误码 {code}；实际错误：{exc.errors()!r}"


# =============================================================================
# 公共 builders
# =============================================================================


def _criterion_result(
    *,
    cid: str = "c_quality",
    passed: bool = True,
    severity: Severity = Severity.MAJOR,
    score: float = 1.0,
) -> CriterionResult:
    return CriterionResult(
        criterion_id=cid,
        description="质量要求",
        kind=CriterionKind.RUBRIC,
        severity=severity,
        weight=1.0,
        passed_for_this_criterion=passed,
        score_for_this_criterion=score,
        evaluator_kind="llm_rubric",
        evaluator_ref="claude-sonnet-judge",
    )


def _eval_provenance() -> EvalProvenance:
    return EvalProvenance(
        eval_started_at="2026-06-15T08:35:11Z",
        eval_finished_at="2026-06-15T08:35:18Z",
        evaluator_model_profile_id="claude-sonnet-judge",
        context_pack_id="ctxp_x",
        target_artifact_hash="ahash_4b1c",
        criteria_hash="chash_91a2",
        eval_hash="ehash_7d80",
    )


def _repair_provenance() -> RepairProvenance:
    return RepairProvenance(
        repair_started_at="2026-06-15T08:36:01Z",
        repair_finished_at="2026-06-15T08:36:05Z",
        repair_model_profile_id="claude-sonnet-repair",
        attempts_window_used=1,
        evaluation_id="evr_01",
        patch_hash="phash_rp_01",
    )


# =============================================================================
# EvaluationResult happy paths
# =============================================================================


def test_evaluation_result_passed() -> None:
    er = EvaluationResult(
        eval_id="evr_pass_01",
        evaluator_node_id="n_review",
        target_node_id="n_extract",
        target_attempt_id="att_target_01",
        evaluator_attempt_id="att_eval_01",
        run_id="run_01",
        passed=True,
        score=0.95,
        criterion_results=[_criterion_result(cid="c_quality", passed=True)],
        recommended_action=RecommendedAction(action="pass_to_next"),
        provenance=_eval_provenance(),
    )
    assert er.passed
    assert er.failure_diagnosis is None


def test_evaluation_result_failed_with_diagnosis() -> None:
    er = EvaluationResult(
        eval_id="evr_fail_01",
        evaluator_node_id="n_review",
        target_node_id="n_extract",
        target_attempt_id="att_target_01",
        evaluator_attempt_id="att_eval_01",
        run_id="run_01",
        passed=False,
        score=0.4,
        criterion_results=[
            _criterion_result(cid="c_logic", passed=False, severity=Severity.MAJOR, score=0.5),
        ],
        failure_diagnosis=FailureDiagnosis(
            failure_type=FailureType.LOGIC_GAP,
            failed_criteria=["c_logic"],
            severity=Severity.MAJOR,
            summary="问题过于宽泛",
        ),
        recommended_strategy=RepairKind.PROMPT_PATCH,
        recommended_action=RecommendedAction(
            action="repair_with_patch",
            target_repair_node_id="n_repair",
        ),
        provenance=_eval_provenance(),
    )
    assert not er.passed
    assert er.failure_diagnosis is not None
    assert er.failure_diagnosis.failure_type == FailureType.LOGIC_GAP


def test_er_build_failure_diagnosis_missing() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvaluationResult(
            eval_id="evr_no_diag",
            evaluator_node_id="n_review",
            target_node_id="n_extract",
            target_attempt_id="att_t",
            evaluator_attempt_id="att_e",
            run_id="run_01",
            passed=False,
            score=0.3,
            criterion_results=[_criterion_result(cid="c_x", passed=False)],
            recommended_action=RecommendedAction(action="repair_with_patch", target_repair_node_id="n_repair"),
            provenance=_eval_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "ER_BUILD_FAILURE_DIAGNOSIS_MISSING")


def test_er_build_dup_criterion_id() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvaluationResult(
            eval_id="evr_dup",
            evaluator_node_id="n_review",
            target_node_id="n_extract",
            target_attempt_id="att_t",
            evaluator_attempt_id="att_e",
            run_id="run_01",
            passed=True,
            score=0.95,
            criterion_results=[
                _criterion_result(cid="c_dup", passed=True),
                _criterion_result(cid="c_dup", passed=True),
            ],
            recommended_action=RecommendedAction(action="pass_to_next"),
            provenance=_eval_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "ER_BUILD_DUP_CRITERION_ID")


def test_er_build_blocker_violation() -> None:
    """blocker criterion 失败但 passed=true → ER_BUILD_BLOCKER_VIOLATION（D-ER-3）。"""
    with pytest.raises(ValidationError) as exc_info:
        EvaluationResult(
            eval_id="evr_blocker",
            evaluator_node_id="n_review",
            target_node_id="n_extract",
            target_attempt_id="att_t",
            evaluator_attempt_id="att_e",
            run_id="run_01",
            passed=True,  # 但 blocker 失败
            score=0.9,
            criterion_results=[
                _criterion_result(cid="c_blocker", passed=False, severity=Severity.BLOCKER, score=0.0),
            ],
            recommended_action=RecommendedAction(action="pass_to_next"),
            provenance=_eval_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "ER_BUILD_BLOCKER_VIOLATION")


def test_er_build_disagreement_must_escalate() -> None:
    """disagreement_score ≥ 0.5 → 强制 human_checkpoint（D-ER-5）。"""
    with pytest.raises(ValidationError) as exc_info:
        EvaluationResult(
            eval_id="evr_dis",
            evaluator_node_id="n_review",
            target_node_id="n_extract",
            target_attempt_id="att_t",
            evaluator_attempt_id="att_e",
            run_id="run_01",
            passed=True,
            score=0.7,
            criterion_results=[_criterion_result(cid="c_x", passed=True)],
            arbitration=ArbitrationOutcome(
                mode=ArbitrationMode.MULTI_JUDGE,
                judge_count=2,
                judge_results=[
                    JudgeResult(judge_id="j1", judge_kind="llm", passed=True, score=0.9),
                    JudgeResult(judge_id="j2", judge_kind="llm", passed=False, score=0.3),
                ],
                aggregation="majority",
                disagreement_score=0.7,
                final_decision_source="j1",
            ),
            recommended_action=RecommendedAction(action="pass_to_next"),  # 应当是 human_checkpoint
            provenance=_eval_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "ER_BUILD_DISAGREEMENT_MUST_ESCALATE")


def test_er_build_dangling_repair_target() -> None:
    with pytest.raises(ValidationError) as exc_info:
        RecommendedAction(action="repair_with_patch")  # 缺 target_repair_node_id
    _assert_validation_error_contains(exc_info.value, "ER_BUILD_DANGLING_REPAIR_TARGET")


def test_er_build_dangling_human_target() -> None:
    with pytest.raises(ValidationError) as exc_info:
        RecommendedAction(action="human_checkpoint")
    _assert_validation_error_contains(exc_info.value, "ER_BUILD_DANGLING_HUMAN_TARGET")


# =============================================================================
# RepairPatch happy paths
# =============================================================================


def test_repair_patch_prompt_patch_minimal() -> None:
    rp = RepairPatch(
        patch_id="rp_pp_01",
        repair_node_id="n_repair",
        repair_attempt_id="att_repair_01",
        target_node_id="n_extract",
        evaluation_id="evr_01",
        run_id="run_01",
        patch_kind=RepairKind.PROMPT_PATCH,
        addresses_failure_types=[FailureType.LOGIC_GAP],
        operations=[TightenConstraintOp(constraint_text="必须含地理 + 时间 + 指标")],
        expected_effect="下次 attempt logic_gap 应通过",
        risk_level=RiskLevel.LOW,
        provenance=_repair_provenance(),
    )
    assert rp.patch_kind == RepairKind.PROMPT_PATCH
    assert len(rp.operations) == 1


def test_rp_build_bad_operation_schema() -> None:
    """patch_kind=prompt_patch 不允许 model_escalation 类 op。"""
    with pytest.raises(ValidationError) as exc_info:
        RepairPatch(
            patch_id="rp_bad_op",
            repair_node_id="n_repair",
            repair_attempt_id="att_r",
            target_node_id="n_extract",
            evaluation_id="evr_01",
            run_id="run_01",
            patch_kind=RepairKind.PROMPT_PATCH,
            addresses_failure_types=[FailureType.LOGIC_GAP],
            operations=[
                SwitchToModelProfileOp(model_profile_id="claude-opus", reason="x"),
            ],
            expected_effect="x",
            risk_level=RiskLevel.LOW,
            provenance=_repair_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "RP_BUILD_BAD_OPERATION_SCHEMA")


def test_rp_build_risk_high_persistent_forbidden() -> None:
    with pytest.raises(ValidationError) as exc_info:
        RepairPatch(
            patch_id="rp_risk",
            repair_node_id="n_repair",
            repair_attempt_id="att_r",
            target_node_id="n_extract",
            evaluation_id="evr_01",
            run_id="run_01",
            patch_kind=RepairKind.PROMPT_PATCH,
            addresses_failure_types=[FailureType.LOGIC_GAP],
            operations=[AppendToSystemPromptOp(text="x")],
            expected_effect="x",
            scope=PatchScope.PERSISTENT_FOR_WORKFLOW,  # ❌
            risk_level=RiskLevel.HIGH,  # ❌
            provenance=_repair_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "RP_BUILD_RISK_HIGH_PERSISTENT_FORBIDDEN")


def test_rp_build_model_escalation_scope_forbidden() -> None:
    with pytest.raises(ValidationError) as exc_info:
        RepairPatch(
            patch_id="rp_esc_scope",
            repair_node_id="n_repair",
            repair_attempt_id="att_r",
            target_node_id="n_extract",
            evaluation_id="evr_01",
            run_id="run_01",
            patch_kind=RepairKind.MODEL_ESCALATION,
            addresses_failure_types=[FailureType.MODEL_CAPABILITY_LIMIT],
            operations=[SwitchToModelProfileOp(model_profile_id="claude-opus", reason="x")],
            expected_effect="x",
            scope=PatchScope.THIS_ATTEMPT_ONLY,  # ❌
            risk_level=RiskLevel.MEDIUM,
            provenance=_repair_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "RP_BUILD_MODEL_ESCALATION_SCOPE_FORBIDDEN")


def test_rp_build_workflow_patch_reversal_needed() -> None:
    """workflow_patch 必须有 reversal_hint.mode=explicit。"""
    with pytest.raises(ValidationError) as exc_info:
        RepairPatch(
            patch_id="rp_wf",
            repair_node_id="n_repair",
            repair_attempt_id="att_r",
            target_node_id="n_extract",
            evaluation_id="evr_01",
            run_id="run_01",
            patch_kind=RepairKind.WORKFLOW_PATCH,
            addresses_failure_types=[FailureType.LOGIC_GAP],
            operations=[
                InsertNodeOp(
                    node={"node_id": "n_new", "type": "execution_task", "title": "新节点"},
                    after_node_id="n_extract",
                )
            ],
            expected_effect="x",
            risk_level=RiskLevel.MEDIUM,
            provenance=_repair_provenance(),
            # 缺 reversal_hint
        )
    _assert_validation_error_contains(exc_info.value, "RP_BUILD_REVERSAL_NEEDED")


def test_reversal_hint_explicit_requires_inverse() -> None:
    with pytest.raises(ValidationError) as exc_info:
        ReversalHint(mode=ReversalMode.EXPLICIT)  # 缺 inverse_operations
    _assert_validation_error_contains(exc_info.value, "RP_BUILD_REVERSAL_EXPLICIT_REQUIRES_INVERSE")


def test_repair_patch_round_trip_json() -> None:
    rp = RepairPatch(
        patch_id="rp_rt",
        repair_node_id="n_repair",
        repair_attempt_id="att_r",
        target_node_id="n_extract",
        evaluation_id="evr_01",
        run_id="run_01",
        patch_kind=RepairKind.PROMPT_PATCH,
        addresses_failure_types=[FailureType.FORMAT_ERROR],
        operations=[AppendToSystemPromptOp(text="提示")],
        expected_effect="x",
        risk_level=RiskLevel.LOW,
        provenance=_repair_provenance(),
    )
    raw = rp.model_dump_json()
    restored = RepairPatch.model_validate_json(raw)
    assert restored == rp


# =============================================================================
# NodeAttempt / AttemptOutcome
# =============================================================================


def test_node_attempt_minimal() -> None:
    a = NodeAttempt(
        attempt_id="att_01",
        run_id="run_01",
        node_id="n_extract",
        attempt_index=0,
        state=AttemptState.RUNNING,
        started_at="2026-06-15T08:30:00Z",
        adapter_id="pydantic_ai",
        adapter_version="0.1.0",
        model_profile_id="claude-sonnet-default",
        context_pack_id="ctxp_01",
        execution_pack_id="exp_01",
    )
    assert a.state == AttemptState.RUNNING


def test_attempt_outcome_completed() -> None:
    out = AttemptOutcome(
        attempt_id="att_01",
        run_id="run_01",
        node_id="n_extract",
        state=AttemptState.COMPLETED,
        output={"research_questions": []},
        output_hash="ohash_x",
        usage=RunUsage(input_tokens=100, output_tokens=50, total_tokens=150),
        started_at="2026-06-15T08:30:00Z",
        finished_at="2026-06-15T08:30:05Z",
        duration_ms=5000,
        provenance=AttemptProvenance(
            adapter_id="pydantic_ai",
            adapter_version="0.1.0",
            model_profile_id="claude-sonnet-default",
            model_settings_hash="mhash_x",
            context_pack_id="ctxp_01",
            outcome_hash="ohash_x",
        ),
    )
    assert out.state == AttemptState.COMPLETED


def test_adapter_error() -> None:
    err = AdapterError(
        error_kind=AdapterErrorKind.MODEL_REQUEST_FAILED,
        failure_type=FailureType.TOOL_ERROR,
        message="HTTP 500 from upstream",
        retryable=True,
        http_status=500,
    )
    assert err.failure_type == FailureType.TOOL_ERROR


def test_artifact_ref() -> None:
    ar = ArtifactRef(
        artifact_id="art_01",
        kind="file",
        display_name="report.md",
        mime_type="text/markdown",
        size_bytes=2048,
    )
    assert ar.kind == "file"


# =============================================================================
# EvidenceFeedback
# =============================================================================


def test_evidence_feedback_minimal() -> None:
    fb = EvidenceFeedback(
        evidence_pack_id="evp_01",
        unsupported_claim_estimates=2,
        dangling_citation_ids=["ev_missing"],
        suggested_topics=["policy_environment"],
    )
    assert fb.unsupported_claim_estimates == 2


# =============================================================================
# Finding
# =============================================================================


def test_finding_minimal() -> None:
    f = Finding(
        finding_id="f_001",
        kind="rubric_violation",
        message="问题过于宽泛",
        severity=Severity.BLOCKER,
        path="$.research_questions[2].question",
    )
    assert f.severity == Severity.BLOCKER
