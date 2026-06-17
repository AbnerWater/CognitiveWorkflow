"""M1.3.2 project API endpoint tests."""

from __future__ import annotations

from importlib import import_module
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from cw_runtime.api import create_app
from cw_runtime.settings import RuntimeSettings

pytest.importorskip("fastapi")
pytest.importorskip("starlette.testclient")


def _test_client() -> Any:
    testclient_module = import_module("starlette.testclient")
    app = create_app(RuntimeSettings(auth_token=SecretStr("expected-token")))
    return testclient_module.TestClient(app)


def test_create_and_read_project_endpoint(tmp_path: Path) -> None:
    client = _test_client()
    headers = {"Authorization": "Bearer expected-token", "Idempotency-Key": "idem-project-1"}
    host_path = tmp_path / "api_project"

    response = client.post(
        "/cw/v1/projects",
        headers=headers,
        json={
            "schema_version": "0.1.0",
            "display_name": "API Project",
            "host_path": str(host_path),
            "settings_overrides": {"privacy": {"disable_remote_models": True}},
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["schema_version"] == "0.1.0"
    assert body["host_path"] == host_path.resolve().as_posix()
    assert body["git_initialized"] is True
    assert isinstance(body["first_commit_sha"], str)

    project_id = body["project_id"]
    read_response = client.get(f"/cw/v1/projects/{project_id}", headers={"Authorization": "Bearer expected-token"})
    assert read_response.status_code == 200
    read_body = read_response.json()
    assert read_body["project_id"] == project_id
    assert read_body["display_name"] == "API Project"
    assert read_body["host_path"] == host_path.resolve().as_posix()


def test_create_project_idempotency_replays_matching_body(tmp_path: Path) -> None:
    client = _test_client()
    headers = {"Authorization": "Bearer expected-token", "Idempotency-Key": "idem-project-2"}
    payload = {
        "schema_version": "0.1.0",
        "display_name": "Replay Project",
        "host_path": str(tmp_path / "replay_project"),
        "settings_overrides": {},
    }

    first = client.post("/cw/v1/projects", headers=headers, json=payload)
    second = client.post("/cw/v1/projects", headers=headers, json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.headers["idempotent-replay"] == "true"
    assert second.json() == first.json()


def test_create_project_idempotency_rejects_body_mismatch(tmp_path: Path) -> None:
    client = _test_client()
    headers = {"Authorization": "Bearer expected-token", "Idempotency-Key": "idem-project-3"}
    payload = {
        "schema_version": "0.1.0",
        "display_name": "Mismatch Project",
        "host_path": str(tmp_path / "mismatch_project"),
        "settings_overrides": {},
    }

    first = client.post("/cw/v1/projects", headers=headers, json=payload)
    payload["display_name"] = "Mismatch Project 2"
    second = client.post("/cw/v1/projects", headers=headers, json=payload)

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["error_code"] == "IDEMPOTENCY_KEY_BODY_MISMATCH"
    assert "detail" not in second.json()


def test_create_project_errors_are_error_envelopes(tmp_path: Path) -> None:
    client = _test_client()
    headers = {"Authorization": "Bearer expected-token"}
    host_path = tmp_path / "duplicate_project"

    first = client.post(
        "/cw/v1/projects",
        headers=headers,
        json={"schema_version": "0.1.0", "display_name": "Duplicate", "host_path": str(host_path)},
    )
    second = client.post(
        "/cw/v1/projects",
        headers=headers,
        json={"schema_version": "0.1.0", "display_name": "Duplicate", "host_path": str(host_path)},
    )

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["error_code"] == "RES_ALREADY_EXISTS"
    assert "detail" not in second.json()


def test_create_project_malformed_json_returns_error_envelope() -> None:
    client = _test_client()

    response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token", "Content-Type": "application/json"},
        content="{",
    )

    assert response.status_code == 400
    assert response.json()["error_code"] == "SCHEMA_VERSION_MISSING"
    assert "detail" not in response.json()


def test_create_project_requires_schema_version(tmp_path: Path) -> None:
    client = _test_client()

    response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={"display_name": "Missing Schema", "host_path": str(tmp_path / "missing_schema")},
    )

    assert response.status_code == 400
    assert response.json()["error_code"] == "SCHEMA_VERSION_MISSING"
    assert "detail" not in response.json()


def test_read_unknown_project_returns_res_not_found() -> None:
    client = _test_client()

    response = client.get("/cw/v1/projects/unknown-project", headers={"Authorization": "Bearer expected-token"})

    assert response.status_code == 404
    assert response.json()["error_code"] == "RES_NOT_FOUND"
