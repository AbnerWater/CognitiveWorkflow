"""W1.4.31 adapter execution bridge tests."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from cw_runtime.adapters import AdapterRegistry, AttemptHandle, build_pydantic_ai_descriptor
from cw_runtime.harness import ProjectCreateRequest, initialize_project
from cw_runtime.model_router import AdapterCapabilities
from cw_runtime.runner import (
    ExecutionAdvanceInput,
    NodeAdvanceRequest,
    advance_workflow_run,
    advance_workflow_run_with_adapters,
)
from cw_runtime.runs import WorkflowRunStartRequest, create_workflow_run, list_stream_events
from cw_runtime.runs.lifecycle import new_runtime_id, utc_now_ms
from cw_schemas import ExecutionPack
from cw_schemas.events import LifecycleEvent, ModelEvent, StreamEventBase
from cw_schemas.runtime import AttemptOutcome, AttemptProvenance, RunUsage
from cw_schemas.types import AttemptState, DisplayLevel, EventPhase, ExecutionMode, RunState


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


def _create_project_with_graph(tmp_path: Path) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Adapter Runner Project",
            host_path=str(tmp_path / "adapter_runner_project"),
        )
    )
    project_root = Path(response.host_path)
    workflow_path = project_root / ".agent-workflow" / "workflow.flow.json"
    payload = _runner_graph_payload()
    workflow_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return project_root, str(payload["workflow_id"])


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
