"""Runtime HTTP/SSE API foundation."""

from __future__ import annotations

from .app import AsgiApp, RuntimeDependencyError, create_app
from .auth import AuthenticationError, validate_bearer_authorization
from .contracts import APIErrorCode, ErrorEnvelope, HealthStatus, RuntimeInfo

__all__ = [
    "APIErrorCode",
    "AsgiApp",
    "AuthenticationError",
    "ErrorEnvelope",
    "HealthStatus",
    "RuntimeDependencyError",
    "RuntimeInfo",
    "create_app",
    "validate_bearer_authorization",
]
