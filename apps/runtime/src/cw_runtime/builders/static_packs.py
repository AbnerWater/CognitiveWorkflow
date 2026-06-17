"""Static ContextBuilder / EvidenceBuilder for M1.3.6.

This module intentionally implements only the Phase 1 static path: it consumes
the run input, the node contract, and explicit user assertions. It does not
retrieve references, call tools, query memory, or invoke an LLM.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from typing import Any, cast

from pydantic import BaseModel, ConfigDict, Field

from cw_schemas.contract import EvidenceRequirement, NodeContractBase, StaticTextSelector, UserInputSelector
from cw_schemas.packs import (
    CacheMeta,
    ContextBudget,
    ContextFragment,
    ContextPack,
    ContextProvenance,
    Evidence,
    EvidenceCoverage,
    EvidenceFragmentSource,
    EvidencePack,
    EvidenceProvenance,
    ExecutionPack,
    FragmentTransformation,
    PromptOverlay,
    RequirementResolution,
    StaticTextSource,
    UserInputEvidenceSource,
    UserInputSource,
)
from cw_schemas.types import Priority, SupportPolarity

_BUILDER_VERSION = "static-phase1.0.0"
_TOKENIZER_ID = "static-tokenizer-v1"
_REFERENCE_INDEX_SNAPSHOT_ID = "static-phase1-no-reference-index"


class PackBuildError(RuntimeError):
    """Raised when static pack construction cannot satisfy a spec requirement."""

    def __init__(self, error_code: str, message: str, *, details: Mapping[str, object] | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.details = {} if details is None else dict(details)


class StaticAttemptPackRequest(BaseModel):
    """Inputs needed to build static M1.3.6 packs for one attempt."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    run_id: str
    node_id: str
    attempt_id: str
    context_pack_id: str
    execution_pack_id: str
    evidence_pack_id: str | None = None
    contract: NodeContractBase
    model_profile_id: str
    effective_model_settings: dict[str, Any] = Field(default_factory=dict)
    built_at: str
    initial_input: dict[str, Any] = Field(default_factory=dict)
    effective_prompt_overlay: PromptOverlay | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AttemptPackBundle(BaseModel):
    """Built packs for one attempt."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    context_pack: ContextPack
    evidence_pack: EvidencePack | None = None
    execution_pack: ExecutionPack


def build_static_attempt_packs(request: StaticAttemptPackRequest) -> AttemptPackBundle:
    """Build EvidencePack (when possible), ContextPack, and ExecutionPack."""

    evidence_pack = build_static_evidence_pack(request)
    context_pack = build_static_context_pack(request, evidence_pack)
    execution_pack = build_static_execution_pack(request, context_pack, evidence_pack)
    return AttemptPackBundle(context_pack=context_pack, evidence_pack=evidence_pack, execution_pack=execution_pack)


def build_static_evidence_pack(request: StaticAttemptPackRequest) -> EvidencePack | None:
    """Build the static EvidencePack for one attempt, if requirements exist."""

    return _build_evidence_pack(request)


def build_static_context_pack(
    request: StaticAttemptPackRequest,
    evidence_pack: EvidencePack | None,
) -> ContextPack:
    """Build the static ContextPack for one attempt."""

    return _build_context_pack(request, evidence_pack)


def build_static_execution_pack(
    request: StaticAttemptPackRequest,
    context_pack: ContextPack,
    evidence_pack: EvidencePack | None,
) -> ExecutionPack:
    """Build the ExecutionPack wrapper for one attempt."""

    effective_model_settings = request.effective_model_settings or request.contract.model_policy.model_settings
    execution_pack = ExecutionPack(
        pack_id=request.execution_pack_id,
        run_id=request.run_id,
        node_id=request.node_id,
        attempt_id=request.attempt_id,
        node_contract_snapshot=cast(Any, request.contract),
        context_pack=context_pack,
        evidence_pack=evidence_pack,
        effective_prompt_overlay=request.effective_prompt_overlay,
        effective_model_settings=dict(effective_model_settings),
        effective_model_profile_id=request.model_profile_id,
        retry_policy=request.contract.retry_policy,
        validator_policy=request.contract.validator_policy,
        usage_limits=None,
        cancel_token=_derived_id("cancel", request.attempt_id),
        correlation_id=request.attempt_id,
        metadata={
            "cw": {
                "builder": "static_phase1",
                "context_builder_version": _BUILDER_VERSION,
                "evidence_builder_version": _BUILDER_VERSION if evidence_pack is not None else None,
            }
        },
    )
    return execution_pack


def _build_evidence_pack(request: StaticAttemptPackRequest) -> EvidencePack | None:
    requirements = request.contract.evidence_requirements
    if not requirements:
        return None

    assertions = _collect_user_assertions(request.initial_input, requirements)
    if not assertions:
        if all(requirement.min_evidences == 0 or requirement.min_coverage == 0 for requirement in requirements):
            return None
        raise PackBuildError(
            "EP_BUILD_REQUIREMENT_UNRESOLVED",
            "Static EvidenceBuilder requires explicit initial_input.user_assertions for evidence requirements.",
            details={"node_id": request.node_id, "requirements": [req.required_for for req in requirements]},
        )

    requirement_entries = [
        (index, requirement, requirement.requirement_id or f"req_{index:03d}")
        for index, requirement in enumerate(requirements, start=1)
    ]
    required_topics = [requirement.required_for for _, requirement, _ in requirement_entries]
    built_at = request.built_at
    evidences: list[Evidence] = []
    evidence_matches: dict[str, set[str]] = {}
    for index, assertion in enumerate(assertions, start=1):
        claim = _required_text(assertion.get("claim"))
        quote = _required_text(assertion.get("quote"))
        if claim is None or quote is None:
            raise PackBuildError(
                "EP_BUILD_REQUIREMENT_UNRESOLVED",
                "Static EvidenceBuilder user assertions must include non-empty claim and quote fields.",
                details={"node_id": request.node_id, "assertion_index": index - 1},
            )
        matched_entries = _matched_requirement_entries(assertion, requirement_entries)
        if not matched_entries:
            continue
        matched_requirement_ids = {requirement_id for _, _, requirement_id in matched_entries}
        matched_required_for = [requirement.required_for for _, requirement, _ in matched_entries]
        topics = _merge_topics(_string_list(assertion.get("topics")), matched_required_for)
        input_field = _coerce_text(assertion.get("input_field") or f"user_assertions[{index - 1}]")
        relevance = _bounded_float(assertion.get("relevance"), default=1.0)
        confidence = _bounded_float(assertion.get("confidence"), default=0.5)
        evidence = Evidence(
            evidence_id=f"ev_{index:03d}",
            claim=claim[:500],
            quote=quote[:4000],
            paraphrase=None,
            source=UserInputEvidenceSource(
                input_field=input_field,
                user_id=_optional_text(assertion.get("user_id")),
                asserted_at=_optional_text(assertion.get("asserted_at")) or built_at,
            ),
            relevance=relevance,
            confidence=confidence,
            support_polarity=SupportPolarity.SUPPORTS,
            topics=topics,
            priority=Priority.HIGH
            if any(
                requirement.min_evidences > 0 and requirement.min_coverage > 0 for _, requirement, _ in matched_entries
            )
            else Priority.NORMAL,
            sensitive=False,
            tokens_estimate=_estimate_tokens(f"{claim}\n{quote}"),
            created_at=built_at,
            metadata={"cw": {"source": "static_user_assertion"}},
        )
        evidences.append(evidence)
        evidence_matches[evidence.evidence_id] = matched_requirement_ids

    resolutions: list[RequirementResolution] = []
    covered_topics: list[str] = []
    for _, requirement, requirement_id in requirement_entries:
        required_count = requirement.min_evidences
        evidence_ids = [
            evidence.evidence_id
            for evidence in evidences
            if requirement_id in evidence_matches.get(evidence.evidence_id, set())
        ]
        actual_coverage = 1.0 if required_count == 0 else min(1.0, len(evidence_ids) / required_count)
        satisfied = len(evidence_ids) >= required_count and actual_coverage >= requirement.min_coverage
        if satisfied and evidence_ids:
            covered_topics.append(requirement.required_for)
        resolutions.append(
            RequirementResolution(
                requirement_id=requirement_id,
                required_for=requirement.required_for,
                min_coverage=requirement.min_coverage,
                actual_coverage=actual_coverage,
                satisfied=satisfied,
                evidence_ids=evidence_ids,
            )
        )

    if any(not resolution.satisfied and resolution.min_coverage > 0 for resolution in resolutions):
        raise PackBuildError(
            "EP_BUILD_REQUIREMENT_UNRESOLVED",
            "Static EvidenceBuilder could not satisfy all declared evidence requirements.",
            details={
                "node_id": request.node_id,
                "requirements": [r.requirement_id for r in resolutions if not r.satisfied],
            },
        )
    if not evidences:
        return None

    coverage_ratio = len(covered_topics) / max(1, len(required_topics))
    provenance = EvidenceProvenance(
        builder_version=_BUILDER_VERSION,
        built_at=built_at,
        embedding_model=None,
        re_ranker_model=None,
        reference_index_snapshot_id=_REFERENCE_INDEX_SNAPSHOT_ID,
        requirements_hash=_stable_hash([requirement.model_dump(mode="json") for requirement in requirements]),
        pack_hash=_stable_hash(
            {
                "evidences": [
                    _stable_evidence_hash_payload(evidence, evidence_matches[evidence.evidence_id])
                    for evidence in evidences
                ],
                "requirements_resolved": [resolution.model_dump(mode="json") for resolution in resolutions],
                "reference_index_snapshot_id": _REFERENCE_INDEX_SNAPSHOT_ID,
            }
        ),
    )
    return EvidencePack(
        pack_id=request.evidence_pack_id or _derived_id("evpack", request.attempt_id),
        node_id=request.node_id,
        attempt_id=request.attempt_id,
        run_id=request.run_id,
        purpose=request.contract.goal[:500],
        evidences=evidences,
        coverage=EvidenceCoverage(
            required_topics=required_topics,
            required_topics_covered=covered_topics,
            coverage_ratio=coverage_ratio,
            evidence_density=0.0,
            avg_relevance=_average([evidence.relevance for evidence in evidences]),
            avg_confidence=_average([evidence.confidence for evidence in evidences]),
        ),
        conflicts=[],
        requirements_resolved=resolutions,
        provenance=provenance,
        cache_meta=CacheMeta(cache_namespace="static-phase1::evidence", ttl_seconds=86400),
        metadata={"cw": {"builder": "static_phase1", "input_source": "user_assertions"}},
    )


def _build_context_pack(request: StaticAttemptPackRequest, evidence_pack: EvidencePack | None) -> ContextPack:
    fragments: list[ContextFragment] = []
    deps: dict[str, Any] = {}
    template_inputs: dict[str, Any] = {"node_goal": request.contract.goal, "deps": deps}

    goal_fragment = _context_fragment(
        request=request,
        fragment_id=_derived_id("frag_goal", request.node_id),
        key="node_goal",
        kind="node_goal",
        priority=Priority.CRITICAL,
        required=True,
        text=request.contract.goal,
        payload=None,
        source=StaticTextSource(contract_field_path="goal"),
    )
    fragments.append(goal_fragment)

    for index, requirement in enumerate(request.contract.context_requirements):
        if requirement.kind != requirement.selector.source_kind:
            raise PackBuildError(
                "CP_BUILD_REQ_UNRESOLVED",
                "ContextRequirement.kind must match selector.source_kind.",
                details={"node_id": request.node_id, "key": requirement.key},
            )
        selector = requirement.selector
        if isinstance(selector, StaticTextSelector):
            value = selector.text
            fragment_source: Any = StaticTextSource(contract_field_path=f"context_requirements[{index}]")
        elif isinstance(selector, UserInputSelector):
            if selector.input_field not in request.initial_input:
                if requirement.required:
                    raise PackBuildError(
                        "CP_BUILD_REQ_UNRESOLVED",
                        "Required user_input context field is missing from run initial_input.",
                        details={
                            "node_id": request.node_id,
                            "key": requirement.key,
                            "input_field": selector.input_field,
                        },
                    )
                continue
            value = request.initial_input[selector.input_field]
            fragment_source = UserInputSource(input_field=selector.input_field)
        else:
            if requirement.required:
                raise PackBuildError(
                    "CP_BUILD_REQ_UNRESOLVED",
                    "Static ContextBuilder Phase 1 supports only static_text and user_input requirements.",
                    details={
                        "node_id": request.node_id,
                        "key": requirement.key,
                        "source_kind": requirement.kind,
                    },
                )
            continue

        text = _render_value(value)
        fragment = _context_fragment(
            request=request,
            fragment_id=_derived_id("frag", request.node_id, requirement.key),
            key=requirement.key,
            kind=requirement.kind,
            priority=Priority.HIGH if requirement.required else Priority.NORMAL,
            required=requirement.required,
            text=text,
            payload=None if isinstance(value, str) else {"value": value},
            source=fragment_source,
        )
        fragments.append(fragment)
        template_inputs[requirement.key] = value
        deps[requirement.key] = value

    if evidence_pack is not None:
        evidence_lines: list[str] = []
        for evidence in evidence_pack.evidences:
            evidence_source = evidence.source
            source_label = (
                evidence_source.input_field
                if isinstance(evidence_source, UserInputEvidenceSource)
                else evidence_source.source_kind
            )
            text = f"[{evidence.evidence_id}] {evidence.claim} -- user_input:{source_label}"
            evidence_lines.append(text)
            fragments.append(
                _context_fragment(
                    request=request,
                    fragment_id=_derived_id("frag_ev", request.node_id, evidence.evidence_id),
                    key=f"evidence.{evidence.evidence_id}",
                    kind="evidence",
                    priority=Priority.HIGH
                    if evidence.priority in {Priority.CRITICAL, Priority.HIGH}
                    else Priority.NORMAL,
                    required=evidence.priority in {Priority.CRITICAL, Priority.HIGH},
                    text=text,
                    payload=evidence.model_dump(mode="json"),
                    source=EvidenceFragmentSource(
                        evidence_pack_id=evidence_pack.pack_id,
                        evidence_id=evidence.evidence_id,
                    ),
                )
            )
        rendered_evidence = "\n".join(evidence_lines)
        template_inputs["evidence"] = rendered_evidence
        deps["evidence"] = rendered_evidence

    fragments = _sort_fragments(fragments)
    budget = ContextBudget(
        model_context_window_tokens=8192,
        reserved_for_output_tokens=1024,
        reserved_for_history_tokens=0,
        reserved_for_tools_tokens=512,
        safety_margin_tokens=512,
        hard_limit_tokens=6144,
    )
    provenance = ContextProvenance(
        builder_version=_BUILDER_VERSION,
        built_at=request.built_at,
        model_profile_id=request.model_profile_id,
        tokenizer=_TOKENIZER_ID,
        requirements_hash=_stable_hash(
            [item.model_dump(mode="json") for item in request.contract.context_requirements]
        ),
        inputs_hash=_stable_hash(
            {
                "run_id": request.run_id,
                "node_id": request.node_id,
                "initial_input": request.initial_input,
                "evidence_pack_hash": None if evidence_pack is None else evidence_pack.provenance.pack_hash,
            }
        ),
        pack_hash=_stable_hash(
            {
                "fragments": [_stable_context_fragment_hash_payload(fragment) for fragment in fragments],
                "template_inputs": template_inputs,
                "budget": budget.model_dump(mode="json"),
            }
        ),
    )
    return ContextPack(
        pack_id=request.context_pack_id,
        node_id=request.node_id,
        attempt_id=request.attempt_id,
        run_id=request.run_id,
        node_goal=request.contract.goal,
        global_summary=None,
        user_constraints=[],
        fragments=fragments,
        template_inputs=template_inputs,
        budget=budget,
        compression_log=[],
        provenance=provenance,
        cache_meta=CacheMeta(cache_namespace="static-phase1::context", ttl_seconds=86400),
        metadata={"cw": {"builder": "static_phase1"}},
    )


def _context_fragment(
    *,
    request: StaticAttemptPackRequest,
    fragment_id: str,
    key: str,
    kind: str,
    priority: Priority,
    required: bool,
    text: str,
    payload: dict[str, Any] | None,
    source: Any,
) -> ContextFragment:
    tokens = _estimate_tokens(text)
    return ContextFragment(
        fragment_id=fragment_id,
        key=key,
        kind=cast(Any, kind),
        priority=priority,
        required=required,
        tokens_estimate=tokens,
        tokens_actual=None,
        text=text,
        payload=payload,
        source=source,
        transformation=FragmentTransformation(
            kind="as_is",
            details={"builder": "static_phase1"},
            original_tokens=tokens,
            final_tokens=tokens,
            summarizer_model=None,
            at=request.built_at,
        ),
        created_at=request.built_at,
        metadata={"cw": {"builder": "static_phase1"}},
    )


def _collect_user_assertions(
    initial_input: Mapping[str, Any],
    requirements: Sequence[EvidenceRequirement],
) -> list[dict[str, Any]]:
    raw = initial_input.get("user_assertions")
    if raw is None:
        raw = initial_input.get("evidence")
    if raw is None:
        return []
    if isinstance(raw, str):
        assertion = {"claim": raw, "quote": raw}
        if len(requirements) == 1:
            assertion["required_for"] = requirements[0].required_for
        return [assertion]
    if not isinstance(raw, Sequence) or isinstance(raw, bytes | bytearray):
        return []

    assertions: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if isinstance(item, str):
            assertion = {
                "claim": item,
                "quote": item,
                "input_field": f"user_assertions[{index}]",
            }
            if len(requirements) == 1:
                assertion["required_for"] = requirements[0].required_for
            assertions.append(assertion)
        elif isinstance(item, Mapping):
            copied: dict[str, Any] = dict(item)
            copied.setdefault("input_field", f"user_assertions[{index}]")
            assertions.append(copied)
    return assertions


def _matched_requirement_entries(
    assertion: Mapping[str, Any],
    requirement_entries: Sequence[tuple[int, EvidenceRequirement, str]],
) -> list[tuple[int, EvidenceRequirement, str]]:
    required_for_values = _string_set(assertion.get("required_for"))
    required_for_values.update(_string_set(assertion.get("required_for_path")))
    required_for_values.update(_string_set(assertion.get("required_for_paths")))
    requirement_ids = _string_set(assertion.get("requirement_id"))
    requirement_ids.update(_string_set(assertion.get("requirement_ids")))
    topics = _string_set(assertion.get("topics"))

    has_explicit_match_field = bool(required_for_values or requirement_ids or topics)
    if not has_explicit_match_field and len(requirement_entries) == 1:
        return list(requirement_entries)

    matched: list[tuple[int, EvidenceRequirement, str]] = []
    for entry in requirement_entries:
        _, requirement, requirement_id = entry
        if requirement.required_for in required_for_values:
            matched.append(entry)
            continue
        if requirement_id in requirement_ids or (
            requirement.requirement_id and requirement.requirement_id in requirement_ids
        ):
            matched.append(entry)
            continue
        if requirement.required_for in topics or requirement_id in topics:
            matched.append(entry)
    return matched


def _render_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)
    except TypeError:
        return str(value)


def _coerce_text(value: object) -> str:
    if value is None:
        return ""
    rendered = _render_value(value)
    if rendered.strip():
        return rendered.strip()
    return ""


def _required_text(value: object) -> str | None:
    rendered = _coerce_text(value)
    if not rendered:
        return None
    return rendered


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    rendered = _coerce_text(value)
    return rendered or None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, str | bytes | bytearray):
        return []
    result: list[str] = []
    for item in value:
        if isinstance(item, str) and item:
            result.append(item)
    return result


def _string_set(value: object) -> set[str]:
    if isinstance(value, str):
        return {value} if value else set()
    if not isinstance(value, Sequence) or isinstance(value, bytes | bytearray):
        return set()
    return {item for item in value if isinstance(item, str) and item}


def _merge_topics(*topic_lists: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for topics in topic_lists:
        for topic in topics:
            if topic in seen:
                continue
            seen.add(topic)
            merged.append(topic)
    return merged


def _bounded_float(value: object, *, default: float) -> float:
    if isinstance(value, int | float):
        return min(1.0, max(0.0, float(value)))
    return default


def _average(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _estimate_tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


def _sort_fragments(fragments: Sequence[ContextFragment]) -> list[ContextFragment]:
    priority_order = {
        Priority.CRITICAL: 0,
        Priority.HIGH: 1,
        Priority.NORMAL: 2,
        Priority.LOW: 3,
    }
    return [
        fragment
        for _, fragment in sorted(
            enumerate(fragments),
            key=lambda item: (priority_order[item[1].priority], item[0]),
        )
    ]


def _stable_evidence_hash_payload(evidence: Evidence, matched_requirement_ids: set[str]) -> dict[str, Any]:
    source = evidence.source.model_dump(mode="json")
    source.pop("asserted_at", None)
    return {
        "evidence_id": evidence.evidence_id,
        "claim": evidence.claim,
        "quote": evidence.quote,
        "paraphrase": evidence.paraphrase,
        "source": source,
        "relevance": evidence.relevance,
        "confidence": evidence.confidence,
        "support_polarity": evidence.support_polarity.value,
        "topics": evidence.topics,
        "priority": evidence.priority.value,
        "sensitive": evidence.sensitive,
        "tokens_estimate": evidence.tokens_estimate,
        "matched_requirement_ids": sorted(matched_requirement_ids),
    }


def _stable_context_fragment_hash_payload(fragment: ContextFragment) -> dict[str, Any]:
    payload = fragment.payload
    if fragment.kind == "evidence" and isinstance(payload, dict):
        payload = dict(payload)
        payload.pop("created_at", None)
        source = payload.get("source")
        if isinstance(source, dict):
            source = dict(source)
            source.pop("asserted_at", None)
            payload["source"] = source
    return {
        "fragment_id": fragment.fragment_id,
        "key": fragment.key,
        "kind": fragment.kind,
        "priority": fragment.priority.value,
        "required": fragment.required,
        "source": fragment.source.model_dump(mode="json"),
        "text": fragment.text,
        "payload": payload,
    }


def _stable_hash(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _derived_id(prefix: str, *parts: str) -> str:
    raw = "_".join((prefix, *parts))
    cleaned = re.sub(r"[^A-Za-z0-9_.:-]+", "_", raw).strip("_.:-")
    if not cleaned or not cleaned[0].isalnum():
        cleaned = f"{prefix}_{cleaned}"
    if len(cleaned) <= 64:
        return cleaned
    digest = hashlib.sha256(cleaned.encode("utf-8")).hexdigest()[:12]
    return f"{cleaned[:48]}_{digest}"


__all__ = [
    "AttemptPackBundle",
    "PackBuildError",
    "StaticAttemptPackRequest",
    "build_static_attempt_packs",
    "build_static_context_pack",
    "build_static_evidence_pack",
    "build_static_execution_pack",
]
