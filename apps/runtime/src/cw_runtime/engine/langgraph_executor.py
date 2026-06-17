"""LangGraph StateGraph executor foundation.

The CW Engine owns run state and jsonl persistence. LangGraph is used here as a
graph scheduling substrate compiled from EngineWorkflowIR; node functions remain
thin delegates so later Adapter work can plug in without leaking LangGraph
objects outside the engine layer.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypeAlias, TypedDict, cast

from pydantic import BaseModel, ConfigDict, Field

from cw_schemas.types import EdgeType, NodeType

from .compiler import EngineEdge, EngineNode, EngineWorkflowIR, WorkflowValidationError

RouteTable: TypeAlias = dict[str, dict[str, list[str]]]
PathMap: TypeAlias = dict[str, str]


class LangGraphRunState(TypedDict, total=False):
    """State shape passed through the compiled LangGraph StateGraph."""

    run_id: str
    current_node_id: str
    next_node_ids: list[str]
    visited_node_ids: list[str]
    route_key: str | None
    node_results: dict[str, dict[str, Any]]
    interrupt: dict[str, Any] | None


class LangGraphInterrupt(BaseModel):
    """Internal interrupt envelope persisted in LangGraph state.

    The actual WorkflowRun and StreamEvent jsonl remain authoritative; this
    envelope gives LangGraph callers enough information to stop and resume from
    CW state without making the LangGraph checkpoint the source of truth.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["human_gate"]
    run_id: str
    node_id: str
    payload: dict[str, Any] = Field(default_factory=dict)
    event_ids: list[str] = Field(default_factory=list)


class LangGraphNodeResult(BaseModel):
    """Node delegate result consumed by the LangGraph route selector."""

    model_config = ConfigDict(extra="forbid")

    route_key: str | None = None
    next_node_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    interrupt: LangGraphInterrupt | None = None


class LangGraphNodeExecutor(Protocol):
    """Callable adapter used by StateGraph node functions."""

    def __call__(self, state: LangGraphRunState, node: EngineNode) -> LangGraphNodeResult:
        """Run one CW node and return its route result."""


@dataclass(frozen=True)
class CompiledLangGraphWorkflow:
    """Compiled LangGraph object plus deterministic CW routing metadata."""

    engine_ir: EngineWorkflowIR
    graph: Any
    compiled: Any
    node_ids: tuple[str, ...]
    route_table: Mapping[str, Mapping[str, tuple[str, ...]]]
    path_maps: Mapping[str, Mapping[str, str]]


def compile_langgraph_state_graph(
    engine_ir: EngineWorkflowIR,
    *,
    node_executor: LangGraphNodeExecutor | None = None,
    checkpointer: Any | None = None,
    debug: bool = False,
    name: str | None = None,
    resume_from_current_node: bool = False,
) -> CompiledLangGraphWorkflow:
    """Compile EngineWorkflowIR into a LangGraph StateGraph.

    The returned compiled graph is directly invokable when the ``graph`` extra
    is installed. This function performs no LLM or Adapter work by itself.
    """

    state_graph_type, start_symbol, end_symbol = _load_langgraph_symbols()
    route_table = _route_table(engine_ir.edges)
    path_maps = _path_maps(engine_ir, route_table, end_symbol=end_symbol)

    graph = state_graph_type(LangGraphRunState)
    for node in engine_ir.nodes:
        graph.add_node(
            node.node_id,
            _node_action(node, route_table, node_executor),
            metadata={"cw.node_type": node.type.value, "cw.contract_kind": node.contract_kind},
            destinations=tuple(path_maps[node.node_id].keys()),
        )

    if resume_from_current_node:
        graph.add_conditional_edges(
            start_symbol,
            _start_selector(engine_ir.entry_node_id, node_ids={node.node_id for node in engine_ir.nodes}),
            path_map={node.node_id: node.node_id for node in engine_ir.nodes},
        )
    else:
        graph.add_edge(start_symbol, engine_ir.entry_node_id)
    route_selector = _route_selector(end_symbol=end_symbol)
    for node_id, path_map in path_maps.items():
        graph.add_conditional_edges(node_id, route_selector, path_map=dict(path_map))

    compiled = graph.compile(checkpointer=checkpointer, debug=debug, name=name)
    frozen_route_table = {
        source: {route_key: tuple(targets) for route_key, targets in routes.items()}
        for source, routes in route_table.items()
    }
    return CompiledLangGraphWorkflow(
        engine_ir=engine_ir,
        graph=graph,
        compiled=compiled,
        node_ids=tuple(node.node_id for node in engine_ir.nodes),
        route_table=frozen_route_table,
        path_maps=path_maps,
    )


def _load_langgraph_symbols() -> tuple[type[Any], str, str]:
    try:
        from langgraph.graph import END, START, StateGraph
    except ImportError as exc:  # pragma: no cover - exercised in environments without graph extra
        raise RuntimeError("LangGraph is required for StateGraph compilation; install cw_runtime[graph].") from exc
    return cast(type[Any], StateGraph), START, END


def _route_table(edges: Sequence[EngineEdge]) -> RouteTable:
    routes: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for edge in edges:
        route_key = _edge_route_key(edge)
        routes[edge.source_node_id][route_key].append(edge.target_node_id)
    return {source: dict(route_map) for source, route_map in routes.items()}


def _edge_route_key(edge: EngineEdge) -> str:
    if edge.route_key is not None:
        return edge.route_key
    if edge.type == EdgeType.NORMAL:
        return "normal"
    return edge.type.value


def _path_maps(engine_ir: EngineWorkflowIR, route_table: RouteTable, *, end_symbol: str) -> dict[str, PathMap]:
    maps: dict[str, PathMap] = {}
    for node in engine_ir.nodes:
        targets = sorted({target for targets in route_table.get(node.node_id, {}).values() for target in targets})
        path_map = {target: target for target in targets}
        path_map[end_symbol] = end_symbol
        maps[node.node_id] = path_map
    return maps


def _node_action(
    node: EngineNode,
    route_table: RouteTable,
    node_executor: LangGraphNodeExecutor | None,
) -> Callable[[LangGraphRunState], LangGraphRunState]:
    def action(state: LangGraphRunState) -> LangGraphRunState:
        result = _default_node_result(node) if node_executor is None else node_executor(state, node)
        if result.interrupt is None:
            next_node_ids, route_key = _resolve_next_nodes(node, route_table, result)
            interrupt: dict[str, Any] | None = None
        else:
            next_node_ids = []
            route_key = result.route_key
            interrupt = result.interrupt.model_dump(mode="json")
        visited = [*state.get("visited_node_ids", []), node.node_id]
        node_results = dict(state.get("node_results", {}))
        node_results[node.node_id] = {
            "route_key": route_key,
            "next_node_ids": next_node_ids,
            **result.metadata,
        }
        if interrupt is not None:
            node_results[node.node_id]["interrupt"] = interrupt
        return {
            "current_node_id": node.node_id,
            "next_node_ids": next_node_ids,
            "visited_node_ids": visited,
            "route_key": route_key,
            "node_results": node_results,
            "interrupt": interrupt,
        }

    return action


def _default_node_result(node: EngineNode) -> LangGraphNodeResult:
    if node.type == NodeType.EVALUATION_TASK:
        return LangGraphNodeResult(route_key="pass")
    if node.type == NodeType.REPAIR_TASK:
        return LangGraphNodeResult(route_key="repair")
    return LangGraphNodeResult(route_key="normal")


def _resolve_next_nodes(
    node: EngineNode,
    route_table: RouteTable,
    result: LangGraphNodeResult,
) -> tuple[list[str], str | None]:
    routes = route_table.get(node.node_id, {})
    if result.next_node_ids:
        route_key = _route_key_for_explicit_targets(node, routes, result.next_node_ids, result.route_key)
        return list(result.next_node_ids), route_key
    if not routes:
        return [], result.route_key
    resolved_route_key = result.route_key or _single_route_key(routes)
    if resolved_route_key is not None and resolved_route_key in routes:
        return list(routes[resolved_route_key]), resolved_route_key
    raise WorkflowValidationError(
        "WG_L3_DEAD_END_FAIL_PATH",
        "LangGraph node route did not match any compiled Engine IR edge.",
        details={"node_id": node.node_id, "route_key": result.route_key, "available_routes": sorted(routes)},
    )


def _single_route_key(routes: Mapping[str, Sequence[str]]) -> str | None:
    if len(routes) == 1:
        return next(iter(routes))
    return None


def _route_key_for_explicit_targets(
    node: EngineNode,
    routes: Mapping[str, Sequence[str]],
    next_node_ids: Sequence[str],
    route_key: str | None,
) -> str:
    matching_route_keys = [
        candidate_route_key
        for candidate_route_key, targets in routes.items()
        if _same_target_set(targets, next_node_ids)
    ]
    if route_key is not None:
        if route_key in matching_route_keys:
            return route_key
        raise WorkflowValidationError(
            "WG_L3_DEAD_END_FAIL_PATH",
            "LangGraph node executor returned targets that do not match the declared route_key.",
            details={
                "node_id": node.node_id,
                "route_key": route_key,
                "target_node_ids": list(next_node_ids),
                "available_routes": sorted(routes),
            },
        )
    if len(matching_route_keys) == 1:
        return matching_route_keys[0]
    raise WorkflowValidationError(
        "WG_L3_DEAD_END_FAIL_PATH",
        "LangGraph node executor returned targets that do not equal one compiled Engine IR route.",
        details={
            "node_id": node.node_id,
            "target_node_ids": list(next_node_ids),
            "matching_route_keys": sorted(matching_route_keys),
            "available_routes": sorted(routes),
        },
    )


def _same_target_set(left: Sequence[str], right: Sequence[str]) -> bool:
    return len(left) == len(right) and set(left) == set(right)


def _route_selector(*, end_symbol: str) -> Callable[[LangGraphRunState], str | list[str]]:
    def select_next(state: LangGraphRunState) -> str | list[str]:
        next_node_ids = state.get("next_node_ids", [])
        if not next_node_ids:
            return end_symbol
        if len(next_node_ids) == 1:
            return next_node_ids[0]
        return list(next_node_ids)

    return select_next


def _start_selector(entry_node_id: str, *, node_ids: set[str]) -> Callable[[LangGraphRunState], str]:
    def select_start(state: LangGraphRunState) -> str:
        current_node_id = state.get("current_node_id")
        if current_node_id in node_ids:
            return current_node_id
        return entry_node_id

    return select_start


__all__ = [
    "CompiledLangGraphWorkflow",
    "LangGraphInterrupt",
    "LangGraphNodeExecutor",
    "LangGraphNodeResult",
    "LangGraphRunState",
    "compile_langgraph_state_graph",
]
