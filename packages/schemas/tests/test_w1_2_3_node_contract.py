"""契约测试：cw_schemas.contract — NodeContract 6 类。

覆盖 specs/schemas/node_contract.md §13 的 NC_* 错误码：
- NC_L2_KIND_MISMATCH
- NC_L2_MISSING_PROMPT
- NC_L2_TOOL_HAS_PROMPT
- NC_L2_EVAL_NO_CRITERIA
- NC_L2_EVAL_BAD_PASS_THRESHOLD
- NC_L2_REPAIR_NO_STRATEGIES
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from cw_schemas import (
    EvaluationContract,
    EvaluationCriterion,
    ExecutionContract,
    FailCondition,
    HumanDecision,
    HumanGateContract,
    MemoryContract,
    NodeModelPolicy,
    PassCondition,
    PromptSection,
    RepairContract,
    RepairStrategy,
    RetryPolicy,
    ToolContract,
    ValidatorPolicy,
    WorkflowGraph,
)
from cw_schemas.contract.requirements import (
    ContextRequirement,
    EvidenceRequirement,
    ProjectMemorySelector,
    UpstreamArtifactSelector,
)
from cw_schemas.types import CriterionKind, FailureType, RepairKind

from .fixtures import make_minimal_graph_dict


def _assert_validation_error_contains(exc: ValidationError, code: str) -> None:
    found = any(err.get("type") == code or code in str(err) for err in exc.errors())
    assert found, f"未检测到错误码 {code}；实际错误：{exc.errors()!r}"


# =============================================================================
# happy path：6 类 contract 都可独立构造
# =============================================================================


def test_execution_contract_minimal() -> None:
    c = ExecutionContract(
        contract_id="ctr_exec_01",
        goal="生成研究问题",
        model_policy=NodeModelPolicy(primary_model_profile_id="claude-sonnet-default"),
        prompt=PromptSection(user_prompt_template="{{ deps.goal }}"),
    )
    assert c.contract_kind == "execution"


def test_evaluation_contract_minimal() -> None:
    c = EvaluationContract(
        contract_id="ctr_eval_01",
        goal="审查输出",
        model_policy=NodeModelPolicy(primary_model_profile_id="claude-sonnet-judge"),
        prompt=PromptSection(user_prompt_template="审查以下产物：{{ deps.target_output }}"),
        criteria=[
            EvaluationCriterion(
                criterion_id="c_quality",
                description="质量要求",
                kind=CriterionKind.RUBRIC,
            )
        ],
        pass_condition=PassCondition(combinator="all_pass"),
        fail_condition=FailCondition(combinator="any_pass"),
    )
    assert c.contract_kind == "evaluation"
    assert len(c.criteria) == 1


def test_repair_contract_minimal() -> None:
    c = RepairContract(
        contract_id="ctr_repair_01",
        goal="修复研究问题",
        model_policy=NodeModelPolicy(primary_model_profile_id="claude-sonnet-repair"),
        prompt=PromptSection(user_prompt_template="基于诊断 {{ deps.diagnosis }} 生成修复"),
        repair_strategies=[
            RepairStrategy(
                kind=RepairKind.PROMPT_PATCH,
                applies_to_failure_types=[FailureType.FORMAT_ERROR],
                max_uses=2,
            )
        ],
    )
    assert c.contract_kind == "repair"


def test_human_gate_contract_minimal() -> None:
    c = HumanGateContract(
        contract_id="ctr_hg_01",
        goal="确认导出报告",
        model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
        decisions=[
            HumanDecision(key="continue", label="确认导出"),
            HumanDecision(key="reject", label="取消"),
        ],
        prompt_to_user="确认是否继续？",
    )
    assert c.contract_kind == "human_gate"


def test_tool_contract_minimal() -> None:
    c = ToolContract(
        contract_id="ctr_tool_01",
        goal="调用 Python 沙箱",
        model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
        tool_id="python_sandbox",
        # 注：tool 不应有 prompt
    )
    assert c.contract_kind == "tool"
    assert c.prompt is None


def test_memory_contract_minimal() -> None:
    c = MemoryContract(
        contract_id="ctr_mem_01",
        goal="读取项目记忆",
        model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
        operation="read",
        target="project_memory",
    )
    assert c.contract_kind == "memory"


# =============================================================================
# NC_L2_* 错误码覆盖
# =============================================================================


def test_nc_l2_missing_prompt_execution() -> None:
    with pytest.raises(ValidationError) as exc_info:
        ExecutionContract(
            contract_id="ctr_no_prompt",
            goal="无 prompt",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            # prompt=None  # 默认就是 None
        )
    _assert_validation_error_contains(exc_info.value, "NC_L2_MISSING_PROMPT")


def test_nc_l2_missing_prompt_evaluation() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvaluationContract(
            contract_id="ctr_no_prompt_eval",
            goal="无 prompt",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            criteria=[EvaluationCriterion(criterion_id="c_01", description="x", kind=CriterionKind.RUBRIC)],
            pass_condition=PassCondition(combinator="all_pass"),
            fail_condition=FailCondition(combinator="any_pass"),
        )
    _assert_validation_error_contains(exc_info.value, "NC_L2_MISSING_PROMPT")


def test_nc_l2_missing_prompt_repair() -> None:
    with pytest.raises(ValidationError) as exc_info:
        RepairContract(
            contract_id="ctr_no_prompt_repair",
            goal="无 prompt",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            repair_strategies=[
                RepairStrategy(kind=RepairKind.PROMPT_PATCH, applies_to_failure_types=[FailureType.FORMAT_ERROR])
            ],
        )
    _assert_validation_error_contains(exc_info.value, "NC_L2_MISSING_PROMPT")


def test_nc_l2_tool_has_prompt() -> None:
    with pytest.raises(ValidationError) as exc_info:
        ToolContract(
            contract_id="ctr_tool_bad",
            goal="工具节点不应有 prompt",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            tool_id="python_sandbox",
            prompt=PromptSection(user_prompt_template="不应有"),
        )
    _assert_validation_error_contains(exc_info.value, "NC_L2_TOOL_HAS_PROMPT")


def test_nc_l2_memory_has_prompt() -> None:
    with pytest.raises(ValidationError):
        MemoryContract(
            contract_id="ctr_mem_bad",
            goal="memory 不应有 prompt",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            operation="read",
            target="project_memory",
            prompt=PromptSection(user_prompt_template="不应有"),
        )


def test_nc_l2_memory_value_schema_required() -> None:
    with pytest.raises(ValidationError):
        MemoryContract(
            contract_id="ctr_mem_write_no_value",
            goal="write 操作但缺 value_schema",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            operation="write",
            target="project_memory",
            # value_schema=None
        )


def test_nc_l2_eval_no_criteria() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvaluationContract(
            contract_id="ctr_eval_empty",
            goal="空 criteria",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            prompt=PromptSection(user_prompt_template="x"),
            criteria=[],  # 空
            pass_condition=PassCondition(combinator="all_pass"),
            fail_condition=FailCondition(combinator="any_pass"),
        )
    _assert_validation_error_contains(exc_info.value, "NC_L2_EVAL_NO_CRITERIA")


def test_nc_l2_eval_bad_pass_threshold() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvaluationContract(
            contract_id="ctr_eval_bad_threshold",
            goal="weighted_score 缺 threshold",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            prompt=PromptSection(user_prompt_template="x"),
            criteria=[EvaluationCriterion(criterion_id="c_01", description="x", kind=CriterionKind.RUBRIC)],
            pass_condition=PassCondition(combinator="weighted_score"),  # 缺 threshold
            fail_condition=FailCondition(combinator="any_pass"),
        )
    _assert_validation_error_contains(exc_info.value, "NC_L2_EVAL_BAD_PASS_THRESHOLD")


def test_nc_l2_repair_no_strategies() -> None:
    with pytest.raises(ValidationError) as exc_info:
        RepairContract(
            contract_id="ctr_repair_empty",
            goal="空 strategies",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            prompt=PromptSection(user_prompt_template="x"),
            repair_strategies=[],
        )
    _assert_validation_error_contains(exc_info.value, "NC_L2_REPAIR_NO_STRATEGIES")


def test_nc_l2_eval_dup_criterion_id() -> None:
    with pytest.raises(ValidationError):
        EvaluationContract(
            contract_id="ctr_eval_dup_criterion",
            goal="重复 criterion_id",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            prompt=PromptSection(user_prompt_template="x"),
            criteria=[
                EvaluationCriterion(criterion_id="c_dup", description="x", kind=CriterionKind.RUBRIC),
                EvaluationCriterion(criterion_id="c_dup", description="y", kind=CriterionKind.RUBRIC),
            ],
            pass_condition=PassCondition(combinator="all_pass"),
            fail_condition=FailCondition(combinator="any_pass"),
        )


def test_nc_l2_human_gate_invalid_decision_key() -> None:
    with pytest.raises(ValidationError):
        HumanGateContract(
            contract_id="ctr_hg_bad_key",
            goal="非法 key",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            decisions=[
                HumanDecision(key="continue"),
                HumanDecision(key="weird_key_no_prefix"),  # 非标准且无 custom_ 前缀
            ],
            prompt_to_user="x",
        )


def test_nc_l2_human_gate_missing_continue() -> None:
    with pytest.raises(ValidationError):
        HumanGateContract(
            contract_id="ctr_hg_no_continue",
            goal="无 continue",
            model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
            decisions=[HumanDecision(key="reject")],
            prompt_to_user="x",
        )


def test_human_gate_custom_prefix_ok() -> None:
    """custom_ 前缀的 key 应被接受。"""
    c = HumanGateContract(
        contract_id="ctr_hg_custom_ok",
        goal="custom decision",
        model_policy=NodeModelPolicy(primary_model_profile_id="auto"),
        decisions=[
            HumanDecision(key="continue"),
            HumanDecision(key="custom_request_more_info"),
        ],
        prompt_to_user="x",
    )
    assert any(d.key == "custom_request_more_info" for d in c.decisions)


# =============================================================================
# NodeType ↔ ContractKind 一致性（NC_L2_KIND_MISMATCH）
# =============================================================================


def test_minimal_graph_with_contracts_validates() -> None:
    """fixture 已注入 contract，应通过完整校验。"""
    g = WorkflowGraph.model_validate(make_minimal_graph_dict())
    # 5 个含 contract 的节点
    contracts = [n for n in g.nodes if n.contract is not None]
    assert len(contracts) == 4  # extract / review / repair / report

    n_extract = next(n for n in g.nodes if n.node_id == "n_extract")
    assert n_extract.contract is not None
    assert n_extract.contract.contract_kind == "execution"


def test_nc_l2_contract_required_for_execution_task() -> None:
    g = make_minimal_graph_dict()
    # 移除 n_extract 的 contract
    for n in g["nodes"]:
        if n["node_id"] == "n_extract":
            n["contract"] = None
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "NC_L2_KIND_MISMATCH")


def test_nc_l2_kind_mismatch() -> None:
    g = make_minimal_graph_dict()
    # 给 n_extract 注入 evaluation contract（kind 不匹配 execution_task）
    for n in g["nodes"]:
        if n["node_id"] == "n_extract":
            n["contract"] = {
                "contract_id": "ctr_wrong_kind",
                "contract_kind": "evaluation",
                "goal": "x",
                "model_policy": {"primary_model_profile_id": "auto"},
                "prompt": {"user_prompt_template": "x"},
                "criteria": [{"criterion_id": "c_01", "description": "x", "kind": "rubric"}],
                "pass_condition": {"combinator": "all_pass"},
                "fail_condition": {"combinator": "any_pass"},
            }
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "NC_L2_KIND_MISMATCH")


def test_start_node_with_contract_is_kind_mismatch() -> None:
    """start 节点不应有 contract。"""
    g = make_minimal_graph_dict()
    for n in g["nodes"]:
        if n["node_id"] == "n_start":
            n["contract"] = {
                "contract_id": "ctr_should_not_be",
                "contract_kind": "execution",
                "goal": "x",
                "model_policy": {"primary_model_profile_id": "auto"},
                "prompt": {"user_prompt_template": "x"},
            }
    with pytest.raises(ValidationError) as exc_info:
        WorkflowGraph.model_validate(g)
    _assert_validation_error_contains(exc_info.value, "NC_L2_KIND_MISMATCH")


# =============================================================================
# Discriminated union round trip
# =============================================================================


def test_node_contract_round_trip() -> None:
    g = WorkflowGraph.model_validate(make_minimal_graph_dict())
    raw = g.model_dump_json()
    restored = WorkflowGraph.model_validate_json(raw)
    assert restored == g


# =============================================================================
# ContextRequirement / EvidenceRequirement
# =============================================================================


def test_context_requirement_upstream_artifact() -> None:
    cr = ContextRequirement(
        key="research_summary",
        kind="upstream_artifact",
        selector=UpstreamArtifactSelector(
            from_node_id="n_extract",
            artifact_field="research_questions[*]",
        ),
        required=True,
    )
    assert cr.selector.source_kind == "upstream_artifact"


def test_context_requirement_project_memory() -> None:
    cr = ContextRequirement(
        key="project_constraints",
        kind="project_memory",
        selector=ProjectMemorySelector(memory_key="constraints"),
        required=True,
    )
    assert cr.selector.source_kind == "project_memory"


def test_evidence_requirement_minimal() -> None:
    er = EvidenceRequirement(
        required_for="research_questions[*].source_evidence_ids",
        min_coverage=1.0,
        min_evidences=1,
    )
    assert er.min_coverage == 1.0


# =============================================================================
# 配套 RetryPolicy / ValidatorPolicy 默认值
# =============================================================================


def test_retry_policy_defaults() -> None:
    rp = RetryPolicy()
    assert rp.max_attempts == 3
    assert rp.model_retries == 2
    assert rp.output_validation_retries == 2


def test_validator_policy_defaults() -> None:
    vp = ValidatorPolicy()
    assert vp.mode.value == "strict"
    assert vp.partial_output_allowed is False
