"""Claude Code AgentAdapter foundation.

The adapter keeps the public entry point importable without requiring the
optional Claude Agent SDK in the default runtime install. Tests can still inject
``ClaudeCodeSession`` directly, while the default path lazy-loads the SDK only
when a prepared attempt is actually run.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import inspect
import json
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
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
from cw_runtime.harness import (
    ProjectMCPServerConfig,
    ProjectSecretDecryptor,
    load_project_mcp_secret_material,
    load_project_mcp_server_configs,
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

RawClaudeCodeEvent: TypeAlias = Mapping[str, Any]


class ClaudeCodeRunRequest(BaseModel):
    """Internal request passed to an SDK-backed Claude Code session."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    handle_id: str = Field(..., min_length=1)
    run_id: str = Field(..., min_length=1)
    node_id: str = Field(..., min_length=1)
    attempt_id: str = Field(..., min_length=1)
    execution_pack_id: str = Field(..., min_length=1)
    model_profile_id: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)
    allowed_tools: list[str] = Field(default_factory=list)
    permitted_tools: list[str] = Field(default_factory=list)
    approval_required_tools: list[str] = Field(default_factory=list)
    mcp_servers: dict[str, Any] = Field(default_factory=dict)
    can_use_tool_bridge: bool = False
    correlation_id: str = Field(..., min_length=1)


class ClaudeCodeResumeRequest(BaseModel):
    """Internal resume request passed to an SDK-backed session."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    handle_id: str = Field(..., min_length=1)
    run_id: str = Field(..., min_length=1)
    node_id: str = Field(..., min_length=1)
    attempt_id: str = Field(..., min_length=1)
    resumption: AttemptResumption


class ClaudeCodeSession(Protocol):
    """Minimal async session seam for Claude Code SDK integration."""

    def run(self, request: ClaudeCodeRunRequest) -> AsyncIterator[RawClaudeCodeEvent]: ...

    def resume(self, request: ClaudeCodeResumeRequest) -> AsyncIterator[RawClaudeCodeEvent]: ...

    async def cancel(self, handle_id: str, reason: CancelReason) -> None: ...

    async def aclose(self) -> None: ...


SessionFactory: TypeAlias = Callable[[], ClaudeCodeSession]


class ClaudeCodeMCPSecretResolution(BaseModel):
    """Resolved project MCP secret material for SDK-local config projection."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    headers: dict[str, str] = Field(default_factory=dict)
    env: dict[str, str] = Field(default_factory=dict)


ClaudeCodeMCPSecretResolver: TypeAlias = Callable[
    [ProjectMCPServerConfig],
    ClaudeCodeMCPSecretResolution | None,
]


@dataclass
class _ClaudeCodePendingPermission:
    permission_id: str
    tool_name: str
    input_data: dict[str, Any]
    future: asyncio.Future[AttemptResumption | None]


@dataclass(frozen=True)
class _PendingToolApproval:
    tool_id: str
    invocation_id: str | None
    approval_event_id: str


@dataclass
class _ClaudeCodeSDKRunState:
    handle_id: str
    client: object | None = None
    message_iterator: AsyncIterator[object] | None = None
    next_message: asyncio.Task[list[RawClaudeCodeEvent]] | None = None
    raw_event_buffer: list[RawClaudeCodeEvent] = field(default_factory=list)
    permission_events: asyncio.Queue[RawClaudeCodeEvent] = field(default_factory=asyncio.Queue)
    pending_permission: _ClaudeCodePendingPermission | None = None


class ClaudeCodeSDKSession:
    """Default Claude Agent SDK-backed session.

    The SDK remains optional: importing this module does not import
    ``claude_agent_sdk``. The dependency is resolved only when this session is
    first used.
    """

    def __init__(self, sdk_module: ModuleType | None = None) -> None:
        self._sdk_module = sdk_module
        self._clients: dict[str, object] = {}
        self._run_states: dict[str, _ClaudeCodeSDKRunState] = {}

    async def run(self, request: ClaudeCodeRunRequest) -> AsyncIterator[RawClaudeCodeEvent]:
        sdk = self._sdk()
        run_state = _ClaudeCodeSDKRunState(handle_id=request.handle_id)
        client = _build_sdk_client(sdk, request, run_state)
        run_state.client = client
        self._clients[request.handle_id] = client
        self._run_states[request.handle_id] = run_state
        await _connect_sdk_client(client)
        await _query_sdk_client(client, request.prompt)
        run_state.message_iterator = _sdk_client_message_iterator(client)
        async for raw_event in _receive_sdk_client_raw_events(run_state):
            yield raw_event

    async def resume(self, request: ClaudeCodeResumeRequest) -> AsyncIterator[RawClaudeCodeEvent]:
        run_state = self._run_states.get(request.handle_id)
        client = self._clients.get(request.handle_id)
        if client is None:
            raise AdapterRuntimeError(
                "AA_RESUME_INVALID_KIND",
                "Claude Agent SDK resume requires an existing client session.",
                payload={"handle_id": request.handle_id, "kind": request.resumption.kind.value},
            )
        if run_state is None:
            run_state = _ClaudeCodeSDKRunState(handle_id=request.handle_id, client=client)
            run_state.message_iterator = _sdk_client_message_iterator(client)
            self._run_states[request.handle_id] = run_state
        if not _resolve_pending_sdk_permission(run_state, request.resumption):
            await _query_sdk_client(client, _resume_prompt(request.resumption))
            if run_state.message_iterator is None:
                run_state.message_iterator = _sdk_client_message_iterator(client)
        async for raw_event in _receive_sdk_client_raw_events(run_state):
            yield raw_event

    async def cancel(self, handle_id: str, reason: CancelReason) -> None:
        run_state = self._run_states.get(handle_id)
        if run_state is not None:
            _cancel_pending_sdk_permission(run_state)
        client = self._clients.get(handle_id)
        if client is None:
            return
        if await _call_optional_async_method(client, "interrupt"):
            return
        await _close_sdk_client(client)

    async def aclose(self) -> None:
        for client in list(self._clients.values()):
            with suppress(Exception):
                await _close_sdk_client(client)
        self._clients.clear()
        for run_state in self._run_states.values():
            _cancel_pending_sdk_permission(run_state)
            if run_state.next_message is not None:
                await _cancel_task(run_state.next_message)
        self._run_states.clear()

    def _sdk(self) -> ModuleType:
        if self._sdk_module is not None:
            return self._sdk_module
        try:
            self._sdk_module = importlib.import_module("claude_agent_sdk")
        except ImportError as exc:
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "Claude Agent SDK optional dependency is not installed; install claude-agent-sdk before using the default ClaudeCodeAdapter session.",
                payload={"module": "claude_agent_sdk", "package": "claude-agent-sdk"},
            ) from exc
        return self._sdk_module


class ClaudeCodeAdapter:
    """Phase-1 Claude Code adapter foundation."""

    _ADAPTER_ID = "claude_code"
    _ADAPTER_VERSION = "0.1.0"

    def __init__(
        self,
        config: AdapterConfig | None = None,
        *,
        session_factory: SessionFactory | None = None,
    ) -> None:
        self._config = config or AdapterConfig(adapter_id=self._ADAPTER_ID)
        self._session_factory = session_factory
        self._packs: dict[str, ExecutionPack] = {}
        self._sessions: dict[str, ClaudeCodeSession] = {}
        self._outputs: dict[str, dict[str, Any]] = {}
        self._errors: dict[str, list[AdapterError]] = {}
        self._stream_seq: dict[str, int] = {}
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._pending_tool_approvals: dict[str, _PendingToolApproval] = {}

    @property
    def adapter_id(self) -> str:
        return self._ADAPTER_ID

    @property
    def adapter_version(self) -> str:
        return self._ADAPTER_VERSION

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(
            kinds={AdapterKind.CODING_AGENT},
            provider_kinds={ProviderKind.CLOUD},
            structured_output=False,
            streaming=True,
            tool_call=True,
            mcp=True,
            human_in_the_loop=True,
            deferred_tool_results=False,
            multi_modal={"image"},
            long_context_tokens=200_000,
            max_tool_iterations=64,
            cancel=True,
            evidence_lookup_tool=True,
            model_settings_passthrough={"temperature", "max_tokens"},
        )

    async def prepare(self, execution_pack: ExecutionPack) -> AttemptHandle:
        if self._config.adapter_id != self._ADAPTER_ID:
            raise AdapterRuntimeError(
                "AA_PREPARE_INCOMPATIBLE_ADAPTER",
                "ClaudeCodeAdapter requires adapter_id='claude_code'.",
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
            title="Claude Code attempt started",
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
        if resumption.kind != ResumptionKind.HUMAN_DECISION or resumption.human_decision is None:
            raise AdapterRuntimeError(
                "AA_RESUME_INVALID_KIND",
                "ClaudeCodeAdapter currently supports only human_decision resumption.",
                payload={"handle_id": handle.handle_id, "kind": resumption.kind.value},
            )

        handle.state = AttemptState.RUNNING
        yield self._human_event(
            handle,
            event_type="human.gate_resolved",
            title="Human gate resolved",
            payload=_human_resolved_payload(handle, resumption),
            decision_key=resumption.human_decision.key,
            user_id=resumption.human_decision.by,
        )
        tool_approval_event = self._tool_approval_result_event(handle, resumption)
        if tool_approval_event is not None:
            yield tool_approval_event

        try:
            session = self._session_for(handle)
            request = ClaudeCodeResumeRequest(
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
                f"Claude Code attempt cancelled: {reason.value}",
                retryable=False,
                payload={"reason": reason.value},
            )
        ]
        self._pending_tool_approvals.pop(handle.handle_id, None)
        cancel_event = self._cancel_events.get(handle.handle_id)
        if cancel_event is not None:
            cancel_event.set()
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
            usage=None,
            messages=None,
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
                pydantic_ai_traceparent=None,
                outcome_hash=outcome_hash,
            ),
        )

    async def aclose(self) -> None:
        for session in list(self._sessions.values()):
            await session.aclose()
        self._sessions.clear()
        self._cancel_events.clear()

    @classmethod
    def descriptor(cls) -> AdapterDescriptor:
        adapter = cls()
        return AdapterDescriptor(
            adapter_id=cls._ADAPTER_ID,
            adapter_version=cls._ADAPTER_VERSION,
            display_name="Claude Code",
            description="Claude Code session adapter foundation with HITL permission prompt translation.",
            documentation_url=None,
            capabilities=adapter.capabilities(),
            default_config=AdapterConfig(adapter_id=cls._ADAPTER_ID),
            auth_required=True,
            homepage=None,
        )

    def _ensure_known_handle(self, handle: AttemptHandle) -> None:
        if handle.handle_id not in self._packs:
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "Unknown ClaudeCodeAdapter handle.",
                payload={"handle_id": handle.handle_id},
            )

    def _session_for(self, handle: AttemptHandle) -> ClaudeCodeSession:
        session = self._sessions.get(handle.handle_id)
        if session is not None:
            return session
        if self._session_factory is None:
            session = ClaudeCodeSDKSession()
        else:
            session = self._session_factory()
        self._sessions[handle.handle_id] = session
        return session

    def _run_request(self, handle: AttemptHandle) -> ClaudeCodeRunRequest:
        pack = self._packs[handle.handle_id]
        can_use_tool_bridge = _can_use_tool_bridge_enabled(self._config)
        return ClaudeCodeRunRequest(
            handle_id=handle.handle_id,
            run_id=handle.run_id,
            node_id=handle.node_id,
            attempt_id=handle.attempt_id,
            execution_pack_id=pack.pack_id,
            model_profile_id=pack.effective_model_profile_id,
            prompt=_render_prompt(pack),
            allowed_tools=_claude_auto_approved_tools(pack, can_use_tool_bridge=can_use_tool_bridge),
            permitted_tools=_claude_allowed_tools(pack),
            approval_required_tools=_claude_approval_required_tools(pack),
            mcp_servers=_claude_mcp_servers(self._config, pack),
            can_use_tool_bridge=can_use_tool_bridge,
            correlation_id=pack.correlation_id,
        )

    async def _iterate_session(
        self,
        handle: AttemptHandle,
        events: AsyncIterator[RawClaudeCodeEvent],
    ) -> AsyncIterator[RawClaudeCodeEvent]:
        try:
            iterator = events.__aiter__()
            while True:
                next_event: asyncio.Future[RawClaudeCodeEvent] = asyncio.ensure_future(iterator.__anext__())
                cancel_event = self._cancel_events.get(handle.handle_id)
                cancel_wait: asyncio.Future[Any] | None = None
                wait_for: set[asyncio.Future[Any]] = {next_event}
                if cancel_event is not None:
                    cancel_wait = asyncio.ensure_future(cancel_event.wait())
                    wait_for.add(cancel_wait)
                done, pending = await asyncio.wait(wait_for, return_when=asyncio.FIRST_COMPLETED)
                if cancel_wait is not None and cancel_wait in done:
                    await _cancel_task(next_event)
                    for task in pending:
                        await _cancel_task(task)
                    handle.state = AttemptState.CANCELLED
                    handle.finished_at = utc_now_ms()
                    return
                if cancel_wait is not None:
                    await _cancel_task(cancel_wait)

                try:
                    event = next_event.result()
                except StopAsyncIteration:
                    return
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
                "Claude Code session raised an internal exception.",
                retryable=False,
                payload={"exception_type": type(exc).__name__},
            )
            self._errors[handle.handle_id] = [error]
            handle.state = AttemptState.FAILED
            handle.finished_at = utc_now_ms()
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                error.message,
                payload=error.payload,
            ) from exc

    def _translate_raw_event(self, handle: AttemptHandle, raw_event: RawClaudeCodeEvent) -> list[StreamEventBase]:
        event_type = _required_str(raw_event, "type")
        if event_type == "text_delta":
            return [
                self._model_event(
                    handle,
                    event_type="model.text_delta",
                    phase=EventPhase.ATTEMPT_STREAMING,
                    title="Claude Code text delta",
                    payload={"delta_text": _optional_str(raw_event, "text") or ""},
                )
            ]
        if event_type == "thinking_delta":
            return [
                self._model_event(
                    handle,
                    event_type="model.thinking_delta",
                    phase=EventPhase.ATTEMPT_STREAMING,
                    title="Claude Code thinking delta",
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
                    title="Claude Code tool call started",
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
                    title="Claude Code tool call completed",
                    payload={
                        "result_summary": _optional_str(raw_event, "result_summary") or "",
                        "duration_ms": _int_value(raw_event.get("duration_ms")),
                        "output_artifact_refs": _list_of_mappings(raw_event.get("output_artifact_refs")),
                    },
                    tool_id=tool_id,
                    invocation_id=_optional_str(raw_event, "invocation_id"),
                )
            ]
        if event_type == "permission_prompt":
            tool_id = _permission_tool_id(raw_event)
            args = _mapping_or_empty(raw_event.get("args"))
            args_hash = _optional_str(raw_event, "args_hash") or _stable_hash(args)
            handle.state = AttemptState.AWAITING_HUMAN
            approval_event = self._tool_event(
                handle,
                event_type="tool.approval_required",
                title="Claude Code tool approval required",
                payload={"tool_id": tool_id, "args_hash": args_hash},
                tool_id=tool_id,
                invocation_id=_optional_str(raw_event, "invocation_id"),
                display_level=DisplayLevel.DETAILED,
            )
            self._pending_tool_approvals[handle.handle_id] = _PendingToolApproval(
                tool_id=tool_id,
                invocation_id=_optional_str(raw_event, "invocation_id"),
                approval_event_id=approval_event.event_id,
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
                title="Claude Code permission required",
                payload=human_payload,
                decision_key=_optional_str(raw_event, "decision_key") or _first_decision_key(decisions),
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
                    title="Claude Code request completed",
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
                _optional_str(raw_event, "message") or "Claude Code attempt failed.",
                retryable=False,
            )
        return self._fail_attempt(
            handle,
            "AA_RUN_INTERNAL",
            f"Unknown Claude Code event type: {event_type}",
            retryable=False,
        )

    def _complete_attempt(self, handle: AttemptHandle, raw_event: RawClaudeCodeEvent) -> list[StreamEventBase]:
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
                    title="Claude Code attempt failed",
                    payload=_attempt_failed_payload(error, self._packs[handle.handle_id]),
                )
            ]

        self._outputs[handle.handle_id] = output
        handle.state = AttemptState.COMPLETED
        handle.finished_at = utc_now_ms()
        return [
            self._lifecycle_event(
                handle,
                event_type="attempt.completed",
                phase=EventPhase.ATTEMPT_COMPLETED,
                title="Claude Code attempt completed",
                payload={
                    "output_hash": _stable_hash(output),
                    "duration_ms": 0,
                    "usage": RunUsage().model_dump(mode="json"),
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
                title="Claude Code attempt failed",
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
                "Claude Code output validation supports only object output schemas in this slice.",
                retryable=False,
                payload={"schema_type": schema_type},
            )
        required = schema.get("required", [])
        if isinstance(required, list):
            missing = [key for key in required if isinstance(key, str) and key not in output]
            if missing:
                return build_adapter_error(
                    "AA_RUN_OUTPUT_VALIDATION_FAILED",
                    "Claude Code output is missing required fields.",
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
                        "Claude Code output field has the wrong JSON type.",
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
            title="Claude Code attempt failed",
            payload=_attempt_failed_payload(exc.adapter_error, self._packs[handle.handle_id]),
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
        event_type: Literal[
            "tool.call_started",
            "tool.call_completed",
            "tool.approval_required",
            "tool.approved",
            "tool.rejected",
        ],
        title: str,
        payload: dict[str, Any],
        tool_id: str,
        invocation_id: str | None,
        display_level: DisplayLevel = DisplayLevel.DEFAULT,
        parent_event_id: str | None = None,
    ) -> ToolEvent:
        return ToolEvent(
            event_id=new_runtime_id(),
            seq=self._next_seq(handle),
            run_id=handle.run_id,
            node_id=handle.node_id,
            attempt_id=handle.attempt_id,
            parent_event_id=parent_event_id,
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

    def _tool_approval_result_event(
        self,
        handle: AttemptHandle,
        resumption: AttemptResumption,
    ) -> ToolEvent | None:
        pending = self._pending_tool_approvals.pop(handle.handle_id, None)
        if pending is None:
            return None
        decision = resumption.human_decision
        if decision is None:
            return None
        if _permission_decision_approves(decision.key, pending.invocation_id):
            return self._tool_event(
                handle,
                event_type="tool.approved",
                title="Claude Code tool approved",
                payload={"tool_id": pending.tool_id, "decision_by": decision.by},
                tool_id=pending.tool_id,
                invocation_id=pending.invocation_id,
                display_level=DisplayLevel.MINIMAL,
                parent_event_id=pending.approval_event_id,
            )
        return self._tool_event(
            handle,
            event_type="tool.rejected",
            title="Claude Code tool rejected",
            payload={"tool_id": pending.tool_id, "reason": decision.custom_value or decision.key},
            tool_id=pending.tool_id,
            invocation_id=pending.invocation_id,
            display_level=DisplayLevel.DEFAULT,
            parent_event_id=pending.approval_event_id,
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


def build_claude_code_descriptor() -> AdapterDescriptor:
    return ClaudeCodeAdapter.descriptor()


def _render_prompt(pack: ExecutionPack) -> str:
    contract = pack.node_contract_snapshot
    prompt = contract.prompt
    parts: list[str] = [f"Goal:\n{contract.goal}"]
    if prompt is not None:
        parts.extend(_prompt_parts("System", prompt.system_prompt))
        parts.extend(_prompt_parts("Instructions", prompt.instructions))
        parts.append(f"User:\n{prompt.user_prompt_template}")
    fragment_texts = [fragment.text for fragment in pack.context_pack.fragments if fragment.text]
    if fragment_texts:
        parts.append("Context:\n" + "\n\n".join(fragment_texts))
    return "\n\n".join(parts)


def _prompt_parts(label: str, value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [f"{label}:\n{value}"]
    return [f"{label}:\n" + "\n".join(value)]


def _claude_allowed_tools(pack: ExecutionPack) -> list[str]:
    contract = pack.node_contract_snapshot
    allowed_tools: list[str] = []
    allowed_tools.extend(contract.allowed_tools)
    allowed_tools.extend(pack.effective_toolsets.builtin_tools)
    allowed_tools.extend([_claude_mcp_server_tool(server_id) for server_id in pack.effective_toolsets.mcp_server_ids])
    allowed_tools.extend(_claude_mcp_tool_ref(tool.server_id, tool.tool_name) for tool in contract.mcp_tools)
    return _unique_strings(allowed_tools)


def _claude_auto_approved_tools(pack: ExecutionPack, *, can_use_tool_bridge: bool) -> list[str]:
    allowed_tools = _claude_allowed_tools(pack)
    if not can_use_tool_bridge:
        return allowed_tools
    approval_required_tools = _claude_approval_required_tools(pack)
    return [
        tool_ref
        for tool_ref in allowed_tools
        if not any(
            _claude_tool_ref_overlaps(tool_ref, approval_tool_ref) for approval_tool_ref in approval_required_tools
        )
    ]


def _claude_approval_required_tools(pack: ExecutionPack) -> list[str]:
    return _unique_strings(
        [
            _claude_mcp_tool_ref(tool.server_id, tool.tool_name)
            for tool in pack.node_contract_snapshot.mcp_tools
            if tool.requires_approval
        ]
    )


def _can_use_tool_bridge_enabled(config: AdapterConfig) -> bool:
    return config.settings.get("enable_can_use_tool_bridge") is True


def _claude_mcp_servers(config: AdapterConfig, pack: ExecutionPack) -> dict[str, Any]:
    requested_server_ids = _claude_requested_mcp_server_ids(pack)
    if not requested_server_ids:
        return {}
    configured_servers = _project_mcp_servers(config, pack)
    if configured_servers is None:
        configured_servers = _configured_mcp_servers(config)
    missing_server_ids = [server_id for server_id in requested_server_ids if server_id not in configured_servers]
    if missing_server_ids:
        raise AdapterRuntimeError(
            "AA_RUN_TOOL_NOT_FOUND",
            "Claude Code MCP server configuration is missing for requested MCP tools.",
            payload={
                "missing_mcp_server_ids": missing_server_ids,
                "requested_mcp_server_ids": requested_server_ids,
            },
        )
    return {server_id: configured_servers[server_id] for server_id in requested_server_ids}


def _project_mcp_servers(config: AdapterConfig, pack: ExecutionPack) -> dict[str, Any] | None:
    project_root = _project_root_from_pack(pack)
    if project_root is None:
        return None
    project_root_path = Path(project_root)
    project_configs = load_project_mcp_server_configs(project_root_path)
    requested_server_ids = _claude_requested_mcp_server_ids(pack)
    requested_configs = {
        server_id: project_configs[server_id] for server_id in requested_server_ids if server_id in project_configs
    }
    secret_resolver = (
        _project_mcp_secret_resolver(config, project_root=project_root_path)
        if _project_mcp_configs_require_secret_resolution(requested_configs)
        else None
    )
    _reject_project_mcp_configs_requiring_future_lifecycle(
        requested_configs,
        secret_resolver_available=secret_resolver is not None,
    )
    return {
        server_id: _claude_project_mcp_server_config(
            project_config,
            secret_resolution=_project_mcp_secret_resolution(project_config, secret_resolver),
        )
        for server_id, project_config in requested_configs.items()
    }


def _project_mcp_configs_require_secret_resolution(
    project_configs: Mapping[str, ProjectMCPServerConfig],
) -> bool:
    return any(project_config.secret_ref for project_config in project_configs.values())


def _reject_project_mcp_configs_requiring_future_lifecycle(
    project_configs: Mapping[str, ProjectMCPServerConfig],
    *,
    secret_resolver_available: bool,
) -> None:
    secret_server_ids = [
        server_id
        for server_id, project_config in project_configs.items()
        if project_config.secret_ref and not secret_resolver_available
    ]
    approval_server_ids = [
        server_id for server_id, project_config in project_configs.items() if project_config.requires_approval
    ]
    if not secret_server_ids and not approval_server_ids:
        return
    payload: dict[str, Any] = {}
    if secret_server_ids:
        payload["unresolved_secret_mcp_server_ids"] = secret_server_ids
    if approval_server_ids:
        payload["approval_required_mcp_server_ids"] = approval_server_ids
    raise AdapterRuntimeError(
        "AA_RUN_TOOL_NOT_FOUND",
        "Project MCP server configuration requires lifecycle support not implemented by ClaudeCodeAdapter.",
        payload=payload,
    )


def _project_mcp_secret_resolver(
    config: AdapterConfig,
    *,
    project_root: Path,
) -> ClaudeCodeMCPSecretResolver | None:
    raw_resolver = config.settings.get("project_mcp_secret_resolver")
    if raw_resolver is None:
        raw_decryptor = config.settings.get("project_mcp_secret_decryptor")
        if raw_decryptor is None:
            return None
        if not callable(raw_decryptor):
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "ClaudeCodeAdapter settings.project_mcp_secret_decryptor must be callable.",
                payload={"decryptor_type": type(raw_decryptor).__name__},
            )
        return build_claude_project_mcp_secret_resolver(
            project_root,
            decrypt_secret=cast(ProjectSecretDecryptor, raw_decryptor),
        )
    if not callable(raw_resolver):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "ClaudeCodeAdapter settings.project_mcp_secret_resolver must be callable.",
            payload={"resolver_type": type(raw_resolver).__name__},
        )
    return cast(ClaudeCodeMCPSecretResolver, raw_resolver)


def build_claude_project_mcp_secret_resolver(
    project_root: str | Path,
    *,
    decrypt_secret: ProjectSecretDecryptor,
) -> ClaudeCodeMCPSecretResolver:
    """Build a Claude MCP resolver backed by the project secure secret store."""

    project_root_path = Path(project_root)

    def resolve_secret(project_config: ProjectMCPServerConfig) -> ClaudeCodeMCPSecretResolution | None:
        if project_config.secret_ref is None:
            return None
        material = load_project_mcp_secret_material(
            project_root_path,
            project_config.secret_ref,
            decrypt_secret=decrypt_secret,
        )
        if material is None:
            return None
        return ClaudeCodeMCPSecretResolution(headers=dict(material.headers), env=dict(material.env))

    return resolve_secret


def _project_mcp_secret_resolution(
    project_config: ProjectMCPServerConfig,
    secret_resolver: ClaudeCodeMCPSecretResolver | None,
) -> ClaudeCodeMCPSecretResolution | None:
    if project_config.secret_ref is None:
        return None
    if secret_resolver is None:
        raise _unresolved_project_mcp_secret_error(project_config.server_id)
    try:
        secret_resolution: object | None = secret_resolver(project_config)
    except AdapterRuntimeError:
        raise
    except Exception as exc:
        raise AdapterRuntimeError(
            "AA_RUN_TOOL_NOT_FOUND",
            "Project MCP server secret resolver failed.",
            payload={
                "unresolved_secret_mcp_server_ids": [project_config.server_id],
                "resolver_error_type": type(exc).__name__,
            },
        ) from exc
    if secret_resolution is None:
        raise _unresolved_project_mcp_secret_error(project_config.server_id)
    if not isinstance(secret_resolution, ClaudeCodeMCPSecretResolution):
        raise AdapterRuntimeError(
            "AA_RUN_TOOL_NOT_FOUND",
            "Project MCP server secret resolver returned an invalid resolution.",
            payload={
                "unresolved_secret_mcp_server_ids": [project_config.server_id],
                "resolver_result_type": type(secret_resolution).__name__,
            },
        )
    return secret_resolution


def _unresolved_project_mcp_secret_error(server_id: str) -> AdapterRuntimeError:
    return AdapterRuntimeError(
        "AA_RUN_TOOL_NOT_FOUND",
        "Project MCP server secret could not be resolved by ClaudeCodeAdapter.",
        payload={"unresolved_secret_mcp_server_ids": [server_id]},
    )


def _claude_project_mcp_server_config(
    project_config: ProjectMCPServerConfig,
    *,
    secret_resolution: ClaudeCodeMCPSecretResolution | None,
) -> dict[str, Any]:
    transport = project_config.transport
    if transport in {"http", "sse"}:
        mcp_server_config: dict[str, Any] = {"type": transport, "url": project_config.command_or_url}
        _apply_project_mcp_secret_resolution(mcp_server_config, secret_resolution)
        return mcp_server_config
    if transport == "stdio":
        mcp_server_config = {"command": project_config.command_or_url}
        _apply_project_mcp_secret_resolution(mcp_server_config, secret_resolution)
        return mcp_server_config
    raise AdapterRuntimeError(
        "AA_RUN_TOOL_NOT_FOUND",
        "Project MCP server transport is not supported by ClaudeCodeAdapter.",
        payload={
            "server_id": project_config.server_id,
            "transport": transport,
            "supported_transports": ["http", "sse", "stdio"],
        },
    )


def _apply_project_mcp_secret_resolution(
    mcp_server_config: dict[str, Any],
    secret_resolution: ClaudeCodeMCPSecretResolution | None,
) -> None:
    if secret_resolution is None:
        return
    if secret_resolution.headers:
        mcp_server_config["headers"] = dict(secret_resolution.headers)
    if secret_resolution.env:
        mcp_server_config["env"] = dict(secret_resolution.env)


def _project_root_from_pack(pack: ExecutionPack) -> str | None:
    cw_metadata = pack.metadata.get("cw")
    if not isinstance(cw_metadata, Mapping):
        return None
    project_root = cw_metadata.get("project_root")
    if not isinstance(project_root, str) or project_root == "":
        return None
    return project_root


def _claude_requested_mcp_server_ids(pack: ExecutionPack) -> list[str]:
    requested_server_ids: list[str] = []
    requested_server_ids.extend(pack.effective_toolsets.mcp_server_ids)
    requested_server_ids.extend(tool.server_id for tool in pack.node_contract_snapshot.mcp_tools)
    return _unique_strings(requested_server_ids)


def _configured_mcp_servers(config: AdapterConfig) -> dict[str, Any]:
    raw_servers = config.settings.get("mcp_servers", {})
    if raw_servers is None:
        return {}
    if not isinstance(raw_servers, Mapping):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "ClaudeCodeAdapter settings.mcp_servers must be a mapping of server id to SDK MCP server config.",
            payload={"mcp_servers_type": type(raw_servers).__name__},
        )
    configured_servers: dict[str, Any] = {}
    for raw_server_id, raw_server_config in raw_servers.items():
        if not isinstance(raw_server_id, str) or not raw_server_id:
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "ClaudeCodeAdapter settings.mcp_servers contains a non-string server id.",
                payload={"server_id_type": type(raw_server_id).__name__},
            )
        if raw_server_config is None:
            raise AdapterRuntimeError(
                "AA_RUN_INTERNAL",
                "ClaudeCodeAdapter settings.mcp_servers contains an empty server config.",
                payload={"server_id": raw_server_id},
            )
        configured_servers[raw_server_id] = raw_server_config
    return configured_servers


def _claude_mcp_tool_ref(server_id: str, tool_name: str) -> str:
    return _claude_mcp_server_tool(server_id) if tool_name == "*" else f"mcp__{server_id}__{tool_name}"


def _claude_mcp_server_tool(server_id: str) -> str:
    return f"mcp__{server_id}__*"


def _build_sdk_client(
    sdk: ModuleType,
    request: ClaudeCodeRunRequest,
    run_state: _ClaudeCodeSDKRunState,
) -> object:
    options_cls = getattr(sdk, "ClaudeAgentOptions", None)
    client_cls = getattr(sdk, "ClaudeSDKClient", None)
    if not callable(options_cls) or not callable(client_cls):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "Claude Agent SDK is missing ClaudeAgentOptions or ClaudeSDKClient.",
            payload={
                "has_options": callable(options_cls),
                "has_client": callable(client_cls),
            },
        )
    try:
        options = options_cls(**_sdk_options_kwargs(sdk, request, run_state))
        return client_cls(options=options)
    except TypeError as exc:
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "Claude Agent SDK client could not be constructed from CW request options.",
            payload={"exception_type": type(exc).__name__},
        ) from exc


def _sdk_options_kwargs(
    sdk: ModuleType,
    request: ClaudeCodeRunRequest,
    run_state: _ClaudeCodeSDKRunState,
) -> dict[str, Any]:
    options: dict[str, Any] = {
        "tools": {"type": "preset", "preset": "claude_code"},
        "allowed_tools": list(request.allowed_tools),
        "mcp_servers": dict(request.mcp_servers),
        "permission_mode": "default" if request.can_use_tool_bridge else "dontAsk",
        "system_prompt": {"type": "preset", "preset": "claude_code"},
        "setting_sources": [],
    }
    if request.can_use_tool_bridge:
        options["can_use_tool"] = _sdk_can_use_tool_callback(sdk, request, run_state)
        options["hooks"] = _sdk_can_use_tool_hooks(sdk)
    return options


def _sdk_can_use_tool_callback(
    sdk: ModuleType,
    request: ClaudeCodeRunRequest,
    run_state: _ClaudeCodeSDKRunState,
) -> Callable[[str, dict[str, Any], object], Any]:
    async def can_use_tool(tool_name: str, input_data: dict[str, Any], _context: object) -> object:
        tool_input = dict(input_data)
        if not _claude_tool_ref_matches(tool_name, request.permitted_tools):
            return _sdk_permission_deny(
                sdk,
                "Claude Code tool request is outside the CW NodeContract permission boundary.",
            )
        if not _claude_tool_ref_matches(tool_name, request.approval_required_tools):
            return _sdk_permission_allow(sdk, tool_input)

        pending = _enqueue_sdk_permission_prompt(run_state, tool_name=tool_name, input_data=tool_input)
        resumption = await pending.future
        if _permission_resumption_approved(resumption, pending.permission_id):
            return _sdk_permission_allow(sdk, tool_input)
        return _sdk_permission_deny(sdk, _permission_resumption_denial_message(resumption))

    return can_use_tool


def _sdk_can_use_tool_hooks(sdk: ModuleType) -> dict[str, list[object]]:
    hook_matcher_cls = _sdk_optional_callable(sdk, "HookMatcher")
    if hook_matcher_cls is None:
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "Claude Agent SDK permission bridge requires HookMatcher for the PreToolUse keepalive hook.",
            payload={"module": "claude_agent_sdk", "missing": "HookMatcher"},
        )
    try:
        return {"PreToolUse": [hook_matcher_cls(matcher=None, hooks=[_sdk_pre_tool_use_keepalive_hook])]}
    except TypeError as exc:
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "Claude Agent SDK HookMatcher could not be constructed for the permission bridge.",
            payload={"exception_type": type(exc).__name__},
        ) from exc


async def _sdk_pre_tool_use_keepalive_hook(_input_data: object, _tool_use_id: str, _context: object) -> dict[str, bool]:
    return {"continue_": True}


def _sdk_permission_allow(sdk: ModuleType, input_data: dict[str, Any]) -> object:
    allow_cls = _sdk_required_callable(sdk, "PermissionResultAllow")
    return allow_cls(updated_input=dict(input_data))


def _sdk_permission_deny(sdk: ModuleType, message: str) -> object:
    deny_cls = _sdk_required_callable(sdk, "PermissionResultDeny")
    try:
        return deny_cls(message=message, interrupt=False)
    except TypeError:
        return deny_cls(message=message)


def _sdk_required_callable(sdk: ModuleType, name: str) -> Callable[..., object]:
    value = _sdk_optional_callable(sdk, name)
    if value is None:
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            f"Claude Agent SDK permission bridge requires {name}.",
            payload={"module": "claude_agent_sdk", "missing": name},
        )
    return value


def _sdk_optional_callable(sdk: ModuleType, name: str) -> Callable[..., object] | None:
    value = getattr(sdk, name, None)
    if callable(value):
        return cast(Callable[..., object], value)
    types_module = _sdk_types_module(sdk)
    if types_module is None:
        return None
    value = getattr(types_module, name, None)
    if callable(value):
        return cast(Callable[..., object], value)
    return None


def _sdk_types_module(sdk: ModuleType) -> ModuleType | None:
    sdk_name = getattr(sdk, "__name__", "")
    if not sdk_name:
        return None
    try:
        return importlib.import_module(f"{sdk_name}.types")
    except ImportError:
        return None


def _enqueue_sdk_permission_prompt(
    run_state: _ClaudeCodeSDKRunState,
    *,
    tool_name: str,
    input_data: dict[str, Any],
) -> _ClaudeCodePendingPermission:
    if run_state.pending_permission is not None and not run_state.pending_permission.future.done():
        return run_state.pending_permission

    loop = asyncio.get_running_loop()
    permission_id = f"perm_{new_runtime_id()}"
    pending = _ClaudeCodePendingPermission(
        permission_id=permission_id,
        tool_name=tool_name,
        input_data=dict(input_data),
        future=loop.create_future(),
    )
    run_state.pending_permission = pending
    run_state.permission_events.put_nowait(
        {
            "type": "permission_prompt",
            "tool_id": tool_name,
            "invocation_id": permission_id,
            "args": dict(input_data),
            "args_hash": _stable_hash(input_data),
            "prompt": f"Claude Code requests approval to use {tool_name}.",
            "decisions": [
                {"key": f"approve:{permission_id}", "label": "Approve"},
                {"key": f"reject:{permission_id}", "label": "Reject"},
            ],
        }
    )
    return pending


def _resolve_pending_sdk_permission(run_state: _ClaudeCodeSDKRunState, resumption: AttemptResumption) -> bool:
    pending = run_state.pending_permission
    if pending is None:
        return False
    if not pending.future.done():
        pending.future.set_result(resumption)
    run_state.pending_permission = None
    return True


def _cancel_pending_sdk_permission(run_state: _ClaudeCodeSDKRunState) -> None:
    pending = run_state.pending_permission
    if pending is None:
        return
    if not pending.future.done():
        pending.future.set_result(None)
    run_state.pending_permission = None


def _permission_resumption_approved(resumption: AttemptResumption | None, permission_id: str) -> bool:
    if resumption is None or resumption.human_decision is None:
        return False
    return _permission_decision_approves(resumption.human_decision.key, permission_id)


def _permission_resumption_denial_message(resumption: AttemptResumption | None) -> str:
    if resumption is not None and resumption.human_decision is not None and resumption.human_decision.custom_value:
        return resumption.human_decision.custom_value
    return "Human rejected the Claude Code tool request."


def _claude_tool_ref_matches(tool_name: str, tool_refs: list[str]) -> bool:
    for tool_ref in tool_refs:
        if tool_ref == tool_name:
            return True
        if tool_ref.endswith("*") and tool_name.startswith(tool_ref[:-1]):
            return True
    return False


def _claude_tool_ref_overlaps(left: str, right: str) -> bool:
    if left == right:
        return True
    if left.endswith("*") and right.startswith(left[:-1]):
        return True
    return right.endswith("*") and left.startswith(right[:-1])


def _permission_decision_approves(decision_key: str, invocation_id: str | None) -> bool:
    approve_keys = {"continue", "approve"}
    if invocation_id is not None:
        approve_keys.add(f"approve:{invocation_id}")
    return decision_key in approve_keys


async def _connect_sdk_client(client: object) -> None:
    await _call_required_async_method(client, "connect")


async def _query_sdk_client(client: object, prompt: str) -> None:
    await _call_required_async_method(client, "query", prompt)


def _sdk_client_message_iterator(client: object) -> AsyncIterator[object]:
    receiver = getattr(client, "receive_response", None)
    if not callable(receiver):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "Claude Agent SDK client is missing receive_response().",
        )
    messages = receiver()
    if not hasattr(messages, "__aiter__"):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "Claude Agent SDK receive_response() did not return an async iterator.",
            payload={"messages_type": type(messages).__name__},
        )
    return cast(AsyncIterator[object], messages.__aiter__())


async def _receive_sdk_client_raw_events(run_state: _ClaudeCodeSDKRunState) -> AsyncIterator[RawClaudeCodeEvent]:
    while True:
        if run_state.raw_event_buffer:
            yield run_state.raw_event_buffer.pop(0)
            continue

        permission_task = asyncio.create_task(run_state.permission_events.get())
        if run_state.next_message is None:
            run_state.next_message = asyncio.create_task(_receive_next_sdk_client_raw_events(run_state))
        done, pending = await asyncio.wait(
            {permission_task, run_state.next_message},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if permission_task in done:
            for task in pending:
                if task is not run_state.next_message:
                    await _cancel_task(task)
            yield permission_task.result()
            continue

        await _cancel_task(permission_task)
        next_message = run_state.next_message
        if next_message not in done:
            continue
        try:
            raw_events = next_message.result()
        except StopAsyncIteration:
            run_state.next_message = None
            return
        run_state.next_message = None
        run_state.raw_event_buffer.extend(raw_events)


async def _receive_next_sdk_client_raw_events(
    run_state: _ClaudeCodeSDKRunState,
) -> list[RawClaudeCodeEvent]:
    message_iterator = run_state.message_iterator
    if message_iterator is None:
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            "Claude Agent SDK receive loop was not initialized.",
            payload={"handle_id": run_state.handle_id},
        )
    message = await message_iterator.__anext__()
    return _sdk_message_to_raw_events(message)


def _sdk_message_to_raw_events(message: object) -> list[RawClaudeCodeEvent]:
    if _sdk_has_result(message):
        return _sdk_result_message_to_raw_events(message)
    content = _sdk_content_blocks(message)
    if content:
        raw_events: list[RawClaudeCodeEvent] = []
        for block in content:
            event = _sdk_content_block_to_raw_event(block)
            if event is not None:
                raw_events.append(event)
        if raw_events:
            return raw_events
        return [
            {
                "type": "failed",
                "message": f"Claude Agent SDK emitted unsupported content block types from message type: {_sdk_kind(message)}.",
            }
        ]
    if _sdk_kind(message) == "AssistantMessageError":
        return [
            {
                "type": "failed",
                "message": _sdk_str_attr(message, "message") or "Claude Agent SDK assistant message error.",
            }
        ]
    return [
        {
            "type": "failed",
            "message": f"Claude Agent SDK emitted unsupported message type: {_sdk_kind(message)}.",
        }
    ]


def _sdk_result_message_to_raw_events(message: object) -> list[RawClaudeCodeEvent]:
    usage = _sdk_usage_mapping(_sdk_attr(message, "usage"))
    finish_reason = _sdk_str_attr(message, "subtype") or "stop"
    latency_ms = _int_value(_sdk_attr(message, "duration_ms"))
    request_completed: RawClaudeCodeEvent = {
        "type": "request_completed",
        "usage": usage,
        "finish_reason": finish_reason,
        "latency_ms": latency_ms,
    }
    if _sdk_result_is_error(message):
        return [
            request_completed,
            {
                "type": "failed",
                "message": _sdk_result_error_message(message),
            },
        ]
    return [
        request_completed,
        {
            "type": "completed",
            "output": _sdk_result_output(message),
            "usage": usage,
        },
    ]


def _sdk_content_block_to_raw_event(block: object) -> RawClaudeCodeEvent | None:
    block_kind = _sdk_kind(block)
    tool_name = _sdk_str_attr(block, "name") or _sdk_str_attr(block, "tool_name")
    tool_input = _sdk_attr(block, "input")
    if block_kind == "ToolUseBlock" or (tool_name is not None and tool_input is not None):
        args = _sdk_tool_args(tool_input)
        return {
            "type": "tool_call_started",
            "tool_id": tool_name or "unknown",
            "args": args,
            "args_hash": _stable_hash(args),
            "requires_approval": False,
            "invocation_id": _sdk_tool_invocation_id(block),
        }

    tool_use_id = _sdk_str_attr(block, "tool_use_id")
    if block_kind == "ToolResultBlock" or tool_use_id is not None:
        return {
            "type": "tool_call_completed",
            "tool_id": tool_name or "unknown",
            "result_summary": _summary_text(_sdk_attr(block, "content")),
            "duration_ms": 0,
            "invocation_id": tool_use_id,
        }

    thinking = _sdk_str_attr(block, "thinking")
    if block_kind == "ThinkingBlock" or thinking is not None:
        return {"type": "thinking_delta", "text": thinking or _sdk_str_attr(block, "text") or ""}

    text = _sdk_str_attr(block, "text")
    if block_kind == "TextBlock" or text is not None:
        return {"type": "text_delta", "text": text or ""}
    if isinstance(block, str) and block:
        return {"type": "text_delta", "text": block}
    return None


def _sdk_has_result(message: object) -> bool:
    return _sdk_kind(message) == "ResultMessage" or _sdk_attr(message, "result") is not None


def _sdk_result_is_error(message: object) -> bool:
    is_error = _sdk_attr(message, "is_error")
    if isinstance(is_error, bool):
        return is_error
    subtype = _sdk_str_attr(message, "subtype")
    return subtype is not None and subtype not in {"success", "stop"}


def _sdk_result_error_message(message: object) -> str:
    error = _sdk_attr(message, "error")
    if isinstance(error, BaseException):
        return str(error)
    if isinstance(error, str) and error:
        return error
    result = _sdk_attr(message, "result")
    return str(result) if result is not None else "Claude Agent SDK result reported failure."


def _sdk_result_output(message: object) -> dict[str, Any]:
    for field_name in ("structured_output", "output", "result"):
        value = _sdk_attr(message, field_name)
        if isinstance(value, Mapping):
            return _mapping_or_empty(value)
        if isinstance(value, str) and value:
            decoded = _json_object_or_none(value)
            if decoded is not None:
                return decoded
            if field_name == "result":
                return {"result": value}
    return {}


def _sdk_content_blocks(message: object) -> list[object]:
    content = _sdk_attr(message, "content")
    if isinstance(content, list):
        return list(content)
    if isinstance(content, str) and content:
        return [content]
    return []


def _sdk_tool_args(value: object) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return _mapping_or_empty(value)
    if isinstance(value, str) and value:
        decoded = _json_object_or_none(value)
        if decoded is not None:
            return decoded
        return {"raw": value}
    return {}


def _sdk_tool_invocation_id(block: object) -> str | None:
    return _sdk_str_attr(block, "id") or _sdk_str_attr(block, "tool_use_id") or _sdk_str_attr(block, "tool_call_id")


def _sdk_usage_mapping(value: object) -> dict[str, Any]:
    usage = value() if callable(value) else value
    if isinstance(usage, Mapping):
        return _mapping_or_empty(usage)
    jsonable = _jsonable_model(usage)
    if isinstance(jsonable, Mapping):
        return _mapping_or_empty(jsonable)
    return {}


def _sdk_kind(value: object) -> str:
    return type(value).__name__


def _sdk_attr(value: object, name: str) -> object:
    if isinstance(value, Mapping):
        return value.get(name)
    return getattr(value, name, None)


def _sdk_str_attr(value: object, name: str) -> str | None:
    attr = _sdk_attr(value, name)
    return attr if isinstance(attr, str) and attr else None


def _json_object_or_none(value: str) -> dict[str, Any] | None:
    try:
        decoded = json.loads(value)
    except ValueError:
        return None
    if isinstance(decoded, Mapping):
        return _mapping_or_empty(decoded)
    return None


def _jsonable_model(value: object) -> object:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, Mapping):
        return {str(key): _jsonable_model(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable_model(item) for item in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump(mode="json")
        return _jsonable_model(dumped)
    dataclass_dict = getattr(value, "__dict__", None)
    if isinstance(dataclass_dict, Mapping):
        return {str(key): _jsonable_model(item) for key, item in dataclass_dict.items() if not key.startswith("_")}
    return str(value)


def _summary_text(value: object, *, max_chars: int = 400) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(_jsonable_model(value), ensure_ascii=False, sort_keys=True, default=str)
        except TypeError:
            text = str(value)
    if len(text) <= max_chars:
        return text
    return f"{text[: max_chars - 3]}..."


def _resume_prompt(resumption: AttemptResumption) -> str:
    decision = resumption.human_decision
    if decision is None:
        raise AdapterRuntimeError(
            "AA_RESUME_INVALID_KIND",
            "Claude Agent SDK resume requires a human_decision payload.",
            payload={"kind": resumption.kind.value},
        )
    parts = [f"Human decision: {decision.key}"]
    if decision.custom_value is not None:
        parts.append(f"Additional human input: {decision.custom_value}")
    return "\n".join(parts)


async def _close_sdk_client(client: object) -> bool:
    for method_name in ("disconnect", "aclose", "close"):
        if await _call_optional_async_method(client, method_name):
            return True
    return False


async def _call_required_async_method(target: object, method_name: str, *args: object) -> None:
    if not await _call_optional_async_method(target, method_name, *args):
        raise AdapterRuntimeError(
            "AA_RUN_INTERNAL",
            f"Claude Agent SDK client is missing {method_name}().",
            payload={"method": method_name},
        )


async def _call_optional_async_method(target: object, method_name: str, *args: object) -> bool:
    method = getattr(target, method_name, None)
    if not callable(method):
        return False
    result = method(*args)
    if inspect.isawaitable(result):
        await result
    return True


async def _cancel_task(task: asyncio.Future[Any]) -> None:
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


def _required_str(raw_event: RawClaudeCodeEvent, key: str) -> str:
    value = raw_event.get(key)
    if isinstance(value, str) and value:
        return value
    raise AdapterRuntimeError(
        "AA_RUN_INTERNAL",
        f"Claude Code event is missing required string field {key!r}.",
        payload={"field": key},
    )


def _optional_str(raw_event: RawClaudeCodeEvent, key: str) -> str | None:
    value = raw_event.get(key)
    return value if isinstance(value, str) else None


def _dict_or_empty(value: object) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, Mapping):
        return dict(value)
    raise AdapterRuntimeError(
        "AA_RUN_OUTPUT_VALIDATION_FAILED",
        "Claude Code completed event output must be an object.",
        payload={"output_type": type(value).__name__},
    )


def _mapping_or_empty(value: object) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return cast(dict[str, Any], json.loads(json.dumps(dict(value), ensure_ascii=False, default=str)))
    return {}


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


def _permission_tool_id(raw_event: RawClaudeCodeEvent) -> str:
    explicit_tool_id = _optional_str(raw_event, "tool_id")
    if explicit_tool_id is not None:
        return explicit_tool_id
    allowed_tools = raw_event.get("allowed_tools")
    if isinstance(allowed_tools, list):
        for item in allowed_tools:
            if isinstance(item, str) and item:
                return item
    return "claude_code.permission"


def _decisions(raw_event: RawClaudeCodeEvent) -> list[dict[str, Any]]:
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


def _unique_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value and value not in seen:
            result.append(value)
            seen.add(value)
    return result


__all__ = [
    "ClaudeCodeAdapter",
    "ClaudeCodeResumeRequest",
    "ClaudeCodeRunRequest",
    "ClaudeCodeSDKSession",
    "ClaudeCodeSession",
    "RawClaudeCodeEvent",
    "SessionFactory",
    "build_claude_code_descriptor",
]
