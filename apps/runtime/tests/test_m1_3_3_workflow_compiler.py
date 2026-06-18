"""M1.3.3 WorkflowGraph compile boundary tests."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from cw_runtime.engine import (
    WorkflowValidationContext,
    WorkflowValidationError,
    compile_workflow_graph,
    load_and_compile_workflow,
    load_workflow_graph,
    validate_workflow_graph_payload,
)
from cw_runtime.harness import ProjectCreateRequest, initialize_project, update_manifest_json
from cw_schemas import WorkflowGraph
from cw_schemas.types import EdgeType

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
_REPAIR_CONTRACT: dict[str, Any] = {
    "contract_id": "ctr_repair",
    "contract_kind": "repair",
    "goal": "Repair task",
    "model_policy": _MODEL_POLICY,
    "prompt": _PROMPT,
    "repair_strategies": [{"kind": "prompt_patch", "applies_to_failure_types": ["format_error"], "max_uses": 2}],
}
_HUMAN_GATE_CONTRACT: dict[str, Any] = {
    "contract_id": "ctr_human",
    "contract_kind": "human_gate",
    "goal": "Ask for human approval",
    "model_policy": {"primary_model_profile_id": "human-contract-model"},
    "decisions": [{"key": "continue"}, {"key": "reject"}],
    "prompt_to_user": "Approve this workflow decision.",
}


def _graph_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_compiler",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Compiler Workflow",
        "nodes": [
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
                "on_pass_next_node_id": "n_report",
                "on_fail_next_node_id": "n_repair",
                "max_retry": 2,
                "contract": copy.deepcopy(_EVALUATION_CONTRACT),
            },
            {
                "node_id": "n_repair",
                "type": "repair_task",
                "title": "Repair",
                "repair_target_node_id": "n_execute",
                "failure_input_ref": "$last_evaluation",
                "on_repair_next_node_id": "n_execute",
                "contract": copy.deepcopy(_REPAIR_CONTRACT),
            },
            {
                "node_id": "n_report",
                "type": "execution_task",
                "title": "Report",
                "contract": copy.deepcopy(_EXECUTION_CONTRACT),
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
            {
                "edge_id": "e_execute_review",
                "source_node_id": "n_execute",
                "target_node_id": "n_review",
                "type": "normal",
            },
            {"edge_id": "e_report_end", "source_node_id": "n_report", "target_node_id": "n_end", "type": "normal"},
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
            "default_model_profile_id": "claude-sonnet-default",
            "escalation_chain": ["claude-opus-strong"],
            "forbid_remote_for_sensitive": True,
        },
        "created_by": "ai_planning",
        "created_at": "2026-06-17T00:00:00Z",
        "last_modified_at": "2026-06-17T00:00:00Z",
        "metadata": {},
    }


def _validated_graph(payload: dict[str, Any] | None = None) -> WorkflowGraph:
    return WorkflowGraph.model_validate(_graph_payload() if payload is None else payload)


def _write_json_value(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def _human_gate_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_human",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Human Workflow",
        "nodes": [
            {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
            {
                "node_id": "n_human",
                "type": "human_checkpoint",
                "title": "Review",
                "decisions": [{"key": "continue"}, {"key": "reject"}],
                "routing_map": {"continue": "n_end", "reject": "n_end"},
                "contract": copy.deepcopy(_HUMAN_GATE_CONTRACT),
            },
            {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
        ],
        "edges": [
            {
                "edge_id": "e_start_human",
                "source_node_id": "n_start",
                "target_node_id": "n_human",
                "type": "normal",
            },
            {"edge_id": "e_human_end", "source_node_id": "n_human", "target_node_id": "n_end", "type": "human"},
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
            "default_model_profile_id": "claude-sonnet-default",
            "escalation_chain": [],
            "forbid_remote_for_sensitive": True,
        },
        "created_by": "ai_planning",
        "created_at": "2026-06-17T00:00:00Z",
        "last_modified_at": "2026-06-17T00:00:00Z",
        "metadata": {},
    }


def test_load_and_compile_project_default_workflow(tmp_path: Path) -> None:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Compiler Project",
            host_path=str(tmp_path / "compiler_project"),
        )
    )

    graph = load_workflow_graph(Path(response.host_path))
    compiled = load_and_compile_workflow(Path(response.host_path))

    assert compiled.workflow_id == graph.workflow_id
    assert compiled.entry_node_id == "n_start"
    assert compiled.terminal_node_ids == ["n_end"]
    assert compiled.node_type_counts == {"start": 1, "end": 1}


def test_load_workflow_graph_maps_invalid_json_to_l1(tmp_path: Path) -> None:
    project_root = tmp_path / "bad_json"
    workflow_path = project_root / ".agent-workflow" / "workflow.flow.json"
    workflow_path.parent.mkdir(parents=True)
    workflow_path.write_text("{", encoding="utf-8")

    with pytest.raises(WorkflowValidationError) as exc_info:
        load_workflow_graph(project_root)

    assert exc_info.value.error_code == "WG_L1_INVALID_JSON"
    assert exc_info.value.level == "L1"


def test_validate_payload_maps_nodes_and_edges_shape_to_l1() -> None:
    payload = _graph_payload()
    payload["nodes"] = {}

    with pytest.raises(WorkflowValidationError) as exc_info:
        validate_workflow_graph_payload(payload)

    assert exc_info.value.error_code == "WG_L1_NODES_NOT_ARRAY"

    payload = _graph_payload()
    payload["edges"] = {}

    with pytest.raises(WorkflowValidationError) as edge_exc_info:
        validate_workflow_graph_payload(payload)

    assert edge_exc_info.value.error_code == "WG_L1_EDGES_NOT_ARRAY"


def test_validate_payload_maps_unknown_node_and_edge_types_to_l2() -> None:
    payload = _graph_payload()
    payload["nodes"][0]["type"] = "unknown"

    with pytest.raises(WorkflowValidationError) as node_exc_info:
        validate_workflow_graph_payload(payload)

    assert node_exc_info.value.error_code == "WG_L2_UNKNOWN_NODE_TYPE"

    payload = _graph_payload()
    payload["edges"][0]["type"] = "unknown"

    with pytest.raises(WorkflowValidationError) as edge_exc_info:
        validate_workflow_graph_payload(payload)

    assert edge_exc_info.value.error_code == "WG_L2_UNKNOWN_EDGE_TYPE"


def test_validate_payload_preserves_schema_custom_error_codes() -> None:
    payload = _graph_payload()
    payload["nodes"][1].pop("contract")

    with pytest.raises(WorkflowValidationError) as contract_exc_info:
        validate_workflow_graph_payload(payload)

    assert contract_exc_info.value.error_code == "NC_L2_KIND_MISMATCH"
    assert contract_exc_info.value.level == "L2"

    payload = _graph_payload()
    payload["metadata"] = {"bad": "value"}

    with pytest.raises(WorkflowValidationError) as metadata_exc_info:
        validate_workflow_graph_payload(payload)

    assert metadata_exc_info.value.error_code == "WG_L2_METADATA_NOT_NAMESPACED"
    assert metadata_exc_info.value.level == "L2"


def test_compile_merges_evaluation_and_repair_route_declarations() -> None:
    compiled = compile_workflow_graph(_validated_graph())

    synthetic_routes = {
        (edge.source_node_id, edge.target_node_id, edge.type, edge.route_key) for edge in compiled.edges
    }

    assert ("n_review", "n_report", EdgeType.PASS, "pass") in synthetic_routes
    assert ("n_review", "n_repair", EdgeType.FAIL, "fail") in synthetic_routes
    assert ("n_repair", "n_execute", EdgeType.RETRY, "repair") in synthetic_routes
    assert compiled.node_order == ["n_start", "n_execute", "n_review", "n_repair", "n_report", "n_end"]


def test_compile_preserves_human_decision_route_keys() -> None:
    compiled = compile_workflow_graph(_validated_graph(_human_gate_payload()))

    human_routes = [
        edge
        for edge in compiled.edges
        if edge.source_node_id == "n_human" and edge.target_node_id == "n_end" and edge.type == EdgeType.HUMAN
    ]

    assert {edge.route_key for edge in human_routes} == {"continue", "reject"}
    assert len(human_routes) == 2


def test_compile_does_not_treat_repair_edge_as_retry_route() -> None:
    payload = _graph_payload()
    payload["nodes"][3]["on_repair_next_node_id"] = "n_end"
    payload["edges"].append(
        {"edge_id": "e_repair_semantic", "source_node_id": "n_repair", "target_node_id": "n_end", "type": "repair"}
    )

    compiled = compile_workflow_graph(_validated_graph(payload))

    repair_route = [
        edge
        for edge in compiled.edges
        if edge.source_node_id == "n_repair" and edge.target_node_id == "n_end" and edge.route_key == "repair"
    ]
    assert [edge.type for edge in repair_route] == [EdgeType.RETRY]


def test_compile_rejects_unreachable_nodes_with_l3() -> None:
    payload = _graph_payload()
    payload["nodes"].append({"node_id": "n_lonely", "type": "end", "title": "Lonely", "archive_actions": []})
    payload["terminal_node_ids"].append("n_lonely")

    with pytest.raises(WorkflowValidationError) as exc_info:
        compile_workflow_graph(_validated_graph(payload))

    assert exc_info.value.error_code == "WG_L3_UNREACHABLE_NODE"
    assert exc_info.value.level == "L3"


def test_compile_rejects_uncontrolled_cycles_with_l3() -> None:
    payload = _graph_payload()
    payload["edges"].append(
        {"edge_id": "e_report_execute", "source_node_id": "n_report", "target_node_id": "n_execute", "type": "normal"}
    )

    with pytest.raises(WorkflowValidationError) as exc_info:
        compile_workflow_graph(_validated_graph(payload))

    assert exc_info.value.error_code == "WG_L3_UNCONTROLLED_LOOP"


def test_compile_rejects_disabled_node_type_with_l4() -> None:
    payload = _graph_payload()
    payload["nodes"].insert(
        5,
        {
            "node_id": "n_memory",
            "type": "memory_task",
            "title": "Memory",
            "contract": {
                "contract_id": "ctr_memory",
                "contract_kind": "memory",
                "goal": "Read memory",
                "model_policy": _MODEL_POLICY,
                "operation": "read",
                "target": "project_memory",
            },
        },
    )
    payload["edges"].append(
        {"edge_id": "e_repair_memory", "source_node_id": "n_repair", "target_node_id": "n_memory", "type": "retry"}
    )
    payload["nodes"][3]["on_repair_next_node_id"] = "n_memory"

    with pytest.raises(WorkflowValidationError) as exc_info:
        compile_workflow_graph(_validated_graph(payload))

    assert exc_info.value.error_code == "WG_L4_NODE_TYPE_NOT_ENABLED"
    assert exc_info.value.level == "L4"


def test_compile_checks_l4_external_registries() -> None:
    graph = _validated_graph()

    with pytest.raises(WorkflowValidationError) as model_exc_info:
        compile_workflow_graph(graph, context=WorkflowValidationContext(available_model_profile_ids=set()))

    assert model_exc_info.value.error_code == "WG_L4_UNKNOWN_MODEL"

    payload = _graph_payload()
    payload["global_context_refs"] = ["ctx.missing"]
    graph = _validated_graph(payload)

    with pytest.raises(WorkflowValidationError) as ref_exc_info:
        compile_workflow_graph(graph, context=WorkflowValidationContext(available_context_refs=set()))

    assert ref_exc_info.value.error_code == "WG_L4_REFERENCE_UNRESOLVED"


def test_load_and_compile_uses_project_skill_and_mcp_manifests(tmp_path: Path) -> None:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Tool Context Project",
            host_path=str(tmp_path / "tool_context_project"),
        )
    )
    project_root = Path(response.host_path)
    payload = _graph_payload()
    execute_contract = payload["nodes"][1]["contract"]
    assert isinstance(execute_contract, dict)
    execute_contract["skills"] = [{"skill_id": "research_outline", "version": "1.2.0"}]
    execute_contract["mcp_tools"] = [{"server_id": "mcp_local_python", "tool_name": "run"}]
    update_manifest_json(project_root, "workflow.flow.json", payload)

    with pytest.raises(WorkflowValidationError) as skill_exc_info:
        load_and_compile_workflow(project_root)

    assert skill_exc_info.value.error_code == "WG_L4_UNKNOWN_SKILL"
    assert skill_exc_info.value.details["skill_id"] == "research_outline"

    _write_json_value(
        project_root / ".agent-workflow" / "skills.config.json",
        [{"skill_id": "research_outline", "version": "1.2.0"}],
    )
    with pytest.raises(WorkflowValidationError) as mcp_exc_info:
        load_and_compile_workflow(project_root)

    assert mcp_exc_info.value.error_code == "WG_L4_UNKNOWN_MCP"
    assert mcp_exc_info.value.details["server_id"] == "mcp_local_python"

    _write_json_value(
        project_root / ".agent-workflow" / "mcp.config.json",
        [{"server_id": "mcp_local_python", "version": "0.5.1"}],
    )
    compiled = load_and_compile_workflow(project_root)

    assert compiled.workflow_id == "wf_compiler"


def test_compile_model_registry_ignores_non_llm_node_contract_policy() -> None:
    graph = _validated_graph(_human_gate_payload())

    compiled = compile_workflow_graph(
        graph,
        context=WorkflowValidationContext(available_model_profile_ids={"claude-sonnet-default"}),
    )

    assert compiled.workflow_id == "wf_human"


def test_compiled_ir_round_trips_as_json() -> None:
    compiled = compile_workflow_graph(_validated_graph())

    restored = json.loads(compiled.model_dump_json())

    assert restored["engine_ir_version"] == "0.1.0"
    assert restored["workflow_id"] == "wf_compiler"
