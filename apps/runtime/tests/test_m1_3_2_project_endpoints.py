"""M1.3.2 project API endpoint tests."""

from __future__ import annotations

import json
import subprocess
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


def _write_json_value(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


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


def test_read_project_config_endpoints_return_manifest_files(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "api_config_project"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "display_name": "API Config Project", "host_path": str(host_path)},
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]
    agent_root = host_path.resolve() / ".agent-workflow"
    skills_payload: list[dict[str, object]] = [
        {"skill_id": "file_io", "enabled": True, "version": "1.0.0"},
    ]
    mcp_payload: list[dict[str, object]] = [
        {"server_id": "docs", "enabled": True, "transport": "stdio", "command_or_url": "docs-mcp"},
    ]
    adapters_payload: list[dict[str, object]] = [
        {"adapter_id": "pydantic-ai", "enabled": True},
    ]
    _write_json_value(agent_root / "skills.config.json", skills_payload)
    _write_json_value(agent_root / "mcp.config.json", mcp_payload)
    _write_json_value(agent_root / "adapters.config.json", adapters_payload)

    skills_response = client.get(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
    )
    mcps_response = client.get(
        f"/cw/v1/projects/{project_id}/mcps",
        headers={"Authorization": "Bearer expected-token"},
    )
    adapters_response = client.get(
        f"/cw/v1/projects/{project_id}/adapters",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert skills_response.status_code == 200
    assert skills_response.json() == [
        {"skill_id": "file_io", "enabled": True, "version": "1.0.0"},
    ]
    assert mcps_response.status_code == 200
    assert mcps_response.json() == mcp_payload
    assert adapters_response.status_code == 200
    assert adapters_response.json() == adapters_payload


def test_project_skill_endpoint_updates_runtime_manifest(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "skill_project"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "display_name": "Skill Project", "host_path": str(host_path)},
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]

    empty_response = client.get(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
    )
    assert empty_response.status_code == 200
    assert empty_response.json() == []

    enable_response = client.patch(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "skill_id": "citation_checker",
            "version": "1.0.0",
            "enabled": True,
        },
    )
    assert enable_response.status_code == 200
    assert enable_response.json() == {
        "skill_id": "citation_checker",
        "version": "1.0.0",
        "enabled": True,
    }

    disable_response = client.patch(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "skill_id": "citation_checker",
            "enabled": False,
        },
    )
    assert disable_response.status_code == 200
    assert disable_response.json() == {
        "skill_id": "citation_checker",
        "version": "1.0.0",
        "enabled": False,
    }

    list_response = client.get(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
    )
    assert list_response.status_code == 200
    assert list_response.json() == [disable_response.json()]
    manifest = json.loads((host_path.resolve() / ".agent-workflow" / "skills.config.json").read_text(encoding="utf-8"))
    assert manifest == [
        {
            "skill_id": "citation_checker",
            "version": "1.0.0",
            "enabled": False,
            "params": {},
        }
    ]


def test_project_skill_endpoint_rejects_params_without_echoing_values(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "skill_project_params"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "display_name": "Skill Project Params", "host_path": str(host_path)},
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]

    response = client.patch(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "skill_id": "citation_checker",
            "enabled": True,
            "params": {"api_key": "fake-secret-skill-param"},
        },
    )

    assert response.status_code == 400
    body = response.json()
    assert body["error_code"] == "SCHEMA_VERSION_NOT_SUPPORTED"
    assert "fake-secret-skill-param" not in str(body)


def test_project_skill_endpoint_treats_missing_manifest_as_empty(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "skill_project_missing_manifest"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "display_name": "Skill Project Missing Manifest",
            "host_path": str(host_path),
        },
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]
    skills_path = host_path.resolve() / ".agent-workflow" / "skills.config.json"
    skills_path.unlink()

    response = client.get(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
    )
    assert response.status_code == 200
    assert response.json() == []


def test_project_skill_endpoint_rejects_corrupted_manifest_without_overwrite(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "skill_project_corrupted_manifest"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "display_name": "Skill Project Corrupted Manifest",
            "host_path": str(host_path),
        },
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]
    skills_path = host_path.resolve() / ".agent-workflow" / "skills.config.json"
    skills_path.write_text("{not-json", encoding="utf-8")

    get_response = client.get(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
    )
    assert get_response.status_code == 409
    assert get_response.json()["error_code"] == "RH_MANIFEST_REVISION_MISMATCH"

    patch_response = client.patch(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "skill_id": "citation_checker", "enabled": True},
    )
    assert patch_response.status_code == 409
    assert patch_response.json()["error_code"] == "RH_MANIFEST_REVISION_MISMATCH"
    assert skills_path.read_text(encoding="utf-8") == "{not-json"


def test_project_skill_endpoint_rejects_non_list_manifest(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "skill_project_non_list_manifest"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "display_name": "Skill Project Non List Manifest",
            "host_path": str(host_path),
        },
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]
    _write_json_value(host_path.resolve() / ".agent-workflow" / "skills.config.json", {"skill_id": "bad"})

    response = client.get(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error_code"] == "RH_MANIFEST_REVISION_MISMATCH"
    assert body["details"]["manifest_name"] == "skills.config.json"


def test_project_skill_endpoint_rejects_invalid_manifest_entry_without_echoing_values(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "skill_project_invalid_entry"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={
            "schema_version": "0.1.0",
            "display_name": "Skill Project Invalid Entry",
            "host_path": str(host_path),
        },
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]
    _write_json_value(
        host_path.resolve() / ".agent-workflow" / "skills.config.json",
        [
            {
                "skill_id": "citation_checker",
                "version": "1.0.0",
                "enabled": True,
                "params": {},
                "unexpected": "fake-secret-invalid-entry",
            }
        ],
    )

    response = client.get(
        f"/cw/v1/projects/{project_id}/skills",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert response.status_code == 409
    body = response.json()
    assert body["error_code"] == "RH_MANIFEST_REVISION_MISMATCH"
    assert "fake-secret-invalid-entry" not in str(body)


def test_reference_endpoints_import_and_toggle_runtime_manifest(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "reference_project"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "display_name": "Reference Project", "host_path": str(host_path)},
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]

    empty_response = client.get(
        f"/cw/v1/projects/{project_id}/references",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert empty_response.status_code == 200
    assert empty_response.json() == {"entries": [], "index_snapshot_id": ""}

    user_staged = host_path.resolve() / "user-staged.txt"
    user_untracked = host_path.resolve() / "user-untracked.txt"
    user_staged.write_text("keep staged\n", encoding="utf-8")
    user_untracked.write_text("keep untracked\n", encoding="utf-8")
    subprocess.run(["git", "add", "user-staged.txt"], cwd=host_path.resolve(), check=True)

    boundary = "cw_reference_boundary"
    file_content = b"reference body\r\n--cw_reference_boundary-not-a-delimiter\r\nmarker"
    metadata = json.dumps(
        {
            "schema_version": "0.1.0",
            "kind": "txt",
            "sensitive": False,
            "auto_chunk": True,
        }
    ).encode()
    multipart_body = b"\r\n".join(
        [
            f"--{boundary}".encode(),
            b'Content-Disposition: form-data; name="metadata"',
            b"Content-Type: application/json",
            b"",
            metadata,
            f"--{boundary}".encode(),
            b'Content-Disposition: form-data; name="file"; filename="notes.txt"',
            b"Content-Type: text/plain",
            b"",
            file_content,
            f"--{boundary}--".encode(),
            b"",
        ]
    )
    import_response = client.post(
        f"/cw/v1/projects/{project_id}/references",
        headers={
            "Authorization": "Bearer expected-token",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        content=multipart_body,
    )

    assert import_response.status_code == 201
    entry = import_response.json()
    assert entry["kind"] == "txt"
    assert entry["enabled"] is True
    assert entry["path"].startswith("references/")
    assert entry["content_hash"].startswith("sha256:")
    assert entry["chunk_status"] == "stale"
    assert (host_path.resolve() / entry["path"]).read_bytes() == file_content
    assert (host_path.resolve() / ".agent-workflow" / "locks" / "git.lock").exists() is False

    disabled_response = client.patch(
        f"/cw/v1/projects/{project_id}/references/{entry['reference_id']}",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "enabled": False},
    )
    enabled_response = client.patch(
        f"/cw/v1/projects/{project_id}/references/{entry['reference_id']}",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "enabled": True},
    )
    manifest_response = client.get(
        f"/cw/v1/projects/{project_id}/references",
        headers={"Authorization": "Bearer expected-token"},
    )

    assert disabled_response.status_code == 200
    assert disabled_response.json()["enabled"] is False
    assert enabled_response.status_code == 200
    assert enabled_response.json()["enabled"] is True
    assert manifest_response.status_code == 200
    assert manifest_response.json()["entries"][0]["enabled"] is True
    staged_after = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=host_path.resolve(),
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    status_after = subprocess.run(
        ["git", "status", "--short", "--", "user-untracked.txt"],
        cwd=host_path.resolve(),
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert staged_after == ["user-staged.txt"]
    assert status_after == "?? user-untracked.txt"
    log = subprocess.run(
        ["git", "log", "--format=%s", "-3"],
        cwd=host_path.resolve(),
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    assert log == [
        f"chore(refs): enable {entry['reference_id']}",
        f"chore(refs): disable {entry['reference_id']}",
        f"chore(refs): import {entry['reference_id']}",
    ]


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


def test_read_unknown_project_config_returns_res_not_found() -> None:
    client = _test_client()

    response = client.get("/cw/v1/projects/unknown-project/mcps", headers={"Authorization": "Bearer expected-token"})

    assert response.status_code == 404
    assert response.json()["error_code"] == "RES_NOT_FOUND"


def test_read_missing_project_config_returns_res_not_found(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "missing_config_project"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "display_name": "Missing Config Project", "host_path": str(host_path)},
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]
    (host_path.resolve() / ".agent-workflow" / "mcp.config.json").unlink()

    response = client.get(f"/cw/v1/projects/{project_id}/mcps", headers={"Authorization": "Bearer expected-token"})

    assert response.status_code == 404
    body = response.json()
    assert body["error_code"] == "RES_NOT_FOUND"
    assert body["details"]["manifest_name"] == "mcp.config.json"


def test_read_malformed_project_config_returns_res_not_found(tmp_path: Path) -> None:
    client = _test_client()
    host_path = tmp_path / "malformed_config_project"
    create_response = client.post(
        "/cw/v1/projects",
        headers={"Authorization": "Bearer expected-token"},
        json={"schema_version": "0.1.0", "display_name": "Malformed Config Project", "host_path": str(host_path)},
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["project_id"]
    (host_path.resolve() / ".agent-workflow" / "mcp.config.json").write_text("{", encoding="utf-8")

    response = client.get(f"/cw/v1/projects/{project_id}/mcps", headers={"Authorization": "Bearer expected-token"})

    assert response.status_code == 404
    body = response.json()
    assert body["error_code"] == "RES_NOT_FOUND"
    assert body["details"]["manifest_name"] == "mcp.config.json"
