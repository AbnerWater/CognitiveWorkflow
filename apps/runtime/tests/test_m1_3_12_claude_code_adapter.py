from __future__ import annotations

import asyncio
import importlib
import json
from collections.abc import AsyncIterator
from pathlib import Path
from types import ModuleType
from typing import Any, ClassVar

import pytest

from cw_runtime.adapters import (
    AdapterConfig,
    AttemptResumption,
    ClaudeCodeAdapter,
    ClaudeCodeResumeRequest,
    ClaudeCodeRunRequest,
    ClaudeCodeSession,
    HumanDecisionResolution,
    RawClaudeCodeEvent,
    SessionFactory,
)
from cw_schemas.contract import ExecutionContract, MCPToolRef, NodeModelPolicy, PromptSection
from cw_schemas.events import StreamEventBase
from cw_schemas.packs import (
    ContextBudget,
    ContextFragment,
    ContextPack,
    ContextProvenance,
    ExecutionPack,
    StaticTextSource,
    ToolsetSpec,
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


class FakeClaudeAgentOptions:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs


class FakeTextBlock:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeAssistantMessage:
    def __init__(self, content: list[object]) -> None:
        self.content = content


class FakeResultMessage:
    def __init__(
        self,
        *,
        result: str | dict[str, Any],
        usage: dict[str, Any] | None = None,
        subtype: str = "success",
        duration_ms: int = 0,
    ) -> None:
        self.result = result
        self.usage = {} if usage is None else usage
        self.subtype = subtype
        self.duration_ms = duration_ms


class FakeClaudeSDKClient:
    instances: ClassVar[list[FakeClaudeSDKClient]] = []
    response_messages: ClassVar[list[object]] = []
    block_after_messages: ClassVar[bool] = False

    def __init__(self, *, options: FakeClaudeAgentOptions) -> None:
        self.options = options
        self.connected = False
        self.queries: list[str] = []
        self.interrupted = False
        self.disconnected = False
        type(self).instances.append(self)

    async def connect(self) -> None:
        self.connected = True

    async def query(self, prompt: str, session_id: str = "default") -> None:
        self.queries.append(prompt)

    def receive_response(self) -> AsyncIterator[object]:
        async def iterator() -> AsyncIterator[object]:
            for message in list(type(self).response_messages):
                yield message
            if type(self).block_after_messages:
                await asyncio.Event().wait()

        return iterator()

    async def interrupt(self) -> None:
        self.interrupted = True

    async def disconnect(self) -> None:
        self.disconnected = True


def _factory_for(session: FakeClaudeCodeSession) -> SessionFactory:
    def factory() -> ClaudeCodeSession:
        return session

    return factory


def _adapter_config_with_mcp_servers(*server_ids: str) -> AdapterConfig:
    mcp_servers = {
        "github": {"type": "http", "url": "https://mcp.example.test/github"},
        "db": {"command": "db-mcp", "args": ["--stdio"]},
        "slack": {"type": "sse", "url": "https://mcp.example.test/slack/sse"},
        "unused": {"type": "http", "url": "https://mcp.example.test/unused"},
    }
    return AdapterConfig(
        adapter_id="claude_code",
        settings={"mcp_servers": {server_id: mcp_servers[server_id] for server_id in server_ids}},
    )


async def _collect(events: AsyncIterator[StreamEventBase]) -> list[StreamEventBase]:
    return [event async for event in events]


def _install_fake_claude_agent_sdk(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeClaudeSDKClient.instances = []
    FakeClaudeSDKClient.response_messages = []
    FakeClaudeSDKClient.block_after_messages = False
    fake_sdk = ModuleType("claude_agent_sdk")
    fake_sdk.__dict__["ClaudeAgentOptions"] = FakeClaudeAgentOptions
    fake_sdk.__dict__["ClaudeSDKClient"] = FakeClaudeSDKClient
    real_import_module = importlib.import_module

    def fake_import_module(name: str, package: str | None = None) -> ModuleType:
        if name == "claude_agent_sdk":
            return fake_sdk
        return real_import_module(name, package)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)


def _block_claude_agent_sdk_import(monkeypatch: pytest.MonkeyPatch) -> None:
    real_import_module = importlib.import_module

    def fake_import_module(name: str, package: str | None = None) -> ModuleType:
        if name == "claude_agent_sdk":
            raise ImportError(name)
        return real_import_module(name, package)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)


def _execution_pack(
    output_schema: dict[str, Any] | None = None,
    *,
    allowed_tools: list[str] | None = None,
    mcp_tools: list[MCPToolRef] | None = None,
    effective_toolsets: ToolsetSpec | None = None,
    metadata: dict[str, Any] | None = None,
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
            allowed_tools=[] if allowed_tools is None else allowed_tools,
            mcp_tools=[] if mcp_tools is None else mcp_tools,
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
        effective_toolsets=ToolsetSpec() if effective_toolsets is None else effective_toolsets,
        cancel_token="tok_abc_01",
        correlation_id="trace_xyz",
        metadata={} if metadata is None else metadata,
    )


def _initialized_project_root(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    (path / ".agent-workflow").mkdir()
    return path


def _write_json_value(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


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
async def test_claude_code_allowed_tools_project_contract_and_effective_toolsets() -> None:
    session = FakeClaudeCodeSession(run_events=[{"type": "completed", "output": {"answer": "done"}}])
    adapter = ClaudeCodeAdapter(
        config=_adapter_config_with_mcp_servers("github", "db", "slack"),
        session_factory=_factory_for(session),
    )
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            allowed_tools=["Read", "Bash"],
            effective_toolsets=ToolsetSpec(
                builtin_tools=["Grep", "Read"],
                mcp_server_ids=["github"],
            ),
            mcp_tools=[
                MCPToolRef(server_id="db", tool_name="query"),
                MCPToolRef(server_id="slack", tool_name="*"),
            ],
        )
    )

    await _collect(adapter.run(handle))

    assert session.run_request is not None
    assert session.run_request.allowed_tools == [
        "Read",
        "Bash",
        "Grep",
        "mcp__github__*",
        "mcp__db__query",
        "mcp__slack__*",
    ]
    assert session.run_request.mcp_servers == {
        "github": {"type": "http", "url": "https://mcp.example.test/github"},
        "db": {"command": "db-mcp", "args": ["--stdio"]},
        "slack": {"type": "sse", "url": "https://mcp.example.test/slack/sse"},
    }


@pytest.mark.asyncio
async def test_claude_code_uses_project_mcp_config_when_project_root_present(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path / "claude_project_mcp")
    _write_json_value(
        project_root / ".agent-workflow" / "mcp.config.json",
        [
            {
                "server_id": "github",
                "transport": "http",
                "command_or_url": "https://project-mcp.example.test/github",
            },
            {
                "server_id": "db",
                "transport": "stdio",
                "command_or_url": "project-db-mcp",
                "version": "ignored",
                "tools_snapshot": [{"name": "ignored"}],
            },
            {
                "server_id": "slack",
                "transport": "sse",
                "command_or_url": "https://project-mcp.example.test/slack/sse",
                "enabled": False,
            },
        ],
    )
    session = FakeClaudeCodeSession(run_events=[{"type": "completed", "output": {"answer": "done"}}])
    adapter = ClaudeCodeAdapter(
        config=_adapter_config_with_mcp_servers("github", "db", "slack"),
        session_factory=_factory_for(session),
    )
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            effective_toolsets=ToolsetSpec(mcp_server_ids=["github"]),
            mcp_tools=[MCPToolRef(server_id="db", tool_name="query")],
            metadata={"cw": {"project_root": str(project_root)}},
        )
    )

    await _collect(adapter.run(handle))

    assert session.run_request is not None
    assert session.run_request.mcp_servers == {
        "github": {"type": "http", "url": "https://project-mcp.example.test/github"},
        "db": {"command": "project-db-mcp"},
    }


@pytest.mark.asyncio
async def test_claude_code_missing_mcp_server_config_fails_closed() -> None:
    session = FakeClaudeCodeSession(run_events=[{"type": "completed", "output": {"answer": "done"}}])
    adapter = ClaudeCodeAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            effective_toolsets=ToolsetSpec(mcp_server_ids=["github"]),
            mcp_tools=[MCPToolRef(server_id="db", tool_name="query")],
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert session.run_request is None
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert len(outcome.errors) == 1
    error_payload = outcome.errors[0].payload
    assert error_payload is not None
    assert error_payload["error_code"] == "AA_RUN_TOOL_NOT_FOUND"
    assert error_payload["missing_mcp_server_ids"] == ["github", "db"]


@pytest.mark.asyncio
async def test_claude_code_project_mcp_config_rejects_future_lifecycle_fields(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path / "claude_project_mcp")
    _write_json_value(
        project_root / ".agent-workflow" / "mcp.config.json",
        [
            {
                "server_id": "secure_server",
                "transport": "http",
                "command_or_url": "https://mcp.example.test/secure",
                "secret_ref": "secure://mcp/secure",
            },
            {
                "server_id": "approval_server",
                "transport": "stdio",
                "command_or_url": "approval-mcp",
                "requires_approval": True,
            },
        ],
    )
    session = FakeClaudeCodeSession(run_events=[{"type": "completed", "output": {"answer": "done"}}])
    adapter = ClaudeCodeAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            effective_toolsets=ToolsetSpec(mcp_server_ids=["secure_server", "approval_server"]),
            metadata={"cw": {"project_root": str(project_root)}},
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert session.run_request is None
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_TOOL_NOT_FOUND"
    assert outcome.errors[0].payload["unresolved_secret_mcp_server_ids"] == ["secure_server"]
    assert outcome.errors[0].payload["approval_required_mcp_server_ids"] == ["approval_server"]


@pytest.mark.asyncio
async def test_claude_code_project_mcp_config_rejects_unsupported_transport(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path / "claude_project_mcp")
    _write_json_value(
        project_root / ".agent-workflow" / "mcp.config.json",
        [{"server_id": "bad_transport", "transport": "websocket", "command_or_url": "wss://mcp.example.test"}],
    )
    session = FakeClaudeCodeSession(run_events=[{"type": "completed", "output": {"answer": "done"}}])
    adapter = ClaudeCodeAdapter(session_factory=_factory_for(session))
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            effective_toolsets=ToolsetSpec(mcp_server_ids=["bad_transport"]),
            metadata={"cw": {"project_root": str(project_root)}},
        )
    )

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert session.run_request is None
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_TOOL_NOT_FOUND"
    assert outcome.errors[0].payload["server_id"] == "bad_transport"
    assert outcome.errors[0].payload["transport"] == "websocket"


@pytest.mark.asyncio
async def test_claude_code_default_sdk_session_streams_and_finalizes(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_claude_agent_sdk(monkeypatch)
    FakeClaudeSDKClient.response_messages = [
        FakeAssistantMessage([FakeTextBlock("sdk working")]),
        FakeResultMessage(
            result='{"answer":"sdk"}',
            usage={"input_tokens": 5, "output_tokens": 2},
            duration_ms=42,
        ),
    ]
    adapter = ClaudeCodeAdapter()
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
    assert events[1].payload == {"delta_text": "sdk working"}
    assert events[2].payload == {
        "usage": {"input_tokens": 5, "output_tokens": 2},
        "finish_reason": "success",
        "latency_ms": 42,
    }
    assert FakeClaudeSDKClient.instances
    client = FakeClaudeSDKClient.instances[0]
    assert client.connected is True
    assert len(client.queries) == 1
    assert "Return a short answer" in client.queries[0]
    assert client.options.kwargs["allowed_tools"] == []
    assert client.options.kwargs["mcp_servers"] == {}
    assert client.options.kwargs["permission_mode"] == "dontAsk"
    assert client.options.kwargs["setting_sources"] == []
    assert client.options.kwargs["system_prompt"] == {"type": "preset", "preset": "claude_code"}

    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.COMPLETED
    assert outcome.output == {"answer": "sdk"}


@pytest.mark.asyncio
async def test_claude_code_default_sdk_receives_allowed_tools_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_claude_agent_sdk(monkeypatch)
    FakeClaudeSDKClient.response_messages = [
        FakeResultMessage(result='{"answer":"sdk"}'),
    ]
    adapter = ClaudeCodeAdapter(config=_adapter_config_with_mcp_servers("github", "db", "unused"))
    handle = await adapter.prepare(
        _execution_pack(
            {"type": "object", "required": ["answer"]},
            allowed_tools=["Read"],
            effective_toolsets=ToolsetSpec(builtin_tools=["Grep"], mcp_server_ids=["github"]),
            mcp_tools=[MCPToolRef(server_id="db", tool_name="query")],
        )
    )

    await _collect(adapter.run(handle))

    assert FakeClaudeSDKClient.instances
    assert FakeClaudeSDKClient.instances[0].options.kwargs["allowed_tools"] == [
        "Read",
        "Grep",
        "mcp__github__*",
        "mcp__db__query",
    ]
    assert FakeClaudeSDKClient.instances[0].options.kwargs["mcp_servers"] == {
        "github": {"type": "http", "url": "https://mcp.example.test/github"},
        "db": {"command": "db-mcp", "args": ["--stdio"]},
    }
    assert FakeClaudeSDKClient.instances[0].options.kwargs["permission_mode"] == "dontAsk"


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
async def test_claude_code_default_sdk_cancel_interrupts_client(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_claude_agent_sdk(monkeypatch)
    FakeClaudeSDKClient.response_messages = [FakeAssistantMessage([FakeTextBlock("working")])]
    adapter = ClaudeCodeAdapter()
    handle = await adapter.prepare(_execution_pack())

    iterator = adapter.run(handle)
    assert (await iterator.__anext__()).type == "attempt.started"
    assert (await iterator.__anext__()).type == "model.text_delta"
    await adapter.cancel(handle, CancelReason.USER)

    assert FakeClaudeSDKClient.instances
    assert FakeClaudeSDKClient.instances[0].interrupted is True
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.CANCELLED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_CANCELLED"


@pytest.mark.asyncio
async def test_claude_code_default_sdk_cancel_wakes_blocked_iterator(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_claude_agent_sdk(monkeypatch)
    FakeClaudeSDKClient.response_messages = [FakeAssistantMessage([FakeTextBlock("working")])]
    FakeClaudeSDKClient.block_after_messages = True
    adapter = ClaudeCodeAdapter()
    handle = await adapter.prepare(_execution_pack())

    iterator = adapter.run(handle)
    assert (await iterator.__anext__()).type == "attempt.started"
    assert (await iterator.__anext__()).type == "model.text_delta"
    await adapter.cancel(handle, CancelReason.USER)

    with pytest.raises(StopAsyncIteration):
        await asyncio.wait_for(iterator.__anext__(), timeout=1.0)
    assert FakeClaudeSDKClient.instances
    assert FakeClaudeSDKClient.instances[0].interrupted is True
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.CANCELLED


@pytest.mark.asyncio
async def test_claude_code_default_sdk_unknown_message_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_claude_agent_sdk(monkeypatch)
    FakeClaudeSDKClient.response_messages = [object()]
    adapter = ClaudeCodeAdapter()
    handle = await adapter.prepare(_execution_pack())

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "adapter_internal"
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_INTERNAL"


@pytest.mark.asyncio
async def test_claude_code_default_sdk_unknown_content_block_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_claude_agent_sdk(monkeypatch)
    FakeClaudeSDKClient.response_messages = [FakeAssistantMessage([object()])]
    adapter = ClaudeCodeAdapter()
    handle = await adapter.prepare(_execution_pack())

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "adapter_internal"
    outcome = await adapter.finalize(handle)
    assert outcome.state == AttemptState.FAILED
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_INTERNAL"


@pytest.mark.asyncio
async def test_claude_code_missing_optional_sdk_raises_spec_coded_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _block_claude_agent_sdk_import(monkeypatch)
    adapter = ClaudeCodeAdapter()
    handle = await adapter.prepare(_execution_pack())

    events = await _collect(adapter.run(handle))

    assert [event.type for event in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "adapter_internal"
    outcome = await adapter.finalize(handle)
    assert outcome.errors[0].payload is not None
    assert outcome.errors[0].payload["error_code"] == "AA_RUN_INTERNAL"
    assert outcome.errors[0].payload["module"] == "claude_agent_sdk"
