"""M1.3.11 ReflectionMemory v0 tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest

from cw_runtime.harness import ProjectCreateRequest, initialize_project
from cw_runtime.reflection_memory import (
    PatchPatternContent,
    ReflectionLookupRequest,
    ReflectionMemoryEntry,
    ReflectionMemoryError,
    RepairOrigin,
    append_or_update_reflection_entry,
    load_reflection_memory_entries,
    lookup_reflection_memory,
)
from cw_runtime.runner import (
    EvaluationAdvanceInput,
    ExecutionAdvanceInput,
    NodeAdvanceRequest,
    RepairAdvanceInput,
    advance_workflow_run,
)
from cw_runtime.runs import WorkflowRunStartRequest, create_workflow_run
from cw_schemas.types import ExecutionMode, FailureType

_MODEL_POLICY: dict[str, Any] = {"primary_model_profile_id": "deterministic-foundation"}
_PROMPT: dict[str, Any] = {
    "user_prompt_template": "Process {{ node_goal }}",
    "template_engine": "handlebars",
}


def _execution_contract(max_attempts: int = 4) -> dict[str, Any]:
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


def _repair_graph_payload() -> dict[str, Any]:
    return {
        "workflow_id": "wf_reflection",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "Reflection Workflow",
        "nodes": [
            {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
            {
                "node_id": "n_execute",
                "type": "execution_task",
                "title": "Execute",
                "contract": _execution_contract(),
            },
            {
                "node_id": "n_review",
                "type": "evaluation_task",
                "title": "Review",
                "target_node_id": "n_execute",
                "on_pass_next_node_id": "n_end",
                "on_fail_next_node_id": "n_repair",
                "max_retry": 2,
                "contract": _evaluation_contract(),
            },
            {
                "node_id": "n_repair",
                "type": "repair_task",
                "title": "Repair",
                "repair_target_node_id": "n_execute",
                "failure_input_ref": "$last_evaluation",
                "on_repair_next_node_id": "n_execute",
                "contract": _repair_contract(),
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


def _create_project(tmp_path: Path, payload: dict[str, Any] | None = None) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="Reflection Project",
            host_path=str(tmp_path / "reflection_project"),
        )
    )
    project_root = Path(response.host_path)
    settings_path = project_root / ".agent-workflow" / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    settings["models"]["escalation_chain"] = []
    settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    workflow = _repair_graph_payload() if payload is None else payload
    workflow_path = project_root / ".agent-workflow" / "workflow.flow.json"
    workflow_path.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return project_root, str(workflow["workflow_id"])


def _start_run(project_root: Path, workflow_id: str, *, domain: str = "coding") -> str:
    response = create_workflow_run(
        project_root,
        workflow_id,
        WorkflowRunStartRequest(
            schema_version="0.1.0",
            mode=ExecutionMode.SEMI_AUTO,
            initial_input={"domain_signals": [domain]},
            metadata={},
        ),
    )
    return response.run_id


def _memory_entry(summary: str = "Reuse strict format repair") -> ReflectionMemoryEntry:
    return ReflectionMemoryEntry(
        memory_id="rm_test_patch",
        kind="patch_pattern",
        scope="project",
        topic_keys=["node_type:execution_task", "failure_type:format_error", "patch_kind:prompt_patch"],
        summary=summary,
        content=PatchPatternContent(
            addresses_failure_type="format_error",
            node_type="execution_task",
            patch_kind="prompt_patch",
            operations_signature="ops_test",
            operations_summary="append_to_instructions: require the exact output schema",
            before_after_metrics=None,
            recommended_scope="until_pass",
        ),
        origin_refs=RepairOrigin(
            patch_id="rp_test",
            evaluation_id="ev_test",
            retried_attempt_id="att_retry",
            run_id="run_test",
            node_id="n_execute",
        ),
        sample_count=1,
        success_count=1,
        failure_count=0,
        first_seen_at="2026-06-17T00:00:00Z",
        last_seen_at="2026-06-17T00:00:00Z",
        confidence=0.5,
        sensitive=False,
    )


def _jsonl_records(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _attempt_context_pack(project_root: Path, run_id: str, attempt_id: str) -> dict[str, Any]:
    attempts = _jsonl_records(project_root / ".agent-workflow" / "runs" / run_id / "attempts.jsonl")
    attempt = next(item for item in attempts if item["attempt_id"] == attempt_id)
    context_pack_id = str(attempt["context_pack_id"])
    return cast(
        dict[str, Any],
        json.loads(
            (
                project_root / ".agent-workflow" / "runs" / run_id / "context_packs" / f"{context_pack_id}.json"
            ).read_text(encoding="utf-8")
        ),
    )


def test_reflection_memory_dedups_redacts_and_looks_up_project_entries(tmp_path: Path) -> None:
    project_root, _ = _create_project(tmp_path)

    append_or_update_reflection_entry(
        project_root, _memory_entry("2026-06-17T00:00:00Z contact owner@example.com for the pattern")
    )
    append_or_update_reflection_entry(project_root, _memory_entry("Updated summary without PII"))

    entries = load_reflection_memory_entries(project_root)
    assert len(entries) == 1
    assert entries[0].sample_count == 2
    assert entries[0].success_count == 2
    assert "owner@example.com" not in entries[0].summary
    assert entries[0].last_seen_at == "2026-06-17T00:00:00Z"

    result = lookup_reflection_memory(
        project_root,
        ReflectionLookupRequest(
            node_id="n_execute",
            contract_kind="execution",
            node_type="execution_task",
            failure_type_hint="format_error",
            include_kinds={"patch_pattern"},
            sample_count_min=1,
        ),
    )

    assert result.total_count == 1
    assert result.entries_by_kind["patch_pattern"][0].memory_id == "rm_test_patch"


def test_reflection_memory_lookup_prefers_newer_equal_score_entries(tmp_path: Path) -> None:
    project_root, _ = _create_project(tmp_path)
    older = _memory_entry("Older pattern")
    newer = _memory_entry("Newer pattern").model_copy(
        update={
            "memory_id": "rm_test_patch_newer",
            "last_seen_at": "2026-06-18T00:00:00Z",
            "first_seen_at": "2026-06-18T00:00:00Z",
            "content": _memory_entry("Newer pattern").content.model_copy(
                update={"operations_signature": "ops_test_newer"}
            ),
        }
    )
    append_or_update_reflection_entry(project_root, older)
    append_or_update_reflection_entry(project_root, newer)

    result = lookup_reflection_memory(
        project_root,
        ReflectionLookupRequest(
            node_id="n_execute",
            contract_kind="execution",
            node_type="execution_task",
            include_kinds={"patch_pattern"},
            top_k_per_kind=1,
            sample_count_min=1,
        ),
    )

    assert result.entries_by_kind["patch_pattern"][0].memory_id == "rm_test_patch_newer"


def test_reflection_memory_blocks_global_scope_and_sensitive_plain_jsonl(tmp_path: Path) -> None:
    project_root, _ = _create_project(tmp_path)

    with pytest.raises(ReflectionMemoryError, match="global scope"):
        append_or_update_reflection_entry(project_root, _memory_entry().model_copy(update={"scope": "global"}))

    with pytest.raises(ReflectionMemoryError, match="Sensitive ReflectionMemory"):
        append_or_update_reflection_entry(project_root, _memory_entry().model_copy(update={"sensitive": True}))


def test_runner_records_reflection_memory_and_injects_instruction_addendum(tmp_path: Path) -> None:
    project_root, workflow_id = _create_project(tmp_path)
    first_run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, first_run_id)
    advance_workflow_run(
        project_root,
        first_run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "too loose"})),
    )
    advance_workflow_run(
        project_root,
        first_run_id,
        NodeAdvanceRequest(
            evaluation=EvaluationAdvanceInput(
                passed=False,
                failure_type=FailureType.FORMAT_ERROR,
                finding_message="The output is missing the required format.",
            )
        ),
    )
    advance_workflow_run(
        project_root,
        first_run_id,
        NodeAdvanceRequest(repair=RepairAdvanceInput(instruction_text="Return JSON with the required keys.")),
    )
    retry_execution = advance_workflow_run(
        project_root,
        first_run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "fixed"})),
    )
    advance_workflow_run(project_root, first_run_id, NodeAdvanceRequest(evaluation=EvaluationAdvanceInput(passed=True)))
    advance_workflow_run(project_root, first_run_id)

    retry_pack = _attempt_context_pack(project_root, first_run_id, str(retry_execution.attempt_id))
    assert all(fragment["kind"] != "instruction_addendum" for fragment in retry_pack["fragments"])

    entries = load_reflection_memory_entries(project_root)
    assert {entry.kind for entry in entries} >= {"failure_pattern", "model_performance_signal", "patch_pattern"}
    patch_entries = [entry for entry in entries if entry.kind == "patch_pattern"]
    assert patch_entries[0].success_count == 1
    assert patch_entries[0].origin_refs.origin_kind == "repair"

    second_run_id = _start_run(project_root, workflow_id)
    advance_workflow_run(project_root, second_run_id)
    second_execution = advance_workflow_run(
        project_root,
        second_run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "new"})),
    )

    context_pack = _attempt_context_pack(project_root, second_run_id, str(second_execution.attempt_id))
    reflection_fragments = [
        fragment
        for fragment in context_pack["fragments"]
        if fragment["kind"] == "instruction_addendum"
        and fragment["source"]["source_kind"] == "injected"
        and fragment["source"]["injected_by"] == "reflection_memory"
    ]
    assert len(reflection_fragments) == 1
    assert "Return JSON with the required keys" in reflection_fragments[0]["text"]

    advance_workflow_run(
        project_root,
        second_run_id,
        NodeAdvanceRequest(
            evaluation=EvaluationAdvanceInput(
                passed=False,
                failure_type=FailureType.FORMAT_ERROR,
                finding_message="The second output also needs a different format repair.",
            )
        ),
    )
    advance_workflow_run(
        project_root,
        second_run_id,
        NodeAdvanceRequest(repair=RepairAdvanceInput(instruction_text="Return YAML with a title field.")),
    )
    advance_workflow_run(
        project_root,
        second_run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "fixed again"})),
    )
    advance_workflow_run(
        project_root, second_run_id, NodeAdvanceRequest(evaluation=EvaluationAdvanceInput(passed=True))
    )

    patch_entries_after_second_repair = [
        entry for entry in load_reflection_memory_entries(project_root) if entry.kind == "patch_pattern"
    ]
    assert len(patch_entries_after_second_repair) == 2
