"""M1.3.9 static ModelRouter Phase 1 tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from cw_runtime.harness import ProjectCreateRequest, initialize_project
from cw_runtime.model_router import (
    ModelRouterError,
    ProjectModelSettings,
    RoutingEscalationTrigger,
    build_routing_request,
    resolve_model_profile_registry,
    route_model,
)
from cw_runtime.runner import ExecutionAdvanceInput, NodeAdvanceRequest, advance_workflow_run
from cw_runtime.runs import WorkflowRunStartRequest, create_workflow_run
from cw_schemas.contract import ExecutionContract
from cw_schemas.types import ExecutionMode, ProviderKind
from cw_schemas.workflow import WorkflowModelPolicy

_PROMPT: dict[str, Any] = {
    "user_prompt_template": "Process {{ node_goal }}",
    "template_engine": "handlebars",
}


def _execution_contract(
    *,
    primary_model_profile_id: str = "deterministic-foundation",
    escalation_chain: list[str] | None = None,
    model_settings: dict[str, Any] | None = None,
    forbid_remote_models: bool = False,
) -> ExecutionContract:
    return ExecutionContract.model_validate(
        {
            "contract_id": "ctr_execute",
            "contract_kind": "execution",
            "goal": "Execute through ModelRouter",
            "model_policy": {
                "primary_model_profile_id": primary_model_profile_id,
                "escalation_chain": [] if escalation_chain is None else escalation_chain,
                "model_settings": {} if model_settings is None else model_settings,
            },
            "prompt": _PROMPT,
            "forbid_remote_models": forbid_remote_models,
        }
    )


def _workflow_policy(
    *,
    default_model_profile_id: str = "deterministic-foundation",
    escalation_chain: list[str] | None = None,
) -> WorkflowModelPolicy:
    return WorkflowModelPolicy.model_validate(
        {
            "default_model_profile_id": default_model_profile_id,
            "escalation_chain": [] if escalation_chain is None else escalation_chain,
            "forbid_remote_for_sensitive": True,
        }
    )


def _routing_request(
    *,
    contract: ExecutionContract | None = None,
    project_settings: ProjectModelSettings | None = None,
    workflow_policy: WorkflowModelPolicy | None = None,
    context_required_tokens: int = 128,
    escalation_trigger: RoutingEscalationTrigger | None = None,
) -> Any:
    return build_routing_request(
        run_id="run_router",
        node_id="n_execute",
        attempt_index=0,
        node_contract=_execution_contract() if contract is None else contract,
        workflow_model_policy=_workflow_policy() if workflow_policy is None else workflow_policy,
        project_settings_models=ProjectModelSettings() if project_settings is None else project_settings,
        context_required_tokens=context_required_tokens,
        request_id="route_request",
        correlation_id="trace_router",
        escalation_trigger=escalation_trigger,
    )


def _graph_payload(contract: dict[str, Any]) -> dict[str, Any]:
    return {
        "workflow_id": "wf_model_router",
        "version": "0.1.0",
        "schema_version": "0.1.0",
        "title": "ModelRouter Workflow",
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


def _create_project_with_graph(tmp_path: Path, payload: dict[str, Any]) -> tuple[Path, str]:
    response = initialize_project(
        ProjectCreateRequest(
            schema_version="0.1.0",
            display_name="ModelRouter Project",
            host_path=str(tmp_path / "model_router_project"),
        )
    )
    project_root = Path(response.host_path)
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


def test_model_router_selects_explicit_primary_without_forcing_escalation() -> None:
    project_settings = ProjectModelSettings()
    decision = route_model(
        _routing_request(project_settings=project_settings), resolve_model_profile_registry(project_settings)
    )

    assert decision.model_profile_id == "deterministic-foundation"
    assert decision.adapter_id == "cw_runtime.deterministic_node_runner"
    assert decision.escalation_position == 0
    assert decision.escalation_chain == ["deterministic-foundation"]
    assert decision.effective_model_settings == {"temperature": 0.0, "top_p": 1.0, "max_tokens": 4096}


def test_model_router_prefers_workflow_default_for_auto_primary() -> None:
    project_settings = ProjectModelSettings(default_model_profile_id="deterministic-foundation")
    request = _routing_request(
        contract=_execution_contract(primary_model_profile_id="auto"),
        project_settings=project_settings,
        workflow_policy=_workflow_policy(default_model_profile_id="claude-sonnet-default"),
    )
    decision = route_model(request, resolve_model_profile_registry(project_settings))

    assert decision.model_profile_id == "claude-sonnet-default"
    assert decision.adapter_id == "pydantic_ai"


def test_model_router_reports_provider_kind_filter_exhaustion() -> None:
    project_settings = ProjectModelSettings(forbid_provider_kinds={ProviderKind.LOCAL, ProviderKind.CLOUD})

    with pytest.raises(ModelRouterError) as exc_info:
        route_model(
            _routing_request(project_settings=project_settings), resolve_model_profile_registry(project_settings)
        )

    assert exc_info.value.error_code == "MR_PROVIDER_KIND_FORBIDDEN_ALL"


def test_model_router_reports_context_capability_limit() -> None:
    project_settings = ProjectModelSettings()

    with pytest.raises(ModelRouterError) as exc_info:
        route_model(
            _routing_request(project_settings=project_settings, context_required_tokens=300_000),
            resolve_model_profile_registry(project_settings),
        )

    assert exc_info.value.error_code == "MR_CAPABILITY_NOT_MET"


def test_model_router_rejects_local_to_cloud_escalation_chain_before_persistence() -> None:
    project_settings = ProjectModelSettings(escalation_chain=["claude-opus-strong"])

    with pytest.raises(ModelRouterError) as exc_info:
        route_model(
            _routing_request(project_settings=project_settings), resolve_model_profile_registry(project_settings)
        )

    assert exc_info.value.error_code == "MR_ESCALATION_CROSS_PROVIDER_KIND_FORBIDDEN"


def test_model_router_rejects_sensitive_cloud_primary() -> None:
    project_settings = ProjectModelSettings()
    request = _routing_request(
        contract=_execution_contract(
            primary_model_profile_id="claude-sonnet-default",
            forbid_remote_models=True,
        ),
        project_settings=project_settings,
        workflow_policy=_workflow_policy(default_model_profile_id="claude-sonnet-default"),
    )

    with pytest.raises(ModelRouterError) as exc_info:
        route_model(request, resolve_model_profile_registry(project_settings))

    assert exc_info.value.error_code == "MR_SENSITIVE_DATA_REMOTE_FORBIDDEN"


def test_model_router_blocks_local_to_cloud_on_actual_escalation() -> None:
    project_settings = ProjectModelSettings(escalation_chain=["deterministic-foundation", "claude-opus-strong"])
    request = _routing_request(
        contract=_execution_contract(primary_model_profile_id="auto"),
        project_settings=project_settings,
        escalation_trigger=RoutingEscalationTrigger(
            kind="model_capability_limit",
            from_model_profile_id="deterministic-foundation",
        ),
    )

    with pytest.raises(ModelRouterError) as exc_info:
        route_model(request, resolve_model_profile_registry(project_settings))

    assert exc_info.value.error_code == "MR_ESCALATION_CROSS_PROVIDER_KIND_FORBIDDEN"


def test_runner_persists_routing_trace_and_effective_model_settings(tmp_path: Path) -> None:
    contract = _execution_contract(model_settings={"top_p": 0.8, "max_tokens": 512})
    project_root, workflow_id = _create_project_with_graph(tmp_path, _graph_payload(contract.model_dump(mode="json")))
    settings_path = project_root / ".agent-workflow" / "settings.json"
    settings = _read_json(settings_path)
    settings["models"]["escalation_chain"] = []
    settings["models"]["profile_overrides"] = {
        "deterministic-foundation": {"default_model_settings": {"temperature": 0.17}}
    }
    settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    run_id = _start_run(project_root, workflow_id)

    advance_workflow_run(project_root, run_id)
    advance_workflow_run(
        project_root,
        run_id,
        NodeAdvanceRequest(execution=ExecutionAdvanceInput(output={"draft": "ok"})),
    )

    run_root = project_root / ".agent-workflow" / "runs" / run_id
    routing_traces = _read_jsonl(run_root / "routing.jsonl")
    attempts = _read_jsonl(run_root / "attempts.jsonl")
    execution_pack = _read_json(run_root / "execution_packs" / f"{attempts[0]['execution_pack_id']}.json")

    assert len(routing_traces) == 1
    assert routing_traces[0]["request"]["node_id"] == "n_execute"
    assert routing_traces[0]["decision"]["model_profile_id"] == "deterministic-foundation"
    assert routing_traces[0]["decision"]["effective_model_settings"] == {
        "temperature": 0.17,
        "top_p": 0.8,
        "max_tokens": 512,
    }
    assert execution_pack["effective_model_profile_id"] == "deterministic-foundation"
    assert execution_pack["effective_model_settings"] == {
        "temperature": 0.17,
        "top_p": 0.8,
        "max_tokens": 512,
    }
