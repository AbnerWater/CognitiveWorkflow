"""M1.3.10 LangGraph StateGraph executor foundation tests."""

from __future__ import annotations

import copy
from typing import Any

import pytest

pytest.importorskip("langgraph")

from cw_runtime.engine import (
    LangGraphNodeResult,
    LangGraphRunState,
    WorkflowValidationError,
    compile_langgraph_state_graph,
    compile_workflow_graph,
)
from cw_schemas import WorkflowGraph

_MODEL_POLICY: dict[str, Any] = {"primary_model_profile_id": "claude-sonnet-default"}
_PROMPT: dict[str, Any] = {
    "user_prompt_template": "Process {{ deps.input }}",
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


def _base_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_langgraph",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "LangGraph Workflow",
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
            "default_model_profile_id": "claude-sonnet-default",
            "escalation_chain": ["claude-opus-strong"],
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
        {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
    ]
    payload["edges"] = [
        {
            "edge_id": "e_start_execute",
            "source_node_id": "n_start",
            "target_node_id": "n_execute",
            "type": "normal",
        },
        {
            "edge_id": "e_execute_end",
            "source_node_id": "n_execute",
            "target_node_id": "n_end",
            "type": "normal",
        },
    ]
    return payload


def _branch_payload() -> dict[str, Any]:
    payload = _base_payload()
    payload["terminal_node_ids"] = ["n_pass", "n_fail"]
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
            "on_pass_next_node_id": "n_pass",
            "on_fail_next_node_id": "n_fail",
            "max_retry": 2,
            "contract": copy.deepcopy(_EVALUATION_CONTRACT),
        },
        {"node_id": "n_pass", "type": "end", "title": "Pass End", "archive_actions": []},
        {"node_id": "n_fail", "type": "end", "title": "Fail End", "archive_actions": []},
    ]
    payload["edges"] = [
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
    ]
    return payload


def _compile(payload: dict[str, Any]) -> Any:
    graph = WorkflowGraph.model_validate(payload)
    return compile_workflow_graph(graph)


def test_langgraph_state_graph_invokes_linear_workflow() -> None:
    engine_ir = _compile(_linear_payload())
    langgraph_workflow = compile_langgraph_state_graph(engine_ir, name="cw-test-linear")

    state = langgraph_workflow.compiled.invoke({"run_id": "run_linear", "visited_node_ids": []})

    assert state["visited_node_ids"] == ["n_start", "n_execute", "n_end"]
    assert state["current_node_id"] == "n_end"
    assert state["next_node_ids"] == []
    assert langgraph_workflow.node_ids == ("n_start", "n_execute", "n_end")
    assert langgraph_workflow.route_table["n_start"]["normal"] == ("n_execute",)
    assert langgraph_workflow.route_table["n_execute"]["normal"] == ("n_end",)


def test_langgraph_state_graph_routes_by_engine_ir_route_key() -> None:
    engine_ir = _compile(_branch_payload())

    def node_executor(state: LangGraphRunState, node: Any) -> LangGraphNodeResult:
        if node.node_id == "n_review":
            return LangGraphNodeResult(route_key="fail", metadata={"forced": True})
        return LangGraphNodeResult()

    langgraph_workflow = compile_langgraph_state_graph(
        engine_ir,
        node_executor=node_executor,
        name="cw-test-branch",
    )

    state = langgraph_workflow.compiled.invoke({"run_id": "run_branch", "visited_node_ids": []})

    assert state["visited_node_ids"] == ["n_start", "n_execute", "n_review", "n_fail"]
    assert state["current_node_id"] == "n_fail"
    assert state["node_results"]["n_review"]["route_key"] == "fail"
    assert state["node_results"]["n_review"]["forced"] is True
    assert langgraph_workflow.route_table["n_review"]["pass"] == ("n_pass",)
    assert langgraph_workflow.route_table["n_review"]["fail"] == ("n_fail",)


def test_langgraph_state_graph_rejects_targets_outside_engine_ir() -> None:
    engine_ir = _compile(_linear_payload())

    def node_executor(state: LangGraphRunState, node: Any) -> LangGraphNodeResult:
        if node.node_id == "n_execute":
            return LangGraphNodeResult(next_node_ids=["n_missing"])
        return LangGraphNodeResult()

    langgraph_workflow = compile_langgraph_state_graph(engine_ir, node_executor=node_executor)

    with pytest.raises(WorkflowValidationError) as exc_info:
        langgraph_workflow.compiled.invoke({"run_id": "run_bad_target", "visited_node_ids": []})

    assert exc_info.value.error_code == "WG_L3_DEAD_END_FAIL_PATH"


def test_langgraph_state_graph_rejects_targets_combining_distinct_routes() -> None:
    engine_ir = _compile(_branch_payload())

    def node_executor(state: LangGraphRunState, node: Any) -> LangGraphNodeResult:
        if node.node_id == "n_review":
            return LangGraphNodeResult(next_node_ids=["n_pass", "n_fail"])
        return LangGraphNodeResult()

    langgraph_workflow = compile_langgraph_state_graph(engine_ir, node_executor=node_executor)

    with pytest.raises(WorkflowValidationError) as exc_info:
        langgraph_workflow.compiled.invoke({"run_id": "run_mixed_routes", "visited_node_ids": []})

    assert exc_info.value.error_code == "WG_L3_DEAD_END_FAIL_PATH"
