"""测试 fixtures：构造 WorkflowGraph minimal 实例 + 各种"已知坏"变体。"""

from __future__ import annotations

from typing import Any

# ---- 公共 contract 子对象 ----
_DEFAULT_MODEL_POLICY: dict[str, Any] = {
    "primary_model_profile_id": "claude-sonnet-default",
}

_DEFAULT_PROMPT: dict[str, Any] = {
    "user_prompt_template": "Please process: {{ deps.input }}",
    "template_engine": "handlebars",
}

_EXECUTION_CONTRACT: dict[str, Any] = {
    "contract_id": "ctr_extract_default",
    "contract_kind": "execution",
    "goal": "执行节点示例",
    "model_policy": _DEFAULT_MODEL_POLICY,
    "prompt": _DEFAULT_PROMPT,
}

_EVALUATION_CONTRACT: dict[str, Any] = {
    "contract_id": "ctr_review_default",
    "contract_kind": "evaluation",
    "goal": "评价节点示例",
    "model_policy": _DEFAULT_MODEL_POLICY,
    "prompt": _DEFAULT_PROMPT,
    "criteria": [
        {
            "criterion_id": "c_01_quality",
            "description": "输出必须满足质量要求",
            "kind": "rubric",
            "severity": "blocker",
            "weight": 1.0,
        }
    ],
    "pass_condition": {"combinator": "all_pass", "must_pass_blockers": True},
    "fail_condition": {"combinator": "any_pass", "must_pass_blockers": True},
}

_REPAIR_CONTRACT: dict[str, Any] = {
    "contract_id": "ctr_repair_default",
    "contract_kind": "repair",
    "goal": "修复节点示例",
    "model_policy": _DEFAULT_MODEL_POLICY,
    "prompt": _DEFAULT_PROMPT,
    "repair_strategies": [
        {"kind": "prompt_patch", "applies_to_failure_types": ["format_error", "missing_output"], "max_uses": 2}
    ],
}


# 一个最小可通过的 WorkflowGraph 字典（含 start → execution → evaluation → end + repair 回流）
MINIMAL_GRAPH_DICT: dict[str, Any] = {
    "workflow_id": "wf_minimal_01",
    "version": "0.1.0",
    "schema_version": "0.1.0",
    "title": "Minimal Workflow for tests",
    "description": "最小可执行 Workflow",
    "nodes": [
        {"node_id": "n_start", "type": "start", "title": "开始", "trigger": "manual"},
        {
            "node_id": "n_extract",
            "type": "execution_task",
            "title": "提取研究问题",
            "contract": _EXECUTION_CONTRACT,
        },
        {
            "node_id": "n_review",
            "type": "evaluation_task",
            "title": "问题质量审查",
            "target_node_id": "n_extract",
            "on_pass_next_node_id": "n_report",
            "on_fail_next_node_id": "n_repair",
            "max_retry": 2,
            "contract": _EVALUATION_CONTRACT,
        },
        {
            "node_id": "n_repair",
            "type": "repair_task",
            "title": "修复研究问题",
            "repair_target_node_id": "n_extract",
            "failure_input_ref": "$last_evaluation",
            "on_repair_next_node_id": "n_extract",
            "contract": _REPAIR_CONTRACT,
        },
        {
            "node_id": "n_report",
            "type": "execution_task",
            "title": "撰写报告",
            "contract": _EXECUTION_CONTRACT,
        },
        {
            "node_id": "n_end",
            "type": "end",
            "title": "完成",
            "archive_actions": [{"kind": "export_markdown", "to": "outputs/report.md"}],
        },
    ],
    "edges": [
        {"edge_id": "e_01", "source_node_id": "n_start", "target_node_id": "n_extract", "type": "normal"},
        {"edge_id": "e_02", "source_node_id": "n_extract", "target_node_id": "n_review", "type": "normal"},
        {"edge_id": "e_03", "source_node_id": "n_review", "target_node_id": "n_report", "type": "pass"},
        {"edge_id": "e_04", "source_node_id": "n_review", "target_node_id": "n_repair", "type": "fail"},
        {"edge_id": "e_05", "source_node_id": "n_repair", "target_node_id": "n_extract", "type": "retry"},
        {"edge_id": "e_06", "source_node_id": "n_report", "target_node_id": "n_end", "type": "normal"},
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
    "created_at": "2026-06-15T08:00:00Z",
    "last_modified_at": "2026-06-15T08:30:00Z",
    "metadata": {},
}


def make_minimal_graph_dict() -> dict[str, Any]:
    """返回一个深拷贝的 minimal graph dict，便于 mutate。"""
    import copy

    return copy.deepcopy(MINIMAL_GRAPH_DICT)
