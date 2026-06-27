"""M1.3.8 HITL decision resolve foundation tests."""

from __future__ import annotations

import copy
import json
from importlib import import_module
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from cw_runtime.api import create_app
from cw_runtime.harness import ProjectCreateRequest, initialize_project
from cw_runtime.runner import (
    HumanDecisionRequest,
    HumanGateAdvanceInput,
    NodeAdvanceRequest,
    advance_workflow_run,
    resolve_human_decision,
)
from cw_runtime.runs import (
    RunError,
    WorkflowRunStartRequest,
    create_workflow_run,
    list_stream_events,
    read_workflow_run,
)
from cw_runtime.settings import RuntimeSettings
from cw_schemas.types import ExecutionMode, NodeRuntimeState, RunState

pytest.importorskip("fastapi")
pytest.importorskip("starlette.testclient")

_MODEL_POLICY: dict[str, Any] = {"primary_model_profile_id": "deterministic-foundation"}


def _human_contract() -> dict[str, Any]:
    return {
        "contract_id": "ctr_human",
        "contract_kind": "human_gate",
        "goal": "Ask for human approval",
        "model_policy": _MODEL_POLICY,
        "decisions": [{"key": "continue"}, {"key": "reject"}],
        "prompt_to_user": "Approve this workflow decision.",
    }


def _human_graph_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_human_decision",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Human Decision Workflow",
        "nodes": [
            {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
            {
                "node_id": "n_human",
                "type": "human_checkpoint",
                "title": "Human Review",
                "decisions": [{"key": "continue"}, {"key": "reject"}],
                "routing_map": {"continue": "n_continue", "reject": "n_reject"},
                "contract": _human_contract(),
            },
            {"node_id": "n_continue", "type": "end", "title": "Continue End", "archive_actions": []},
            {"node_id": "n_reject", "type": "end", "title": "Reject End", "archive_actions": []},
        ],
        "edges": [
            {
                "edge_id": "e_start_human",
                "source_node_id": "n_start",
                "target_node_id": "n_human",
                "type": "normal",
            }
        ],
        "entry_node_id": "n_start",
        "terminal_node_ids": ["n_continue", "n_reject"],
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
            "default_model_profile_id": "deterministic-foundation",
            "escalation_chain": [],
            "forbid_remote_for_sensitive": True,
        },
        "created_by": "ai_planning",
        "created_at": "2026-06-17T00:00:00Z",
        "last_modified_at": "2026-06-17T00:00:00Z",
        "metadata": {},
    }


def _human_edit_graph_payload() -> dict[str, Any]:
    payload = copy.deepcopy(_human_graph_payload())
    human_node = payload["nodes"][1]
    human_node["decisions"] = [{"key": "continue"}, {"key": "reject"}, {"key": "edit"}]
    human_node["routing_map"]["edit"] = "n_edit"
    human_node["contract"]["decisions"] = [{"key": "continue"}, {"key": "reject"}, {"key": "edit"}]
    payload["nodes"].append({"node_id": "n_edit", "type": "end", "title": "Edit End", "archive_actions": []})
    payload["terminal_node_ids"].append("n_edit")
    return payload


def _write_workflow(project_root: Path, payload: dict[str, Any]) -> None:
    workflow_path = project_root / ".agent-workflow" / "workflow.flow.json"
    workflow_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def _create_project_with_graph(tmp_path: Path, payload: dict[str, Any]) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Human Decision Project",
            host_path=str(tmp_path / "human_decision_project"),
        )
    )
    project_root = Path(response.host_path)
    settings_path = project_root / ".agent-workflow" / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    settings["models"]["escalation_chain"] = []
    settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    _write_workflow(project_root, payload)
    return project_root, str(payload["workflow_id"])


def _start_run(project_root: Path, workflow_id: str) -> str:
    response = create_workflow_run(
        project_root,
        workflow_id,
        WorkflowRunStartRequest(
            schema_version="0.1.0",
            mode=ExecutionMode.SEMI_AUTO,
            initial_input={},
            metadata={},
        ),
    )
    return response.run_id


def _enter_waiting_user(project_root: Path, run_id: str) -> None:
    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(human_gate=HumanGateAdvanceInput(prompt_to_user="Please approve.")),
    )


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line:
            continue
        loaded = json.loads(raw_line)
        assert isinstance(loaded, dict)
        rows.append(loaded)
    return rows


def _test_client() -> Any:
    testclient_module = import_module("starlette.testclient")
    app = create_app(RuntimeSettings(auth_token=SecretStr("expected-token")))
    return testclient_module.TestClient(app)


def test_resolve_human_decision_routes_run_forward_and_appends_record(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _human_graph_payload())
    run_id = _start_run(project_root, workflow_id)
    _enter_waiting_user(project_root, run_id)

    record = resolve_human_decision(
        project_root,
        run_id,
        HumanDecisionRequest(
            schema_version="0.1.0",
            human_node_id="n_human",
            decision="continue",
            custom_value={"approved": True},
            by="tester",
        ),
    )

    assert record.human_node_id == "n_human"
    assert record.status == "resolved"
    assert record.decision == "continue"
    assert record.by == "tester"
    assert record.custom_value == {"approved": True}

    run = read_workflow_run(project_root, run_id)
    assert run.state == RunState.RUNNING
    assert run.previous_state == RunState.WAITING_USER
    assert run.current_node_ids == ["n_continue"]
    assert run.paused_at is None
    assert run.resumed_at is not None

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    decisions = _read_jsonl(run_root / "decisions.jsonl")
    assert [decision["status"] for decision in decisions] == ["pending", "resolved"]
    assert decisions[1]["requested_at"] == decisions[0]["requested_at"]
    assert decisions[1]["custom_value"] == {"approved": True}

    events = list_stream_events(project_root, run_id)
    assert [event.type for event in events][-3:] == ["human.gate_resolved", "node.state_changed", "run.resumed"]
    human_event = events[-3]
    assert human_event.phase == "node.passed"
    assert human_event.payload is not None
    assert human_event.payload["decision"] == "continue"
    assert human_event.payload["by"] == "tester"

    completed = advance_workflow_run(project_root, run_id)
    assert completed.run.state == RunState.COMPLETED


def test_resolve_human_reject_marks_node_and_run_failed(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _human_graph_payload())
    run_id = _start_run(project_root, workflow_id)
    _enter_waiting_user(project_root, run_id)

    record = resolve_human_decision(
        project_root,
        run_id,
        HumanDecisionRequest(schema_version="0.1.0", human_node_id="n_human", decision="reject", by="tester"),
    )

    assert record.decision == "reject"
    run = read_workflow_run(project_root, run_id)
    assert run.state == RunState.FAILED
    assert run.previous_state == RunState.WAITING_USER
    assert run.current_node_ids == []
    assert run.failed_at is not None
    assert run.paused_at is None
    assert run.failure_summary is not None
    assert run.failure_summary.failed_node_id == "n_human"
    assert run.failure_summary.error_code is None
    assert run.metadata["cw"]["node_states"]["n_human"] == NodeRuntimeState.FAILED.value

    events = list_stream_events(project_root, run_id)
    assert [event.type for event in events][-4:] == [
        "human.gate_resolved",
        "attempt.failed",
        "node.state_changed",
        "run.failed",
    ]
    assert events[-4].phase == "node.failed"
    assert events[-4].payload is not None
    assert events[-4].payload["decision"] == "reject"
    assert events[-3].payload is not None
    assert events[-3].payload["error_kind"] == "human_rejected"
    assert events[-3].payload["will_retry"] is False
    assert events[-3].payload["next_action"] == "run.failed"
    assert events[-1].payload is not None
    assert events[-1].payload["error_kind"] == "human_rejected"


def test_resolve_human_edit_records_user_edit_resumption_and_routes_retry(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _human_edit_graph_payload())
    run_id = _start_run(project_root, workflow_id)
    _enter_waiting_user(project_root, run_id)

    record = resolve_human_decision(
        project_root,
        run_id,
        HumanDecisionRequest(
            schema_version="0.1.0",
            human_node_id="n_human",
            decision="edit",
            custom_value={"edited_artifacts": [{"artifact_id": "art_01"}]},
            by="tester",
        ),
    )

    assert record.decision == "edit"
    run = read_workflow_run(project_root, run_id)
    assert run.state == RunState.RUNNING
    assert run.previous_state == RunState.WAITING_USER
    assert run.current_node_ids == ["n_human"]
    assert run.paused_at is None
    assert run.resumed_at is not None
    assert run.metadata["cw"]["node_states"]["n_human"] == NodeRuntimeState.RETRYING.value
    resumption = run.metadata["cw"]["human_resumptions"]["n_human"]
    assert resumption["kind"] == "user_edit"
    assert resumption["decision"] == "edit"
    assert resumption["custom_value"] == {"edited_artifacts": [{"artifact_id": "art_01"}]}
    assert resumption["next_node_ids"] == ["n_edit"]

    events = list_stream_events(project_root, run_id)
    assert [event.type for event in events][-3:] == ["human.gate_resolved", "node.state_changed", "run.resumed"]
    assert events[-3].phase == "node.retrying"
    assert events[-1].payload is not None
    assert events[-1].payload["resumption_kind"] == "user_edit"
    assert events[-1].payload["next_node_ids"] == ["n_human"]
    assert events[-1].payload["resumption_target_node_ids"] == ["n_edit"]

    routed = advance_workflow_run(project_root, run_id)
    assert routed.node_id == "n_human"
    assert routed.node_state == NodeRuntimeState.PASSED
    assert routed.next_node_ids == ["n_edit"]
    run_after_route = read_workflow_run(project_root, run_id)
    assert run_after_route.current_node_ids == ["n_edit"]
    assert run_after_route.metadata["cw"]["node_states"]["n_human"] == NodeRuntimeState.PASSED.value
    assert run_after_route.metadata["cw"]["human_resumptions"]["n_human"]["consumed_at"] is not None

    completed = advance_workflow_run(project_root, run_id)
    assert completed.run.state == RunState.COMPLETED


def test_resolve_human_decision_rejects_non_waiting_and_undeclared_decisions(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _human_graph_payload())
    run_id = _start_run(project_root, workflow_id)

    with pytest.raises(RunError) as running_exc_info:
        resolve_human_decision(
            project_root,
            run_id,
            HumanDecisionRequest(schema_version="0.1.0", human_node_id="n_human", decision="continue", by="tester"),
        )
    assert running_exc_info.value.error_code == "WR_STATE_FORBIDDEN_TRANSITION"

    _enter_waiting_user(project_root, run_id)

    with pytest.raises(RunError) as decision_exc_info:
        resolve_human_decision(
            project_root,
            run_id,
            HumanDecisionRequest(schema_version="0.1.0", human_node_id="n_human", decision="edit", by="tester"),
        )
    assert decision_exc_info.value.error_code == "NL_STATE_FORBIDDEN_TRANSITION"


def test_run_decision_endpoint_resolves_waiting_user_and_replays_idempotently(tmp_path: Path) -> None:
    client = _test_client()
    payload = _human_graph_payload()
    create_project = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "display_name": "Human Decision API",
            "host_path": str(tmp_path / "human_decision_api_project"),
        },
    )
    assert create_project.status_code == 201
    project_root = Path(create_project.json()["host_path"])
    _write_workflow(project_root, payload)

    start = client.post(
        f"/cw/v1/workflows/{payload['workflow_id']}/run",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "mode": "semi_auto", "initial_input": {}, "metadata": {}},
    )
    assert start.status_code == 201
    run_id = str(start.json()["run_id"])
    _enter_waiting_user(project_root, run_id)

    headers = {"Authorization": "Bearer expected-token", "Idempotency-Key": "idem-decision-1"}
    body = {"schema_version": "0.1.0", "human_node_id": "n_human", "decision": "continue", "by": "tester"}
    first = client.post(f"/cw/v1/runs/{run_id}/decisions", headers=headers, json=body)
    second = client.post(f"/cw/v1/runs/{run_id}/decisions", headers=headers, json=body)

    assert first.status_code == 200
    assert first.json()["schema_version"] == "0.1.0"
    assert first.json()["decision"] == "continue"
    assert second.status_code == 200
    assert second.headers["idempotent-replay"] == "true"
    assert second.json() == first.json()

    run = read_workflow_run(project_root, run_id)
    assert run.state == RunState.RUNNING
    assert run.current_node_ids == ["n_continue"]


def test_run_list_and_decision_projection_discover_pending_human_gate(tmp_path: Path) -> None:
    client = _test_client()
    payload = _human_graph_payload()
    create_project = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "display_name": "Human Decision Discovery",
            "host_path": str(tmp_path / "human_decision_discovery_project"),
        },
    )
    assert create_project.status_code == 201
    project_id = str(create_project.json()["project_id"])
    project_root = Path(create_project.json()["host_path"])
    _write_workflow(project_root, payload)

    start = client.post(
        f"/cw/v1/workflows/{payload['workflow_id']}/run",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "mode": "semi_auto", "initial_input": {}, "metadata": {}},
    )
    assert start.status_code == 201
    run_id = str(start.json()["run_id"])
    _enter_waiting_user(project_root, run_id)

    missing_project = client.get("/cw/v1/runs", headers={"Authorization": "Bearer expected-token"})
    runs_response = client.get(
        "/cw/v1/runs",
        headers={"Authorization": "Bearer expected-token", "X-Project-Id": project_id},
    )
    decisions_response = client.get(
        f"/cw/v1/runs/{run_id}/decisions",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert missing_project.status_code == 400
    assert missing_project.json()["error_code"] == "BAD_PROJECT_ID"
    assert runs_response.status_code == 200
    assert runs_response.json()["schema_version"] == "0.1.0"
    assert runs_response.json()["runs"] == [
        {
            "run_id": run_id,
            "workflow_id": payload["workflow_id"],
            "workflow_version": "0.1.0",
            "state": "waiting_user",
            "mode": "semi_auto",
            "started_at": start.json()["started_at"],
            "paused_at": read_workflow_run(project_root, run_id).paused_at,
            "resumed_at": None,
            "completed_at": None,
            "failed_at": None,
            "cancelled_at": None,
            "last_event_id": read_workflow_run(project_root, run_id).last_event_id,
            "current_node_ids": ["n_human"],
        }
    ]
    assert decisions_response.status_code == 200
    decision_body = decisions_response.json()
    assert decision_body["schema_version"] == "0.1.0"
    assert decision_body["run_id"] == run_id
    assert decision_body["decisions"] == [
        {
            "human_node_id": "n_human",
            "status": "pending",
            "decision": None,
            "by": None,
            "decided_at": None,
            "requested_at": read_workflow_run(project_root, run_id).paused_at,
            "custom_value_present": False,
            "available_decisions": ["continue", "reject"],
        }
    ]
    assert "prompt_to_user" not in json.dumps(decision_body)
    assert "custom_value" not in decision_body["decisions"][0]


def test_run_decision_projection_does_not_return_resolved_custom_value(tmp_path: Path) -> None:
    client = _test_client()
    payload = _human_graph_payload()
    create_project = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "display_name": "Human Decision Sanitized",
            "host_path": str(tmp_path / "human_decision_sanitized_project"),
        },
    )
    assert create_project.status_code == 201
    project_root = Path(create_project.json()["host_path"])
    _write_workflow(project_root, payload)

    start = client.post(
        f"/cw/v1/workflows/{payload['workflow_id']}/run",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "mode": "semi_auto", "initial_input": {}, "metadata": {}},
    )
    assert start.status_code == 201
    run_id = str(start.json()["run_id"])
    _enter_waiting_user(project_root, run_id)
    response = client.post(
        f"/cw/v1/runs/{run_id}/decisions",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "human_node_id": "n_human",
            "decision": "continue",
            "by": "tester",
            "custom_value": {"sensitive_note": "do not echo this"},
        },
    )
    assert response.status_code == 200

    decisions_response = client.get(
        f"/cw/v1/runs/{run_id}/decisions",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert decisions_response.status_code == 200
    decision_body = decisions_response.json()
    assert [record["status"] for record in decision_body["decisions"]] == ["pending", "resolved"]
    assert decision_body["decisions"][1]["custom_value_present"] is True
    assert "custom_value" not in decision_body["decisions"][1]
    assert "do not echo this" not in json.dumps(decision_body)


def test_run_decision_endpoint_returns_run_error_envelope(tmp_path: Path) -> None:
    client = _test_client()
    payload = _human_graph_payload()
    create_project = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "display_name": "Human Decision API Error",
            "host_path": str(tmp_path / "human_decision_api_error_project"),
        },
    )
    assert create_project.status_code == 201
    project_root = Path(create_project.json()["host_path"])
    _write_workflow(project_root, payload)
    start = client.post(
        f"/cw/v1/workflows/{payload['workflow_id']}/run",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "mode": "semi_auto", "initial_input": {}, "metadata": {}},
    )
    assert start.status_code == 201

    missing_schema_version = client.post(
        f"/cw/v1/runs/{start.json()['run_id']}/decisions",
        headers={"Authorization": "Bearer expected-token"},
        json={"human_node_id": "n_human", "decision": "continue", "by": "tester"},
    )
    unsupported_schema_version = client.post(
        f"/cw/v1/runs/{start.json()['run_id']}/decisions",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "9.9.9", "human_node_id": "n_human", "decision": "continue", "by": "tester"},
    )
    response = client.post(
        f"/cw/v1/runs/{start.json()['run_id']}/decisions",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "human_node_id": "n_human", "decision": "continue", "by": "tester"},
    )

    assert missing_schema_version.status_code == 400
    assert missing_schema_version.json()["error_code"] == "SCHEMA_VERSION_MISSING"
    assert unsupported_schema_version.status_code == 400
    assert unsupported_schema_version.json()["error_code"] == "SCHEMA_VERSION_NOT_SUPPORTED"
    assert response.status_code == 409
    assert response.json()["error_code"] == "WR_STATE_FORBIDDEN_TRANSITION"
    assert "detail" not in response.json()
