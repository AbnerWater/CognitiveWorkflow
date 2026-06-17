"""Pydantic AI AgentAdapter foundation.

This module keeps the public ``pydantic_ai`` adapter entry point importable
without requiring the optional agents extra in the default runtime install.
Real SDK integration can provide a ``PydanticAISession`` behind this seam.
"""

from __future__ import annotations

import hashlib
import importlib
import json
from collections.abc import AsyncIterator, Callable, Mapping
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
    correlation_id: str = Field(..., min_length=1)


class PydanticAIResumeRequest(BaseModel):
    """Internal resume request passed to a Pydantic AI session implementation."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    handle_id: str = Field(..., min_length=1)
    run_id: str = Field(..., min_length=1)
    node_id: str = Field(..., min_length=1)
    attempt_id: str = Field(..., min_length=1)
    resumption: AttemptResumption


class PydanticAISession(Protocol):
    """Minimal async seam for future SDK-backed Pydantic AI integration."""

    def run(self, request: PydanticAIRunRequest) -> AsyncIterator[RawPydanticAIEvent]: ...

    def resume(self, request: PydanticAIResumeRequest) -> AsyncIterator[RawPydanticAIEvent]: ...

    async def cancel(self, handle_id: str, reason: CancelReason) -> None: ...

    async def aclose(self) -> None: ...


PydanticAISessionFactory: TypeAlias = Callable[[], PydanticAISession]


class PydanticAISDKSession:
    """Lazy SDK-backed Pydantic AI session.

    The optional ``pydantic_ai`` package is imported only when this default
    session is used, so the runtime package remains importable without the
    ``agents`` extra.
    """

    def __init__(self, sdk_module: ModuleType | None = None) -> None:
        self._sdk_module = sdk_module

    async def run(self, request: PydanticAIRunRequest) -> AsyncIterator[RawPydanticAIEvent]:
        sdk = self._sdk()
        agent = _build_sdk_agent(sdk, request)
        result = await agent.run(
            request.user_prompt,
            model_settings=request.model_settings or None,
        )
        usage = _sdk_usage(result)
        messages = _sdk_messages(result)
        yield {
            "type": "request_completed",
            "usage": usage,
            "finish_reason": "stop",
            "latency_ms": 0,
        }
        completed_event: dict[str, Any] = {
            "type": "completed",
            "output": _sdk_output(result),
            "usage": usage,
            "messages": messages,
        }
        traceparent = _sdk_traceparent(result)
        if traceparent is not None:
            completed_event["pydantic_ai_traceparent"] = traceparent
        yield completed_event

    async def resume(self, request: PydanticAIResumeRequest) -> AsyncIterator[RawPydanticAIEvent]:
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "Pydantic AI SDK-backed resume is not implemented in W1.4.2.",
            payload={"handle_id": request.handle_id, "kind": request.resumption.kind.value},
        )
        yield {}

    async def cancel(self, handle_id: str, reason: CancelReason) -> None:
        return None

    async def aclose(self) -> None:
        return None

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
    ) -> None:
        self._config = config or AdapterConfig(adapter_id=self._ADAPTER_ID)
        self._session_factory = session_factory
        self._packs: dict[str, ExecutionPack] = {}
        self._sessions: dict[str, PydanticAISession] = {}
        self._outputs: dict[str, dict[str, Any]] = {}
        self._errors: dict[str, list[AdapterError]] = {}
        self._usage: dict[str, RunUsage] = {}
        self._messages: dict[str, list[dict[str, Any]]] = {}
        self._stream_seq: dict[str, int] = {}

    @property
    def adapter_id(self) -> str:
        return self._ADAPTER_ID

    @property
    def adapter_version(self) -> str:
        return self._ADAPTER_VERSION

    def capabilities(self) -> AdapterCapabilities:
        common_settings = {"temperature", "top_p", "max_tokens", "reasoning_effort", "seed"}
        return AdapterCapabilities(
            kinds={AdapterKind.CHAT},
            provider_kinds={ProviderKind.CLOUD, ProviderKind.PRIVATE, ProviderKind.LOCAL},
            structured_output=True,
            streaming=False,
            tool_call=False,
            mcp=False,
            human_in_the_loop=False,
            deferred_tool_results=False,
            multi_modal=set(),
            long_context_tokens=200_000,
            max_tool_iterations=0,
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

        try:
            session = self._session_for(handle)
            request = self._run_request(handle)
            async for raw_event in self._iterate_session(handle, session.run(request)):
                for event in self._translate_raw_event(handle, raw_event):
                    yield event
                if handle.state in {AttemptState.AWAITING_HUMAN, AttemptState.COMPLETED, AttemptState.FAILED}:
                    return
            if handle.state == AttemptState.RUNNING:
                yield self._unterminated_session_event(handle, operation="run")
        except AdapterRuntimeError as exc:
            yield self._failed_event_from_exception(handle, exc)

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
            )
            async for raw_event in self._iterate_session(handle, session.resume(request)):
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
            await session.cancel(handle.handle_id, reason)

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
        session = PydanticAISDKSession() if self._session_factory is None else self._session_factory()
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
            correlation_id=pack.correlation_id,
        )

    async def _iterate_session(
        self,
        handle: AttemptHandle,
        events: AsyncIterator[RawPydanticAIEvent],
    ) -> AsyncIterator[RawPydanticAIEvent]:
        try:
            async for event in events:
                if handle.cancellation_requested:
                    handle.state = AttemptState.CANCELLED
                    handle.finished_at = utc_now_ms()
                    return
                yield event
        except AdapterRuntimeError:
            raise
        except Exception as exc:
            error = build_adapter_error(
                "AA_RUN_INTERNAL",
                "Pydantic AI session raised an internal exception.",
                retryable=False,
                payload={"exception_type": type(exc).__name__},
            )
            self._errors[handle.handle_id] = [error]
            handle.state = AttemptState.FAILED
            handle.finished_at = utc_now_ms()
            raise AdapterRuntimeError("AA_RUN_INTERNAL", error.message, payload=error.payload) from exc

    def _translate_raw_event(self, handle: AttemptHandle, raw_event: RawPydanticAIEvent) -> list[StreamEventBase]:
        event_type = _required_str(raw_event, "type")
        if event_type == "text_delta":
            return [
                self._model_event(
                    handle,
                    event_type="model.text_delta",
                    phase=EventPhase.ATTEMPT_STREAMING,
                    title="Pydantic AI text delta",
                    payload={"delta_text": _optional_str(raw_event, "text") or ""},
                )
            ]
        if event_type == "thinking_delta":
            return [
                self._model_event(
                    handle,
                    event_type="model.thinking_delta",
                    phase=EventPhase.ATTEMPT_STREAMING,
                    title="Pydantic AI thinking delta",
                    payload={"delta_text": _optional_str(raw_event, "text") or ""},
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
        handle.state = AttemptState.FAILED
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
        event_type: Literal["model.thinking_delta", "model.text_delta", "model.request_completed"],
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
        event_type: Literal["tool.call_started", "tool.call_completed", "tool.approval_required"],
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


def _build_sdk_agent(sdk: ModuleType, request: PydanticAIRunRequest) -> Any:
    agent_cls = getattr(sdk, "Agent", None)
    structured_dict = getattr(sdk, "StructuredDict", None)
    if not callable(agent_cls) or not callable(structured_dict):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "pydantic_ai module does not expose Agent and StructuredDict.",
            payload={"module": "pydantic_ai"},
        )

    output_schema = request.output_schema or {"type": "object", "additionalProperties": True}
    output_type = structured_dict(
        _jsonable_mapping(output_schema),
        name=f"{request.node_id}_output",
        description=f"CW output for node {request.node_id}",
    )
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
    return agent_cls(request.model_profile_id, **kwargs)


def _sdk_output(result: object) -> object:
    return getattr(result, "output", {})


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


def _sdk_traceparent(result: object) -> str | None:
    traceparent = getattr(result, "_traceparent", None)
    if not callable(traceparent):
        return None
    try:
        value = traceparent(required=False)
    except TypeError:
        value = traceparent()
    return value if isinstance(value, str) and value else None


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


__all__ = [
    "PydanticAIAdapter",
    "PydanticAIResumeRequest",
    "PydanticAIRunRequest",
    "PydanticAISDKSession",
    "PydanticAISession",
    "PydanticAISessionFactory",
    "RawPydanticAIEvent",
    "build_pydantic_ai_descriptor",
]
