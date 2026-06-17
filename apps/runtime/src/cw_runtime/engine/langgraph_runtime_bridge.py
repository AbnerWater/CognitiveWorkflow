"""Runtime bridge between LangGraph node delegates and CW runner state.

This module deliberately keeps LangGraph scheduling in ``cw_runtime.engine``
while delegating state transitions to ``advance_workflow_run``. CW jsonl and
``run.json`` remain authoritative; LangGraph state is only a scheduling view.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from os import PathLike
from pathlib import Path
from typing import Any

from cw_runtime.runner import NodeAdvanceRequest, advance_workflow_run
from cw_runtime.runs import RunError, list_stream_events, read_workflow_run
from cw_schemas.events import StreamEventBase
from cw_schemas.types import NodeRuntimeState, NodeType, RunState

from .compiler import EngineNode
from .langgraph_executor import LangGraphInterrupt, LangGraphNodeResult, LangGraphRunState


class LangGraphRuntimeNodeExecutor:
    """LangGraph node delegate backed by the deterministic CW runner."""

    def __init__(
        self,
        project_root: str | PathLike[str],
        run_id: str,
        *,
        node_requests: Mapping[str, NodeAdvanceRequest] | None = None,
    ) -> None:
        self.project_root = Path(project_root)
        self.run_id = run_id
        self.node_requests = {} if node_requests is None else dict(node_requests)

    def initial_state(self, *, visited_node_ids: Sequence[str] = ()) -> LangGraphRunState:
        """Build a LangGraph invocation state from the current WorkflowRun."""

        run = read_workflow_run(self.project_root, self.run_id)
        state: LangGraphRunState = {
            "run_id": run.run_id,
            "visited_node_ids": list(visited_node_ids),
            "next_node_ids": list(run.current_node_ids),
            "interrupt": None,
        }
        if len(run.current_node_ids) == 1:
            state["current_node_id"] = run.current_node_ids[0]
        elif len(run.current_node_ids) > 1:
            raise RunError(
                "WR_STATE_FORBIDDEN_TRANSITION",
                "LangGraph runtime bridge currently supports one active node per run.",
                details={"run_id": run.run_id, "current_node_ids": list(run.current_node_ids)},
            )
        return state

    def __call__(self, state: LangGraphRunState, node: EngineNode) -> LangGraphNodeResult:
        """Advance the current CW node and return LangGraph routing metadata."""

        request = self._request_for_node(node)
        result = advance_workflow_run(self.project_root, self.run_id, request)

        metadata: dict[str, Any] = {
            "run_state": result.run.state.value,
            "node_state": result.node_state.value,
            "event_ids": list(result.event_ids),
        }
        if result.attempt_id is not None:
            metadata["attempt_id"] = result.attempt_id
        if result.eval_id is not None:
            metadata["eval_id"] = result.eval_id
        if result.patch_id is not None:
            metadata["patch_id"] = result.patch_id

        if result.run.state == RunState.WAITING_USER and result.node_state == NodeRuntimeState.WAITING_USER:
            return LangGraphNodeResult(
                metadata=metadata,
                interrupt=_human_gate_interrupt(self.project_root, result.run.run_id, node.node_id, result.event_ids),
            )

        return LangGraphNodeResult(
            route_key=_route_key_for_result(node, result.node_state),
            next_node_ids=result.next_node_ids,
            metadata=metadata,
        )

    def _request_for_node(self, node: EngineNode) -> NodeAdvanceRequest:
        request = self.node_requests.get(node.node_id)
        if request is None:
            return NodeAdvanceRequest(node_id=node.node_id)
        if request.node_id is not None and request.node_id != node.node_id:
            raise RunError(
                "WR_STATE_FORBIDDEN_TRANSITION",
                "LangGraph node request targets a different WorkflowRun node.",
                details={
                    "run_id": self.run_id,
                    "langgraph_node_id": node.node_id,
                    "request_node_id": request.node_id,
                },
            )
        return request.model_copy(update={"node_id": node.node_id})


def _route_key_for_result(node: EngineNode, node_state: NodeRuntimeState) -> str | None:
    if node.type in {NodeType.START, NodeType.EXECUTION_TASK}:
        return "normal"
    if node.type == NodeType.EVALUATION_TASK:
        return "pass" if node_state == NodeRuntimeState.PASSED else "fail"
    if node.type == NodeType.REPAIR_TASK:
        return "repair"
    return None


def _human_gate_interrupt(
    project_root: Path,
    run_id: str,
    node_id: str,
    event_ids: Sequence[str],
) -> LangGraphInterrupt:
    event = _event_by_type(project_root, run_id, event_ids, "human.gate_required")
    payload = {} if event.payload is None else dict(event.payload)
    return LangGraphInterrupt(
        kind="human_gate",
        run_id=run_id,
        node_id=node_id,
        payload=payload,
        event_ids=list(event_ids),
    )


def _event_by_type(
    project_root: Path,
    run_id: str,
    event_ids: Sequence[str],
    event_type: str,
) -> StreamEventBase:
    event_id_set = set(event_ids)
    for event in list_stream_events(project_root, run_id):
        if event.event_id in event_id_set and event.type == event_type:
            return event
    raise RunError(
        "RH_RUN_DIR_CORRUPTED",
        "WorkflowRun entered waiting_user without the required human.gate_required event.",
        status_code=500,
        details={"run_id": run_id, "event_type": event_type, "event_ids": list(event_ids)},
    )


__all__ = ["LangGraphRuntimeNodeExecutor"]
