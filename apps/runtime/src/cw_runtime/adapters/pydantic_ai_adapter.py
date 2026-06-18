"""Pydantic AI AgentAdapter foundation.

This module keeps the public ``pydantic_ai`` adapter entry point importable
without requiring the optional agents extra in the default runtime install.
Real SDK integration can provide a ``PydanticAISession`` behind this seam.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import json
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from types import ModuleType
from typing import Any, Literal, Protocol, TypeAlias, cast

from pydantic import BaseModel, ConfigDict, Field

from cw_runtime.adapters.base import (
    AdapterConfig,
    AdapterDescriptor,
    AdapterRuntimeError,
    AgentAdapterErrorCode,
    AttemptHandle,
    AttemptResumption,
    build_adapter_error,
)
from cw_runtime.model_router.router import AdapterCapabilities
from cw_runtime.runs.lifecycle import new_runtime_id, utc_now_ms
from cw_schemas import ExecutionPack
from cw_schemas.events import HumanEvent, LifecycleEvent, ModelEvent, StreamEventBase, ToolEvent
from cw_schemas.runtime import AdapterError, AttemptOutcome, AttemptProvenance, RunUsage
from cw_schemas.types import (
    AdapterKind,
    AttemptState,
    CancelReason,
    DisplayLevel,
    EventPhase,
    ProviderKind,
    ResumptionKind,
    Sensitivity,
    StreamSeverity,
)

RawPydanticAIEvent: TypeAlias = Mapping[str, Any]


class _AttemptTimeoutExpired(RuntimeError):
    """Internal sentinel for adapter-owned ``retry_policy.timeout_seconds`` expiry."""


class _AttemptCancelled(RuntimeError):
    """Internal sentinel for adapter-owned user/system cancellation."""

    def __init__(self, reason: CancelReason) -> None:
        super().__init__(reason.value)
        self.reason = reason


class PydanticAIMCPToolRequest(BaseModel):
    """Serializable MCP tool request projected from a NodeContract."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    server_id: str = Field(..., min_length=1)
    tool_name: str = Field(default="*", min_length=1)
    requires_approval: bool = False


class PydanticAIToolsetRequest(BaseModel):
    """Serializable toolset request passed to the SDK toolset factory."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    builtin_tools: list[str] = Field(default_factory=list)
    skill_ids_resolved: list[str] = Field(default_factory=list)
    mcp_tools: list[PydanticAIMCPToolRequest] = Field(default_factory=list)


class PydanticAIRetryPolicy(BaseModel):
    """Serializable retry policy subset passed to the SDK Agent constructor."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    model_retries: int = Field(default=0, ge=0)
    model_retries_explicit: bool = False
    output_validation_retries: int = Field(default=0, ge=0)
    tool_retries: int | dict[str, int] = Field(default=0)
    timeout_seconds: int | None = Field(default=None, ge=1)


class PydanticAIDeferredToolResults(BaseModel):
    """Serializable deferred tool results passed back into the SDK."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    calls: dict[str, Any] = Field(default_factory=dict)
    approvals: dict[str, bool | dict[str, Any]] = Field(default_factory=dict)
    metadata: dict[str, dict[str, Any]] = Field(default_factory=dict)


class PydanticAIRunRequest(BaseModel):
    """Internal request passed to a Pydantic AI session implementation."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    handle_id: str = Field(..., min_length=1)
    run_id: str = Field(..., min_length=1)
    node_id: str = Field(..., min_length=1)
    attempt_id: str = Field(..., min_length=1)
    execution_pack_id: str = Field(..., min_length=1)
    model_profile_id: str = Field(..., min_length=1)
    system_prompt: str | None = None
    instructions: list[str] = Field(default_factory=list)
    user_prompt: str = Field(..., min_length=1)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    model_settings: dict[str, Any] = Field(default_factory=dict)
    usage_limits: dict[str, Any] = Field(default_factory=dict)
    toolsets: PydanticAIToolsetRequest = Field(default_factory=PydanticAIToolsetRequest)
    retry_policy: PydanticAIRetryPolicy = Field(default_factory=PydanticAIRetryPolicy)
    correlation_id: str = Field(..., min_length=1)


class PydanticAIResumeRequest(BaseModel):
    """Internal resume request passed to a Pydantic AI session implementation."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    handle_id: str = Field(..., min_length=1)
    run_id: str = Field(..., min_length=1)
    node_id: str = Field(..., min_length=1)
    attempt_id: str = Field(..., min_length=1)
    resumption: AttemptResumption
    deferred_tool_results: PydanticAIDeferredToolResults | None = None


class PydanticAISession(Protocol):
    """Minimal async seam for future SDK-backed Pydantic AI integration."""

    def run(self, request: PydanticAIRunRequest) -> AsyncIterator[RawPydanticAIEvent]: ...

    def resume(self, request: PydanticAIResumeRequest) -> AsyncIterator[RawPydanticAIEvent]: ...

    async def cancel(self, handle_id: str, reason: CancelReason) -> None: ...

    async def aclose(self) -> None: ...


PydanticAISessionFactory: TypeAlias = Callable[[], PydanticAISession]


@dataclass(frozen=True)
class PydanticAIMCPToolset:
    """SDK MCP toolset bound to the CW MCP server id that produced it."""

    server_id: str
    toolset: object


@dataclass(frozen=True)
class PydanticAIToolsets:
    """SDK toolsets grouped by CW source kind for adapter-side policy wrapping."""

    function_toolsets: Sequence[object] = ()
    mcp_toolsets: Sequence[PydanticAIMCPToolset] = ()


PydanticAIToolsetFactory: TypeAlias = Callable[[ModuleType, PydanticAIToolsetRequest], PydanticAIToolsets]


def _registry_key(value: str, field_name: str) -> str:
    if not value:
        raise ValueError(f"{field_name} must be non-empty.")
    return value


class PydanticAIToolsetRegistry:
    """Registry-backed resolver for already constructed Pydantic AI SDK toolsets."""

    def __init__(
        self,
        *,
        builtin_toolsets: Mapping[str, object] | None = None,
        skill_toolsets: Mapping[str, object] | None = None,
        mcp_toolsets: Mapping[str, object] | None = None,
    ) -> None:
        self._builtin_toolsets: dict[str, object] = {}
        self._skill_toolsets: dict[str, object] = {}
        self._mcp_toolsets: dict[str, object] = {}
        for tool_id, toolset in ({} if builtin_toolsets is None else builtin_toolsets).items():
            self.register_builtin_toolset(tool_id, toolset)
        for skill_ref, toolset in ({} if skill_toolsets is None else skill_toolsets).items():
            self.register_resolved_skill_toolset(skill_ref, toolset)
        for server_id, toolset in ({} if mcp_toolsets is None else mcp_toolsets).items():
            self.register_mcp_toolset(server_id, toolset)

    def register_builtin_toolset(self, tool_id: str, toolset: object) -> None:
        self._builtin_toolsets[_registry_key(tool_id, "tool_id")] = toolset

    def register_skill_toolset(self, skill_id: str, toolset: object, *, version: str = "latest") -> None:
        skill_ref = f"{_registry_key(skill_id, 'skill_id')}@{_registry_key(version, 'version')}"
        self._skill_toolsets[skill_ref] = toolset

    def register_resolved_skill_toolset(self, skill_ref: str, toolset: object) -> None:
        self._skill_toolsets[_registry_key(skill_ref, "skill_ref")] = toolset

    def register_mcp_toolset(self, server_id: str, toolset: object) -> None:
        self._mcp_toolsets[_registry_key(server_id, "server_id")] = toolset

    def resolve(self, _sdk: ModuleType, request: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        builtin_tool_ids = _unique_strings(request.builtin_tools)
        skill_refs = _unique_strings(request.skill_ids_resolved)
        mcp_server_ids = _unique_strings([tool.server_id for tool in request.mcp_tools])

        missing_builtin_tool_ids = [tool_id for tool_id in builtin_tool_ids if tool_id not in self._builtin_toolsets]
        missing_skill_refs = [skill_ref for skill_ref in skill_refs if skill_ref not in self._skill_toolsets]
        missing_mcp_server_ids = [server_id for server_id in mcp_server_ids if server_id not in self._mcp_toolsets]
        missing_payload: dict[str, object] = {}
        if missing_builtin_tool_ids:
            missing_payload["missing_builtin_tools"] = missing_builtin_tool_ids
        if missing_skill_refs:
            missing_payload["missing_skill_ids_resolved"] = missing_skill_refs
        if missing_mcp_server_ids:
            missing_payload["missing_mcp_server_ids"] = missing_mcp_server_ids
        if missing_payload:
            raise AdapterRuntimeError(
                "AA_RUN_TOOL_NOT_FOUND",
                "Pydantic AI toolset registry did not resolve requested toolsets.",
                payload={
                    **missing_payload,
                    "toolsets": request.model_dump(mode="json"),
                },
            )

        function_toolsets = [
            *[self._builtin_toolsets[tool_id] for tool_id in builtin_tool_ids],
            *[self._skill_toolsets[skill_ref] for skill_ref in skill_refs],
        ]
        mcp_toolsets = [
            PydanticAIMCPToolset(server_id=server_id, toolset=self._mcp_toolsets[server_id])
            for server_id in mcp_server_ids
        ]
        return PydanticAIToolsets(
            function_toolsets=tuple(function_toolsets),
            mcp_toolsets=tuple(mcp_toolsets),
        )

    def as_factory(self) -> PydanticAIToolsetFactory:
        return self.resolve


class PydanticAISDKSession:
    """Lazy SDK-backed Pydantic AI session.

    The optional ``pydantic_ai`` package is imported only when this default
    session is used, so the runtime package remains importable without the
    ``agents`` extra.
    """

    def __init__(
        self,
        sdk_module: ModuleType | None = None,
        *,
        toolset_factory: PydanticAIToolsetFactory | None = None,
    ) -> None:
        self._sdk_module = sdk_module
        self._toolset_factory = toolset_factory
        self._agents: dict[str, Any] = {}
        self._message_history: dict[str, list[object]] = {}
        self._run_requests: dict[str, PydanticAIRunRequest] = {}
        self._usage_limits: dict[str, object | None] = {}

    async def run(self, request: PydanticAIRunRequest) -> AsyncIterator[RawPydanticAIEvent]:
        sdk = self._sdk()
        agent = _build_sdk_agent(sdk, request, self._toolset_factory)
        usage_limits = _sdk_usage_limits(sdk, request)
        self._agents[request.handle_id] = agent
        self._run_requests[request.handle_id] = request
        self._usage_limits[request.handle_id] = usage_limits
        async for raw_event in self._run_agent(
            agent,
            request,
            usage_limits,
            user_prompt=request.user_prompt,
            message_history=None,
            deferred_tool_results=None,
        ):
            yield raw_event

    async def resume(self, request: PydanticAIResumeRequest) -> AsyncIterator[RawPydanticAIEvent]:
        sdk = self._sdk()
        agent = self._agents.get(request.handle_id)
        run_request = self._run_requests.get(request.handle_id)
        message_history = self._message_history.get(request.handle_id)
        if agent is None or run_request is None or not message_history:
            raise AdapterRuntimeError(
                "AA_RESUME_INVALID_KIND",
                "Pydantic AI SDK-backed resume requires a previous deferred tool run.",
                payload={"handle_id": request.handle_id, "kind": request.resumption.kind.value},
            )
        if request.deferred_tool_results is None:
            raise AdapterRuntimeError(
                "AA_RESUME_INVALID_KIND",
                "Pydantic AI SDK-backed resume requires deferred tool results.",
                payload={"handle_id": request.handle_id, "kind": request.resumption.kind.value},
            )
        deferred_tool_results = _sdk_deferred_tool_results(sdk, request.deferred_tool_results)
        async for raw_event in self._run_agent(
            agent,
            run_request,
            self._usage_limits.get(request.handle_id),
            user_prompt=None,
            message_history=message_history,
            deferred_tool_results=deferred_tool_results,
        ):
            yield raw_event

    async def cancel(self, handle_id: str, reason: CancelReason) -> None:
        return None

    async def aclose(self) -> None:
        self._agents.clear()
        self._message_history.clear()
        self._run_requests.clear()
        self._usage_limits.clear()
        return None

    async def _run_agent(
        self,
        agent: Any,
        request: PydanticAIRunRequest,
        usage_limits: object | None,
        *,
        user_prompt: str | None,
        message_history: list[object] | None,
        deferred_tool_results: object | None,
    ) -> AsyncIterator[RawPydanticAIEvent]:
        stream_events = getattr(agent, "run_stream_events", None)
        if callable(stream_events):
            async with stream_events(
                user_prompt,
                message_history=message_history,
                deferred_tool_results=deferred_tool_results,
                model_settings=request.model_settings or None,
                usage_limits=usage_limits,
            ) as stream:
                async for sdk_event in stream:
                    self._capture_message_history(request.handle_id, getattr(sdk_event, "result", None))
                    for raw_event in _sdk_stream_event_to_raw(sdk_event):
                        yield raw_event
            return

        async for raw_event in _run_sdk_agent_once(
            agent,
            request,
            usage_limits,
            user_prompt=user_prompt,
            message_history=message_history,
            deferred_tool_results=deferred_tool_results,
            result_handler=lambda result: self._capture_message_history(request.handle_id, result),
        ):
            yield raw_event

    def _capture_message_history(self, handle_id: str, result: object) -> None:
        messages = _sdk_message_history_objects(result)
        if messages:
            self._message_history[handle_id] = messages

    def _sdk(self) -> ModuleType:
        if self._sdk_module is not None:
            return self._sdk_module
        try:
            self._sdk_module = importlib.import_module("pydantic_ai")
        except ImportError as exc:
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "Pydantic AI optional dependency is not installed; install cw_runtime[agents].",
                payload={"extra": "agents", "module": "pydantic_ai"},
            ) from exc
        return self._sdk_module


class PydanticAIAdapter:
    """Phase-1 Pydantic AI adapter foundation."""

    _ADAPTER_ID = "pydantic_ai"
    _ADAPTER_VERSION = "0.1.0"

    def __init__(
        self,
        config: AdapterConfig | None = None,
        *,
        session_factory: PydanticAISessionFactory | None = None,
        toolset_factory: PydanticAIToolsetFactory | None = None,
    ) -> None:
        self._config = config or AdapterConfig(adapter_id=self._ADAPTER_ID)
        self._session_factory = session_factory
        self._toolset_factory = toolset_factory
        self._packs: dict[str, ExecutionPack] = {}
        self._sessions: dict[str, PydanticAISession] = {}
        self._outputs: dict[str, dict[str, Any]] = {}
        self._errors: dict[str, list[AdapterError]] = {}
        self._usage: dict[str, RunUsage] = {}
        self._messages: dict[str, list[dict[str, Any]]] = {}
        self._stream_seq: dict[str, int] = {}
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._cancel_reasons: dict[str, CancelReason] = {}

    @property
    def adapter_id(self) -> str:
        return self._ADAPTER_ID

    @property
    def adapter_version(self) -> str:
        return self._ADAPTER_VERSION

    def capabilities(self) -> AdapterCapabilities:
        common_settings = {"temperature", "top_p", "max_tokens", "reasoning_effort", "seed"}
        tooling_enabled = self._toolset_factory is not None
        return AdapterCapabilities(
            kinds={AdapterKind.CHAT},
            provider_kinds={ProviderKind.CLOUD, ProviderKind.PRIVATE, ProviderKind.LOCAL},
            structured_output=True,
            streaming=True,
            tool_call=tooling_enabled,
            mcp=tooling_enabled,
            human_in_the_loop=tooling_enabled,
            deferred_tool_results=tooling_enabled,
            multi_modal=set(),
            long_context_tokens=200_000,
            max_tool_iterations=16 if tooling_enabled else 0,
            cancel=False,
            evidence_lookup_tool=False,
            model_settings_passthrough=common_settings,
        )

    async def prepare(self, execution_pack: ExecutionPack) -> AttemptHandle:
        if self._config.adapter_id != self._ADAPTER_ID:
            raise AdapterRuntimeError(
                "AA_PREPARE_INCOMPATIBLE_ADAPTER",
                "PydanticAIAdapter requires adapter_id='pydantic_ai'.",
                payload={"adapter_id": self._config.adapter_id},
            )

        handle = AttemptHandle(
            handle_id=f"handle_{new_runtime_id()}",
            attempt_id=execution_pack.attempt_id,
            run_id=execution_pack.run_id,
            node_id=execution_pack.node_id,
            adapter_id=self.adapter_id,
            prepared_at=utc_now_ms(),
            metadata={"cw": {"execution_pack_id": execution_pack.pack_id}},
        )
        self._packs[handle.handle_id] = execution_pack
        self._stream_seq[handle.handle_id] = 0
        self._cancel_events[handle.handle_id] = asyncio.Event()
        return handle

    async def run(self, handle: AttemptHandle) -> AsyncIterator[StreamEventBase]:
        self._ensure_known_handle(handle)
        if handle.state != AttemptState.PREPARED:
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                f"Cannot run handle in state {handle.state.value}.",
                payload={"handle_id": handle.handle_id, "state": handle.state.value},
            )

        handle.state = AttemptState.RUNNING
        handle.stream_started = True
        handle.started_at = utc_now_ms()
        yield self._lifecycle_event(
            handle,
            event_type="attempt.started",
            phase=EventPhase.ATTEMPT_STARTED,
            title="Pydantic AI attempt started",
            payload={
                "attempt_index": _attempt_index(self._packs[handle.handle_id]),
                "model_profile_id": self._packs[handle.handle_id].effective_model_profile_id,
            },
        )

        request = self._run_request(handle)
        model_retry_attempts = 0
        while True:
            emitted_raw_events = 0
            try:
                session = self._session_for(handle)
                async for raw_event in self._iterate_session(
                    handle,
                    session,
                    session.run(request),
                    timeout_seconds=request.retry_policy.timeout_seconds,
                    operation="run",
                ):
                    emitted_raw_events += 1
                    for event in self._translate_raw_event(handle, raw_event):
                        yield event
                    if handle.state in {AttemptState.AWAITING_HUMAN, AttemptState.COMPLETED, AttemptState.FAILED}:
                        return
                if handle.state == AttemptState.RUNNING:
                    yield self._unterminated_session_event(handle, operation="run")
                return
            except AdapterRuntimeError as exc:
                if self._should_retry_model_request(
                    request,
                    exc,
                    model_retry_attempts=model_retry_attempts,
                    emitted_raw_events=emitted_raw_events,
                ):
                    model_retry_attempts += 1
                    self._record_model_retry(handle, exc, retry_number=model_retry_attempts)
                    await self._discard_session_for_retry(handle)
                    handle.state = AttemptState.RUNNING
                    handle.finished_at = None
                    continue
                if _is_exhausted_model_retry_error(request, exc, model_retry_attempts, emitted_raw_events):
                    exc = _model_retry_exhausted_error(request, exc, model_retry_attempts)
                yield self._failed_event_from_exception(handle, exc)
                return

    def _should_retry_model_request(
        self,
        request: PydanticAIRunRequest,
        exc: AdapterRuntimeError,
        *,
        model_retry_attempts: int,
        emitted_raw_events: int,
    ) -> bool:
        return (
            _is_model_retry_candidate(exc)
            and emitted_raw_events == 0
            and model_retry_attempts < request.retry_policy.model_retries
        )

    def _record_model_retry(self, handle: AttemptHandle, exc: AdapterRuntimeError, *, retry_number: int) -> None:
        cw_metadata = handle.metadata.setdefault("cw", {})
        if not isinstance(cw_metadata, dict):
            return
        retries = cw_metadata.setdefault("pydantic_ai_model_retries", [])
        if not isinstance(retries, list):
            return
        payload = exc.adapter_error.payload or {}
        retries.append(
            {
                "retry_number": retry_number,
                "error_code": exc.error_code,
                "exception_type": payload.get("exception_type"),
                "message": payload.get("message"),
            }
        )

    async def _discard_session_for_retry(self, handle: AttemptHandle) -> None:
        session = self._sessions.pop(handle.handle_id, None)
        if session is None:
            return
        with suppress(Exception):
            await session.aclose()

    async def resume(
        self,
        handle: AttemptHandle,
        resumption: AttemptResumption,
    ) -> AsyncIterator[StreamEventBase]:
        self._ensure_known_handle(handle)
        if handle.state != AttemptState.AWAITING_HUMAN:
            raise AdapterRuntimeError(
                "AA_RESUME_INVALID_KIND",
                f"Cannot resume handle in state {handle.state.value}.",
                payload={"handle_id": handle.handle_id, "state": handle.state.value},
            )
        if resumption.kind not in {ResumptionKind.DEFERRED_TOOL, ResumptionKind.HUMAN_DECISION}:
            raise AdapterRuntimeError(
                "AA_RESUME_INVALID_KIND",
                "PydanticAIAdapter supports only deferred_tool or human_decision resumption.",
                payload={"handle_id": handle.handle_id, "kind": resumption.kind.value},
            )

        handle.state = AttemptState.RUNNING
        if resumption.kind == ResumptionKind.HUMAN_DECISION and resumption.human_decision is not None:
            yield self._human_event(
                handle,
                event_type="human.gate_resolved",
                title="Human gate resolved",
                payload=_human_resolved_payload(handle, resumption),
                decision_key=resumption.human_decision.key,
                user_id=resumption.human_decision.by,
            )

        try:
            session = self._session_for(handle)
            request = PydanticAIResumeRequest(
                handle_id=handle.handle_id,
                run_id=handle.run_id,
                node_id=handle.node_id,
                attempt_id=handle.attempt_id,
                resumption=resumption,
                deferred_tool_results=_deferred_tool_results_from_resumption(handle, resumption),
            )
            async for raw_event in self._iterate_session(
                handle,
                session,
                session.resume(request),
                timeout_seconds=self._packs[handle.handle_id].retry_policy.timeout_seconds,
                operation="resume",
            ):
                for event in self._translate_raw_event(handle, raw_event):
                    yield event
                if handle.state in {AttemptState.AWAITING_HUMAN, AttemptState.COMPLETED, AttemptState.FAILED}:
                    return
            if handle.state == AttemptState.RUNNING:
                yield self._unterminated_session_event(handle, operation="resume")
        except AdapterRuntimeError as exc:
            yield self._failed_event_from_exception(handle, exc)

    async def cancel(self, handle: AttemptHandle, reason: CancelReason = CancelReason.USER) -> None:
        self._ensure_known_handle(handle)
        handle.cancellation_requested = True
        self._cancel_reasons[handle.handle_id] = reason
        self._cancel_event_for(handle).set()
        handle.state = AttemptState.CANCELLED
        handle.finished_at = utc_now_ms()
        self._errors[handle.handle_id] = [
            build_adapter_error(
                "AA_RUN_CANCELLED",
                f"Pydantic AI attempt cancelled: {reason.value}",
                retryable=False,
                payload={"reason": reason.value},
            )
        ]
        session = self._sessions.get(handle.handle_id)
        if session is not None:
            await self._notify_session_cancel(
                session,
                handle.handle_id,
                reason,
                operation="cancel",
            )

    async def finalize(self, handle: AttemptHandle) -> AttemptOutcome:
        self._ensure_known_handle(handle)
        if handle.state not in {AttemptState.COMPLETED, AttemptState.FAILED, AttemptState.CANCELLED}:
            raise AdapterRuntimeError(
                "AA_FINALIZE_NO_RESULT",
                f"Cannot finalize non-terminal handle in state {handle.state.value}.",
                payload={"handle_id": handle.handle_id, "state": handle.state.value},
            )

        pack = self._packs[handle.handle_id]
        output = self._outputs.get(handle.handle_id)
        errors = self._errors.get(handle.handle_id, [])
        usage = self._usage.get(handle.handle_id)
        messages = self._messages.get(handle.handle_id)
        finished_at = handle.finished_at or utc_now_ms()
        output_hash = _stable_hash(output)
        outcome_hash = _stable_hash(
            {
                "state": handle.state.value,
                "output_hash": output_hash,
                "errors": [error.model_dump(mode="json") for error in errors],
            }
        )
        return AttemptOutcome(
            attempt_id=handle.attempt_id,
            run_id=handle.run_id,
            node_id=handle.node_id,
            state=handle.state,
            output=output,
            output_hash=output_hash,
            output_artifact_refs=[],
            usage=usage,
            messages=messages,
            errors=errors,
            started_at=handle.started_at or handle.prepared_at,
            finished_at=finished_at,
            duration_ms=0,
            provenance=AttemptProvenance(
                adapter_id=self.adapter_id,
                adapter_version=self.adapter_version,
                model_profile_id=pack.effective_model_profile_id,
                model_settings_hash=_stable_hash(pack.effective_model_settings),
                tools_used=[],
                evidence_pack_id=None if pack.evidence_pack is None else pack.evidence_pack.pack_id,
                context_pack_id=pack.context_pack.pack_id,
                pydantic_ai_traceparent=_traceparent_for(handle),
                outcome_hash=outcome_hash,
            ),
        )

    async def aclose(self) -> None:
        for session in list(self._sessions.values()):
            await session.aclose()
        self._sessions.clear()
        self._cancel_events.clear()
        self._cancel_reasons.clear()

    @classmethod
    def descriptor(cls) -> AdapterDescriptor:
        adapter = cls()
        return AdapterDescriptor(
            adapter_id=cls._ADAPTER_ID,
            adapter_version=cls._ADAPTER_VERSION,
            display_name="Pydantic AI",
            description="Pydantic AI adapter foundation for structured model execution.",
            documentation_url=None,
            capabilities=adapter.capabilities(),
            default_config=AdapterConfig(adapter_id=cls._ADAPTER_ID),
            auth_required=True,
            homepage="https://ai.pydantic.dev/",
        )

    def _ensure_known_handle(self, handle: AttemptHandle) -> None:
        if handle.handle_id not in self._packs:
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "Unknown PydanticAIAdapter handle.",
                payload={"handle_id": handle.handle_id},
            )

    def _session_for(self, handle: AttemptHandle) -> PydanticAISession:
        session = self._sessions.get(handle.handle_id)
        if session is not None:
            return session
        session = (
            PydanticAISDKSession(toolset_factory=self._toolset_factory)
            if self._session_factory is None
            else self._session_factory()
        )
        self._sessions[handle.handle_id] = session
        return session

    def _run_request(self, handle: AttemptHandle) -> PydanticAIRunRequest:
        pack = self._packs[handle.handle_id]
        prompt = pack.node_contract_snapshot.prompt
        system_prompt = None if prompt is None else _prompt_text(prompt.system_prompt)
        instructions = [] if prompt is None else _prompt_list(prompt.instructions)
        return PydanticAIRunRequest(
            handle_id=handle.handle_id,
            run_id=handle.run_id,
            node_id=handle.node_id,
            attempt_id=handle.attempt_id,
            execution_pack_id=pack.pack_id,
            model_profile_id=pack.effective_model_profile_id,
            system_prompt=system_prompt,
            instructions=instructions,
            user_prompt=_render_user_prompt(pack),
            output_schema=dict(pack.node_contract_snapshot.output_schema),
            model_settings=dict(pack.effective_model_settings),
            usage_limits={}
            if pack.usage_limits is None
            else pack.usage_limits.model_dump(mode="json", exclude_none=True),
            toolsets=_toolset_request(pack),
            retry_policy=PydanticAIRetryPolicy(
                model_retries=pack.retry_policy.model_retries,
                model_retries_explicit="model_retries" in pack.retry_policy.model_fields_set,
                output_validation_retries=pack.retry_policy.output_validation_retries,
                tool_retries=pack.retry_policy.tool_retries,
                timeout_seconds=pack.retry_policy.timeout_seconds,
            ),
            correlation_id=pack.correlation_id,
        )

    async def _iterate_session(
        self,
        handle: AttemptHandle,
        session: PydanticAISession,
        events: AsyncIterator[RawPydanticAIEvent],
        *,
        timeout_seconds: int | None,
        operation: Literal["run", "resume"],
    ) -> AsyncIterator[RawPydanticAIEvent]:
        try:
            async for event in self._events_until_control(
                handle,
                events,
                timeout_seconds=timeout_seconds,
            ):
                if handle.cancellation_requested:
                    reason = self._cancel_reasons.get(handle.handle_id, CancelReason.USER)
                    raise _AttemptCancelled(reason)
                yield event
        except _AttemptCancelled as exc:
            raise AdapterRuntimeError(
                "AA_RUN_CANCELLED",
                f"Pydantic AI attempt cancelled: {exc.reason.value}",
                payload={
                    "handle_id": handle.handle_id,
                    "operation": operation,
                    "reason": exc.reason.value,
                },
            ) from exc
        except _AttemptTimeoutExpired as exc:
            await self._cancel_timed_out_session(
                handle,
                session,
                timeout_seconds=timeout_seconds,
                operation=operation,
            )
            raise AdapterRuntimeError(
                "AA_RUN_CANCELLED",
                "Pydantic AI attempt exceeded retry_policy.timeout_seconds.",
                payload={
                    "handle_id": handle.handle_id,
                    "operation": operation,
                    "reason": CancelReason.IDLE_TIMEOUT.value,
                    "timeout_seconds": timeout_seconds,
                },
            ) from exc
        except AdapterRuntimeError:
            raise
        except Exception as exc:
            retryable_model_exception = _is_retryable_model_exception(exc)
            if _is_usage_limit_exceeded(exc):
                error_code: AgentAdapterErrorCode = "AA_RUN_USAGE_LIMIT"
                message = "Pydantic AI session exceeded configured usage limits."
            elif retryable_model_exception or _is_http_status_model_exception(exc):
                error_code = "AA_RUN_STREAM_INTERRUPTED"
                message = "Pydantic AI session model request failed."
            else:
                error_code = "AA_RUN_INTERNAL"
                message = "Pydantic AI session raised an internal exception."
            status_code = _http_status_code(exc)
            raise AdapterRuntimeError(
                error_code,
                message,
                retryable=retryable_model_exception,
                http_status=status_code,
                payload={
                    "exception_type": type(exc).__name__,
                    "message": str(exc),
                    "retryable_model_exception": retryable_model_exception,
                    **({} if status_code is None else {"status_code": status_code}),
                },
            ) from exc

    async def _events_until_control(
        self,
        handle: AttemptHandle,
        events: AsyncIterator[RawPydanticAIEvent],
        *,
        timeout_seconds: int | None,
    ) -> AsyncIterator[RawPydanticAIEvent]:
        loop = asyncio.get_running_loop()
        deadline = None if timeout_seconds is None else loop.time() + timeout_seconds
        cancel_event = self._cancel_event_for(handle)
        iterator = events.__aiter__()
        while True:
            if handle.cancellation_requested or cancel_event.is_set():
                raise _AttemptCancelled(self._cancel_reasons.get(handle.handle_id, CancelReason.USER))
            remaining = None if deadline is None else deadline - loop.time()
            if remaining is not None and remaining <= 0:
                raise _AttemptTimeoutExpired
            event_task: asyncio.Future[RawPydanticAIEvent] = asyncio.ensure_future(iterator.__anext__())
            cancel_task: asyncio.Future[bool] = asyncio.ensure_future(cancel_event.wait())
            try:
                tasks: set[asyncio.Future[Any]] = {event_task, cancel_task}
                done, _pending = await asyncio.wait(tasks, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
                if not done:
                    await _cancel_future(event_task)
                    await _cancel_future(cancel_task)
                    raise _AttemptTimeoutExpired
                if cancel_task in done:
                    await _cancel_future(event_task)
                    raise _AttemptCancelled(self._cancel_reasons.get(handle.handle_id, CancelReason.USER))
                await _cancel_future(cancel_task)
                event = event_task.result()
            except StopAsyncIteration:
                return
            yield event

    async def _cancel_timed_out_session(
        self,
        handle: AttemptHandle,
        session: PydanticAISession,
        *,
        timeout_seconds: int | None,
        operation: Literal["run", "resume"],
    ) -> None:
        handle.cancellation_requested = True
        handle.state = AttemptState.CANCELLED
        handle.finished_at = utc_now_ms()
        self._cancel_reasons[handle.handle_id] = CancelReason.IDLE_TIMEOUT
        self._cancel_event_for(handle).set()
        error = await self._notify_session_cancel(
            session,
            handle.handle_id,
            CancelReason.IDLE_TIMEOUT,
            operation=operation,
        )
        if error is not None:
            handle.metadata["pydantic_ai_timeout_cancel_error"] = {
                "operation": operation,
                "timeout_seconds": timeout_seconds,
                **error,
            }

    def _cancel_event_for(self, handle: AttemptHandle) -> asyncio.Event:
        event = self._cancel_events.get(handle.handle_id)
        if event is None:
            event = asyncio.Event()
            if handle.cancellation_requested:
                event.set()
            self._cancel_events[handle.handle_id] = event
        return event

    async def _notify_session_cancel(
        self,
        session: PydanticAISession,
        handle_id: str,
        reason: CancelReason,
        *,
        operation: Literal["run", "resume", "cancel"],
    ) -> dict[str, str] | None:
        try:
            await session.cancel(handle_id, reason)
        except Exception as exc:  # pragma: no cover - defensive payload only.
            return {
                "operation": operation,
                "exception_type": type(exc).__name__,
                "message": str(exc),
            }
        return None

    def _translate_raw_event(self, handle: AttemptHandle, raw_event: RawPydanticAIEvent) -> list[StreamEventBase]:
        event_type = _required_str(raw_event, "type")
        if event_type == "text_delta":
            payload: dict[str, Any] = {"delta_text": _optional_str(raw_event, "text") or ""}
            if _bool_value(raw_event.get("start")):
                payload["start"] = True
            return [
                self._model_event(
                    handle,
                    event_type="model.text_delta",
                    phase=EventPhase.ATTEMPT_STREAMING,
                    title="Pydantic AI text delta",
                    payload=payload,
                )
            ]
        if event_type == "thinking_delta":
            payload = {"delta_text": _optional_str(raw_event, "text") or ""}
            if _bool_value(raw_event.get("start")):
                payload["start"] = True
            return [
                self._model_event(
                    handle,
                    event_type="model.thinking_delta",
                    phase=EventPhase.ATTEMPT_STREAMING,
                    title="Pydantic AI thinking delta",
                    payload=payload,
                )
            ]
        if event_type == "text_completed":
            return [
                self._model_event(
                    handle,
                    event_type="model.text_completed",
                    phase=EventPhase.ATTEMPT_STREAMING,
                    title="Pydantic AI text completed",
                    payload={"text": _optional_str(raw_event, "text") or "", "role": "assistant"},
                )
            ]
        if event_type == "thought_completed":
            return [
                self._model_event(
                    handle,
                    event_type="model.thought_completed",
                    phase=EventPhase.ATTEMPT_STREAMING,
                    title="Pydantic AI thought completed",
                    payload={"summary": _optional_str(raw_event, "summary") or ""},
                )
            ]
        if event_type == "tool_call_started":
            tool_id = _optional_str(raw_event, "tool_id") or "unknown"
            args = _mapping_or_empty(raw_event.get("args"))
            return [
                self._tool_event(
                    handle,
                    event_type="tool.call_started",
                    title="Pydantic AI tool call started",
                    payload={
                        "tool_id": tool_id,
                        "args": args,
                        "args_hash": _optional_str(raw_event, "args_hash") or _stable_hash(args),
                        "requires_approval": _bool_value(raw_event.get("requires_approval")),
                    },
                    tool_id=tool_id,
                    invocation_id=_optional_str(raw_event, "invocation_id"),
                )
            ]
        if event_type == "tool_call_completed":
            tool_id = _optional_str(raw_event, "tool_id") or "unknown"
            return [
                self._tool_event(
                    handle,
                    event_type="tool.call_completed",
                    title="Pydantic AI tool call completed",
                    payload={
                        "result_summary": _optional_str(raw_event, "result_summary") or "",
                        "duration_ms": _int_value(raw_event.get("duration_ms")),
                        "output_artifact_refs": _list_of_mappings(raw_event.get("output_artifact_refs")),
                    },
                    tool_id=tool_id,
                    invocation_id=_optional_str(raw_event, "invocation_id"),
                )
            ]
        if event_type == "tool_call_failed":
            tool_id = _optional_str(raw_event, "tool_id") or "unknown"
            return [
                self._tool_event(
                    handle,
                    event_type="tool.call_failed",
                    title="Pydantic AI tool call failed",
                    payload={
                        "error_kind": _optional_str(raw_event, "error_kind") or "tool_failed",
                        "message": _optional_str(raw_event, "message") or "",
                        "retryable": _bool_value(raw_event.get("retryable")),
                    },
                    tool_id=tool_id,
                    invocation_id=_optional_str(raw_event, "invocation_id"),
                )
            ]
        if event_type == "approval_required":
            handle.state = AttemptState.AWAITING_HUMAN
            tool_id = _optional_str(raw_event, "tool_id") or "pydantic_ai.approval"
            args = _mapping_or_empty(raw_event.get("args"))
            approval_event = self._tool_event(
                handle,
                event_type="tool.approval_required",
                title="Pydantic AI approval required",
                payload={"tool_id": tool_id, "args_hash": _optional_str(raw_event, "args_hash") or _stable_hash(args)},
                tool_id=tool_id,
                invocation_id=_optional_str(raw_event, "invocation_id"),
                display_level=DisplayLevel.DETAILED,
            )
            decisions = _decisions(raw_event)
            human_payload: dict[str, Any] = {
                "human_node_id": handle.node_id,
                "prompt_to_user": _optional_str(raw_event, "prompt") or "",
                "decisions": decisions,
            }
            timeout_seconds = _int_or_none(raw_event.get("timeout_seconds"))
            if timeout_seconds is not None:
                human_payload["timeout_seconds"] = timeout_seconds
            human_event = self._human_event(
                handle,
                event_type="human.gate_required",
                title="Pydantic AI approval required",
                payload=human_payload,
                decision_key=_first_decision_key(decisions),
                user_id=None,
                parent_event_id=approval_event.event_id,
            )
            return [approval_event, human_event]
        if event_type == "deferred_tool_requests":
            return self._deferred_tool_request_events(handle, raw_event)
        if event_type == "request_completed":
            return [
                self._model_event(
                    handle,
                    event_type="model.request_completed",
                    phase=EventPhase.ATTEMPT_VALIDATING,
                    title="Pydantic AI request completed",
                    payload={
                        "usage": _mapping_or_empty(raw_event.get("usage")),
                        "finish_reason": _optional_str(raw_event, "finish_reason") or "unknown",
                        "latency_ms": _int_value(raw_event.get("latency_ms")),
                    },
                )
            ]
        if event_type == "completed":
            return self._complete_attempt(handle, raw_event)
        if event_type == "failed":
            return self._fail_attempt(
                handle,
                "AA_RUN_INTERNAL",
                _optional_str(raw_event, "message") or "Pydantic AI attempt failed.",
                retryable=False,
            )
        return self._fail_attempt(
            handle,
            "AA_RUN_INTERNAL",
            f"Unknown Pydantic AI event type: {event_type}",
            retryable=False,
        )

    def _deferred_tool_request_events(
        self,
        handle: AttemptHandle,
        raw_event: RawPydanticAIEvent,
    ) -> list[StreamEventBase]:
        calls = _list_of_mappings(raw_event.get("calls"))
        approvals = _list_of_mappings(raw_event.get("approvals"))
        metadata = _metadata_by_tool_call_id(raw_event.get("metadata"))
        if not calls and not approvals:
            return self._fail_attempt(
                handle,
                "AA_RUN_INTERNAL",
                "Pydantic AI deferred tool request did not include calls or approvals.",
                retryable=False,
            )

        handle.state = AttemptState.AWAITING_HUMAN
        handle.metadata["pydantic_ai_deferred_tool_requests"] = {
            "calls": calls,
            "approvals": approvals,
            "metadata": metadata,
        }
        events: list[StreamEventBase] = []
        for call in calls:
            tool_id = _request_tool_id(call)
            args = _mapping_or_empty(call.get("args"))
            events.append(
                self._tool_event(
                    handle,
                    event_type="tool.call_started",
                    title="Pydantic AI deferred tool call requested",
                    payload={
                        "tool_id": tool_id,
                        "args": args,
                        "args_hash": _optional_str(call, "args_hash") or _stable_hash(args),
                        "requires_approval": False,
                        "deferred": True,
                    },
                    tool_id=tool_id,
                    invocation_id=_optional_str(call, "invocation_id"),
                )
            )
        for approval in approvals:
            tool_id = _request_tool_id(approval)
            args = _mapping_or_empty(approval.get("args"))
            events.append(
                self._tool_event(
                    handle,
                    event_type="tool.approval_required",
                    title="Pydantic AI deferred tool approval required",
                    payload={
                        "tool_id": tool_id,
                        "args_hash": _optional_str(approval, "args_hash") or _stable_hash(args),
                        "deferred": True,
                    },
                    tool_id=tool_id,
                    invocation_id=_optional_str(approval, "invocation_id"),
                    display_level=DisplayLevel.DETAILED,
                )
            )

        decisions = _deferred_decisions(calls, approvals)
        human_payload: dict[str, Any] = {
            "human_node_id": handle.node_id,
            "prompt_to_user": _optional_str(raw_event, "prompt")
            or "Provide results for deferred Pydantic AI tool requests.",
            "decisions": decisions,
        }
        if calls:
            human_payload["deferred_tool_calls"] = calls
        if approvals:
            human_payload["deferred_tool_approvals"] = approvals
        if metadata:
            human_payload["metadata"] = metadata
        events.append(
            self._human_event(
                handle,
                event_type="human.gate_required",
                title="Pydantic AI deferred tool results required",
                payload=human_payload,
                decision_key=_first_decision_key(decisions),
                user_id=None,
                parent_event_id=None if not events else events[0].event_id,
            )
        )
        return events

    def _complete_attempt(self, handle: AttemptHandle, raw_event: RawPydanticAIEvent) -> list[StreamEventBase]:
        output = _dict_or_empty(raw_event.get("output"))
        error = self._validate_output(handle, output)
        if error is not None:
            self._errors[handle.handle_id] = [error]
            handle.state = AttemptState.FAILED
            handle.finished_at = utc_now_ms()
            return [
                self._lifecycle_event(
                    handle,
                    event_type="attempt.failed",
                    phase=EventPhase.ATTEMPT_FAILED,
                    title="Pydantic AI attempt failed",
                    payload=_attempt_failed_payload(error, self._packs[handle.handle_id]),
                )
            ]

        self._outputs[handle.handle_id] = output
        usage = _usage_from_raw(raw_event)
        if usage is not None:
            self._usage[handle.handle_id] = usage
        messages = _messages_from_raw(raw_event)
        if messages is not None:
            self._messages[handle.handle_id] = messages
        traceparent = _optional_str(raw_event, "pydantic_ai_traceparent")
        if traceparent is not None:
            handle.metadata["pydantic_ai_traceparent"] = traceparent
        handle.state = AttemptState.COMPLETED
        handle.finished_at = utc_now_ms()
        payload_usage = usage or RunUsage()
        return [
            self._lifecycle_event(
                handle,
                event_type="attempt.completed",
                phase=EventPhase.ATTEMPT_COMPLETED,
                title="Pydantic AI attempt completed",
                payload={
                    "output_hash": _stable_hash(output),
                    "duration_ms": 0,
                    "usage": payload_usage.model_dump(mode="json"),
                },
            )
        ]

    def _fail_attempt(
        self,
        handle: AttemptHandle,
        error_code: AgentAdapterErrorCode,
        message: str,
        *,
        retryable: bool,
    ) -> list[StreamEventBase]:
        error = build_adapter_error(error_code, message, retryable=retryable)
        self._errors[handle.handle_id] = [error]
        handle.state = AttemptState.FAILED
        handle.finished_at = utc_now_ms()
        return [
            self._lifecycle_event(
                handle,
                event_type="attempt.failed",
                phase=EventPhase.ATTEMPT_FAILED,
                title="Pydantic AI attempt failed",
                payload=_attempt_failed_payload(error, self._packs[handle.handle_id]),
            )
        ]

    def _validate_output(self, handle: AttemptHandle, output: dict[str, Any]) -> AdapterError | None:
        schema = self._packs[handle.handle_id].node_contract_snapshot.output_schema
        if not schema:
            return None
        schema_type = schema.get("type")
        if schema_type not in {None, "object"}:
            return build_adapter_error(
                "AA_RUN_OUTPUT_VALIDATION_FAILED",
                "Pydantic AI output validation supports only object schemas in this foundation.",
                retryable=False,
                payload={"schema_type": schema_type},
            )
        required = schema.get("required", [])
        if isinstance(required, list):
            missing = [key for key in required if isinstance(key, str) and key not in output]
            if missing:
                return build_adapter_error(
                    "AA_RUN_OUTPUT_VALIDATION_FAILED",
                    "Pydantic AI output is missing required fields.",
                    retryable=False,
                    payload={"missing": missing},
                )
        properties = schema.get("properties", {})
        if isinstance(properties, Mapping):
            for key, raw_property_schema in properties.items():
                if not isinstance(key, str) or key not in output or not isinstance(raw_property_schema, Mapping):
                    continue
                expected_type = raw_property_schema.get("type")
                if isinstance(expected_type, str) and not _matches_json_schema_type(output[key], expected_type):
                    return build_adapter_error(
                        "AA_RUN_OUTPUT_VALIDATION_FAILED",
                        "Pydantic AI output field has the wrong JSON type.",
                        retryable=False,
                        payload={"field": key, "expected_type": expected_type},
                    )
        return None

    def _failed_event_from_exception(self, handle: AttemptHandle, exc: AdapterRuntimeError) -> LifecycleEvent:
        self._errors[handle.handle_id] = [exc.adapter_error]
        handle.state = AttemptState.CANCELLED if exc.error_code == "AA_RUN_CANCELLED" else AttemptState.FAILED
        handle.finished_at = utc_now_ms()
        return self._lifecycle_event(
            handle,
            event_type="attempt.failed",
            phase=EventPhase.ATTEMPT_FAILED,
            title="Pydantic AI attempt failed",
            payload=_attempt_failed_payload(exc.adapter_error, self._packs[handle.handle_id]),
        )

    def _unterminated_session_event(
        self,
        handle: AttemptHandle,
        *,
        operation: Literal["run", "resume"],
    ) -> LifecycleEvent:
        error = build_adapter_error(
            "AA_RUN_INTERNAL",
            "Pydantic AI session ended without a terminal attempt event.",
            retryable=False,
            payload={"handle_id": handle.handle_id, "operation": operation},
        )
        self._errors[handle.handle_id] = [error]
        handle.state = AttemptState.FAILED
        handle.finished_at = utc_now_ms()
        return self._lifecycle_event(
            handle,
            event_type="attempt.failed",
            phase=EventPhase.ATTEMPT_FAILED,
            title="Pydantic AI attempt failed",
            payload=_attempt_failed_payload(error, self._packs[handle.handle_id]),
        )

    def _lifecycle_event(
        self,
        handle: AttemptHandle,
        *,
        event_type: Literal["attempt.started", "attempt.completed", "attempt.failed"],
        phase: EventPhase,
        title: str,
        payload: dict[str, Any],
    ) -> LifecycleEvent:
        return LifecycleEvent(
            event_id=new_runtime_id(),
            seq=self._next_seq(handle),
            run_id=handle.run_id,
            node_id=handle.node_id,
            attempt_id=handle.attempt_id,
            type=event_type,
            phase=phase,
            title=title,
            summary=None,
            content=None,
            payload=payload,
            display_level=DisplayLevel.DEFAULT,
            severity=StreamSeverity.INFO,
            sensitivity=Sensitivity.PROJECT,
            expandable=True,
            created_at=utc_now_ms(),
        )

    def _model_event(
        self,
        handle: AttemptHandle,
        *,
        event_type: Literal[
            "model.thinking_delta",
            "model.thought_completed",
            "model.text_delta",
            "model.text_completed",
            "model.request_completed",
        ],
        phase: EventPhase,
        title: str,
        payload: dict[str, Any],
    ) -> ModelEvent:
        return ModelEvent(
            event_id=new_runtime_id(),
            seq=self._next_seq(handle),
            run_id=handle.run_id,
            node_id=handle.node_id,
            attempt_id=handle.attempt_id,
            type=event_type,
            phase=phase,
            title=title,
            summary=None,
            content=None,
            payload=payload,
            display_level=DisplayLevel.DEFAULT,
            severity=StreamSeverity.INFO,
            sensitivity=Sensitivity.PROJECT,
            expandable=True,
            created_at=utc_now_ms(),
            model_profile_id=self._packs[handle.handle_id].effective_model_profile_id,
        )

    def _tool_event(
        self,
        handle: AttemptHandle,
        *,
        event_type: Literal["tool.call_started", "tool.call_completed", "tool.call_failed", "tool.approval_required"],
        title: str,
        payload: dict[str, Any],
        tool_id: str,
        invocation_id: str | None,
        display_level: DisplayLevel = DisplayLevel.DEFAULT,
    ) -> ToolEvent:
        return ToolEvent(
            event_id=new_runtime_id(),
            seq=self._next_seq(handle),
            run_id=handle.run_id,
            node_id=handle.node_id,
            attempt_id=handle.attempt_id,
            type=event_type,
            phase=EventPhase.ATTEMPT_TOOL_CALLING,
            title=title,
            summary=None,
            content=None,
            payload=payload,
            display_level=display_level,
            severity=StreamSeverity.INFO,
            sensitivity=Sensitivity.PROJECT,
            expandable=True,
            created_at=utc_now_ms(),
            tool_id=tool_id,
            invocation_id=invocation_id,
        )

    def _human_event(
        self,
        handle: AttemptHandle,
        *,
        event_type: Literal["human.gate_required", "human.gate_resolved"],
        title: str,
        payload: dict[str, Any],
        decision_key: str,
        user_id: str | None,
        parent_event_id: str | None = None,
    ) -> HumanEvent:
        return HumanEvent(
            event_id=new_runtime_id(),
            seq=self._next_seq(handle),
            parent_event_id=parent_event_id,
            run_id=handle.run_id,
            node_id=handle.node_id,
            attempt_id=handle.attempt_id,
            type=event_type,
            phase=EventPhase.NODE_WAITING_USER if event_type == "human.gate_required" else EventPhase.RUN_RESUMED,
            title=title,
            summary=None,
            content=None,
            payload=payload,
            display_level=DisplayLevel.DEFAULT,
            severity=StreamSeverity.INFO,
            sensitivity=Sensitivity.PROJECT,
            expandable=True,
            created_at=utc_now_ms(),
            human_node_id=handle.node_id,
            decision_key=decision_key,
            user_id=user_id,
        )

    def _next_seq(self, handle: AttemptHandle) -> int:
        current = self._stream_seq.get(handle.handle_id, 0)
        self._stream_seq[handle.handle_id] = current + 1
        return current


def build_pydantic_ai_descriptor() -> AdapterDescriptor:
    return PydanticAIAdapter.descriptor()


def _render_user_prompt(pack: ExecutionPack) -> str:
    prompt = pack.node_contract_snapshot.prompt
    parts: list[str] = []
    if prompt is not None:
        parts.append(prompt.user_prompt_template)
    fragment_texts = [fragment.text for fragment in pack.context_pack.fragments if fragment.text]
    if fragment_texts:
        parts.append("Context:\n" + "\n\n".join(fragment_texts))
    if not parts:
        parts.append(pack.node_contract_snapshot.goal)
    return "\n\n".join(parts)


def _prompt_list(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return list(value)


def _prompt_text(value: str | list[str] | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return "\n".join(value)


def _toolset_request(pack: ExecutionPack) -> PydanticAIToolsetRequest:
    contract = pack.node_contract_snapshot
    builtin_tools = _unique_strings([*pack.effective_toolsets.builtin_tools, *contract.allowed_tools])
    skill_ids_resolved = list(pack.effective_toolsets.skill_ids_resolved)
    if not skill_ids_resolved:
        skill_ids_resolved = _unique_strings([f"{skill.skill_id}@{skill.version}" for skill in contract.skills])
    mcp_tools = [
        PydanticAIMCPToolRequest(
            server_id=tool.server_id,
            tool_name=tool.tool_name,
            requires_approval=tool.requires_approval,
        )
        for tool in contract.mcp_tools
    ]
    if not mcp_tools:
        mcp_tools = [
            PydanticAIMCPToolRequest(server_id=server_id) for server_id in pack.effective_toolsets.mcp_server_ids
        ]
    return PydanticAIToolsetRequest(
        builtin_tools=builtin_tools,
        skill_ids_resolved=_unique_strings(skill_ids_resolved),
        mcp_tools=mcp_tools,
    )


def _build_sdk_agent(
    sdk: ModuleType,
    request: PydanticAIRunRequest,
    toolset_factory: PydanticAIToolsetFactory | None,
) -> Any:
    agent_cls = getattr(sdk, "Agent", None)
    structured_dict = getattr(sdk, "StructuredDict", None)
    if not callable(agent_cls) or not callable(structured_dict):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "pydantic_ai module does not expose Agent and StructuredDict.",
            payload={"module": "pydantic_ai"},
        )

    output_schema = request.output_schema or {"type": "object", "additionalProperties": True}
    output_type: object = structured_dict(
        _jsonable_mapping(output_schema),
        name=f"{request.node_id}_output",
        description=f"CW output for node {request.node_id}",
    )
    has_toolset_request = _has_toolset_request(request.toolsets)
    if has_toolset_request:
        deferred_tool_requests_cls = getattr(sdk, "DeferredToolRequests", None)
        if deferred_tool_requests_cls is None:
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "pydantic_ai module does not expose DeferredToolRequests.",
                payload={"module": "pydantic_ai"},
            )
        output_type = [output_type, deferred_tool_requests_cls]
    kwargs: dict[str, Any] = {
        "output_type": output_type,
        "defer_model_check": True,
        "metadata": {
            "cw": {
                "handle_id": request.handle_id,
                "run_id": request.run_id,
                "node_id": request.node_id,
                "attempt_id": request.attempt_id,
                "execution_pack_id": request.execution_pack_id,
                "correlation_id": request.correlation_id,
            }
        },
    }
    if request.system_prompt is not None:
        kwargs["system_prompt"] = request.system_prompt
    if request.instructions:
        kwargs["instructions"] = request.instructions
    if request.model_settings:
        kwargs["model_settings"] = request.model_settings
    toolsets = _sdk_toolsets(sdk, request.toolsets, toolset_factory)
    if toolsets:
        kwargs["toolsets"] = toolsets
    kwargs["retries"] = _sdk_agent_retries(request.retry_policy)
    return agent_cls(request.model_profile_id, **kwargs)


def _sdk_agent_retries(retry_policy: PydanticAIRetryPolicy) -> dict[str, int]:
    if isinstance(retry_policy.tool_retries, Mapping):
        raise AdapterRuntimeError(
            "AA_PREPARE_INCOMPATIBLE_ADAPTER",
            "Pydantic AI SDK AgentRetries cannot enforce per-tool retry budgets.",
            payload={"tool_retries": dict(retry_policy.tool_retries)},
        )
    return {
        "tools": retry_policy.tool_retries,
        "output": retry_policy.output_validation_retries,
    }


def _sdk_toolsets(
    sdk: ModuleType,
    toolset_request: PydanticAIToolsetRequest,
    toolset_factory: PydanticAIToolsetFactory | None,
) -> list[object]:
    if not _has_toolset_request(toolset_request):
        return []
    if toolset_factory is None:
        raise AdapterRuntimeError(
            "AA_RUN_TOOL_NOT_FOUND",
            "Pydantic AI toolsets were requested, but no toolset factory is configured.",
            payload={"toolsets": toolset_request.model_dump(mode="json")},
        )

    try:
        bundle = toolset_factory(sdk, toolset_request)
    except AdapterRuntimeError:
        raise
    except Exception as exc:
        raise AdapterRuntimeError(
            "AA_RUN_TOOL_NOT_FOUND",
            "Pydantic AI toolset factory failed while resolving requested toolsets.",
            payload={
                "exception_type": type(exc).__name__,
                "message": str(exc),
                "toolsets": toolset_request.model_dump(mode="json"),
            },
        ) from exc
    function_toolsets = list(bundle.function_toolsets)
    mcp_toolsets_by_server = {mcp_toolset.server_id: mcp_toolset.toolset for mcp_toolset in bundle.mcp_toolsets}
    if (toolset_request.builtin_tools or toolset_request.skill_ids_resolved) and not function_toolsets:
        raise AdapterRuntimeError(
            "AA_RUN_TOOL_NOT_FOUND",
            "Pydantic AI toolset factory did not resolve requested builtin tools or skills.",
            payload={
                "builtin_tools": toolset_request.builtin_tools,
                "skill_ids_resolved": toolset_request.skill_ids_resolved,
            },
        )
    requested_mcp_server_ids = {tool.server_id for tool in toolset_request.mcp_tools}
    missing_mcp_server_ids = sorted(requested_mcp_server_ids - set(mcp_toolsets_by_server))
    if missing_mcp_server_ids:
        raise AdapterRuntimeError(
            "AA_RUN_TOOL_NOT_FOUND",
            "Pydantic AI toolset factory did not resolve requested MCP servers.",
            payload={
                "missing_mcp_server_ids": missing_mcp_server_ids,
                "mcp_tools": [tool.model_dump(mode="json") for tool in toolset_request.mcp_tools],
            },
        )
    unexpected_mcp_server_ids = sorted(set(mcp_toolsets_by_server) - requested_mcp_server_ids)
    if unexpected_mcp_server_ids:
        raise AdapterRuntimeError(
            "AA_RUN_TOOL_NOT_FOUND",
            "Pydantic AI toolset factory returned unrequested MCP servers.",
            payload={
                "unexpected_mcp_server_ids": unexpected_mcp_server_ids,
                "mcp_tools": [tool.model_dump(mode="json") for tool in toolset_request.mcp_tools],
            },
        )

    mcp_toolsets = _approval_wrapped_mcp_toolsets(sdk, toolset_request.mcp_tools, mcp_toolsets_by_server)
    return [*function_toolsets, *mcp_toolsets]


def _has_toolset_request(toolset_request: PydanticAIToolsetRequest) -> bool:
    return bool(toolset_request.builtin_tools or toolset_request.skill_ids_resolved or toolset_request.mcp_tools)


def _mcp_approval_required_func(
    mcp_tools: Sequence[PydanticAIMCPToolRequest],
) -> Callable[[Any, Any, dict[str, Any]], bool] | None:
    approve_all = any(tool.requires_approval and tool.tool_name == "*" for tool in mcp_tools)
    approval_tool_names = {tool.tool_name for tool in mcp_tools if tool.requires_approval and tool.tool_name != "*"}
    if not approve_all and not approval_tool_names:
        return None

    def approval_required(_ctx: Any, tool_def: Any, _args: dict[str, Any]) -> bool:
        if approve_all:
            return True
        tool_name = getattr(tool_def, "name", None)
        return isinstance(tool_name, str) and tool_name in approval_tool_names

    return approval_required


def _approval_wrapped_mcp_toolsets(
    sdk: ModuleType,
    mcp_tools: Sequence[PydanticAIMCPToolRequest],
    mcp_toolsets_by_server: Mapping[str, object],
) -> list[object]:
    result: list[object] = []
    approval_toolset_cls = getattr(sdk, "ApprovalRequiredToolset", None)
    for server_id, toolset in mcp_toolsets_by_server.items():
        approval_required_func = _mcp_approval_required_func(
            [tool for tool in mcp_tools if tool.server_id == server_id]
        )
        if approval_required_func is None:
            result.append(toolset)
            continue
        if not callable(approval_toolset_cls):
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "pydantic_ai module does not expose ApprovalRequiredToolset.",
                payload={"module": "pydantic_ai"},
            )
        result.append(approval_toolset_cls(toolset, approval_required_func=approval_required_func))
    return result


def _sdk_usage_limits(sdk: ModuleType, request: PydanticAIRunRequest) -> object | None:
    if not request.usage_limits:
        return None
    if "max_cost_usd" in request.usage_limits:
        raise AdapterRuntimeError(
            "AA_PREPARE_INCOMPATIBLE_ADAPTER",
            "Pydantic AI SDK usage limits cannot enforce max_cost_usd.",
            payload={"usage_limit": "max_cost_usd", "value": request.usage_limits["max_cost_usd"]},
        )

    usage_limits_cls = getattr(sdk, "UsageLimits", None)
    if not callable(usage_limits_cls):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "pydantic_ai module does not expose UsageLimits.",
            payload={"module": "pydantic_ai", "usage_limits": sorted(request.usage_limits)},
        )

    kwargs: dict[str, Any] = {"request_limit": None}
    if "max_input_tokens" in request.usage_limits:
        kwargs["input_tokens_limit"] = request.usage_limits["max_input_tokens"]
    if "max_output_tokens" in request.usage_limits:
        kwargs["output_tokens_limit"] = request.usage_limits["max_output_tokens"]
    if "max_total_tokens" in request.usage_limits:
        kwargs["total_tokens_limit"] = request.usage_limits["max_total_tokens"]
    usage_limits: object = usage_limits_cls(**kwargs)
    return usage_limits


async def _run_sdk_agent_once(
    agent: Any,
    request: PydanticAIRunRequest,
    usage_limits: object | None,
    *,
    user_prompt: str | None,
    message_history: list[object] | None,
    deferred_tool_results: object | None,
    result_handler: Callable[[object], None] | None = None,
) -> AsyncIterator[RawPydanticAIEvent]:
    result = await agent.run(
        user_prompt,
        message_history=message_history,
        deferred_tool_results=deferred_tool_results,
        model_settings=request.model_settings or None,
        usage_limits=usage_limits,
    )
    if result_handler is not None:
        result_handler(result)
    for raw_event in _sdk_result_to_raw_events(result):
        yield raw_event


def _sdk_stream_event_to_raw(event: object) -> list[RawPydanticAIEvent]:
    event_kind = _str_attr(event, "event_kind")
    if event_kind == "part_start":
        return _sdk_part_start_to_raw(getattr(event, "part", None))
    if event_kind == "part_delta":
        return _sdk_part_delta_to_raw(getattr(event, "delta", None))
    if event_kind == "part_end":
        return _sdk_part_end_to_raw(getattr(event, "part", None))
    if event_kind == "function_tool_call":
        return [_sdk_tool_call_to_raw(getattr(event, "part", None), builtin=False)]
    if event_kind == "builtin_tool_call":
        return []
    if event_kind in {"function_tool_result", "builtin_tool_result"}:
        part = getattr(event, "part", None)
        if part is None:
            part = getattr(event, "result", None)
        return [_sdk_tool_result_to_raw(part, builtin=event_kind == "builtin_tool_result")]
    if event_kind == "agent_run_result":
        return _sdk_result_to_raw_events(getattr(event, "result", None))
    return []


def _sdk_part_start_to_raw(part: object) -> list[RawPydanticAIEvent]:
    part_kind = _str_attr(part, "part_kind")
    content = _str_attr(part, "content") or ""
    if part_kind == "text":
        return [{"type": "text_delta", "text": content, "start": True}]
    if part_kind == "thinking":
        return [{"type": "thinking_delta", "text": content, "start": True}]
    if part_kind == "builtin-tool-call":
        return [_sdk_tool_call_to_raw(part, builtin=True)]
    return []


def _sdk_part_delta_to_raw(delta: object) -> list[RawPydanticAIEvent]:
    delta_kind = _str_attr(delta, "part_delta_kind")
    if delta_kind == "text":
        return [{"type": "text_delta", "text": _str_attr(delta, "content_delta") or ""}]
    if delta_kind == "thinking":
        return [{"type": "thinking_delta", "text": _str_attr(delta, "content_delta") or ""}]
    return []


def _sdk_part_end_to_raw(part: object) -> list[RawPydanticAIEvent]:
    part_kind = _str_attr(part, "part_kind")
    content = _str_attr(part, "content") or ""
    if part_kind == "text":
        return [{"type": "text_completed", "text": content}]
    if part_kind == "thinking":
        return [{"type": "thought_completed", "summary": _summary_text(content)}]
    return []


def _sdk_tool_call_to_raw(part: object, *, builtin: bool) -> RawPydanticAIEvent:
    tool_name = _str_attr(part, "tool_name") or "unknown"
    tool_id = f"builtin:{tool_name}" if builtin and not tool_name.startswith("builtin:") else tool_name
    args = _sdk_tool_args(getattr(part, "args", None))
    return {
        "type": "tool_call_started",
        "tool_id": tool_id,
        "args": args,
        "args_hash": _stable_hash(args),
        "requires_approval": False,
        "invocation_id": _str_attr(part, "tool_call_id"),
    }


def _sdk_tool_result_to_raw(part: object, *, builtin: bool) -> RawPydanticAIEvent:
    tool_name = _str_attr(part, "tool_name") or "unknown"
    tool_id = f"builtin:{tool_name}" if builtin and not tool_name.startswith("builtin:") else tool_name
    outcome = _str_attr(part, "outcome")
    part_kind = _str_attr(part, "part_kind")
    if outcome in {"failed", "denied"} or part_kind == "retry-prompt":
        return {
            "type": "tool_call_failed",
            "tool_id": tool_id,
            "error_kind": "tool_failed",
            "message": _sdk_tool_result_message(part),
            "retryable": outcome == "failed" or part_kind == "retry-prompt",
            "invocation_id": _str_attr(part, "tool_call_id"),
        }
    return {
        "type": "tool_call_completed",
        "tool_id": tool_id,
        "result_summary": _sdk_result_summary(getattr(part, "content", None)),
        "duration_ms": 0,
        "invocation_id": _str_attr(part, "tool_call_id"),
    }


def _sdk_result_to_raw_events(result: object) -> list[RawPydanticAIEvent]:
    usage = _sdk_usage(result)
    deferred_tool_requests = _sdk_deferred_tool_requests_to_raw(_sdk_output(result))
    if deferred_tool_requests is not None:
        return [
            {
                "type": "request_completed",
                "usage": usage,
                "finish_reason": "tool_call",
                "latency_ms": 0,
            },
            deferred_tool_requests,
        ]
    completed_event: dict[str, Any] = {
        "type": "completed",
        "output": _sdk_output(result),
        "usage": usage,
        "messages": _sdk_messages(result),
    }
    traceparent = _sdk_traceparent(result)
    if traceparent is not None:
        completed_event["pydantic_ai_traceparent"] = traceparent
    return [
        {
            "type": "request_completed",
            "usage": usage,
            "finish_reason": "stop",
            "latency_ms": 0,
        },
        completed_event,
    ]


def _sdk_output(result: object) -> object:
    return getattr(result, "output", {})


def _sdk_deferred_tool_requests_to_raw(output: object) -> RawPydanticAIEvent | None:
    raw_calls = getattr(output, "calls", None)
    raw_approvals = getattr(output, "approvals", None)
    if not isinstance(raw_calls, list) and not isinstance(raw_approvals, list):
        return None
    calls = [_sdk_tool_call_request(part) for part in (raw_calls or [])]
    approvals = [_sdk_tool_call_request(part) for part in (raw_approvals or [])]
    if not calls and not approvals:
        return None
    return {
        "type": "deferred_tool_requests",
        "calls": calls,
        "approvals": approvals,
        "metadata": _metadata_by_tool_call_id(getattr(output, "metadata", None)),
    }


def _sdk_tool_call_request(part: object) -> dict[str, Any]:
    args = _sdk_tool_args(getattr(part, "args", None))
    return {
        "tool_id": _str_attr(part, "tool_name") or "unknown",
        "args": args,
        "args_hash": _stable_hash(args),
        "invocation_id": _str_attr(part, "tool_call_id") or "unknown",
    }


def _sdk_usage(result: object) -> dict[str, Any]:
    raw_usage = getattr(result, "usage", None)
    usage = raw_usage() if callable(raw_usage) else raw_usage
    return _usage_mapping(usage)


def _sdk_messages(result: object) -> list[dict[str, Any]]:
    all_messages_json = getattr(result, "all_messages_json", None)
    if callable(all_messages_json):
        try:
            decoded = json.loads(all_messages_json().decode("utf-8"))
        except (AttributeError, TypeError, ValueError):
            decoded = None
        if isinstance(decoded, list):
            return [_mapping_or_empty(item) for item in decoded if isinstance(item, Mapping)]

    all_messages = getattr(result, "all_messages", None)
    if not callable(all_messages):
        return []
    raw_messages = all_messages()
    if not isinstance(raw_messages, list):
        return []
    messages: list[dict[str, Any]] = []
    for raw_message in raw_messages:
        dumped = _jsonable_model(raw_message)
        if isinstance(dumped, Mapping):
            messages.append(_mapping_or_empty(dumped))
    return messages


def _sdk_message_history_objects(result: object) -> list[object]:
    all_messages = getattr(result, "all_messages", None)
    if not callable(all_messages):
        return []
    raw_messages = all_messages()
    return raw_messages if isinstance(raw_messages, list) else []


def _sdk_traceparent(result: object) -> str | None:
    traceparent = getattr(result, "_traceparent", None)
    if not callable(traceparent):
        return None
    try:
        value = traceparent(required=False)
    except TypeError:
        value = traceparent()
    return value if isinstance(value, str) and value else None


def _str_attr(value: object, name: str) -> str | None:
    attr = getattr(value, name, None)
    return attr if isinstance(attr, str) and attr else None


def _sdk_tool_args(value: object) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return _mapping_or_empty(value)
    if isinstance(value, str) and value:
        try:
            decoded = json.loads(value)
        except ValueError:
            decoded = None
        if isinstance(decoded, Mapping):
            return _mapping_or_empty(decoded)
        return {"raw": value}
    return {}


def _sdk_result_summary(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _summary_text(value)
    jsonable = _jsonable_model(value)
    try:
        encoded = json.dumps(jsonable, ensure_ascii=False, sort_keys=True, default=str)
    except TypeError:
        encoded = str(value)
    return _summary_text(encoded)


def _sdk_tool_result_message(part: object) -> str:
    model_response = getattr(part, "model_response", None)
    if callable(model_response):
        try:
            value = model_response()
        except TypeError:
            value = None
        if isinstance(value, str):
            return _summary_text(value)
    return _sdk_result_summary(getattr(part, "content", None))


def _is_usage_limit_exceeded(exc: Exception) -> bool:
    return type(exc).__name__ == "UsageLimitExceeded"


def _is_retryable_model_exception(exc: Exception) -> bool:
    if _is_usage_limit_exceeded(exc):
        return False
    exc_name = type(exc).__name__
    if _is_http_status_model_exception(exc):
        return _is_retryable_http_status(_http_status_code(exc))
    if isinstance(exc, TimeoutError | ConnectionError):
        return True
    retryable_names = {
        "APIConnectionError",
        "APITimeoutError",
        "ConnectError",
        "ConnectTimeout",
        "ConnectionError",
        "ConnectionTimeout",
        "HTTPTimeoutError",
        "ReadError",
        "ReadTimeout",
        "RemoteProtocolError",
        "RequestError",
        "TimeoutException",
        "TransportError",
        "WriteError",
        "WriteTimeout",
    }
    return exc_name in retryable_names


def _is_http_status_model_exception(exc: Exception) -> bool:
    return type(exc).__name__ in {"APIStatusError", "HTTPStatusError", "ModelHTTPError"}


def _http_status_code(exc: Exception) -> int | None:
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int) and not isinstance(status_code, bool):
        return status_code
    response = getattr(exc, "response", None)
    response_status_code = getattr(response, "status_code", None)
    if isinstance(response_status_code, int) and not isinstance(response_status_code, bool):
        return response_status_code
    return None


def _is_retryable_http_status(status_code: int | None) -> bool:
    if status_code is None:
        return False
    return status_code == 408 or status_code == 429 or status_code >= 500


def _is_model_retry_candidate(exc: AdapterRuntimeError) -> bool:
    return exc.error_code == "AA_RUN_STREAM_INTERRUPTED" and exc.adapter_error.retryable


def _is_exhausted_model_retry_error(
    request: PydanticAIRunRequest,
    exc: AdapterRuntimeError,
    model_retry_attempts: int,
    emitted_raw_events: int,
) -> bool:
    return (
        _is_model_retry_candidate(exc)
        and emitted_raw_events == 0
        and request.retry_policy.model_retries > 0
        and model_retry_attempts >= request.retry_policy.model_retries
    )


def _model_retry_exhausted_error(
    request: PydanticAIRunRequest,
    exc: AdapterRuntimeError,
    model_retry_attempts: int,
) -> AdapterRuntimeError:
    payload = exc.adapter_error.payload or {}
    return AdapterRuntimeError(
        "AA_RUN_STREAM_INTERRUPTED",
        "Pydantic AI session model request failed after retry_policy.model_retries was exhausted.",
        retryable=False,
        payload={
            "exception_type": payload.get("exception_type"),
            "message": payload.get("message"),
            "model_retries": request.retry_policy.model_retries,
            "model_retry_attempts": model_retry_attempts,
            "model_retries_exhausted": True,
        },
    )


def _summary_text(value: str, *, limit: int = 500) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def _required_str(raw_event: RawPydanticAIEvent, key: str) -> str:
    value = raw_event.get(key)
    if isinstance(value, str) and value:
        return value
    raise AdapterRuntimeError(
        "AA_RUN_INTERNAL",
        f"Pydantic AI event is missing required string field {key!r}.",
        payload={"field": key},
    )


def _optional_str(raw_event: RawPydanticAIEvent, key: str) -> str | None:
    value = raw_event.get(key)
    return value if isinstance(value, str) else None


def _dict_or_empty(value: object) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, Mapping):
        return dict(value)
    raise AdapterRuntimeError(
        "AA_RUN_OUTPUT_VALIDATION_FAILED",
        "Pydantic AI completed event output must be an object.",
        payload={"output_type": type(value).__name__},
    )


def _mapping_or_empty(value: object) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return cast(dict[str, Any], json.loads(json.dumps(dict(value), ensure_ascii=False, default=str)))
    return {}


def _jsonable_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(json.dumps(dict(value), ensure_ascii=False, default=str)))


def _jsonable_model(value: object) -> object:
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            return model_dump(mode="json")
        except TypeError:
            return model_dump()
    if isinstance(value, Mapping):
        return _jsonable_mapping(value)
    return value


def _list_of_mappings(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [_mapping_or_empty(item) for item in value if isinstance(item, Mapping)]


def _metadata_by_tool_call_id(value: object) -> dict[str, dict[str, Any]]:
    if not isinstance(value, Mapping):
        return {}
    metadata: dict[str, dict[str, Any]] = {}
    for key, raw_item in value.items():
        if isinstance(key, str) and isinstance(raw_item, Mapping):
            metadata[key] = _mapping_or_empty(raw_item)
    return metadata


def _bool_value(value: object) -> bool:
    return value if isinstance(value, bool) else False


def _int_value(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _int_or_none(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def _usage_mapping(value: object) -> dict[str, Any]:
    if value is None:
        return RunUsage().model_dump(mode="json")
    raw_mapping = _jsonable_model(value)
    source = raw_mapping if isinstance(raw_mapping, Mapping) else _usage_attrs(value)
    mapped: dict[str, Any] = {}
    for source_key, target_key in [
        ("input_tokens", "input_tokens"),
        ("output_tokens", "output_tokens"),
        ("cache_write_tokens", "cache_creation_input_tokens"),
        ("cache_creation_input_tokens", "cache_creation_input_tokens"),
        ("cache_read_tokens", "cache_read_input_tokens"),
        ("cache_read_input_tokens", "cache_read_input_tokens"),
        ("total_tokens", "total_tokens"),
        ("requests", "requests"),
        ("est_cost_usd", "est_cost_usd"),
    ]:
        raw_value = source.get(source_key) if isinstance(source, Mapping) else None
        if _valid_usage_value(raw_value):
            mapped[target_key] = raw_value
    if "total_tokens" not in mapped:
        mapped["total_tokens"] = int(mapped.get("input_tokens", 0)) + int(mapped.get("output_tokens", 0))
    return RunUsage.model_validate(mapped).model_dump(mode="json")


def _usage_attrs(value: object) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in [
        "input_tokens",
        "output_tokens",
        "cache_write_tokens",
        "cache_read_tokens",
        "total_tokens",
        "requests",
        "est_cost_usd",
    ]:
        attr = getattr(value, key, None)
        if _valid_usage_value(attr):
            result[key] = attr
    return result


def _valid_usage_value(value: object) -> bool:
    if isinstance(value, bool):
        return False
    return isinstance(value, int | float) and value >= 0


def _usage_from_raw(raw_event: RawPydanticAIEvent) -> RunUsage | None:
    if "usage" not in raw_event:
        return None
    return RunUsage.model_validate(_usage_mapping(raw_event.get("usage")))


def _messages_from_raw(raw_event: RawPydanticAIEvent) -> list[dict[str, Any]] | None:
    raw_messages = raw_event.get("messages")
    if raw_messages is None:
        return None
    if not isinstance(raw_messages, list):
        return []
    return [_mapping_or_empty(item) for item in raw_messages if isinstance(item, Mapping)]


def _decisions(raw_event: RawPydanticAIEvent) -> list[dict[str, Any]]:
    raw_decisions = raw_event.get("decisions")
    if isinstance(raw_decisions, list):
        decisions = [_mapping_or_empty(item) for item in raw_decisions if isinstance(item, Mapping)]
        if decisions:
            return decisions
    return [
        {"key": "continue", "label": "Approve"},
        {"key": "reject", "label": "Reject"},
    ]


def _first_decision_key(decisions: list[dict[str, Any]]) -> str:
    for decision in decisions:
        key = decision.get("key")
        if isinstance(key, str) and key:
            return key
    return "continue"


def _deferred_tool_results_from_resumption(
    handle: AttemptHandle,
    resumption: AttemptResumption,
) -> PydanticAIDeferredToolResults | None:
    if resumption.kind == ResumptionKind.DEFERRED_TOOL:
        return _deferred_tool_results_from_payload(handle, resumption)
    if resumption.kind == ResumptionKind.HUMAN_DECISION:
        return _deferred_tool_results_from_human_decision(handle, resumption)
    return None


def _deferred_tool_results_from_payload(
    handle: AttemptHandle,
    resumption: AttemptResumption,
) -> PydanticAIDeferredToolResults:
    results = resumption.deferred_tool_results
    if not results:
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "deferred_tool resumption requires at least one deferred tool result.",
            payload={"kind": resumption.kind.value},
        )

    pending = _pending_deferred_tool_requests(handle)
    pending_call_ids = _pending_request_ids(pending, "calls")
    pending_approval_ids = _pending_request_ids(pending, "approvals")
    pending_ids = pending_call_ids | pending_approval_ids
    validate_pending_requests = bool(pending_ids)

    calls: dict[str, Any] = {}
    approvals: dict[str, bool | dict[str, Any]] = {}
    metadata: dict[str, dict[str, Any]] = {}
    for item in results:
        tool_call_id = item.get("tool_call_id")
        if not isinstance(tool_call_id, str) or not tool_call_id:
            raise AdapterRuntimeError(
                "AA_RESUME_INVALID_KIND",
                "Deferred tool result is missing tool_call_id.",
                payload={"kind": resumption.kind.value},
            )
        if validate_pending_requests and tool_call_id not in pending_ids:
            raise AdapterRuntimeError(
                "AA_RESUME_INVALID_KIND",
                "Deferred tool result references an unknown pending tool_call_id.",
                payload={
                    "kind": resumption.kind.value,
                    "tool_call_id": tool_call_id,
                    "pending_tool_call_ids": sorted(pending_ids),
                },
            )
        raw_metadata = item.get("metadata")
        if isinstance(raw_metadata, Mapping):
            metadata[tool_call_id] = _mapping_or_empty(raw_metadata)
        if "output" in item:
            if validate_pending_requests:
                _ensure_pending_result_kind(tool_call_id, pending_call_ids, "call")
            calls[tool_call_id] = item["output"]
            continue
        if "result" in item:
            if validate_pending_requests:
                _ensure_pending_result_kind(tool_call_id, pending_call_ids, "call")
            calls[tool_call_id] = item["result"]
            continue
        approved = item.get("approved")
        if isinstance(approved, bool):
            if validate_pending_requests:
                _ensure_pending_result_kind(tool_call_id, pending_approval_ids, "approval")
            approvals[tool_call_id] = approved
            continue
        denied_message = item.get("denied_message")
        if isinstance(denied_message, str):
            if validate_pending_requests:
                _ensure_pending_result_kind(tool_call_id, pending_approval_ids, "approval")
            approvals[tool_call_id] = {"kind": "tool-denied", "message": denied_message}
            continue
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "Deferred tool result must include output, result, approved, or denied_message.",
            payload={"kind": resumption.kind.value, "tool_call_id": tool_call_id},
        )

    provided_ids = set(calls) | set(approvals)
    missing_ids = sorted(pending_ids - provided_ids)
    if validate_pending_requests and missing_ids:
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "Deferred tool results must cover all pending Pydantic AI deferred tool requests.",
            payload={
                "kind": resumption.kind.value,
                "missing_tool_call_ids": missing_ids,
                "pending_tool_call_ids": sorted(pending_ids),
            },
        )

    return PydanticAIDeferredToolResults(calls=calls, approvals=approvals, metadata=metadata)


def _deferred_tool_results_from_human_decision(
    handle: AttemptHandle,
    resumption: AttemptResumption,
) -> PydanticAIDeferredToolResults | None:
    decision = resumption.human_decision
    if decision is None:
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "human_decision resumption requires a human_decision payload.",
            payload={"kind": resumption.kind.value},
        )

    pending = _pending_deferred_tool_requests(handle)
    call_ids = _pending_request_ids(pending, "calls")
    if call_ids:
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "human_decision resumption cannot resolve pending Pydantic AI deferred tool calls.",
            payload={
                "kind": resumption.kind.value,
                "pending_call_ids": sorted(call_ids),
            },
        )
    approval_ids = [_request_invocation_id(item) for item in _list_of_mappings(pending.get("approvals"))]
    approval_ids = [approval_id for approval_id in approval_ids if approval_id != "unknown"]
    if not approval_ids:
        return None

    approvals: dict[str, bool | dict[str, Any]]
    key = decision.key
    if key in {"continue", "approve", "approve_all"}:
        approvals = dict.fromkeys(approval_ids, True)
    elif key in {"reject", "deny", "reject_all", "deny_all"}:
        approvals = {approval_id: _tool_denied_payload(decision.custom_value) for approval_id in approval_ids}
    elif key.startswith("approve:"):
        approvals = {_decision_tool_call_id(key, approval_ids): True}
    elif key.startswith("reject:") or key.startswith("deny:"):
        approvals = {_decision_tool_call_id(key, approval_ids): _tool_denied_payload(decision.custom_value)}
    else:
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "human_decision key does not resolve a pending Pydantic AI approval.",
            payload={"kind": resumption.kind.value, "decision": key, "pending_approval_ids": approval_ids},
        )

    return PydanticAIDeferredToolResults(
        approvals=approvals,
        metadata=_metadata_by_tool_call_id(pending.get("metadata")),
    )


def _pending_deferred_tool_requests(handle: AttemptHandle) -> dict[str, Any]:
    pending = handle.metadata.get("pydantic_ai_deferred_tool_requests")
    return _mapping_or_empty(pending)


def _pending_request_ids(pending: Mapping[str, Any], key: Literal["calls", "approvals"]) -> set[str]:
    ids = {_request_invocation_id(item) for item in _list_of_mappings(pending.get(key))}
    return {item_id for item_id in ids if item_id != "unknown"}


def _ensure_pending_result_kind(
    tool_call_id: str, expected_ids: set[str], expected_kind: Literal["call", "approval"]
) -> None:
    if tool_call_id in expected_ids:
        return
    raise AdapterRuntimeError(
        "AA_RESUME_INVALID_KIND",
        "Deferred tool result kind does not match the pending Pydantic AI request kind.",
        payload={"tool_call_id": tool_call_id, "expected_kind": expected_kind},
    )


def _tool_denied_payload(message: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"kind": "tool-denied"}
    if message:
        payload["message"] = message
    return payload


def _decision_tool_call_id(key: str, approval_ids: Sequence[str]) -> str:
    _, _, tool_call_id = key.partition(":")
    if tool_call_id not in approval_ids:
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "human_decision key references an unknown Pydantic AI approval.",
            payload={"decision": key, "pending_approval_ids": list(approval_ids)},
        )
    return tool_call_id


def _request_tool_id(item: Mapping[str, Any]) -> str:
    value = item.get("tool_id")
    return value if isinstance(value, str) and value else "unknown"


def _request_invocation_id(item: Mapping[str, Any]) -> str:
    value = item.get("invocation_id")
    return value if isinstance(value, str) and value else "unknown"


def _deferred_decisions(calls: list[dict[str, Any]], approvals: list[dict[str, Any]]) -> list[dict[str, str]]:
    if approvals:
        approval_ids = [_request_invocation_id(item) for item in approvals]
        if len(approval_ids) == 1:
            approval_id = approval_ids[0]
            return [
                {"key": f"approve:{approval_id}", "label": "Approve"},
                {"key": f"reject:{approval_id}", "label": "Reject"},
            ]
        return [
            {"key": "approve_all", "label": "Approve all"},
            {"key": "reject_all", "label": "Reject all"},
        ]
    if calls:
        return [{"key": "provide_deferred_tool_results", "label": "Provide results"}]
    return [{"key": "continue", "label": "Continue"}]


def _sdk_deferred_tool_results(sdk: ModuleType, results: PydanticAIDeferredToolResults) -> object:
    deferred_tool_results_cls = getattr(sdk, "DeferredToolResults", None)
    if not callable(deferred_tool_results_cls):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "pydantic_ai module does not expose DeferredToolResults.",
            payload={"module": "pydantic_ai"},
        )
    approvals = {
        tool_call_id: _sdk_deferred_approval_result(sdk, approval)
        for tool_call_id, approval in results.approvals.items()
    }
    return deferred_tool_results_cls(
        calls=dict(results.calls),
        approvals=approvals,
        metadata={key: dict(value) for key, value in results.metadata.items()},
    )


def _sdk_deferred_approval_result(sdk: ModuleType, approval: bool | dict[str, Any]) -> object:
    if isinstance(approval, bool):
        return approval
    kind = approval.get("kind")
    if kind == "tool-approved":
        tool_approved_cls = getattr(sdk, "ToolApproved", None)
        if not callable(tool_approved_cls):
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "pydantic_ai module does not expose ToolApproved.",
                payload={"module": "pydantic_ai"},
            )
        override_args = approval.get("override_args")
        return tool_approved_cls(override_args=_mapping_or_empty(override_args))
    if kind == "tool-denied":
        tool_denied_cls = getattr(sdk, "ToolDenied", None)
        if not callable(tool_denied_cls):
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "pydantic_ai module does not expose ToolDenied.",
                payload={"module": "pydantic_ai"},
            )
        message = approval.get("message")
        return tool_denied_cls(message) if isinstance(message, str) and message else tool_denied_cls()
    raise AdapterRuntimeError(
        "AA_RESUME_INVALID_KIND",
        "Unsupported deferred approval result kind.",
        payload={"kind": kind},
    )


def _attempt_index(pack: ExecutionPack) -> int:
    cw_metadata = pack.metadata.get("cw")
    if isinstance(cw_metadata, Mapping):
        attempt_index = cw_metadata.get("attempt_index")
        if isinstance(attempt_index, int) and not isinstance(attempt_index, bool) and attempt_index >= 0:
            return attempt_index
    return 0


def _attempt_failed_payload(error: AdapterError, pack: ExecutionPack) -> dict[str, Any]:
    return {
        "error_kind": error.error_kind.value,
        "message": error.message,
        "will_retry": False,
        "next_action": "run.failed",
        "attempt_index": _attempt_index(pack),
    }


def _human_resolved_payload(handle: AttemptHandle, resumption: AttemptResumption) -> dict[str, Any]:
    decision = resumption.human_decision
    if decision is None:
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "human_decision resumption must include a human_decision payload.",
            payload={"handle_id": handle.handle_id},
        )
    payload: dict[str, Any] = {
        "human_node_id": handle.node_id,
        "decision": decision.key,
        "by": decision.by,
    }
    if decision.custom_value is not None:
        payload["custom_value"] = decision.custom_value
    return payload


def _traceparent_for(handle: AttemptHandle) -> str | None:
    value = handle.metadata.get("pydantic_ai_traceparent")
    return value if isinstance(value, str) and value else None


async def _cancel_future(future: asyncio.Future[Any]) -> None:
    future.cancel()
    with suppress(asyncio.CancelledError):
        await future


def _matches_json_schema_type(value: object, expected_type: str) -> bool:
    if expected_type == "string":
        return isinstance(value, str)
    if expected_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    if expected_type == "boolean":
        return isinstance(value, bool)
    if expected_type == "object":
        return isinstance(value, Mapping)
    if expected_type == "array":
        return isinstance(value, list)
    if expected_type == "null":
        return value is None
    return True


def _stable_hash(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def _unique_strings(values: Sequence[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value and value not in seen:
            result.append(value)
            seen.add(value)
    return result


__all__ = [
    "PydanticAIAdapter",
    "PydanticAIDeferredToolResults",
    "PydanticAIMCPToolRequest",
    "PydanticAIMCPToolset",
    "PydanticAIResumeRequest",
    "PydanticAIRetryPolicy",
    "PydanticAIRunRequest",
    "PydanticAISDKSession",
    "PydanticAISession",
    "PydanticAISessionFactory",
    "PydanticAIToolsetFactory",
    "PydanticAIToolsetRegistry",
    "PydanticAIToolsetRequest",
    "PydanticAIToolsets",
    "RawPydanticAIEvent",
    "build_pydantic_ai_descriptor",
]
