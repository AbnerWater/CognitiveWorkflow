"""Runtime HTTP/SSE API foundation."""

from __future__ import annotations

from cw_runtime.harness import ProjectCreateRequest, ProjectCreateResponse, ProjectDocument

from .app import AsgiApp, RuntimeDependencyError, create_app
from .auth import AuthenticationError, validate_bearer_authorization
from .contracts import APIErrorCode, ErrorEnvelope, HealthStatus, RuntimeInfo

__all__ = [
    "APIErrorCode",
    "AsgiApp",
    "AuthenticationError",
    "ErrorEnvelope",
    "HealthStatus",
    "ProjectCreateRequest",
    "ProjectCreateResponse",
    "ProjectDocument",
    "RuntimeDependencyError",
    "RuntimeInfo",
    "create_app",
    "validate_bearer_authorization",
]
