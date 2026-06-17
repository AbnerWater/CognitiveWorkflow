"""Project-scoped ReflectionMemory v0 store and lookup.

This module implements the Phase 1 subset from
``specs/protocols/reflection_memory.md``: project-local structured entries,
runtime.lock guarded JSONL append-or-update, deterministic signature de-dup,
and simple topic-key lookup. It deliberately does not enable global scope or
encrypted sensitive persistence yet; sensitive entries are blocked before the
plain JSONL boundary.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Annotated, Any, Final, Literal, Self, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from cw_runtime.harness.project import AGENT_WORKFLOW_DIR, acquire_runtime_lock
from cw_runtime.settings import RUNTIME_SCHEMA_VERSION
from cw_schemas.runtime import EvaluationResult, NodeAttempt, RepairPatch

ReflectionKind = Literal[
    "failure_pattern",
    "patch_pattern",
    "prompt_pattern",
    "evidence_pattern",
    "node_template_seed",
    "model_performance_signal",
]
ReflectionScope = Literal["project", "global"]
ReflectionLookupScope = Literal["project", "project+global"]
RecommendedPatchScope = Literal["this_attempt_only", "until_pass", "persistent_for_run"]

REFLECTION_MEMORY_RELATIVE_PATH: Final = Path(AGENT_WORKFLOW_DIR) / "reflection_memory.jsonl"
_CROCKFORD_ALPHABET: Final = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_SECRET_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"sk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"sk-proj-[A-Za-z0-9_-]{12,}"),
    re.compile(r"(?i)\b(anthropic_api_key|openai_api_key|aws_secret_access_key|google_api_key)\b"),
)
_EMAIL_RE: Final = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])")
_PHONE_RE: Final = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)")
_NATIONAL_ID_RE: Final = re.compile(r"(?<!\d)\d{15}(?:\d{2}[\dXx])?(?!\d)")
_ISO_TIMESTAMP_FULL_RE: Final = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$")


class ReflectionMemoryError(RuntimeError):
    """Raised when ReflectionMemory violates its protocol boundary."""

    def __init__(
        self,
        error_code: str,
        message: str,
        *,
        status_code: int = 409,
        details: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.status_code = status_code
        self.details = {} if details is None else dict(details)


class FindingSummary(BaseModel):
    """PII-safe finding projection stored in failure patterns."""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1)
    path: str | None = None
    severity: str = Field(min_length=1)


class FailurePatternContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["failure_pattern"] = "failure_pattern"
    node_type: str = Field(min_length=1)
    failure_type: str = Field(min_length=1)
    severity: Literal["blocker", "major", "minor", "info"]
    signature: str = Field(min_length=1)
    typical_findings: list[FindingSummary] = Field(default_factory=list)
    domain_hints: list[str] = Field(default_factory=list)


class PatchPatternContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["patch_pattern"] = "patch_pattern"
    addresses_failure_type: str = Field(min_length=1)
    node_type: str = Field(min_length=1)
    patch_kind: str = Field(min_length=1)
    operations_signature: str = Field(min_length=1)
    operations_summary: str = Field(min_length=1, max_length=2000)
    before_after_metrics: dict[str, float | int] | None = None
    recommended_scope: RecommendedPatchScope


class PromptPatternContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["prompt_pattern"] = "prompt_pattern"
    node_type: str = Field(min_length=1)
    addresses_failure_types: list[str] = Field(min_length=1)
    pattern_text: str = Field(min_length=1)
    pattern_kind: Literal[
        "append_to_system",
        "append_to_instructions",
        "append_to_user_prompt",
        "add_few_shot",
        "add_format_hint",
    ]
    replaces_node_id: str | None = None


class EvidencePatternContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["evidence_pattern"] = "evidence_pattern"
    node_type: str = Field(min_length=1)
    topic_set: list[str] = Field(min_length=1)
    relevance_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    chunk_strategy: dict[str, int] | None = None


class NodeTemplateSeedContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["node_template_seed"] = "node_template_seed"
    node_type: str = Field(min_length=1)
    goal_pattern: str = Field(min_length=1)
    output_schema_signature: str = Field(min_length=1)
    recommended_contract_partial: dict[str, Any]
    seed_origin_workflow_id: str | None = None


class ModelPerformanceSignalContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["model_performance_signal"] = "model_performance_signal"
    model_profile_id: str = Field(min_length=1)
    node_type: str = Field(min_length=1)
    domain: str | None = None
    pass_rate_window: float = Field(ge=0.0, le=1.0)
    avg_attempts_window: float = Field(ge=0.0)
    common_failure_types: list[str] = Field(default_factory=list)
    evidence_window_size: int = Field(ge=1)


ReflectionContent = Annotated[
    FailurePatternContent
    | PatchPatternContent
    | PromptPatternContent
    | EvidencePatternContent
    | NodeTemplateSeedContent
    | ModelPerformanceSignalContent,
    Field(discriminator="kind"),
]


class EvaluationOrigin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin_kind: Literal["evaluation"] = "evaluation"
    evaluation_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)
    attempt_id: str = Field(min_length=1)


class RepairOrigin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin_kind: Literal["repair"] = "repair"
    patch_id: str = Field(min_length=1)
    evaluation_id: str = Field(min_length=1)
    retried_attempt_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)


class AttemptCompletionOrigin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin_kind: Literal["attempt_completed"] = "attempt_completed"
    attempt_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)


class PlanningSessionOrigin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin_kind: Literal["planning_session"] = "planning_session"
    session_id: str = Field(min_length=1)
    draft_id: str = Field(min_length=1)


class HumanCorrectionOrigin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin_kind: Literal["human"] = "human"
    decision_record_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)


class AggregateOrigin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin_kind: Literal["aggregate"] = "aggregate"
    source_memory_ids: list[str] = Field(min_length=1)


OriginRefs = Annotated[
    EvaluationOrigin
    | RepairOrigin
    | AttemptCompletionOrigin
    | PlanningSessionOrigin
    | HumanCorrectionOrigin
    | AggregateOrigin,
    Field(discriminator="origin_kind"),
]


class ReflectionMemoryEntry(BaseModel):
    """One project ReflectionMemory entry."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    memory_id: str = Field(min_length=1)
    schema_version: Literal["0.1.0"] = RUNTIME_SCHEMA_VERSION
    kind: ReflectionKind
    scope: ReflectionScope
    topic_keys: list[str] = Field(min_length=1)
    summary: str = Field(min_length=1, max_length=500)
    content: ReflectionContent
    origin_refs: OriginRefs
    sample_count: int = Field(ge=1)
    success_count: int = Field(ge=0)
    failure_count: int = Field(default=0, ge=0)
    last_seen_at: str = Field(min_length=1)
    first_seen_at: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    sensitive: bool
    disabled: bool = False
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_invariants(self) -> Self:
        if self.kind != self.content.kind:
            raise ValueError("ReflectionMemoryEntry.kind must match content.kind")
        if self.sample_count < self.success_count + self.failure_count:
            raise ValueError("sample_count must be >= success_count + failure_count")
        object.__setattr__(self, "topic_keys", sorted(set(self.topic_keys)))
        object.__setattr__(self, "tags", sorted(set(self.tags)))
        return self


class ReflectionLookupRequest(BaseModel):
    """Project ReflectionMemory lookup request from reflection_memory.md §5.1."""

    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(min_length=1)
    contract_kind: str = Field(min_length=1)
    node_type: str = Field(min_length=1)
    failure_type_hint: str | None = None
    domain_signals: list[str] = Field(default_factory=list)
    top_k_per_kind: int = Field(default=3, ge=1, le=20)
    include_kinds: set[ReflectionKind] | None = None
    confidence_min: float = Field(default=0.5, ge=0.0, le=1.0)
    sample_count_min: int = Field(default=2, ge=1)
    scope: ReflectionLookupScope = "project"


class ReflectionLookupResult(BaseModel):
    """Project ReflectionMemory lookup result from reflection_memory.md §5.2."""

    model_config = ConfigDict(extra="forbid")

    entries_by_kind: dict[ReflectionKind, list[ReflectionMemoryEntry]]
    total_count: int = Field(ge=0)
    query_hash: str = Field(min_length=1)


def load_reflection_memory_entries(project_root: Path) -> list[ReflectionMemoryEntry]:
    """Load effective non-tombstoned project ReflectionMemory entries."""

    effective: dict[str, ReflectionMemoryEntry] = {}
    for raw in _read_jsonl_objects(_memory_path(project_root)):
        if raw.get("_tombstone") is True:
            continue
        entry = _validate_entry(raw)
        effective[reflection_signature(entry)] = entry
    return list(effective.values())


def lookup_reflection_memory(project_root: Path, request: ReflectionLookupRequest) -> ReflectionLookupResult:
    """Run the Phase 1 topic-key lookup algorithm."""

    if request.scope != "project":
        raise ReflectionMemoryError(
            "RM_GLOBAL_SCOPE_NOT_ENABLED",
            "ReflectionMemory global scope is not enabled in Phase 1.",
            details={"scope": request.scope},
        )
    candidate_keys = _candidate_topic_keys(request)
    include_kinds = request.include_kinds
    candidates: list[ReflectionMemoryEntry] = []
    for entry in load_reflection_memory_entries(project_root):
        if entry.disabled:
            continue
        if include_kinds is not None and entry.kind not in include_kinds:
            continue
        if entry.confidence < request.confidence_min or entry.sample_count < request.sample_count_min:
            continue
        if candidate_keys.isdisjoint(entry.topic_keys):
            continue
        candidates.append(entry)

    candidates.sort(key=lambda entry: entry.memory_id)
    candidates.sort(key=lambda entry: (entry.confidence, entry.sample_count, entry.last_seen_at), reverse=True)
    grouped: dict[ReflectionKind, list[ReflectionMemoryEntry]] = {}
    for entry in candidates:
        bucket = grouped.setdefault(entry.kind, [])
        if len(bucket) < request.top_k_per_kind:
            bucket.append(entry)
    total_count = sum(len(entries) for entries in grouped.values())
    return ReflectionLookupResult(
        entries_by_kind=grouped,
        total_count=total_count,
        query_hash=_lookup_hash(request),
    )


def append_or_update_reflection_entry(project_root: Path, entry: ReflectionMemoryEntry) -> ReflectionMemoryEntry:
    """Acquire runtime.lock and append-or-update one non-sensitive project entry."""

    with acquire_runtime_lock(project_root):
        updated = append_or_update_reflection_entry_locked(project_root, entry)
    if updated is None:
        raise ReflectionMemoryError(
            "RM_WRITE_DEDUP_RACE",
            "ReflectionMemory update unexpectedly skipped.",
            status_code=500,
            details={"memory_id": entry.memory_id},
        )
    return updated


def append_or_update_reflection_entry_locked(
    project_root: Path,
    entry: ReflectionMemoryEntry,
    *,
    create_if_missing: bool = True,
) -> ReflectionMemoryEntry | None:
    """Append or update one entry while the caller holds ``runtime.lock``."""

    prepared = _prepare_plain_entry(entry)
    path = _memory_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    signature = reflection_signature(prepared)
    now = prepared.last_seen_at
    output_lines: list[dict[str, Any]] = []
    existing: ReflectionMemoryEntry | None = None
    for raw in _read_jsonl_objects(path):
        if raw.get("_tombstone") is True:
            output_lines.append(raw)
            continue
        loaded = _validate_entry(raw)
        if reflection_signature(loaded) == signature:
            existing = loaded
            tombstone = dict(raw)
            tombstone["_tombstone"] = True
            tombstone["_tombstoned_at"] = now
            output_lines.append(tombstone)
        else:
            output_lines.append(raw)

    if existing is None and not create_if_missing:
        return None
    next_entry = prepared if existing is None else _merge_entry(existing, prepared)
    output_lines.append(next_entry.model_dump(mode="json"))
    _write_jsonl_objects(path, output_lines)
    return next_entry


def record_evaluation_reflections_locked(
    project_root: Path,
    evaluation: EvaluationResult,
    *,
    target_node_type: str,
    evaluator_node_type: str,
    domain_signals: Sequence[str] = (),
) -> list[ReflectionMemoryEntry]:
    """Write ReflectionMemory entries derived from a completed evaluation."""

    written: list[ReflectionMemoryEntry] = []
    if not evaluation.passed and evaluation.failure_diagnosis is not None:
        failure_entry = _failure_pattern_from_evaluation(evaluation, target_node_type, domain_signals)
        updated = append_or_update_reflection_entry_locked(project_root, failure_entry)
        if updated is not None:
            written.append(updated)

    performance_entry = _model_performance_signal_from_evaluation(evaluation, evaluator_node_type, domain_signals)
    updated_performance = append_or_update_reflection_entry_locked(project_root, performance_entry)
    if updated_performance is not None:
        written.append(updated_performance)

    patch_entry = _patch_pattern_from_verified_attempt(project_root, evaluation, target_node_type)
    if patch_entry is not None:
        updated_patch = append_or_update_reflection_entry_locked(
            project_root,
            patch_entry,
            create_if_missing=evaluation.passed,
        )
        if updated_patch is not None:
            written.append(updated_patch)
    return written


def reflection_signature(entry: ReflectionMemoryEntry) -> str:
    """Return the spec-defined stable signature for de-duplication."""

    content = entry.content
    if isinstance(content, FailurePatternContent):
        payload: object = (
            content.node_type,
            content.failure_type,
            sorted(f"{finding.kind}:{finding.path or ''}" for finding in content.typical_findings),
        )
    elif isinstance(content, PatchPatternContent):
        payload = (
            content.addresses_failure_type,
            content.node_type,
            content.patch_kind,
            content.operations_signature,
        )
    elif isinstance(content, PromptPatternContent):
        payload = (
            content.node_type,
            sorted(content.addresses_failure_types),
            content.pattern_kind,
            _normalize_pattern_text(content.pattern_text),
        )
    elif isinstance(content, EvidencePatternContent):
        payload = (
            content.node_type,
            sorted(content.topic_set),
            _bucketize(content.relevance_threshold),
            _bucketize(content.confidence_threshold),
        )
    elif isinstance(content, NodeTemplateSeedContent):
        payload = (
            content.node_type,
            _stable_hash(content.goal_pattern),
            _stable_hash(content.output_schema_signature),
        )
    else:
        payload = (content.model_profile_id, content.node_type, content.domain)
    return f"{entry.kind}:{_stable_hash(payload)[:24]}"


def render_reflection_instruction(entry: ReflectionMemoryEntry) -> str:
    """Render an instruction_addendum text for ContextPack injection."""

    if isinstance(entry.content, PatchPatternContent):
        return (
            f"提示：以往同类节点成功 {entry.success_count} 次的修复模式建议：{entry.summary}\n"
            f"关键操作：{entry.content.operations_summary}"
        )
    if isinstance(entry.content, PromptPatternContent):
        return f"提示：以往同类节点成功 {entry.success_count} 次的提示词模式建议：{entry.summary}"
    return f"提示：以往同类节点经验：{entry.summary}"


def _failure_pattern_from_evaluation(
    evaluation: EvaluationResult,
    target_node_type: str,
    domain_signals: Sequence[str],
) -> ReflectionMemoryEntry:
    diagnosis = evaluation.failure_diagnosis
    if diagnosis is None:
        raise ReflectionMemoryError(
            "RM_WRITE_NO_ORIGIN",
            "Failed evaluation reflection requires failure_diagnosis.",
            details={"eval_id": evaluation.eval_id},
        )
    findings = [
        FindingSummary(kind=finding.kind, path=finding.path, severity=finding.severity.value)
        for criterion in evaluation.criterion_results
        for finding in criterion.findings
    ]
    failure_type = diagnosis.failure_type.value
    content = FailurePatternContent(
        node_type=target_node_type,
        failure_type=failure_type,
        severity=diagnosis.severity.value,
        signature=_stable_hash(
            {
                "node_type": target_node_type,
                "failure_type": failure_type,
                "findings": [finding.model_dump(mode="json") for finding in findings],
            }
        )[:24],
        typical_findings=findings,
        domain_hints=[_domain_value(signal) for signal in domain_signals],
    )
    now = evaluation.provenance.eval_finished_at
    topic_keys = _topic_keys(
        f"node_type:{target_node_type}",
        f"failure_type:{failure_type}",
        *(_domain_topic(signal) for signal in domain_signals),
    )
    return ReflectionMemoryEntry(
        memory_id=_new_memory_id(),
        kind="failure_pattern",
        scope="project",
        topic_keys=topic_keys,
        summary=_truncate_summary(f"{target_node_type} failed with {failure_type}: {diagnosis.summary}"),
        content=content,
        origin_refs=EvaluationOrigin(
            evaluation_id=evaluation.eval_id,
            run_id=evaluation.run_id,
            node_id=evaluation.target_node_id,
            attempt_id=evaluation.target_attempt_id,
        ),
        sample_count=1,
        success_count=0,
        failure_count=0,
        first_seen_at=now,
        last_seen_at=now,
        confidence=0.0,
        sensitive=False,
        tags=diagnosis.tags,
        metadata={"cw": {"source": "evaluation_result"}},
    )


def _model_performance_signal_from_evaluation(
    evaluation: EvaluationResult,
    evaluator_node_type: str,
    domain_signals: Sequence[str],
) -> ReflectionMemoryEntry:
    model_profile_id = evaluation.provenance.evaluator_model_profile_id
    failure_types = []
    if evaluation.failure_diagnosis is not None:
        failure_types.append(evaluation.failure_diagnosis.failure_type.value)
    now = evaluation.provenance.eval_finished_at
    domain = _domain_value(domain_signals[0]) if domain_signals else None
    content = ModelPerformanceSignalContent(
        model_profile_id=model_profile_id,
        node_type=evaluator_node_type,
        domain=domain,
        pass_rate_window=1.0 if evaluation.passed else 0.0,
        avg_attempts_window=1.0,
        common_failure_types=failure_types,
        evidence_window_size=1,
    )
    return ReflectionMemoryEntry(
        memory_id=_new_memory_id(),
        kind="model_performance_signal",
        scope="project",
        topic_keys=_topic_keys(
            f"model_profile:{model_profile_id}",
            f"node_type:{evaluator_node_type}",
            *(_domain_topic(signal) for signal in domain_signals),
        ),
        summary=(f"{model_profile_id} on {evaluator_node_type}: pass_rate={content.pass_rate_window:.2f}, window=1"),
        content=content,
        origin_refs=AttemptCompletionOrigin(
            attempt_id=evaluation.evaluator_attempt_id,
            run_id=evaluation.run_id,
            node_id=evaluation.evaluator_node_id,
        ),
        sample_count=1,
        success_count=1 if evaluation.passed else 0,
        failure_count=0 if evaluation.passed else 1,
        first_seen_at=now,
        last_seen_at=now,
        confidence=_confidence(1 if evaluation.passed else 0, 0 if evaluation.passed else 1),
        sensitive=False,
        metadata={"cw": {"source": "evaluation_result"}},
    )


def _patch_pattern_from_verified_attempt(
    project_root: Path,
    evaluation: EvaluationResult,
    target_node_type: str,
) -> ReflectionMemoryEntry | None:
    target_attempt = _find_run_record(
        project_root, evaluation.run_id, "attempts.jsonl", "attempt_id", evaluation.target_attempt_id
    )
    if target_attempt is None:
        return None
    attempt = NodeAttempt.model_validate(target_attempt)
    source_patch_id = _source_patch_id(attempt)
    if source_patch_id is None:
        return None
    patch_payload = _find_run_record(project_root, evaluation.run_id, "repairs.jsonl", "patch_id", source_patch_id)
    if patch_payload is None:
        raise ReflectionMemoryError(
            "RM_WRITE_PATCH_NOT_VERIFIED",
            "Patch source attempt points to a missing RepairPatch.",
            details={"run_id": evaluation.run_id, "patch_id": source_patch_id},
        )
    patch = RepairPatch.model_validate(patch_payload)
    if not patch.addresses_failure_types:
        return None
    now = evaluation.provenance.eval_finished_at
    success_count = 1 if evaluation.passed else 0
    failure_count = 0 if evaluation.passed else 1
    failure_type = patch.addresses_failure_types[0].value
    content = PatchPatternContent(
        addresses_failure_type=failure_type,
        node_type=target_node_type,
        patch_kind=patch.patch_kind.value,
        operations_signature=_operations_signature(patch),
        operations_summary=_operations_summary(patch),
        before_after_metrics=None,
        recommended_scope=_recommended_scope(patch),
    )
    return ReflectionMemoryEntry(
        memory_id=_new_memory_id(),
        kind="patch_pattern",
        scope="project",
        topic_keys=_topic_keys(
            f"addresses_failure_type:{failure_type}",
            f"failure_type:{failure_type}",
            f"node_type:{target_node_type}",
            f"patch_kind:{patch.patch_kind.value}",
        ),
        summary=f"Patch {patch.patch_kind.value} for {failure_type}: {patch.expected_effect[:180]}",
        content=content,
        origin_refs=RepairOrigin(
            patch_id=patch.patch_id,
            evaluation_id=evaluation.eval_id,
            retried_attempt_id=evaluation.target_attempt_id,
            run_id=evaluation.run_id,
            node_id=evaluation.target_node_id,
        ),
        sample_count=1,
        success_count=success_count,
        failure_count=failure_count,
        first_seen_at=now,
        last_seen_at=now,
        confidence=_confidence(success_count, failure_count),
        sensitive=False,
        metadata={"cw": {"source": "repair_verification"}},
    )


def _source_patch_id(attempt: NodeAttempt) -> str | None:
    cw_metadata = attempt.metadata.get("cw")
    if isinstance(cw_metadata, dict):
        raw = cw_metadata.get("source_patch_id")
        if isinstance(raw, str) and raw:
            return raw
    return None


def _prepare_plain_entry(entry: ReflectionMemoryEntry) -> ReflectionMemoryEntry:
    if entry.scope != "project":
        raise ReflectionMemoryError(
            "RM_GLOBAL_SCOPE_NOT_ENABLED",
            "ReflectionMemory global scope is not enabled in Phase 1.",
            details={"scope": entry.scope},
        )
    if entry.sensitive:
        raise ReflectionMemoryError(
            "RM_WRITE_SENSITIVE_TO_PLAIN",
            "Sensitive ReflectionMemory entries cannot be written to reflection_memory.jsonl.",
            status_code=403,
            details={"memory_id": entry.memory_id},
        )
    dumped = entry.model_dump(mode="json")
    if _contains_secret(json.dumps(dumped, ensure_ascii=False, sort_keys=True)):
        raise ReflectionMemoryError(
            "RM_WRITE_LEAKED_PII",
            "ReflectionMemory entry contains secret-like content and was blocked.",
            status_code=403,
            details={"memory_id": entry.memory_id},
        )
    redacted = _redact_value(dumped)
    return ReflectionMemoryEntry.model_validate(redacted)


def _merge_entry(existing: ReflectionMemoryEntry, incoming: ReflectionMemoryEntry) -> ReflectionMemoryEntry:
    success_count = existing.success_count + incoming.success_count
    failure_count = existing.failure_count + incoming.failure_count
    sample_count = existing.sample_count + incoming.sample_count
    merged_topic_keys = sorted({*existing.topic_keys, *incoming.topic_keys})
    merged_tags = sorted({*existing.tags, *incoming.tags})
    metadata = _merge_metadata(existing.metadata, incoming.metadata)
    return incoming.model_copy(
        update={
            "memory_id": existing.memory_id,
            "topic_keys": merged_topic_keys,
            "sample_count": sample_count,
            "success_count": success_count,
            "failure_count": failure_count,
            "first_seen_at": existing.first_seen_at,
            "last_seen_at": incoming.last_seen_at,
            "confidence": _confidence(success_count, failure_count),
            "disabled": existing.disabled,
            "tags": merged_tags,
            "metadata": metadata,
        }
    )


def _candidate_topic_keys(request: ReflectionLookupRequest) -> set[str]:
    keys = {f"node_type:{request.node_type}"}
    if request.failure_type_hint:
        keys.add(f"failure_type:{request.failure_type_hint}")
        keys.add(f"addresses_failure_type:{request.failure_type_hint}")
    for signal in request.domain_signals:
        if not signal:
            continue
        keys.add(signal)
        keys.add(_domain_topic(signal))
    return keys


def _lookup_hash(request: ReflectionLookupRequest) -> str:
    return _stable_hash(
        {
            "node_id": request.node_id,
            "contract_kind": request.contract_kind,
            "node_type": request.node_type,
            "failure_type_hint": request.failure_type_hint,
            "domain_signals": sorted(request.domain_signals),
            "top_k_per_kind": request.top_k_per_kind,
            "include_kinds": None if request.include_kinds is None else sorted(request.include_kinds),
            "confidence_min": request.confidence_min,
            "sample_count_min": request.sample_count_min,
            "scope": request.scope,
        }
    )


def _validate_entry(raw: Mapping[str, Any]) -> ReflectionMemoryEntry:
    try:
        return ReflectionMemoryEntry.model_validate(raw)
    except ValidationError as exc:
        raise ReflectionMemoryError(
            "RM_INDEX_CORRUPT",
            "reflection_memory.jsonl contains an invalid entry.",
            status_code=500,
            details={"validation_errors": exc.errors(include_context=False)},
        ) from exc


def _read_jsonl_objects(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    objects: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            loaded = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ReflectionMemoryError(
                "RM_INDEX_CORRUPT",
                "reflection_memory.jsonl contains invalid JSON.",
                status_code=500,
                details={"line_number": line_number},
            ) from exc
        if not isinstance(loaded, dict):
            raise ReflectionMemoryError(
                "RM_INDEX_CORRUPT",
                "reflection_memory.jsonl line is not a JSON object.",
                status_code=500,
                details={"line_number": line_number},
            )
        objects.append(cast(dict[str, Any], loaded))
    return objects


def _write_jsonl_objects(path: Path, objects: Sequence[Mapping[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    content = "".join(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n" for obj in objects)
    tmp_path.write_text(content, encoding="utf-8", newline="\n")
    tmp_path.replace(path)


def _memory_path(project_root: Path) -> Path:
    return project_root.resolve() / REFLECTION_MEMORY_RELATIVE_PATH


def _find_run_record(
    project_root: Path,
    run_id: str,
    filename: str,
    object_key: str,
    object_id: str,
) -> dict[str, Any] | None:
    path = project_root.resolve() / AGENT_WORKFLOW_DIR / "runs" / run_id / filename
    for raw in _read_jsonl_objects(path):
        if raw.get(object_key) == object_id:
            return raw
    return None


def _operations_signature(patch: RepairPatch) -> str:
    payload = [
        {
            "op": operation.op,
            "payload_hash": _stable_hash(operation.model_dump(mode="json", by_alias=True)),
        }
        for operation in patch.operations
    ]
    return f"ops_{_stable_hash(payload)[:12]}"


def _operations_summary(patch: RepairPatch) -> str:
    summaries: list[str] = []
    for operation in patch.operations:
        payload = operation.model_dump(mode="json", by_alias=True)
        if "text" in payload and isinstance(payload["text"], str):
            summaries.append(f"{operation.op}: {_truncate(payload['text'], 240)}")
        elif "constraint_text" in payload and isinstance(payload["constraint_text"], str):
            summaries.append(f"{operation.op}: {_truncate(payload['constraint_text'], 240)}")
        else:
            summaries.append(operation.op)
    return _truncate("; ".join(summaries), 2000)


def _recommended_scope(patch: RepairPatch) -> RecommendedPatchScope:
    if patch.scope.value == "persistent_for_workflow":
        return "persistent_for_run"
    return cast(RecommendedPatchScope, patch.scope.value)


def _confidence(success_count: int, failure_count: int) -> float:
    return success_count / (success_count + failure_count + 1.0)


def _topic_keys(*keys: str) -> list[str]:
    return sorted({key for key in keys if key})


def _domain_topic(signal: str) -> str:
    return signal if ":" in signal else f"domain:{signal}"


def _domain_value(signal: str) -> str:
    return signal.split(":", 1)[1] if ":" in signal else signal


def _bucketize(value: float | None) -> float | None:
    if value is None:
        return None
    return int(value * 10) / 10


def _normalize_pattern_text(value: str) -> str:
    return value.strip().lower()


def _contains_secret(value: str) -> bool:
    return any(pattern.search(value) is not None for pattern in _SECRET_PATTERNS)


def _redact_value(value: Any, *, field_name: str | None = None) -> Any:
    if isinstance(value, str):
        if field_name is not None and field_name.endswith("_at") and _ISO_TIMESTAMP_FULL_RE.match(value) is not None:
            return value
        redacted = _EMAIL_RE.sub("[redacted-email]", value)
        redacted = _PHONE_RE.sub("[redacted-phone]", redacted)
        return _NATIONAL_ID_RE.sub("[redacted-id]", redacted)
    if isinstance(value, list):
        return [_redact_value(item, field_name=field_name) for item in value]
    if isinstance(value, dict):
        return {str(key): _redact_value(item, field_name=str(key)) for key, item in value.items()}
    return value


def _merge_metadata(left: Mapping[str, Any], right: Mapping[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = dict(left)
    for key, value in right.items():
        existing = merged.get(key)
        if isinstance(existing, dict) and isinstance(value, Mapping):
            merged[key] = {**existing, **dict(value)}
        else:
            merged[key] = value
    return merged


def _truncate_summary(value: str) -> str:
    return _truncate(value, 500)


def _truncate(value: str, max_length: int) -> str:
    return value if len(value) <= max_length else value[: max_length - 1] + "…"


def _stable_hash(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _new_memory_id() -> str:
    timestamp_ms = int(time.time() * 1000)
    value = (timestamp_ms << 80) | secrets.randbits(80)
    chars: list[str] = []
    for shift in range(125, -1, -5):
        chars.append(_CROCKFORD_ALPHABET[(value >> shift) & 0b11111])
    return "rm_" + "".join(chars)


__all__ = [
    "REFLECTION_MEMORY_RELATIVE_PATH",
    "AttemptCompletionOrigin",
    "EvaluationOrigin",
    "EvidencePatternContent",
    "FailurePatternContent",
    "FindingSummary",
    "HumanCorrectionOrigin",
    "ModelPerformanceSignalContent",
    "NodeTemplateSeedContent",
    "OriginRefs",
    "PatchPatternContent",
    "PlanningSessionOrigin",
    "PromptPatternContent",
    "ReflectionContent",
    "ReflectionKind",
    "ReflectionLookupRequest",
    "ReflectionLookupResult",
    "ReflectionMemoryEntry",
    "ReflectionMemoryError",
    "ReflectionScope",
    "RepairOrigin",
    "append_or_update_reflection_entry",
    "append_or_update_reflection_entry_locked",
    "load_reflection_memory_entries",
    "lookup_reflection_memory",
    "record_evaluation_reflections_locked",
    "reflection_signature",
    "render_reflection_instruction",
]
