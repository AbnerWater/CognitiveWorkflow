"""M1.3.4 WorkflowRun lifecycle and StreamEvent persistence tests."""

from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest

from cw_runtime.engine import WorkflowValidationError, load_workflow_graph
from cw_runtime.harness import ProjectCreateRequest, initialize_project, update_manifest_json
from cw_runtime.runs import (
    RunActionRequest,
    RunError,
    WorkflowRunStartRequest,
    cancel_workflow_run,
    create_workflow_run,
    format_sse_event,
    list_stream_events,
    pause_workflow_run,
    read_workflow_run,
    resume_workflow_run,
    stream_sse_events,
)
from cw_runtime.runs.lifecycle import parse_display_levels, parse_event_categories
from cw_schemas.events import validate_stream_event
from cw_schemas.types import DisplayLevel, EventCategory, ExecutionMode, RunState


def _create_project(tmp_path: Path) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Run Project",
            host_path=str(tmp_path / "run_project"),
        )
    )
    project_root = Path(response.host_path)
    graph = load_workflow_graph(project_root)
    return project_root, graph.workflow_id


def _start_request() -> WorkflowRunStartRequest:
    return WorkflowRunStartRequest(
        schema_version="0.1.0",
        mode=ExecutionMode.SEMI_AUTO,
        initial_input={"topic": "run lifecycle"},
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


def _write_json_value(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def test_create_workflow_run_writes_run_directory_and_started_event(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)

    response = create_workflow_run(project_root, workflow_id, _start_request())

    run_root = project_root / ".agent-workflow" / "runs" / response.run_id
    run_json = _read_json(run_root / "run.json")
    assert "schema_version" not in run_json
    assert run_json["state"] == "running"
    assert run_json["previous_state"] == "ready"
    assert run_json["mode"] == "semi_auto"
    assert run_json["current_node_ids"] == ["n_start"]
    assert response.stream_url == f"/cw/v1/runs/{response.run_id}/stream"

    events = list_stream_events(project_root, response.run_id)
    assert [event.type for event in events] == ["run.started"]
    assert events[0].seq == 0
    assert events[0].phase == "run.started"
    assert events[0].payload == {"workflow_id": workflow_id, "workflow_version": "0.1.0", "mode": "semi_auto"}
    assert run_json["last_event_id"] == events[0].event_id

    persisted_event_lines = list((run_root / "stream-events").glob("*.jsonl"))
    assert len(persisted_event_lines) == 1
    persisted = json.loads(persisted_event_lines[0].read_text(encoding="utf-8").splitlines()[0])
    validate_stream_event(persisted)


def test_create_workflow_run_uses_project_skill_manifest_context(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)
    workflow = _read_json(project_root / ".agent-workflow" / "workflow.flow.json")
    workflow["nodes"] = [
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
                    "user_prompt_template": "Process {{ deps.input }}",
                    "template_engine": "handlebars",
                },
                "skills": [{"skill_id": "research_outline", "version": "1.2.0"}],
                "mcp_tools": [{"server_id": "mcp_local_python", "tool_name": "run"}],
            },
        },
        {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
    ]
    workflow["edges"] = [
        {"edge_id": "e_start_execute", "source_node_id": "n_start", "target_node_id": "n_execute", "type": "normal"},
        {"edge_id": "e_execute_end", "source_node_id": "n_execute", "target_node_id": "n_end", "type": "normal"},
    ]
    update_manifest_json(project_root, "workflow.flow.json", workflow)

    with pytest.raises(WorkflowValidationError) as exc_info:
        create_workflow_run(project_root, workflow_id, _start_request())

    assert exc_info.value.error_code == "WG_L4_UNKNOWN_SKILL"
    assert exc_info.value.details["skill_id"] == "research_outline"

    _write_json_value(
        project_root / ".agent-workflow" / "skills.config.json",
        [{"skill_id": "research_outline", "version": "1.2.0"}],
    )
    with pytest.raises(WorkflowValidationError) as mcp_exc_info:
        create_workflow_run(project_root, workflow_id, _start_request())

    assert mcp_exc_info.value.error_code == "WG_L4_UNKNOWN_MCP"
    assert mcp_exc_info.value.details["server_id"] == "mcp_local_python"

    _write_json_value(
        project_root / ".agent-workflow" / "mcp.config.json",
        [{"server_id": "mcp_local_python", "version": "0.5.1"}],
    )
    response = create_workflow_run(project_root, workflow_id, _start_request())

    assert response.run_id


def test_run_pause_resume_cancel_emit_monotonic_events(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)
    started = create_workflow_run(project_root, workflow_id, _start_request())

    paused = pause_workflow_run(project_root, started.run_id, _action_request("user_pause"))
    resumed = resume_workflow_run(project_root, started.run_id, _action_request("user_resume"))
    cancelled = cancel_workflow_run(project_root, started.run_id, _action_request("user_cancel"))

    assert paused.state == RunState.PAUSED
    assert resumed.state == RunState.RUNNING
    assert cancelled.state == RunState.CANCELLED
    assert cancelled.current_node_ids == []
    assert cancelled.cancellation_summary is not None
    assert cancelled.cancellation_summary.reason == "user_cancel"

    events = list_stream_events(project_root, started.run_id)
    assert [(event.seq, event.type) for event in events] == [
        (0, "run.started"),
        (1, "run.paused"),
        (2, "run.resumed"),
        (3, "run.cancelled"),
    ]
    assert read_workflow_run(project_root, started.run_id).last_event_id == events[-1].event_id


def test_terminal_run_rejects_resume_and_second_cancel(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)
    started = create_workflow_run(project_root, workflow_id, _start_request())
    cancel_workflow_run(project_root, started.run_id, _action_request())

    with pytest.raises(RunError) as resume_exc_info:
        resume_workflow_run(project_root, started.run_id, _action_request())

    assert resume_exc_info.value.error_code == "WR_RESUME_AFTER_TERMINAL"

    with pytest.raises(RunError) as cancel_exc_info:
        cancel_workflow_run(project_root, started.run_id, _action_request())

    assert cancel_exc_info.value.error_code == "WR_STATE_FORBIDDEN_TRANSITION"


def test_concurrent_run_for_same_workflow_is_forbidden(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)
    create_workflow_run(project_root, workflow_id, _start_request())

    with pytest.raises(RunError) as exc_info:
        create_workflow_run(project_root, workflow_id, _start_request())

    assert exc_info.value.error_code == "WR_CONCURRENT_RUN_FORBIDDEN"
    assert exc_info.value.status_code == 409


def test_concurrent_start_requests_are_serialized_by_runtime_lock(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)

    def start_run() -> str:
        try:
            create_workflow_run(project_root, workflow_id, _start_request())
        except RunError as exc:
            return exc.error_code
        return "created"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _index: start_run(), range(2)))

    assert results.count("created") == 1
    assert results.count("WR_CONCURRENT_RUN_FORBIDDEN") == 1


def test_resume_does_not_bypass_waiting_user_or_repairing_triggers(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)
    started = create_workflow_run(project_root, workflow_id, _start_request())
    run_json_path = project_root / ".agent-workflow" / "runs" / started.run_id / "run.json"

    waiting_user = _read_json(run_json_path)
    waiting_user["state"] = "waiting_user"
    waiting_user["previous_state"] = "running"
    _write_json(run_json_path, waiting_user)
    with pytest.raises(RunError) as waiting_exc_info:
        resume_workflow_run(project_root, started.run_id, _action_request("decision_required"))
    assert waiting_exc_info.value.error_code == "WR_STATE_FORBIDDEN_TRANSITION"

    repairing = _read_json(run_json_path)
    repairing["state"] = "repairing"
    repairing["previous_state"] = "running"
    _write_json(run_json_path, repairing)
    with pytest.raises(RunError) as repairing_exc_info:
        resume_workflow_run(project_root, started.run_id, _action_request("patch_required"))
    assert repairing_exc_info.value.error_code == "WR_STATE_FORBIDDEN_TRANSITION"


def test_live_sse_stream_emits_system_heartbeat(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)
    started = create_workflow_run(project_root, workflow_id, _start_request())
    last_event_id = list_stream_events(project_root, started.run_id)[-1].event_id

    async def read_first_live_frame() -> str:
        stream = stream_sse_events(
            project_root,
            started.run_id,
            after_event_id=last_event_id,
            heartbeat_seconds=0.001,
            poll_seconds=0.001,
        )
        try:
            return await asyncio.wait_for(anext(stream), timeout=1.0)
        finally:
            await stream.aclose()

    frame = asyncio.run(read_first_live_frame())

    assert "event: system.heartbeat" in frame
    heartbeat = list_stream_events(project_root, started.run_id)[-1]
    assert heartbeat.type == "system.heartbeat"
    assert heartbeat.category == EventCategory.SYSTEM


def test_stream_events_are_blocked_from_git_tracking(tmp_path: Path) -> None:
    project_root, _workflow_id = _create_project(tmp_path)

    gitignore = (project_root / ".gitignore").read_text(encoding="utf-8")
    assert ".agent-workflow/runs/*/stream-events/" in gitignore
    assert ".agent-workflow/planning_sessions/*/stream-events.jsonl" in gitignore

    pre_commit = (project_root / ".git" / "hooks" / "pre-commit").read_text(encoding="utf-8")
    assert "run stream-events must not be committed" in pre_commit
    assert "planning stream-events must not be committed" in pre_commit


def test_stream_replay_filters_and_sse_format(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)
    started = create_workflow_run(project_root, workflow_id, _start_request())
    pause_workflow_run(project_root, started.run_id, _action_request())
    cancel_workflow_run(project_root, started.run_id, _action_request())

    events = list_stream_events(project_root, started.run_id)
    replay = list_stream_events(project_root, started.run_id, after_event_id=events[0].event_id)
    assert [event.type for event in replay] == ["run.paused", "run.cancelled"]

    ranged = list_stream_events(project_root, started.run_id, since_seq=1, until_seq=1)
    assert [event.type for event in ranged] == ["run.paused"]

    filtered = list_stream_events(
        project_root,
        started.run_id,
        categories=parse_event_categories("lifecycle"),
        display_levels=parse_display_levels("default"),
    )
    assert len(filtered) == 3
    assert filtered[0].category == EventCategory.LIFECYCLE
    assert filtered[0].display_level == DisplayLevel.DEFAULT

    sse_frame = format_sse_event(events[0])
    assert sse_frame.startswith(f"id: {events[0].event_id}\nevent: run.started\nretry: 3000\ndata: ")
    assert sse_frame.endswith("\n\n")

    with pytest.raises(RunError) as replay_exc_info:
        list_stream_events(project_root, started.run_id, after_event_id="missing_event")

    assert replay_exc_info.value.error_code == "SE_SSE_REPLAY_NOT_FOUND"
    assert replay_exc_info.value.status_code == 412
