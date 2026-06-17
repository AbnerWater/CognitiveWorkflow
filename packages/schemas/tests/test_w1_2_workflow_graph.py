"""契约测试：cw_schemas.workflow + ids + metadata + types。

覆盖 specs/schemas/workflow_graph.md §11 的 WG_* 错误码：
- WG_L2_DUP_NODE_ID
- WG_L2_DUP_EDGE_ID
- WG_L2_BAD_SCHEMA_VERSION
- WG_L2_MISSING_ENTRY_NODE
- WG_L2_MISSING_TERMINAL_NODES
- WG_L2_EVAL_MISSING_TARGET
- WG_L2_EVAL_NO_PASS_ROUTE
- WG_L2_EVAL_NO_FAIL_ROUTE
- WG_L2_EVAL_PASS_ROUTE_MISMATCH
- WG_L2_EVAL_FAIL_ROUTE_MISMATCH
- WG_L2_REPAIR_MISSING_TARGET
- WG_L2_METADATA_NOT_NAMESPACED
- WG_L3_MULTIPLE_ENTRIES
"""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from cw_schemas import (
    WorkflowGraph,
    types,
)
from cw_schemas.ids import is_draft_id, is_ulid, is_uuid_v7, is_valid_id
from cw_schemas.metadata import (
    is_valid_namespace,
    merge_metadata,
    validate_namespaced_metadata,
)

from .fixtures import make_minimal_graph_dict

# =============================================================================
# 基础类型 / 枚举（W1.2.1）
# =============================================================================


def test_failure_type_has_8_plus_unknown() -> None:
    assert len(list(types.FailureType)) == 9
    assert types.FailureType.UNKNOWN in types.FailureType


def test_severity_has_4_levels() -> None:
    assert len(list(types.Severity)) == 4
    assert {s.value for s in list(types.Severity)} == {
        "blocker",
        "major",
        "minor",
        "info",
    }


def test_node_type_has_9_kinds() -> None:
    assert len(list(types.NodeType)) == 9


def test_edge_type_has_8_kinds() -> None:
    assert len(list(types.EdgeType)) == 8


def test_run_state_has_9_states() -> None:
    assert len(list(types.RunState)) == 9


def test_node_runtime_state_has_13_states() -> None:
    # 12 个常规态 + 1 个 cancelled 状态合计 13；与 workflow_run.md §2.1 对齐
    assert len(list(types.NodeRuntimeState)) == 13


def test_planning_status_has_12_states() -> None:
    # 11 个工程态 + 1 个 collecting_input 起点 = 12（含 cancelled / failed 终态）
    assert len(list(types.PlanningStatus)) == 12


def test_event_category_has_12() -> None:
    assert len(list(types.EventCategory)) == 12


def test_repair_kind_has_6_kinds() -> None:
    assert len(list(types.RepairKind)) == 6


def test_contract_kind_has_6_kinds() -> None:
    assert len(list(types.ContractKind)) == 6


# =============================================================================
# IDs
# =============================================================================


def test_ids_ulid() -> None:
    assert is_ulid("01J9N5B5XDMV4P1ZMRE3T7K8H4")
    assert not is_ulid("not-an-ulid")
    assert not is_ulid("01J9N5B5XDMV4P1ZMRE3T7K8H4X")  # 27 位，超长


def test_ids_uuid_v7() -> None:
    assert is_uuid_v7("018f5b1c-1234-7abc-89ef-0123456789ab")
    assert not is_uuid_v7("018f5b1c-1234-4abc-89ef-0123456789ab")  # v4 不接受
    assert not is_uuid_v7("zzzzzzzz-1234-7abc-89ef-0123456789ab")


def test_ids_draft_id() -> None:
    assert is_draft_id("n_extract")
    assert is_draft_id("wf_alpha.beta-1")
    assert not is_draft_id("ab")  # 太短
    assert not is_draft_id("0invalid_first_char_digit")
    assert not is_draft_id("contains space")


def test_is_valid_id_combines_all() -> None:
    assert is_valid_id("01J9N5B5XDMV4P1ZMRE3T7K8H4")
    assert is_valid_id("018f5b1c-1234-7abc-89ef-0123456789ab")
    assert is_valid_id("n_extract")
    assert not is_valid_id("?bad?")


# =============================================================================
# Metadata 命名空间
# =============================================================================


def test_metadata_namespace_valid() -> None:
    assert is_valid_namespace("cw")
    assert is_valid_namespace("plugin_alpha")
    assert is_valid_namespace("a")  # 1 字符也合法
    assert not is_valid_namespace("Cw")  # 不允许大写
    assert not is_valid_namespace("1plugin")  # 不允许数字开头
    assert not is_valid_namespace("plugin-alpha")  # 不允许 -


def test_validate_namespaced_metadata_ok() -> None:
    md = {"cw": {"version": "0.1.0"}, "plugin_alpha": {"key": 1}}
    assert validate_namespaced_metadata(md) == []


def test_validate_namespaced_metadata_bad_namespace() -> None:
    md = {"BAD": {"x": 1}}
    violations = validate_namespaced_metadata(md)
    assert violations
    assert "BAD" in violations[0]


def test_validate_namespaced_metadata_value_must_be_dict() -> None:
    md = {"cw": "not_a_dict"}
    violations = validate_namespaced_metadata(md)
    assert violations
    assert "必须是 dict" in violations[0]


def test_merge_metadata() -> None:
    a = {"cw": {"version": "0.1.0"}}
    b = {"cw": {"version": "0.2.0", "extra": True}, "plugin_x": {"k": "v"}}
    merged = merge_metadata(a, b)
    assert merged == {
        "cw": {"version": "0.2.0", "extra": True},
        "plugin_x": {"k": "v"},
    }


# =============================================================================
# WorkflowGraph happy path
# =============================================================================


def test_minimal_graph_validates() -> None:
    g = WorkflowGraph.model_validate(make_minimal_graph_dict())
    assert g.workflow_id == "wf_minimal_01"
    assert g.entry_node_id == "n_start"
    assert g.terminal_node_ids == ["n_end"]
    assert len(g.nodes) == 6
    assert len(g.edges) == 6


def test_minimal_graph_round_trip_json() -> None:
    g = WorkflowGraph.model_validate(make_minimal_graph_dict())
    serialized = g.model_dump_json()
    restored = WorkflowGraph.model_validate_json(serialized)
    assert restored == g


def test_workflow_graph_model_json_schema_succeeds() -> None:
    schema = WorkflowGraph.model_json_schema()
    assert schema["title"] == "WorkflowGraph"
    # discriminator 在 Pydantic v2 schema 中表现为 anyOf + discriminator mapping
    serialized = json.dumps(schema)
    assert "execution_task" in serialized
    assert "evaluation_task" in serialized


# =============================================================================
# WG_L2_* 错误码覆盖
# =============================================================================


def _assert_validation_error_contains(exc: ValidationError, code: str) -> None:
    """断言 ValidationError 中至少有一条 ctx 含指定 code（PydanticCustomError 的形态）。"""
    found = False
    for err in exc.errors():
        if err.get("type") == code or code in str(err):
            found = True
            break
    assert found, f"未检测到错误码 {code}；实际错误：{exc.errors()!r}"


def test_wg_l2_dup_node_id() -> None:
    g = make_minimal_graph_dict()
    g["nodes"][1]["node_id"] = "n_start"  # 与 entry 同名
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_DUP_NODE_ID")


def test_wg_l2_dup_edge_id() -> None:
    g = make_minimal_graph_dict()
    g["edges"][1]["edge_id"] = "e_01"  # 与 edges[0] 同 ID
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_DUP_EDGE_ID")


def test_wg_l2_bad_schema_version() -> None:
    g = make_minimal_graph_dict()
    g["schema_version"] = "9.9.9"
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_BAD_SCHEMA_VERSION")


def test_wg_l2_missing_entry_node() -> None:
    g = make_minimal_graph_dict()
    g["entry_node_id"] = "n_does_not_exist"
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_MISSING_ENTRY_NODE")


def test_wg_l2_missing_entry_node_when_not_start_type() -> None:
    g = make_minimal_graph_dict()
    g["entry_node_id"] = "n_extract"  # 是 execution_task，不是 start
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_MISSING_ENTRY_NODE")


def test_wg_l2_missing_terminal_nodes() -> None:
    g = make_minimal_graph_dict()
    g["terminal_node_ids"] = ["n_extract"]  # 不是 end 节点
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_MISSING_TERMINAL_NODES")


def test_wg_l2_eval_no_pass_route() -> None:
    g = make_minimal_graph_dict()
    # 删除节点级 + pass 边
    g["nodes"][2].pop("on_pass_next_node_id", None)
    g["edges"] = [e for e in g["edges"] if e["type"] != "pass"]
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_EVAL_NO_PASS_ROUTE")


def test_wg_l2_eval_no_fail_route() -> None:
    g = make_minimal_graph_dict()
    g["nodes"][2].pop("on_fail_next_node_id", None)
    g["edges"] = [e for e in g["edges"] if e["type"] != "fail"]
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_EVAL_NO_FAIL_ROUTE")


def test_wg_l2_eval_missing_target() -> None:
    g = make_minimal_graph_dict()
    g["nodes"][2].pop("target_node_id")
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_EVAL_MISSING_TARGET")


def test_wg_l2_eval_pass_route_mismatch() -> None:
    g = make_minimal_graph_dict()
    # 节点声明 pass=n_report；改边为指向 n_repair（与节点声明冲突）
    for e in g["edges"]:
        if e["type"] == "pass":
            e["target_node_id"] = "n_repair"
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_EVAL_PASS_ROUTE_MISMATCH")


def test_wg_l2_eval_fail_route_mismatch() -> None:
    g = make_minimal_graph_dict()
    for e in g["edges"]:
        if e["type"] == "fail":
            e["target_node_id"] = "n_report"
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_EVAL_FAIL_ROUTE_MISMATCH")


def test_wg_l2_repair_missing_target() -> None:
    g = make_minimal_graph_dict()
    # 改 repair_target_node_id 为不存在的 ID
    for n in g["nodes"]:
        if n["node_id"] == "n_repair":
            n["repair_target_node_id"] = "n_does_not_exist"
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_REPAIR_MISSING_TARGET")


def test_wg_l2_metadata_not_namespaced() -> None:
    g = make_minimal_graph_dict()
    g["metadata"] = {"BadKey": {"x": 1}}  # 大写违反 namespace 规则
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L2_METADATA_NOT_NAMESPACED")


def test_wg_l3_multiple_entries() -> None:
    g = make_minimal_graph_dict()
    # 增加第二个 start 节点
    g["nodes"].append(
        {
            "node_id": "n_start_2",
            "type": "start",
            "title": "Start 2",
            "trigger": "manual",
        }
    )
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "WG_L3_MULTIPLE_ENTRIES")


# =============================================================================
# Discriminator round-trip
# =============================================================================


def test_node_discriminator_round_trip() -> None:
    """验证 8 类节点都能正确通过 discriminator 解析。"""
    g_dict = make_minimal_graph_dict()
    g = WorkflowGraph.model_validate(g_dict)

    types_seen = {n.type for n in g.nodes}
    assert types.NodeType.START in types_seen
    assert types.NodeType.END in types_seen
    assert types.NodeType.EXECUTION_TASK in types_seen
    assert types.NodeType.EVALUATION_TASK in types_seen
    assert types.NodeType.REPAIR_TASK in types_seen


def test_extra_forbid() -> None:
    """extra='forbid' 应拒绝未知字段。"""
    g = make_minimal_graph_dict()
    g["unknown_field"] = "should_fail"
    with pytest.raises(ValidationError):
        WorkflowGraph.model_validate(g)


def test_metadata_namespaced_ok() -> None:
    g = make_minimal_graph_dict()
    g["metadata"] = {"cw": {"version": "0.1.0"}, "plugin_x": {"k": "v"}}
    parsed = WorkflowGraph.model_validate(g)
    assert parsed.metadata == {
        "cw": {"version": "0.1.0"},
        "plugin_x": {"k": "v"},
    }
