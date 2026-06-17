"""cw_schemas.events.event_types — 全部 StreamEvent.type 字符串字面量。

来源：specs/schemas/stream_event.md §2 全表。

为什么集中在此：
- 与 EventCategory 一一对应；codegen 后端可生成完整 TS union
- 所有 envelope 子类的 type 字段从此 Literal 取值
- 新增事件类型必须先改 spec → 改本表 → 走 ADR
"""

from __future__ import annotations

from typing import Literal

# ---- 1. lifecycle（10 类）----
LifecycleEventType = Literal[
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
]

# ---- 2. model（8 类）----
ModelEventType = Literal[
    "model.request_started",
    "model.thinking_delta",
    "model.thought_completed",
    "model.text_delta",
    "model.text_completed",
    "model.request_completed",
    "model.request_failed",
    "model.escalated",
]

# ---- 3. tool（6 类）----
ToolEventType = Literal[
    "tool.call_started",
    "tool.call_completed",
    "tool.call_failed",
    "tool.approval_required",
    "tool.approved",
    "tool.rejected",
]

# ---- 4. context（7 类）----
ContextEventType = Literal[
    "context.build_started",
    "context.build_completed",
    "context.compression_applied",
    "context.over_budget_failed",
    "evidence.build_completed",
    "evidence.conflict_detected",
    "evidence.feedback_written",
]

# ---- 5. evaluation（5 类）----
EvaluationEventType = Literal[
    "evaluation.started",
    "evaluation.criterion_passed",
    "evaluation.criterion_failed",
    "evaluation.completed",
    "evaluation.judge_disagreement",
]

# ---- 6. repair（6 类）----
RepairEventType = Literal[
    "repair.started",
    "repair.patch_proposed",
    "repair.patch_rejected",
    "repair.patch_applied",
    "repair.patch_reverted",
    "repair.escalation_to_human",
]

# ---- 7. human（3 类）----
HumanEventType = Literal[
    "human.gate_required",
    "human.gate_resolved",
    "human.gate_timeout",
]

# ---- 8. planning（11 类）----
PlanningEventType = Literal[
    "planning.session_started",
    "planning.phase_changed",
    "planning.context_built",
    "planning.understanding_completed",
    "planning.clarification_question",
    "planning.clarification_answered",
    "planning.draft_generated",
    "planning.draft_validation",
    "planning.draft_repaired",
    "planning.workflow_patch_proposed",
    "planning.workflow_instantiated",
]

# ---- 9. artifact（5 类）----
ArtifactEventType = Literal[
    "artifact.written",
    "artifact.deleted",
    "git.snapshot_created",
    "git.tag_created",
    "export.completed",
]

# ---- 10. metric（2 类）----
MetricEventType = Literal[
    "metric.snapshot",
    "usage.delta",
]

# ---- 11. error（3 类）----
ErrorEventType = Literal[
    "error.exception",
    "error.network",
    "error.budget_exhausted",
]

# ---- 12. system（3 类）----
SystemEventType = Literal[
    "system.runtime_ready",
    "system.heartbeat",
    "system.runtime_shutting_down",
]


__all__ = [
    "ArtifactEventType",
    "ContextEventType",
    "ErrorEventType",
    "EvaluationEventType",
    "HumanEventType",
    "LifecycleEventType",
    "MetricEventType",
    "ModelEventType",
    "PlanningEventType",
    "RepairEventType",
    "SystemEventType",
    "ToolEventType",
]
