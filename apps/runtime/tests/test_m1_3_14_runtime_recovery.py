"""M1.3.14 sidecar restart recovery foundation tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from cw_runtime.engine import load_workflow_graph
from cw_runtime.harness import ProjectCreateRequest, initialize_project
from cw_runtime.runs import (
    RunError,
    WorkflowRunStartRequest,
    cancel_workflow_run,
    create_workflow_run,
    list_stream_events,
    read_workflow_run,
    recover_project_runs,
)
from cw_runtime.runs.lifecycle import RunActionRequest
from cw_schemas.types import ExecutionMode, RunState


def _create_project(tmp_path: Path, name: str) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name=name,
            host_path=str(tmp_path / name),
        )
    )
    project_root = Path(response.host_path)
    graph = load_workflow_graph(project_root)
    return project_root, graph.workflow_id


def _start_request() -> WorkflowRunStartRequest:
    return WorkflowRunStartRequest(
        schema_version="0.1.0",
        mode=ExecutionMode.SEMI_AUTO,
        initial_input={"topic": "restart recovery"},
        metadata={},
    )


def _action_request(reason: str | None = None) -> RunActionRequest:
    return RunActionRequest(schema_version="0.1.0", by="tester", reason=reason)


def _read_json(path: Path) -> dict[str, Any]:
    loaded = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def test_recover_project_runs_downgrades_running_to_paused_and_emits_recovery_events(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path, "running_recovery")
    started = create_workflow_run(project_root, workflow_id, _start_request())
    original_last_event_id = list_stream_events(project_root, started.run_id)[-1].event_id

    result = recover_project_runs(project_root, runtime_version="0.1.0", http_port=8123)

    assert result.schema_version == "0.1.0"
    assert result.project_root == project_root.resolve().as_posix()
    assert result.active_run_count == 1
    recovered = result.recovered_runs[0]
    assert recovered.run_id == started.run_id
    assert recovered.previous_state == RunState.RUNNING
    assert recovered.recovered_state == RunState.PAUSED
    assert recovered.was_downgraded is True
    assert recovered.last_event_id_before_recovery == original_last_event_id

    run = read_workflow_run(project_root, started.run_id)
    assert run.state == RunState.PAUSED
    assert run.previous_state == RunState.RUNNING
    assert run.paused_at == result.recovered_at
    assert run.current_node_ids == ["n_start"]

    events = list_stream_events(project_root, started.run_id)
    assert [event.type for event in events] == [
        "run.started",
        "run.paused",
        "system.runtime_ready",
        "run.resumed",
    ]
    assert events[1].payload == {"reason": "sidecar_restart"}
    assert events[2].payload == {
        "runtime_version": "0.1.0",
        "http_port": 8123,
        "schema_versions": {"runtime": "0.1.0", "stream_event": "0.1.0"},
    }
    assert events[3].payload == {
        "from_checkpoint_id": None,
        "last_event_id": original_last_event_id,
        "recovered_state": "paused",
    }
    assert run.last_event_id == events[-1].event_id
    assert recovered.runtime_ready_event_id == events[2].event_id
    assert recovered.recovery_event_id == events[3].event_id


@pytest.mark.parametrize("state", [RunState.PAUSED, RunState.WAITING_USER, RunState.REPAIRING])
def test_recover_project_runs_keeps_recoverable_non_running_states(tmp_path: Path, state: RunState) -> None:
    project_root, workflow_id = _create_project(tmp_path, f"{state.value}_recovery")
    started = create_workflow_run(project_root, workflow_id, _start_request())
    run_json_path = project_root / ".agent-workflow" / "runs" / started.run_id / "run.json"
    run_json = _read_json(run_json_path)
    run_json["state"] = state.value
    run_json["previous_state"] = "running"
    _write_json(run_json_path, run_json)

    original_last_event_id = list_stream_events(project_root, started.run_id)[-1].event_id

    result = recover_project_runs(project_root, runtime_version="0.1.0")

    assert result.active_run_count == 1
    recovered = result.recovered_runs[0]
    assert recovered.previous_state == state
    assert recovered.recovered_state == state
    assert recovered.was_downgraded is False
    assert recovered.last_event_id_before_recovery == original_last_event_id

    run = read_workflow_run(project_root, started.run_id)
    assert run.state == state
    assert run.previous_state == RunState.RUNNING

    events = list_stream_events(project_root, started.run_id)
    assert [event.type for event in events] == ["run.started", "system.runtime_ready", "run.resumed"]
    assert events[-1].payload == {
        "from_checkpoint_id": None,
        "last_event_id": original_last_event_id,
        "recovered_state": state.value,
    }


def test_recover_project_runs_skips_terminal_runs(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path, "terminal_recovery")
    started = create_workflow_run(project_root, workflow_id, _start_request())
    cancel_workflow_run(project_root, started.run_id, _action_request("terminal"))

    result = recover_project_runs(project_root, runtime_version="0.1.0")

    assert result.active_run_count == 0
    assert result.recovered_runs == []
    events = list_stream_events(project_root, started.run_id)
    assert [event.type for event in events] == ["run.started", "run.cancelled"]
    assert read_workflow_run(project_root, started.run_id).state == RunState.CANCELLED


def test_recover_project_runs_surfaces_corrupted_run_json(tmp_path: Path) -> None:
    project_root, _workflow_id = _create_project(tmp_path, "corrupt_recovery")
    run_root = project_root / ".agent-workflow" / "runs" / "run_corrupt"
    run_root.mkdir(parents=True)
    (run_root / "run.json").write_text("{", encoding="utf-8")

    with pytest.raises(RunError) as exc_info:
        recover_project_runs(project_root, runtime_version="0.1.0")

    assert exc_info.value.error_code == "RH_RUN_DIR_CORRUPTED"


def test_recover_project_runs_requires_run_json_in_run_directory(tmp_path: Path) -> None:
    project_root, _workflow_id = _create_project(tmp_path, "missing_run_json_recovery")
    run_root = project_root / ".agent-workflow" / "runs" / "run_missing"
    run_root.mkdir(parents=True)

    with pytest.raises(RunError) as exc_info:
        recover_project_runs(project_root, runtime_version="0.1.0")

    assert exc_info.value.error_code == "RH_RUN_DIR_CORRUPTED"
    missing_path = exc_info.value.details["path"]
    assert isinstance(missing_path, str)
    assert missing_path.endswith("/.agent-workflow/runs/run_missing/run.json")


def test_recover_project_runs_wraps_schema_invalid_run_json(tmp_path: Path) -> None:
    project_root, _workflow_id = _create_project(tmp_path, "schema_invalid_recovery")
    run_root = project_root / ".agent-workflow" / "runs" / "run_schema_invalid"
    run_root.mkdir(parents=True)
    _write_json(run_root / "run.json", {"run_id": "run_schema_invalid"})

    with pytest.raises(RunError) as exc_info:
        recover_project_runs(project_root, runtime_version="0.1.0")

    assert exc_info.value.error_code == "RH_RUN_DIR_CORRUPTED"
    invalid_path = exc_info.value.details["path"]
    assert isinstance(invalid_path, str)
    assert invalid_path.endswith("/.agent-workflow/runs/run_schema_invalid/run.json")
    assert "errors" in exc_info.value.details
