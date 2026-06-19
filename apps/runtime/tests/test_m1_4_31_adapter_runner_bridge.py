"""W1.4.31 adapter execution bridge tests."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from cw_runtime.adapters import AdapterRegistry, AttemptHandle, build_pydantic_ai_descriptor
from cw_runtime.harness import ProjectCreateRequest, acquire_runtime_lock, initialize_project
from cw_runtime.model_router import AdapterCapabilities
from cw_runtime.runner import (
    EvaluationAdvanceInput,
    ExecutionAdvanceInput,
    NodeAdvanceRequest,
    advance_workflow_run,
    advance_workflow_run_with_adapters,
)
from cw_runtime.runs import (
    RunActionRequest,
    RunError,
    WorkflowRunStartRequest,
    create_workflow_run,
    list_stream_events,
    pause_workflow_run,
    resume_workflow_run,
)
from cw_runtime.runs.lifecycle import new_runtime_id, utc_now_ms
from cw_schemas import ExecutionPack
from cw_schemas.events import LifecycleEvent, ModelEvent, StreamEventBase
from cw_schemas.runtime import AttemptOutcome, AttemptProvenance, RunUsage
from cw_schemas.types import AttemptState, DisplayLevel, EventPhase, ExecutionMode, FailureType, RunState


def _execution_contract() -> dict[str, Any]:
    return {
        "contract_id": "ctr_execute",
        "contract_kind": "execution",
        "goal": "Execute task",
        "model_policy": {"primary_model_profile_id": "claude-sonnet-default"},
        "prompt": {
            "user_prompt_template": "Process {{ node_goal }}",
            "template_engine": "handlebars",
        },
        "retry_policy": {"max_attempts": 3},
    }


def _evaluation_contract() -> dict[str, Any]:
    return {
        "contract_id": "ctr_review",
        "contract_kind": "evaluation",
        "goal": "Review task",
        "model_policy": {"primary_model_profile_id": "claude-sonnet-default"},
        "prompt": {
            "user_prompt_template": "Review {{ node_goal }}",
            "template_engine": "handlebars",
        },
        "criteria": [
            {
                "criterion_id": "c_quality",
                "description": "Output is acceptable",
                "kind": "rubric",
                "severity": "blocker",
                "weight": 1.0,
            }
        ],
        "pass_condition": {"combinator": "all_pass", "must_pass_blockers": True},
        "fail_condition": {"combinator": "any_pass", "must_pass_blockers": True},
    }


def _repair_contract() -> dict[str, Any]:
    return {
        "contract_id": "ctr_repair",
        "contract_kind": "repair",
        "goal": "Repair task",
        "model_policy": {"primary_model_profile_id": "claude-sonnet-default"},
        "prompt": {
            "user_prompt_template": "Repair {{ node_goal }}",
            "template_engine": "handlebars",
        },
        "repair_strategies": [{"kind": "prompt_patch", "applies_to_failure_types": ["format_error"], "max_uses": 2}],
    }


def _runner_graph_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_adapter_runner",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Adapter Runner Workflow",
        "nodes": [
            {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
            {
                "node_id": "n_execute",
                "type": "execution_task",
                "title": "Execute",
                "contract": _execution_contract(),
            },
            {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
        ],
        "edges": [
            {
                "edge_id": "e_start_execute",
                "source_node_id": "n_start",
                "target_node_id": "n_execute",
                "type": "normal",
            },
            {
                "edge_id": "e_execute_end",
                "source_node_id": "n_execute",
                "target_node_id": "n_end",
                "type": "normal",
            },
        ],
        "entry_node_id": "n_start",
        "terminal_node_ids": ["n_end"],
        "global_context_refs": [],
        "execution_policy": {
            "mode": "semi_auto",
            "max_concurrent_nodes": 1,
            "default_timeout_seconds": 600,
            "on_node_failure": "human",
        },
        "review_policy": {
            "default_max_retry": 2,
            "escalate_after_repairs": 3,
            "evidence_required_for_factual_outputs": True,
        },
        "model_policy": {
            "default_model_profile_id": "claude-sonnet-default",
            "escalation_chain": [],
            "forbid_remote_for_sensitive": False,
        },
        "created_by": "ai_planning",
        "created_at": "2026-06-19T00:00:00Z",
        "last_modified_at": "2026-06-19T00:00:00Z",
        "metadata": {},
    }


def _review_repair_graph_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_adapter_review_repair",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Adapter Review Repair Workflow",
        "nodes": [
            {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
            {
                "node_id": "n_execute",
                "type": "execution_task",
                "title": "Execute",
                "contract": _execution_contract(),
            },
            {
                "node_id": "n_review",
                "type": "evaluation_task",
                "title": "Review",
                "target_node_id": "n_execute",
                "on_pass_next_node_id": "n_end",
                "on_fail_next_node_id": "n_repair",
                "max_retry": 2,
                "contract": _evaluation_contract(),
            },
            {
                "node_id": "n_repair",
                "type": "repair_task",
                "title": "Repair",
                "repair_target_node_id": "n_execute",
                "failure_input_ref": "$last_evaluation",
                "on_repair_next_node_id": "n_execute",
                "contract": _repair_contract(),
            },
            {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
        ],
        "edges": [
            {
                "edge_id": "e_start_execute",
                "source_node_id": "n_start",
                "target_node_id": "n_execute",
                "type": "normal",
            },
            {
                "edge_id": "e_execute_review",
                "source_node_id": "n_execute",
                "target_node_id": "n_review",
                "type": "normal",
            },
        ],
        "entry_node_id": "n_start",
        "terminal_node_ids": ["n_end"],
        "global_context_refs": [],
        "execution_policy": {
            "mode": "semi_auto",
            "max_concurrent_nodes": 1,
            "default_timeout_seconds": 600,
            "on_node_failure": "human",
        },
        "review_policy": {
            "default_max_retry": 2,
            "escalate_after_repairs": 3,
            "evidence_required_for_factual_outputs": True,
        },
        "model_policy": {
            "default_model_profile_id": "claude-sonnet-default",
            "escalation_chain": [],
            "forbid_remote_for_sensitive": False,
        },
        "created_by": "ai_planning",
        "created_at": "2026-06-19T00:00:00Z",
        "last_modified_at": "2026-06-19T00:00:00Z",
        "metadata": {},
    }


def _create_project_with_graph(tmp_path: Path, payload: dict[str, Any] | None = None) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Adapter Runner Project",
            host_path=str(tmp_path / "adapter_runner_project"),
        )
    )
    project_root = Path(response.host_path)
    workflow_path = project_root / ".agent-workflow" / "workflow.flow.json"
    workflow_payload = _runner_graph_payload() if payload is None else payload
    workflow_path.write_text(
        json.dumps(workflow_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return project_root, str(workflow_payload["workflow_id"])


def _start_run(project_root: Path, workflow_id: str, metadata: dict[str, Any] | None = None) -> str:
    response = create_workflow_run(
        project_root,
        workflow_id,
        WorkflowRunStartRequest(
            schema_version="0.1.0",
            mode=ExecutionMode.SEMI_AUTO,
            initial_input={},
            metadata={} if metadata is None else metadata,
        ),
    )
    return response.run_id


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line:
            continue
        loaded = json.loads(raw_line)
        assert isinstance(loaded, dict)
        rows.append(loaded)
    return rows


def _read_run_json(project_root: Path, run_id: str) -> dict[str, Any]:
    loaded = json.loads((project_root / ".agent-workflow" / "runs" / run_id / "run.json").read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


class _FakeAdapter:
    def __init__(
        self,
        *,
        usage: RunUsage,
        output: dict[str, Any] | None = None,
        emit_runner_owned_lifecycle: bool = False,
    ) -> None:
        self.adapter_id = "pydantic_ai"
        self.adapter_version = "test.1"
        self._usage = usage
        self._output = {"draft": "adapter ok"} if output is None else output
        self._emit_runner_owned_lifecycle = emit_runner_owned_lifecycle
        self.execution_pack: ExecutionPack | None = None
        self.closed = False

    def capabilities(self) -> AdapterCapabilities:
        return build_pydantic_ai_descriptor().capabilities

    async def prepare(self, execution_pack: ExecutionPack) -> AttemptHandle:
        self.execution_pack = execution_pack
        return AttemptHandle(
            handle_id=new_runtime_id(),
            attempt_id=execution_pack.attempt_id,
            run_id=execution_pack.run_id,
            node_id=execution_pack.node_id,
            adapter_id=self.adapter_id,
            prepared_at=utc_now_ms(),
        )

    async def run(self, handle: AttemptHandle) -> AsyncIterator[StreamEventBase]:
        if self._emit_runner_owned_lifecycle:
            yield LifecycleEvent(
                event_id="adapter-owned-completed-id",
                seq=998,
                run_id=handle.run_id,
                node_id=handle.node_id,
                attempt_id=handle.attempt_id,
                type="attempt.completed",
                phase=EventPhase.ATTEMPT_COMPLETED,
                title="Adapter completed attempt",
                summary=None,
                payload={"source": "adapter"},
                display_level=DisplayLevel.MINIMAL,
                expandable=False,
                created_at=utc_now_ms(),
            )
        yield ModelEvent(
            event_id="adapter-event-id",
            seq=999,
            run_id=handle.run_id,
            node_id=handle.node_id,
            attempt_id=handle.attempt_id,
            type="model.text_delta",
            phase=EventPhase.ATTEMPT_STREAMING,
            title="Model text delta",
            summary=None,
            content="adapter streamed",
            payload={"delta": "adapter streamed"},
            display_level=DisplayLevel.MINIMAL,
            expandable=False,
            created_at=utc_now_ms(),
            model_profile_id="claude-sonnet-default",
        )

    def resume(self, handle: AttemptHandle, resumption: object) -> AsyncIterator[StreamEventBase]:
        raise AssertionError("resume is not used by the execution bridge test")

    async def cancel(self, handle: AttemptHandle, reason: object | None = None) -> None:
        raise AssertionError("cancel is not used by the execution bridge test")

    async def finalize(self, handle: AttemptHandle) -> AttemptOutcome:
        output_hash = "hash_adapter_output"
        return AttemptOutcome(
            attempt_id=handle.attempt_id,
            run_id=handle.run_id,
            node_id=handle.node_id,
            state=AttemptState.COMPLETED,
            output=self._output,
            output_hash=output_hash,
            output_artifact_refs=[],
            usage=self._usage,
            messages=[{"role": "assistant", "content": self._output}],
            errors=[],
            started_at=handle.prepared_at,
            finished_at=utc_now_ms(),
            duration_ms=1,
            provenance=AttemptProvenance(
                adapter_id=self.adapter_id,
                adapter_version=self.adapter_version,
                model_profile_id="claude-sonnet-default",
                model_settings_hash="hash_model_settings",
                tools_used=[],
                evidence_pack_id=None,
                context_pack_id=self.execution_pack.context_pack.pack_id if self.execution_pack else "missing",
                pydantic_ai_traceparent="traceparent-test",
                outcome_hash="hash_outcome",
            ),
        )

    async def aclose(self) -> None:
        self.closed = True


class _BlockingFakeAdapter(_FakeAdapter):
    def __init__(
        self,
        *,
        usage: RunUsage,
        run_started: asyncio.Event,
        release_run: asyncio.Event,
    ) -> None:
        super().__init__(usage=usage)
        self._run_started = run_started
        self._release_run = release_run

    async def run(self, handle: AttemptHandle) -> AsyncIterator[StreamEventBase]:
        self._run_started.set()
        await self._release_run.wait()
        async for event in super().run(handle):
            yield event


def _adapter_registry(adapter: _FakeAdapter) -> AdapterRegistry:
    registry = AdapterRegistry()
    registry.register(build_pydantic_ai_descriptor(), lambda config: adapter)
    return registry


@pytest.mark.asyncio
async def test_adapter_execution_bridge_persists_outcome_usage_and_stream_events(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path)
    run_id = _start_run(project_root, workflow_id)
    adapter = _FakeAdapter(
        usage=RunUsage(input_tokens=1000, output_tokens=2000, total_tokens=3000, requests=1),
        emit_runner_owned_lifecycle=True,
    )

    advance_workflow_run(project_root, run_id)
    advanced = await advance_workflow_run_with_adapters(project_root, run_id, _adapter_registry(adapter))

    assert advanced.node_id == "n_execute"
    assert advanced.node_state == "passed"
    assert advanced.next_node_ids == ["n_end"]
    assert adapter.closed is True

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    usage = _read_jsonl(run_root / "usage.jsonl")
    assert attempts[0]["adapter_id"] == "pydantic_ai"
    assert attempts[0]["adapter_version"] == "test.1"
    assert attempts[0]["model_profile_id"] == "claude-sonnet-default"
    assert attempts[0]["output_hash"] == "hash_adapter_output"
    assert attempts[0]["usage"]["est_cost_usd"] == pytest.approx(0.033)
    assert attempts[0]["metadata"]["cw"]["adapter_bridge"] is True
    assert usage[0]["attempt_id"] == attempts[0]["attempt_id"]
    assert usage[0]["model_profile_id"] == "claude-sonnet-default"
    assert usage[0]["est_cost_usd"] == pytest.approx(0.033)

    events = list_stream_events(project_root, run_id)
    model_events = [event for event in events if event.type == "model.text_delta"]
    assert len(model_events) == 1
    assert model_events[0].seq != 999
    assert model_events[0].event_id != "adapter-event-id"
    assert model_events[0].attempt_id == attempts[0]["attempt_id"]
    assert len([event for event in events if event.type == "attempt.completed"]) == 1
    assert [event.seq for event in events] == sorted(event.seq for event in events)


@pytest.mark.asyncio
async def test_adapter_execution_bridge_releases_runtime_lock_while_adapter_runs(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path)
    run_id = _start_run(project_root, workflow_id)
    run_started = asyncio.Event()
    release_run = asyncio.Event()
    adapter = _BlockingFakeAdapter(
        usage=RunUsage(input_tokens=1000, output_tokens=2000, total_tokens=3000, requests=1),
        run_started=run_started,
        release_run=release_run,
    )

    advance_workflow_run(project_root, run_id)
    advance_task = asyncio.create_task(
        advance_workflow_run_with_adapters(project_root, run_id, _adapter_registry(adapter))
    )
    await asyncio.wait_for(run_started.wait(), timeout=2.0)
    try:
        with acquire_runtime_lock(project_root, timeout_seconds=1.0):
            run_json = _read_run_json(project_root, run_id)
            assert run_json["current_node_ids"] == ["n_execute"]
            assert run_json["metadata"]["cw"]["node_states"]["n_execute"] == "running"
        with pytest.raises(RunError, match="in-flight attempt"):
            advance_workflow_run(project_root, run_id)
    finally:
        release_run.set()

    advanced = await asyncio.wait_for(advance_task, timeout=2.0)
    assert advanced.node_id == "n_execute"
    assert advanced.node_state == "passed"
    assert adapter.closed is True


@pytest.mark.asyncio
async def test_adapter_execution_bridge_finishes_current_attempt_when_paused(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path)
    run_id = _start_run(project_root, workflow_id)
    run_started = asyncio.Event()
    release_run = asyncio.Event()
    adapter = _BlockingFakeAdapter(
        usage=RunUsage(input_tokens=1000, output_tokens=2000, total_tokens=3000, requests=1),
        run_started=run_started,
        release_run=release_run,
    )

    advance_workflow_run(project_root, run_id)
    advance_task = asyncio.create_task(
        advance_workflow_run_with_adapters(project_root, run_id, _adapter_registry(adapter))
    )
    await asyncio.wait_for(run_started.wait(), timeout=2.0)
    paused = pause_workflow_run(
        project_root,
        run_id,
        RunActionRequest(schema_version="0.1.0", by="tester", reason="pause_during_adapter_run"),
    )
    assert paused.state == RunState.PAUSED

    release_run.set()
    advanced = await asyncio.wait_for(advance_task, timeout=2.0)

    assert advanced.run.state == RunState.PAUSED
    assert advanced.node_id == "n_execute"
    assert advanced.node_state == "passed"
    assert advanced.next_node_ids == ["n_end"]
    run_root = project_root / ".agent-workflow" / "runs" / run_id
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    assert attempts[0]["state"] == "completed"
    run_json = _read_run_json(project_root, run_id)
    assert run_json["state"] == "paused"
    assert run_json["current_node_ids"] == ["n_end"]
    assert run_json["metadata"]["cw"]["node_states"]["n_execute"] == "passed"

    resume_workflow_run(
        project_root,
        run_id,
        RunActionRequest(schema_version="0.1.0", by="tester", reason="resume_after_adapter_run"),
    )
    completed = advance_workflow_run(project_root, run_id)
    assert completed.run.state == RunState.COMPLETED


@pytest.mark.asyncio
async def test_adapter_execution_bridge_enforces_budget_from_outcome_usage(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path)
    run_id = _start_run(project_root, workflow_id, metadata={"cw": {"usage_limits": {"max_cost_usd": 0.03}}})
    adapter = _FakeAdapter(usage=RunUsage(input_tokens=1000, output_tokens=2000, total_tokens=3000, requests=1))

    advance_workflow_run(project_root, run_id)
    failed = await advance_workflow_run_with_adapters(project_root, run_id, _adapter_registry(adapter))

    assert failed.run.state == RunState.FAILED
    run_root = project_root / ".agent-workflow" / "runs" / run_id
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    usage = _read_jsonl(run_root / "usage.jsonl")
    assert attempts[0]["state"] == "failed"
    assert attempts[0]["adapter_id"] == "pydantic_ai"
    assert attempts[0]["adapter_version"] == "test.1"
    assert attempts[0]["output_hash"] == "hash_adapter_output"
    assert attempts[0]["errors"][0]["payload"]["error_code"] == "AA_RUN_USAGE_LIMIT"
    assert attempts[0]["errors"][0]["payload"]["actual"] == pytest.approx(0.033)
    assert usage[0]["est_cost_usd"] == pytest.approx(0.033)

    run_json = _read_run_json(project_root, run_id)
    assert run_json["failure_summary"]["error_code"] == "AA_RUN_USAGE_LIMIT"
    assert run_json["summary_metrics"]["usage"]["est_cost_usd"] == pytest.approx(0.033)


@pytest.mark.asyncio
async def test_adapter_execution_bridge_records_factory_create_failure(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path)
    run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, run_id)
    failed = await advance_workflow_run_with_adapters(project_root, run_id, AdapterRegistry())

    assert failed.run.state == RunState.FAILED
    run_root = project_root / ".agent-workflow" / "runs" / run_id
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    usage = _read_jsonl(run_root / "usage.jsonl")
    assert attempts[0]["state"] == "failed"
    assert attempts[0]["errors"][0]["payload"]["error_code"] == "AA_PREPARE_INCOMPATIBLE_ADAPTER"
    assert attempts[0]["errors"][0]["payload"]["adapter_id"] == "pydantic_ai"
    assert usage[0]["requests"] == 0

    run_json = _read_run_json(project_root, run_id)
    assert run_json["failure_summary"]["error_code"] == "AA_PREPARE_INCOMPATIBLE_ADAPTER"


def test_deterministic_advance_still_accepts_hand_supplied_execution_output(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path)
    run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, run_id)
    advanced = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "deterministic ok"})),
    )

    assert advanced.node_id == "n_execute"
    assert advanced.next_node_ids == ["n_end"]
    attempts = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "attempts.jsonl")
    assert attempts[0]["output_hash"]
    assert attempts[0]["metadata"]["cw"]["foundation_runner"] is True


@pytest.mark.asyncio
async def test_adapter_evaluation_bridge_persists_result_and_routes_to_repair(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _review_repair_graph_payload())
    run_id = _start_run(project_root, workflow_id)
    adapter = _FakeAdapter(
        usage=RunUsage(input_tokens=200, output_tokens=300, total_tokens=500, requests=1),
        output={
            "passed": False,
            "score": 0.25,
            "failure_type": "format_error",
            "finding_message": "Adapter found a format gap.",
            "recommended_action": "repair_with_patch",
            "target_repair_node_id": "n_repair",
            "metadata": {"source": "adapter_eval"},
        },
    )

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "needs review"})),
    )
    advanced = await advance_workflow_run_with_adapters(project_root, run_id, _adapter_registry(adapter))

    assert advanced.node_id == "n_review"
    assert advanced.node_state == "review_failed"
    assert advanced.next_node_ids == ["n_repair"]
    assert advanced.eval_id is not None
    assert adapter.closed is True
    execution_pack = adapter.execution_pack
    assert execution_pack is not None
    assert execution_pack.node_contract_snapshot.contract_kind == "evaluation"

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    evaluations = _read_jsonl(run_root / "evaluations.jsonl")
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    usage = _read_jsonl(run_root / "usage.jsonl")
    evaluation = evaluations[0]
    evaluation_attempt = attempts[-1]

    assert evaluation["passed"] is False
    assert evaluation["recommended_action"]["action"] == "repair_with_patch"
    assert evaluation["recommended_action"]["target_repair_node_id"] == "n_repair"
    assert evaluation["metadata"]["cw"]["adapter_bridge"] is True
    assert "foundation_runner" not in evaluation["metadata"]["cw"]
    assert evaluation["metadata"]["source"] == "adapter_eval"
    assert evaluation_attempt["adapter_id"] == "pydantic_ai"
    assert evaluation_attempt["adapter_version"] == "test.1"
    assert evaluation_attempt["metadata"]["cw"]["adapter_bridge"] is True
    assert evaluation_attempt["output_hash"] != "hash_adapter_output"
    assert usage[-1]["attempt_id"] == evaluation_attempt["attempt_id"]
    assert usage[-1]["est_cost_usd"] == pytest.approx(0.0051)


@pytest.mark.asyncio
async def test_adapter_repair_bridge_persists_patch_and_prompt_overlay(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _review_repair_graph_payload())
    run_id = _start_run(project_root, workflow_id)
    adapter = _FakeAdapter(
        usage=RunUsage(input_tokens=300, output_tokens=400, total_tokens=700, requests=1),
        output={
            "failure_type": "format_error",
            "instruction_text": "Always return JSON with the required key.",
            "expected_effect": "The next attempt emits the required JSON shape.",
            "metadata": {"source": "adapter_repair"},
        },
    )

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "invalid"})),
    )
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(
            evaluation=EvaluationAdvanceInput(
                passed=False,
                score=0.2,
                failure_type=FailureType.FORMAT_ERROR,
                finding_message="Format is invalid.",
                recommended_action="repair_with_patch",
                target_repair_node_id="n_repair",
            )
        ),
    )
    advanced = await advance_workflow_run_with_adapters(project_root, run_id, _adapter_registry(adapter))

    assert advanced.node_id == "n_repair"
    assert advanced.node_state == "passed"
    assert advanced.next_node_ids == ["n_execute"]
    assert advanced.patch_id is not None
    execution_pack = adapter.execution_pack
    assert execution_pack is not None
    assert execution_pack.node_contract_snapshot.contract_kind == "repair"

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    repairs = _read_jsonl(run_root / "repairs.jsonl")
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    usage = _read_jsonl(run_root / "usage.jsonl")
    repair = repairs[0]
    repair_attempt = attempts[-1]

    assert repair["operations"] == [
        {"op": "append_to_instructions", "text": "Always return JSON with the required key."}
    ]
    assert repair["metadata"]["cw"]["adapter_bridge"] is True
    assert "foundation_runner" not in repair["metadata"]["cw"]
    assert repair["metadata"]["source"] == "adapter_repair"
    assert repair_attempt["adapter_id"] == "pydantic_ai"
    assert repair_attempt["metadata"]["cw"]["adapter_bridge"] is True
    assert repair_attempt["output_hash"] != "hash_adapter_output"
    assert usage[-1]["attempt_id"] == repair_attempt["attempt_id"]
    assert usage[-1]["est_cost_usd"] == pytest.approx(0.0069)

    run_json = _read_run_json(project_root, run_id)
    active_overlay = run_json["metadata"]["cw"]["active_prompt_overlays"]["n_execute"][0]
    assert active_overlay["patch_id"] == advanced.patch_id
    assert active_overlay["scope"] == "until_pass"
    assert active_overlay["instruction_text"] == "Always return JSON with the required key."


@pytest.mark.asyncio
async def test_adapter_repair_bridge_persists_run_scope_prompt_overlay(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _review_repair_graph_payload())
    run_id = _start_run(project_root, workflow_id)
    adapter = _FakeAdapter(
        usage=RunUsage(input_tokens=300, output_tokens=400, total_tokens=700, requests=1),
        output={
            "failure_type": "format_error",
            "instruction_text": "Keep JSON output rules for this run.",
            "expected_effect": "The remaining run attempts keep the required JSON shape.",
            "scope": "persistent_for_run",
            "metadata": {"source": "adapter_repair"},
        },
    )

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "invalid"})),
    )
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(
            evaluation=EvaluationAdvanceInput(
                passed=False,
                score=0.2,
                failure_type=FailureType.FORMAT_ERROR,
                finding_message="Format is invalid.",
                recommended_action="repair_with_patch",
                target_repair_node_id="n_repair",
            )
        ),
    )
    advanced = await advance_workflow_run_with_adapters(project_root, run_id, _adapter_registry(adapter))

    assert advanced.node_id == "n_repair"
    assert advanced.patch_id is not None
    run_root = project_root / ".agent-workflow" / "runs" / run_id
    repairs = _read_jsonl(run_root / "repairs.jsonl")
    repair = repairs[0]
    assert repair["scope"] == "persistent_for_run"
    assert repair["applies_to_attempts"] == []

    run_overlay = json.loads((run_root / "run_overlay.json").read_text(encoding="utf-8"))
    persistent_overlay = run_overlay["prompt_overlays"]["n_execute"][0]
    assert persistent_overlay["patch_id"] == advanced.patch_id
    assert persistent_overlay["scope"] == "persistent_for_run"
    assert persistent_overlay["instruction_text"] == "Keep JSON output rules for this run."

    run_json = _read_run_json(project_root, run_id)
    assert "active_prompt_overlays" not in run_json["metadata"].get("cw", {})


@pytest.mark.asyncio
async def test_adapter_evaluation_bridge_rejects_invalid_output(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _review_repair_graph_payload())
    run_id = _start_run(project_root, workflow_id)
    adapter = _FakeAdapter(
        usage=RunUsage(input_tokens=10, output_tokens=10, total_tokens=20, requests=1),
        output={"score": "not-a-number"},
    )

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "needs review"})),
    )
    failed = await advance_workflow_run_with_adapters(project_root, run_id, _adapter_registry(adapter))

    assert failed.run.state == RunState.FAILED
    assert adapter.closed is True
    attempts = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "attempts.jsonl")
    error_payload = attempts[-1]["errors"][0]["payload"]
    assert error_payload["error_code"] == "AA_RUN_OUTPUT_VALIDATION_FAILED"
    assert error_payload["node_kind"] == "evaluation"
    assert error_payload["output_type"] == "dict"
    assert error_payload["validation_error_count"] == 1
    assert "score" not in error_payload
