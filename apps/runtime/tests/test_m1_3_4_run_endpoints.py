"""M1.3.4 run API endpoint tests."""

from __future__ import annotations

import json
from importlib import import_module
from pathlib import Path
from typing import Any, cast

import pytest
from pydantic import SecretStr

from cw_runtime.api import create_app
from cw_runtime.engine import load_workflow_graph
from cw_runtime.settings import RuntimeSettings

pytest.importorskip("fastapi")
pytest.importorskip("starlette.testclient")


def _test_client() -> Any:
    testclient_module = import_module("starlette.testclient")
    app = create_app(RuntimeSettings(auth_token=SecretStr("expected-token")))
    return testclient_module.TestClient(app)


def _create_project_and_workflow(client: Any, tmp_path: Path) -> tuple[Path, str]:
    host_path = tmp_path / "run_api_project"
    response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "display_name": "Run API", "host_path": str(host_path)},
    )
    assert response.status_code == 201
    project_root = Path(response.json()["host_path"])
    workflow_id = load_workflow_graph(project_root).workflow_id
    return project_root, workflow_id


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line:
            records.append(cast(dict[str, object], json.loads(line)))
    return records


def test_create_read_and_transition_run_endpoints(tmp_path: Path) -> None:
    client = _test_client()
    _project_root, workflow_id = _create_project_and_workflow(client, tmp_path)

    start = client.post(
        f"/cw/v1/workflows/{workflow_id}/run",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "mode": "semi_auto", "initial_input": {"goal": "api"}, "metadata": {}},
    )

    assert start.status_code == 201
    start_body = start.json()
    run_id = start_body["run_id"]
    assert start_body["stream_url"] == f"/cw/v1/runs/{run_id}/stream"

    read = client.get(f"/cw/v1/runs/{run_id}", headers={"Authorization": "Bearer expected-token"})
    assert read.status_code == 200
    assert read.json()["state"] == "running"

    pause = client.post(
        f"/cw/v1/workflows/{workflow_id}/pause",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "by": "tester", "reason": "pause"},
    )
    resume = client.post(
        f"/cw/v1/workflows/{workflow_id}/resume",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "by": "tester", "reason": "resume"},
    )
    cancel = client.post(
        f"/cw/v1/workflows/{workflow_id}/cancel",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "by": "tester", "reason": "cancel"},
    )

    assert pause.status_code == 200
    assert pause.json()["state"] == "paused"
    assert resume.status_code == 200
    assert resume.json()["state"] == "running"
    assert cancel.status_code == 200
    assert cancel.json()["state"] == "cancelled"

    terminal_resume = client.post(
        f"/cw/v1/workflows/{workflow_id}/resume",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "by": "tester"},
    )
    assert terminal_resume.status_code == 404
    assert terminal_resume.json()["error_code"] == "RES_NOT_FOUND"
    assert "detail" not in terminal_resume.json()

    run_pause = client.post(
        f"/cw/v1/runs/{run_id}/pause",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "by": "tester"},
    )
    assert run_pause.status_code == 404


def test_workflow_snapshot_endpoint_records_explicit_git_snapshot(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_and_workflow(client, tmp_path)
    headers = {"Authorization": "Bearer expected-token", "Idempotency-Key": "idem-snapshot-1"}
    payload = {"schema_version": "0.1.0"}

    first = client.post(f"/cw/v1/workflows/{workflow_id}/snapshot", headers=headers, json=payload)
    second = client.post(f"/cw/v1/workflows/{workflow_id}/snapshot", headers=headers, json=payload)

    assert first.status_code == 201
    first_body = cast(dict[str, object], first.json())
    assert first_body["schema_version"] == "0.1.0"
    assert first_body["kind"] == "workflow.snapshot"
    assert isinstance(first_body["snapshot_id"], str)
    assert isinstance(first_body["commit_sha"], str)
    assert isinstance(first_body["created_at"], str)
    assert first_body["git_tag"] is None
    assert "host_path" not in first_body
    assert "detail" not in first_body

    assert second.status_code == 201
    assert second.headers["idempotent-replay"] == "true"
    assert cast(dict[str, object], second.json()) == first_body

    snapshots = _read_jsonl(project_root / ".agent-workflow" / "snapshots" / "snapshots.jsonl")
    workflow_snapshots = [snapshot for snapshot in snapshots if snapshot.get("kind") == "workflow.snapshot"]
    assert len(workflow_snapshots) == 1
    snapshot_record = workflow_snapshots[0]
    assert snapshot_record["snapshot_id"] == first_body["snapshot_id"]
    assert snapshot_record["workflow_id"] == workflow_id
    assert snapshot_record["commit_sha"] == first_body["commit_sha"]
    assert snapshot_record["git_tag"] is None
    assert snapshot_record["message"] == f"snapshot(workflow): create {workflow_id}"
    assert snapshot_record["refs"] == {"workflow_id": workflow_id}
    assert (project_root / ".agent-workflow" / "locks" / "git.lock").exists() is False
    assert (project_root / ".agent-workflow" / "locks" / "runtime.lock").exists() is False


def test_workflow_snapshot_endpoint_rejects_unregistered_workflow(tmp_path: Path) -> None:
    client = _test_client()
    _project_root, _workflow_id = _create_project_and_workflow(client, tmp_path)

    response = client.post(
        "/cw/v1/workflows/missing_workflow/snapshot",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0"},
    )

    assert response.status_code == 404
    body = cast(dict[str, object], response.json())
    assert body["error_code"] == "RES_NOT_FOUND"
    assert body["details"] == {"workflow_id": "missing_workflow"}
    assert "detail" not in body


def test_workflow_history_endpoint_returns_registered_workflow_history(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_and_workflow(client, tmp_path)

    response = client.get(
        f"/cw/v1/workflows/{workflow_id}/history",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert response.status_code == 200
    body = cast(dict[str, object], response.json())
    entries = cast(list[dict[str, object]], body["entries"])
    assert len(entries) == 1
    entry = entries[0]
    assert entry["workflow_id"] == workflow_id
    assert entry["version"] == "0.1.0"
    assert isinstance(entry["instantiated_at"], str)
    assert entry["git_commit_sha"] == ""
    assert entry["git_tag"] is None
    assert entry["derived_from_draft_id"] is None
    assert entry["change_summary"] == "Initial empty workflow created with project skeleton."
    assert str(project_root) not in json.dumps(body)


def test_workflow_history_endpoint_accepts_omitted_optional_fields(tmp_path: Path) -> None:
    client = _test_client()
    project_root, workflow_id = _create_project_and_workflow(client, tmp_path)
    history_path = project_root / ".agent-workflow" / "workflow_history.json"
    history_path.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "workflow_id": workflow_id,
                        "version": "0.1.1",
                        "instantiated_at": "2026-06-28T00:00:00Z",
                        "git_commit_sha": "abcdef1234567890",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    response = client.get(
        f"/cw/v1/workflows/{workflow_id}/history",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert response.status_code == 200
    body = cast(dict[str, object], response.json())
    entries = cast(list[dict[str, object]], body["entries"])
    assert len(entries) == 1
    entry = entries[0]
    assert entry["workflow_id"] == workflow_id
    assert entry["version"] == "0.1.1"
    assert entry["git_tag"] is None
    assert entry["derived_from_draft_id"] is None
    assert entry["change_summary"] is None


def test_workflow_history_endpoint_rejects_unregistered_workflow(tmp_path: Path) -> None:
    client = _test_client()
    _project_root, _workflow_id = _create_project_and_workflow(client, tmp_path)

    response = client.get(
        "/cw/v1/workflows/missing_workflow/history",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert response.status_code == 404
    body = cast(dict[str, object], response.json())
    assert body["error_code"] == "RES_NOT_FOUND"
    assert body["details"] == {"workflow_id": "missing_workflow"}
    assert "detail" not in body


def test_run_creation_idempotency_replays_before_concurrent_run_check(tmp_path: Path) -> None:
    client = _test_client()
    _project_root, workflow_id = _create_project_and_workflow(client, tmp_path)
    headers = {"Authorization": "Bearer expected-token", "Idempotency-Key": "idem-run-1"}
    payload = {"schema_version": "0.1.0", "mode": "semi_auto", "initial_input": {}, "metadata": {}}

    first = client.post(f"/cw/v1/workflows/{workflow_id}/run", headers=headers, json=payload)
    second = client.post(f"/cw/v1/workflows/{workflow_id}/run", headers=headers, json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.headers["idempotent-replay"] == "true"
    assert second.json() == first.json()


def test_run_stream_endpoint_replays_sse_frames_and_412(tmp_path: Path) -> None:
    client = _test_client()
    _project_root, workflow_id = _create_project_and_workflow(client, tmp_path)
    start = client.post(
        f"/cw/v1/workflows/{workflow_id}/run",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "mode": "semi_auto", "initial_input": {}, "metadata": {}},
    )
    run_id = start.json()["run_id"]
    client.post(
        f"/cw/v1/workflows/{workflow_id}/pause",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "by": "tester"},
    )

    stream = client.get(
        f"/cw/v1/runs/{run_id}/stream?until_seq=1",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert stream.status_code == 200
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert "event: run.started" in stream.text
    assert "event: run.paused" in stream.text

    first_event_id = stream.text.splitlines()[0].removeprefix("id: ")
    replay = client.get(
        f"/cw/v1/observability/runs/{run_id}/stream?until_seq=1",
        headers={"Authorization": "Bearer expected-token", "Last-Event-ID": first_event_id},
    )
    assert replay.status_code == 200
    assert "event: run.started" not in replay.text
    assert "event: run.paused" in replay.text

    missing = client.get(
        f"/cw/v1/runs/{run_id}/stream",
        headers={"Authorization": "Bearer expected-token", "Last-Event-ID": "missing_event"},
    )
    assert missing.status_code == 412
    assert missing.json()["error_code"] == "SE_SSE_REPLAY_NOT_FOUND"
