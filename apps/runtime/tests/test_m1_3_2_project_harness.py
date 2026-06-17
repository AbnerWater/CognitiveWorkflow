"""M1.3.2 runtime harness project initialization tests."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from cw_runtime.harness import HarnessError, ProjectCreateRequest, initialize_project, update_manifest_json


def _request(
    display_name: str,
    host_path: Path,
    *,
    settings_overrides: dict[str, object] | None = None,
) -> ProjectCreateRequest:
    return ProjectCreateRequest(
        schema_version="0.1.0",
        display_name=display_name,
        host_path=str(host_path),
        settings_overrides={} if settings_overrides is None else settings_overrides,
    )


def _read_json(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as file:
        loaded = json.load(file)
    assert isinstance(loaded, dict)
    return loaded


def _read_json_value(path: Path) -> object:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _git_ls_files(project_root: Path) -> set[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return set(result.stdout.splitlines())


def test_initialize_project_creates_runtime_harness_skeleton(tmp_path: Path) -> None:
    project_root = tmp_path / "cw_project"

    response = initialize_project(
        _request(
            "Drone Research",
            project_root,
            settings_overrides={"privacy": {"disable_remote_models": True}},
        )
    )

    agent_root = project_root / ".agent-workflow"
    assert response.host_path == project_root.resolve().as_posix()
    assert response.git_initialized is True
    assert response.first_commit_sha is not None
    assert len(response.project_id) == 26

    for directory in (
        agent_root / "runs",
        agent_root / "planning_sessions",
        agent_root / "artifacts",
        agent_root / "snapshots",
        agent_root / "traces",
        agent_root / "secure",
        agent_root / "cache",
        agent_root / "locks",
        project_root / "references",
        project_root / "workflow",
        project_root / "outputs",
    ):
        assert directory.is_dir()

    project_manifest = _read_json(agent_root / "project.json")
    assert project_manifest["schema_version"] == "0.1.0"
    assert project_manifest["project_id"] == response.project_id
    assert project_manifest["settings_ref"] == "settings.json"
    assert project_manifest["manifest_revisions_ref"] == "manifest_revision.json"

    settings = _read_json(agent_root / "settings.json")
    privacy = settings["privacy"]
    assert isinstance(privacy, dict)
    assert privacy["sensitive_data_mode"] == "strict"
    assert privacy["disable_remote_models"] is True

    workflow = _read_json(agent_root / "workflow.flow.json")
    assert workflow["schema_version"] == "0.1.0"
    assert workflow["entry_node_id"] == "n_start"
    assert workflow["terminal_node_ids"] == ["n_end"]

    revisions = _read_json(agent_root / "manifest_revision.json")
    assert revisions["project.json"] == {"revision": 1, "modified_at": project_manifest["created_at"]}
    assert revisions["settings.json"] == {"revision": 1, "modified_at": project_manifest["created_at"]}

    gitignore = (project_root / ".gitignore").read_text(encoding="utf-8")
    assert ".agent-workflow/cache/" in gitignore
    assert ".agent-workflow/secure/" in gitignore

    gitattributes = (project_root / ".gitattributes").read_text(encoding="utf-8")
    assert ".agent-workflow/**/*.jsonl    text eol=lf" in gitattributes

    tracked = _git_ls_files(project_root)
    assert ".agent-workflow/project.json" in tracked
    assert ".agent-workflow/settings.json" in tracked
    assert ".agent-workflow/cache/" not in tracked
    assert ".agent-workflow/secure/" not in tracked
    assert _read_json_value(agent_root / "skills.config.json") == []
    assert _read_json_value(agent_root / "mcp.config.json") == []
    assert _read_json_value(agent_root / "adapters.config.json") == []


def test_initialize_project_rejects_existing_harness(tmp_path: Path) -> None:
    project_root = tmp_path / "existing_project"
    initialize_project(_request("Existing", project_root))

    with pytest.raises(HarnessError) as exc_info:
        initialize_project(_request("Existing", project_root))

    assert exc_info.value.error_code == "RES_ALREADY_EXISTS"
    assert exc_info.value.status_code == 409


def test_initialize_project_rejects_invalid_path_char() -> None:
    with pytest.raises(HarnessError) as exc_info:
        initialize_project(
            ProjectCreateRequest(schema_version="0.1.0", display_name="Invalid", host_path="bad<project")
        )

    assert exc_info.value.error_code == "RH_PATH_INVALID_CHAR"
    assert exc_info.value.status_code == 400


def test_update_manifest_json_increments_revision_and_uses_runtime_lock(tmp_path: Path) -> None:
    project_root = tmp_path / "update_project"
    initialize_project(_request("Update", project_root))

    agent_root = project_root / ".agent-workflow"
    settings = _read_json(agent_root / "settings.json")
    settings["execution"] = {
        "default_mode": "step",
        "max_concurrent_nodes": 1,
        "default_timeout_seconds": 600,
    }

    update_manifest_json(project_root, "settings.json", settings)

    revisions = _read_json(agent_root / "manifest_revision.json")
    settings_revision = revisions["settings.json"]
    assert isinstance(settings_revision, dict)
    assert settings_revision["revision"] == 2
    assert (agent_root / "locks" / "runtime.lock").exists() is False


def test_update_manifest_json_blocks_direct_memory_write(tmp_path: Path) -> None:
    project_root = tmp_path / "memory_project"
    initialize_project(_request("Memory", project_root))

    memory = _read_json(project_root / ".agent-workflow" / "memory.json")
    with pytest.raises(HarnessError) as exc_info:
        update_manifest_json(project_root, "memory.json", memory)

    assert exc_info.value.error_code == "RH_MEMORY_DIRECT_WRITE_FORBIDDEN"


def test_initialize_project_preserves_pre_staged_user_files(tmp_path: Path) -> None:
    project_root = tmp_path / "existing_git_project"
    project_root.mkdir()
    subprocess.run(["git", "init", "-b", "main"], cwd=project_root, check=True, capture_output=True, text=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Test User",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "initial user commit",
        ],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
    )
    user_file = project_root / "user_notes.txt"
    user_file.write_text("user staged content\n", encoding="utf-8")
    subprocess.run(["git", "add", "user_notes.txt"], cwd=project_root, check=True, capture_output=True, text=True)

    initialize_project(_request("Existing Git", project_root))

    head_files = subprocess.run(
        ["git", "show", "--name-only", "--format=", "HEAD"],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    staged_files = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()

    assert "user_notes.txt" not in head_files
    assert "user_notes.txt" in staged_files
