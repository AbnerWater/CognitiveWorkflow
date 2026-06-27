"""cw_schemas.runtime.actions — Runtime instruction and artifact handoff contracts.

来源：specs/schemas/runtime_actions.md；ADR-0011。
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..ids import LooseId
from ..metadata import MetadataDict
from ..types import (
    ArtifactAction,
    ArtifactActionStatus,
    ArtifactDestinationKind,
    RuntimeInstructionIntent,
    RuntimeInstructionScope,
    Sensitivity,
)

RUNTIME_ACTION_SCHEMA_VERSION: Literal["0.1.0"] = "0.1.0"


class RuntimeInstructionRequest(BaseModel):
    """Runtime-visible Chat instruction command request.

    Raw instruction text is allowed only in this authenticated runtime request
    and runtime-owned execution records; renderer snapshots and evidence must
    store metadata only.
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    schema_version: Literal["0.1.0"] = Field(default=RUNTIME_ACTION_SCHEMA_VERSION)
    scope: RuntimeInstructionScope
    instruction: str = Field(..., min_length=1, max_length=20000)
    intent: RuntimeInstructionIntent
    correlation_id: str | None = Field(default=None, min_length=1, max_length=128)
    client_command_id: str | None = Field(default=None, min_length=1, max_length=128)
    metadata: MetadataDict = Field(default_factory=dict)


class RuntimeInstructionAccepted(BaseModel):
    """Accepted response for a runtime instruction command."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    schema_version: Literal["0.1.0"] = Field(default=RUNTIME_ACTION_SCHEMA_VERSION)
    command_id: LooseId
    status: Literal["accepted"] = "accepted"
    run_id: LooseId
    node_id: LooseId | None = None
    scope: RuntimeInstructionScope
    intent: RuntimeInstructionIntent
    accepted_at: str = Field(..., min_length=1, description="ISO-8601")
    stream_url: str | None = Field(default=None, min_length=1)
    correlation_id: str | None = Field(default=None, min_length=1, max_length=128)


class ArtifactActionRequest(BaseModel):
    """Renderer-to-Desktop artifact action request.

    The request names the artifact and action only. Artifact bytes are fetched
    through the runtime content endpoint by the privileged Desktop boundary.
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    schema_version: Literal["0.1.0"] = Field(default=RUNTIME_ACTION_SCHEMA_VERSION)
    artifact_id: LooseId
    action: ArtifactAction
    run_id: LooseId | None = None
    node_id: LooseId | None = None
    intent: RuntimeInstructionIntent | None = None
    requested_destination_kind: ArtifactDestinationKind | None = None
    artifact_sensitivity: Sensitivity | None = None
    allow_sensitive_export: bool = False
    correlation_id: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def _check_sensitive_download_boundary(self) -> Self:
        if (
            self.action == ArtifactAction.DOWNLOAD
            and self.artifact_sensitivity == Sensitivity.SENSITIVE
            and self.requested_destination_kind == ArtifactDestinationKind.USER_SELECTED
            and not self.allow_sensitive_export
        ):
            raise ValueError("sensitive artifact export to user_selected destination requires explicit user action")
        return self


class ArtifactActionResult(BaseModel):
    """Observable artifact action result with sanitized destination metadata."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    schema_version: Literal["0.1.0"] = Field(default=RUNTIME_ACTION_SCHEMA_VERSION)
    artifact_id: LooseId
    action: ArtifactAction
    status: ArtifactActionStatus
    content_type: str | None = Field(default=None, min_length=1)
    byte_count: int | None = Field(default=None, ge=0)
    content_hash: str | None = Field(default=None, min_length=1)
    destination_kind: ArtifactDestinationKind
    sensitive: bool = False
    error_code: str | None = Field(default=None, min_length=1)
    correlation_id: str | None = Field(default=None, min_length=1, max_length=128)


__all__ = [
    "RUNTIME_ACTION_SCHEMA_VERSION",
    "ArtifactActionRequest",
    "ArtifactActionResult",
    "RuntimeInstructionAccepted",
    "RuntimeInstructionRequest",
]
