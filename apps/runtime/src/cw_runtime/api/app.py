"""FastAPI app factory for the CW runtime sidecar.

FastAPI remains an optional runtime extra. This module imports it dynamically so
the base cw_runtime package can still be imported and typechecked without the
sidecar dependencies installed.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast
from urllib.parse import urlparse

from pydantic import BaseModel, ValidationError

from cw_runtime import __version__
from cw_runtime.harness import HarnessError, ProjectCreateRequest, initialize_project, read_project
from cw_runtime.settings import RUNTIME_SCHEMA_VERSION, RuntimeSettings

from .auth import AuthenticationError, validate_bearer_authorization
from .contracts import APIErrorCode, HealthStatus, RuntimeInfo, build_error_envelope

_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60


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
    requests = _load_module("starlette.requests")

    app: Any = fastapi.FastAPI(
        title="CognitiveWorkflow Runtime",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    json_response: Any = responses.JSONResponse
    project_locations: dict[str, Path] = {}
    idempotency_cache: dict[tuple[str, str], tuple[float, str, int, dict[str, object]]] = {}

    def secure_json_response(
        *,
        status_code: int,
        content: object,
        headers: dict[str, str] | None = None,
    ) -> Any:
        response = json_response(status_code=status_code, content=content, headers=headers)
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

    async def post_projects(request: Any) -> Any:
        try:
            body = await request.json()
        except ValueError:
            return secure_json_response(
                status_code=400,
                content=_dump_model(
                    build_error_envelope(
                        error_code=APIErrorCode.SCHEMA_VERSION_MISSING,
                        message="Request body must be valid JSON with schema_version.",
                    )
                ),
            )
        body_signature = _body_signature(body)
        idempotency_key = request.headers.get("idempotency-key")
        cache_key = (str(request.url.path), idempotency_key) if idempotency_key else None
        if cache_key is not None and cache_key in idempotency_cache:
            cached_at, cached_signature, cached_status, cached_content = idempotency_cache[cache_key]
            if time.monotonic() - cached_at > _IDEMPOTENCY_TTL_SECONDS:
                return secure_json_response(
                    status_code=409,
                    content=_dump_model(
                        build_error_envelope(
                            error_code=APIErrorCode.IDEMPOTENCY_KEY_REUSE_OUTSIDE_WINDOW,
                            message="Idempotency-Key was reused outside the 24h replay window.",
                        )
                    ),
                )
            if cached_signature != body_signature:
                return secure_json_response(
                    status_code=409,
                    content=_dump_model(
                        build_error_envelope(
                            error_code=APIErrorCode.IDEMPOTENCY_KEY_BODY_MISMATCH,
                            message="Idempotency-Key was reused with a different request body.",
                        )
                    ),
                )
            return secure_json_response(
                status_code=cached_status,
                content=cached_content,
                headers={"Idempotent-Replay": "true"},
            )

        try:
            create_request = ProjectCreateRequest.model_validate(body)
            create_response = initialize_project(create_request)
        except ValidationError as exc:
            return secure_json_response(status_code=400, content=_dump_model(_validation_error_envelope(exc)))
        except HarnessError as exc:
            return secure_json_response(
                status_code=exc.status_code,
                content=_dump_model(
                    build_error_envelope(
                        error_code=exc.error_code,
                        message=str(exc),
                        details=exc.details,
                    )
                ),
            )

        content = _dump_model(create_response)
        project_locations[create_response.project_id] = Path(create_response.host_path)
        if cache_key is not None:
            idempotency_cache[cache_key] = (time.monotonic(), body_signature, 201, content)
        return secure_json_response(status_code=201, content=content)

    def get_project(project_id: str) -> Any:
        project_root = project_locations.get(project_id)
        if project_root is None:
            return secure_json_response(
                status_code=404,
                content=_dump_model(
                    build_error_envelope(
                        error_code=APIErrorCode.RES_NOT_FOUND,
                        message="Project is not registered in this runtime process.",
                        details={"project_id": project_id},
                    )
                ),
            )
        try:
            project = read_project(project_root)
        except HarnessError as exc:
            return secure_json_response(
                status_code=exc.status_code,
                content=_dump_model(
                    build_error_envelope(
                        error_code=exc.error_code,
                        message=str(exc),
                        details=exc.details,
                    )
                ),
            )
        return _dump_model(project)

    post_projects.__annotations__["request"] = requests.Request

    app.middleware("http")(runtime_api_guard)
    app.get(f"{settings.api_prefix}/system/info")(get_system_info)
    app.get(f"{settings.api_prefix}/system/health")(get_system_health)
    app.get(f"{settings.api_prefix}/system/capabilities")(get_system_capabilities)
    app.post(f"{settings.api_prefix}/system/shutdown", status_code=202)(post_system_shutdown)
    app.post(f"{settings.api_prefix}/projects")(post_projects)
    app.get(f"{settings.api_prefix}/projects/{{project_id}}")(get_project)

    return cast(AsgiApp, app)


def _body_signature(body: object) -> str:
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _validation_error_envelope(exc: ValidationError) -> BaseModel:
    errors = exc.errors()
    schema_version_errors = [error for error in errors if tuple(error.get("loc", ())) == ("schema_version",)]
    if any(error.get("type") == "missing" for error in schema_version_errors):
        return build_error_envelope(
            error_code=APIErrorCode.SCHEMA_VERSION_MISSING,
            message="schema_version is required.",
            details={"errors": errors},
        )
    if schema_version_errors:
        return build_error_envelope(
            error_code=APIErrorCode.SCHEMA_VERSION_NOT_SUPPORTED,
            message="schema_version is not supported.",
            details={"errors": errors},
        )
    return build_error_envelope(
        error_code=APIErrorCode.SCHEMA_VERSION_NOT_SUPPORTED,
        message="Request body failed validation.",
        details={"errors": errors},
    )


__all__ = ["AsgiApp", "RuntimeDependencyError", "create_app"]
