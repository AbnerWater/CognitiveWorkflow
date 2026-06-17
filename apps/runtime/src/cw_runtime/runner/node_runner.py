"""Deterministic node runner foundation.

W1.3.5 deliberately stops at the Engine-owned runtime boundary. It advances
nodes from explicit deterministic inputs, persists the schema-owned records,
and emits StreamEvents. Real AgentAdapter calls, ContextBuilder,
EvidenceBuilder, LangGraph orchestration, and HITL resolution land in later
M1.3 slices.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from os import PathLike
from pathlib import Path
from typing import Any, Literal, TypeAlias, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from cw_runtime.builders import (
    AttemptPackBundle,
    PackBuildError,
    StaticAttemptPackRequest,
    build_static_context_pack,
    build_static_evidence_pack,
    build_static_execution_pack,
)
from cw_runtime.engine import EngineWorkflowIR, compile_workflow_graph, load_workflow_graph
from cw_runtime.harness.project import acquire_runtime_lock
from cw_runtime.model_router import (
    ModelRouterError,
    build_routing_request,
    build_routing_trace,
    load_project_model_settings,
    resolve_model_profile_registry,
    route_model,
)
from cw_runtime.reflection_memory import (
    ReflectionKind,
    ReflectionLookupRequest,
    lookup_reflection_memory,
    record_evaluation_reflections_locked,
)
from cw_runtime.runs.lifecycle import (
    RunError,
    RunFailureSummary,
    WorkflowRunDocument,
    append_run_event_locked,
    append_run_jsonl_locked,
    list_stream_events,
    new_runtime_id,
    next_event_seq,
    read_workflow_run,
    run_directory,
    utc_now_ms,
    write_run_json_locked,
    write_workflow_run_locked,
)
from cw_schemas import WorkflowGraph
from cw_schemas.contract import EvaluationContract, NodeContractBase
from cw_schemas.events import ContextEvent, EvaluationEvent, HumanEvent, LifecycleEvent, RepairEvent
from cw_schemas.packs import PromptOverlay
from cw_schemas.runtime import (
    AdapterError,
    ArtifactRef,
    CriterionResult,
    EvalProvenance,
    EvaluationResult,
    FailureDiagnosis,
    Finding,
    NodeAttempt,
    RecommendedAction,
    RecommendedActionKind,
    RepairPatch,
    RepairProvenance,
    RunUsage,
)
from cw_schemas.runtime.repair import AppendToInstructionsOp
from cw_schemas.types import (
    AttemptState,
    DisplayLevel,
    EdgeType,
    EventPhase,
    FailureType,
    NodeRuntimeState,
    RepairKind,
    RiskLevel,
    RunState,
    Sensitivity,
    Severity,
    StreamSeverity,
)
from cw_schemas.workflow import (
    EndNode,
    EvaluationTaskNode,
    ExecutionTaskNode,
    HumanCheckpointNode,
    RepairTaskNode,
    StartNode,
    WorkflowNodeBase,
)

AttemptNode: TypeAlias = ExecutionTaskNode | EvaluationTaskNode | RepairTaskNode
RouteKey: TypeAlias = Literal["normal", "pass", "fail", "repair"]

_RUNNER_ID = "cw_runtime.deterministic_node_runner"
_RUNNER_VERSION = "0.1.0"
_DEFAULT_MODEL_PROFILE_ID = "deterministic-foundation"

_ALLOWED_NODE_TRANSITIONS: Mapping[NodeRuntimeState, frozenset[NodeRuntimeState]] = {
    NodeRuntimeState.IDLE: frozenset({NodeRuntimeState.READY}),
    NodeRuntimeState.READY: frozenset({NodeRuntimeState.RUNNING, NodeRuntimeState.WAITING_USER}),
    NodeRuntimeState.RUNNING: frozenset(
        {
            NodeRuntimeState.VALIDATING,
            NodeRuntimeState.REVIEWING,
            NodeRuntimeState.REPAIRING,
            NodeRuntimeState.PASSED,
            NodeRuntimeState.FAILED,
            NodeRuntimeState.WAITING_USER,
        }
    ),
    NodeRuntimeState.VALIDATING: frozenset(
        {NodeRuntimeState.REVIEWING, NodeRuntimeState.PASSED, NodeRuntimeState.REVIEW_FAILED, NodeRuntimeState.FAILED}
    ),
    NodeRuntimeState.REVIEWING: frozenset(
        {NodeRuntimeState.PASSED, NodeRuntimeState.REVIEW_FAILED, NodeRuntimeState.WAITING_USER}
    ),
    NodeRuntimeState.REVIEW_FAILED: frozenset({NodeRuntimeState.READY, NodeRuntimeState.REPAIRING}),
    NodeRuntimeState.REPAIRING: frozenset({NodeRuntimeState.RETRYING, NodeRuntimeState.FAILED}),
    NodeRuntimeState.RETRYING: frozenset({NodeRuntimeState.RUNNING, NodeRuntimeState.PASSED, NodeRuntimeState.FAILED}),
    NodeRuntimeState.WAITING_USER: frozenset(
        {NodeRuntimeState.PASSED, NodeRuntimeState.FAILED, NodeRuntimeState.RETRYING}
    ),
    NodeRuntimeState.PASSED: frozenset(),
    NodeRuntimeState.SKIPPED: frozenset(),
    NodeRuntimeState.FAILED: frozenset(),
    NodeRuntimeState.CANCELLED: frozenset(),
}

_NODE_PHASES: Mapping[NodeRuntimeState, EventPhase] = {
    NodeRuntimeState.IDLE: EventPhase.NODE_IDLE,
    NodeRuntimeState.READY: EventPhase.NODE_READY,
    NodeRuntimeState.RUNNING: EventPhase.NODE_RUNNING,
    NodeRuntimeState.VALIDATING: EventPhase.NODE_VALIDATING,
    NodeRuntimeState.REVIEWING: EventPhase.NODE_REVIEWING,
    NodeRuntimeState.PASSED: EventPhase.NODE_PASSED,
    NodeRuntimeState.REVIEW_FAILED: EventPhase.NODE_REVIEW_FAILED,
    NodeRuntimeState.REPAIRING: EventPhase.NODE_REPAIRING,
    NodeRuntimeState.RETRYING: EventPhase.NODE_RETRYING,
    NodeRuntimeState.WAITING_USER: EventPhase.NODE_WAITING_USER,
    NodeRuntimeState.SKIPPED: EventPhase.NODE_SKIPPED,
    NodeRuntimeState.FAILED: EventPhase.NODE_FAILED,
}


class ExecutionAdvanceInput(BaseModel):
    """Deterministic output for an execution node."""

    model_config = ConfigDict(extra="forbid")

    output: dict[str, Any] = Field(default_factory=dict)
    output_artifact_refs: list[ArtifactRef] = Field(default_factory=list)
    error: AdapterError | None = None
    model_profile_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvaluationAdvanceInput(BaseModel):
    """Deterministic evaluation decision used to build an EvaluationResult."""

    model_config = ConfigDict(extra="forbid")

    passed: bool = True
    score: float = Field(default=1.0, ge=0.0, le=1.0)
    failure_type: FailureType = FailureType.FORMAT_ERROR
    finding_message: str = Field(default="Deterministic evaluation failed.", min_length=1)
    recommended_action: RecommendedActionKind = "pass_to_next"
    target_repair_node_id: str | None = None
    target_human_node_id: str | None = None
    note_to_user: str | None = None
    model_profile_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RepairAdvanceInput(BaseModel):
    """Deterministic prompt patch used to build a RepairPatch."""

    model_config = ConfigDict(extra="forbid")

    patch_kind: Literal[RepairKind.PROMPT_PATCH] = RepairKind.PROMPT_PATCH
    failure_type: FailureType = FailureType.FORMAT_ERROR
    instruction_text: str = Field(default="Tighten the output format before retry.", min_length=1)
    expected_effect: str = Field(default="The next attempt should satisfy the failed criterion.", min_length=1)
    rationale: str | None = None
    risk_level: RiskLevel = RiskLevel.LOW
    model_profile_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class HumanGateAdvanceInput(BaseModel):
    """Optional deterministic presentation data for a human checkpoint."""

    model_config = ConfigDict(extra="forbid")

    prompt_to_user: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class HumanDecisionRequest(BaseModel):
    """Submit a deterministic human checkpoint decision."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"]
    human_node_id: str = Field(min_length=1)
    decision: str = Field(min_length=1, max_length=64)
    custom_value: Any | None = None
    by: str = Field(min_length=1, max_length=200)


class HumanDecisionRecord(BaseModel):
    """Append-only ``decisions.jsonl`` record for a resolved human gate."""

    model_config = ConfigDict(extra="forbid")

    human_node_id: str
    status: Literal["resolved"]
    decision: str
    by: str
    decided_at: str
    requested_at: str
    custom_value: Any | None = None


class NodeAdvanceRequest(BaseModel):
    """Advance the current node by one deterministic runner step."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"] = "0.1.0"
    node_id: str | None = None
    execution: ExecutionAdvanceInput | None = None
    evaluation: EvaluationAdvanceInput | None = None
    repair: RepairAdvanceInput | None = None
    human_gate: HumanGateAdvanceInput | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class NodeAdvanceResult(BaseModel):
    """Result returned by ``advance_workflow_run``."""

    model_config = ConfigDict(extra="forbid")

    run: WorkflowRunDocument
    node_id: str
    node_state: NodeRuntimeState
    next_node_ids: list[str]
    attempt_id: str | None = None
    eval_id: str | None = None
    patch_id: str | None = None
    event_ids: list[str] = Field(default_factory=list)


class _AttemptArtifacts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attempt_id: str
    attempt_index: int
    adapter_id: str
    context_pack_id: str
    evidence_pack_id: str | None = None
    execution_pack_id: str
    started_at: str
    model_profile_id: str
    output_hash: str | None = None
    effective_prompt_overlay_ref: str | None = None
    source_patch_id: str | None = None


class _PendingPromptOverlay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patch_id: str
    patch_kind: str
    repair_node_id: str
    repair_attempt_id: str
    evaluation_id: str
    instruction_text: str


def advance_workflow_run(
    project_root: str | PathLike[str],
    run_id: str,
    request: NodeAdvanceRequest | None = None,
) -> NodeAdvanceResult:
    """Advance the current WorkflowRun node by one deterministic step."""

    advance_request = NodeAdvanceRequest() if request is None else request
    root = Path(project_root)

    with acquire_runtime_lock(root):
        graph = load_workflow_graph(root)
        compiled = compile_workflow_graph(graph)
        run = read_workflow_run(root, run_id)
        _ensure_run_can_advance(run)

        node_id = _resolve_current_node_id(run, advance_request.node_id)
        node = _node_by_id(graph)[node_id]
        before_event_count = len(list_stream_events(root, run_id))

        if isinstance(node, StartNode):
            result = _advance_start(root, compiled, run, node)
        elif isinstance(node, EndNode):
            result = _advance_end(root, run, node)
        elif isinstance(node, ExecutionTaskNode):
            result = _advance_execution(root, graph, compiled, run, node, advance_request.execution)
        elif isinstance(node, EvaluationTaskNode):
            result = _advance_evaluation(root, graph, compiled, run, node, advance_request.evaluation)
        elif isinstance(node, RepairTaskNode):
            result = _advance_repair(root, graph, compiled, run, node, advance_request.repair)
        elif isinstance(node, HumanCheckpointNode):
            result = _advance_human_gate(root, run, node, advance_request.human_gate)
        else:
            raise RunError(
                "WG_L4_NODE_TYPE_NOT_ENABLED",
                "Node type is not enabled for the deterministic runner foundation.",
                details={"run_id": run.run_id, "node_id": node_id, "node_type": node.type},
            )

        after_events = list_stream_events(root, run_id)
        new_event_ids = [event.event_id for event in after_events[before_event_count:]]
        return result.model_copy(update={"event_ids": new_event_ids})


def resolve_human_decision(
    project_root: str | PathLike[str],
    run_id: str,
    request: HumanDecisionRequest,
) -> HumanDecisionRecord:
    """Resolve the current human checkpoint and route the run forward."""

    root = Path(project_root)
    with acquire_runtime_lock(root):
        graph = load_workflow_graph(root)
        compiled = compile_workflow_graph(graph)
        run = read_workflow_run(root, run_id)
        if run.state != RunState.WAITING_USER:
            raise RunError(
                "WR_STATE_FORBIDDEN_TRANSITION",
                "Human decisions can only be resolved while the WorkflowRun is waiting_user.",
                details={"run_id": run.run_id, "state": run.state.value},
            )
        current_node_id = _resolve_current_node_id(run, request.human_node_id)
        node = _node_by_id(graph)[current_node_id]
        if not isinstance(node, HumanCheckpointNode):
            raise RunError(
                "NL_STATE_FORBIDDEN_TRANSITION",
                "Current WorkflowRun node is not a human_checkpoint.",
                details={"run_id": run.run_id, "node_id": current_node_id},
            )
        _ensure_human_decision_allowed(node, request.decision)
        next_node_ids = _human_route_targets(compiled, node.node_id, request.decision)
        requested_at = _pending_decision_requested_at(root, run.run_id, node.node_id)
        now = utc_now_ms()
        record = HumanDecisionRecord(
            human_node_id=node.node_id,
            status="resolved",
            decision=request.decision,
            by=request.by,
            decided_at=now,
            requested_at=requested_at,
            custom_value=request.custom_value,
        )
        append_run_jsonl_locked(root, run.run_id, "decisions.jsonl", record.model_dump(mode="json"))
        run = _emit_human_gate_resolved(root, run, node, request, now)
        run = _transition_node(root, run, node.node_id, NodeRuntimeState.PASSED)
        run = run.model_copy(
            update={
                "state": RunState.RUNNING,
                "previous_state": run.state,
                "resumed_at": now,
                "paused_at": None,
                "last_heartbeat_at": now,
                "current_node_ids": next_node_ids,
            }
        )
        run = write_workflow_run_locked(root, run)
        resumed_event = _lifecycle_event(
            root,
            run,
            event_type="run.resumed",
            phase=EventPhase.RUN_RESUMED,
            title="Run resumed by human decision",
            payload={
                "reason": "human_decision",
                "human_node_id": node.node_id,
                "decision": request.decision,
                "next_node_ids": next_node_ids,
            },
            expandable=False,
        )
        append_run_event_locked(root, run, resumed_event)
        return record


def _advance_start(
    project_root: Path,
    compiled: EngineWorkflowIR,
    run: WorkflowRunDocument,
    node: StartNode,
) -> NodeAdvanceResult:
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.READY)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.RUNNING)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.PASSED)
    next_node_ids = _route_targets(compiled, node.node_id, "normal")
    run = _update_run_current_nodes(project_root, run, next_node_ids, RunState.RUNNING)
    return NodeAdvanceResult(
        run=run, node_id=node.node_id, node_state=NodeRuntimeState.PASSED, next_node_ids=next_node_ids
    )


def _advance_end(project_root: Path, run: WorkflowRunDocument, node: EndNode) -> NodeAdvanceResult:
    now = utc_now_ms()
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.READY)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.RUNNING)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.PASSED)
    run = run.model_copy(
        update={
            "state": RunState.COMPLETED,
            "previous_state": run.state,
            "completed_at": now,
            "last_heartbeat_at": now,
            "current_node_ids": [],
        }
    )
    event = _lifecycle_event(
        project_root,
        run,
        event_type="run.completed",
        phase=EventPhase.RUN_COMPLETED,
        title="Run completed",
        payload={"artifact_summary": {"terminal_node_id": node.node_id, "artifact_count": 0}},
        expandable=False,
    )
    run = append_run_event_locked(project_root, run, event)
    return NodeAdvanceResult(run=run, node_id=node.node_id, node_state=NodeRuntimeState.PASSED, next_node_ids=[])


def _advance_execution(
    project_root: Path,
    graph: WorkflowGraph,
    compiled: EngineWorkflowIR,
    run: WorkflowRunDocument,
    node: ExecutionTaskNode,
    input_data: ExecutionAdvanceInput | None,
) -> NodeAdvanceResult:
    execution = ExecutionAdvanceInput() if input_data is None else input_data
    try:
        artifacts = _prepare_attempt(project_root, graph, run, node, execution.model_profile_id)
    except PackBuildError as exc:
        return _route_pack_build_failure(project_root, graph, compiled, run, node, exc)
    if _node_state(run, node.node_id) == NodeRuntimeState.RETRYING:
        pass
    else:
        run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.READY)
    run = _emit_attempt_started(project_root, run, node.node_id, artifacts)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.RUNNING)

    if execution.error is not None:
        return _fail_attempt_and_run(project_root, run, node, artifacts, [execution.error])

    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.VALIDATING)
    output_hash = _stable_hash(execution.output)
    artifacts = artifacts.model_copy(update={"output_hash": output_hash})
    attempt = _completed_attempt(
        run,
        node.node_id,
        artifacts,
        output=execution.output,
        output_artifact_refs=execution.output_artifact_refs,
        metadata=execution.metadata,
    )
    append_run_jsonl_locked(project_root, run.run_id, "attempts.jsonl", attempt.model_dump(mode="json"))
    _store_runtime_value(run, "last_attempt_ids", node.node_id, artifacts.attempt_id)
    _store_runtime_value(run, "last_output_hashes", node.node_id, output_hash)
    run = _persist_runtime_metadata(project_root, run)

    run = _emit_attempt_completed(project_root, run, node.node_id, artifacts)
    next_node_ids = _route_targets(compiled, node.node_id, "normal")
    if _routes_to_target_evaluation(graph, next_node_ids, node.node_id):
        final_state = NodeRuntimeState.VALIDATING
    else:
        run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.PASSED)
        final_state = NodeRuntimeState.PASSED
    run = _update_run_current_nodes(project_root, run, next_node_ids, RunState.RUNNING)
    return NodeAdvanceResult(
        run=run,
        node_id=node.node_id,
        node_state=final_state,
        next_node_ids=next_node_ids,
        attempt_id=artifacts.attempt_id,
    )


def _advance_evaluation(
    project_root: Path,
    graph: WorkflowGraph,
    compiled: EngineWorkflowIR,
    run: WorkflowRunDocument,
    node: EvaluationTaskNode,
    input_data: EvaluationAdvanceInput | None,
) -> NodeAdvanceResult:
    evaluation = _normalize_evaluation_input(graph, compiled, node, input_data)
    try:
        artifacts = _prepare_attempt(project_root, graph, run, node, evaluation.model_profile_id)
    except PackBuildError as exc:
        return _route_pack_build_failure(project_root, graph, compiled, run, node, exc)
    target_attempt_id = _runtime_string(run, "last_attempt_ids", node.target_node_id)
    target_hash = _runtime_string(run, "last_output_hashes", node.target_node_id)
    if target_attempt_id is None or target_hash is None:
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "Evaluation node cannot run before its target attempt has completed.",
            details={"run_id": run.run_id, "node_id": node.node_id, "target_node_id": node.target_node_id},
        )

    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.READY)
    run = _emit_attempt_started(project_root, run, node.node_id, artifacts)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.RUNNING)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.REVIEWING)
    run = _transition_node(project_root, run, node.target_node_id, NodeRuntimeState.REVIEWING)

    started_event = EvaluationEvent(
        event_id=new_runtime_id(),
        seq=next_event_seq(project_root, run.run_id),
        run_id=run.run_id,
        node_id=node.node_id,
        attempt_id=artifacts.attempt_id,
        type="evaluation.started",
        phase=EventPhase.NODE_REVIEWING,
        title="Evaluation started",
        summary=None,
        content=None,
        payload={
            "evaluator_node_id": node.node_id,
            "target_node_id": node.target_node_id,
            "target_attempt_id": target_attempt_id,
            "arbitration": _evaluation_contract(node).arbitration.value,
        },
        display_level=DisplayLevel.DEFAULT,
        expandable=False,
        created_at=utc_now_ms(),
        eval_id=None,
        target_node_id=node.target_node_id,
    )
    run = append_run_event_locked(project_root, run, started_event)

    eval_result = _build_evaluation_result(
        run=run,
        node=node,
        artifacts=artifacts,
        input_data=evaluation,
        target_attempt_id=target_attempt_id,
        target_hash=target_hash,
    )
    append_run_jsonl_locked(project_root, run.run_id, "evaluations.jsonl", eval_result.model_dump(mode="json"))
    _store_runtime_value(run, "last_evaluation_ids", node.node_id, eval_result.eval_id)
    _store_runtime_value(run, "last_evaluation_by_target", node.target_node_id, eval_result.eval_id)
    if eval_result.failure_diagnosis is None:
        _remove_runtime_value(run, "last_failure_types", node.target_node_id)
    else:
        _store_runtime_value(
            run,
            "last_failure_types",
            node.target_node_id,
            eval_result.failure_diagnosis.failure_type.value,
        )
    target_node = _node_by_id(graph)[node.target_node_id]
    record_evaluation_reflections_locked(
        project_root,
        eval_result,
        target_node_type=target_node.type,
        evaluator_node_type=node.type,
        domain_signals=_reflection_domain_signals(run),
    )

    output = {"eval_id": eval_result.eval_id, "passed": eval_result.passed, "score": eval_result.score}
    output_hash = _stable_hash(output)
    artifacts = artifacts.model_copy(update={"output_hash": output_hash})
    attempt = _completed_attempt(
        run, node.node_id, artifacts, output=output, output_artifact_refs=[], metadata=evaluation.metadata
    )
    append_run_jsonl_locked(project_root, run.run_id, "attempts.jsonl", attempt.model_dump(mode="json"))
    _store_runtime_value(run, "last_attempt_ids", node.node_id, artifacts.attempt_id)
    _store_runtime_value(run, "last_output_hashes", node.node_id, output_hash)
    run = _persist_runtime_metadata(project_root, run)

    completed_event = EvaluationEvent(
        event_id=new_runtime_id(),
        seq=next_event_seq(project_root, run.run_id),
        run_id=run.run_id,
        node_id=node.node_id,
        attempt_id=artifacts.attempt_id,
        type="evaluation.completed",
        phase=EventPhase.NODE_PASSED if eval_result.passed else EventPhase.NODE_REVIEW_FAILED,
        title="Evaluation completed",
        summary=None,
        content=None,
        payload={
            "eval_id": eval_result.eval_id,
            "passed": eval_result.passed,
            "score": eval_result.score,
            "failure_type": None
            if eval_result.failure_diagnosis is None
            else eval_result.failure_diagnosis.failure_type.value,
            "recommended_action": eval_result.recommended_action.action,
        },
        display_level=DisplayLevel.DEFAULT,
        expandable=True,
        created_at=utc_now_ms(),
        eval_id=eval_result.eval_id,
        target_node_id=node.target_node_id,
    )
    run = append_run_event_locked(project_root, run, completed_event)
    run = _emit_attempt_completed(project_root, run, node.node_id, artifacts)

    if eval_result.passed:
        run = _transition_node(project_root, run, node.target_node_id, NodeRuntimeState.PASSED)
        run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.PASSED)
        next_node_ids = _route_targets(compiled, node.node_id, "pass")
    else:
        run = _transition_node(project_root, run, node.target_node_id, NodeRuntimeState.REVIEW_FAILED)
        run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.REVIEW_FAILED)
        next_node_ids = _next_nodes_for_failed_evaluation(graph, compiled, node, eval_result)

    run = _update_run_current_nodes(project_root, run, next_node_ids, RunState.RUNNING)
    return NodeAdvanceResult(
        run=run,
        node_id=node.node_id,
        node_state=NodeRuntimeState.PASSED if eval_result.passed else NodeRuntimeState.REVIEW_FAILED,
        next_node_ids=next_node_ids,
        attempt_id=artifacts.attempt_id,
        eval_id=eval_result.eval_id,
    )


def _advance_repair(
    project_root: Path,
    graph: WorkflowGraph,
    compiled: EngineWorkflowIR,
    run: WorkflowRunDocument,
    node: RepairTaskNode,
    input_data: RepairAdvanceInput | None,
) -> NodeAdvanceResult:
    repair = RepairAdvanceInput() if input_data is None else input_data
    try:
        artifacts = _prepare_attempt(project_root, graph, run, node, repair.model_profile_id)
    except PackBuildError as exc:
        return _route_pack_build_failure(project_root, graph, compiled, run, node, exc)
    evaluation_id = _runtime_string(run, "last_evaluation_by_target", node.repair_target_node_id)
    target_attempt_id = _runtime_string(run, "last_attempt_ids", node.repair_target_node_id)
    if evaluation_id is None or target_attempt_id is None:
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "Repair node cannot run before a failed evaluation for its target exists.",
            details={"run_id": run.run_id, "node_id": node.node_id, "target_node_id": node.repair_target_node_id},
        )

    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.READY)
    run = _emit_attempt_started(project_root, run, node.node_id, artifacts)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.RUNNING)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.REPAIRING)
    run = _transition_node(project_root, run, node.repair_target_node_id, NodeRuntimeState.REPAIRING)

    started_event = RepairEvent(
        event_id=new_runtime_id(),
        seq=next_event_seq(project_root, run.run_id),
        run_id=run.run_id,
        node_id=node.node_id,
        attempt_id=artifacts.attempt_id,
        type="repair.started",
        phase=EventPhase.NODE_REPAIRING,
        title="Repair started",
        summary=None,
        content=None,
        payload={
            "repair_node_id": node.node_id,
            "target_node_id": node.repair_target_node_id,
            "evaluation_id": evaluation_id,
        },
        display_level=DisplayLevel.DEFAULT,
        expandable=False,
        created_at=utc_now_ms(),
        patch_id=None,
        target_node_id=node.repair_target_node_id,
        eval_id=evaluation_id,
    )
    run = append_run_event_locked(project_root, run, started_event)

    patch = _build_repair_patch(
        run=run,
        node=node,
        artifacts=artifacts,
        input_data=repair,
        evaluation_id=evaluation_id,
        target_attempt_id=target_attempt_id,
    )
    append_run_jsonl_locked(project_root, run.run_id, "repairs.jsonl", patch.model_dump(mode="json"))
    pending_overlay = _PendingPromptOverlay(
        patch_id=patch.patch_id,
        patch_kind=patch.patch_kind.value,
        repair_node_id=node.node_id,
        repair_attempt_id=artifacts.attempt_id,
        evaluation_id=evaluation_id,
        instruction_text=repair.instruction_text,
    )
    _store_runtime_value(
        run, "pending_prompt_overlays", node.repair_target_node_id, pending_overlay.model_dump(mode="json")
    )

    proposed_event = RepairEvent(
        event_id=new_runtime_id(),
        seq=next_event_seq(project_root, run.run_id),
        run_id=run.run_id,
        node_id=node.node_id,
        attempt_id=artifacts.attempt_id,
        type="repair.patch_proposed",
        phase=EventPhase.NODE_REPAIRING,
        title="Repair patch proposed",
        summary=None,
        content=None,
        payload={
            "patch_id": patch.patch_id,
            "patch_kind": patch.patch_kind.value,
            "addresses_failure_types": [failure_type.value for failure_type in patch.addresses_failure_types],
            "risk_level": patch.risk_level.value,
            "scope": patch.scope.value,
        },
        display_level=DisplayLevel.DEFAULT,
        expandable=True,
        created_at=utc_now_ms(),
        patch_id=patch.patch_id,
        target_node_id=node.repair_target_node_id,
        eval_id=evaluation_id,
    )
    run = append_run_event_locked(project_root, run, proposed_event)

    output = {"patch_id": patch.patch_id, "applied": True}
    output_hash = _stable_hash(output)
    artifacts = artifacts.model_copy(update={"output_hash": output_hash})
    attempt = _completed_attempt(
        run,
        node.node_id,
        artifacts,
        output=output,
        output_artifact_refs=[],
        metadata=repair.metadata,
    )
    append_run_jsonl_locked(project_root, run.run_id, "attempts.jsonl", attempt.model_dump(mode="json"))
    _store_runtime_value(run, "last_attempt_ids", node.node_id, artifacts.attempt_id)
    _store_runtime_value(run, "last_output_hashes", node.node_id, output_hash)
    _store_runtime_value(run, "last_patch_ids", node.node_id, patch.patch_id)
    _store_runtime_value(run, "last_patch_ids", node.repair_target_node_id, patch.patch_id)
    run = _persist_runtime_metadata(project_root, run)

    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.RETRYING)
    run = _transition_node(project_root, run, node.repair_target_node_id, NodeRuntimeState.RETRYING)
    applied_event = RepairEvent(
        event_id=new_runtime_id(),
        seq=next_event_seq(project_root, run.run_id),
        run_id=run.run_id,
        node_id=node.node_id,
        attempt_id=artifacts.attempt_id,
        type="repair.patch_applied",
        phase=EventPhase.NODE_RETRYING,
        title="Repair patch applied",
        summary=None,
        content=None,
        payload={
            "patch_id": patch.patch_id,
            "patch_kind": patch.patch_kind.value,
            "side_effects": [f"pending_prompt_overlay_for_{node.repair_target_node_id}"],
        },
        display_level=DisplayLevel.DEFAULT,
        expandable=False,
        created_at=utc_now_ms(),
        patch_id=patch.patch_id,
        target_node_id=node.repair_target_node_id,
        eval_id=evaluation_id,
    )
    run = append_run_event_locked(project_root, run, applied_event)
    run = _emit_attempt_completed(project_root, run, node.node_id, artifacts)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.PASSED)

    next_node_ids = _route_targets(compiled, node.node_id, "repair")
    run = _update_run_current_nodes(project_root, run, next_node_ids, RunState.RUNNING)
    return NodeAdvanceResult(
        run=run,
        node_id=node.node_id,
        node_state=NodeRuntimeState.PASSED,
        next_node_ids=next_node_ids,
        attempt_id=artifacts.attempt_id,
        patch_id=patch.patch_id,
    )


def _advance_human_gate(
    project_root: Path,
    run: WorkflowRunDocument,
    node: HumanCheckpointNode,
    input_data: HumanGateAdvanceInput | None,
) -> NodeAdvanceResult:
    gate_input = HumanGateAdvanceInput() if input_data is None else input_data
    now = utc_now_ms()
    prompt_to_user = gate_input.prompt_to_user
    if prompt_to_user is None and node.contract is not None:
        prompt_to_user = str(getattr(node.contract, "prompt_to_user", "Human decision required."))
    if prompt_to_user is None:
        prompt_to_user = "Human decision required."

    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.READY)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.WAITING_USER)
    run = run.model_copy(
        update={
            "state": RunState.WAITING_USER,
            "previous_state": run.state,
            "paused_at": now,
            "last_heartbeat_at": now,
            "current_node_ids": [node.node_id],
        }
    )
    run = _merge_run_metadata(run, {"cw": {"human_gate": {node.node_id: gate_input.metadata}}})
    append_run_jsonl_locked(
        project_root,
        run.run_id,
        "decisions.jsonl",
        {
            "human_node_id": node.node_id,
            "status": "pending",
            "decision": None,
            "by": None,
            "decided_at": None,
            "requested_at": now,
            "custom_value": None,
        },
    )

    human_event = HumanEvent(
        event_id=new_runtime_id(),
        seq=next_event_seq(project_root, run.run_id),
        run_id=run.run_id,
        node_id=node.node_id,
        attempt_id=None,
        type="human.gate_required",
        phase=EventPhase.NODE_WAITING_USER,
        title="Human decision required",
        summary=None,
        content=None,
        payload={
            "human_node_id": node.node_id,
            "prompt_to_user": prompt_to_user,
            "decisions": [decision.model_dump(mode="json") for decision in node.decisions],
            "timeout_seconds": getattr(node.contract, "timeout_seconds", None) if node.contract is not None else None,
        },
        display_level=DisplayLevel.DEFAULT,
        sensitivity=Sensitivity.PROJECT,
        expandable=True,
        created_at=now,
        human_node_id=node.node_id,
        decision_key=None,
        user_id=None,
    )
    run = append_run_event_locked(project_root, run, human_event)

    paused_event = _lifecycle_event(
        project_root,
        run,
        event_type="run.paused",
        phase=EventPhase.RUN_PAUSED,
        title="Run waiting for human",
        payload={"reason": "human_checkpoint", "human_node_id": node.node_id},
        expandable=False,
    )
    run = append_run_event_locked(project_root, run, paused_event)
    return NodeAdvanceResult(
        run=run,
        node_id=node.node_id,
        node_state=NodeRuntimeState.WAITING_USER,
        next_node_ids=[node.node_id],
    )


def _ensure_human_decision_allowed(node: HumanCheckpointNode, decision: str) -> None:
    allowed = {definition.key for definition in node.decisions}
    if decision not in allowed:
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "Human decision is not declared on the current human_checkpoint node.",
            details={"node_id": node.node_id, "decision": decision, "allowed": sorted(allowed)},
        )


def _pending_decision_requested_at(project_root: Path, run_id: str, human_node_id: str) -> str:
    decisions_path = run_directory(project_root, run_id) / "decisions.jsonl"
    requested_at: str | None = None
    try:
        lines = decisions_path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as exc:
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Run is waiting_user but decisions.jsonl is missing.",
            status_code=500,
            details={"run_id": run_id, "human_node_id": human_node_id},
        ) from exc
    for raw_line in lines:
        if not raw_line.strip():
            continue
        try:
            loaded = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise RunError(
                "RH_RUN_DIR_CORRUPTED",
                "decisions.jsonl contains invalid JSON.",
                status_code=500,
                details={"run_id": run_id, "human_node_id": human_node_id},
            ) from exc
        if not isinstance(loaded, dict):
            continue
        if loaded.get("human_node_id") != human_node_id:
            continue
        if loaded.get("status") == "pending" and isinstance(loaded.get("requested_at"), str):
            requested_at = str(loaded["requested_at"])
    if requested_at is None:
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Run is waiting_user but has no pending human decision record.",
            status_code=500,
            details={"run_id": run_id, "human_node_id": human_node_id},
        )
    return requested_at


def _emit_human_gate_resolved(
    project_root: Path,
    run: WorkflowRunDocument,
    node: HumanCheckpointNode,
    request: HumanDecisionRequest,
    created_at: str,
) -> WorkflowRunDocument:
    event = HumanEvent(
        event_id=new_runtime_id(),
        seq=next_event_seq(project_root, run.run_id),
        run_id=run.run_id,
        node_id=node.node_id,
        attempt_id=None,
        type="human.gate_resolved",
        phase=EventPhase.NODE_PASSED,
        title="Human decision resolved",
        summary=None,
        content=None,
        payload={
            "human_node_id": node.node_id,
            "decision": request.decision,
            "by": request.by,
            "custom_value": request.custom_value,
        },
        display_level=DisplayLevel.DEFAULT,
        sensitivity=Sensitivity.PROJECT,
        expandable=False,
        created_at=created_at,
        human_node_id=node.node_id,
        decision_key=request.decision,
        user_id=request.by,
    )
    return append_run_event_locked(project_root, run, event)


def _prepare_attempt(
    project_root: Path,
    graph: WorkflowGraph,
    run: WorkflowRunDocument,
    node: AttemptNode,
    model_profile_id: str | None,
) -> _AttemptArtifacts:
    contract = _require_contract(node)
    attempt_index = _attempt_index(run, node.node_id)
    if attempt_index >= contract.retry_policy.max_attempts:
        raise RunError(
            "NL_ATTEMPT_LIMIT_EXCEEDED",
            "Node attempt_index exceeds retry_policy.max_attempts.",
            details={
                "run_id": run.run_id,
                "node_id": node.node_id,
                "attempt_index": attempt_index,
                "max_attempts": contract.retry_policy.max_attempts,
            },
        )

    now = utc_now_ms()
    attempt_id = new_runtime_id()
    context_pack_id = new_runtime_id()
    execution_pack_id = new_runtime_id()
    evidence_pack_id = new_runtime_id() if contract.evidence_requirements else None
    pending_overlay = _consume_pending_prompt_overlay(run, node.node_id)
    effective_prompt_overlay = None
    if pending_overlay is not None:
        effective_prompt_overlay = PromptOverlay(
            append_to_instructions=[pending_overlay.instruction_text],
            source_patch_id=pending_overlay.patch_id,
        )

    pack_request = StaticAttemptPackRequest(
        run_id=run.run_id,
        node_id=node.node_id,
        attempt_id=attempt_id,
        context_pack_id=context_pack_id,
        evidence_pack_id=evidence_pack_id,
        execution_pack_id=execution_pack_id,
        contract=contract,
        model_profile_id=_DEFAULT_MODEL_PROFILE_ID,
        built_at=now,
        initial_input=_initial_input_from_run(run),
        effective_prompt_overlay=effective_prompt_overlay,
        reflection_lookup_result=lookup_reflection_memory(
            project_root,
            ReflectionLookupRequest(
                node_id=node.node_id,
                contract_kind=contract.contract_kind,
                node_type=node.type,
                failure_type_hint=_runtime_string(run, "last_failure_types", node.node_id),
                domain_signals=_reflection_domain_signals(run),
                include_kinds=cast(set[ReflectionKind], {"patch_pattern", "prompt_pattern"}),
                sample_count_min=1,
            ),
        ),
    )
    try:
        evidence_pack = build_static_evidence_pack(pack_request)
        if evidence_pack is not None:
            write_run_json_locked(
                project_root,
                run.run_id,
                f"evidence_packs/{evidence_pack.pack_id}.json",
                evidence_pack.model_dump(mode="json"),
            )
            evidence_completed = _context_event(
                project_root=project_root,
                run=run,
                event_type="evidence.build_completed",
                title="Evidence build completed",
                payload={
                    "pack_id": evidence_pack.pack_id,
                    "evidences_count": len(evidence_pack.evidences),
                    "coverage_ratio": evidence_pack.coverage.coverage_ratio,
                    "conflicts_count": len(evidence_pack.conflicts),
                },
                expandable=True,
                node=node,
                attempt_id=attempt_id,
                evidence_pack_id=evidence_pack.pack_id,
            )
            append_run_event_locked(project_root, run, evidence_completed)

        context_started = _context_event(
            project_root=project_root,
            run=run,
            event_type="context.build_started",
            title="Context build started",
            payload={
                "requirements_hash": _stable_hash(
                    [item.model_dump(mode="json") for item in contract.context_requirements]
                )
            },
            expandable=False,
            node=node,
            attempt_id=attempt_id,
            context_pack_id=context_pack_id,
        )
        append_run_event_locked(project_root, run, context_started)

        context_pack = build_static_context_pack(pack_request, evidence_pack)
        routing_request = build_routing_request(
            run_id=run.run_id,
            node_id=node.node_id,
            attempt_index=attempt_index,
            node_contract=contract,
            workflow_model_policy=graph.model_policy,
            project_settings_models=load_project_model_settings(project_root),
            context_required_tokens=sum(fragment.tokens_estimate for fragment in context_pack.fragments),
            request_id=new_runtime_id(),
            correlation_id=attempt_id,
            primary_model_profile_id=model_profile_id,
        )
        routing_decision = route_model(
            routing_request,
            resolve_model_profile_registry(routing_request.project_settings_models),
            decided_at=now,
        )
        append_run_jsonl_locked(
            project_root,
            run.run_id,
            "routing.jsonl",
            build_routing_trace(routing_request, routing_decision).model_dump(mode="json"),
        )
        pack_request = pack_request.model_copy(
            update={
                "model_profile_id": routing_decision.model_profile_id,
                "effective_model_settings": routing_decision.effective_model_settings,
            }
        )
        execution_pack = build_static_execution_pack(pack_request, context_pack, evidence_pack)
    except PackBuildError as exc:
        raise _attempt_pack_build_error(exc, attempt_id=attempt_id, attempt_index=attempt_index) from exc
    except ValidationError as exc:
        pack_error = _pack_build_error_from_validation(exc)
        raise _attempt_pack_build_error(pack_error, attempt_id=attempt_id, attempt_index=attempt_index) from exc
    except ModelRouterError as exc:
        raise RunError(
            exc.error_code,
            str(exc),
            details={**exc.details, "run_id": run.run_id, "node_id": node.node_id, "attempt_index": attempt_index},
        ) from exc

    pack_bundle = AttemptPackBundle(
        context_pack=context_pack,
        evidence_pack=evidence_pack,
        execution_pack=execution_pack,
    )

    _write_attempt_pack_bundle(
        project_root=project_root,
        run=run,
        attempt_id=attempt_id,
        bundle=pack_bundle,
        pending_overlay=pending_overlay,
        effective_prompt_overlay=effective_prompt_overlay,
        evidence_pack_already_written=pack_bundle.evidence_pack is not None,
    )

    context_completed = _context_event(
        project_root=project_root,
        run=run,
        event_type="context.build_completed",
        title="Context build completed",
        payload={
            "pack_id": pack_bundle.context_pack.pack_id,
            "pack_hash": pack_bundle.context_pack.provenance.pack_hash,
            "fragments_count": len(pack_bundle.context_pack.fragments),
            "total_tokens": sum(fragment.tokens_estimate for fragment in pack_bundle.context_pack.fragments),
            "hard_limit": pack_bundle.context_pack.budget.hard_limit_tokens,
        },
        expandable=True,
        node=node,
        attempt_id=attempt_id,
        context_pack_id=pack_bundle.context_pack.pack_id,
        evidence_pack_id=None if pack_bundle.evidence_pack is None else pack_bundle.evidence_pack.pack_id,
    )
    append_run_event_locked(project_root, run, context_completed)

    _store_runtime_value(run, "attempt_counts", node.node_id, attempt_index + 1)
    return _AttemptArtifacts(
        attempt_id=attempt_id,
        attempt_index=attempt_index,
        adapter_id=routing_decision.adapter_id,
        context_pack_id=context_pack_id,
        evidence_pack_id=None if pack_bundle.evidence_pack is None else pack_bundle.evidence_pack.pack_id,
        execution_pack_id=execution_pack_id,
        started_at=now,
        model_profile_id=routing_decision.model_profile_id,
        effective_prompt_overlay_ref=None if pending_overlay is None else f"overlays/{attempt_id}.json",
        source_patch_id=None if pending_overlay is None else pending_overlay.patch_id,
    )


def _attempt_pack_build_error(exc: PackBuildError, *, attempt_id: str, attempt_index: int) -> PackBuildError:
    details = dict(exc.details)
    details["attempt_id"] = attempt_id
    details["attempt_index"] = attempt_index
    return PackBuildError(exc.error_code, str(exc), details=details)


def _pack_build_error_from_validation(exc: ValidationError) -> PackBuildError:
    first_code = "CP_BUILD_REQ_UNRESOLVED"
    validation_errors = exc.errors(include_context=False)
    for error in validation_errors:
        raw_type = error.get("type")
        if isinstance(raw_type, str) and (raw_type.startswith("CP_BUILD_") or raw_type.startswith("EP_BUILD_")):
            first_code = raw_type
            break
    return PackBuildError(
        first_code,
        str(exc),
        details={"validation_errors": validation_errors},
    )


def _write_attempt_pack_bundle(
    *,
    project_root: Path,
    run: WorkflowRunDocument,
    attempt_id: str,
    bundle: AttemptPackBundle,
    pending_overlay: _PendingPromptOverlay | None,
    effective_prompt_overlay: PromptOverlay | None,
    evidence_pack_already_written: bool = False,
) -> None:
    if pending_overlay is not None and effective_prompt_overlay is not None:
        write_run_json_locked(
            project_root,
            run.run_id,
            f"overlays/{attempt_id}.json",
            {
                "patch_id": pending_overlay.patch_id,
                "repair_node_id": pending_overlay.repair_node_id,
                "repair_attempt_id": pending_overlay.repair_attempt_id,
                "patch_kind": pending_overlay.patch_kind,
                "prompt_overlay": effective_prompt_overlay.model_dump(mode="json"),
                "applies_to_attempt_id": attempt_id,
            },
        )
    if bundle.evidence_pack is not None and not evidence_pack_already_written:
        write_run_json_locked(
            project_root,
            run.run_id,
            f"evidence_packs/{bundle.evidence_pack.pack_id}.json",
            bundle.evidence_pack.model_dump(mode="json"),
        )
    write_run_json_locked(
        project_root,
        run.run_id,
        f"context_packs/{bundle.context_pack.pack_id}.json",
        bundle.context_pack.model_dump(mode="json"),
    )
    write_run_json_locked(
        project_root,
        run.run_id,
        f"execution_packs/{bundle.execution_pack.pack_id}.json",
        bundle.execution_pack.model_dump(mode="json"),
    )


def _completed_attempt(
    run: WorkflowRunDocument,
    node_id: str,
    artifacts: _AttemptArtifacts,
    *,
    output: dict[str, Any],
    output_artifact_refs: list[ArtifactRef],
    metadata: dict[str, Any],
    effective_prompt_overlay_ref: str | None = None,
) -> NodeAttempt:
    finished_at = utc_now_ms()
    output_hash = artifacts.output_hash or _stable_hash(output)
    resolved_overlay_ref = (
        artifacts.effective_prompt_overlay_ref if effective_prompt_overlay_ref is None else effective_prompt_overlay_ref
    )
    base_metadata: dict[str, Any] = {"cw": {"foundation_runner": True}}
    if artifacts.source_patch_id is not None:
        base_metadata["cw"]["source_patch_id"] = artifacts.source_patch_id
    return NodeAttempt(
        attempt_id=artifacts.attempt_id,
        run_id=run.run_id,
        node_id=node_id,
        attempt_index=artifacts.attempt_index,
        state=AttemptState.COMPLETED,
        started_at=artifacts.started_at,
        finished_at=finished_at,
        adapter_id=artifacts.adapter_id,
        adapter_version=_RUNNER_VERSION,
        model_profile_id=artifacts.model_profile_id,
        effective_prompt_overlay_ref=resolved_overlay_ref,
        context_pack_id=artifacts.context_pack_id,
        evidence_pack_id=artifacts.evidence_pack_id,
        execution_pack_id=artifacts.execution_pack_id,
        output_hash=output_hash,
        output_artifact_refs=output_artifact_refs,
        usage=RunUsage(),
        errors=[],
        outcome_hash=_stable_hash({"output_hash": output_hash, "finished_at": finished_at}),
        metadata=_merge_metadata(base_metadata, metadata),
    )


def _failed_attempt(
    run: WorkflowRunDocument,
    node_id: str,
    artifacts: _AttemptArtifacts,
    errors: list[AdapterError],
) -> NodeAttempt:
    finished_at = utc_now_ms()
    return NodeAttempt(
        attempt_id=artifacts.attempt_id,
        run_id=run.run_id,
        node_id=node_id,
        attempt_index=artifacts.attempt_index,
        state=AttemptState.FAILED,
        started_at=artifacts.started_at,
        finished_at=finished_at,
        adapter_id=artifacts.adapter_id,
        adapter_version=_RUNNER_VERSION,
        model_profile_id=artifacts.model_profile_id,
        context_pack_id=artifacts.context_pack_id,
        evidence_pack_id=artifacts.evidence_pack_id,
        execution_pack_id=artifacts.execution_pack_id,
        output_hash=None,
        usage=RunUsage(),
        errors=errors,
        outcome_hash=_stable_hash(
            {"errors": [error.model_dump(mode="json") for error in errors], "finished_at": finished_at}
        ),
        metadata={"cw": {"foundation_runner": True}},
    )


def _fail_attempt_and_run(
    project_root: Path,
    run: WorkflowRunDocument,
    node: ExecutionTaskNode,
    artifacts: _AttemptArtifacts,
    errors: list[AdapterError],
) -> NodeAdvanceResult:
    attempt = _failed_attempt(run, node.node_id, artifacts, errors)
    append_run_jsonl_locked(project_root, run.run_id, "attempts.jsonl", attempt.model_dump(mode="json"))
    event = _lifecycle_event(
        project_root,
        run,
        event_type="attempt.failed",
        phase=EventPhase.ATTEMPT_FAILED,
        title="Attempt failed",
        payload={
            "error_kind": errors[0].error_kind.value if errors else "adapter_internal",
            "message": errors[0].message if errors else "Attempt failed.",
            "will_retry": False,
            "next_action": "run.failed",
            "node_id": node.node_id,
            "attempt_index": artifacts.attempt_index,
        },
        expandable=True,
        node_id=node.node_id,
        attempt_id=artifacts.attempt_id,
    )
    run = append_run_event_locked(project_root, run, event)
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.FAILED)
    now = utc_now_ms()
    summary = RunFailureSummary(
        failure_type=errors[0].failure_type.value if errors else FailureType.UNKNOWN.value,
        failed_node_id=node.node_id,
        message=errors[0].message if errors else "Attempt failed.",
        error_code=errors[0].error_kind.value if errors else None,
        traceback_id=None,
    )
    run = run.model_copy(
        update={
            "state": RunState.FAILED,
            "previous_state": run.state,
            "failed_at": now,
            "last_heartbeat_at": now,
            "current_node_ids": [],
            "failure_summary": summary,
        }
    )
    failed_event = _lifecycle_event(
        project_root,
        run,
        event_type="run.failed",
        phase=EventPhase.RUN_FAILED,
        title="Run failed",
        payload={"error_kind": summary.error_code, "message": summary.message, "failed_node_id": node.node_id},
        expandable=True,
    )
    run = append_run_event_locked(project_root, run, failed_event)
    return NodeAdvanceResult(
        run=run,
        node_id=node.node_id,
        node_state=NodeRuntimeState.FAILED,
        next_node_ids=[],
        attempt_id=artifacts.attempt_id,
    )


def _route_pack_build_failure(
    project_root: Path,
    graph: WorkflowGraph,
    compiled: EngineWorkflowIR,
    run: WorkflowRunDocument,
    node: AttemptNode,
    exc: PackBuildError,
) -> NodeAdvanceResult:
    run = _ensure_node_running_for_failure(project_root, run, node.node_id)
    attempt_id = _pack_error_attempt_id(exc)
    attempt_index = _pack_error_attempt_index(exc)
    _store_runtime_value(
        run,
        "pack_build_failures",
        node.node_id,
        {
            "error_code": exc.error_code,
            "message": str(exc),
            "attempt_id": attempt_id,
            "attempt_index": attempt_index,
            "details": exc.details,
        },
    )
    run = _persist_runtime_metadata(project_root, run)

    repair_target_id = _first_pack_failure_repair_target(graph, compiled, node)
    if repair_target_id is not None:
        run = _emit_pack_build_attempt_failed(
            project_root,
            run,
            node,
            exc,
            attempt_id=attempt_id,
            attempt_index=attempt_index,
            next_action="repair",
            next_node_id=repair_target_id,
        )
        run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.REPAIRING)
        run = _update_run_current_nodes(project_root, run, [repair_target_id], RunState.RUNNING)
        return NodeAdvanceResult(
            run=run,
            node_id=node.node_id,
            node_state=NodeRuntimeState.REPAIRING,
            next_node_ids=[repair_target_id],
            attempt_id=attempt_id,
        )

    human_target_id = _first_pack_failure_human_target(graph, compiled, node) or _pack_failure_human_fallback(graph)
    if human_target_id is not None:
        run = _emit_pack_build_attempt_failed(
            project_root,
            run,
            node,
            exc,
            attempt_id=attempt_id,
            attempt_index=attempt_index,
            next_action="human_checkpoint",
            next_node_id=human_target_id,
        )
        run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.WAITING_USER)
        run = _update_run_current_nodes(project_root, run, [human_target_id], RunState.RUNNING)
        return NodeAdvanceResult(
            run=run,
            node_id=node.node_id,
            node_state=NodeRuntimeState.WAITING_USER,
            next_node_ids=[human_target_id],
            attempt_id=attempt_id,
        )

    run = _emit_pack_build_attempt_failed(
        project_root,
        run,
        node,
        exc,
        attempt_id=attempt_id,
        attempt_index=attempt_index,
        next_action="run.failed",
        next_node_id=None,
    )
    run = _transition_node(project_root, run, node.node_id, NodeRuntimeState.FAILED)
    now = utc_now_ms()
    summary = RunFailureSummary(
        failure_type=FailureType.UNKNOWN.value,
        failed_node_id=node.node_id,
        message=str(exc),
        error_code=exc.error_code,
        traceback_id=None,
    )
    run = run.model_copy(
        update={
            "state": RunState.FAILED,
            "previous_state": run.state,
            "failed_at": now,
            "last_heartbeat_at": now,
            "current_node_ids": [],
            "failure_summary": summary,
        }
    )
    failed_event = _lifecycle_event(
        project_root,
        run,
        event_type="run.failed",
        phase=EventPhase.RUN_FAILED,
        title="Run failed",
        payload={"error_kind": exc.error_code, "message": str(exc), "failed_node_id": node.node_id},
        expandable=True,
    )
    run = append_run_event_locked(project_root, run, failed_event)
    return NodeAdvanceResult(
        run=run,
        node_id=node.node_id,
        node_state=NodeRuntimeState.FAILED,
        next_node_ids=[],
        attempt_id=attempt_id,
    )


def _ensure_node_running_for_failure(
    project_root: Path,
    run: WorkflowRunDocument,
    node_id: str,
) -> WorkflowRunDocument:
    state = _node_state(run, node_id)
    if state == NodeRuntimeState.IDLE:
        run = _transition_node(project_root, run, node_id, NodeRuntimeState.READY)
        return _transition_node(project_root, run, node_id, NodeRuntimeState.RUNNING)
    if state in {NodeRuntimeState.READY, NodeRuntimeState.RETRYING}:
        return _transition_node(project_root, run, node_id, NodeRuntimeState.RUNNING)
    return run


def _emit_pack_build_attempt_failed(
    project_root: Path,
    run: WorkflowRunDocument,
    node: AttemptNode,
    exc: PackBuildError,
    *,
    attempt_id: str | None,
    attempt_index: int | None,
    next_action: str,
    next_node_id: str | None,
) -> WorkflowRunDocument:
    event = _lifecycle_event(
        project_root,
        run,
        event_type="attempt.failed",
        phase=EventPhase.ATTEMPT_FAILED,
        title="Attempt preparation failed",
        payload={
            "error_kind": exc.error_code,
            "message": str(exc),
            "will_retry": next_action == "repair",
            "next_action": next_action,
            "next_node_id": next_node_id,
            "node_id": node.node_id,
            "attempt_index": attempt_index,
        },
        expandable=True,
        node_id=node.node_id,
        attempt_id=attempt_id,
    )
    return append_run_event_locked(project_root, run, event)


def _first_pack_failure_repair_target(
    graph: WorkflowGraph,
    compiled: EngineWorkflowIR,
    node: AttemptNode,
) -> str | None:
    nodes = _node_by_id(graph)
    for edge in compiled.edges:
        if edge.source_node_id != node.node_id or edge.type not in {EdgeType.FAIL, EdgeType.REPAIR, EdgeType.RETRY}:
            continue
        target = nodes.get(edge.target_node_id)
        if isinstance(target, RepairTaskNode) and target.repair_target_node_id == node.node_id:
            return target.node_id
    return None


def _first_pack_failure_human_target(
    graph: WorkflowGraph,
    compiled: EngineWorkflowIR,
    node: AttemptNode,
) -> str | None:
    nodes = _node_by_id(graph)
    for edge in compiled.edges:
        if edge.source_node_id != node.node_id or edge.type not in {EdgeType.FAIL, EdgeType.HUMAN}:
            continue
        target = nodes.get(edge.target_node_id)
        if isinstance(target, HumanCheckpointNode):
            return target.node_id
    return None


def _pack_failure_human_fallback(graph: WorkflowGraph) -> str | None:
    if graph.execution_policy.on_node_failure.value != "human":
        return None
    human_nodes = [node.node_id for node in graph.nodes if isinstance(node, HumanCheckpointNode)]
    if len(human_nodes) != 1:
        return None
    return human_nodes[0]


def _pack_error_attempt_id(exc: PackBuildError) -> str | None:
    raw_attempt_id = exc.details.get("attempt_id")
    return raw_attempt_id if isinstance(raw_attempt_id, str) else None


def _pack_error_attempt_index(exc: PackBuildError) -> int | None:
    raw_attempt_index = exc.details.get("attempt_index")
    return raw_attempt_index if isinstance(raw_attempt_index, int) else None


def _normalize_evaluation_input(
    graph: WorkflowGraph,
    compiled: EngineWorkflowIR,
    node: EvaluationTaskNode,
    input_data: EvaluationAdvanceInput | None,
) -> EvaluationAdvanceInput:
    evaluation = EvaluationAdvanceInput() if input_data is None else input_data
    effective_failure_type = _effective_failure_type(node, evaluation.failure_type)
    if effective_failure_type != evaluation.failure_type:
        evaluation = evaluation.model_copy(update={"failure_type": effective_failure_type})
    if evaluation.passed and evaluation.recommended_action != "pass_to_next":
        return evaluation.model_copy(update={"recommended_action": "pass_to_next"})
    if not evaluation.passed and evaluation.recommended_action == "pass_to_next":
        default_action = _default_action_for_failure(effective_failure_type)
        if default_action == "repair_with_patch":
            repair_target = _first_repair_target(graph, compiled, node)
            if repair_target is not None:
                return evaluation.model_copy(
                    update={"recommended_action": "repair_with_patch", "target_repair_node_id": repair_target}
                )
            human_target = _first_human_target(graph, compiled, node)
            if human_target is not None:
                return evaluation.model_copy(
                    update={"recommended_action": "human_checkpoint", "target_human_node_id": human_target}
                )
            return evaluation.model_copy(update={"recommended_action": "abort"})
        if default_action == "human_checkpoint":
            human_target = _first_human_target(graph, compiled, node)
            if human_target is not None:
                return evaluation.model_copy(
                    update={"recommended_action": "human_checkpoint", "target_human_node_id": human_target}
                )
            return evaluation.model_copy(update={"recommended_action": "abort"})
        return evaluation.model_copy(update={"recommended_action": default_action})
    if evaluation.recommended_action == "repair_with_patch" and evaluation.target_repair_node_id is None:
        repair_target = _first_repair_target(graph, compiled, node)
        if repair_target is None:
            raise RunError(
                "ER_BUILD_DANGLING_REPAIR_TARGET",
                "Evaluation requested repair_with_patch but no valid repair target exists.",
                details={"node_id": node.node_id, "target_node_id": node.target_node_id},
            )
        return evaluation.model_copy(update={"target_repair_node_id": repair_target})
    if evaluation.recommended_action == "repair_with_patch" and evaluation.target_repair_node_id is not None:
        _ensure_repair_target(graph, node, evaluation.target_repair_node_id)
    if evaluation.recommended_action == "human_checkpoint" and evaluation.target_human_node_id is None:
        human_target = _first_human_target(graph, compiled, node)
        if human_target is None:
            raise RunError(
                "ER_BUILD_DANGLING_HUMAN_TARGET",
                "Evaluation requested human_checkpoint but no valid human target exists.",
                details={"node_id": node.node_id, "target_node_id": node.target_node_id},
            )
        return evaluation.model_copy(update={"target_human_node_id": human_target})
    if evaluation.recommended_action == "human_checkpoint" and evaluation.target_human_node_id is not None:
        _ensure_human_target(graph, node, evaluation.target_human_node_id)
    return evaluation


def _effective_failure_type(node: EvaluationTaskNode, failure_type: FailureType) -> FailureType:
    contract = _evaluation_contract(node)
    return failure_type if failure_type in contract.failure_taxonomy else FailureType.UNKNOWN


def _default_action_for_failure(failure_type: FailureType) -> RecommendedActionKind:
    if failure_type in {
        FailureType.FORMAT_ERROR,
        FailureType.MISSING_OUTPUT,
        FailureType.LOGIC_GAP,
    }:
        return "repair_with_patch"
    if failure_type == FailureType.MISSING_EVIDENCE:
        return "request_evidence"
    return "human_checkpoint"


def _build_evaluation_result(
    *,
    run: WorkflowRunDocument,
    node: EvaluationTaskNode,
    artifacts: _AttemptArtifacts,
    input_data: EvaluationAdvanceInput,
    target_attempt_id: str,
    target_hash: str,
) -> EvaluationResult:
    now = utc_now_ms()
    contract = _evaluation_contract(node)
    criterion_results = [
        CriterionResult(
            criterion_id=criterion.criterion_id,
            description=criterion.description,
            kind=criterion.kind,
            severity=criterion.severity,
            weight=criterion.weight,
            passed_for_this_criterion=input_data.passed,
            score_for_this_criterion=input_data.score,
            evaluator_kind="programmatic_validator",
            evaluator_ref=_RUNNER_ID,
            findings=[] if input_data.passed else [_finding(input_data, criterion.severity)],
            evidence_used_ids=[],
        )
        for criterion in contract.criteria
    ]
    action = RecommendedAction(
        action=input_data.recommended_action,
        target_repair_node_id=input_data.target_repair_node_id,
        target_human_node_id=input_data.target_human_node_id,
        note_to_user=input_data.note_to_user,
    )
    failure_diagnosis = None
    if not input_data.passed:
        failure_diagnosis = FailureDiagnosis(
            failure_type=input_data.failure_type,
            failed_criteria=[criterion.criterion_id for criterion in contract.criteria],
            severity=_diagnosis_severity(contract),
            summary=input_data.finding_message,
            rationale=None,
            suggested_repair_targets=[],
            tags=[],
        )
    payload_for_hash = {
        "node_id": node.node_id,
        "target_node_id": node.target_node_id,
        "passed": input_data.passed,
        "score": input_data.score,
        "action": input_data.recommended_action,
        "target_attempt_id": target_attempt_id,
        "criteria": [criterion.model_dump(mode="json") for criterion in contract.criteria],
    }
    return EvaluationResult(
        eval_id=new_runtime_id(),
        evaluator_node_id=node.node_id,
        target_node_id=node.target_node_id,
        target_attempt_id=target_attempt_id,
        evaluator_attempt_id=artifacts.attempt_id,
        run_id=run.run_id,
        passed=input_data.passed,
        score=input_data.score,
        criterion_results=criterion_results,
        failure_diagnosis=failure_diagnosis,
        recommended_strategy=_recommended_strategy_for_failure(input_data),
        recommended_action=action,
        usage=RunUsage(),
        provenance=EvalProvenance(
            eval_started_at=artifacts.started_at,
            eval_finished_at=now,
            evaluator_model_profile_id=artifacts.model_profile_id,
            programmatic_validators=[_RUNNER_ID],
            context_pack_id=artifacts.context_pack_id,
            evidence_pack_id=artifacts.evidence_pack_id,
            target_artifact_hash=target_hash,
            criteria_hash=_stable_hash([criterion.model_dump(mode="json") for criterion in contract.criteria]),
            eval_hash=_stable_hash(payload_for_hash),
        ),
        metadata=_merge_metadata({"cw": {"foundation_runner": True}}, input_data.metadata),
    )


def _finding(input_data: EvaluationAdvanceInput, severity: Severity) -> Finding:
    return Finding(
        finding_id=new_runtime_id(),
        kind="rubric_violation",
        path=None,
        message=input_data.finding_message,
        severity=severity,
        proposed_fix_hint=None,
        related_evidence_ids=[],
    )


def _diagnosis_severity(contract: EvaluationContract) -> Severity:
    for criterion in contract.criteria:
        if criterion.severity == Severity.BLOCKER:
            return Severity.BLOCKER
    return contract.criteria[0].severity


def _recommended_strategy_for_failure(input_data: EvaluationAdvanceInput) -> RepairKind | None:
    if input_data.recommended_action != "repair_with_patch":
        return None
    if input_data.failure_type == FailureType.MODEL_CAPABILITY_LIMIT:
        return RepairKind.MODEL_ESCALATION
    return RepairKind.PROMPT_PATCH


def _next_nodes_for_failed_evaluation(
    graph: WorkflowGraph,
    compiled: EngineWorkflowIR,
    node: EvaluationTaskNode,
    eval_result: EvaluationResult,
) -> list[str]:
    action = eval_result.recommended_action
    if action.action == "repair_with_patch":
        if action.target_repair_node_id is None:
            raise RunError(
                "ER_BUILD_DANGLING_REPAIR_TARGET",
                "Failed evaluation did not specify a repair target.",
                details={"node_id": node.node_id, "eval_id": eval_result.eval_id},
            )
        _ensure_repair_target(graph, node, action.target_repair_node_id)
        return [action.target_repair_node_id]
    if action.action == "human_checkpoint":
        if action.target_human_node_id is None:
            raise RunError(
                "ER_BUILD_DANGLING_HUMAN_TARGET",
                "Failed evaluation did not specify a human checkpoint target.",
                details={"node_id": node.node_id, "eval_id": eval_result.eval_id},
            )
        _ensure_human_target(graph, node, action.target_human_node_id)
        return [action.target_human_node_id]
    if action.action == "retry_same":
        return [node.target_node_id]
    if action.action in {"request_evidence", "abort"}:
        return _route_targets(compiled, node.node_id, "fail")
    raise RunError(
        "NL_STATE_FORBIDDEN_TRANSITION",
        "Unsupported failed-evaluation action for runner routing.",
        details={"node_id": node.node_id, "eval_id": eval_result.eval_id, "action": action.action},
    )


def _build_repair_patch(
    *,
    run: WorkflowRunDocument,
    node: RepairTaskNode,
    artifacts: _AttemptArtifacts,
    input_data: RepairAdvanceInput,
    evaluation_id: str,
    target_attempt_id: str,
) -> RepairPatch:
    now = utc_now_ms()
    operation = AppendToInstructionsOp(text=input_data.instruction_text)
    payload_for_hash = {
        "repair_node_id": node.node_id,
        "target_node_id": node.repair_target_node_id,
        "evaluation_id": evaluation_id,
        "operation": operation.model_dump(mode="json"),
    }
    return RepairPatch(
        patch_id=new_runtime_id(),
        repair_node_id=node.node_id,
        repair_attempt_id=artifacts.attempt_id,
        target_node_id=node.repair_target_node_id,
        evaluation_id=evaluation_id,
        run_id=run.run_id,
        patch_kind=input_data.patch_kind,
        addresses_failure_types=[input_data.failure_type],
        operations=[operation],
        expected_effect=input_data.expected_effect,
        rationale=input_data.rationale,
        applies_to_attempts=[target_attempt_id],
        risk_level=input_data.risk_level,
        provenance=RepairProvenance(
            repair_started_at=artifacts.started_at,
            repair_finished_at=now,
            repair_model_profile_id=artifacts.model_profile_id,
            attempts_window_used=1,
            evaluation_id=evaluation_id,
            usage=RunUsage(),
            patch_hash=_stable_hash(payload_for_hash),
        ),
        metadata=_merge_metadata({"cw": {"foundation_runner": True}}, input_data.metadata),
    )


def _emit_attempt_started(
    project_root: Path,
    run: WorkflowRunDocument,
    node_id: str,
    artifacts: _AttemptArtifacts,
) -> WorkflowRunDocument:
    event = _lifecycle_event(
        project_root,
        run,
        event_type="attempt.started",
        phase=EventPhase.ATTEMPT_STARTED,
        title="Attempt started",
        payload={
            "attempt_index": artifacts.attempt_index,
            "model_profile_id": artifacts.model_profile_id,
            "node_id": node_id,
            "source_patch_id": artifacts.source_patch_id,
        },
        expandable=False,
        node_id=node_id,
        attempt_id=artifacts.attempt_id,
    )
    return append_run_event_locked(project_root, run, event)


def _emit_attempt_completed(
    project_root: Path,
    run: WorkflowRunDocument,
    node_id: str,
    artifacts: _AttemptArtifacts,
) -> WorkflowRunDocument:
    event = _lifecycle_event(
        project_root,
        run,
        event_type="attempt.completed",
        phase=EventPhase.ATTEMPT_COMPLETED,
        title="Attempt completed",
        payload={
            "output_hash": artifacts.output_hash,
            "duration_ms": 0,
            "usage": RunUsage().model_dump(mode="json"),
            "node_id": node_id,
            "attempt_index": artifacts.attempt_index,
        },
        expandable=False,
        node_id=node_id,
        attempt_id=artifacts.attempt_id,
    )
    return append_run_event_locked(project_root, run, event)


def _transition_node(
    project_root: Path,
    run: WorkflowRunDocument,
    node_id: str,
    to_state: NodeRuntimeState,
) -> WorkflowRunDocument:
    from_state = _node_state(run, node_id)
    if to_state == from_state:
        return run
    allowed = _ALLOWED_NODE_TRANSITIONS[from_state]
    if to_state not in allowed:
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "Node state transition is forbidden.",
            details={"run_id": run.run_id, "node_id": node_id, "from": from_state.value, "to": to_state.value},
        )
    _store_runtime_value(run, "node_states", node_id, to_state.value)
    run = _persist_runtime_metadata(project_root, run)
    payload = {"node_id": node_id, "from": from_state.value, "to": to_state.value}
    event = _lifecycle_event(
        project_root,
        run,
        event_type="node.state_changed",
        phase=_NODE_PHASES[to_state],
        title=f"Node {to_state.value}",
        payload=payload,
        expandable=False,
        node_id=node_id,
    )
    return append_run_event_locked(project_root, run, event)


def _lifecycle_event(
    project_root: Path,
    run: WorkflowRunDocument,
    *,
    event_type: Literal[
        "run.started",
        "run.paused",
        "run.resumed",
        "run.completed",
        "run.failed",
        "run.cancelled",
        "node.state_changed",
        "attempt.started",
        "attempt.completed",
        "attempt.failed",
    ],
    phase: EventPhase,
    title: str,
    payload: dict[str, Any],
    expandable: bool,
    node_id: str | None = None,
    attempt_id: str | None = None,
) -> LifecycleEvent:
    return LifecycleEvent(
        event_id=new_runtime_id(),
        seq=next_event_seq(project_root, run.run_id),
        run_id=run.run_id,
        node_id=node_id,
        attempt_id=attempt_id,
        type=event_type,
        phase=phase,
        title=title,
        summary=None,
        content=None,
        payload=payload,
        display_level=DisplayLevel.DEFAULT,
        severity=StreamSeverity.INFO,
        sensitivity=Sensitivity.PROJECT,
        expandable=expandable,
        created_at=utc_now_ms(),
    )


def _context_event(
    project_root: Path,
    run: WorkflowRunDocument,
    *,
    event_type: Literal["context.build_started", "context.build_completed", "evidence.build_completed"],
    title: str,
    payload: dict[str, Any],
    expandable: bool,
    node: AttemptNode,
    attempt_id: str,
    context_pack_id: str | None = None,
    evidence_pack_id: str | None = None,
) -> ContextEvent:
    return ContextEvent(
        event_id=new_runtime_id(),
        seq=next_event_seq(project_root, run.run_id),
        run_id=run.run_id,
        node_id=node.node_id,
        attempt_id=attempt_id,
        type=event_type,
        phase=None,
        title=title,
        summary=None,
        content=None,
        payload=payload,
        display_level=DisplayLevel.DEFAULT,
        severity=StreamSeverity.INFO,
        sensitivity=Sensitivity.PROJECT,
        expandable=expandable,
        created_at=utc_now_ms(),
        context_pack_id=context_pack_id,
        evidence_pack_id=evidence_pack_id,
    )


def _update_run_current_nodes(
    project_root: Path,
    run: WorkflowRunDocument,
    next_node_ids: list[str],
    state: RunState,
) -> WorkflowRunDocument:
    updated = run.model_copy(
        update={
            "state": state,
            "previous_state": run.state if run.state != state else run.previous_state,
            "last_heartbeat_at": utc_now_ms(),
            "current_node_ids": next_node_ids,
        }
    )
    return write_workflow_run_locked(project_root, updated)


def _route_targets(compiled: EngineWorkflowIR, source_node_id: str, route_key: RouteKey) -> list[str]:
    expected_type = {
        "normal": EdgeType.NORMAL,
        "pass": EdgeType.PASS,
        "fail": EdgeType.FAIL,
        "repair": EdgeType.RETRY,
    }[route_key]
    candidates = [
        edge.target_node_id
        for edge in compiled.edges
        if edge.source_node_id == source_node_id
        and edge.type == expected_type
        and (route_key == "normal" or edge.route_key == route_key)
    ]
    if not candidates:
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "No compiled route exists for the requested node transition.",
            details={"workflow_id": compiled.workflow_id, "node_id": source_node_id, "route_key": route_key},
        )
    return candidates


def _human_route_targets(compiled: EngineWorkflowIR, source_node_id: str, decision: str) -> list[str]:
    candidates = [
        edge.target_node_id
        for edge in compiled.edges
        if edge.source_node_id == source_node_id and edge.type == EdgeType.HUMAN and edge.route_key == decision
    ]
    if not candidates:
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "No compiled human route exists for the submitted decision.",
            details={"workflow_id": compiled.workflow_id, "node_id": source_node_id, "decision": decision},
        )
    return candidates


def _first_repair_target(graph: WorkflowGraph, compiled: EngineWorkflowIR, node: EvaluationTaskNode) -> str | None:
    for target_node_id in _route_targets(compiled, node.node_id, "fail"):
        if _is_repair_target_for(graph, node, target_node_id):
            return target_node_id
    return None


def _first_human_target(graph: WorkflowGraph, compiled: EngineWorkflowIR, node: EvaluationTaskNode) -> str | None:
    for target_node_id in _route_targets(compiled, node.node_id, "fail"):
        if _is_human_target(graph, target_node_id):
            return target_node_id
    return None


def _ensure_repair_target(graph: WorkflowGraph, node: EvaluationTaskNode, target_node_id: str) -> None:
    if not _is_repair_target_for(graph, node, target_node_id):
        raise RunError(
            "ER_BUILD_DANGLING_REPAIR_TARGET",
            "Evaluation repair target is not a repair_task for the evaluated node.",
            details={
                "node_id": node.node_id,
                "target_node_id": node.target_node_id,
                "target_repair_node_id": target_node_id,
            },
        )


def _ensure_human_target(graph: WorkflowGraph, node: EvaluationTaskNode, target_node_id: str) -> None:
    if not _is_human_target(graph, target_node_id):
        raise RunError(
            "ER_BUILD_DANGLING_HUMAN_TARGET",
            "Evaluation human target is not a human_checkpoint node.",
            details={"node_id": node.node_id, "target_human_node_id": target_node_id},
        )


def _is_repair_target_for(graph: WorkflowGraph, node: EvaluationTaskNode, target_node_id: str) -> bool:
    target_node = _node_by_id(graph).get(target_node_id)
    return isinstance(target_node, RepairTaskNode) and target_node.repair_target_node_id == node.target_node_id


def _is_human_target(graph: WorkflowGraph, target_node_id: str) -> bool:
    target_node = _node_by_id(graph).get(target_node_id)
    return isinstance(target_node, HumanCheckpointNode)


def _routes_to_target_evaluation(graph: WorkflowGraph, next_node_ids: Sequence[str], target_node_id: str) -> bool:
    nodes = _node_by_id(graph)
    for next_node_id in next_node_ids:
        next_node = nodes[next_node_id]
        if isinstance(next_node, EvaluationTaskNode) and next_node.target_node_id == target_node_id:
            return True
    return False


def _node_by_id(graph: WorkflowGraph) -> dict[str, WorkflowNodeBase]:
    return {node.node_id: node for node in graph.nodes}


def _resolve_current_node_id(run: WorkflowRunDocument, requested_node_id: str | None) -> str:
    if not run.current_node_ids:
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "WorkflowRun has no current node to advance.",
            details={"run_id": run.run_id, "state": run.state.value},
        )
    if len(run.current_node_ids) > 1:
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "Deterministic runner foundation supports one current node at a time.",
            details={"run_id": run.run_id, "current_node_ids": run.current_node_ids},
        )
    current_node_id = run.current_node_ids[0]
    if requested_node_id is not None and requested_node_id != current_node_id:
        raise RunError(
            "NL_STATE_FORBIDDEN_TRANSITION",
            "Requested node is not the current WorkflowRun node.",
            details={"run_id": run.run_id, "requested_node_id": requested_node_id, "current_node_id": current_node_id},
        )
    return current_node_id


def _ensure_run_can_advance(run: WorkflowRunDocument) -> None:
    if run.state != RunState.RUNNING:
        raise RunError(
            "WR_STATE_FORBIDDEN_TRANSITION",
            "WorkflowRun can only be advanced while running.",
            details={"run_id": run.run_id, "state": run.state.value},
        )


def _require_contract(node: AttemptNode) -> NodeContractBase:
    if node.contract is None:
        raise RunError(
            "NC_L2_KIND_MISMATCH",
            "Attempt-capable node is missing its NodeContract.",
            details={"node_id": node.node_id, "node_type": node.type},
        )
    return cast(NodeContractBase, node.contract)


def _initial_input_from_run(run: WorkflowRunDocument) -> dict[str, Any]:
    cw_metadata = run.metadata.get("cw")
    if not isinstance(cw_metadata, dict):
        return {}
    raw_initial_input = cw_metadata.get("initial_input")
    if not isinstance(raw_initial_input, dict):
        return {}
    return dict(raw_initial_input)


def _reflection_domain_signals(run: WorkflowRunDocument) -> list[str]:
    initial_input = _initial_input_from_run(run)
    raw_domain_signals = initial_input.get("domain_signals")
    if isinstance(raw_domain_signals, Sequence) and not isinstance(raw_domain_signals, str | bytes | bytearray):
        return [str(signal) for signal in raw_domain_signals if str(signal)]
    raw_domain = initial_input.get("domain")
    if isinstance(raw_domain, str) and raw_domain:
        return [raw_domain]
    return []


def _evaluation_contract(node: EvaluationTaskNode) -> EvaluationContract:
    if not isinstance(node.contract, EvaluationContract):
        raise RunError(
            "NC_L2_KIND_MISMATCH",
            "Evaluation node is missing an EvaluationContract.",
            details={"node_id": node.node_id, "node_type": node.type},
        )
    return node.contract


def _attempt_index(run: WorkflowRunDocument, node_id: str) -> int:
    raw_value = _runtime_lookup(run, "attempt_counts", node_id)
    if raw_value is None:
        return 0
    if isinstance(raw_value, int):
        return raw_value
    if isinstance(raw_value, str):
        try:
            return int(raw_value)
        except ValueError as exc:
            raise _metadata_corrupted(run, "attempt_counts", node_id, raw_value) from exc
    raise _metadata_corrupted(run, "attempt_counts", node_id, raw_value)


def _node_state(run: WorkflowRunDocument, node_id: str) -> NodeRuntimeState:
    raw_value = _runtime_lookup(run, "node_states", node_id)
    if raw_value is None:
        return NodeRuntimeState.IDLE
    try:
        return NodeRuntimeState(str(raw_value))
    except ValueError as exc:
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Run metadata node state is not a valid NodeRuntimeState.",
            status_code=500,
            details={"run_id": run.run_id, "node_id": node_id, "state": raw_value},
        ) from exc


def _runtime_lookup(run: WorkflowRunDocument, bucket: str, key: str) -> object | None:
    cw_metadata = run.metadata.get("cw")
    if not isinstance(cw_metadata, dict):
        return None
    bucket_value = cw_metadata.get(bucket)
    if not isinstance(bucket_value, dict):
        return None
    return bucket_value.get(key)


def _runtime_string(run: WorkflowRunDocument, bucket: str, key: str) -> str | None:
    raw_value = _runtime_lookup(run, bucket, key)
    if raw_value is None:
        return None
    if isinstance(raw_value, str):
        return raw_value
    raise _metadata_corrupted(run, bucket, key, raw_value)


def _consume_pending_prompt_overlay(run: WorkflowRunDocument, node_id: str) -> _PendingPromptOverlay | None:
    raw_value = _runtime_lookup(run, "pending_prompt_overlays", node_id)
    if raw_value is None:
        return None
    try:
        pending = _PendingPromptOverlay.model_validate(raw_value)
    except ValidationError as exc:
        raise _metadata_corrupted(run, "pending_prompt_overlays", node_id, raw_value) from exc
    _remove_runtime_value(run, "pending_prompt_overlays", node_id)
    return pending


def _metadata_corrupted(run: WorkflowRunDocument, bucket: str, key: str, value: object) -> RunError:
    return RunError(
        "RH_RUN_DIR_CORRUPTED",
        "Run metadata contains an invalid runner value.",
        status_code=500,
        details={"run_id": run.run_id, "bucket": bucket, "key": key, "value": value},
    )


def _store_runtime_value(run: WorkflowRunDocument, bucket: str, key: str, value: object) -> None:
    cw_metadata = run.metadata.setdefault("cw", {})
    if not isinstance(cw_metadata, dict):
        cw_metadata = {}
        run.metadata["cw"] = cw_metadata
    bucket_value = cw_metadata.setdefault(bucket, {})
    if not isinstance(bucket_value, dict):
        bucket_value = {}
        cw_metadata[bucket] = bucket_value
    bucket_value[key] = value


def _remove_runtime_value(run: WorkflowRunDocument, bucket: str, key: str) -> None:
    cw_metadata = run.metadata.get("cw")
    if not isinstance(cw_metadata, dict):
        return
    bucket_value = cw_metadata.get(bucket)
    if isinstance(bucket_value, dict):
        bucket_value.pop(key, None)


def _persist_runtime_metadata(project_root: Path, run: WorkflowRunDocument) -> WorkflowRunDocument:
    return write_workflow_run_locked(project_root, run.model_copy(update={"metadata": run.metadata}))


def _merge_run_metadata(run: WorkflowRunDocument, metadata: dict[str, Any]) -> WorkflowRunDocument:
    return run.model_copy(update={"metadata": _merge_metadata(run.metadata, metadata)})


def _merge_metadata(*sources: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for source in sources:
        for namespace, namespace_value in source.items():
            existing = merged.setdefault(namespace, {})
            if isinstance(existing, dict) and isinstance(namespace_value, dict):
                existing.update(namespace_value)
            else:
                merged[namespace] = namespace_value
    return merged


def _stable_hash(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
