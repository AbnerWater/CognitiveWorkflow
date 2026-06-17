"""契约测试：cw_schemas.events — StreamEvent envelope 12 类。

覆盖 specs/schemas/stream_event.md §11 中可在 schema 层判断的关键错误码：
- SE_BUILD_BAD_TYPE
- SE_BUILD_PAYLOAD_TOO_LARGE
- SE_BUILD_BINARY_IN_PAYLOAD
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from cw_schemas import (
    ArtifactEvent,
    ArtifactRef,
    ContextEvent,
    ErrorEvent,
    EvaluationEvent,
    HumanEvent,
    LifecycleEvent,
    MetricEvent,
    ModelEvent,
    PlanningEvent,
    RepairEvent,
    SystemEvent,
    ToolEvent,
    validate_stream_event,
)
from cw_schemas.types import (
    AdapterErrorKind,
    DisplayLevel,
    EventCategory,
    EventPhase,
    FailureType,
    PlanningStatus,
    Sensitivity,
    StreamSeverity,
)


def _assert_validation_error_contains(exc: ValidationError, code: str) -> None:
    found = any(err.get("type") == code or code in str(err) for err in exc.errors())
    assert found, f"未检测到错误码 {code}；实际错误：{exc.errors()!r}"


def _common(**override: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "event_id": "evt_01",
        "seq": 0,
        "run_id": "run_01",
        "category": "system",
        "type": "system.heartbeat",
        "title": "事件",
        "expandable": False,
        "created_at": "2026-06-15T08:30:00.123Z",
    }
    base.update(override)
    return base


# =============================================================================
# 12 类 envelope happy path
# =============================================================================


def test_lifecycle_event_minimal() -> None:
    event = LifecycleEvent.model_validate(
        _common(
            category="lifecycle",
            type="run.started",
            phase=EventPhase.RUN_STARTED.value,
            title="Run started",
        )
    )
    assert event.category == EventCategory.LIFECYCLE
    assert event.type == "run.started"
    assert event.phase == EventPhase.RUN_STARTED


def test_model_event_minimal() -> None:
    event = ModelEvent.model_validate(
        _common(category="model", type="model.text_delta", title="AI 回复", model_profile_id="claude-sonnet-default")
    )
    assert event.category == EventCategory.MODEL
    assert event.type == "model.text_delta"


def test_tool_event_minimal() -> None:
    event = ToolEvent.model_validate(
        _common(
            category="tool",
            type="tool.call_started",
            title="调用工具",
            tool_id="python_sandbox",
            invocation_id="inv_01",
        )
    )
    assert event.category == EventCategory.TOOL
    assert event.type == "tool.call_started"


def test_evaluation_event_minimal() -> None:
    event = EvaluationEvent.model_validate(
        _common(category="evaluation", type="evaluation.completed", title="评价完成", eval_id="evr_01")
    )
    assert event.category == EventCategory.EVALUATION
    assert event.type == "evaluation.completed"


def test_repair_event_minimal() -> None:
    event = RepairEvent.model_validate(
        _common(category="repair", type="repair.patch_applied", title="已应用修复补丁", patch_id="rp_01")
    )
    assert event.category == EventCategory.REPAIR
    assert event.type == "repair.patch_applied"


def test_human_event_minimal() -> None:
    event = HumanEvent.model_validate(
        _common(
            category="human",
            type="human.gate_resolved",
            title="人工决策完成",
            human_node_id="n_human",
            decision_key="continue",
        )
    )
    assert event.category == EventCategory.HUMAN
    assert event.type == "human.gate_resolved"


def test_context_event_minimal() -> None:
    event = ContextEvent.model_validate(
        _common(
            category="context", type="context.build_completed", title="ContextPack built", context_pack_id="ctxp_01"
        )
    )
    assert event.category == EventCategory.CONTEXT
    assert event.type == "context.build_completed"


def test_planning_event_minimal() -> None:
    event = PlanningEvent.model_validate(
        _common(
            category="planning",
            type="planning.phase_changed",
            title="规划阶段切换",
            from_status=PlanningStatus.PLANNING.value,
            to_status=PlanningStatus.VALIDATING.value,
        )
    )
    assert event.category == EventCategory.PLANNING
    assert event.type == "planning.phase_changed"


def test_artifact_event_minimal() -> None:
    event = ArtifactEvent.model_validate(
        _common(
            category="artifact",
            type="artifact.written",
            title="产物写入",
            artifact_id="art_01",
            artifact_refs=[
                ArtifactRef(
                    artifact_id="art_01",
                    kind="file",
                    display_name="report.md",
                    mime_type="text/markdown",
                ).model_dump()
            ],
        )
    )
    assert event.category == EventCategory.ARTIFACT
    assert len(event.artifact_refs) == 1


def test_metric_event_minimal() -> None:
    event = MetricEvent.model_validate(
        _common(category="metric", type="metric.snapshot", title="Metric snapshot", metrics={"queue_depth": 3.0})
    )
    assert event.metrics["queue_depth"] == 3.0


def test_error_event_minimal() -> None:
    event = ErrorEvent.model_validate(
        _common(
            category="error",
            type="error.network",
            title="网络错误",
            error_kind=AdapterErrorKind.MODEL_REQUEST_FAILED.value,
            failure_type=FailureType.TOOL_ERROR.value,
            message="HTTP 500 from upstream",
            retryable=True,
            severity=StreamSeverity.ERROR.value,
        )
    )
    assert event.failure_type == FailureType.TOOL_ERROR


def test_system_event_minimal() -> None:
    event = SystemEvent.model_validate(_common(type="system.heartbeat", title="Heartbeat"))
    assert event.category == EventCategory.SYSTEM


# =============================================================================
# Discriminated union via validate_stream_event
# =============================================================================


def test_validate_stream_event_via_dict_dispatches_correctly() -> None:
    parsed = validate_stream_event(
        _common(
            event_id="evt_dispatch",
            seq=1,
            category="lifecycle",
            type="run.started",
            title="Run started",
        )
    )
    assert isinstance(parsed, LifecycleEvent)
    assert parsed.type == "run.started"


def test_validate_stream_event_unknown_category_fails() -> None:
    with pytest.raises(ValidationError):
        validate_stream_event(_common(category="not_a_category", type="system.heartbeat"))


def test_validate_stream_event_type_must_match_category() -> None:
    with pytest.raises(ValidationError) as exc_info:
        validate_stream_event(_common(category="lifecycle", type="model.text_delta"))
    _assert_validation_error_contains(exc_info.value, "SE_BUILD_BAD_TYPE")


# =============================================================================
# SE_BUILD_* 错误码
# =============================================================================


def test_se_build_payload_too_large() -> None:
    with pytest.raises(ValidationError) as exc_info:
        validate_stream_event(_common(payload={"text": "x" * (64 * 1024 + 1)}))
    _assert_validation_error_contains(exc_info.value, "SE_BUILD_PAYLOAD_TOO_LARGE")


def test_se_build_binary_in_payload() -> None:
    with pytest.raises(ValidationError) as exc_info:
        validate_stream_event(_common(payload={"blob": b"raw-bytes"}))
    _assert_validation_error_contains(exc_info.value, "SE_BUILD_BINARY_IN_PAYLOAD")


def test_bad_schema_version_uses_pydantic_validation_error() -> None:
    with pytest.raises(ValidationError):
        validate_stream_event(_common(schema_version="9.9.9"))


def test_sensitive_with_detailed_display_level_is_schema_valid() -> None:
    parsed = validate_stream_event(
        _common(
            category="model",
            type="model.text_delta",
            title="AI 回复",
            sensitivity=Sensitivity.SENSITIVE.value,
            display_level=DisplayLevel.DETAILED.value,
        )
    )
    assert parsed.sensitivity == Sensitivity.SENSITIVE
    assert parsed.display_level == DisplayLevel.DETAILED


# =============================================================================
# Round trip / extra=forbid
# =============================================================================


def test_stream_event_round_trip_json() -> None:
    event = LifecycleEvent.model_validate(_common(category="lifecycle", type="run.completed", title="Run completed"))
    raw = event.model_dump_json()
    restored = LifecycleEvent.model_validate_json(raw)
    assert restored == event


def test_extra_forbid_on_envelope() -> None:
    with pytest.raises(ValidationError):
        SystemEvent.model_validate({**_common(), "unknown_field": "forbid"})
