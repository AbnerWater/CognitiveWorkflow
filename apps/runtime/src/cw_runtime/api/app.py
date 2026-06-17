"""FastAPI app factory for the CW runtime sidecar.

FastAPI remains an optional runtime extra. This module imports it dynamically so
the base cw_runtime package can still be imported and typechecked without the
sidecar dependencies installed.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from importlib import import_module
from typing import Any, Protocol, cast
from urllib.parse import urlparse

from pydantic import BaseModel

from cw_runtime import __version__
from cw_runtime.settings import RUNTIME_SCHEMA_VERSION, RuntimeSettings

from .auth import AuthenticationError, validate_bearer_authorization
from .contracts import APIErrorCode, HealthStatus, RuntimeInfo, build_error_envelope


class RuntimeDependencyError(RuntimeError):
    """Raised when runtime extras required for serving HTTP are missing."""


class AsgiApp(Protocol):
    """Minimal ASGI callable protocol used by FastAPI and Starlette."""

    def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[[], Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> Awaitable[None]: ...


def _load_module(module_name: str) -> Any:
    try:
        return import_module(module_name)
    except ModuleNotFoundError as exc:
        if exc.name == module_name:
            raise RuntimeDependencyError(
                "Install the cw_runtime runtime extra before serving the sidecar API."
            ) from exc
        raise


def _dump_model(model: BaseModel) -> dict[str, object]:
    return cast(dict[str, object], model.model_dump(mode="json"))


def _is_allowed_origin(origin: str | None) -> bool:
    if origin is None or origin == "":
        return True
    if origin.startswith("app://"):
        return True
    parsed = urlparse(origin)
    return parsed.scheme == "http" and parsed.hostname == "127.0.0.1" and parsed.port is not None


def create_app(settings: RuntimeSettings) -> AsgiApp:
    fastapi = _load_module("fastapi")
    responses = _load_module("starlette.responses")

    app: Any = fastapi.FastAPI(
        title="CognitiveWorkflow Runtime",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    json_response: Any = responses.JSONResponse

    def secure_json_response(*, status_code: int, content: object) -> Any:
        response = json_response(status_code=status_code, content=content)
        _apply_security_headers(response)
        return response

    def _apply_security_headers(response: Any) -> None:
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = "default-src 'none'"
        response.headers["X-Content-Type-Options"] = "nosniff"

    async def runtime_api_guard(request: Any, call_next: Callable[[Any], Awaitable[Any]]) -> Any:
        if str(request.url.path).startswith(settings.api_prefix):
            if not _is_allowed_origin(request.headers.get("origin")):
                envelope = build_error_envelope(
                    error_code=APIErrorCode.AUTH_FORBIDDEN,
                    message="Origin is not allowed for the local runtime API.",
                )
                return secure_json_response(
                    status_code=401,
                    content=_dump_model(envelope),
                )
            try:
                validate_bearer_authorization(
                    request.headers.get("authorization"),
                    expected_token=settings.auth_token,
                )
            except AuthenticationError as exc:
                return secure_json_response(
                    status_code=401,
                    content=_dump_model(exc.envelope),
                )
        response = await call_next(request)
        _apply_security_headers(response)
        return response

    def get_system_info() -> dict[str, object]:
        return _dump_model(RuntimeInfo(runtime_version=__version__))

    def get_system_health() -> dict[str, object]:
        return _dump_model(HealthStatus(checks={"api": "ok"}))

    def get_system_capabilities() -> list[dict[str, object]]:
        return []

    def post_system_shutdown() -> dict[str, object]:
        return {"schema_version": RUNTIME_SCHEMA_VERSION, "accepted": True}

    app.middleware("http")(runtime_api_guard)
    app.get(f"{settings.api_prefix}/system/info")(get_system_info)
    app.get(f"{settings.api_prefix}/system/health")(get_system_health)
    app.get(f"{settings.api_prefix}/system/capabilities")(get_system_capabilities)
    app.post(f"{settings.api_prefix}/system/shutdown", status_code=202)(post_system_shutdown)

    return cast(AsgiApp, app)


__all__ = ["AsgiApp", "RuntimeDependencyError", "create_app"]
