"""M1.3.15 LangGraph/HITL runtime bridge foundation tests."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("langgraph")

from cw_runtime.engine import compile_langgraph_state_graph, compile_workflow_graph, load_workflow_graph
from cw_runtime.engine.langgraph_runtime_bridge import LangGraphRuntimeNodeExecutor
from cw_runtime.harness import ProjectCreateRequest, initialize_project
from cw_runtime.runner import (
    ExecutionAdvanceInput,
    HumanDecisionRequest,
    HumanGateAdvanceInput,
    NodeAdvanceRequest,
    resolve_human_decision,
)
from cw_runtime.runs import (
    RunError,
    WorkflowRunStartRequest,
    create_workflow_run,
    list_stream_events,
    read_workflow_run,
)
from cw_schemas.types import ExecutionMode, RunState

_MODEL_POLICY: dict[str, Any] = {"primary_model_profile_id": "deterministic-foundation"}
_PROMPT: dict[str, Any] = {
    "user_prompt_template": "Process {{ node_goal }}",
    "template_engine": "handlebars",
}
_EXECUTION_CONTRACT: dict[str, Any] = {
    "contract_id": "ctr_execute",
    "contract_kind": "execution",
    "goal": "Execute task",
    "model_policy": _MODEL_POLICY,
    "prompt": _PROMPT,
}
_EVALUATION_CONTRACT: dict[str, Any] = {
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


def _human_contract() -> dict[str, Any]:
    return {
        "contract_id": "ctr_human",
        "contract_kind": "human_gate",
        "goal": "Ask for human approval",
        "model_policy": _MODEL_POLICY,
        "decisions": [{"key": "continue"}, {"key": "reject"}],
        "prompt_to_user": "Approve this workflow decision.",
    }


def _base_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_langgraph_bridge",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "LangGraph Bridge Workflow",
        "nodes": [],
        "edges": [],
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


def _linear_payload() -> dict[str, Any]:
    payload = _base_payload()
    payload["nodes"] = [
        {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
        {
            "node_id": "n_execute",
            "type": "execution_task",
            "title": "Execute",
            "contract": copy.deepcopy(_EXECUTION_CONTRACT),
        },
        {
            "node_id": "n_review",
            "type": "evaluation_task",
            "title": "Review",
            "target_node_id": "n_execute",
            "on_pass_next_node_id": "n_end",
            "on_fail_next_node_id": "n_end",
            "max_retry": 2,
            "contract": copy.deepcopy(_EVALUATION_CONTRACT),
        },
        {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
    ]
    payload["edges"] = [
        {"edge_id": "e_start_execute", "source_node_id": "n_start", "target_node_id": "n_execute", "type": "normal"},
        {"edge_id": "e_execute_review", "source_node_id": "n_execute", "target_node_id": "n_review", "type": "normal"},
    ]
    return payload


def _human_payload() -> dict[str, Any]:
    payload = _base_payload()
    payload["terminal_node_ids"] = ["n_continue", "n_reject"]
    payload["nodes"] = [
        {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
        {
            "node_id": "n_human",
            "type": "human_checkpoint",
            "title": "Human Review",
            "decisions": [{"key": "continue"}, {"key": "reject"}],
            "routing_map": {"continue": "n_continue", "reject": "n_reject"},
            "contract": _human_contract(),
        },
        {"node_id": "n_continue", "type": "end", "title": "Continue End", "archive_actions": []},
        {"node_id": "n_reject", "type": "end", "title": "Reject End", "archive_actions": []},
    ]
    payload["edges"] = [
        {"edge_id": "e_start_human", "source_node_id": "n_start", "target_node_id": "n_human", "type": "normal"}
    ]
    return payload


def _create_project_with_graph(tmp_path: Path, payload: dict[str, Any]) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="LangGraph Bridge Project",
            host_path=str(tmp_path / "langgraph_bridge_project"),
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


def _run_json_path(project_root: Path, run_id: str) -> Path:
    return project_root / ".agent-workflow" / "runs" / run_id / "run.json"


def _read_run_json(project_root: Path, run_id: str) -> dict[str, Any]:
    loaded = json.loads(_run_json_path(project_root, run_id).read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _write_run_json(project_root: Path, run_id: str, payload: dict[str, Any]) -> None:
    _run_json_path(project_root, run_id).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _compile_bridge(project_root: Path, bridge: LangGraphRuntimeNodeExecutor) -> Any:
    engine_ir = compile_workflow_graph(load_workflow_graph(project_root))
    return compile_langgraph_state_graph(
        engine_ir,
        node_executor=bridge,
        name="cw-test-runtime-bridge",
        resume_from_current_node=True,
    )


def test_langgraph_runtime_bridge_completes_linear_run(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _linear_payload())
    run_id = _start_run(project_root, workflow_id)
    bridge = LangGraphRuntimeNodeExecutor(
        project_root,
        run_id,
        node_requests={
            "n_execute": NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
        },
    )
    workflow = _compile_bridge(project_root, bridge)

    state = workflow.compiled.invoke(bridge.initial_state())

    assert state["visited_node_ids"] == ["n_start", "n_execute", "n_review", "n_end"]
    assert state["interrupt"] is None
    assert state["node_results"]["n_execute"]["node_state"] == "validating"
    assert state["node_results"]["n_review"]["eval_id"]
    run = read_workflow_run(project_root, run_id)
    assert run.state == RunState.COMPLETED
    assert run.current_node_ids == []


def test_langgraph_runtime_bridge_rejects_stale_schedule_before_mutation(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _linear_payload())
    run_id = _start_run(project_root, workflow_id)
    bridge = LangGraphRuntimeNodeExecutor(
        project_root,
        run_id,
        node_requests={
            "n_execute": NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "should-not-run"})),
        },
    )
    workflow = _compile_bridge(project_root, bridge)
    stale_state = bridge.initial_state()
    stale_state["current_node_id"] = "n_execute"
    before_run = _read_run_json(project_root, run_id)
    before_event_ids = [event.event_id for event in list_stream_events(project_root, run_id)]

    with pytest.raises(RunError) as exc_info:
        workflow.compiled.invoke(stale_state)

    assert exc_info.value.error_code == "NL_STATE_FORBIDDEN_TRANSITION"
    assert _read_run_json(project_root, run_id) == before_run
    assert [event.event_id for event in list_stream_events(project_root, run_id)] == before_event_ids


def test_langgraph_runtime_bridge_rejects_multiple_current_nodes_with_state_error(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _linear_payload())
    run_id = _start_run(project_root, workflow_id)
    run_json = _read_run_json(project_root, run_id)
    edited = copy.deepcopy(run_json)
    edited["current_node_ids"] = ["n_start", "n_execute"]
    _write_run_json(project_root, run_id, edited)
    bridge = LangGraphRuntimeNodeExecutor(project_root, run_id)

    with pytest.raises(RunError) as exc_info:
        bridge.initial_state()

    assert exc_info.value.error_code == "WR_STATE_FORBIDDEN_TRANSITION"


def test_langgraph_runtime_bridge_stops_on_human_gate_interrupt(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _human_payload())
    run_id = _start_run(project_root, workflow_id)
    bridge = LangGraphRuntimeNodeExecutor(
        project_root,
        run_id,
        node_requests={
            "n_human": NodeAdvanceRequest(human_gate=HumanGateAdvanceInput(prompt_to_user="Please approve.")),
        },
    )
    workflow = _compile_bridge(project_root, bridge)

    state = workflow.compiled.invoke(bridge.initial_state())

    assert state["visited_node_ids"] == ["n_start", "n_human"]
    interrupt = state["interrupt"]
    assert interrupt is not None
    assert interrupt["kind"] == "human_gate"
    assert interrupt["run_id"] == run_id
    assert interrupt["node_id"] == "n_human"
    assert interrupt["payload"]["prompt_to_user"] == "Please approve."
    assert interrupt["payload"]["decisions"] == [{"key": "continue", "label": None}, {"key": "reject", "label": None}]
    assert state["node_results"]["n_human"]["node_state"] == "waiting_user"

    run = read_workflow_run(project_root, run_id)
    assert run.state == RunState.WAITING_USER
    assert run.current_node_ids == ["n_human"]
    events = list_stream_events(project_root, run_id)
    assert [event.type for event in events][-2:] == ["human.gate_required", "run.paused"]


def test_langgraph_runtime_bridge_resumes_from_workflow_run_current_node(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project_with_graph(tmp_path, _human_payload())
    run_id = _start_run(project_root, workflow_id)
    bridge = LangGraphRuntimeNodeExecutor(
        project_root,
        run_id,
        node_requests={
            "n_human": NodeAdvanceRequest(human_gate=HumanGateAdvanceInput(prompt_to_user="Please approve.")),
        },
    )
    workflow = _compile_bridge(project_root, bridge)
    interrupted_state = workflow.compiled.invoke(bridge.initial_state())

    resolve_human_decision(
        project_root,
        run_id,
        HumanDecisionRequest(
            schema_version="0.1.0",
            human_node_id="n_human",
            decision="continue",
            by="tester",
        ),
    )

    resumed_state = workflow.compiled.invoke(
        bridge.initial_state(visited_node_ids=interrupted_state["visited_node_ids"])
    )

    assert resumed_state["visited_node_ids"] == ["n_start", "n_human", "n_continue"]
    assert resumed_state["interrupt"] is None
    assert resumed_state["node_results"]["n_continue"]["run_state"] == "completed"
    run = read_workflow_run(project_root, run_id)
    assert run.state == RunState.COMPLETED
    assert run.current_node_ids == []
    event_types = [event.type for event in list_stream_events(project_root, run_id)]
    assert event_types[-1] == "run.completed"
    assert (
        event_types.index("human.gate_resolved") < event_types.index("run.resumed") < event_types.index("run.completed")
    )
