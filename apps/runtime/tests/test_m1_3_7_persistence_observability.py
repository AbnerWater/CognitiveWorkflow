"""M1.3.7 persistence / observability foundation tests."""

from __future__ import annotations

import json
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

from cw_runtime.harness import ProjectCreateRequest, initialize_project
from cw_runtime.persistence import index_stream_event
from cw_runtime.runner import ExecutionAdvanceInput, NodeAdvanceRequest, advance_workflow_run
from cw_runtime.runs import WorkflowRunStartRequest, create_workflow_run, list_stream_events, read_workflow_run
from cw_schemas.events import MetricEvent, ModelEvent
from cw_schemas.types import DisplayLevel, ExecutionMode, RunState, Sensitivity

_MODEL_POLICY: dict[str, Any] = {"primary_model_profile_id": "deterministic-foundation"}
_PROMPT: dict[str, Any] = {
    "user_prompt_template": "Process {{ node_goal }}",
    "template_engine": "handlebars",
}


def _execution_contract() -> dict[str, Any]:
    return {
        "contract_id": "ctr_execute",
        "contract_kind": "execution",
        "goal": "Execute task",
        "model_policy": _MODEL_POLICY,
        "prompt": _PROMPT,
        "retry_policy": {"max_attempts": 3},
    }


def _execution_graph_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_persistence",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Persistence Workflow",
        "nodes": [
            {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
            {
                "node_id": "n_execute",
                "type": "execution_task",
                "title": "Execute",
                "contract": _execution_contract(),
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
            {"edge_id": "e_execute_end", "source_node_id": "n_execute", "target_node_id": "n_end", "type": "normal"},
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
            "default_model_profile_id": "deterministic-foundation",
            "escalation_chain": [],
            "forbid_remote_for_sensitive": True,
        },
        "created_by": "ai_planning",
        "created_at": "2026-06-17T00:00:00Z",
        "last_modified_at": "2026-06-17T00:00:00Z",
        "metadata": {},
    }


def _create_project_with_graph(tmp_path: Path) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Persistence Project",
            host_path=str(tmp_path / "persistence_project"),
        )
    )
    project_root = Path(response.host_path)
    settings_path = project_root / ".agent-workflow" / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    settings["models"]["escalation_chain"] = []
    settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    payload = _execution_graph_payload()
    workflow_path = project_root / ".agent-workflow" / "workflow.flow.json"
    workflow_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return project_root, str(payload["workflow_id"])


def _start_run(project_root: Path, workflow_id: str) -> str:
    response = create_workflow_run(
        project_root,
        workflow_id,
        WorkflowRunStartRequest(
            schema_version="0.1.0",
            mode=ExecutionMode.SEMI_AUTO,
            initial_input={},
            metadata={},
        ),
    )
    return response.run_id


def _complete_execution_run(project_root: Path, workflow_id: str) -> str:
    run_id = _start_run(project_root, workflow_id)
    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
    )
    completed = advance_workflow_run(project_root, run_id)
    assert completed.run.state == RunState.COMPLETED
    return run_id


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line:
            continue
        loaded = json.loads(raw_line)
        assert isinstance(loaded, dict)
        rows.append(loaded)
    return rows


def _git_lines(project_root: Path, *args: str) -> list[str]:
    result = subprocess.run(["git", *args], cwd=project_root, check=True, capture_output=True, text=True)
    return [line for line in result.stdout.splitlines() if line]


def test_initialize_project_creates_runtime_databases_and_initial_snapshot(tmp_path: Path) -> None:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Persistence Init",
            host_path=str(tmp_path / "persistence_init"),
        )
    )
    project_root = Path(response.host_path)
    agent_root = project_root / ".agent-workflow"

    assert (agent_root / "cache" / "runtime_index.sqlite").exists()
    trace_path = agent_root / "traces" / "trace.sqlite"
    assert trace_path.exists()

    with sqlite3.connect(trace_path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"spans", "resources", "metrics"}.issubset(tables)

    snapshots = _read_jsonl(agent_root / "snapshots" / "snapshots.jsonl")
    assert snapshots == [
        {
            "attempt_id": None,
            "commit_sha": response.first_commit_sha,
            "created_at": snapshots[0]["created_at"],
            "event_type": None,
            "git_tag": None,
            "kind": "project.initialized",
            "message": f"chore(cw): initialize CognitiveWorkflow project {response.project_id}",
            "node_id": None,
            "refs": {"project_id": response.project_id},
            "run_id": None,
            "schema_version": "0.1.0",
            "snapshot_id": snapshots[0]["snapshot_id"],
            "workflow_id": None,
            "workflow_version": None,
        }
    ]


def test_completed_run_updates_runtime_index_and_trace_sqlite(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path)
    run_id = _complete_execution_run(project_root, workflow_id)
    agent_root = project_root / ".agent-workflow"

    events = list_stream_events(project_root, run_id)
    with sqlite3.connect(agent_root / "cache" / "runtime_index.sqlite") as conn:
        run_row = conn.execute(
            "SELECT state, workflow_id, git_snapshots_json FROM runtime_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        stream_count = conn.execute(
            "SELECT COUNT(*) FROM runtime_stream_events WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        attempt_count = conn.execute(
            "SELECT COUNT(*) FROM runtime_jsonl_records WHERE run_id = ? AND filename = 'attempts.jsonl'",
            (run_id,),
        ).fetchone()

    assert run_row is not None
    assert run_row[0] == "completed"
    assert run_row[1] == workflow_id
    git_snapshots = json.loads(str(run_row[2]))
    assert isinstance(git_snapshots, list)
    assert len(git_snapshots) == 3
    assert stream_count is not None
    assert stream_count[0] == len(events)
    assert attempt_count is not None
    assert attempt_count[0] == 1

    with sqlite3.connect(agent_root / "traces" / "trace.sqlite") as conn:
        span_names = {row[0] for row in conn.execute("SELECT DISTINCT name FROM spans")}
        attributes_blob = "\n".join(row[0] for row in conn.execute("SELECT attributes_json FROM spans"))
        resource_count = conn.execute("SELECT COUNT(*) FROM resources").fetchone()

    assert {"cw.workflow.run", "cw.workflow.attempt", "cw.runtime.git_commit"}.issubset(span_names)
    assert '"cw.event.type":"run.started"' in attributes_blob
    assert "draft" not in attributes_blob
    assert "ok" not in attributes_blob
    assert resource_count is not None
    assert resource_count[0] >= 1


def test_trace_exporter_uses_correlation_id_and_skips_delta_or_metric_spans(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path)
    run_id = _start_run(project_root, workflow_id)
    agent_root = project_root / ".agent-workflow"
    correlation_id = "00112233445566778899aabbccddeeff"

    index_stream_event(
        project_root,
        ModelEvent(
            event_id="evt_model_request_started",
            seq=100,
            correlation_id=correlation_id,
            run_id=run_id,
            node_id="n_execute",
            attempt_id="attempt_trace_001",
            type="model.request_started",
            phase=None,
            title="Model request started",
            summary=None,
            content=None,
            payload={"model_profile_id": "deterministic-foundation"},
            display_level=DisplayLevel.DEFAULT,
            sensitivity=Sensitivity.PUBLIC,
            expandable=False,
            created_at="2026-06-17T00:00:00.000Z",
            model_profile_id="deterministic-foundation",
        ),
    )
    index_stream_event(
        project_root,
        ModelEvent(
            event_id="evt_model_text_delta",
            seq=101,
            correlation_id=correlation_id,
            run_id=run_id,
            node_id="n_execute",
            attempt_id="attempt_trace_001",
            type="model.text_delta",
            phase=None,
            title="Text delta",
            summary=None,
            content=None,
            payload={"delta_text": "draft text"},
            display_level=DisplayLevel.MINIMAL,
            sensitivity=Sensitivity.PUBLIC,
            expandable=False,
            created_at="2026-06-17T00:00:00.001Z",
            model_profile_id="deterministic-foundation",
        ),
    )
    index_stream_event(
        project_root,
        MetricEvent(
            event_id="evt_metric_snapshot",
            seq=102,
            correlation_id=correlation_id,
            run_id=run_id,
            node_id=None,
            attempt_id=None,
            type="metric.snapshot",
            phase=None,
            title="Metric snapshot",
            summary=None,
            content=None,
            payload={"metrics": {"cw.node.pass_rate": 0.75}},
            display_level=DisplayLevel.MINIMAL,
            sensitivity=Sensitivity.PUBLIC,
            expandable=False,
            created_at="2026-06-17T00:00:00.002Z",
            metrics={"cw.node.pass_rate": 0.75},
        ),
    )

    with sqlite3.connect(agent_root / "traces" / "trace.sqlite") as conn:
        request_trace = conn.execute(
            "SELECT hex(trace_id) FROM spans WHERE attributes_json LIKE ?",
            ('%"cw.event.type":"model.request_started"%',),
        ).fetchone()
        text_delta_spans = conn.execute(
            "SELECT COUNT(*) FROM spans WHERE attributes_json LIKE ?",
            ('%"cw.event.type":"model.text_delta"%',),
        ).fetchone()
        metric_spans = conn.execute(
            "SELECT COUNT(*) FROM spans WHERE attributes_json LIKE ?",
            ('%"cw.event.type":"metric.snapshot"%',),
        ).fetchone()
        metric_rows = conn.execute(
            "SELECT value_double FROM metrics WHERE name = ?",
            ("cw.node.pass_rate",),
        ).fetchall()

    assert request_trace is not None
    assert str(request_trace[0]).lower() == correlation_id
    assert text_delta_spans is not None
    assert text_delta_spans[0] == 0
    assert metric_spans is not None
    assert metric_spans[0] == 0
    assert metric_rows == [(0.75,)]


def test_git_snapshots_are_recorded_without_tracking_stream_or_sqlite_outputs(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path)
    run_id = _complete_execution_run(project_root, workflow_id)
    agent_root = project_root / ".agent-workflow"

    run = read_workflow_run(project_root, run_id)
    snapshots = _read_jsonl(agent_root / "snapshots" / "snapshots.jsonl")
    snapshot_kinds = [snapshot["kind"] for snapshot in snapshots]

    assert run.git_snapshots == [snapshot["snapshot_id"] for snapshot in snapshots if snapshot["run_id"] == run_id]
    assert snapshot_kinds == ["project.initialized", "run.started", "attempt.completed", "run.completed"]
    terminal_snapshot = snapshots[-1]
    assert terminal_snapshot["git_tag"] == f"run-{run_id}-completed"
    assert terminal_snapshot["message"] == f"chore(run): end {run_id} state=completed"

    tracked = set(_git_lines(project_root, "ls-files"))
    assert f".agent-workflow/runs/{run_id}/run.json" in tracked
    assert not any("/stream-events/" in path for path in tracked)
    assert not any(path.startswith(".agent-workflow/traces/") for path in tracked)
    assert not any(path.startswith(".agent-workflow/cache/") for path in tracked)

    tags = set(_git_lines(project_root, "tag", "--list"))
    assert f"run-{run_id}-completed" in tags
