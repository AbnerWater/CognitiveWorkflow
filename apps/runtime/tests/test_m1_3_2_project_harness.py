"""M1.3.2 runtime harness project initialization tests."""

from __future__ import annotations

import json
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

import pytest

from cw_runtime.harness import (
    HarnessError,
    ProjectCreateRequest,
    ProjectMCPDiscoveredTools,
    ProjectMCPServerConfig,
    initialize_project,
    load_project_mcp_server_configs,
    load_project_tool_availability,
    load_project_tool_lock_snapshot,
    update_manifest_json,
)


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


def _write_json_value(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


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


def test_update_manifest_json_rejects_non_object_payload_without_revision_bump(tmp_path: Path) -> None:
    project_root = tmp_path / "non_object_manifest_project"
    initialize_project(_request("Non Object Manifest", project_root))
    agent_root = project_root / ".agent-workflow"
    revisions_before = _read_json(agent_root / "manifest_revision.json")
    workflow_before = _read_json(agent_root / "workflow.flow.json")

    with pytest.raises(TypeError):
        update_manifest_json(project_root, "workflow.flow.json", cast(Mapping[str, Any], []))

    assert _read_json(agent_root / "workflow.flow.json") == workflow_before
    assert _read_json(agent_root / "manifest_revision.json") == revisions_before


def test_project_tool_availability_reads_enabled_manifest_entries(tmp_path: Path) -> None:
    project_root = tmp_path / "tool_availability_project"
    initialize_project(_request("Tool Availability", project_root))
    agent_root = project_root / ".agent-workflow"

    _write_json_value(
        agent_root / "skills.config.json",
        [
            {"skill_id": "research_outline", "version": "1.2.0"},
            {"skill_id": "research_outline", "version": "2.0.0"},
            {"skill_id": "disabled_skill", "version": "1.0.0", "enabled": False},
        ],
    )
    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_local_python",
                "version": "0.5.1",
                "secret_ref": "secure://mcp/local-python",
                "tools_snapshot": [{"name": "run", "description": "Run local Python."}],
            },
            {"server_id": "disabled_mcp", "enabled": False},
        ],
    )

    availability = load_project_tool_availability(project_root)
    locks = load_project_tool_lock_snapshot(project_root)

    assert availability.skill_ids == {"research_outline"}
    assert availability.skill_refs == {"research_outline@1.2.0"}
    assert availability.mcp_server_ids == {"mcp_local_python"}
    assert [entry.model_dump(mode="json", exclude_none=True) for entry in locks.skills] == [
        {"skill_id": "research_outline", "version": "1.2.0"}
    ]
    assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
        {
            "server_id": "mcp_local_python",
            "version": "latest",
            "tools_snapshot": [],
        }
    ]


def test_project_tool_lock_snapshot_can_use_injected_mcp_discovery(tmp_path: Path) -> None:
    project_root = tmp_path / "tool_lock_discovery_project"
    initialize_project(_request("Tool Lock Discovery", project_root))
    agent_root = project_root / ".agent-workflow"
    discovered_server_ids: list[str] = []

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_local_python",
                "transport": "stdio",
                "command_or_url": "python -m local_mcp",
            },
            {"server_id": "mcp_missing_transport", "command_or_url": "missing transport"},
        ],
    )

    def discover(config: ProjectMCPServerConfig) -> ProjectMCPDiscoveredTools:
        discovered_server_ids.append(config.server_id)
        return ProjectMCPDiscoveredTools(
            version="0.5.1",
            tools_snapshot=[
                {
                    "name": "run",
                    "description": "Run local Python.",
                    "input_schema": {"type": "object"},
                }
            ],
        )

    locks = load_project_tool_lock_snapshot(project_root, mcp_tool_discovery=discover)

    assert discovered_server_ids == ["mcp_local_python"]
    assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
        {
            "server_id": "mcp_local_python",
            "version": "0.5.1",
            "tools_snapshot": [
                {
                    "name": "run",
                    "description": "Run local Python.",
                    "input_schema": {"type": "object"},
                }
            ],
        },
        {
            "server_id": "mcp_missing_transport",
            "version": "latest",
            "tools_snapshot": [],
        },
    ]


def test_project_tool_availability_treats_invalid_manifest_entries_as_disabled(tmp_path: Path) -> None:
    project_root = tmp_path / "invalid_tool_availability_project"
    initialize_project(_request("Invalid Tool Availability", project_root))
    skills_path = project_root / ".agent-workflow" / "skills.config.json"
    _write_json_value(
        skills_path,
        [
            {"skill_id": "", "enabled": True},
            {"skill_id": "bad_enabled", "enabled": "yes"},
            "bad_entry",
        ],
    )

    availability = load_project_tool_availability(project_root)

    assert availability.skill_ids == set()
    assert availability.skill_refs == set()


def test_project_mcp_server_configs_read_enabled_spec_fields_only(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_config_project"
    initialize_project(_request("MCP Config", project_root))
    agent_root = project_root / ".agent-workflow"

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_http",
                "transport": "http",
                "command_or_url": "https://mcp.example.test/http",
                "requires_approval": False,
                "version": "ignored",
                "tools_snapshot": [{"name": "ignored"}],
            },
            {
                "server_id": "mcp_stdio",
                "transport": "stdio",
                "command_or_url": "local-mcp",
                "secret_ref": "secure://mcp/local",
            },
            {"server_id": "missing_transport", "command_or_url": "local-mcp"},
            {"server_id": "disabled_mcp", "transport": "http", "command_or_url": "https://disabled", "enabled": False},
        ],
    )

    configs = load_project_mcp_server_configs(project_root)

    assert [config.model_dump(mode="json") for config in configs.values()] == [
        {
            "server_id": "mcp_http",
            "transport": "http",
            "command_or_url": "https://mcp.example.test/http",
            "requires_approval": False,
            "secret_ref": None,
        },
        {
            "server_id": "mcp_stdio",
            "transport": "stdio",
            "command_or_url": "local-mcp",
            "requires_approval": False,
            "secret_ref": "secure://mcp/local",
        },
    ]


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
