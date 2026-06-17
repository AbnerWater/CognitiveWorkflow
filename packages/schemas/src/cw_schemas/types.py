"""cw_schemas.types — CW 全局基础类型与枚举。

汇总所有 spec 中频繁出现的枚举与类型别名，避免散落在各模型内部。

来源 spec：
- failure_taxonomy.md §1（FailureType）/ §8（Severity）
- workflow_graph.md §2.2（NodeType）/ §3.2（EdgeType）
- node_contract.md §1.1（ContractKind）
- repair_patch.md §2（RepairKind）
- agent_adapter.md §2（ProviderKind / AdapterKind）
- model_router.md §3.2（ReasoningRequired / ContextRequired / 等）
- evaluation_result.md（CriterionKind / ArbitrationMode）
- planning_session.md §1.1（PlanningStatus）
- workflow_run.md §1.1 + §2.1（RunState / NodeState）
- stream_event.md §1.2 + §1.3（EventCategory / EventPhase / DisplayLevel / Sensitivity）
- agent_adapter.md（AttemptState / ResumptionKind / AdapterErrorKind）

约束：
- 全部使用 StrEnum；不允许 Literal[...] 散落在各模型
- 枚举值字符串必须与 spec 中字段表的写法**完全一致**（连大小写、下划线都不允许偏离）
- 新增枚举值必须先改对应 spec
"""

from __future__ import annotations

from enum import StrEnum

# =============================================================================
# Failure / Severity（来自 failure_taxonomy.md）
# =============================================================================


class FailureType(StrEnum):
    """8+1 类失败分类（D-FT-1 锁定，不允许扩充至 v0.2）。"""

    FORMAT_ERROR = "format_error"
    MISSING_OUTPUT = "missing_output"
    MISSING_EVIDENCE = "missing_evidence"
    LOGIC_GAP = "logic_gap"
    MODEL_CAPABILITY_LIMIT = "model_capability_limit"
    TOOL_ERROR = "tool_error"
    AMBIGUOUS_REQUIREMENT = "ambiguous_requirement"
    REVIEW_RULE_TOO_STRICT = "review_rule_too_strict"
    UNKNOWN = "unknown"


class Severity(StrEnum):
    """4 级严重度（failure_taxonomy.md §8）。"""

    BLOCKER = "blocker"
    MAJOR = "major"
    MINOR = "minor"
    INFO = "info"


# =============================================================================
# WorkflowGraph 节点 / 边类型（来自 workflow_graph.md §2.2 / §3.2）
# =============================================================================


class NodeType(StrEnum):
    """8 类 WorkflowNode。MVP=start/end/execution_task/evaluation_task；其他视 Phase 启用。"""

    START = "start"
    END = "end"
    EXECUTION_TASK = "execution_task"
    EVALUATION_TASK = "evaluation_task"
    REPAIR_TASK = "repair_task"
    HUMAN_CHECKPOINT = "human_checkpoint"
    TOOL_TASK = "tool_task"
    MEMORY_TASK = "memory_task"
    SUBFLOW = "subflow"


class EdgeType(StrEnum):
    """8 类 WorkflowEdge。"""

    NORMAL = "normal"
    PASS = "pass"
    FAIL = "fail"
    RETRY = "retry"
    REPAIR = "repair"
    HUMAN = "human"
    OPTIONAL = "optional"
    LOOP = "loop"


class ExecutionMode(StrEnum):
    """ExecutionPolicy.mode；与 UIUX FR-007 三种模式对齐。"""

    STEP = "step"
    SEMI_AUTO = "semi_auto"
    AUTO = "auto"


class OnNodeFailure(StrEnum):
    """ExecutionPolicy.on_node_failure。"""

    STOP = "stop"
    CONTINUE_SAFE_BRANCHES = "continue_safe_branches"
    HUMAN = "human"


class CreatedBy(StrEnum):
    """WorkflowGraph.created_by。"""

    AI_PLANNING = "ai_planning"
    MANUAL_EDITOR = "manual_editor"
    HYBRID = "hybrid"
    TEMPLATE = "template"
    IMPORTED = "imported"


class StartTrigger(StrEnum):
    """start 节点 trigger。Phase 1 仅允许 manual。"""

    MANUAL = "manual"
    SCHEDULED = "scheduled"
    EVENT = "event"


# =============================================================================
# NodeContract（来自 node_contract.md §1.1）
# =============================================================================


class ContractKind(StrEnum):
    """NodeContract.contract_kind；与 NodeType 一一对应。"""

    EXECUTION = "execution"
    EVALUATION = "evaluation"
    REPAIR = "repair"
    HUMAN_GATE = "human_gate"
    TOOL = "tool"
    MEMORY = "memory"


class TemplateEngine(StrEnum):
    """PromptSection.template_engine（D-NC-1 默认 handlebars）。"""

    HANDLEBARS = "handlebars"
    JINJA2_MINIMAL = "jinja2_minimal"
    NONE = "none"


class ValidatorMode(StrEnum):
    """ValidatorPolicy.mode。"""

    STRICT = "strict"
    LENIENT = "lenient"
    PROGRAMMATIC_ONLY = "programmatic_only"


class BackoffStrategy(StrEnum):
    """RetryPolicy.backoff。"""

    NONE = "none"
    LINEAR = "linear"
    EXPONENTIAL = "exponential"


class ArbitrationMode(StrEnum):
    """EvaluationContract.arbitration（架构 §9 多 Agent 辩论 / D-ER-6）。"""

    SINGLE_JUDGE = "single_judge"
    MULTI_JUDGE = "multi_judge"
    PROGRAMMATIC_FIRST = "programmatic_first"


class CriterionKind(StrEnum):
    """EvaluationCriterion.kind。"""

    RUBRIC = "rubric"
    PROGRAMMATIC = "programmatic"
    REGEX = "regex"
    SCHEMA = "schema"
    CITATION = "citation"
    NUMERIC_THRESHOLD = "numeric_threshold"


class HumanDecisionKey(StrEnum):
    """HumanDecision 标准枚举；自定义以 `custom_` 前缀。"""

    CONTINUE = "continue"
    REJECT = "reject"
    EDIT = "edit"
    ESCALATE = "escalate"


class TimeoutAction(StrEnum):
    """human_gate.timeout_action / WorkflowEdge human."""

    HOLD = "hold"
    FALLBACK = "fallback"
    ABORT = "abort"


# =============================================================================
# RepairPatch（来自 repair_patch.md §1.1 / §2）
# =============================================================================


class RepairKind(StrEnum):
    """6 类 patch_kind（D-RP-1 锁定）。"""

    PROMPT_PATCH = "prompt_patch"
    CONTEXT_PATCH = "context_patch"
    EVIDENCE_PATCH = "evidence_patch"
    MODEL_ESCALATION = "model_escalation"
    WORKFLOW_PATCH = "workflow_patch"
    HUMAN_CHECKPOINT = "human_checkpoint"


class PatchScope(StrEnum):
    """RepairPatch.scope。"""

    THIS_ATTEMPT_ONLY = "this_attempt_only"
    UNTIL_PASS = "until_pass"
    PERSISTENT_FOR_RUN = "persistent_for_run"
    PERSISTENT_FOR_WORKFLOW = "persistent_for_workflow"


class RiskLevel(StrEnum):
    """RepairPatch.risk_level + node_contract.NodeCapabilityRequirement.risk_level。"""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ReversalMode(StrEnum):
    """RepairPatch.reversal_hint.mode。"""

    AUTO = "auto"
    EXPLICIT = "explicit"
    NON_REVERSIBLE = "non_reversible"


# =============================================================================
# Adapter / Provider（来自 agent_adapter.md §2 + model_router.md §1.1）
# =============================================================================


class AdapterKind(StrEnum):
    """AdapterCapabilities.kinds。"""

    CHAT = "chat"
    CODING_AGENT = "coding_agent"
    AUTONOMOUS_AGENT = "autonomous_agent"
    HOSTED_WORKFLOW = "hosted_workflow"
    MODEL_ONLY = "model_only"


class ProviderKind(StrEnum):
    """ModelProfile.provider_kind / AdapterCapabilities.provider_kinds。"""

    CLOUD = "cloud"
    PRIVATE = "private"
    LOCAL = "local"


class AttemptState(StrEnum):
    """AgentAdapter.AttemptState（agent_adapter.md §4.1）。"""

    PREPARED = "prepared"
    RUNNING = "running"
    AWAITING_HUMAN = "awaiting_human"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ResumptionKind(StrEnum):
    """AttemptResumption.kind。"""

    DEFERRED_TOOL = "deferred_tool"
    HUMAN_DECISION = "human_decision"
    USER_EDIT = "user_edit"
    TIMEOUT_FALLBACK = "timeout_fallback"


class AdapterErrorKind(StrEnum):
    """AdapterError.error_kind。"""

    PREPARE_FAILED = "prepare_failed"
    INVALID_PACK = "invalid_pack"
    MODEL_REQUEST_FAILED = "model_request_failed"
    TOOL_FAILED = "tool_failed"
    MCP_TRANSPORT = "mcp_transport"
    APPROVAL_REQUIRED = "approval_required"
    DEFERRED_TOOL = "deferred_tool"
    OUTPUT_VALIDATION = "output_validation"
    RETRY_LIMIT_REACHED = "retry_limit_reached"
    USAGE_LIMIT_EXCEEDED = "usage_limit_exceeded"
    PROVIDER_FORBIDDEN = "provider_forbidden"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"
    ADAPTER_INTERNAL = "adapter_internal"


class CancelReason(StrEnum):
    """AgentAdapter.cancel reason。"""

    USER = "user"
    SYSTEM = "system"
    IDLE_TIMEOUT = "idle_timeout"
    INTERNAL = "internal"


# =============================================================================
# WorkflowRun / Node 状态机（来自 workflow_run.md §1.1 / §2.1）
# =============================================================================


class RunState(StrEnum):
    """WorkflowRun 9 状态（D-WR-1 锁定）。"""

    CREATED = "created"
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    WAITING_USER = "waiting_user"
    REPAIRING = "repairing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class NodeRuntimeState(StrEnum):
    """Node 12 状态（D-WR-2 锁定）。"""

    IDLE = "idle"
    READY = "ready"
    RUNNING = "running"
    VALIDATING = "validating"
    REVIEWING = "reviewing"
    PASSED = "passed"
    REVIEW_FAILED = "review_failed"
    REPAIRING = "repairing"
    RETRYING = "retrying"
    WAITING_USER = "waiting_user"
    SKIPPED = "skipped"
    FAILED = "failed"
    CANCELLED = "cancelled"


# =============================================================================
# PlanningSession（来自 state_machines/planning_session.md §1.1）
# =============================================================================


class PlanningStatus(StrEnum):
    """PlanningSession 11 状态（D-PS-1 锁定）。"""

    COLLECTING_INPUT = "collecting_input"
    EXPLORING = "exploring"
    UNDERSTANDING = "understanding"
    CLARIFYING = "clarifying"
    PLANNING = "planning"
    VALIDATING = "validating"
    PREVIEWING = "previewing"
    REVISING = "revising"
    HANDOFF_TO_MANUAL_EDITOR = "handoff_to_manual_editor"
    CREATED = "created"
    CANCELLED = "cancelled"
    FAILED = "failed"


# =============================================================================
# StreamEvent（来自 stream_event.md §1.2 / §1.3）
# =============================================================================


class EventCategory(StrEnum):
    """12 大类（stream_event.md §1.2）。"""

    LIFECYCLE = "lifecycle"
    MODEL = "model"
    TOOL = "tool"
    EVALUATION = "evaluation"
    REPAIR = "repair"
    HUMAN = "human"
    CONTEXT = "context"
    PLANNING = "planning"
    ARTIFACT = "artifact"
    METRIC = "metric"
    ERROR = "error"
    SYSTEM = "system"


class EventPhase(StrEnum):
    """StreamEvent.phase（stream_event.md §1.3）。"""

    RUN_CREATED = "run.created"
    RUN_STARTED = "run.started"
    RUN_PAUSED = "run.paused"
    RUN_RESUMED = "run.resumed"
    RUN_COMPLETED = "run.completed"
    RUN_FAILED = "run.failed"
    RUN_CANCELLED = "run.cancelled"
    NODE_IDLE = "node.idle"
    NODE_READY = "node.ready"
    NODE_RUNNING = "node.running"
    NODE_VALIDATING = "node.validating"
    NODE_REVIEWING = "node.reviewing"
    NODE_PASSED = "node.passed"
    NODE_REVIEW_FAILED = "node.review_failed"
    NODE_REPAIRING = "node.repairing"
    NODE_RETRYING = "node.retrying"
    NODE_WAITING_USER = "node.waiting_user"
    NODE_SKIPPED = "node.skipped"
    NODE_FAILED = "node.failed"
    ATTEMPT_STARTED = "attempt.started"
    ATTEMPT_STREAMING = "attempt.streaming"
    ATTEMPT_TOOL_CALLING = "attempt.tool_calling"
    ATTEMPT_VALIDATING = "attempt.validating"
    ATTEMPT_COMPLETED = "attempt.completed"
    ATTEMPT_FAILED = "attempt.failed"
    PLANNING_EXPLORING = "planning.exploring"
    PLANNING_UNDERSTANDING = "planning.understanding"
    PLANNING_CLARIFYING = "planning.clarifying"
    PLANNING_PLANNING = "planning.planning"
    PLANNING_VALIDATING = "planning.validating"
    PLANNING_PREVIEWING = "planning.previewing"
    PLANNING_REVISING = "planning.revising"
    PLANNING_CREATED = "planning.created"


class DisplayLevel(StrEnum):
    """UI 折叠分级。"""

    MINIMAL = "minimal"
    DEFAULT = "default"
    DETAILED = "detailed"


class StreamSeverity(StrEnum):
    """StreamEvent.severity（与 EvaluationCriterion.severity 不同的语义；这里偏配色）。"""

    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"
    FATAL = "fatal"


class Sensitivity(StrEnum):
    """三级隐私分级（D-SE-5 / D-RH-3）。"""

    PUBLIC = "public"
    PROJECT = "project"
    SENSITIVE = "sensitive"


# =============================================================================
# 通用：Priority / EvidencePolarity / ConflictKind 等
# =============================================================================


class Priority(StrEnum):
    """ContextFragment.priority / Evidence.priority。"""

    CRITICAL = "critical"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class SupportPolarity(StrEnum):
    """Evidence.support_polarity。"""

    SUPPORTS = "supports"
    REFUTES = "refutes"
    CONTEXTUAL = "contextual"
    UNCLEAR = "unclear"


class EvidenceConflictKind(StrEnum):
    """EvidenceConflict.kind。"""

    CONTRADICTION = "contradiction"
    NUMERIC_DISAGREEMENT = "numeric_disagreement"
    SCOPE_MISMATCH = "scope_mismatch"
    TEMPORAL_MISMATCH = "temporal_mismatch"
    SOURCE_CREDIBILITY_GAP = "source_credibility_gap"


class CompressionAction(StrEnum):
    """CompressionLogEntry.action（context_pack.md §4.4）。"""

    DROPPED = "dropped"
    SUMMARIZED = "summarized"
    TRUNCATED = "truncated"
    QUOTE_EXTRACTED = "quote_extracted"
    MERGED = "merged"


__all__ = [
    "AdapterErrorKind",
    "AdapterKind",
    "ArbitrationMode",
    "AttemptState",
    "BackoffStrategy",
    "CancelReason",
    "CompressionAction",
    "ContractKind",
    "CreatedBy",
    "CriterionKind",
    "DisplayLevel",
    "EdgeType",
    "EventCategory",
    "EventPhase",
    "EvidenceConflictKind",
    "ExecutionMode",
    "FailureType",
    "HumanDecisionKey",
    "NodeRuntimeState",
    "NodeType",
    "OnNodeFailure",
    "PatchScope",
    "PlanningStatus",
    "Priority",
    "ProviderKind",
    "RepairKind",
    "ResumptionKind",
    "ReversalMode",
    "RiskLevel",
    "RunState",
    "Sensitivity",
    "Severity",
    "StartTrigger",
    "StreamSeverity",
    "SupportPolarity",
    "TemplateEngine",
    "TimeoutAction",
    "ValidatorMode",
]
