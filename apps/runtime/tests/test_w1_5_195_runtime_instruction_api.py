"""W1.5.195 runtime instruction command API tests."""

from __future__ import annotations

import json
from importlib import import_module
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from cw_runtime.api import create_app
from cw_runtime.settings import RuntimeSettings

pytest.importorskip("fastapi")
pytest.importorskip("starlette.testclient")

_AUTH_HEADERS = {"Authorization": "Bearer expected-token"}


def test_run_scope_submit_instruction_accepts_and_records_metadata_only(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id = _start_run(client, workflow_id)
    raw_instruction = "Summarize the private draft sentence."
    body = {
        "schema_version": "0.1.0",
        "scope": "run",
        "instruction": raw_instruction,
        "intent": "ask",
        "correlation_id": "corr_chat_run",
        "client_command_id": "cmd_chat_run",
        "metadata": {"cw": {"source": "desktop_chat_box", "instruction": raw_instruction}},
    }
    headers = {**_AUTH_HEADERS, "Idempotency-Key": "chat-run-1"}

    response = client.post(f"/cw/v1/runs/{run_id}:submit-instruction", headers=headers, json=body)
    replay = client.post(f"/cw/v1/runs/{run_id}:submit-instruction", headers=headers, json=body)

    assert response.status_code == 202
    assert replay.status_code == 202
    assert replay.headers["idempotent-replay"] == "true"
    response_body = response.json()
    assert replay.json() == response_body
    assert response_body["schema_version"] == "0.1.0"
    assert response_body["status"] == "accepted"
    assert response_body["run_id"] == run_id
    assert response_body["node_id"] is None
    assert response_body["scope"] == "run"
    assert response_body["intent"] == "ask"
    assert response_body["stream_url"] == f"/cw/v1/runs/{run_id}/stream"
    assert response_body["correlation_id"] == "corr_chat_run"

    rows = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "instruction-commands.jsonl")
    assert rows == [
        {
            "command_id": response_body["command_id"],
            "run_id": run_id,
            "node_id": None,
            "scope": "run",
            "intent": "ask",
            "accepted_at": response_body["accepted_at"],
            "correlation_id": "corr_chat_run",
            "instruction_persisted": False,
        }
    ]
    assert raw_instruction not in json.dumps(rows, ensure_ascii=False)
    assert "desktop_chat_box" not in json.dumps(rows, ensure_ascii=False)


def test_node_scope_submit_instruction_uses_path_node_id(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id = _start_run(client, workflow_id)

    response = client.post(
        f"/cw/v1/runs/{run_id}/nodes/n_execute:submit-instruction",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "scope": "node",
            "instruction": "Repair this node with the latest review notes.",
            "intent": "repair",
            "correlation_id": "corr_chat_node",
        },
    )

    assert response.status_code == 202
    response_body = response.json()
    assert response_body["run_id"] == run_id
    assert response_body["node_id"] == "n_execute"
    assert response_body["scope"] == "node"
    assert response_body["intent"] == "repair"

    rows = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "instruction-commands.jsonl")
    assert rows[0]["command_id"] == response_body["command_id"]
    assert rows[0]["node_id"] == "n_execute"
    assert rows[0]["scope"] == "node"
    assert rows[0]["instruction_persisted"] is False


def test_submit_instruction_rejects_scope_mismatch_without_projection(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_with_graph(client, tmp_path)
    run_id = _start_run(client, workflow_id)

    response = client.post(
        f"/cw/v1/runs/{run_id}:submit-instruction",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "scope": "node",
            "instruction": "This body scope does not match the run endpoint.",
            "intent": "ask",
        },
    )

    assert response.status_code == 409
    assert response.json()["error_code"] == "NL_STATE_FORBIDDEN_TRANSITION"
    assert not (project_root / ".agent-workflow" / "runs" / run_id / "instruction-commands.jsonl").exists()


def _test_client() -> Any:
    testclient_module = import_module("starlette.testclient")
    app = create_app(RuntimeSettings(auth_token=SecretStr("expected-token")))
    return testclient_module.TestClient(app)


def _create_project_with_graph(client: Any, tmp_path: Path) -> tuple[Path, str]:
    graph_payload = _base_graph_payload()
    response = client.post(
        "/cw/v1/projects",
        headers=_AUTH_HEADERS,
        json={
            "schema_version": "0.1.0",
            "display_name": "Runtime Instruction API",
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


def _base_graph_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_runtime_instruction_api",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Runtime Instruction API Workflow",
        "nodes": [
            {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
            {
                "node_id": "n_execute",
                "type": "execution_task",
                "title": "Execute",
                "contract": {
                    "contract_id": "ctr_execute",
                    "contract_kind": "execution",
                    "goal": "Execute task",
                    "model_policy": {"primary_model_profile_id": "claude-sonnet-default"},
                    "prompt": {
                        "user_prompt_template": "Process {{ node_goal }}",
                        "template_engine": "handlebars",
                    },
                    "retry_policy": {"max_attempts": 3},
                },
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
        "created_at": "2026-06-27T00:00:00Z",
        "last_modified_at": "2026-06-27T00:00:00Z",
        "metadata": {},
    }
