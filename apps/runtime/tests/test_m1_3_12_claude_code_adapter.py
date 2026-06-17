from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from cw_runtime.adapters import (
    AttemptResumption,
    ClaudeCodeAdapter,
    ClaudeCodeResumeRequest,
    ClaudeCodeRunRequest,
    ClaudeCodeSession,
    HumanDecisionResolution,
    RawClaudeCodeEvent,
    SessionFactory,
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


class FakeClaudeCodeSession:
    def __init__(
        self,
        *,
        run_events: list[RawClaudeCodeEvent],
        resume_events: list[RawClaudeCodeEvent] | None = None,
    ) -> None:
        self._run_events = run_events
        self._resume_events = [] if resume_events is None else resume_events
        self.run_request: ClaudeCodeRunRequest | None = None
        self.resume_request: ClaudeCodeResumeRequest | None = None
        self.cancelled: tuple[str, CancelReason] | None = None
        self.closed = False

    async def run(self, request: ClaudeCodeRunRequest) -> AsyncIterator[RawClaudeCodeEvent]:
        self.run_request = request
        for event in self._run_events:
            yield event

    async def resume(self, request: ClaudeCodeResumeRequest) -> AsyncIterator[RawClaudeCodeEvent]:
        self.resume_request = request
        for event in self._resume_events:
            yield event

    async def cancel(self, handle_id: str, reason: CancelReason) -> None:
        self.cancelled = (handle_id, reason)

    async def aclose(self) -> None:
        self.closed = True


def _factory_for(session: FakeClaudeCodeSession) -> SessionFactory:
    def factory() -> ClaudeCodeSession:
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
                    created_at="2026-06-17T00:00:00.000Z",
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
                built_at="2026-06-17T00:00:00.000Z",
                model_profile_id="claude-sonnet-default",
                tokenizer="test-tokenizer",
                requirements_hash="req_hash",
                inputs_hash="inputs_hash",
                pack_hash="pack_hash",
            ),
        ),
        effective_model_profile_id="claude-sonnet-default",
        cancel_token="tok_abc_01",
        correlation_id="trace_xyz",
    )


@pytest.mark.asyncio
async def test_claude_code_adapter_capabilities_and_prepare() -> None:
    adapter = ClaudeCodeAdapter(session_factory=_factory_for(FakeClaudeCodeSession(run_events=[])))

    capabilities = adapter.capabilities()
    assert capabilities.kinds == {AdapterKind.CODING_AGENT}
    assert capabilities.provider_kinds == {ProviderKind.CLOUD}
    assert capabilities.structured_output is False
    assert capabilities.streaming is True
    assert capabilities.mcp is True
    assert capabilities.human_in_the_loop is True
    assert capabilities.evidence_lookup_tool is True
    assert capabilities.multi_modal == {"image"}
    assert capabilities.cancel is True

    handle = await adapter.prepare(_execution_pack())
    assert handle.adapter_id == "claude_code"
    assert handle.state == AttemptState.PREPARED
    assert handle.stream_started is False


@pytest.mark.asyncio
async def test_claude_code_adapter_streams_and_finalizes_completed_attempt() -> None:
    session = FakeClaudeCodeSession(
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
    adapter = ClaudeCodeAdapter(session_factory=_factory_for(session))
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
    assert events[3].payload is not None
    assert set(events[3].payload) == {"output_hash", "duration_ms", "usage"}
    assert handle.state == AttemptState.COMPLETED
    assert session.run_request is not None
    assert "Return a short answer" in session.run_request.prompt
    assert "Keep the result concise." in session.run_request.prompt

    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.COMPLETED
    assert outcome.output == {"answer": "done"}
    assert outcome.errors == []
    assert outcome.provenance.adapter_id == "claude_code"
    assert outcome.provenance.context_pack_id == "ctxp_inside"


@pytest.mark.asyncio
async def test_claude_code_permission_prompt_translates_to_human_gate_and_resumes() -> None:
    session = FakeClaudeCodeSession(
        run_events=[
            {
                "type": "permission_prompt",
                "prompt": "Allow Edit?",
                "allowed_tools": ["Edit"],
                "tool_id": "Edit",
                "args": {"path": "demo.txt"},
                "decision_key": "continue",
            }
        ],
        resume_events=[{"type": "completed", "output": {"answer": "approved"}}],
    )
    adapter = ClaudeCodeAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(_execution_pack({"type": "object", "required": ["answer"]}))

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "tool.approval_required", "human.gate_required"]
    approval = events[-2]
    gate = events[-1]
    assert approval.payload is not None
    assert approval.payload["tool_id"] == "Edit"
    assert "args_hash" in approval.payload
    assert gate.parent_event_id == approval.event_id
    assert gate.payload == {
        "human_node_id": "n_extract",
        "prompt_to_user": "Allow Edit?",
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
                    decided_at="2026-06-17T00:00:01.000Z",
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
async def test_claude_code_output_schema_failure_uses_spec_error_code() -> None:
    session = FakeClaudeCodeSession(run_events=[{"type": "completed", "output": {"other": "value"}}])
    adapter = ClaudeCodeAdapter(session_factory=_factory_for(session))
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
async def test_claude_code_cancel_finalizes_cancelled_attempt() -> None:
    session = FakeClaudeCodeSession(run_events=[{"type": "text_delta", "text": "working"}])
    adapter = ClaudeCodeAdapter(session_factory=_factory_for(session))
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
async def test_claude_code_missing_session_factory_raises_spec_coded_error() -> None:
    adapter = ClaudeCodeAdapter()
    handle = await adapter.prepare(_execution_pack())

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "adapter_internal"
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_INTERNAL"
