"""WorkflowGraph validation and Engine IR compile boundary.

This module intentionally stops before building a LangGraph ``StateGraph``.
It produces a deterministic internal IR that later adapters can translate
without reimplementing WorkflowGraph validation.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict, deque
from collections.abc import Mapping, Sequence
from json import JSONDecodeError
from pathlib import Path
from typing import Final, Literal, TypeAlias, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from cw_runtime.harness.project import AGENT_WORKFLOW_DIR, load_project_tool_availability
from cw_schemas import WorkflowGraph
from cw_schemas.contract import NodeContractBase
from cw_schemas.types import EdgeType, NodeType
from cw_schemas.workflow import EvaluationTaskNode, HumanCheckpointNode, RepairTaskNode

WorkflowErrorLevel: TypeAlias = Literal["L1", "L2", "L3", "L4"]
SyntheticEdgeSource: TypeAlias = Literal["declared", "evaluation_route", "repair_route", "human_route"]

DEFAULT_ENABLED_NODE_TYPES: Final[frozenset[NodeType]] = frozenset(
    {
        NodeType.START,
        NodeType.END,
        NodeType.EXECUTION_TASK,
        NodeType.EVALUATION_TASK,
        NodeType.REPAIR_TASK,
        NodeType.HUMAN_CHECKPOINT,
    }
)

_WORKFLOW_ERROR_LEVELS: Final[dict[str, WorkflowErrorLevel]] = {
    "WG_L1_INVALID_JSON": "L1",
    "WG_L1_NODES_NOT_ARRAY": "L1",
    "WG_L1_EDGES_NOT_ARRAY": "L1",
    "WG_L2_DUP_NODE_ID": "L2",
    "WG_L2_DUP_EDGE_ID": "L2",
    "WG_L2_UNKNOWN_NODE_TYPE": "L2",
    "WG_L2_UNKNOWN_EDGE_TYPE": "L2",
    "WG_L2_BAD_SCHEMA_VERSION": "L2",
    "WG_L2_MISSING_ENTRY_NODE": "L2",
    "WG_L2_MISSING_TERMINAL_NODES": "L2",
    "WG_L2_EVAL_MISSING_TARGET": "L2",
    "WG_L2_EVAL_NO_PASS_ROUTE": "L2",
    "WG_L2_EVAL_NO_FAIL_ROUTE": "L2",
    "WG_L2_EVAL_PASS_ROUTE_MISMATCH": "L2",
    "WG_L2_EVAL_FAIL_ROUTE_MISMATCH": "L2",
    "WG_L2_REPAIR_MISSING_TARGET": "L2",
    "WG_L3_ORPHAN_NODE": "L3",
    "WG_L3_UNREACHABLE_NODE": "L3",
    "WG_L3_DEAD_END_FAIL_PATH": "L3",
    "WG_L3_UNCONTROLLED_LOOP": "L3",
    "WG_L3_MULTIPLE_ENTRIES": "L3",
    "WG_L4_UNKNOWN_SKILL": "L4",
    "WG_L4_UNKNOWN_MCP": "L4",
    "WG_L4_UNKNOWN_MODEL": "L4",
    "WG_L4_NODE_TYPE_NOT_ENABLED": "L4",
    "WG_L4_REFERENCE_UNRESOLVED": "L4",
}
_SPEC_ERROR_CODE_RE: Final = re.compile(r"^(?:WG|NC)_L([1-4])_[A-Z0-9_]+$")
_LLM_NODE_TYPES: Final[frozenset[NodeType]] = frozenset(
    {
        NodeType.EXECUTION_TASK,
        NodeType.EVALUATION_TASK,
        NodeType.REPAIR_TASK,
    }
)


class WorkflowValidationError(RuntimeError):
    """Raised when WorkflowGraph validation fails with a spec error code."""

    def __init__(
        self,
        error_code: str,
        message: str,
        *,
        details: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.level = _error_level_for_code(error_code)
        self.details = {} if details is None else dict(details)


class WorkflowValidationContext(BaseModel):
    """External registries available to L4 compile validation."""

    model_config = ConfigDict(extra="forbid")

    enabled_node_types: set[NodeType] = Field(default_factory=lambda: set(DEFAULT_ENABLED_NODE_TYPES))
    available_context_refs: set[str] | None = None
    available_model_profile_ids: set[str] | None = None
    available_skill_ids: set[str] | None = None
    available_skill_refs: set[str] | None = None
    available_mcp_server_ids: set[str] | None = None


class EngineNode(BaseModel):
    """Internal Engine node descriptor consumed by later runner work."""

    model_config = ConfigDict(extra="forbid")

    node_id: str
    type: NodeType
    title: str
    contract_kind: str | None = None


class EngineEdge(BaseModel):
    """Internal Engine edge after route declarations are merged."""

    model_config = ConfigDict(extra="forbid")

    edge_id: str
    source_node_id: str
    target_node_id: str
    type: EdgeType
    source: SyntheticEdgeSource
    route_key: str | None = None


class EngineWorkflowIR(BaseModel):
    """Deterministic runtime IR; not a public schema contract."""

    model_config = ConfigDict(extra="forbid")

    engine_ir_version: Literal["0.1.0"] = "0.1.0"
    workflow_id: str
    workflow_version: str
    schema_version: str
    entry_node_id: str
    terminal_node_ids: list[str]
    execution_mode: str
    max_concurrent_nodes: int
    nodes: list[EngineNode]
    edges: list[EngineEdge]
    node_order: list[str]
    node_type_counts: dict[str, int]


def load_workflow_graph(project_root: Path) -> WorkflowGraph:
    """Load and validate ``.agent-workflow/workflow.flow.json``."""

    workflow_path = project_root.resolve() / AGENT_WORKFLOW_DIR / "workflow.flow.json"
    try:
        content = workflow_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise WorkflowValidationError(
            "WG_L1_INVALID_JSON",
            "workflow.flow.json could not be read.",
            details={"path": workflow_path.as_posix()},
        ) from exc

    try:
        loaded = json.loads(content)
    except JSONDecodeError as exc:
        raise WorkflowValidationError(
            "WG_L1_INVALID_JSON",
            "workflow.flow.json is not valid JSON.",
            details={"path": workflow_path.as_posix(), "line": exc.lineno, "column": exc.colno},
        ) from exc

    if not isinstance(loaded, dict):
        raise WorkflowValidationError(
            "WG_L1_INVALID_JSON",
            "workflow.flow.json top-level value must be an object.",
            details={"path": workflow_path.as_posix()},
        )
    payload = cast(dict[str, object], loaded)
    _validate_l1_shape(payload, source=workflow_path.as_posix())
    return validate_workflow_graph_payload(payload)


def validate_workflow_graph_payload(payload: Mapping[str, object]) -> WorkflowGraph:
    """Validate a JSON-like object as ``WorkflowGraph`` and normalize L2 errors."""

    _validate_l1_shape(payload, source="payload")
    try:
        return WorkflowGraph.model_validate(payload)
    except ValidationError as exc:
        error_code = _map_validation_error(exc)
        raise WorkflowValidationError(
            error_code,
            "WorkflowGraph failed schema validation.",
            details={"errors": cast(object, exc.errors())},
        ) from exc


def compile_workflow_graph(
    graph: WorkflowGraph,
    *,
    context: WorkflowValidationContext | None = None,
) -> EngineWorkflowIR:
    """Compile a validated ``WorkflowGraph`` into deterministic Engine IR."""

    validation_context = WorkflowValidationContext() if context is None else context
    _validate_l4_references(graph, validation_context)

    edges = _merge_declared_routes(graph)
    _validate_l3_topology(graph, edges)
    node_order = _reachable_node_order(graph.entry_node_id, edges)

    nodes = [
        EngineNode(
            node_id=node.node_id,
            type=NodeType(node.type),
            title=node.title,
            contract_kind=None if node.contract is None else node.contract.contract_kind,
        )
        for node in graph.nodes
    ]
    node_type_counts: dict[str, int] = {}
    for node in nodes:
        node_type_counts[node.type.value] = node_type_counts.get(node.type.value, 0) + 1

    return EngineWorkflowIR(
        workflow_id=graph.workflow_id,
        workflow_version=graph.version,
        schema_version=graph.schema_version,
        entry_node_id=graph.entry_node_id,
        terminal_node_ids=list(graph.terminal_node_ids),
        execution_mode=graph.execution_policy.mode.value,
        max_concurrent_nodes=graph.execution_policy.max_concurrent_nodes,
        nodes=nodes,
        edges=edges,
        node_order=node_order,
        node_type_counts=node_type_counts,
    )


def load_and_compile_workflow(
    project_root: Path,
    *,
    context: WorkflowValidationContext | None = None,
) -> EngineWorkflowIR:
    """Load ``workflow.flow.json`` and compile it into Engine IR."""

    validation_context = load_project_workflow_validation_context(project_root) if context is None else context
    return compile_workflow_graph(load_workflow_graph(project_root), context=validation_context)


def load_project_workflow_validation_context(project_root: Path) -> WorkflowValidationContext:
    """Build L4 workflow validation context from project harness manifests."""

    availability = load_project_tool_availability(project_root)
    return WorkflowValidationContext(
        available_skill_ids=availability.skill_ids,
        available_skill_refs=availability.skill_refs,
        available_mcp_server_ids=availability.mcp_server_ids,
    )


def _validate_l1_shape(payload: Mapping[str, object], *, source: str) -> None:
    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        raise WorkflowValidationError(
            "WG_L1_NODES_NOT_ARRAY",
            "WorkflowGraph.nodes must be present and be an array.",
            details={"source": source},
        )
    edges = payload.get("edges")
    if not isinstance(edges, list):
        raise WorkflowValidationError(
            "WG_L1_EDGES_NOT_ARRAY",
            "WorkflowGraph.edges must be present and be an array.",
            details={"source": source},
        )


def _map_validation_error(exc: ValidationError) -> str:
    for error in exc.errors():
        error_type = str(error.get("type", ""))
        location = tuple(str(part) for part in error.get("loc", ()))
        if _is_spec_error_code(error_type):
            return error_type
        if error_type == "union_tag_invalid" and "nodes" in location:
            return "WG_L2_UNKNOWN_NODE_TYPE"
        if "nodes" in location and "type" in location:
            return "WG_L2_UNKNOWN_NODE_TYPE"
        if "edges" in location and "type" in location:
            return "WG_L2_UNKNOWN_EDGE_TYPE"
        if "schema_version" in location or "version" in location:
            return "WG_L2_BAD_SCHEMA_VERSION"
        if "entry_node_id" in location:
            return "WG_L2_MISSING_ENTRY_NODE"
        if "terminal_node_ids" in location:
            return "WG_L2_MISSING_TERMINAL_NODES"
    return "WG_L1_INVALID_JSON"


def _is_spec_error_code(error_code: str) -> bool:
    return error_code in _WORKFLOW_ERROR_LEVELS or _SPEC_ERROR_CODE_RE.fullmatch(error_code) is not None


def _error_level_for_code(error_code: str) -> WorkflowErrorLevel:
    explicit_level = _WORKFLOW_ERROR_LEVELS.get(error_code)
    if explicit_level is not None:
        return explicit_level
    match = _SPEC_ERROR_CODE_RE.fullmatch(error_code)
    if match is None:
        raise ValueError(f"Unsupported workflow validation error code: {error_code}")
    return cast(WorkflowErrorLevel, f"L{match.group(1)}")


def _validate_l4_references(graph: WorkflowGraph, context: WorkflowValidationContext) -> None:
    for node in graph.nodes:
        node_type = NodeType(node.type)
        if node_type not in context.enabled_node_types:
            raise WorkflowValidationError(
                "WG_L4_NODE_TYPE_NOT_ENABLED",
                f"Node type {node_type.value!r} is not enabled for this runtime.",
                details={"node_id": node.node_id, "node_type": node_type.value},
            )

    if context.available_context_refs is not None:
        for context_ref in graph.global_context_refs:
            if context_ref not in context.available_context_refs:
                raise WorkflowValidationError(
                    "WG_L4_REFERENCE_UNRESOLVED",
                    "WorkflowGraph.global_context_refs contains an unresolved reference.",
                    details={"context_ref": context_ref},
                )

    if context.available_model_profile_ids is not None:
        for model_id in _iter_model_profile_ids(graph):
            if model_id != "auto" and model_id not in context.available_model_profile_ids:
                raise WorkflowValidationError(
                    "WG_L4_UNKNOWN_MODEL",
                    "WorkflowGraph references an unknown model profile.",
                    details={"model_profile_id": model_id},
                )

    if context.available_skill_ids is not None:
        for skill_id, _version, _skill_ref in _iter_skill_refs(graph):
            if skill_id not in context.available_skill_ids:
                raise WorkflowValidationError(
                    "WG_L4_UNKNOWN_SKILL",
                    "WorkflowGraph references an unknown skill.",
                    details={"skill_id": skill_id},
                )

    if context.available_skill_refs is not None:
        for skill_id, version, skill_ref in _iter_skill_refs(graph):
            if skill_ref not in context.available_skill_refs:
                raise WorkflowValidationError(
                    "WG_L4_UNKNOWN_SKILL",
                    "WorkflowGraph references an unavailable skill version.",
                    details={"skill_id": skill_id, "version": version, "skill_ref": skill_ref},
                )

    if context.available_mcp_server_ids is not None:
        for server_id in _iter_mcp_server_ids(graph):
            if server_id not in context.available_mcp_server_ids:
                raise WorkflowValidationError(
                    "WG_L4_UNKNOWN_MCP",
                    "WorkflowGraph references an unknown MCP server.",
                    details={"server_id": server_id},
                )


def _iter_model_profile_ids(graph: WorkflowGraph) -> Sequence[str]:
    model_ids = [graph.model_policy.default_model_profile_id, *graph.model_policy.escalation_chain]
    for node in graph.nodes:
        if NodeType(node.type) not in _LLM_NODE_TYPES or node.contract is None:
            continue
        contract = cast(NodeContractBase, node.contract)
        model_ids.append(contract.model_policy.primary_model_profile_id)
        model_ids.extend(contract.model_policy.escalation_chain)
    return model_ids


def _iter_skill_refs(graph: WorkflowGraph) -> Sequence[tuple[str, str, str]]:
    skill_refs: list[tuple[str, str, str]] = []
    for contract in _iter_contracts(graph):
        skill_refs.extend(
            (skill.skill_id, skill.version, f"{skill.skill_id}@{skill.version}") for skill in contract.skills
        )
    return skill_refs


def _iter_mcp_server_ids(graph: WorkflowGraph) -> Sequence[str]:
    server_ids: list[str] = []
    for contract in _iter_contracts(graph):
        server_ids.extend(tool.server_id for tool in contract.mcp_tools)
    return server_ids


def _iter_contracts(graph: WorkflowGraph) -> Sequence[NodeContractBase]:
    contracts: list[NodeContractBase] = []
    for node in graph.nodes:
        if node.contract is not None:
            contracts.append(cast(NodeContractBase, node.contract))
    return contracts


def _merge_declared_routes(graph: WorkflowGraph) -> list[EngineEdge]:
    edges = [
        EngineEdge(
            edge_id=edge.edge_id,
            source_node_id=edge.source_node_id,
            target_node_id=edge.target_node_id,
            type=edge.type,
            source="declared",
        )
        for edge in graph.edges
    ]

    for node in graph.nodes:
        if isinstance(node, EvaluationTaskNode):
            _ensure_route_edge(
                edges,
                source_node_id=node.node_id,
                target_node_id=node.on_pass_next_node_id,
                edge_type=EdgeType.PASS,
                source="evaluation_route",
                route_key="pass",
            )
            _ensure_route_edge(
                edges,
                source_node_id=node.node_id,
                target_node_id=node.on_fail_next_node_id,
                edge_type=EdgeType.FAIL,
                source="evaluation_route",
                route_key="fail",
            )
        elif isinstance(node, RepairTaskNode):
            _ensure_route_edge(
                edges,
                source_node_id=node.node_id,
                target_node_id=node.on_repair_next_node_id,
                edge_type=EdgeType.RETRY,
                source="repair_route",
                route_key="repair",
            )
        elif isinstance(node, HumanCheckpointNode):
            for decision_key, target_node_id in sorted(node.routing_map.items()):
                _ensure_route_edge(
                    edges,
                    source_node_id=node.node_id,
                    target_node_id=target_node_id,
                    edge_type=EdgeType.HUMAN,
                    source="human_route",
                    route_key=decision_key,
                    require_route_key_match=True,
                )
    return sorted(edges, key=lambda edge: (edge.source_node_id, edge.type.value, edge.route_key or "", edge.edge_id))


def _ensure_route_edge(
    edges: list[EngineEdge],
    *,
    source_node_id: str,
    target_node_id: str | None,
    edge_type: EdgeType,
    source: SyntheticEdgeSource,
    route_key: str,
    alternative_types: set[EdgeType] | None = None,
    require_route_key_match: bool = False,
) -> None:
    if target_node_id is None:
        return
    allowed_types = {edge_type}
    if alternative_types is not None:
        allowed_types.update(alternative_types)
    for index, edge in enumerate(edges):
        if (
            edge.source_node_id == source_node_id
            and edge.target_node_id == target_node_id
            and edge.type in allowed_types
        ):
            if require_route_key_match and edge.route_key != route_key and edge.route_key is not None:
                continue
            if edge.route_key is None:
                edges[index] = edge.model_copy(update={"route_key": route_key})
            return
    edges.append(
        EngineEdge(
            edge_id=f"synthetic:{source_node_id}:{route_key}:{target_node_id}",
            source_node_id=source_node_id,
            target_node_id=target_node_id,
            type=edge_type,
            source=source,
            route_key=route_key,
        )
    )


def _validate_l3_topology(graph: WorkflowGraph, edges: Sequence[EngineEdge]) -> None:
    node_ids = {node.node_id for node in graph.nodes}
    incoming = _incoming_edges(edges)
    outgoing = _outgoing_edges(edges)

    for node in graph.nodes:
        if NodeType(node.type) in {NodeType.START, NodeType.END}:
            continue
        if not incoming[node.node_id] and not outgoing[node.node_id]:
            raise WorkflowValidationError(
                "WG_L3_ORPHAN_NODE",
                "WorkflowGraph contains an orphan node.",
                details={"node_id": node.node_id},
            )

    reachable = set(_reachable_node_order(graph.entry_node_id, edges))
    unreachable = sorted(node_ids - reachable)
    if unreachable:
        raise WorkflowValidationError(
            "WG_L3_UNREACHABLE_NODE",
            "WorkflowGraph contains nodes unreachable from entry_node_id.",
            details={"node_ids": unreachable},
        )

    terminal_node_ids = set(graph.terminal_node_ids)
    for edge in edges:
        if (
            edge.type == EdgeType.FAIL
            and edge.target_node_id not in terminal_node_ids
            and not outgoing[edge.target_node_id]
        ):
            raise WorkflowValidationError(
                "WG_L3_DEAD_END_FAIL_PATH",
                "WorkflowGraph contains a fail path with no successor.",
                details={"edge_id": edge.edge_id, "target_node_id": edge.target_node_id},
            )

    _validate_cycles_are_controlled(graph, outgoing)


def _incoming_edges(edges: Sequence[EngineEdge]) -> dict[str, list[EngineEdge]]:
    incoming: dict[str, list[EngineEdge]] = defaultdict(list)
    for edge in edges:
        incoming[edge.target_node_id].append(edge)
    return incoming


def _outgoing_edges(edges: Sequence[EngineEdge]) -> dict[str, list[EngineEdge]]:
    outgoing: dict[str, list[EngineEdge]] = defaultdict(list)
    for edge in edges:
        outgoing[edge.source_node_id].append(edge)
    for edge_list in outgoing.values():
        edge_list.sort(key=lambda edge: (edge.type.value, edge.route_key or "", edge.target_node_id, edge.edge_id))
    return outgoing


def _reachable_node_order(entry_node_id: str, edges: Sequence[EngineEdge]) -> list[str]:
    outgoing = _outgoing_edges(edges)
    seen = {entry_node_id}
    order = [entry_node_id]
    queue: deque[str] = deque([entry_node_id])
    while queue:
        node_id = queue.popleft()
        for edge in outgoing[node_id]:
            if edge.target_node_id in seen:
                continue
            seen.add(edge.target_node_id)
            order.append(edge.target_node_id)
            queue.append(edge.target_node_id)
    return order


def _validate_cycles_are_controlled(
    graph: WorkflowGraph,
    outgoing: Mapping[str, Sequence[EngineEdge]],
) -> None:
    node_by_id = {node.node_id: node for node in graph.nodes}
    permanent: set[str] = set()
    temporary: list[str] = []

    def visit(node_id: str, path_edges: list[EngineEdge]) -> None:
        if node_id in permanent:
            return
        temporary.append(node_id)
        for edge in outgoing[node_id]:
            if edge.target_node_id in temporary:
                start_index = temporary.index(edge.target_node_id)
                cycle_nodes = [*temporary[start_index:], edge.target_node_id]
                cycle_edges = [*path_edges[start_index:], edge]
                _validate_cycle(cycle_nodes, cycle_edges, node_by_id)
                continue
            visit(edge.target_node_id, [*path_edges, edge])
        temporary.pop()
        permanent.add(node_id)

    visit(graph.entry_node_id, [])


def _validate_cycle(
    cycle_node_ids: Sequence[str],
    cycle_edges: Sequence[EngineEdge],
    node_by_id: Mapping[str, object],
) -> None:
    edge_types = {edge.type for edge in cycle_edges}
    if EdgeType.RETRY not in edge_types and EdgeType.LOOP not in edge_types:
        raise WorkflowValidationError(
            "WG_L3_UNCONTROLLED_LOOP",
            "WorkflowGraph contains a cycle with no retry or loop edge.",
            details={"node_ids": list(cycle_node_ids)},
        )
    for node_id in cycle_node_ids:
        node = node_by_id[node_id]
        if isinstance(node, EvaluationTaskNode) and node.max_retry >= 0:
            return
    raise WorkflowValidationError(
        "WG_L3_UNCONTROLLED_LOOP",
        "WorkflowGraph contains a cycle without an evaluation max_retry guard.",
        details={"node_ids": list(cycle_node_ids)},
    )
