"""FastAPI app factory for the CW runtime sidecar.

FastAPI remains an optional runtime extra. This module imports it dynamically so
the base cw_runtime package can still be imported and typechecked without the
sidecar dependencies installed.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from importlib import import_module
from pathlib import Path
from typing import Any, Literal, Protocol, cast
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from cw_runtime import __version__
from cw_runtime.adapters import (
    AdapterConfig,
    AdapterRegistry,
    ClaudeCodeAdapter,
    PydanticAIAdapter,
    build_claude_code_descriptor,
    build_pydantic_ai_descriptor,
)
from cw_runtime.engine import WorkflowValidationError, load_workflow_graph
from cw_runtime.harness import (
    HarnessError,
    ProjectCreateRequest,
    ProjectReferenceImportMetadata,
    ProjectReferencePatchRequest,
    import_project_reference,
    initialize_project,
    read_project,
    read_project_references,
    update_project_reference_enabled,
    windows_cng_decrypt_aes_gcm,
    windows_credential_manager_master_key_provider,
)
from cw_runtime.runner import (
    HumanDecisionRequest,
    NodeAdvanceRequest,
    RepairAdvanceInput,
    advance_workflow_run_with_adapters,
    resolve_human_decision,
)
from cw_runtime.runs import (
    RunActionRequest,
    RunError,
    WorkflowRunDocument,
    WorkflowRunStartRequest,
    cancel_active_workflow_run,
    cancel_workflow_run,
    create_workflow_run,
    list_stream_events,
    parse_display_levels,
    parse_event_categories,
    pause_active_workflow_run,
    read_workflow_run,
    resume_active_workflow_run,
    stream_sse_events,
)
from cw_runtime.settings import RUNTIME_SCHEMA_VERSION, RuntimeSettings
from cw_schemas import RepairPatch
from cw_schemas.types import PatchScope, RepairKind
from cw_schemas.workflow import EvaluationTaskNode, RepairTaskNode

from .auth import AuthenticationError, validate_bearer_authorization
from .contracts import APIErrorCode, HealthStatus, RuntimeInfo, build_error_envelope

_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60
_REFERENCE_UPLOAD_MAX_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True)
class _MultipartPart:
    filename: str | None
    content: bytes


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


class RunNodeRepairRequest(BaseModel):
    """Request body for POST /cw/v1/runs/{run_id}/nodes/{node_id}:repair."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"]
    based_on_evaluation_id: str = Field(..., min_length=1)
    preferred_strategy: RepairKind = RepairKind.PROMPT_PATCH
    scope: PatchScope = PatchScope.UNTIL_PASS


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


def _default_adapter_registry() -> AdapterRegistry:
    registry = AdapterRegistry()
    registry.register(
        build_pydantic_ai_descriptor(), lambda config: PydanticAIAdapter(config=_pydantic_ai_config(config))
    )
    registry.register(build_claude_code_descriptor(), lambda config: ClaudeCodeAdapter(config=config))
    return registry


def _pydantic_ai_config(config: AdapterConfig) -> AdapterConfig:
    settings = {
        "project_mcp_secret_master_key_provider": windows_credential_manager_master_key_provider,
        "project_mcp_secret_aead_decryptor": windows_cng_decrypt_aes_gcm,
        **config.settings,
    }
    return config.model_copy(update={"settings": settings})


def create_app(settings: RuntimeSettings, *, adapter_registry: AdapterRegistry | None = None) -> AsgiApp:
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
    streaming_response: Any = responses.StreamingResponse
    adapters = _default_adapter_registry() if adapter_registry is None else adapter_registry
    project_locations: dict[str, Path] = {}
    run_locations: dict[str, Path] = {}
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
        return [_dump_model(descriptor.capabilities) for descriptor in adapters.list_available()]

    def post_system_shutdown() -> dict[str, object]:
        return {"schema_version": RUNTIME_SCHEMA_VERSION, "accepted": True}

    def idempotency_replay_response(request: Any, body: object) -> Any | None:
        cache_key = _idempotency_cache_key(request)
        if cache_key is None:
            return None
        body_signature = _body_signature(body)
        cached = idempotency_cache.get(cache_key)
        if cached is None:
            return None
        cached_at, cached_signature, cached_status, cached_content = cached
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

    def remember_idempotency_response(
        request: Any,
        body: object,
        *,
        status_code: int,
        content: dict[str, object],
    ) -> None:
        cache_key = _idempotency_cache_key(request)
        if cache_key is None:
            return
        idempotency_cache[cache_key] = (time.monotonic(), _body_signature(body), status_code, content)

    async def read_json_body(request: Any) -> object:
        try:
            return await request.json()
        except ValueError as exc:
            raise ValueError("Request body must be valid JSON with schema_version.") from exc

    async def post_projects(request: Any) -> Any:
        try:
            body = await read_json_body(request)
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
        replay = idempotency_replay_response(request, body)
        if replay is not None:
            return replay

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
        remember_idempotency_response(request, body, status_code=201, content=content)
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

    def get_project_skills(project_id: str) -> Any:
        return _read_project_config(project_id, "skills.config.json")

    def get_project_mcps(project_id: str) -> Any:
        return _read_project_config(project_id, "mcp.config.json")

    def get_project_adapters(project_id: str) -> Any:
        return _read_project_config(project_id, "adapters.config.json")

    def get_project_references(project_id: str) -> Any:
        project_root = project_locations.get(project_id)
        if project_root is None:
            return _resource_not_found(
                "Project is not registered in this runtime process.",
                {"project_id": project_id},
            )
        try:
            manifest = read_project_references(project_root)
        except HarnessError as exc:
            return _harness_error_response(exc)
        return _dump_model(manifest)

    async def post_project_reference(project_id: str, request: Any) -> Any:
        project_root = project_locations.get(project_id)
        if project_root is None:
            return _resource_not_found(
                "Project is not registered in this runtime process.",
                {"project_id": project_id},
            )
        body = await request.body()
        if len(body) > _REFERENCE_UPLOAD_MAX_BYTES * 2:
            return secure_json_response(
                status_code=413,
                content=_dump_model(
                    build_error_envelope(
                        error_code=APIErrorCode.MULTIPART_TOO_LARGE,
                        message="Reference upload exceeded multipart size limit.",
                        details={"max_bytes": _REFERENCE_UPLOAD_MAX_BYTES},
                    )
                ),
            )
        parts = _parse_multipart_form(request.headers.get("content-type"), body)
        metadata_part = parts.get("metadata")
        file_part = parts.get("file")
        metadata_text = _multipart_part_text(metadata_part)
        file_name = _multipart_file_name(file_part)
        file_content = _multipart_file_bytes(file_part)
        if metadata_text is None or file_name is None or file_content is None:
            return secure_json_response(
                status_code=400,
                content=_dump_model(
                    build_error_envelope(
                        error_code=APIErrorCode.SCHEMA_VERSION_MISSING,
                        message="Reference upload requires metadata and file parts.",
                    )
                ),
            )
        if len(file_content) > _REFERENCE_UPLOAD_MAX_BYTES:
            return secure_json_response(
                status_code=413,
                content=_dump_model(
                    build_error_envelope(
                        error_code=APIErrorCode.MULTIPART_TOO_LARGE,
                        message="Reference upload exceeded multipart size limit.",
                        details={"max_bytes": _REFERENCE_UPLOAD_MAX_BYTES},
                    )
                ),
            )
        try:
            metadata_body = json.loads(metadata_text)
            metadata = ProjectReferenceImportMetadata.model_validate(metadata_body)
            entry = import_project_reference(
                project_root,
                metadata=metadata,
                filename=file_name,
                content=file_content,
            )
        except (json.JSONDecodeError, ValidationError) as exc:
            envelope = (
                build_error_envelope(
                    error_code=APIErrorCode.SCHEMA_VERSION_MISSING,
                    message="Reference metadata must be valid JSON with schema_version.",
                )
                if isinstance(exc, json.JSONDecodeError)
                else _validation_error_envelope(exc)
            )
            return secure_json_response(status_code=400, content=_dump_model(envelope))
        except HarnessError as exc:
            return _harness_error_response(exc)
        return secure_json_response(status_code=201, content=_dump_model(entry))

    async def patch_project_reference(project_id: str, reference_id: str, request: Any) -> Any:
        project_root = project_locations.get(project_id)
        if project_root is None:
            return _resource_not_found(
                "Project is not registered in this runtime process.",
                {"project_id": project_id},
            )
        body_or_response = await _body_or_error_response(request)
        if not isinstance(body_or_response, dict):
            return body_or_response
        try:
            patch_request = ProjectReferencePatchRequest.model_validate(body_or_response)
            entry = update_project_reference_enabled(
                project_root,
                reference_id=reference_id,
                enabled=patch_request.enabled,
            )
        except ValidationError as exc:
            return secure_json_response(status_code=400, content=_dump_model(_validation_error_envelope(exc)))
        except HarnessError as exc:
            return _harness_error_response(exc)
        return _dump_model(entry)

    async def post_workflow_run(workflow_id: str, request: Any) -> Any:
        body_or_response = await _body_or_error_response(request)
        if not isinstance(body_or_response, dict):
            return body_or_response
        body = body_or_response
        replay = idempotency_replay_response(request, body)
        if replay is not None:
            return replay
        project_root = _project_root_for_workflow(project_locations.values(), workflow_id)
        if project_root is None:
            return secure_json_response(
                status_code=404,
                content=_dump_model(
                    build_error_envelope(
                        error_code=APIErrorCode.RES_NOT_FOUND,
                        message="Workflow is not registered in this runtime process.",
                        details={"workflow_id": workflow_id},
                    )
                ),
            )
        try:
            start_request = WorkflowRunStartRequest.model_validate(body)
            start_response = create_workflow_run(project_root, workflow_id, start_request)
        except ValidationError as exc:
            return secure_json_response(status_code=400, content=_dump_model(_validation_error_envelope(exc)))
        except WorkflowValidationError as exc:
            return secure_json_response(
                status_code=_workflow_validation_status(exc),
                content=_dump_model(
                    build_error_envelope(error_code=exc.error_code, message=str(exc), details=exc.details)
                ),
            )
        except RunError as exc:
            return _run_error_response(exc)
        content = _dump_model(start_response)
        run_locations[start_response.run_id] = project_root
        remember_idempotency_response(request, body, status_code=201, content=content)
        return secure_json_response(status_code=201, content=content)

    async def post_workflow_pause(workflow_id: str, request: Any) -> Any:
        return await _workflow_action(workflow_id, request, pause_active_workflow_run)

    async def post_workflow_resume(workflow_id: str, request: Any) -> Any:
        return await _workflow_action(workflow_id, request, resume_active_workflow_run)

    async def post_workflow_cancel(workflow_id: str, request: Any) -> Any:
        return await _workflow_action(workflow_id, request, cancel_active_workflow_run)

    def get_run(run_id: str) -> Any:
        project_root = run_locations.get(run_id)
        if project_root is None:
            return _resource_not_found("Run is not registered in this runtime process.", {"run_id": run_id})
        try:
            run = read_workflow_run(project_root, run_id)
        except RunError as exc:
            return _run_error_response(exc)
        return _dump_model(run)

    async def post_run_cancel(run_id: str, request: Any) -> Any:
        return await _run_action(run_id, request, cancel_workflow_run)

    async def post_run_decision(run_id: str, request: Any) -> Any:
        body_or_response = await _body_or_error_response(request)
        if not isinstance(body_or_response, dict):
            return body_or_response
        body = body_or_response
        replay = idempotency_replay_response(request, body)
        if replay is not None:
            return replay
        project_root = run_locations.get(run_id)
        if project_root is None:
            return _resource_not_found("Run is not registered in this runtime process.", {"run_id": run_id})
        try:
            decision_request = HumanDecisionRequest.model_validate(body)
            record = resolve_human_decision(project_root, run_id, decision_request)
        except ValidationError as exc:
            return secure_json_response(status_code=400, content=_dump_model(_validation_error_envelope(exc)))
        except RunError as exc:
            return _run_error_response(exc)
        content = {"schema_version": RUNTIME_SCHEMA_VERSION, **_dump_model(record)}
        remember_idempotency_response(request, body, status_code=200, content=content)
        return secure_json_response(status_code=200, content=content)

    async def post_run_node_run_once(run_id: str, node_id: str, request: Any) -> Any:
        return await _run_node_advance(run_id, node_id, request)

    async def post_run_node_re_evaluate(run_id: str, node_id: str, request: Any) -> Any:
        return await _run_node_advance(run_id, node_id, request, require_evaluation_node=True)

    async def post_run_node_repair(run_id: str, node_id: str, request: Any) -> Any:
        body_or_response = await _body_or_error_response(request)
        if not isinstance(body_or_response, dict):
            return body_or_response
        body = body_or_response
        replay = idempotency_replay_response(request, body)
        if replay is not None:
            return replay
        project_root = run_locations.get(run_id)
        if project_root is None:
            return _resource_not_found("Run is not registered in this runtime process.", {"run_id": run_id})
        try:
            repair_request = RunNodeRepairRequest.model_validate(body)
            _ensure_manual_repair_request(project_root, run_id, node_id, repair_request)
            repair_input = _repair_advance_input_from_request(repair_request)
            advance_request = NodeAdvanceRequest(
                schema_version=repair_request.schema_version,
                node_id=node_id,
                repair=repair_input,
            )
            result = await advance_workflow_run_with_adapters(project_root, run_id, adapters, advance_request)
            repair_patch = _repair_patch_for_result(project_root, run_id, result.patch_id)
        except ValidationError as exc:
            return secure_json_response(status_code=400, content=_dump_model(_validation_error_envelope(exc)))
        except WorkflowValidationError as exc:
            return secure_json_response(
                status_code=_workflow_validation_status(exc),
                content=_dump_model(
                    build_error_envelope(
                        error_code=exc.error_code,
                        message=str(exc),
                        details=exc.details,
                    )
                ),
            )
        except RunError as exc:
            return _run_error_response(exc)
        content: dict[str, object] = {
            **_dump_model(result),
            "repair_patch": _dump_model(repair_patch),
            "applied": True,
        }
        remember_idempotency_response(request, body, status_code=200, content=content)
        return secure_json_response(status_code=200, content=content)

    async def _run_node_advance(
        run_id: str,
        node_id: str,
        request: Any,
        *,
        require_evaluation_node: bool = False,
    ) -> Any:
        body_or_response = await _body_or_error_response(request)
        if not isinstance(body_or_response, dict):
            return body_or_response
        body = body_or_response
        replay = idempotency_replay_response(request, body)
        if replay is not None:
            return replay
        project_root = run_locations.get(run_id)
        if project_root is None:
            return _resource_not_found("Run is not registered in this runtime process.", {"run_id": run_id})
        body_node_id = body.get("node_id")
        if body_node_id is not None and body_node_id != node_id:
            return _run_error_response(
                RunError(
                    "NL_STATE_FORBIDDEN_TRANSITION",
                    "node_id in request body must match the path node_id.",
                    details={"path_node_id": node_id, "body_node_id": body_node_id},
                )
            )
        try:
            if require_evaluation_node:
                _ensure_re_evaluate_node(project_root, node_id)
            advance_request = NodeAdvanceRequest.model_validate({**body, "node_id": node_id})
            result = await advance_workflow_run_with_adapters(project_root, run_id, adapters, advance_request)
        except ValidationError as exc:
            return secure_json_response(status_code=400, content=_dump_model(_validation_error_envelope(exc)))
        except WorkflowValidationError as exc:
            return secure_json_response(
                status_code=_workflow_validation_status(exc),
                content=_dump_model(
                    build_error_envelope(
                        error_code=exc.error_code,
                        message=str(exc),
                        details=exc.details,
                    )
                ),
            )
        except RunError as exc:
            return _run_error_response(exc)
        content = _dump_model(result)
        remember_idempotency_response(request, body, status_code=200, content=content)
        return secure_json_response(status_code=200, content=content)

    def _ensure_re_evaluate_node(project_root: Path, node_id: str) -> None:
        graph = load_workflow_graph(project_root)
        for node in graph.nodes:
            if node.node_id != node_id:
                continue
            if isinstance(node, EvaluationTaskNode):
                return
            raise RunError(
                "NL_STATE_FORBIDDEN_TRANSITION",
                "re-evaluate can only target an evaluation_task node.",
                details={"node_id": node_id, "node_type": node.type},
            )
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "Requested node does not exist in the workflow graph.",
            details={"node_id": node_id},
        )

    def _ensure_manual_repair_request(
        project_root: Path,
        run_id: str,
        node_id: str,
        repair_request: RunNodeRepairRequest,
    ) -> None:
        repair_node = _repair_node_for_path(project_root, node_id)
        run = read_workflow_run(project_root, run_id)
        current_evaluation_id = _runtime_metadata_string(
            run,
            "last_evaluation_by_target",
            repair_node.repair_target_node_id,
        )
        if current_evaluation_id == repair_request.based_on_evaluation_id:
            return
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "Repair request must reference the current evaluation for the repair target.",
            details={
                "run_id": run_id,
                "node_id": node_id,
                "target_node_id": repair_node.repair_target_node_id,
                "based_on_evaluation_id": repair_request.based_on_evaluation_id,
                "current_evaluation_id": current_evaluation_id,
            },
        )

    def _repair_node_for_path(project_root: Path, node_id: str) -> RepairTaskNode:
        graph = load_workflow_graph(project_root)
        for node in graph.nodes:
            if node.node_id != node_id:
                continue
            if isinstance(node, RepairTaskNode):
                return node
            raise RunError(
                "NL_STATE_FORBIDDEN_TRANSITION",
                "repair can only target a repair_task node.",
                details={"node_id": node_id, "node_type": node.type},
            )
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "Requested node does not exist in the workflow graph.",
            details={"node_id": node_id},
        )

    def _runtime_metadata_string(run: WorkflowRunDocument, bucket: str, key: str) -> str | None:
        cw_metadata = run.metadata.get("cw")
        if not isinstance(cw_metadata, dict):
            return None
        bucket_value = cw_metadata.get(bucket)
        if not isinstance(bucket_value, dict):
            return None
        raw_value = bucket_value.get(key)
        if raw_value is None or isinstance(raw_value, str):
            return raw_value
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Run metadata contains an invalid runner value.",
            status_code=500,
            details={"run_id": run.run_id, "bucket": bucket, "key": key, "value": raw_value},
        )

    def _repair_advance_input_from_request(repair_request: RunNodeRepairRequest) -> RepairAdvanceInput:
        if repair_request.preferred_strategy != RepairKind.PROMPT_PATCH:
            raise RunError(
                "RP_BUILD_KIND_NOT_ALLOWED",
                "Manual repair API foundation only supports prompt_patch.",
                status_code=422,
                details={"preferred_strategy": repair_request.preferred_strategy.value},
            )
        if repair_request.scope == PatchScope.THIS_ATTEMPT_ONLY:
            scope: Literal[
                PatchScope.THIS_ATTEMPT_ONLY,
                PatchScope.UNTIL_PASS,
                PatchScope.PERSISTENT_FOR_RUN,
                PatchScope.PERSISTENT_FOR_WORKFLOW,
            ] = PatchScope.THIS_ATTEMPT_ONLY
        elif repair_request.scope == PatchScope.UNTIL_PASS:
            scope = PatchScope.UNTIL_PASS
        elif repair_request.scope == PatchScope.PERSISTENT_FOR_RUN:
            scope = PatchScope.PERSISTENT_FOR_RUN
        elif repair_request.scope == PatchScope.PERSISTENT_FOR_WORKFLOW:
            scope = PatchScope.PERSISTENT_FOR_WORKFLOW
        else:
            raise RunError(
                "NL_STATE_FORBIDDEN_TRANSITION",
                "Manual repair API foundation only supports spec-defined prompt_patch scopes.",
                details={"scope": repair_request.scope.value},
            )
        return RepairAdvanceInput(
            scope=scope,
            metadata={
                "cw": {
                    "api_action": "manual_repair",
                    "based_on_evaluation_id": repair_request.based_on_evaluation_id,
                }
            },
        )

    def _repair_patch_for_result(project_root: Path, run_id: str, patch_id: str | None) -> RepairPatch:
        if patch_id is None:
            raise RunError(
                "RH_RUN_DIR_CORRUPTED",
                "Repair action completed without a patch_id.",
                status_code=500,
                details={"run_id": run_id},
            )
        repairs_path = project_root / ".agent-workflow" / "runs" / run_id / "repairs.jsonl"
        try:
            raw_lines = repairs_path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise RunError(
                "RH_RUN_DIR_CORRUPTED",
                "Repair action did not persist repairs.jsonl.",
                status_code=500,
                details={"run_id": run_id, "patch_id": patch_id},
            ) from exc
        for raw_line in raw_lines:
            if not raw_line:
                continue
            try:
                raw_patch = json.loads(raw_line)
                repair_patch = RepairPatch.model_validate(raw_patch)
            except (json.JSONDecodeError, ValidationError) as exc:
                raise RunError(
                    "RH_RUN_DIR_CORRUPTED",
                    "repairs.jsonl contains an invalid RepairPatch record.",
                    status_code=500,
                    details={"run_id": run_id, "patch_id": patch_id},
                ) from exc
            if repair_patch.patch_id == patch_id:
                return repair_patch
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Repair action did not persist the returned patch_id.",
            status_code=500,
            details={"run_id": run_id, "patch_id": patch_id},
        )

    async def _workflow_action(
        workflow_id: str,
        request: Any,
        action: Callable[[Path, str, RunActionRequest], WorkflowRunDocument],
    ) -> Any:
        body_or_response = await _body_or_error_response(request)
        if not isinstance(body_or_response, dict):
            return body_or_response
        body = body_or_response
        replay = idempotency_replay_response(request, body)
        if replay is not None:
            return replay
        project_root = _project_root_for_workflow(project_locations.values(), workflow_id)
        if project_root is None:
            return secure_json_response(
                status_code=404,
                content=_dump_model(
                    build_error_envelope(
                        error_code=APIErrorCode.RES_NOT_FOUND,
                        message="Workflow is not registered in this runtime process.",
                        details={"workflow_id": workflow_id},
                    )
                ),
            )
        try:
            action_request = RunActionRequest.model_validate(body)
            run = action(project_root, workflow_id, action_request)
        except ValidationError as exc:
            return secure_json_response(status_code=400, content=_dump_model(_validation_error_envelope(exc)))
        except RunError as exc:
            return _run_error_response(exc)
        run_locations[run.run_id] = project_root
        content = _dump_model(run)
        remember_idempotency_response(request, body, status_code=200, content=content)
        return secure_json_response(status_code=200, content=content)

    async def _run_action(
        run_id: str,
        request: Any,
        action: Callable[[Path, str, RunActionRequest], BaseModel],
    ) -> Any:
        body_or_response = await _body_or_error_response(request)
        if not isinstance(body_or_response, dict):
            return body_or_response
        body = body_or_response
        replay = idempotency_replay_response(request, body)
        if replay is not None:
            return replay
        project_root = run_locations.get(run_id)
        if project_root is None:
            return _resource_not_found("Run is not registered in this runtime process.", {"run_id": run_id})
        try:
            action_request = RunActionRequest.model_validate(body)
            run = action(project_root, run_id, action_request)
        except ValidationError as exc:
            return secure_json_response(status_code=400, content=_dump_model(_validation_error_envelope(exc)))
        except RunError as exc:
            return _run_error_response(exc)
        content = _dump_model(run)
        remember_idempotency_response(request, body, status_code=200, content=content)
        return secure_json_response(status_code=200, content=content)

    def get_run_stream(run_id: str, request: Any) -> Any:
        project_root = run_locations.get(run_id)
        if project_root is None:
            return _resource_not_found("Run is not registered in this runtime process.", {"run_id": run_id})
        try:
            since_seq = _optional_int(request.query_params.get("since_seq"))
            until_seq = _optional_int(request.query_params.get("until_seq"))
            categories = parse_event_categories(request.query_params.get("category"))
            display_levels = parse_display_levels(request.query_params.get("level"))
            after_event_id = request.headers.get("last-event-id")
            list_stream_events(
                project_root,
                run_id,
                after_event_id=after_event_id,
                since_seq=since_seq,
                until_seq=until_seq,
                categories=categories,
                display_levels=display_levels,
            )
        except ValueError as exc:
            return secure_json_response(
                status_code=400,
                content=_dump_model(
                    build_error_envelope(
                        error_code="SE_BUILD_BAD_TYPE",
                        message=str(exc),
                    )
                ),
            )
        except RunError as exc:
            return _run_error_response(exc)
        response = streaming_response(
            stream_sse_events(
                project_root,
                run_id,
                after_event_id=after_event_id,
                since_seq=since_seq,
                until_seq=until_seq,
                categories=categories,
                display_levels=display_levels,
            ),
            media_type="text/event-stream",
        )
        _apply_security_headers(response)
        response.headers["Cache-Control"] = "no-cache"
        return response

    async def _body_or_error_response(request: Any) -> Any:
        try:
            body = await read_json_body(request)
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
        if not isinstance(body, dict):
            return secure_json_response(
                status_code=400,
                content=_dump_model(
                    build_error_envelope(
                        error_code=APIErrorCode.SCHEMA_VERSION_MISSING,
                        message="Request body must be a JSON object with schema_version.",
                    )
                ),
            )
        return cast(dict[str, object], body)

    def _run_error_response(exc: RunError) -> Any:
        return secure_json_response(
            status_code=exc.status_code,
            content=_dump_model(build_error_envelope(error_code=exc.error_code, message=str(exc), details=exc.details)),
        )

    def _harness_error_response(exc: HarnessError) -> Any:
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

    def _resource_not_found(message: str, details: dict[str, object]) -> Any:
        return secure_json_response(
            status_code=404,
            content=_dump_model(
                build_error_envelope(error_code=APIErrorCode.RES_NOT_FOUND, message=message, details=details)
            ),
        )

    def _read_project_config(project_id: str, manifest_name: str) -> Any:
        project_root = project_locations.get(project_id)
        if project_root is None:
            return _resource_not_found(
                "Project is not registered in this runtime process.",
                {"project_id": project_id},
            )
        config_path = project_root / ".agent-workflow" / manifest_name
        try:
            with config_path.open("r", encoding="utf-8") as file:
                loaded: object = json.load(file)
        except FileNotFoundError:
            return _resource_not_found(
                "Project configuration file was not found.",
                {"project_id": project_id, "manifest_name": manifest_name},
            )
        except (OSError, json.JSONDecodeError):
            return _resource_not_found(
                "Project configuration resource is not available.",
                {"project_id": project_id, "manifest_name": manifest_name},
            )
        return loaded

    post_projects.__annotations__["request"] = requests.Request
    post_project_reference.__annotations__["request"] = requests.Request
    patch_project_reference.__annotations__["request"] = requests.Request
    post_workflow_run.__annotations__["request"] = requests.Request
    post_workflow_pause.__annotations__["request"] = requests.Request
    post_workflow_resume.__annotations__["request"] = requests.Request
    post_workflow_cancel.__annotations__["request"] = requests.Request
    post_run_decision.__annotations__["request"] = requests.Request
    post_run_node_run_once.__annotations__["request"] = requests.Request
    post_run_node_re_evaluate.__annotations__["request"] = requests.Request
    post_run_node_repair.__annotations__["request"] = requests.Request
    post_run_cancel.__annotations__["request"] = requests.Request
    get_run_stream.__annotations__["request"] = requests.Request

    app.middleware("http")(runtime_api_guard)
    app.get(f"{settings.api_prefix}/system/info")(get_system_info)
    app.get(f"{settings.api_prefix}/system/health")(get_system_health)
    app.get(f"{settings.api_prefix}/system/capabilities")(get_system_capabilities)
    app.post(f"{settings.api_prefix}/system/shutdown", status_code=202)(post_system_shutdown)
    app.post(f"{settings.api_prefix}/projects")(post_projects)
    app.get(f"{settings.api_prefix}/projects/{{project_id}}")(get_project)
    app.get(f"{settings.api_prefix}/projects/{{project_id}}/references")(get_project_references)
    app.post(f"{settings.api_prefix}/projects/{{project_id}}/references")(post_project_reference)
    app.patch(f"{settings.api_prefix}/projects/{{project_id}}/references/{{reference_id}}")(patch_project_reference)
    app.get(f"{settings.api_prefix}/projects/{{project_id}}/skills")(get_project_skills)
    app.get(f"{settings.api_prefix}/projects/{{project_id}}/mcps")(get_project_mcps)
    app.get(f"{settings.api_prefix}/projects/{{project_id}}/adapters")(get_project_adapters)
    app.post(f"{settings.api_prefix}/workflows/{{workflow_id}}/run")(post_workflow_run)
    app.post(f"{settings.api_prefix}/workflows/{{workflow_id}}/pause")(post_workflow_pause)
    app.post(f"{settings.api_prefix}/workflows/{{workflow_id}}/resume")(post_workflow_resume)
    app.post(f"{settings.api_prefix}/workflows/{{workflow_id}}/cancel")(post_workflow_cancel)
    app.get(f"{settings.api_prefix}/runs/{{run_id}}")(get_run)
    app.post(f"{settings.api_prefix}/runs/{{run_id}}/decisions")(post_run_decision)
    app.post(f"{settings.api_prefix}/runs/{{run_id}}/nodes/{{node_id}}:run-once")(post_run_node_run_once)
    app.post(f"{settings.api_prefix}/runs/{{run_id}}/nodes/{{node_id}}:re-evaluate")(post_run_node_re_evaluate)
    app.post(f"{settings.api_prefix}/runs/{{run_id}}/nodes/{{node_id}}:repair")(post_run_node_repair)
    app.post(f"{settings.api_prefix}/runs/{{run_id}}/cancel")(post_run_cancel)
    app.get(f"{settings.api_prefix}/runs/{{run_id}}/stream")(get_run_stream)
    app.get(f"{settings.api_prefix}/observability/runs/{{run_id}}/stream")(get_run_stream)

    return cast(AsgiApp, app)


def _body_signature(body: object) -> str:
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _idempotency_cache_key(request: Any) -> tuple[str, str] | None:
    idempotency_key = request.headers.get("idempotency-key")
    return (str(request.url.path), idempotency_key) if idempotency_key else None


def _project_root_for_workflow(project_roots: Iterable[Path], workflow_id: str) -> Path | None:
    for project_root in project_roots:
        try:
            graph = load_workflow_graph(project_root)
        except WorkflowValidationError:
            continue
        if graph.workflow_id == workflow_id:
            return project_root
    return None


def _workflow_validation_status(exc: WorkflowValidationError) -> int:
    return 400 if exc.level in ("L1", "L2") else 422


def _optional_int(raw: str | None) -> int | None:
    if raw is None or raw == "":
        return None
    return int(raw)


def _parse_multipart_form(content_type: str | None, body: bytes) -> dict[str, _MultipartPart]:
    boundary = _multipart_boundary(content_type)
    if boundary is None:
        return {}
    boundary_bytes = f"--{boundary}".encode("ascii")
    parts: dict[str, _MultipartPart] = {}
    if not body.startswith(boundary_bytes):
        return parts
    position = len(boundary_bytes)
    if body[position : position + 2] == b"--":
        return parts
    if body[position : position + 2] != b"\r\n":
        return parts
    position += 2
    while position < len(body):
        raw_headers, separator, _remainder = body[position:].partition(b"\r\n\r\n")
        if separator == b"":
            break
        content_start = position + len(raw_headers) + len(separator)
        next_boundary = _find_multipart_boundary(body, boundary_bytes, content_start)
        if next_boundary is None:
            break
        content = body[content_start:next_boundary]
        delimiter_start = next_boundary + len(b"\r\n")
        after_delimiter = delimiter_start + len(boundary_bytes)
        headers = _multipart_headers(raw_headers)
        disposition = headers.get("content-disposition")
        if disposition is not None:
            name = _content_disposition_param(disposition, "name")
            if name is not None:
                filename = _content_disposition_param(disposition, "filename")
                parts[name] = _MultipartPart(filename=filename, content=content)
        if body[after_delimiter : after_delimiter + 2] == b"--":
            break
        if body[after_delimiter : after_delimiter + 2] != b"\r\n":
            break
        position = after_delimiter + 2
    return parts


def _find_multipart_boundary(body: bytes, boundary_bytes: bytes, start: int) -> int | None:
    marker = b"\r\n" + boundary_bytes
    search_start = start
    while True:
        position = body.find(marker, search_start)
        if position < 0:
            return None
        suffix_start = position + len(marker)
        suffix = body[suffix_start : suffix_start + 2]
        if suffix in {b"\r\n", b"--"}:
            return position
        search_start = suffix_start


def _multipart_boundary(content_type: str | None) -> str | None:
    if content_type is None:
        return None
    parts = [part.strip() for part in content_type.split(";")]
    if not parts or parts[0].lower() != "multipart/form-data":
        return None
    for part in parts[1:]:
        name, separator, value = part.partition("=")
        if separator == "" or name.lower() != "boundary":
            continue
        boundary = value.strip().strip('"')
        if boundary != "" and all(32 < ord(char) < 127 for char in boundary):
            return boundary
    return None


def _multipart_headers(raw_headers: bytes) -> dict[str, str]:
    headers: dict[str, str] = {}
    for raw_line in raw_headers.split(b"\r\n"):
        try:
            line = raw_line.decode("latin-1")
        except UnicodeDecodeError:
            continue
        name, separator, value = line.partition(":")
        if separator == "":
            continue
        headers[name.strip().lower()] = value.strip()
    return headers


def _content_disposition_param(disposition: str, param_name: str) -> str | None:
    for raw_part in disposition.split(";")[1:]:
        name, separator, value = raw_part.strip().partition("=")
        if separator == "" or name.lower() != param_name:
            continue
        stripped = value.strip()
        if len(stripped) >= 2 and stripped[0] == '"' and stripped[-1] == '"':
            stripped = stripped[1:-1]
        return stripped if stripped != "" else None
    return None


def _multipart_part_text(part: _MultipartPart | None) -> str | None:
    if part is None:
        return None
    try:
        return part.content.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _multipart_file_bytes(part: _MultipartPart | None) -> bytes | None:
    if part is None:
        return None
    return part.content


def _multipart_file_name(part: _MultipartPart | None) -> str | None:
    if part is None or part.filename is None:
        return None
    stripped = part.filename.strip()
    return stripped if stripped else None


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
