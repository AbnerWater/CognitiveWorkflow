"""M1.3.4 run API endpoint tests."""

from __future__ import annotations

from importlib import import_module
from pathlib import Path
from typing import Any

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
