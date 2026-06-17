"""AgentAdapter protocol foundation.

This module mirrors ``specs/protocols/agent_adapter.md`` without importing any
LLM SDK. Concrete adapters keep SDK-specific code behind their own module
boundaries and return CW schema objects at the edge.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Mapping
from typing import Any, Literal, Protocol, TypeAlias

from pydantic import BaseModel, ConfigDict, Field

from cw_runtime.model_router.router import AdapterCapabilities
from cw_schemas import ExecutionPack
from cw_schemas.events import StreamEventBase
from cw_schemas.metadata import MetadataDict
from cw_schemas.runtime import AdapterError, ArtifactRef, AttemptOutcome
from cw_schemas.types import AdapterErrorKind, AttemptState, CancelReason, FailureType, ResumptionKind

AgentAdapterErrorCode: TypeAlias = Literal[
    "AA_PREPARE_INVALID_PACK",
    "AA_PREPARE_INCOMPATIBLE_ADAPTER",
    "AA_PREPARE_PROVIDER_FORBIDDEN",
    "AA_RUN_STREAM_INTERRUPTED",
    "AA_RUN_TOOL_NOT_FOUND",
    "AA_RUN_OUTPUT_VALIDATION_FAILED",
    "AA_RUN_RETRY_LIMIT",
    "AA_RUN_USAGE_LIMIT",
    "AA_RUN_CANCELLED",
    "AA_RUN_INTERNAL",
    "AA_RESUME_INVALID_KIND",
    "AA_FINALIZE_NO_RESULT",
]


_ERROR_KIND_BY_CODE: Mapping[AgentAdapterErrorCode, AdapterErrorKind] = {
    "AA_PREPARE_INVALID_PACK": AdapterErrorKind.INVALID_PACK,
    "AA_PREPARE_INCOMPATIBLE_ADAPTER": AdapterErrorKind.PREPARE_FAILED,
    "AA_PREPARE_PROVIDER_FORBIDDEN": AdapterErrorKind.PROVIDER_FORBIDDEN,
    "AA_RUN_STREAM_INTERRUPTED": AdapterErrorKind.MODEL_REQUEST_FAILED,
    "AA_RUN_TOOL_NOT_FOUND": AdapterErrorKind.TOOL_FAILED,
    "AA_RUN_OUTPUT_VALIDATION_FAILED": AdapterErrorKind.OUTPUT_VALIDATION,
    "AA_RUN_RETRY_LIMIT": AdapterErrorKind.RETRY_LIMIT_REACHED,
    "AA_RUN_USAGE_LIMIT": AdapterErrorKind.USAGE_LIMIT_EXCEEDED,
    "AA_RUN_CANCELLED": AdapterErrorKind.CANCELLED,
    "AA_RUN_INTERNAL": AdapterErrorKind.ADAPTER_INTERNAL,
    "AA_RESUME_INVALID_KIND": AdapterErrorKind.INVALID_PACK,
    "AA_FINALIZE_NO_RESULT": AdapterErrorKind.ADAPTER_INTERNAL,
}

_FAILURE_TYPE_BY_CODE: Mapping[AgentAdapterErrorCode, FailureType] = {
    "AA_PREPARE_INVALID_PACK": FailureType.FORMAT_ERROR,
    "AA_PREPARE_INCOMPATIBLE_ADAPTER": FailureType.MODEL_CAPABILITY_LIMIT,
    "AA_PREPARE_PROVIDER_FORBIDDEN": FailureType.MODEL_CAPABILITY_LIMIT,
    "AA_RUN_STREAM_INTERRUPTED": FailureType.TOOL_ERROR,
    "AA_RUN_TOOL_NOT_FOUND": FailureType.TOOL_ERROR,
    "AA_RUN_OUTPUT_VALIDATION_FAILED": FailureType.FORMAT_ERROR,
    "AA_RUN_RETRY_LIMIT": FailureType.MODEL_CAPABILITY_LIMIT,
    "AA_RUN_USAGE_LIMIT": FailureType.MODEL_CAPABILITY_LIMIT,
    "AA_RUN_CANCELLED": FailureType.UNKNOWN,
    "AA_RUN_INTERNAL": FailureType.UNKNOWN,
    "AA_RESUME_INVALID_KIND": FailureType.FORMAT_ERROR,
    "AA_FINALIZE_NO_RESULT": FailureType.MISSING_OUTPUT,
}


class HumanDecisionResolution(BaseModel):
    """Human decision payload used by ``AttemptResumption``."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    key: str = Field(..., min_length=1)
    custom_value: str | None = None
    by: str = Field(..., min_length=1)
    decided_at: str = Field(..., min_length=1)


class AttemptResumption(BaseModel):
    """HITL / deferred tool / user edit continuation payload."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    kind: ResumptionKind
    deferred_tool_results: list[dict[str, Any]] | None = None
    human_decision: HumanDecisionResolution | None = None
    edited_artifacts: list[ArtifactRef] | None = None
    metadata: MetadataDict = Field(default_factory=dict)


class AttemptHandle(BaseModel):
    """Opaque Adapter handle with public observability fields."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    handle_id: str = Field(..., min_length=1)
    attempt_id: str = Field(..., min_length=1)
    run_id: str = Field(..., min_length=1)
    node_id: str = Field(..., min_length=1)
    adapter_id: str = Field(..., min_length=1)
    state: AttemptState = AttemptState.PREPARED
    stream_started: bool = False
    cancellation_requested: bool = False
    prepared_at: str = Field(..., min_length=1)
    started_at: str | None = None
    finished_at: str | None = None
    metadata: MetadataDict = Field(default_factory=dict)


class AdapterConfig(BaseModel):
    """Run-scoped adapter configuration."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    adapter_id: str = Field(..., min_length=1)
    settings: dict[str, Any] = Field(default_factory=dict)


class AdapterDescriptor(BaseModel):
    """Descriptor exposed to ModelRouter and UI configuration surfaces."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    adapter_id: str = Field(..., min_length=1)
    adapter_version: str = Field(..., min_length=1)
    display_name: str = Field(..., min_length=1)
    description: str = ""
    documentation_url: str | None = None
    capabilities: AdapterCapabilities
    default_config: AdapterConfig
    auth_required: bool = False
    homepage: str | None = None


class AdapterRuntimeError(RuntimeError):
    """Spec-coded adapter failure that hides SDK-specific exceptions."""

    def __init__(
        self,
        error_code: AgentAdapterErrorCode,
        message: str,
        *,
        retryable: bool = False,
        http_status: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.adapter_error = build_adapter_error(
            error_code,
            message,
            retryable=retryable,
            http_status=http_status,
            payload=payload,
        )


def build_adapter_error(
    error_code: AgentAdapterErrorCode,
    message: str,
    *,
    retryable: bool,
    http_status: int | None = None,
    payload: dict[str, Any] | None = None,
) -> AdapterError:
    """Build a schema-level ``AdapterError`` for a spec ``AA_*`` code."""

    return AdapterError(
        error_kind=_ERROR_KIND_BY_CODE[error_code],
        failure_type=_FAILURE_TYPE_BY_CODE[error_code],
        message=message,
        retryable=retryable,
        http_status=http_status,
        payload={"error_code": error_code} if payload is None else {"error_code": error_code, **payload},
    )


class AgentAdapter(Protocol):
    """CW's only invocation contract for external agent backends."""

    @property
    def adapter_id(self) -> str: ...

    @property
    def adapter_version(self) -> str: ...

    def capabilities(self) -> AdapterCapabilities: ...

    async def prepare(self, execution_pack: ExecutionPack) -> AttemptHandle: ...

    def run(self, handle: AttemptHandle) -> AsyncIterator[StreamEventBase]: ...

    def resume(self, handle: AttemptHandle, resumption: AttemptResumption) -> AsyncIterator[StreamEventBase]: ...

    async def cancel(self, handle: AttemptHandle, reason: CancelReason = CancelReason.USER) -> None: ...

    async def finalize(self, handle: AttemptHandle) -> AttemptOutcome: ...

    async def aclose(self) -> None: ...


class AdapterFactory(Protocol):
    """Factory contract used by Engine at Run startup."""

    def create(self, adapter_id: str, config: AdapterConfig) -> AgentAdapter: ...

    def list_available(self) -> list[AdapterDescriptor]: ...


AdapterBuilder: TypeAlias = Callable[[AdapterConfig], AgentAdapter]


class AdapterRegistry:
    """Explicit adapter registry; entry point loading can layer on top later."""

    def __init__(self) -> None:
        self._builders: dict[str, AdapterBuilder] = {}
        self._descriptors: dict[str, AdapterDescriptor] = {}

    def register(self, descriptor: AdapterDescriptor, builder: AdapterBuilder) -> None:
        self._descriptors[descriptor.adapter_id] = descriptor
        self._builders[descriptor.adapter_id] = builder

    def create(self, adapter_id: str, config: AdapterConfig) -> AgentAdapter:
        builder = self._builders.get(adapter_id)
        if builder is None:
            raise AdapterRuntimeError(
                "AA_PREPARE_INCOMPATIBLE_ADAPTER",
                f"Adapter {adapter_id!r} is not registered.",
                payload={"adapter_id": adapter_id},
            )
        return builder(config)

    def list_available(self) -> list[AdapterDescriptor]:
        return [self._descriptors[key] for key in sorted(self._descriptors)]


__all__ = [
    "AdapterConfig",
    "AdapterDescriptor",
    "AdapterFactory",
    "AdapterRegistry",
    "AdapterRuntimeError",
    "AgentAdapter",
    "AgentAdapterErrorCode",
    "AttemptHandle",
    "AttemptResumption",
    "HumanDecisionResolution",
    "build_adapter_error",
]
