"""Pydantic contracts for the runtime API surface."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from cw_runtime.settings import API_PREFIX, LOCALHOST_BIND_HOST, RUNTIME_SCHEMA_VERSION
from cw_schemas.types import FailureType


class APIErrorCode(StrEnum):
    """API-layer error codes locked in specs/api/http_sse.md."""

    AUTH_FORBIDDEN = "AUTH_FORBIDDEN"
    RES_NOT_FOUND = "RES_NOT_FOUND"
    RES_ALREADY_EXISTS = "RES_ALREADY_EXISTS"
    RES_GONE = "RES_GONE"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    IDEMPOTENCY_KEY_BODY_MISMATCH = "IDEMPOTENCY_KEY_BODY_MISMATCH"
    IDEMPOTENCY_KEY_REUSE_OUTSIDE_WINDOW = "IDEMPOTENCY_KEY_REUSE_OUTSIDE_WINDOW"
    BAD_PROJECT_ID = "BAD_PROJECT_ID"
    SHUTDOWN_IN_PROGRESS = "SHUTDOWN_IN_PROGRESS"
    MULTIPART_TOO_LARGE = "MULTIPART_TOO_LARGE"
    BAD_RANGE = "BAD_RANGE"
    SCHEMA_VERSION_MISSING = "SCHEMA_VERSION_MISSING"
    SCHEMA_VERSION_NOT_SUPPORTED = "SCHEMA_VERSION_NOT_SUPPORTED"


class ErrorEnvelope(BaseModel):
    """Unified error response from specs/api/http_sse.md §1.5."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"] = RUNTIME_SCHEMA_VERSION
    error_code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    details: dict[str, object] = Field(default_factory=dict)
    cw_failure_type: FailureType | None = None
    retry_after_ms: int | None = Field(default=None, ge=0)
    trace_id: str | None = None


class RuntimeInfo(BaseModel):
    """Minimal RuntimeInfo returned by GET /cw/v1/system/info."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"] = RUNTIME_SCHEMA_VERSION
    runtime_name: Literal["cw-runtime"] = "cw-runtime"
    runtime_version: str = Field(min_length=1)
    api_prefix: Literal["/cw/v1"] = API_PREFIX
    bind_host: Literal["127.0.0.1"] = LOCALHOST_BIND_HOST


class HealthStatus(BaseModel):
    """Minimal HealthStatus returned by GET /cw/v1/system/health."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"] = RUNTIME_SCHEMA_VERSION
    status: Literal["ok", "shutting_down"] = "ok"
    checks: dict[str, str] = Field(default_factory=dict)


def build_error_envelope(
    *,
    error_code: APIErrorCode | str,
    message: str,
    details: dict[str, object] | None = None,
    cw_failure_type: FailureType | None = None,
    retry_after_ms: int | None = None,
    trace_id: str | None = None,
) -> ErrorEnvelope:
    return ErrorEnvelope(
        error_code=str(error_code),
        message=message,
        details={} if details is None else details,
        cw_failure_type=cw_failure_type,
        retry_after_ms=retry_after_ms,
        trace_id=trace_id,
    )


__all__ = [
    "APIErrorCode",
    "ErrorEnvelope",
    "HealthStatus",
    "RuntimeInfo",
    "build_error_envelope",
]
