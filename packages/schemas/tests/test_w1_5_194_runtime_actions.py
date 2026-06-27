"""W1.5.194 contract tests for runtime instruction and artifact actions."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from cw_schemas import (
    ArtifactActionRequest,
    ArtifactActionResult,
    RuntimeInstructionAccepted,
    RuntimeInstructionRequest,
)
from cw_schemas.types import (
    ArtifactAction,
    ArtifactActionStatus,
    ArtifactDestinationKind,
    RuntimeInstructionIntent,
    RuntimeInstructionScope,
    Sensitivity,
)


def test_runtime_instruction_request_accepts_spec_fields() -> None:
    request = RuntimeInstructionRequest(
        scope=RuntimeInstructionScope.RUN,
        instruction="Summarize the current workflow state.",
        intent=RuntimeInstructionIntent.ASK,
        correlation_id="corr_runtime_instruction_01",
        client_command_id="cmd_chat_01",
        metadata={"cw": {"source": "desktop_chat_box"}},
    )

    assert request.schema_version == "0.1.0"
    assert request.scope == RuntimeInstructionScope.RUN
    assert request.intent == RuntimeInstructionIntent.ASK


def test_runtime_instruction_request_rejects_empty_or_extra_fields() -> None:
    with pytest.raises(ValidationError):
        RuntimeInstructionRequest(
            scope=RuntimeInstructionScope.NODE,
            instruction="",
            intent=RuntimeInstructionIntent.REPAIR,
        )

    with pytest.raises(ValidationError):
        RuntimeInstructionRequest.model_validate(
            {
                "scope": "run",
                "instruction": "Revise this node.",
                "intent": "revise",
                "raw_prompt_copy": "must not be accepted",
            }
        )


def test_runtime_instruction_accepted_records_metadata_only_response() -> None:
    accepted = RuntimeInstructionAccepted(
        command_id="ric_01",
        run_id="run_01",
        node_id="n_review",
        scope=RuntimeInstructionScope.NODE,
        intent=RuntimeInstructionIntent.REPAIR,
        accepted_at="2026-06-27T08:00:00Z",
        stream_url="/cw/v1/runs/run_01/stream",
    )

    assert accepted.status == "accepted"
    assert accepted.node_id == "n_review"


def test_artifact_action_request_accepts_metadata_only_handoff() -> None:
    request = ArtifactActionRequest(
        artifact_id="art_report_md",
        action=ArtifactAction.OPEN,
        run_id="run_01",
        node_id="n_export",
        intent=RuntimeInstructionIntent.ASK,
        requested_destination_kind=ArtifactDestinationKind.PROJECT_TEMP,
        artifact_sensitivity=Sensitivity.PROJECT,
    )

    assert request.action == ArtifactAction.OPEN
    assert request.requested_destination_kind == ArtifactDestinationKind.PROJECT_TEMP


def test_artifact_action_request_requires_explicit_sensitive_export() -> None:
    with pytest.raises(ValidationError):
        ArtifactActionRequest(
            artifact_id="art_sensitive",
            action=ArtifactAction.DOWNLOAD,
            requested_destination_kind=ArtifactDestinationKind.USER_SELECTED,
            artifact_sensitivity=Sensitivity.SENSITIVE,
        )

    request = ArtifactActionRequest(
        artifact_id="art_sensitive",
        action=ArtifactAction.DOWNLOAD,
        requested_destination_kind=ArtifactDestinationKind.USER_SELECTED,
        artifact_sensitivity=Sensitivity.SENSITIVE,
        allow_sensitive_export=True,
    )
    assert request.allow_sensitive_export


def test_artifact_action_result_forbids_raw_destination_path() -> None:
    result = ArtifactActionResult(
        artifact_id="art_report_md",
        action=ArtifactAction.DOWNLOAD,
        status=ArtifactActionStatus.SUCCEEDED,
        content_type="text/markdown",
        byte_count=2048,
        content_hash="sha256:abc",
        destination_kind=ArtifactDestinationKind.USER_SELECTED,
    )
    assert result.destination_kind == ArtifactDestinationKind.USER_SELECTED

    with pytest.raises(ValidationError):
        ArtifactActionResult.model_validate(
            {
                "artifact_id": "art_report_md",
                "action": "download",
                "status": "succeeded",
                "destination_kind": "user_selected",
                "absolute_path": "D:/Users/admin/report.md",
            }
        )
