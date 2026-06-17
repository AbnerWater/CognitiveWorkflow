"""M1.3.6 static ContextBuilder / EvidenceBuilder tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from cw_runtime.builders import (
    PackBuildError,
    StaticAttemptPackRequest,
    build_static_context_pack,
    build_static_evidence_pack,
    build_static_execution_pack,
)
from cw_runtime.harness import ProjectCreateRequest, initialize_project
from cw_runtime.runner import ExecutionAdvanceInput, NodeAdvanceRequest, advance_workflow_run
from cw_runtime.runs import WorkflowRunStartRequest, create_workflow_run, list_stream_events
from cw_schemas.contract import ExecutionContract
from cw_schemas.types import ExecutionMode

_MODEL_POLICY: dict[str, Any] = {"primary_model_profile_id": "deterministic-foundation"}
_PROMPT: dict[str, Any] = {
    "user_prompt_template": "Use {{ deps.project_goal }} and {{ deps.evidence }}",
    "template_engine": "handlebars",
}


def _execution_contract(
    *,
    context_requirements: list[dict[str, Any]] | None = None,
    evidence_requirements: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "contract_id": "ctr_execute",
        "contract_kind": "execution",
        "goal": "Execute with static builders",
        "model_policy": _MODEL_POLICY,
        "prompt": _PROMPT,
        "context_requirements": [] if context_requirements is None else context_requirements,
        "evidence_requirements": [] if evidence_requirements is None else evidence_requirements,
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


def _graph_payload(contract: dict[str, Any]) -> dict[str, Any]:
    return {
        "workflow_id": "wf_static_builders",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Static Builders Workflow",
        "nodes": [
            {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
            {"node_id": "n_execute", "type": "execution_task", "title": "Execute", "contract": contract},
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
                "edge_id": "e_execute_end",
                "source_node_id": "n_execute",
                "target_node_id": "n_end",
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


def _human_route_graph_payload(contract: dict[str, Any]) -> dict[str, Any]:
    payload = _graph_payload(contract)
    payload["nodes"].insert(
        2,
        {
            "node_id": "n_human",
            "type": "human_checkpoint",
            "title": "Human Review",
            "decisions": [{"key": "continue"}, {"key": "reject"}],
            "routing_map": {"continue": "n_end", "reject": "n_end"},
            "contract": _human_contract(),
        },
    )
    payload["edges"] = [
        {
            "edge_id": "e_start_execute",
            "source_node_id": "n_start",
            "target_node_id": "n_execute",
            "type": "normal",
        },
        {
            "edge_id": "e_execute_human",
            "source_node_id": "n_execute",
            "target_node_id": "n_human",
            "type": "normal",
        },
        {
            "edge_id": "e_human_end",
            "source_node_id": "n_human",
            "target_node_id": "n_end",
            "type": "human",
        },
    ]
    return payload


def _static_request(
    contract: ExecutionContract,
    *,
    built_at: str = "2026-06-17T00:00:00.000Z",
    initial_input: dict[str, Any] | None = None,
) -> StaticAttemptPackRequest:
    return StaticAttemptPackRequest(
        run_id="run_static",
        node_id="n_execute",
        attempt_id="att_static",
        context_pack_id="ctx_static",
        evidence_pack_id="evp_static",
        execution_pack_id="exp_static",
        contract=contract,
        model_profile_id="deterministic-foundation",
        built_at=built_at,
        initial_input={} if initial_input is None else initial_input,
    )


def _create_project_with_graph(tmp_path: Path, payload: dict[str, Any]) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Static Builders Project",
            host_path=str(tmp_path / "static_builders_project"),
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


def _start_run(project_root: Path, workflow_id: str, initial_input: dict[str, Any]) -> str:
    response = create_workflow_run(
        project_root,
        workflow_id,
        WorkflowRunStartRequest(
            schema_version="0.1.0",
            mode=ExecutionMode.SEMI_AUTO,
            initial_input=initial_input,
            metadata={},
        ),
    )
    return response.run_id


def _read_json(path: Path) -> dict[str, Any]:
    loaded = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line:
            continue
        loaded = json.loads(raw_line)
        assert isinstance(loaded, dict)
        rows.append(loaded)
    return rows


def test_static_context_builder_persists_user_input_and_static_text(tmp_path: Path) -> None:
    context_requirements = [
        {
            "key": "project_goal",
            "kind": "user_input",
            "selector": {"source_kind": "user_input", "input_field": "project_goal"},
            "required": True,
        },
        {
            "key": "style_note",
            "kind": "static_text",
            "selector": {"source_kind": "static_text", "text": "Return a concise JSON object."},
            "required": False,
        },
    ]
    project_root, workflow_id = _create_project_with_graph(
        tmp_path,
        _graph_payload(_execution_contract(context_requirements=context_requirements)),
    )
    run_id = _start_run(project_root, workflow_id, {"project_goal": "Restore W1.3.6 validation"})

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
    )

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    attempt = _read_jsonl(run_root / "attempts.jsonl")[0]
    context_pack = _read_json(run_root / "context_packs" / f"{attempt['context_pack_id']}.json")
    assert context_pack["provenance"]["builder_version"] == "static-phase1.0.0"
    assert context_pack["metadata"]["cw"]["builder"] == "static_phase1"
    assert "foundation_stub" not in context_pack["metadata"]["cw"]
    assert context_pack["template_inputs"]["deps"]["project_goal"] == "Restore W1.3.6 validation"
    assert {fragment["kind"] for fragment in context_pack["fragments"]} == {
        "node_goal",
        "static_text",
        "user_input",
    }

    event_types = [event.type for event in list_stream_events(project_root, run_id)]
    assert "context.build_started" in event_types
    assert "context.build_completed" in event_types
    assert event_types.index("context.build_completed") < event_types.index("attempt.started")


def test_static_execution_pack_falls_back_to_contract_model_settings() -> None:
    contract_payload = _execution_contract()
    contract_payload["model_policy"] = {
        **_MODEL_POLICY,
        "model_settings": {"temperature": 0.2, "top_p": 0.9, "max_tokens": 256},
    }
    contract = ExecutionContract.model_validate(contract_payload)
    request = _static_request(contract)
    context_pack = build_static_context_pack(request, None)
    execution_pack = build_static_execution_pack(request, context_pack, None)

    assert execution_pack.effective_model_settings == {"temperature": 0.2, "top_p": 0.9, "max_tokens": 256}


def test_static_evidence_builder_persists_user_assertions_and_context_projection(tmp_path: Path) -> None:
    evidence_requirements = [
        {
            "requirement_id": "req_source_ids",
            "required_for": "draft.source_evidence_ids",
            "min_coverage": 1.0,
            "min_evidences": 1,
        }
    ]
    context_requirements = [
        {
            "key": "style_note",
            "kind": "static_text",
            "selector": {"source_kind": "static_text", "text": "Keep the answer terse."},
            "required": False,
        }
    ]
    project_root, workflow_id = _create_project_with_graph(
        tmp_path,
        _graph_payload(
            _execution_contract(
                context_requirements=context_requirements,
                evidence_requirements=evidence_requirements,
            )
        ),
    )
    run_id = _start_run(
        project_root,
        workflow_id,
        {
            "user_assertions": [
                {
                    "claim": "The accepted ContextBuilder spec requires pre-attempt construction.",
                    "quote": "Builder must complete before the node starts executing.",
                    "required_for": "draft.source_evidence_ids",
                    "topics": ["draft.source_evidence_ids", "context_builder"],
                    "confidence": 0.8,
                }
            ]
        },
    )

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
    )

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    attempt = _read_jsonl(run_root / "attempts.jsonl")[0]
    assert attempt["evidence_pack_id"] is not None
    evidence_pack = _read_json(run_root / "evidence_packs" / f"{attempt['evidence_pack_id']}.json")
    assert evidence_pack["provenance"]["builder_version"] == "static-phase1.0.0"
    assert evidence_pack["evidences"][0]["source"]["source_kind"] == "user_input"
    assert evidence_pack["coverage"]["coverage_ratio"] == 1.0

    context_pack = _read_json(run_root / "context_packs" / f"{attempt['context_pack_id']}.json")
    evidence_fragments = [fragment for fragment in context_pack["fragments"] if fragment["kind"] == "evidence"]
    assert len(evidence_fragments) == 1
    assert evidence_fragments[0]["source"]["evidence_pack_id"] == attempt["evidence_pack_id"]
    assert "[ev_001]" in context_pack["template_inputs"]["deps"]["evidence"]
    assert [fragment["priority"] for fragment in context_pack["fragments"]] == ["critical", "high", "normal"]

    execution_pack = _read_json(run_root / "execution_packs" / f"{attempt['execution_pack_id']}.json")
    assert execution_pack["evidence_pack"]["pack_id"] == attempt["evidence_pack_id"]
    assert execution_pack["context_pack"]["pack_id"] == attempt["context_pack_id"]

    event_types = [event.type for event in list_stream_events(project_root, run_id)]
    assert "evidence.build_completed" in event_types
    assert "context.build_completed" in event_types
    assert event_types.index("evidence.build_completed") < event_types.index("context.build_started")


def test_static_evidence_builder_fails_required_requirement_without_assertions(tmp_path: Path) -> None:
    evidence_requirements = [
        {
            "requirement_id": "req_source_ids",
            "required_for": "draft.source_evidence_ids",
            "min_coverage": 1.0,
            "min_evidences": 1,
        }
    ]
    project_root, workflow_id = _create_project_with_graph(
        tmp_path,
        _graph_payload(_execution_contract(evidence_requirements=evidence_requirements)),
    )
    run_id = _start_run(project_root, workflow_id, {})

    advance_workflow_run(project_root, run_id)
    failed = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
    )

    assert failed.run.state == "failed"
    assert failed.node_state == "failed"
    assert failed.run.failure_summary is not None
    assert failed.run.failure_summary.error_code == "EP_BUILD_REQUIREMENT_UNRESOLVED"
    event_types = [event.type for event in list_stream_events(project_root, run_id)]
    assert "attempt.failed" in event_types
    assert "run.failed" in event_types
    assert "context.build_started" not in event_types


def test_pack_build_failure_routes_to_human_checkpoint_when_available(tmp_path: Path) -> None:
    evidence_requirements = [
        {
            "requirement_id": "req_source_ids",
            "required_for": "draft.source_evidence_ids",
            "min_coverage": 1.0,
            "min_evidences": 1,
        }
    ]
    project_root, workflow_id = _create_project_with_graph(
        tmp_path,
        _human_route_graph_payload(_execution_contract(evidence_requirements=evidence_requirements)),
    )
    run_id = _start_run(project_root, workflow_id, {})

    advance_workflow_run(project_root, run_id)
    routed = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
    )

    assert routed.run.state == "running"
    assert routed.node_state == "waiting_user"
    assert routed.next_node_ids == ["n_human"]
    assert routed.run.current_node_ids == ["n_human"]
    failure = routed.run.metadata["cw"]["pack_build_failures"]["n_execute"]
    assert failure["error_code"] == "EP_BUILD_REQUIREMENT_UNRESOLVED"
    event_types = [event.type for event in list_stream_events(project_root, run_id)]
    assert "attempt.failed" in event_types
    assert "run.failed" not in event_types


def test_context_pack_validation_error_routes_as_pack_build_failure(tmp_path: Path) -> None:
    context_requirements = [
        {
            "key": "oversized_input",
            "kind": "user_input",
            "selector": {"source_kind": "user_input", "input_field": "oversized_input"},
            "required": True,
        }
    ]
    project_root, workflow_id = _create_project_with_graph(
        tmp_path,
        _graph_payload(_execution_contract(context_requirements=context_requirements)),
    )
    run_id = _start_run(project_root, workflow_id, {"oversized_input": "x" * 30000})

    advance_workflow_run(project_root, run_id)
    failed = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
    )

    assert failed.run.state == "failed"
    assert failed.run.failure_summary is not None
    assert failed.run.failure_summary.error_code == "CP_BUILD_OVER_BUDGET"
    event_types = [event.type for event in list_stream_events(project_root, run_id)]
    assert "context.build_started" in event_types
    assert "context.build_completed" not in event_types
    assert "attempt.failed" in event_types


def test_evidence_pack_is_persisted_before_completed_event_when_context_later_fails(tmp_path: Path) -> None:
    context_requirements = [
        {
            "key": "oversized_input",
            "kind": "user_input",
            "selector": {"source_kind": "user_input", "input_field": "oversized_input"},
            "required": True,
        }
    ]
    evidence_requirements = [
        {
            "requirement_id": "req_source_ids",
            "required_for": "draft.source_evidence_ids",
            "min_coverage": 1.0,
            "min_evidences": 1,
        }
    ]
    project_root, workflow_id = _create_project_with_graph(
        tmp_path,
        _graph_payload(
            _execution_contract(
                context_requirements=context_requirements,
                evidence_requirements=evidence_requirements,
            )
        ),
    )
    run_id = _start_run(
        project_root,
        workflow_id,
        {
            "oversized_input": "x" * 30000,
            "user_assertions": [
                {
                    "claim": "The draft has source support.",
                    "quote": "This source supports the draft.",
                    "required_for": "draft.source_evidence_ids",
                }
            ],
        },
    )

    advance_workflow_run(project_root, run_id)
    failed = advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
    )

    assert failed.run.state == "failed"
    events = list_stream_events(project_root, run_id)
    evidence_event = next(event for event in events if event.type == "evidence.build_completed")
    assert evidence_event.payload is not None
    evidence_pack_path = (
        project_root
        / ".agent-workflow"
        / "runs"
        / run_id
        / "evidence_packs"
        / f"{evidence_event.payload['pack_id']}.json"
    )
    assert evidence_pack_path.exists()
    event_types = [event.type for event in events]
    assert event_types.index("evidence.build_completed") < event_types.index("context.build_started")
    assert "context.build_completed" not in event_types


def test_static_evidence_builder_requires_explicit_requirement_match_for_multiple_requirements() -> None:
    contract = ExecutionContract.model_validate(
        _execution_contract(
            evidence_requirements=[
                {
                    "requirement_id": "req_a",
                    "required_for": "draft.a_evidence_ids",
                    "min_coverage": 1.0,
                    "min_evidences": 1,
                },
                {
                    "requirement_id": "req_b",
                    "required_for": "draft.b_evidence_ids",
                    "min_coverage": 1.0,
                    "min_evidences": 1,
                },
            ]
        )
    )

    with pytest.raises(PackBuildError) as exc_info:
        build_static_evidence_pack(
            _static_request(
                contract,
                initial_input={
                    "user_assertions": [
                        {
                            "claim": "Only A is supported.",
                            "quote": "A has explicit support.",
                            "required_for": "draft.a_evidence_ids",
                        }
                    ]
                },
            )
        )

    assert exc_info.value.error_code == "EP_BUILD_REQUIREMENT_UNRESOLVED"
    assert exc_info.value.details["requirements"] == ["req_b"]


def test_static_evidence_builder_rejects_empty_assertion_text() -> None:
    contract = ExecutionContract.model_validate(
        _execution_contract(
            evidence_requirements=[
                {
                    "requirement_id": "req_source_ids",
                    "required_for": "draft.source_evidence_ids",
                    "min_coverage": 1.0,
                    "min_evidences": 1,
                }
            ]
        )
    )

    with pytest.raises(PackBuildError) as exc_info:
        build_static_evidence_pack(
            _static_request(
                contract,
                initial_input={
                    "user_assertions": [
                        {
                            "claim": " ",
                            "quote": "",
                            "required_for": "draft.source_evidence_ids",
                        }
                    ]
                },
            )
        )

    assert exc_info.value.error_code == "EP_BUILD_REQUIREMENT_UNRESOLVED"


def test_static_evidence_pack_hash_excludes_built_at() -> None:
    contract = ExecutionContract.model_validate(
        _execution_contract(
            evidence_requirements=[
                {
                    "requirement_id": "req_source_ids",
                    "required_for": "draft.source_evidence_ids",
                    "min_coverage": 1.0,
                    "min_evidences": 1,
                }
            ]
        )
    )
    initial_input = {
        "user_assertions": [
            {
                "claim": "The source supports the draft.",
                "quote": "The draft is supported by this quoted source.",
                "required_for": "draft.source_evidence_ids",
            }
        ]
    }

    first = build_static_evidence_pack(
        _static_request(contract, built_at="2026-06-17T00:00:00.000Z", initial_input=initial_input)
    )
    second = build_static_evidence_pack(
        _static_request(contract, built_at="2026-06-17T00:01:00.000Z", initial_input=initial_input)
    )

    assert first is not None
    assert second is not None
    assert first.provenance.pack_hash == second.provenance.pack_hash
