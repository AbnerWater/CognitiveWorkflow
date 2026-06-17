"""M1.3.5 deterministic node runner foundation tests."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from cw_runtime.harness import ProjectCreateRequest, initialize_project
from cw_runtime.runner import (
    EvaluationAdvanceInput,
    ExecutionAdvanceInput,
    HumanGateAdvanceInput,
    NodeAdvanceRequest,
    RepairAdvanceInput,
    advance_workflow_run,
)
from cw_runtime.runs import (
    RunError,
    WorkflowRunStartRequest,
    create_workflow_run,
    list_stream_events,
    read_workflow_run,
)
from cw_schemas.types import ExecutionMode, FailureType, RunState

_MODEL_POLICY: dict[str, Any] = {"primary_model_profile_id": "deterministic-foundation"}
_PROMPT: dict[str, Any] = {
    "user_prompt_template": "Process {{ node_goal }}",
    "template_engine": "handlebars",
}


def _execution_contract(max_attempts: int = 3) -> dict[str, Any]:
    return {
        "contract_id": "ctr_execute",
        "contract_kind": "execution",
        "goal": "Execute task",
        "model_policy": _MODEL_POLICY,
        "prompt": _PROMPT,
        "retry_policy": {"max_attempts": max_attempts},
    }


def _evaluation_contract() -> dict[str, Any]:
    return {
        "contract_id": "ctr_evaluate",
        "contract_kind": "evaluation",
        "goal": "Evaluate task",
        "model_policy": _MODEL_POLICY,
        "prompt": _PROMPT,
        "criteria": [
            {
                "criterion_id": "c_quality",
                "description": "Output is acceptable",
                "kind": "rubric",
                "severity": "blocker",
                "weight": 1.0,
            }
        ],
        "pass_condition": {"combinator": "all_pass", "must_pass_blockers": True},
        "fail_condition": {"combinator": "any_pass", "must_pass_blockers": True},
    }


def _repair_contract() -> dict[str, Any]:
    return {
        "contract_id": "ctr_repair",
        "contract_kind": "repair",
        "goal": "Repair task",
        "model_policy": _MODEL_POLICY,
        "prompt": _PROMPT,
        "repair_strategies": [{"kind": "prompt_patch", "applies_to_failure_types": ["format_error"], "max_uses": 2}],
    }


def _human_contract() -> dict[str, Any]:
    return {
        "contract_id": "ctr_human",
        "contract_kind": "human_gate",
        "goal": "Ask for human approval",
        "model_policy": _MODEL_POLICY,
        "decisions": [{"key": "continue"}, {"key": "reject"}],
        "prompt_to_user": "Approve this workflow decision.",
    }


def _runner_graph_payload(
    *,
    include_repair: bool = False,
    include_human_on_fail: bool = False,
    execution_max_attempts: int = 3,
) -> dict[str, Any]:
    fail_target = "n_repair" if include_repair else "n_human" if include_human_on_fail else "n_end"
    nodes: list[dict[str, Any]] = [
        {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
        {
            "node_id": "n_execute",
            "type": "execution_task",
            "title": "Execute",
            "contract": _execution_contract(max_attempts=execution_max_attempts),
        },
        {
            "node_id": "n_review",
            "type": "evaluation_task",
            "title": "Review",
            "target_node_id": "n_execute",
            "on_pass_next_node_id": "n_end",
            "on_fail_next_node_id": fail_target,
            "max_retry": 2,
            "contract": _evaluation_contract(),
        },
        {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
    ]
    if include_repair:
        nodes.insert(
            3,
            {
                "node_id": "n_repair",
                "type": "repair_task",
                "title": "Repair",
                "repair_target_node_id": "n_execute",
                "failure_input_ref": "$last_evaluation",
                "on_repair_next_node_id": "n_execute",
                "contract": _repair_contract(),
            },
        )
    if include_human_on_fail:
        nodes.insert(
            -1,
            {
                "node_id": "n_human",
                "type": "human_checkpoint",
                "title": "Human Review",
                "decisions": [{"key": "continue"}, {"key": "reject"}],
                "routing_map": {"continue": "n_end", "reject": "n_end"},
                "contract": _human_contract(),
            },
        )

    return {
        "workflow_id": "wf_runner",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Runner Workflow",
        "nodes": nodes,
        "edges": [
            {
                "edge_id": "e_start_execute",
                "source_node_id": "n_start",
                "target_node_id": "n_execute",
                "type": "normal",
            },
            {
                "edge_id": "e_execute_review",
                "source_node_id": "n_execute",
                "target_node_id": "n_review",
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
            "default_model_profile_id": "deterministic-foundation",
            "escalation_chain": [],
            "forbid_remote_for_sensitive": True,
        },
        "created_by": "ai_planning",
        "created_at": "2026-06-17T00:00:00Z",
        "last_modified_at": "2026-06-17T00:00:00Z",
        "metadata": {},
    }


def _human_graph_payload() -> dict[str, Any]:
    payload = _runner_graph_payload()
    payload["nodes"] = [
        {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
        {
            "node_id": "n_human",
            "type": "human_checkpoint",
            "title": "Human Review",
            "decisions": [{"key": "continue"}, {"key": "reject"}],
            "routing_map": {"continue": "n_end", "reject": "n_end"},
            "contract": _human_contract(),
        },
        {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
    ]
    payload["edges"] = [
        {"edge_id": "e_start_human", "source_node_id": "n_start", "target_node_id": "n_human", "type": "normal"},
        {"edge_id": "e_human_end", "source_node_id": "n_human", "target_node_id": "n_end", "type": "human"},
    ]
    payload["workflow_id"] = "wf_human_runner"
    return payload


def _create_project_with_graph(tmp_path: Path, payload: dict[str, Any]) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Runner Project",
            host_path=str(tmp_path / "runner_project"),
        )
    )
    project_root = Path(response.host_path)
    settings_path = project_root / ".agent-workflow" / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    settings["models"]["escalation_chain"] = []
    settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
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


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line:
            continue
        loaded = json.loads(raw_line)
        assert isinstance(loaded, dict)
        rows.append(loaded)
    return rows


def _read_run_json(project_root: Path, run_id: str) -> dict[str, Any]:
    loaded = json.loads((project_root / ".agent-workflow" / "runs" / run_id / "run.json").read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _write_run_json(project_root: Path, run_id: str, payload: dict[str, Any]) -> None:
    (project_root / ".agent-workflow" / "runs" / run_id / "run.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def test_runner_advances_pass_path_to_completed_run(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _runner_graph_payload())
    run_id = _start_run(project_root, workflow_id)

    start = advance_workflow_run(project_root, run_id)
    execution = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
    )
    evaluation = advance_workflow_run(project_root, run_id)
    completed = advance_workflow_run(project_root, run_id)

    assert start.next_node_ids == ["n_execute"]
    assert execution.next_node_ids == ["n_review"]
    assert execution.node_state == "validating"
    assert evaluation.next_node_ids == ["n_end"]
    assert completed.run.state == RunState.COMPLETED
    assert completed.run.current_node_ids == []

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    evaluations = _read_jsonl(run_root / "evaluations.jsonl")
    assert [attempt["node_id"] for attempt in attempts] == ["n_execute", "n_review"]
    assert attempts[0]["state"] == "completed"
    assert (run_root / "context_packs" / f"{attempts[0]['context_pack_id']}.json").exists()
    assert (run_root / "execution_packs" / f"{attempts[0]['execution_pack_id']}.json").exists()
    assert evaluations[0]["passed"] is True
    assert evaluations[0]["criterion_results"][0]["criterion_id"] == "c_quality"
    assert evaluations[0]["provenance"]["criteria_hash"]

    events = list_stream_events(project_root, run_id)
    event_types = [event.type for event in events]
    assert "evaluation.started" in event_types
    assert "evaluation.completed" in event_types
    assert event_types[-1] == "run.completed"
    attempt_started = next(event for event in events if event.type == "attempt.started")
    assert attempt_started.payload is not None
    assert attempt_started.payload["attempt_index"] == 0
    assert attempt_started.payload["model_profile_id"] == "deterministic-foundation"
    run_completed = events[-1]
    assert run_completed.payload is not None
    assert "artifact_summary" in run_completed.payload


def test_runner_persists_failed_evaluation_repair_patch_and_retries_target(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _runner_graph_payload(include_repair=True))
    run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root, run_id, NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "bad"}))
    )
    failed = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(
            evaluation=EvaluationAdvanceInput(
                passed=False,
                score=0.2,
                finding_message="Output is missing required structure.",
            )
        ),
    )
    repaired = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(repair=RepairAdvanceInput(instruction_text="Return a JSON object with draft.")),
    )

    assert failed.node_state == "review_failed"
    assert failed.next_node_ids == ["n_repair"]
    assert repaired.next_node_ids == ["n_execute"]

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    evaluations = _read_jsonl(run_root / "evaluations.jsonl")
    repairs = _read_jsonl(run_root / "repairs.jsonl")
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    assert evaluations[0]["passed"] is False
    assert evaluations[0]["failure_diagnosis"]["failure_type"] == "format_error"
    assert evaluations[0]["criterion_results"][0]["criterion_id"] == "c_quality"
    assert repairs[0]["patch_kind"] == "prompt_patch"
    assert repairs[0]["applies_to_attempts"] == [attempts[0]["attempt_id"]]
    assert attempts[-1]["node_id"] == "n_repair"
    assert attempts[-1]["effective_prompt_overlay_ref"] is None

    run_json = _read_run_json(project_root, run_id)
    assert run_json["metadata"]["cw"]["node_states"]["n_execute"] == "retrying"
    assert "n_execute" in run_json["metadata"]["cw"]["pending_prompt_overlays"]
    events = list_stream_events(project_root, run_id)
    event_types = [event.type for event in events]
    assert "repair.patch_proposed" in event_types
    assert "repair.patch_applied" in event_types
    patch_applied = next(event for event in events if event.type == "repair.patch_applied")
    assert patch_applied.payload is not None
    assert patch_applied.payload["patch_kind"] == "prompt_patch"
    assert patch_applied.payload["side_effects"] == ["pending_prompt_overlay_for_n_execute"]

    retried = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "fixed"})),
    )
    assert retried.next_node_ids == ["n_review"]
    retry_attempt = _read_jsonl(run_root / "attempts.jsonl")[-1]
    assert retry_attempt["attempt_index"] == 1
    assert retry_attempt["node_id"] == "n_execute"
    assert retry_attempt["effective_prompt_overlay_ref"] == f"overlays/{retry_attempt['attempt_id']}.json"
    overlay_path = run_root / retry_attempt["effective_prompt_overlay_ref"]
    assert overlay_path.exists()
    overlay = json.loads(overlay_path.read_text(encoding="utf-8"))
    assert overlay["patch_id"] == repairs[0]["patch_id"]
    execution_pack = json.loads(
        (run_root / "execution_packs" / f"{retry_attempt['execution_pack_id']}.json").read_text(encoding="utf-8")
    )
    assert execution_pack["effective_prompt_overlay"]["source_patch_id"] == repairs[0]["patch_id"]
    run_json_after_retry = _read_run_json(project_root, run_id)
    assert "n_execute" not in run_json_after_retry["metadata"]["cw"]["pending_prompt_overlays"]


def test_runner_human_checkpoint_sets_waiting_user_and_emits_gate(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _human_graph_payload())
    run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, run_id)
    waiting = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(human_gate=HumanGateAdvanceInput(prompt_to_user="Please approve.")),
    )

    assert waiting.run.state == RunState.WAITING_USER
    assert waiting.next_node_ids == ["n_human"]
    events = list_stream_events(project_root, run_id)
    assert [event.type for event in events][-2:] == ["human.gate_required", "run.paused"]
    assert events[-2].payload is not None
    assert events[-2].payload["decisions"] == [{"key": "continue", "label": None}, {"key": "reject", "label": None}]
    decisions = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "decisions.jsonl")
    assert decisions == [
        {
            "human_node_id": "n_human",
            "status": "pending",
            "decision": None,
            "by": None,
            "decided_at": None,
            "requested_at": decisions[0]["requested_at"],
            "custom_value": None,
        }
    ]

    with pytest.raises(RunError) as exc_info:
        advance_workflow_run(project_root, run_id)
    assert exc_info.value.error_code == "WR_STATE_FORBIDDEN_TRANSITION"


def test_runner_default_failure_routing_uses_failure_taxonomy(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(
        tmp_path,
        _runner_graph_payload(include_human_on_fail=True),
    )
    run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root, run_id, NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "unclear"}))
    )
    failed = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(
            evaluation=EvaluationAdvanceInput(
                passed=False,
                score=0.0,
                failure_type=FailureType.AMBIGUOUS_REQUIREMENT,
                finding_message="User intent is ambiguous.",
            )
        ),
    )

    assert failed.next_node_ids == ["n_human"]
    evaluation = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "evaluations.jsonl")[0]
    assert evaluation["recommended_action"]["action"] == "human_checkpoint"
    assert evaluation["recommended_action"]["target_human_node_id"] == "n_human"
    assert evaluation["recommended_action"]["target_repair_node_id"] is None


def test_runner_degrades_model_capability_limit_to_human_until_escalation_exists(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(
        tmp_path,
        _runner_graph_payload(include_human_on_fail=True),
    )
    run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root, run_id, NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "weak"}))
    )
    failed = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(
            evaluation=EvaluationAdvanceInput(
                passed=False,
                score=0.0,
                failure_type=FailureType.MODEL_CAPABILITY_LIMIT,
                finding_message="Current model cannot solve this node.",
            )
        ),
    )

    assert failed.next_node_ids == ["n_human"]
    evaluation = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "evaluations.jsonl")[0]
    assert evaluation["failure_diagnosis"]["failure_type"] == "model_capability_limit"
    assert evaluation["recommended_action"]["action"] == "human_checkpoint"
    assert evaluation["recommended_strategy"] is None


def test_runner_does_not_treat_terminal_fail_route_as_repair_target(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _runner_graph_payload())
    run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root, run_id, NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "bad"}))
    )
    failed = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(
            evaluation=EvaluationAdvanceInput(
                passed=False,
                score=0.1,
                failure_type=FailureType.FORMAT_ERROR,
                finding_message="Format is invalid.",
            )
        ),
    )

    assert failed.next_node_ids == ["n_end"]
    evaluation = _read_jsonl(project_root / ".agent-workflow" / "runs" / run_id / "evaluations.jsonl")[0]
    assert evaluation["recommended_action"]["action"] == "abort"
    assert evaluation["recommended_action"]["target_repair_node_id"] is None


def test_runner_enforces_node_attempt_limit(tmp_path: Path) -> None:
    payload = _runner_graph_payload(execution_max_attempts=1)
    project_root, workflow_id = _create_project_with_graph(tmp_path, payload)
    run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root, run_id, NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"}))
    )

    run_json = _read_run_json(project_root, run_id)
    edited = copy.deepcopy(run_json)
    edited["state"] = "running"
    edited["current_node_ids"] = ["n_execute"]
    _write_run_json(project_root, run_id, edited)

    with pytest.raises(RunError) as exc_info:
        advance_workflow_run(
            project_root, run_id, NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "again"}))
        )
    assert exc_info.value.error_code == "NL_ATTEMPT_LIMIT_EXCEEDED"
    assert read_workflow_run(project_root, run_id).current_node_ids == ["n_execute"]
