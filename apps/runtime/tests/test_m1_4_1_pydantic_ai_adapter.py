"""M1.4.1 PydanticAIAdapter foundation tests."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from types import ModuleType, SimpleNamespace, TracebackType
from typing import Any, ClassVar

import pytest

from cw_runtime.adapters import (
    AttemptResumption,
    HumanDecisionResolution,
    PydanticAIAdapter,
    PydanticAIMCPToolset,
    PydanticAIResumeRequest,
    PydanticAIRunRequest,
    PydanticAISession,
    PydanticAISessionFactory,
    PydanticAIToolsetRequest,
    PydanticAIToolsets,
    RawPydanticAIEvent,
    build_pydantic_ai_descriptor,
)
from cw_schemas.contract import ExecutionContract, MCPToolRef, NodeModelPolicy, PromptSection, RetryPolicy, SkillRef
from cw_schemas.events import StreamEventBase, ToolEvent
from cw_schemas.packs import (
    ContextBudget,
    ContextFragment,
    ContextPack,
    ContextProvenance,
    ExecutionPack,
    StaticTextSource,
    ToolsetSpec,
    UsageLimits,
)
from cw_schemas.types import AdapterKind, AttemptState, CancelReason, Priority, ProviderKind, ResumptionKind


class FakePydanticAISession:
    def __init__(
        self,
        *,
        run_events: list[RawPydanticAIEvent],
        resume_events: list[RawPydanticAIEvent] | None = None,
    ) -> None:
        self._run_events = run_events
        self._resume_events = [] if resume_events is None else resume_events
        self.run_request: PydanticAIRunRequest | None = None
        self.resume_request: PydanticAIResumeRequest | None = None
        self.cancelled: tuple[str, CancelReason] | None = None
        self.closed = False

    async def run(self, request: PydanticAIRunRequest) -> AsyncIterator[RawPydanticAIEvent]:
        self.run_request = request
        for event in self._run_events:
            yield event

    async def resume(self, request: PydanticAIResumeRequest) -> AsyncIterator[RawPydanticAIEvent]:
        self.resume_request = request
        for event in self._resume_events:
            yield event

    async def cancel(self, handle_id: str, reason: CancelReason) -> None:
        self.cancelled = (handle_id, reason)

    async def aclose(self) -> None:
        self.closed = True


class SlowPydanticAISession(FakePydanticAISession):
    def __init__(
        self,
        *,
        run_events: list[RawPydanticAIEvent],
        resume_events: list[RawPydanticAIEvent] | None = None,
        delay_run: bool = False,
        delay_resume: bool = False,
    ) -> None:
        super().__init__(run_events=run_events, resume_events=resume_events)
        self._delay_run = delay_run
        self._delay_resume = delay_resume

    async def run(self, request: PydanticAIRunRequest) -> AsyncIterator[RawPydanticAIEvent]:
        if self._delay_run:
            self.run_request = request
            await asyncio.sleep(10)
            return
        async for event in super().run(request):
            yield event

    async def resume(self, request: PydanticAIResumeRequest) -> AsyncIterator[RawPydanticAIEvent]:
        if self._delay_resume:
            self.resume_request = request
            await asyncio.sleep(10)
            return
        async for event in super().resume(request):
            yield event


class ErrorPydanticAISession(FakePydanticAISession):
    def __init__(self, *, exception: Exception) -> None:
        super().__init__(run_events=[])
        self._exception = exception

    async def run(self, request: PydanticAIRunRequest) -> AsyncIterator[RawPydanticAIEvent]:
        self.run_request = request
        for event in self._run_events:
            yield event
        raise self._exception


class FakeSDKUsage:
    input_tokens = 5
    output_tokens = 7
    cache_write_tokens = 2
    cache_read_tokens = 3
    requests = 1

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class FakeSDKMessage:
    def __init__(self, content: str = "sdk ok") -> None:
        self.content = content

    def model_dump(self, *, mode: str = "json") -> dict[str, Any]:
        return {"role": "assistant", "content": self.content, "mode": mode}


class FakeSDKResult:
    default_output: ClassVar[object] = {"answer": "sdk"}
    usage: ClassVar[FakeSDKUsage] = FakeSDKUsage()

    def __init__(self, output: object | None = None, messages: list[object] | None = None) -> None:
        self.output = FakeSDKResult.default_output if output is None else output
        self._messages: list[object] = [FakeSDKMessage()] if messages is None else messages

    def all_messages(self) -> list[object]:
        return self._messages

    def _traceparent(self, *, required: bool = True) -> str | None:
        return "00-sdk-trace"


class UsageLimitExceeded(RuntimeError):
    pass


class FakeSDKUsageLimits:
    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs


class FakeSDKApprovalRequiredToolset:
    def __init__(
        self,
        wrapped: object,
        approval_required_func: Callable[[Any, Any, dict[str, Any]], bool],
    ) -> None:
        self.wrapped = wrapped
        self.approval_required_func = approval_required_func


class FakeSDKToolset:
    def __init__(self, toolset_id: str) -> None:
        self.toolset_id = toolset_id


class FakeSDKToolCallPart:
    def __init__(self, tool_name: str, args: dict[str, Any], tool_call_id: str) -> None:
        self.tool_name = tool_name
        self.args = args
        self.tool_call_id = tool_call_id


class FakeSDKDeferredToolRequests:
    def __init__(
        self,
        *,
        calls: list[FakeSDKToolCallPart] | None = None,
        approvals: list[FakeSDKToolCallPart] | None = None,
        metadata: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        self.calls = [] if calls is None else calls
        self.approvals = [] if approvals is None else approvals
        self.metadata = {} if metadata is None else metadata


class FakeSDKToolApproved:
    def __init__(self, *, override_args: dict[str, Any] | None = None) -> None:
        self.override_args = override_args


class FakeSDKToolDenied:
    def __init__(self, message: str = "The tool call was denied.") -> None:
        self.message = message


class FakeSDKDeferredToolResults:
    def __init__(
        self,
        *,
        calls: dict[str, Any] | None = None,
        approvals: dict[str, Any] | None = None,
        metadata: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        self.calls = {} if calls is None else calls
        self.approvals = {} if approvals is None else approvals
        self.metadata = {} if metadata is None else metadata


class FakeSDKAgent:
    instances: ClassVar[list[FakeSDKAgent]] = []
    stream_events: ClassVar[list[object] | None] = None

    def __init__(self, model: str, **kwargs: Any) -> None:
        self.model = model
        self.kwargs = kwargs
        self.run_user_prompt: str | None = None
        self.run_model_settings: dict[str, Any] | None = None
        self.run_usage_limits: object | None = None
        self.stream_user_prompt: str | None = None
        self.stream_message_history: list[object] | None = None
        self.stream_deferred_tool_results: object | None = None
        self.stream_model_settings: dict[str, Any] | None = None
        self.stream_usage_limits: object | None = None
        FakeSDKAgent.instances.append(self)

    async def run(
        self,
        user_prompt: str | None = None,
        *,
        message_history: list[object] | None = None,
        deferred_tool_results: object | None = None,
        model_settings: dict[str, Any] | None = None,
        usage_limits: object | None = None,
    ) -> FakeSDKResult:
        self.run_user_prompt = user_prompt
        self.stream_message_history = message_history
        self.stream_deferred_tool_results = deferred_tool_results
        self.run_model_settings = model_settings
        self.run_usage_limits = usage_limits
        return FakeSDKResult()

    def run_stream_events(
        self,
        user_prompt: str | None = None,
        *,
        message_history: list[object] | None = None,
        deferred_tool_results: object | None = None,
        model_settings: dict[str, Any] | None = None,
        usage_limits: object | None = None,
    ) -> FakeSDKEventStream:
        self.stream_user_prompt = user_prompt
        self.stream_message_history = message_history
        self.stream_deferred_tool_results = deferred_tool_results
        self.stream_model_settings = model_settings
        self.stream_usage_limits = usage_limits
        events = FakeSDKAgent.stream_events
        return FakeSDKEventStream(_default_sdk_stream_events() if events is None else events)


class FakeSDKRunOnlyAgent:
    instances: ClassVar[list[FakeSDKRunOnlyAgent]] = []

    def __init__(self, model: str, **kwargs: Any) -> None:
        self.model = model
        self.kwargs = kwargs
        self.run_user_prompt: str | None = None
        self.run_message_history: list[object] | None = None
        self.run_deferred_tool_results: object | None = None
        self.run_model_settings: dict[str, Any] | None = None
        self.run_usage_limits: object | None = None
        FakeSDKRunOnlyAgent.instances.append(self)

    async def run(
        self,
        user_prompt: str | None = None,
        *,
        message_history: list[object] | None = None,
        deferred_tool_results: object | None = None,
        model_settings: dict[str, Any] | None = None,
        usage_limits: object | None = None,
    ) -> FakeSDKResult:
        self.run_user_prompt = user_prompt
        self.run_message_history = message_history
        self.run_deferred_tool_results = deferred_tool_results
        self.run_model_settings = model_settings
        self.run_usage_limits = usage_limits
        return FakeSDKResult()


class FakeSDKEventStream:
    def __init__(self, events: list[object]) -> None:
        self._events = events
        self._index = 0
        self.closed = False

    async def __aenter__(self) -> FakeSDKEventStream:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        self.closed = True
        return False

    def __aiter__(self) -> FakeSDKEventStream:
        return self

    async def __anext__(self) -> object:
        if self._index >= len(self._events):
            raise StopAsyncIteration
        event = self._events[self._index]
        self._index += 1
        if isinstance(event, BaseException):
            raise event
        return event


def _install_fake_pydantic_ai_sdk(
    monkeypatch: pytest.MonkeyPatch,
    *,
    agent_cls: type[object] = FakeSDKAgent,
) -> list[dict[str, Any]]:
    structured_dict_calls: list[dict[str, Any]] = []
    fake_sdk = ModuleType("pydantic_ai")
    FakeSDKAgent.instances.clear()
    FakeSDKRunOnlyAgent.instances.clear()
    FakeSDKAgent.stream_events = None

    def structured_dict(
        json_schema: dict[str, Any],
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        call = {"json_schema": json_schema, "name": name, "description": description}
        structured_dict_calls.append(call)
        return {"structured_schema": json_schema, "name": name, "description": description}

    fake_sdk.__dict__["Agent"] = agent_cls
    fake_sdk.__dict__["StructuredDict"] = structured_dict
    fake_sdk.__dict__["UsageLimits"] = FakeSDKUsageLimits
    fake_sdk.__dict__["ApprovalRequiredToolset"] = FakeSDKApprovalRequiredToolset
    fake_sdk.__dict__["DeferredToolRequests"] = FakeSDKDeferredToolRequests
    fake_sdk.__dict__["DeferredToolResults"] = FakeSDKDeferredToolResults
    fake_sdk.__dict__["ToolApproved"] = FakeSDKToolApproved
    fake_sdk.__dict__["ToolDenied"] = FakeSDKToolDenied

    def import_module(name: str) -> ModuleType:
        if name == "pydantic_ai":
            return fake_sdk
        raise AssertionError(f"Unexpected import: {name}")

    monkeypatch.setattr("importlib.import_module", import_module)
    return structured_dict_calls


def _default_sdk_stream_events() -> list[object]:
    return [
        SimpleNamespace(event_kind="part_start", part=SimpleNamespace(part_kind="text", content="sdk ")),
        SimpleNamespace(event_kind="part_delta", delta=SimpleNamespace(part_delta_kind="text", content_delta="ok")),
        SimpleNamespace(event_kind="part_end", part=SimpleNamespace(part_kind="text", content="sdk ok")),
        SimpleNamespace(event_kind="part_start", part=SimpleNamespace(part_kind="thinking", content="plan")),
        SimpleNamespace(
            event_kind="part_delta", delta=SimpleNamespace(part_delta_kind="thinking", content_delta=" done")
        ),
        SimpleNamespace(event_kind="part_end", part=SimpleNamespace(part_kind="thinking", content="plan done")),
        SimpleNamespace(
            event_kind="function_tool_call",
            part=SimpleNamespace(tool_name="lookup", args='{"query":"cw"}', tool_call_id="call_1"),
        ),
        SimpleNamespace(
            event_kind="function_tool_result",
            part=SimpleNamespace(tool_name="lookup", content={"ok": True}, tool_call_id="call_1", outcome="success"),
        ),
        SimpleNamespace(event_kind="agent_run_result", result=FakeSDKResult()),
    ]


def _sdk_retry_prompt_stream_events() -> list[object]:
    return [
        SimpleNamespace(
            event_kind="function_tool_call",
            part=SimpleNamespace(tool_name="lookup", args={"query": "cw"}, tool_call_id="call_retry"),
        ),
        SimpleNamespace(
            event_kind="function_tool_result",
            part=SimpleNamespace(
                part_kind="retry-prompt",
                tool_name="lookup",
                content="bad args",
                tool_call_id="call_retry",
            ),
        ),
        SimpleNamespace(event_kind="agent_run_result", result=FakeSDKResult()),
    ]


def _sdk_builtin_dual_shape_stream_events() -> list[object]:
    part = SimpleNamespace(
        part_kind="builtin-tool-call",
        tool_name="web_search",
        args={"query": "cw"},
        tool_call_id="builtin_1",
    )
    return [
        SimpleNamespace(event_kind="part_start", part=part),
        SimpleNamespace(event_kind="builtin_tool_call", part=part),
        SimpleNamespace(event_kind="agent_run_result", result=FakeSDKResult()),
    ]


def _factory_for(session: FakePydanticAISession) -> PydanticAISessionFactory:
    def factory() -> PydanticAISession:
        return session

    return factory


async def _collect(events: AsyncIterator[StreamEventBase]) -> list[StreamEventBase]:
    return [event async for event in events]


def _execution_pack(
    output_schema: dict[str, Any] | None = None,
    *,
    allowed_tools: list[str] | None = None,
    skills: list[SkillRef] | None = None,
    mcp_tools: list[MCPToolRef] | None = None,
    effective_toolsets: ToolsetSpec | None = None,
    usage_limits: UsageLimits | None = None,
    retry_policy: RetryPolicy | None = None,
) -> ExecutionPack:
    return ExecutionPack(
        pack_id="exp_01",
        run_id="run_01",
        node_id="n_extract",
        attempt_id="att_01",
        node_contract_snapshot=ExecutionContract(
            contract_id="ctr_exec",
            goal="Return a short answer",
            output_schema=output_schema or {},
            model_policy=NodeModelPolicy(primary_model_profile_id="claude-sonnet-default"),
            allowed_tools=[] if allowed_tools is None else allowed_tools,
            skills=[] if skills is None else skills,
            mcp_tools=[] if mcp_tools is None else mcp_tools,
            prompt=PromptSection(
                system_prompt="You are running inside CW.",
                instructions=["Respect the output schema."],
                user_prompt_template="Answer with JSON.",
            ),
        ),
        context_pack=ContextPack(
            pack_id="ctxp_inside",
            node_id="n_extract",
            attempt_id="att_01",
            run_id="run_01",
            node_goal="Return a short answer",
            fragments=[
                ContextFragment(
                    fragment_id="frag_goal",
                    key="goal",
                    kind="node_goal",
                    priority=Priority.HIGH,
                    required=True,
                    tokens_estimate=10,
                    text="Keep the result concise.",
                    source=StaticTextSource(contract_field_path="goal"),
                    created_at="2026-06-18T00:00:00.000Z",
                )
            ],
            budget=ContextBudget(
                model_context_window_tokens=12000,
                reserved_for_output_tokens=1024,
                reserved_for_tools_tokens=512,
                safety_margin_tokens=256,
                hard_limit_tokens=4096,
            ),
            provenance=ContextProvenance(
                builder_version="test",
                built_at="2026-06-18T00:00:00.000Z",
                model_profile_id="claude-sonnet-default",
                tokenizer="test-tokenizer",
                requirements_hash="req_hash",
                inputs_hash="inputs_hash",
                pack_hash="pack_hash",
            ),
        ),
        effective_model_profile_id="claude-sonnet-default",
        effective_model_settings={"temperature": 0.2},
        effective_toolsets=ToolsetSpec() if effective_toolsets is None else effective_toolsets,
        retry_policy=RetryPolicy() if retry_policy is None else retry_policy,
        usage_limits=usage_limits,
        cancel_token="tok_abc_01",
        correlation_id="trace_xyz",
    )


@pytest.mark.asyncio
async def test_pydantic_ai_adapter_capabilities_descriptor_and_prepare() -> None:
    adapter = PydanticAIAdapter(session_factory=_factory_for(FakePydanticAISession(run_events=[])))

    capabilities = adapter.capabilities()
    assert capabilities.kinds == {AdapterKind.CHAT}
    assert capabilities.provider_kinds == {ProviderKind.CLOUD, ProviderKind.PRIVATE, ProviderKind.LOCAL}
    assert capabilities.structured_output is True
    assert capabilities.streaming is True
    assert capabilities.tool_call is False
    assert capabilities.mcp is False
    assert capabilities.human_in_the_loop is False
    assert capabilities.deferred_tool_results is False
    assert capabilities.evidence_lookup_tool is False
    assert capabilities.multi_modal == set()
    assert capabilities.max_tool_iterations == 0
    assert capabilities.cancel is False

    descriptor = build_pydantic_ai_descriptor()
    assert descriptor.adapter_id == "pydantic_ai"
    assert descriptor.capabilities == capabilities

    handle = await adapter.prepare(_execution_pack())
    assert handle.adapter_id == "pydantic_ai"
    assert handle.state == AttemptState.PREPARED
    assert handle.stream_started is False


def test_pydantic_ai_adapter_capabilities_reflect_configured_toolset_factory() -> None:
    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets()

    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)

    capabilities = adapter.capabilities()

    assert capabilities.tool_call is True
    assert capabilities.mcp is True
    assert capabilities.max_tool_iterations == 16
    assert capabilities.human_in_the_loop is True
    assert capabilities.deferred_tool_results is True
    assert capabilities.cancel is False


@pytest.mark.asyncio
async def test_pydantic_ai_adapter_streams_and_finalizes_completed_attempt() -> None:
    session = FakePydanticAISession(
        run_events=[
            {"type": "text_delta", "text": "working"},
            {
                "type": "request_completed",
                "usage": {"input_tokens": 3, "output_tokens": 1},
                "finish_reason": "stop",
                "latency_ms": 123,
            },
            {"type": "completed", "output": {"answer": "done"}},
        ]
    )
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(
        _execution_pack(
            {
                "type": "object",
                "required": ["answer"],
                "properties": {"answer": {"type": "string"}},
            }
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == [
        "attempt.started",
        "model.text_delta",
        "model.request_completed",
        "attempt.completed",
    ]
    assert [event.seq for event in events] == [0, 1, 2, 3]
    assert events[0].payload == {"attempt_index": 0, "model_profile_id": "claude-sonnet-default"}
    assert events[1].payload == {"delta_text": "working"}
    assert events[2].payload == {
        "usage": {"input_tokens": 3, "output_tokens": 1},
        "finish_reason": "stop",
        "latency_ms": 123,
    }
    assert handle.state == AttemptState.COMPLETED
    assert session.run_request is not None
    assert session.run_request.system_prompt == "You are running inside CW."
    assert session.run_request.instructions == ["Respect the output schema."]
    assert "Answer with JSON." in session.run_request.user_prompt
    assert "Keep the result concise." in session.run_request.user_prompt
    assert session.run_request.model_settings == {"temperature": 0.2}

    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.COMPLETED
    assert outcome.output == {"answer": "done"}
    assert outcome.errors == []
    assert outcome.provenance.adapter_id == "pydantic_ai"
    assert outcome.provenance.context_pack_id == "ctxp_inside"
    assert outcome.provenance.pydantic_ai_traceparent is None


@pytest.mark.asyncio
async def test_pydantic_ai_approval_required_translates_to_human_gate_and_resumes() -> None:
    session = FakePydanticAISession(
        run_events=[
            {
                "type": "approval_required",
                "prompt": "Allow evidence lookup?",
                "tool_id": "evidence_lookup",
                "args": {"query": "demo"},
            }
        ],
        resume_events=[{"type": "completed", "output": {"answer": "approved"}}],
    )
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack({"type": "object", "required": ["answer"]}))

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "tool.approval_required", "human.gate_required"]
    approval = events[-2]
    gate = events[-1]
    assert approval.payload is not None
    assert approval.payload["tool_id"] == "evidence_lookup"
    assert "args_hash" in approval.payload
    assert gate.parent_event_id == approval.event_id
    assert gate.payload == {
        "human_node_id": "n_extract",
        "prompt_to_user": "Allow evidence lookup?",
        "decisions": [{"key": "continue", "label": "Approve"}, {"key": "reject", "label": "Reject"}],
    }
    assert handle.state == AttemptState.AWAITING_HUMAN

    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(
                kind=ResumptionKind.HUMAN_DECISION,
                human_decision=HumanDecisionResolution(
                    key="continue",
                    by="user_01",
                    decided_at="2026-06-18T00:00:01.000Z",
                ),
            ),
        )
    )

    assert [event.type for event in resumed] == ["human.gate_resolved", "attempt.completed"]
    assert resumed[0].payload == {
        "human_node_id": "n_extract",
        "decision": "continue",
        "by": "user_01",
    }
    assert session.resume_request is not None
    assert session.resume_request.resumption.human_decision is not None
    assert session.resume_request.resumption.human_decision.key == "continue"

    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.COMPLETED
    assert outcome.output == {"answer": "approved"}


@pytest.mark.asyncio
async def test_pydantic_ai_deferred_tool_resume_runs_without_human_event() -> None:
    session = FakePydanticAISession(
        run_events=[{"type": "approval_required", "prompt": "Need tool result", "tool_id": "slow_tool"}],
        resume_events=[{"type": "completed", "output": {"answer": "deferred"}}],
    )
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack({"type": "object", "required": ["answer"]}))
    await _collect(adapter.run(handle))

    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(
                kind=ResumptionKind.DEFERRED_TOOL,
                deferred_tool_results=[{"tool_call_id": "call_1", "output": {"ok": True}}],
            ),
        )
    )

    assert [event.type for event in resumed] == ["attempt.completed"]
    assert session.resume_request is not None
    assert session.resume_request.resumption.deferred_tool_results == [
        {"tool_call_id": "call_1", "output": {"ok": True}}
    ]


@pytest.mark.asyncio
async def test_pydantic_ai_output_schema_failure_uses_spec_error_code() -> None:
    session = FakePydanticAISession(run_events=[{"type": "completed", "output": {"other": "value"}}])
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack({"type": "object", "required": ["answer"]}))

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "output_validation"
    assert events[-1].payload["will_retry"] is False
    assert handle.state == AttemptState.FAILED
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_OUTPUT_VALIDATION_FAILED"


@pytest.mark.asyncio
async def test_pydantic_ai_run_empty_session_fails_with_terminal_event() -> None:
    session = FakePydanticAISession(run_events=[])
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack())

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert handle.state == AttemptState.FAILED
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_INTERNAL"
    assert outcome.errors[0].payload["operation"] == "run"


@pytest.mark.asyncio
async def test_pydantic_ai_resume_empty_session_fails_with_terminal_event() -> None:
    session = FakePydanticAISession(
        run_events=[{"type": "approval_required", "prompt": "Need tool result", "tool_id": "slow_tool"}],
        resume_events=[],
    )
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack())
    await _collect(adapter.run(handle))

    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(
                kind=ResumptionKind.DEFERRED_TOOL,
                deferred_tool_results=[{"tool_call_id": "call_1", "output": {"ok": True}}],
            ),
        )
    )

    assert [event.type for event in resumed] == ["attempt.failed"]
    assert handle.state == AttemptState.FAILED
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_INTERNAL"
    assert outcome.errors[0].payload["operation"] == "resume"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_streams_events_and_records_outcome(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    structured_dict_calls = _install_fake_pydantic_ai_sdk(monkeypatch)
    adapter = PydanticAIAdapter()
    output_schema = {
        "type": "object",
        "required": ["answer"],
        "properties": {"answer": {"type": "string"}},
    }
    handle = await adapter.prepare(_execution_pack(output_schema))

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == [
        "attempt.started",
        "model.text_delta",
        "model.text_delta",
        "model.text_completed",
        "model.thinking_delta",
        "model.thinking_delta",
        "model.thought_completed",
        "tool.call_started",
        "tool.call_completed",
        "model.request_completed",
        "attempt.completed",
    ]
    assert events[1].payload == {"delta_text": "sdk ", "start": True}
    assert events[2].payload == {"delta_text": "ok"}
    assert events[3].payload == {"text": "sdk ok", "role": "assistant"}
    assert events[4].payload == {"delta_text": "plan", "start": True}
    assert events[5].payload == {"delta_text": " done"}
    assert events[6].payload == {"summary": "plan done"}
    assert events[7].payload is not None
    assert events[7].payload["tool_id"] == "lookup"
    assert events[7].payload["args"] == {"query": "cw"}
    assert events[8].payload is not None
    assert events[8].payload["result_summary"] == '{"ok": true}'
    assert structured_dict_calls == [
        {
            "json_schema": output_schema,
            "name": "n_extract_output",
            "description": "CW output for node n_extract",
        }
    ]
    assert len(FakeSDKAgent.instances) == 1
    agent = FakeSDKAgent.instances[0]
    assert agent.model == "claude-sonnet-default"
    assert agent.kwargs["system_prompt"] == "You are running inside CW."
    assert agent.kwargs["instructions"] == ["Respect the output schema."]
    assert agent.kwargs["model_settings"] == {"temperature": 0.2}
    assert agent.kwargs["retries"] == {"tools": 2, "output": 2}
    assert agent.kwargs["defer_model_check"] is True
    assert agent.kwargs["metadata"]["cw"]["execution_pack_id"] == "exp_01"
    assert agent.run_user_prompt is None
    assert agent.run_model_settings is None
    assert agent.stream_user_prompt is not None
    assert "Answer with JSON." in agent.stream_user_prompt
    assert "Keep the result concise." in agent.stream_user_prompt
    assert agent.stream_model_settings == {"temperature": 0.2}

    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.COMPLETED
    assert outcome.output == {"answer": "sdk"}
    assert outcome.usage is not None
    assert outcome.usage.input_tokens == 5
    assert outcome.usage.output_tokens == 7
    assert outcome.usage.cache_creation_input_tokens == 2
    assert outcome.usage.cache_read_input_tokens == 3
    assert outcome.usage.total_tokens == 12
    assert outcome.usage.requests == 1
    assert outcome.messages == [{"role": "assistant", "content": "sdk ok", "mode": "json"}]
    assert outcome.provenance.pydantic_ai_traceparent == "00-sdk-trace"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_passes_retry_policy_to_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            retry_policy=RetryPolicy(
                max_attempts=4,
                model_retries=0,
                output_validation_retries=1,
                tool_retries=3,
            ),
        )
    )

    events = await _collect(adapter.run(handle))

    assert events[-1].type == "attempt.completed"
    assert FakeSDKAgent.instances[0].kwargs["retries"] == {"tools": 3, "output": 1}


@pytest.mark.asyncio
async def test_pydantic_ai_run_timeout_cancels_attempt() -> None:
    session = SlowPydanticAISession(
        run_events=[{"type": "completed", "output": {"answer": "late"}}],
        delay_run=True,
    )
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack(retry_policy=RetryPolicy(timeout_seconds=1)))

    events = await asyncio.wait_for(_collect(adapter.run(handle)), timeout=2.0)

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert session.run_request is not None
    assert session.run_request.retry_policy.timeout_seconds == 1
    assert session.cancelled == (handle.handle_id, CancelReason.IDLE_TIMEOUT)
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "cancelled"
    assert events[-1].payload["will_retry"] is False
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.CANCELLED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_CANCELLED"
    assert outcome.errors[0].payload["reason"] == "idle_timeout"
    assert outcome.errors[0].payload["timeout_seconds"] == 1


@pytest.mark.asyncio
async def test_pydantic_ai_resume_timeout_cancels_attempt() -> None:
    session = SlowPydanticAISession(
        run_events=[
            {
                "type": "approval_required",
                "prompt": "Allow slow tool?",
                "tool_id": "slow_tool",
            }
        ],
        resume_events=[{"type": "completed", "output": {"answer": "late"}}],
        delay_resume=True,
    )
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack(retry_policy=RetryPolicy(timeout_seconds=1)))
    await _collect(adapter.run(handle))

    events = await asyncio.wait_for(
        _collect(
            adapter.resume(
                handle,
                AttemptResumption(
                    kind=ResumptionKind.HUMAN_DECISION,
                    human_decision=HumanDecisionResolution(
                        key="continue",
                        by="user_01",
                        decided_at="2026-06-18T00:00:01.000Z",
                    ),
                ),
            )
        ),
        timeout=2.0,
    )

    assert [event.type for event in events] == ["human.gate_resolved", "attempt.failed"]
    assert session.resume_request is not None
    assert session.cancelled == (handle.handle_id, CancelReason.IDLE_TIMEOUT)
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.CANCELLED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["operation"] == "resume"
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_CANCELLED"


@pytest.mark.asyncio
async def test_pydantic_ai_sdk_timeout_without_retry_timeout_is_not_cancelled() -> None:
    session = ErrorPydanticAISession(exception=TimeoutError("sdk request timed out"))
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack())

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert session.cancelled is None
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_INTERNAL"
    assert outcome.errors[0].payload["exception_type"] == "TimeoutError"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_unsupported_model_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            retry_policy=RetryPolicy(model_retries=1),
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_PREPARE_INCOMPATIBLE_ADAPTER"
    assert outcome.errors[0].payload["model_retries"] == 1


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_per_tool_retry_map(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            retry_policy=RetryPolicy(tool_retries={"lookup": 1}),
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_PREPARE_INCOMPATIBLE_ADAPTER"
    assert outcome.errors[0].payload["tool_retries"] == {"lookup": 1}


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_emits_deferred_calls_and_resumes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)

    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets(function_toolsets=[FakeSDKToolset("tools")])

    pending_message = FakeSDKMessage("pending tool")
    FakeSDKAgent.stream_events = [
        SimpleNamespace(
            event_kind="agent_run_result",
            result=FakeSDKResult(
                output=FakeSDKDeferredToolRequests(
                    calls=[
                        FakeSDKToolCallPart(
                            tool_name="lookup",
                            args={"query": "cw"},
                            tool_call_id="call_lookup",
                        )
                    ],
                    metadata={"call_lookup": {"source": "unit"}},
                ),
                messages=[pending_message],
            ),
        )
    ]
    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            allowed_tools=["lookup"],
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == [
        "attempt.started",
        "model.request_completed",
        "tool.call_started",
        "human.gate_required",
    ]
    assert handle.state == AttemptState.AWAITING_HUMAN
    assert FakeSDKAgent.instances[0].kwargs["output_type"][1] is FakeSDKDeferredToolRequests
    gate = events[-1]
    assert gate.payload is not None
    assert gate.payload["deferred_tool_calls"][0]["invocation_id"] == "call_lookup"
    assert gate.payload["metadata"] == {"call_lookup": {"source": "unit"}}

    FakeSDKAgent.stream_events = [
        SimpleNamespace(
            event_kind="agent_run_result",
            result=FakeSDKResult(output={"answer": "resumed"}, messages=[FakeSDKMessage("resumed")]),
        )
    ]
    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(
                kind=ResumptionKind.DEFERRED_TOOL,
                deferred_tool_results=[
                    {
                        "tool_call_id": "call_lookup",
                        "output": {"ok": True},
                        "metadata": {"source": "unit"},
                    }
                ],
            ),
        )
    )

    assert [event.type for event in resumed] == ["model.request_completed", "attempt.completed"]
    sdk_results = FakeSDKAgent.instances[0].stream_deferred_tool_results
    assert isinstance(sdk_results, FakeSDKDeferredToolResults)
    assert sdk_results.calls == {"call_lookup": {"ok": True}}
    assert sdk_results.metadata == {"call_lookup": {"source": "unit"}}
    assert FakeSDKAgent.instances[0].stream_message_history == [pending_message]

    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.COMPLETED
    assert outcome.output == {"answer": "resumed"}


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_emits_deferred_approvals_and_resumes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)

    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets(function_toolsets=[FakeSDKToolset("tools")])

    pending_message = FakeSDKMessage("pending approval")
    FakeSDKAgent.stream_events = [
        SimpleNamespace(
            event_kind="agent_run_result",
            result=FakeSDKResult(
                output=FakeSDKDeferredToolRequests(
                    approvals=[
                        FakeSDKToolCallPart(
                            tool_name="delete_file",
                            args={"path": ".env"},
                            tool_call_id="call_delete",
                        )
                    ],
                ),
                messages=[pending_message],
            ),
        )
    ]
    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            allowed_tools=["delete_file"],
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == [
        "attempt.started",
        "model.request_completed",
        "tool.approval_required",
        "human.gate_required",
    ]
    gate = events[-1]
    assert gate.payload is not None
    assert gate.payload["decisions"] == [
        {"key": "approve:call_delete", "label": "Approve"},
        {"key": "reject:call_delete", "label": "Reject"},
    ]

    FakeSDKAgent.stream_events = [
        SimpleNamespace(
            event_kind="agent_run_result",
            result=FakeSDKResult(output={"answer": "approved"}, messages=[FakeSDKMessage("approved")]),
        )
    ]
    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(
                kind=ResumptionKind.HUMAN_DECISION,
                human_decision=HumanDecisionResolution(
                    key="approve:call_delete",
                    by="user_01",
                    decided_at="2026-06-18T00:00:01.000Z",
                ),
            ),
        )
    )

    assert [event.type for event in resumed] == [
        "human.gate_resolved",
        "model.request_completed",
        "attempt.completed",
    ]
    sdk_results = FakeSDKAgent.instances[0].stream_deferred_tool_results
    assert isinstance(sdk_results, FakeSDKDeferredToolResults)
    assert sdk_results.approvals == {"call_delete": True}
    assert FakeSDKAgent.instances[0].stream_message_history == [pending_message]


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_invalid_deferred_tool_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)

    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets(function_toolsets=[FakeSDKToolset("tools")])

    FakeSDKAgent.stream_events = [
        SimpleNamespace(
            event_kind="agent_run_result",
            result=FakeSDKResult(
                output=FakeSDKDeferredToolRequests(
                    calls=[FakeSDKToolCallPart(tool_name="lookup", args={}, tool_call_id="call_lookup")]
                )
            ),
        )
    ]
    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(_execution_pack({"type": "object"}, allowed_tools=["lookup"]))
    await _collect(adapter.run(handle))

    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(kind=ResumptionKind.DEFERRED_TOOL, deferred_tool_results=[{"output": {"ok": True}}]),
        )
    )

    assert [event.type for event in resumed] == ["attempt.failed"]
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RESUME_INVALID_KIND"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_unknown_deferred_tool_result_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)

    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets(function_toolsets=[FakeSDKToolset("tools")])

    FakeSDKAgent.stream_events = [
        SimpleNamespace(
            event_kind="agent_run_result",
            result=FakeSDKResult(
                output=FakeSDKDeferredToolRequests(
                    calls=[FakeSDKToolCallPart(tool_name="lookup", args={}, tool_call_id="call_lookup")]
                )
            ),
        )
    ]
    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(_execution_pack({"type": "object"}, allowed_tools=["lookup"]))
    await _collect(adapter.run(handle))

    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(
                kind=ResumptionKind.DEFERRED_TOOL,
                deferred_tool_results=[{"tool_call_id": "wrong", "output": {"ok": True}}],
            ),
        )
    )

    assert [event.type for event in resumed] == ["attempt.failed"]
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RESUME_INVALID_KIND"
    assert outcome.errors[0].payload["tool_call_id"] == "wrong"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_partial_deferred_tool_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)

    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets(function_toolsets=[FakeSDKToolset("tools")])

    FakeSDKAgent.stream_events = [
        SimpleNamespace(
            event_kind="agent_run_result",
            result=FakeSDKResult(
                output=FakeSDKDeferredToolRequests(
                    calls=[
                        FakeSDKToolCallPart(tool_name="lookup", args={"q": "a"}, tool_call_id="call_a"),
                        FakeSDKToolCallPart(tool_name="lookup", args={"q": "b"}, tool_call_id="call_b"),
                    ]
                )
            ),
        )
    ]
    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(_execution_pack({"type": "object"}, allowed_tools=["lookup"]))
    await _collect(adapter.run(handle))

    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(
                kind=ResumptionKind.DEFERRED_TOOL,
                deferred_tool_results=[{"tool_call_id": "call_a", "output": {"ok": True}}],
            ),
        )
    )

    assert [event.type for event in resumed] == ["attempt.failed"]
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RESUME_INVALID_KIND"
    assert outcome.errors[0].payload["missing_tool_call_ids"] == ["call_b"]


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_deferred_result_kind_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)

    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets(function_toolsets=[FakeSDKToolset("tools")])

    FakeSDKAgent.stream_events = [
        SimpleNamespace(
            event_kind="agent_run_result",
            result=FakeSDKResult(
                output=FakeSDKDeferredToolRequests(
                    calls=[FakeSDKToolCallPart(tool_name="lookup", args={}, tool_call_id="call_lookup")]
                )
            ),
        )
    ]
    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(_execution_pack({"type": "object"}, allowed_tools=["lookup"]))
    await _collect(adapter.run(handle))

    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(
                kind=ResumptionKind.DEFERRED_TOOL,
                deferred_tool_results=[{"tool_call_id": "call_lookup", "approved": True}],
            ),
        )
    )

    assert [event.type for event in resumed] == ["attempt.failed"]
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RESUME_INVALID_KIND"
    assert outcome.errors[0].payload["expected_kind"] == "approval"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_human_decision_when_calls_remain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)

    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets(function_toolsets=[FakeSDKToolset("tools")])

    FakeSDKAgent.stream_events = [
        SimpleNamespace(
            event_kind="agent_run_result",
            result=FakeSDKResult(
                output=FakeSDKDeferredToolRequests(
                    calls=[FakeSDKToolCallPart(tool_name="lookup", args={}, tool_call_id="call_lookup")],
                    approvals=[FakeSDKToolCallPart(tool_name="delete_file", args={}, tool_call_id="call_delete")],
                )
            ),
        )
    ]
    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(_execution_pack({"type": "object"}, allowed_tools=["lookup", "delete_file"]))
    await _collect(adapter.run(handle))

    resumed = await _collect(
        adapter.resume(
            handle,
            AttemptResumption(
                kind=ResumptionKind.HUMAN_DECISION,
                human_decision=HumanDecisionResolution(
                    key="approve:call_delete",
                    by="user_01",
                    decided_at="2026-06-18T00:00:01.000Z",
                ),
            ),
        )
    )

    assert [event.type for event in resumed] == ["human.gate_resolved", "attempt.failed"]
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RESUME_INVALID_KIND"
    assert outcome.errors[0].payload["pending_call_ids"] == ["call_lookup"]


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_passes_toolsets_and_wraps_mcp_approval(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    function_toolset = FakeSDKToolset("function")
    mcp_toolset = FakeSDKToolset("mcp")
    captured_toolsets: PydanticAIToolsetRequest | None = None

    def toolset_factory(_sdk: ModuleType, toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        nonlocal captured_toolsets
        captured_toolsets = toolsets
        return PydanticAIToolsets(
            function_toolsets=(function_toolset,),
            mcp_toolsets=(PydanticAIMCPToolset(server_id="mcp_research", toolset=mcp_toolset),),
        )

    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            allowed_tools=["python_sandbox"],
            skills=[SkillRef(skill_id="citation_checker", version="1.0.0")],
            mcp_tools=[MCPToolRef(server_id="mcp_research", tool_name="search", requires_approval=True)],
            effective_toolsets=ToolsetSpec(
                builtin_tools=["python_sandbox"],
                skill_ids_resolved=["citation_checker@1.0.0"],
                mcp_server_ids=["mcp_research"],
            ),
        )
    )

    events = await _collect(adapter.run(handle))

    assert events[-1].type == "attempt.completed"
    assert captured_toolsets is not None
    assert captured_toolsets.builtin_tools == ["python_sandbox"]
    assert captured_toolsets.skill_ids_resolved == ["citation_checker@1.0.0"]
    assert len(captured_toolsets.mcp_tools) == 1
    assert captured_toolsets.mcp_tools[0].server_id == "mcp_research"
    assert captured_toolsets.mcp_tools[0].tool_name == "search"
    assert captured_toolsets.mcp_tools[0].requires_approval is True

    assert len(FakeSDKAgent.instances) == 1
    sdk_toolsets = FakeSDKAgent.instances[0].kwargs["toolsets"]
    assert sdk_toolsets[0] is function_toolset
    approval_wrapper = sdk_toolsets[1]
    assert isinstance(approval_wrapper, FakeSDKApprovalRequiredToolset)
    assert approval_wrapper.wrapped is mcp_toolset
    assert approval_wrapper.approval_required_func(None, SimpleNamespace(name="search"), {"query": "cw"}) is True
    assert approval_wrapper.approval_required_func(None, SimpleNamespace(name="read_resource"), {}) is False


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_scopes_mcp_approval_by_server(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    approved_server_toolset = FakeSDKToolset("approved")
    plain_server_toolset = FakeSDKToolset("plain")

    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets(
            mcp_toolsets=(
                PydanticAIMCPToolset(server_id="mcp_sensitive", toolset=approved_server_toolset),
                PydanticAIMCPToolset(server_id="mcp_public", toolset=plain_server_toolset),
            )
        )

    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            mcp_tools=[
                MCPToolRef(server_id="mcp_sensitive", tool_name="*", requires_approval=True),
                MCPToolRef(server_id="mcp_public", tool_name="*", requires_approval=False),
            ],
            effective_toolsets=ToolsetSpec(mcp_server_ids=["mcp_sensitive", "mcp_public"]),
        )
    )

    events = await _collect(adapter.run(handle))

    assert events[-1].type == "attempt.completed"
    sdk_toolsets = FakeSDKAgent.instances[0].kwargs["toolsets"]
    sensitive_wrapper = sdk_toolsets[0]
    assert isinstance(sensitive_wrapper, FakeSDKApprovalRequiredToolset)
    assert sensitive_wrapper.wrapped is approved_server_toolset
    assert sensitive_wrapper.approval_required_func(None, SimpleNamespace(name="same_name"), {}) is True
    assert sdk_toolsets[1] is plain_server_toolset


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_unrequested_mcp_toolsets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)

    def toolset_factory(_sdk: ModuleType, _toolsets: PydanticAIToolsetRequest) -> PydanticAIToolsets:
        return PydanticAIToolsets(
            mcp_toolsets=(
                PydanticAIMCPToolset(server_id="mcp_allowed", toolset=FakeSDKToolset("allowed")),
                PydanticAIMCPToolset(server_id="mcp_extra", toolset=FakeSDKToolset("extra")),
            )
        )

    adapter = PydanticAIAdapter(toolset_factory=toolset_factory)
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            mcp_tools=[MCPToolRef(server_id="mcp_allowed", tool_name="*", requires_approval=False)],
            effective_toolsets=ToolsetSpec(mcp_server_ids=["mcp_allowed"]),
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_TOOL_NOT_FOUND"
    assert outcome.errors[0].payload["unexpected_mcp_server_ids"] == ["mcp_extra"]


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_tools_without_toolset_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            allowed_tools=["python_sandbox"],
            effective_toolsets=ToolsetSpec(builtin_tools=["python_sandbox"]),
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "tool_failed"
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_TOOL_NOT_FOUND"
    assert outcome.errors[0].payload["toolsets"]["builtin_tools"] == ["python_sandbox"]


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_maps_retry_prompt_to_tool_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    FakeSDKAgent.stream_events = _sdk_retry_prompt_stream_events()
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(_execution_pack({"type": "object", "required": ["answer"]}))

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == [
        "attempt.started",
        "tool.call_started",
        "tool.call_failed",
        "model.request_completed",
        "attempt.completed",
    ]
    failed = events[2]
    assert isinstance(failed, ToolEvent)
    assert failed.payload == {
        "error_kind": "tool_failed",
        "message": "bad args",
        "retryable": True,
    }
    assert failed.tool_id == "lookup"
    assert failed.invocation_id == "call_retry"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_passes_token_usage_limits_to_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            usage_limits=UsageLimits(
                max_input_tokens=100,
                max_output_tokens=50,
                max_total_tokens=120,
            ),
        )
    )

    events = await _collect(adapter.run(handle))

    assert events[-1].type == "attempt.completed"
    assert len(FakeSDKAgent.instances) == 1
    usage_limits = FakeSDKAgent.instances[0].stream_usage_limits
    assert isinstance(usage_limits, FakeSDKUsageLimits)
    assert usage_limits.kwargs == {
        "request_limit": None,
        "input_tokens_limit": 100,
        "output_tokens_limit": 50,
        "total_tokens_limit": 120,
    }


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_maps_usage_limit_exceeded_to_spec_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    FakeSDKAgent.stream_events = [UsageLimitExceeded("Exceeded the total_tokens_limit of 10")]
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            usage_limits=UsageLimits(max_total_tokens=10),
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "usage_limit_exceeded"
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_USAGE_LIMIT"
    assert outcome.errors[0].payload["exception_type"] == "UsageLimitExceeded"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_rejects_unsupported_cost_usage_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            usage_limits=UsageLimits(max_cost_usd=0.01),
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "prepare_failed"
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_PREPARE_INCOMPATIBLE_ADAPTER"
    assert outcome.errors[0].payload["usage_limit"] == "max_cost_usd"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_dedupes_builtin_tool_call_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch)
    FakeSDKAgent.stream_events = _sdk_builtin_dual_shape_stream_events()
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(_execution_pack({"type": "object", "required": ["answer"]}))

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == [
        "attempt.started",
        "tool.call_started",
        "model.request_completed",
        "attempt.completed",
    ]
    tool_starts = [event for event in events if event.type == "tool.call_started"]
    assert len(tool_starts) == 1
    assert isinstance(tool_starts[0], ToolEvent)
    assert tool_starts[0].tool_id == "builtin:web_search"
    assert tool_starts[0].invocation_id == "builtin_1"


@pytest.mark.asyncio
async def test_pydantic_ai_default_sdk_session_falls_back_to_run_when_stream_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_pydantic_ai_sdk(monkeypatch, agent_cls=FakeSDKRunOnlyAgent)
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            usage_limits=UsageLimits(max_output_tokens=50),
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == [
        "attempt.started",
        "model.request_completed",
        "attempt.completed",
    ]
    assert len(FakeSDKRunOnlyAgent.instances) == 1
    agent = FakeSDKRunOnlyAgent.instances[0]
    assert agent.run_user_prompt is not None
    assert "Answer with JSON." in agent.run_user_prompt
    assert agent.run_model_settings == {"temperature": 0.2}
    assert isinstance(agent.run_usage_limits, FakeSDKUsageLimits)
    assert agent.run_usage_limits.kwargs == {
        "request_limit": None,
        "output_tokens_limit": 50,
    }
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.COMPLETED
    assert outcome.output == {"answer": "sdk"}


@pytest.mark.asyncio
async def test_pydantic_ai_cancel_finalizes_cancelled_attempt() -> None:
    session = FakePydanticAISession(run_events=[{"type": "text_delta", "text": "working"}])
    adapter = PydanticAIAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack())

    iterator = adapter.run(handle)
    assert (await iterator.__anext__()).type == "attempt.started"
    assert (await iterator.__anext__()).type == "model.text_delta"
    await adapter.cancel(handle, CancelReason.USER)

    assert session.cancelled == (handle.handle_id, CancelReason.USER)
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.CANCELLED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_CANCELLED"


@pytest.mark.asyncio
async def test_pydantic_ai_missing_optional_sdk_raises_spec_coded_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def import_module(name: str) -> ModuleType:
        if name == "pydantic_ai":
            raise ImportError("pydantic_ai unavailable")
        raise AssertionError(f"Unexpected import: {name}")

    monkeypatch.setattr("importlib.import_module", import_module)
    adapter = PydanticAIAdapter()
    handle = await adapter.prepare(_execution_pack())

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "adapter_internal"
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_INTERNAL"
    assert outcome.errors[0].payload["extra"] == "agents"
