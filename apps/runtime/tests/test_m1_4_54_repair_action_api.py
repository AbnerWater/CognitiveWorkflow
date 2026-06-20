"""W1.4.54 manual repair node action API tests."""

from __future__ import annotations

import json
from importlib import import_module
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from cw_runtime.api import create_app
from cw_runtime.runs import list_stream_events
from cw_runtime.settings import RuntimeSettings

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


def _repair_graph_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_repair_action_api",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Repair Action API Workflow",
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


def _test_client() -> Any:
    testclient_module = import_module("starlette.testclient")
    app = create_app(RuntimeSettings(auth_token=SecretStr("expected-token")))
    return testclient_module.TestClient(app)


def _create_project_with_graph(client: Any, tmp_path: Path) -> tuple[Path, str]:
    graph_payload = _repair_graph_payload()
    response = client.post(
        "/cw/v1/projects",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "display_name": "Repair Action API",
            "host_path": str(tmp_path / "repair_action_api_project"),
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


def _read_json(path: Path) -> dict[str, Any]:
    loaded = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _start_failed_run_at_repair(client: Any, workflow_id: str) -> tuple[str, str]:
    run_id = _start_run(client, workflow_id)
    start = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_start:run-once",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0"},
    )
    assert start.status_code == 200
    execute = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_execute:run-once",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0", "execution": {"output": {"draft": "bad"}}},
    )
    assert execute.status_code == 200
    review = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_review:re-evaluate",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "evaluation": {
                "passed": False,
                "score": 0.2,
                "failure_type": "format_error",
                "finding_message": "Output is missing required structure.",
            },
        },
    )
    assert review.status_code == 200
    review_body = review.json()
    assert review_body["node_state"] == "review_failed"
    assert review_body["next_node_ids"] == ["n_repair"]
    return run_id, str(review_body["eval_id"])


def test_repair_node_action_returns_repair_patch_and_apply_result(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id, eval_id = _start_failed_run_at_repair(client, workflow_id)

    headers = {**_AUTH_HEADERS, "Idempotency-Key": "manual-repair-1"}
    repair = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_repair:repair",
        headers=headers,
        json={
            "schema_version": "0.1.0",
            "based_on_evaluation_id": eval_id,
            "preferred_strategy": "prompt_patch",
            "scope": "until_pass",
        },
    )
    replay = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_repair:repair",
        headers=headers,
        json={
            "schema_version": "0.1.0",
            "based_on_evaluation_id": eval_id,
            "preferred_strategy": "prompt_patch",
            "scope": "until_pass",
        },
    )

    assert repair.status_code == 200
    body = repair.json()
    assert body["node_id"] == "n_repair"
    assert body["node_state"] == "passed"
    assert body["next_node_ids"] == ["n_execute"]
    assert body["applied"] is True
    assert body["repair_patch"]["patch_id"] == body["patch_id"]
    assert body["repair_patch"]["evaluation_id"] == eval_id
    assert body["repair_patch"]["patch_kind"] == "prompt_patch"
    assert body["repair_patch"]["scope"] == "until_pass"
    assert body["repair_patch"]["metadata"]["cw"]["api_action"] == "manual_repair"
    assert body["repair_patch"]["metadata"]["cw"]["based_on_evaluation_id"] == eval_id

    assert replay.status_code == 200
    assert replay.headers["idempotent-replay"] == "true"
    assert replay.json() == body
    repairs = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "repairs.jsonl")
    assert len(repairs) == 1


def test_repair_node_action_rejects_non_repair_node(tmp_path: Path) -> None:
    client = _test_client()
    _project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id = _start_run(client, workflow_id)

    rejected = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_start:repair",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "based_on_evaluation_id": "evr_missing",
            "preferred_strategy": "prompt_patch",
            "scope": "until_pass",
        },
    )

    assert rejected.status_code == 409
    rejected_body = rejected.json()
    assert rejected_body["error_code"] == "NL_STATE_FORBIDDEN_TRANSITION"
    assert rejected_body["details"] == {"node_id": "n_start", "node_type": "start"}


def test_repair_node_action_rejects_stale_evaluation_id(tmp_path: Path) -> None:
    client = _test_client()
    _project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id, eval_id = _start_failed_run_at_repair(client, workflow_id)

    rejected = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_repair:repair",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "based_on_evaluation_id": "evr_stale",
            "preferred_strategy": "prompt_patch",
            "scope": "until_pass",
        },
    )

    assert rejected.status_code == 409
    rejected_body = rejected.json()
    assert rejected_body["error_code"] == "NL_STATE_FORBIDDEN_TRANSITION"
    assert rejected_body["details"]["based_on_evaluation_id"] == "evr_stale"
    assert rejected_body["details"]["current_evaluation_id"] == eval_id


@pytest.mark.parametrize(
    ("payload_update", "status_code", "error_code", "detail_key"),
    [
        ({"preferred_strategy": "model_escalation"}, 422, "RP_BUILD_KIND_NOT_ALLOWED", "preferred_strategy"),
    ],
)
def test_repair_node_action_rejects_unsupported_strategy(
    tmp_path: Path,
    payload_update: dict[str, str],
    status_code: int,
    error_code: str,
    detail_key: str,
) -> None:
    client = _test_client()
    _project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id, eval_id = _start_failed_run_at_repair(client, workflow_id)
    payload = {
        "schema_version": "0.1.0",
        "based_on_evaluation_id": eval_id,
        "preferred_strategy": "prompt_patch",
        "scope": "until_pass",
    }
    payload.update(payload_update)

    rejected = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_repair:repair",
        headers=_AUTH_HEADERS,
        json=payload,
    )

    assert rejected.status_code == status_code
    rejected_body = rejected.json()
    assert rejected_body["error_code"] == error_code
    assert rejected_body["details"][detail_key] == payload_update[detail_key]


def test_run_once_repair_workflow_scope_persists_workflow_patch(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id, _eval_id = _start_failed_run_at_repair(client, workflow_id)

    repaired = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_repair:run-once",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "repair": {"scope": "persistent_for_workflow"},
        },
    )

    assert repaired.status_code == 200
    body = repaired.json()
    assert body["patch_id"] is not None
    assert body["next_node_ids"] == ["n_execute"]
    repairs_path = project_root / ".agent-workflow" / "runs" / run_id / "repairs.jsonl"
    repairs = _read_jsonl(repairs_path)
    assert repairs[-1]["scope"] == "persistent_for_workflow"
    workflow = _read_json(project_root / ".agent-workflow" / "workflow.flow.json")
    assert workflow["version"] == "0.1.1"
    execute_node = next(node for node in workflow["nodes"] if node["node_id"] == "n_execute")
    assert execute_node["contract"]["prompt"]["instructions"] == ["Tighten the output format before retry."]


def test_repair_node_action_persistent_for_workflow_updates_graph_version_and_prompt(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id, eval_id = _start_failed_run_at_repair(client, workflow_id)

    repair = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_repair:repair",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "based_on_evaluation_id": eval_id,
            "preferred_strategy": "prompt_patch",
            "scope": "persistent_for_workflow",
        },
    )

    assert repair.status_code == 200
    body = repair.json()
    assert body["repair_patch"]["scope"] == "persistent_for_workflow"
    patch_id = str(body["patch_id"])
    workflow = _read_json(project_root / ".agent-workflow" / "workflow.flow.json")
    assert workflow["version"] == "0.1.1"
    execute_node = next(node for node in workflow["nodes"] if node["node_id"] == "n_execute")
    assert execute_node["contract"]["prompt"]["instructions"] == ["Tighten the output format before retry."]

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    repairs = _read_jsonl(run_root / "repairs.jsonl")
    assert repairs[-1]["scope"] == "persistent_for_workflow"
    assert repairs[-1]["applies_to_attempts"] == []
    run_json = _read_json(run_root / "run.json")
    assert run_json["workflow_version"] == "0.1.1"
    assert "active_prompt_overlays" not in run_json["metadata"].get("cw", {})
    assert not (run_root / "run_overlay.json").exists()

    applied_events = [
        event for event in list_stream_events(project_root, run_id) if event.type == "repair.patch_applied"
    ]
    assert applied_events[-1].payload is not None
    assert applied_events[-1].payload["side_effects"] == [
        "workflow_prompt_persisted_for_n_execute",
        "workflow_version_bumped_0.1.0_to_0.1.1",
    ]

    execute = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_execute:run-once",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0", "execution": {"output": {"draft": "uses workflow instruction"}}},
    )

    assert execute.status_code == 200
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    retry_attempt = attempts[-1]
    assert retry_attempt["node_id"] == "n_execute"
    assert retry_attempt["effective_prompt_overlay_ref"] is None
    execution_pack = _read_json(run_root / "execution_packs" / f"{retry_attempt['execution_pack_id']}.json")
    assert execution_pack["node_contract_snapshot"]["prompt"]["instructions"] == [
        "Tighten the output format before retry."
    ]
    assert execution_pack["effective_prompt_overlay"] is None
    assert body["repair_patch"]["patch_id"] == patch_id


def test_repair_node_action_this_attempt_only_applies_to_reserved_next_attempt(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id, eval_id = _start_failed_run_at_repair(client, workflow_id)

    repair = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_repair:repair",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "based_on_evaluation_id": eval_id,
            "preferred_strategy": "prompt_patch",
            "scope": "this_attempt_only",
        },
    )

    assert repair.status_code == 200
    body = repair.json()
    assert body["repair_patch"]["scope"] == "this_attempt_only"
    patch_id = str(body["patch_id"])

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    repairs = _read_jsonl(run_root / "repairs.jsonl")
    reserved_attempt_id = repairs[-1]["applies_to_attempts"][0]
    assert repairs[-1]["scope"] == "this_attempt_only"
    assert repairs[-1]["applies_to_attempts"] == [reserved_attempt_id]

    run_json = json.loads((run_root / "run.json").read_text(encoding="utf-8"))
    active_overlay = run_json["metadata"]["cw"]["active_prompt_overlays"]["n_execute"][0]
    assert active_overlay["patch_id"] == patch_id
    assert active_overlay["scope"] == "this_attempt_only"
    assert active_overlay["applies_to_attempts"] == [reserved_attempt_id]
    assert run_json["metadata"]["cw"]["reserved_attempt_ids"]["n_execute"] == reserved_attempt_id

    applied_events = [
        event for event in list_stream_events(project_root, run_id) if event.type == "repair.patch_applied"
    ]
    assert applied_events[-1].payload is not None
    assert applied_events[-1].payload["side_effects"] == [
        "active_prompt_overlay_this_attempt_only_for_n_execute",
        "reserved_attempt_id_for_n_execute",
    ]

    execute = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_execute:run-once",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0", "execution": {"output": {"draft": "uses one-shot overlay"}}},
    )

    assert execute.status_code == 200
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    retry_attempt = attempts[-1]
    assert retry_attempt["node_id"] == "n_execute"
    assert retry_attempt["attempt_id"] == reserved_attempt_id
    assert retry_attempt["effective_prompt_overlay_ref"] == f"overlays/{reserved_attempt_id}.json"
    attempt_overlay = json.loads((run_root / retry_attempt["effective_prompt_overlay_ref"]).read_text(encoding="utf-8"))
    assert attempt_overlay["patch_ids"] == [patch_id]
    assert attempt_overlay["source_overlays"][0]["scope"] == "this_attempt_only"
    assert attempt_overlay["source_overlays"][0]["applies_to_attempts"] == [reserved_attempt_id]
    execution_pack = json.loads(
        (run_root / "execution_packs" / f"{retry_attempt['execution_pack_id']}.json").read_text(encoding="utf-8")
    )
    assert execution_pack["effective_prompt_overlay"]["source_patch_id"] == patch_id

    run_json_after_retry = json.loads((run_root / "run.json").read_text(encoding="utf-8"))
    cw_metadata = run_json_after_retry["metadata"]["cw"]
    assert "n_execute" not in cw_metadata.get("active_prompt_overlays", {})
    assert "n_execute" not in cw_metadata.get("reserved_attempt_ids", {})


def test_repair_node_action_persistent_for_run_writes_run_overlay(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id, eval_id = _start_failed_run_at_repair(client, workflow_id)

    repair = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_repair:repair",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "based_on_evaluation_id": eval_id,
            "preferred_strategy": "prompt_patch",
            "scope": "persistent_for_run",
        },
    )

    assert repair.status_code == 200
    body = repair.json()
    assert body["repair_patch"]["scope"] == "persistent_for_run"
    patch_id = str(body["patch_id"])

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    repairs = _read_jsonl(run_root / "repairs.jsonl")
    assert repairs[-1]["scope"] == "persistent_for_run"
    assert repairs[-1]["applies_to_attempts"] == []
    run_overlay = json.loads((run_root / "run_overlay.json").read_text(encoding="utf-8"))
    persistent_overlay = run_overlay["prompt_overlays"]["n_execute"][0]
    assert persistent_overlay["patch_id"] == patch_id
    assert persistent_overlay["scope"] == "persistent_for_run"
    assert persistent_overlay["instruction_text"] == "Tighten the output format before retry."

    run_json = json.loads((run_root / "run.json").read_text(encoding="utf-8"))
    assert "active_prompt_overlays" not in run_json["metadata"].get("cw", {})
    applied_events = [
        event for event in list_stream_events(project_root, run_id) if event.type == "repair.patch_applied"
    ]
    assert applied_events[-1].payload is not None
    assert applied_events[-1].payload["side_effects"] == ["run_overlay_for_n_execute"]

    execute = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_execute:run-once",
        headers=_AUTH_HEADERS,
        json={"schema_version": "0.1.0", "execution": {"output": {"draft": "still uses overlay"}}},
    )

    assert execute.status_code == 200
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    retry_attempt = attempts[-1]
    assert retry_attempt["node_id"] == "n_execute"
    assert retry_attempt["effective_prompt_overlay_ref"] == f"overlays/{retry_attempt['attempt_id']}.json"
    attempt_overlay = json.loads((run_root / retry_attempt["effective_prompt_overlay_ref"]).read_text(encoding="utf-8"))
    assert attempt_overlay["patch_ids"] == [patch_id]
    assert attempt_overlay["source_overlays"][0]["scope"] == "persistent_for_run"
    execution_pack = json.loads(
        (run_root / "execution_packs" / f"{retry_attempt['execution_pack_id']}.json").read_text(encoding="utf-8")
    )
    assert execution_pack["effective_prompt_overlay"]["append_to_instructions"] == [
        "Tighten the output format before retry."
    ]
    assert execution_pack["effective_prompt_overlay"]["source_patch_id"] == patch_id
    assert (run_root / "run_overlay.json").exists()
