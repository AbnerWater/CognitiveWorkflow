"""M1.4.1 PydanticAIAdapter foundation tests."""

from __future__ import annotations

from collections.abc import AsyncIterator
from types import ModuleType
from typing import Any, ClassVar

import pytest

from cw_runtime.adapters import (
    AttemptResumption,
    HumanDecisionResolution,
    PydanticAIAdapter,
    PydanticAIResumeRequest,
    PydanticAIRunRequest,
    PydanticAISession,
    PydanticAISessionFactory,
    RawPydanticAIEvent,
    build_pydantic_ai_descriptor,
)
from cw_schemas.contract import ExecutionContract, NodeModelPolicy, PromptSection
from cw_schemas.events import StreamEventBase
from cw_schemas.packs import (
    ContextBudget,
    ContextFragment,
    ContextPack,
    ContextProvenance,
    ExecutionPack,
    StaticTextSource,
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
    def model_dump(self, *, mode: str = "json") -> dict[str, Any]:
        return {"role": "assistant", "content": "sdk ok", "mode": mode}


class FakeSDKResult:
    output: ClassVar[dict[str, Any]] = {"answer": "sdk"}
    usage: ClassVar[FakeSDKUsage] = FakeSDKUsage()

    def all_messages(self) -> list[FakeSDKMessage]:
        return [FakeSDKMessage()]

    def _traceparent(self, *, required: bool = True) -> str | None:
        return "00-sdk-trace"


class FakeSDKAgent:
    instances: ClassVar[list[FakeSDKAgent]] = []

    def __init__(self, model: str, **kwargs: Any) -> None:
        self.model = model
        self.kwargs = kwargs
        self.run_user_prompt: str | None = None
        self.run_model_settings: dict[str, Any] | None = None
        FakeSDKAgent.instances.append(self)

    async def run(self, user_prompt: str, *, model_settings: dict[str, Any] | None = None) -> FakeSDKResult:
        self.run_user_prompt = user_prompt
        self.run_model_settings = model_settings
        return FakeSDKResult()


def _install_fake_pydantic_ai_sdk(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    structured_dict_calls: list[dict[str, Any]] = []
    fake_sdk = ModuleType("pydantic_ai")
    FakeSDKAgent.instances.clear()

    def structured_dict(
        json_schema: dict[str, Any],
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        call = {"json_schema": json_schema, "name": name, "description": description}
        structured_dict_calls.append(call)
        return {"structured_schema": json_schema, "name": name, "description": description}

    fake_sdk.__dict__["Agent"] = FakeSDKAgent
    fake_sdk.__dict__["StructuredDict"] = structured_dict

    def import_module(name: str) -> ModuleType:
        if name == "pydantic_ai":
            return fake_sdk
        raise AssertionError(f"Unexpected import: {name}")

    monkeypatch.setattr("importlib.import_module", import_module)
    return structured_dict_calls


def _factory_for(session: FakePydanticAISession) -> PydanticAISessionFactory:
    def factory() -> PydanticAISession:
        return session

    return factory


async def _collect(events: AsyncIterator[StreamEventBase]) -> list[StreamEventBase]:
    return [event async for event in events]


def _execution_pack(output_schema: dict[str, Any] | None = None) -> ExecutionPack:
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
    assert capabilities.streaming is False
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
async def test_pydantic_ai_default_sdk_session_runs_agent_and_records_outcome(
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
        "model.request_completed",
        "attempt.completed",
    ]
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
    assert agent.kwargs["defer_model_check"] is True
    assert agent.kwargs["metadata"]["cw"]["execution_pack_id"] == "exp_01"
    assert agent.run_user_prompt is not None
    assert "Answer with JSON." in agent.run_user_prompt
    assert "Keep the result concise." in agent.run_user_prompt
    assert agent.run_model_settings == {"temperature": 0.2}

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
