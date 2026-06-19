"""W1.4.53 node action API AdapterRegistry wiring tests."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from importlib import import_module
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from cw_runtime.adapters import (
    AdapterConfig,
    AdapterRegistry,
    AttemptHandle,
    AttemptResumption,
    build_pydantic_ai_descriptor,
)
from cw_runtime.api import create_app
from cw_runtime.model_router import AdapterCapabilities
from cw_runtime.runs.lifecycle import new_runtime_id, utc_now_ms
from cw_runtime.settings import RuntimeSettings
from cw_schemas import ExecutionPack
from cw_schemas.events import ModelEvent, StreamEventBase
from cw_schemas.runtime import AttemptOutcome, AttemptProvenance, RunUsage
from cw_schemas.types import AttemptState, CancelReason, DisplayLevel, EventPhase

pytest.importorskip("fastapi")
pytest.importorskip("starlette.testclient")

_AUTH_HEADERS = {"Authorization": "Bearer expected-token"}


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


def _base_graph_payload(*, include_review: bool = False) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = [
        {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
        {
            "node_id": "n_execute",
            "type": "execution_task",
            "title": "Execute",
            "contract": _execution_contract(),
        },
    ]
    edges = [
        {
            "edge_id": "e_start_execute",
            "source_node_id": "n_start",
            "target_node_id": "n_execute",
            "type": "normal",
        }
    ]
    if include_review:
        nodes.extend(
            [
                {
                    "node_id": "n_review",
                    "type": "evaluation_task",
                    "title": "Review",
                    "target_node_id": "n_execute",
                    "on_pass_next_node_id": "n_end",
                    "on_fail_next_node_id": "n_end",
                    "max_retry": 2,
                    "contract": _evaluation_contract(),
                },
                {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
            ]
        )
        edges.append(
            {
                "edge_id": "e_execute_review",
                "source_node_id": "n_execute",
                "target_node_id": "n_review",
                "type": "normal",
            }
        )
    else:
        nodes.append({"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []})
        edges.append(
            {
                "edge_id": "e_execute_end",
                "source_node_id": "n_execute",
                "target_node_id": "n_end",
                "type": "normal",
            }
        )
    return {
        "workflow_id": "wf_node_action_api_review" if include_review else "wf_node_action_api",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Node Action API Workflow",
        "nodes": nodes,
        "edges": edges,
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


def _test_client(adapter_registry: AdapterRegistry) -> Any:
    testclient_module = import_module("starlette.testclient")
    app = create_app(
        RuntimeSettings(auth_token=SecretStr("expected-token")),
        adapter_registry=adapter_registry,
    )
    return testclient_module.TestClient(app)


def _create_project_with_graph(client: Any, tmp_path: Path, graph_payload: dict[str, Any]) -> tuple[Path, str]:
    response = client.post(
        "/cw/v1/projects",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "display_name": "Node Action API",
            "host_path": str(tmp_path / str(graph_payload["workflow_id"])),
        },
    )
    assert response.status_code == 201
    project_root = Path(response.json()["host_path"])
    workflow_path = project_root / ".agent-workflow" / "workflow.flow.json"
    workflow_path.write_text(
        json.dumps(graph_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return project_root, str(graph_payload["workflow_id"])


def _start_run(client: Any, workflow_id: str) -> str:
    response = client.post(
        f"/cw/v1/workflows/{workflow_id}/run",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0", "mode": "semi_auto", "initial_input": {}, "metadata": {}},
    )
    assert response.status_code == 201
    return str(response.json()["run_id"])


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line:
            continue
        loaded = json.loads(raw_line)
        assert isinstance(loaded, dict)
        rows.append(loaded)
    return rows


class _FakeAdapter:
    def __init__(self, *, output: dict[str, Any] | None = None) -> None:
        self.adapter_id = "pydantic_ai"
        self.adapter_version = "test.53"
        self._output = {"draft": "adapter ok"} if output is None else output
        self.execution_pack: ExecutionPack | None = None
        self.closed = False
        self.run_calls = 0

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
        self.run_calls += 1
        yield ModelEvent(
            event_id=f"{handle.attempt_id}_model_delta",
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

    def resume(self, handle: AttemptHandle, resumption: AttemptResumption) -> AsyncIterator[StreamEventBase]:
        raise AssertionError("resume is not used by node action API tests")

    async def cancel(self, handle: AttemptHandle, reason: CancelReason = CancelReason.USER) -> None:
        raise AssertionError("cancel is not used by node action API tests")

    async def finalize(self, handle: AttemptHandle) -> AttemptOutcome:
        return AttemptOutcome(
            attempt_id=handle.attempt_id,
            run_id=handle.run_id,
            node_id=handle.node_id,
            state=AttemptState.COMPLETED,
            output=self._output,
            output_hash="hash_adapter_output",
            output_artifact_refs=[],
            usage=RunUsage(input_tokens=10, output_tokens=5, total_tokens=15, requests=1),
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

    def build_adapter(config: AdapterConfig) -> _FakeAdapter:
        return adapter

    registry.register(build_pydantic_ai_descriptor(), build_adapter)
    return registry


def test_run_once_node_action_uses_injected_adapter_registry_and_idempotency(tmp_path: Path) -> None:
    adapter = _FakeAdapter()
    client = _test_client(_adapter_registry(adapter))
    project_root, workflow_id = _create_project_with_graph(client, tmp_path, _base_graph_payload())
    run_id = _start_run(client, workflow_id)

    start = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_start:run-once",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0"},
    )
    assert start.status_code == 200
    assert start.json()["node_id"] == "n_start"
    assert start.json()["next_node_ids"] == ["n_execute"]

    execute_headers = {**_AUTH_HEADERS, "Idempotency-Key": "node-run-once-1"}
    execute = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_execute:run-once",
        headers=execute_headers,
        json={"schema_version": "0.1.0"},
    )
    replay = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_execute:run-once",
        headers=execute_headers,
        json={"schema_version": "0.1.0"},
    )

    assert execute.status_code == 200
    execute_body = execute.json()
    assert execute_body["node_id"] == "n_execute"
    assert execute_body["node_state"] == "passed"
    assert execute_body["next_node_ids"] == ["n_end"]
    assert replay.status_code == 200
    assert replay.headers["idempotent-replay"] == "true"
    assert replay.json() == execute_body
    assert adapter.closed is True
    assert adapter.run_calls == 1

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    assert attempts[0]["adapter_id"] == "pydantic_ai"
    assert attempts[0]["metadata"]["cw"]["adapter_bridge"] is True


def test_re_evaluate_node_action_uses_injected_adapter_registry(tmp_path: Path) -> None:
    adapter = _FakeAdapter(output={"passed": True, "score": 0.95})
    client = _test_client(_adapter_registry(adapter))
    _project_root, workflow_id = _create_project_with_graph(
        client,
        tmp_path,
        _base_graph_payload(include_review=True),
    )
    run_id = _start_run(client, workflow_id)

    assert (
        client.post(
            f"/cw/v1/runs/{run_id}/nodes/n_start:run-once",
            headers=_AUTH_HEADERS,
            json={"schema_version": "0.1.0"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/cw/v1/runs/{run_id}/nodes/n_execute:run-once",
            headers=_AUTH_HEADERS,
            json={"schema_version": "0.1.0", "execution": {"output": {"draft": "ready"}}},
        ).status_code
        == 200
    )

    review = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_review:re-evaluate",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0"},
    )

    assert review.status_code == 200
    review_body = review.json()
    assert review_body["node_id"] == "n_review"
    assert review_body["node_state"] == "passed"
    assert review_body["eval_id"] is not None
    assert review_body["next_node_ids"] == ["n_end"]
    assert adapter.closed is True
    assert adapter.execution_pack is not None
    assert adapter.execution_pack.node_id == "n_review"


def test_re_evaluate_node_action_rejects_non_evaluation_node(tmp_path: Path) -> None:
    adapter = _FakeAdapter()
    client = _test_client(_adapter_registry(adapter))
    _project_root, workflow_id = _create_project_with_graph(client, tmp_path, _base_graph_payload())
    run_id = _start_run(client, workflow_id)

    assert (
        client.post(
            f"/cw/v1/runs/{run_id}/nodes/n_start:run-once",
            headers=_AUTH_HEADERS,
            json={"schema_version": "0.1.0"},
        ).status_code
        == 200
    )
    rejected = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_execute:re-evaluate",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0"},
    )

    assert rejected.status_code == 409
    rejected_body = rejected.json()
    assert rejected_body["error_code"] == "NL_STATE_FORBIDDEN_TRANSITION"
    assert rejected_body["details"] == {"node_id": "n_execute", "node_type": "execution_task"}
    assert adapter.run_calls == 0


def test_node_action_rejects_body_node_id_mismatch_with_run_error(tmp_path: Path) -> None:
    adapter = _FakeAdapter()
    client = _test_client(_adapter_registry(adapter))
    _project_root, workflow_id = _create_project_with_graph(client, tmp_path, _base_graph_payload())
    run_id = _start_run(client, workflow_id)

    rejected = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_start:run-once",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0", "node_id": "n_execute"},
    )

    assert rejected.status_code == 409
    rejected_body = rejected.json()
    assert rejected_body["error_code"] == "NL_STATE_FORBIDDEN_TRANSITION"
    assert rejected_body["details"] == {"path_node_id": "n_start", "body_node_id": "n_execute"}
    assert adapter.run_calls == 0


def test_run_once_node_action_records_missing_adapter_as_failed_run(tmp_path: Path) -> None:
    client = _test_client(AdapterRegistry())
    project_root, workflow_id = _create_project_with_graph(client, tmp_path, _base_graph_payload())
    run_id = _start_run(client, workflow_id)

    assert (
        client.post(
            f"/cw/v1/runs/{run_id}/nodes/n_start:run-once",
            headers=_AUTH_HEADERS,
            json={"schema_version": "0.1.0"},
        ).status_code
        == 200
    )
    execute = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_execute:run-once",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0"},
    )

    assert execute.status_code == 200
    execute_body = execute.json()
    assert execute_body["node_id"] == "n_execute"
    assert execute_body["node_state"] == "failed"
    assert execute_body["run"]["state"] == "failed"

    attempts = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "attempts.jsonl")
    assert attempts[0]["errors"][0]["payload"]["error_code"] == "AA_PREPARE_INCOMPATIBLE_ADAPTER"
