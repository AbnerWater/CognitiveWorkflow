"""契约测试：cw_schemas.packs — ContextPack / EvidencePack / ExecutionPack。

覆盖 specs/schemas/context_pack.md §10 + evidence_pack.md §8 的关键错误码：
- CP_BUILD_OVER_BUDGET
- CP_BUILD_DROP_REQUIRED_FORBIDDEN
- EP_BUILD_DUPLICATE_EVIDENCE_ID
- EP_BUILD_REQUIREMENT_UNRESOLVED
- EP_BUILD_BLOCKER_CONFLICT_UNRESOLVED
- EP_BUILD_CONFLICT_DANGLING_EVIDENCE
- EP_BUILD_COVERAGE_INCONSISTENT
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from cw_schemas import (
    CompressionLogEntry,
    ContextBudget,
    ContextFragment,
    ContextPack,
    ContextProvenance,
    Evidence,
    EvidenceConflict,
    EvidenceCoverage,
    EvidencePack,
    EvidenceProvenance,
    RequirementResolution,
)
from cw_schemas.packs.evidence_source import ReferenceChunkEvidenceSource
from cw_schemas.packs.fragments import (
    InjectedSource,
    StaticTextSource,
    UpstreamArtifactSource,
)
from cw_schemas.types import (
    CompressionAction,
    EvidenceConflictKind,
    Priority,
    Severity,
    SupportPolarity,
)


def _assert_validation_error_contains(exc: ValidationError, code: str) -> None:
    found = any(err.get("type") == code or code in str(err) for err in exc.errors())
    assert found, f"未检测到错误码 {code}；实际错误：{exc.errors()!r}"


# =============================================================================
# 公共 fixture builders
# =============================================================================


def _budget(hard_limit: int = 10000) -> ContextBudget:
    return ContextBudget(
        model_context_window_tokens=200000,
        reserved_for_output_tokens=4096,
        hard_limit_tokens=hard_limit,
    )


def _provenance() -> ContextProvenance:
    return ContextProvenance(
        builder_version="0.1.0",
        built_at="2026-06-15T08:30:01Z",
        model_profile_id="claude-sonnet-default",
        tokenizer="claude-tokenizer-v3",
        requirements_hash="rhash_8f1c",
        inputs_hash="ihash_31bd",
        pack_hash="phash_9ad2",
    )


def _fragment(
    *, fid: str, kind: str, tokens: int, required: bool, priority: Priority = Priority.NORMAL
) -> ContextFragment:
    return ContextFragment(
        fragment_id=fid,
        key="k_" + fid,
        kind=kind,  # type: ignore[arg-type]
        priority=priority,
        required=required,
        tokens_estimate=tokens,
        text="some text",
        source=StaticTextSource(contract_field_path="goal"),
        created_at="2026-06-15T08:30:00Z",
    )


# =============================================================================
# ContextPack happy path
# =============================================================================


def test_context_pack_minimal_validates() -> None:
    pack = ContextPack(
        pack_id="ctxp_01",
        node_id="n_extract",
        attempt_id="att_01",
        run_id="run_01",
        node_goal="提取研究问题",
        fragments=[
            _fragment(fid="frag_01", kind="node_goal", tokens=32, required=True, priority=Priority.CRITICAL),
            _fragment(fid="frag_02", kind="reference_chunk", tokens=480, required=True),
        ],
        budget=_budget(),
        provenance=_provenance(),
    )
    assert len(pack.fragments) == 2
    assert pack.schema_version == "0.1.0"


def test_context_pack_round_trip_json() -> None:
    pack = ContextPack(
        pack_id="ctxp_02",
        node_id="n_extract",
        attempt_id="att_02",
        run_id="run_02",
        node_goal="x",
        fragments=[_fragment(fid="frag_a", kind="node_goal", tokens=10, required=True)],
        budget=_budget(),
        provenance=_provenance(),
    )
    raw = pack.model_dump_json()
    restored = ContextPack.model_validate_json(raw)
    assert restored == pack


def test_context_pack_extra_forbid() -> None:
    with pytest.raises(ValidationError):
        ContextPack.model_validate(
            {
                "pack_id": "ctxp_03",
                "node_id": "n_x",
                "attempt_id": "att_x",
                "run_id": "run_x",
                "node_goal": "x",
                "fragments": [],
                "budget": _budget().model_dump(),
                "provenance": _provenance().model_dump(),
                "unknown_field": "forbid",
            }
        )


# =============================================================================
# CP_BUILD_* 错误码
# =============================================================================


def test_cp_build_over_budget() -> None:
    """sum(tokens_estimate) > hard_limit → CP_BUILD_OVER_BUDGET。"""
    with pytest.raises(ValidationError) as exc_info:
        ContextPack(
            pack_id="ctxp_over",
            node_id="n_x",
            attempt_id="att_x",
            run_id="run_x",
            node_goal="x",
            fragments=[
                _fragment(fid="big_01", kind="reference_chunk", tokens=5000, required=True),
                _fragment(fid="big_02", kind="reference_chunk", tokens=6000, required=True),
            ],
            budget=_budget(hard_limit=8000),  # 5000 + 6000 > 8000
            provenance=_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "CP_BUILD_OVER_BUDGET")


def test_cp_build_drop_required_forbidden() -> None:
    """required=true 不能出现在 compression_log[dropped]。"""
    with pytest.raises(ValidationError) as exc_info:
        ContextPack(
            pack_id="ctxp_drop",
            node_id="n_x",
            attempt_id="att_x",
            run_id="run_x",
            node_goal="x",
            fragments=[
                _fragment(fid="frag_must", kind="node_goal", tokens=10, required=True),
            ],
            budget=_budget(),
            provenance=_provenance(),
            compression_log=[
                CompressionLogEntry(
                    fragment_id="frag_must",
                    action=CompressionAction.DROPPED,
                    before_tokens=10,
                    after_tokens=0,
                    reason="bad_impl",
                    at="2026-06-15T08:30:02Z",
                )
            ],
        )
    _assert_validation_error_contains(exc_info.value, "CP_BUILD_DROP_REQUIRED_FORBIDDEN")


def test_cp_build_dup_fragment_id() -> None:
    with pytest.raises(ValidationError) as exc_info:
        ContextPack(
            pack_id="ctxp_dup",
            node_id="n_x",
            attempt_id="att_x",
            run_id="run_x",
            node_goal="x",
            fragments=[
                _fragment(fid="frag_a", kind="node_goal", tokens=10, required=True),
                _fragment(fid="frag_a", kind="reference_chunk", tokens=20, required=False),
            ],
            budget=_budget(),
            provenance=_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "CP_BUILD_DUP_FRAGMENT_ID")


# =============================================================================
# Fragment discriminator round-trip
# =============================================================================


def test_fragment_source_discriminator() -> None:
    f = ContextFragment(
        fragment_id="frag_upstream",
        key="upstream_data",
        kind="upstream_artifact",
        priority=Priority.HIGH,
        required=True,
        tokens_estimate=100,
        payload={"x": 1},
        source=UpstreamArtifactSource(from_node_id="n_extract", artifact_field="research_questions[*]"),
        created_at="2026-06-15T08:30:00Z",
    )
    assert f.source.source_kind == "upstream_artifact"

    # Injected fragment
    f2 = ContextFragment(
        fragment_id="frag_inject",
        key="reflection",
        kind="instruction_addendum",
        priority=Priority.NORMAL,
        required=False,
        tokens_estimate=50,
        text="提示：...",
        source=InjectedSource(injected_by="reflection_memory", reason="patch_pattern_hit"),
        created_at="2026-06-15T08:30:00Z",
    )
    assert f2.source.source_kind == "injected"


# =============================================================================
# EvidencePack
# =============================================================================


def _ref_source(rid: str = "ref_a", chunk: str = "chk_001") -> ReferenceChunkEvidenceSource:
    return ReferenceChunkEvidenceSource(
        reference_id=rid,
        reference_title="Reference Title",
        chunk_id=chunk,
        chunk_index=0,
        position={"start": 0, "end": 200},
    )


def _evidence(*, eid: str, topics: list[str] | None = None, relevance: float = 0.8) -> Evidence:
    return Evidence(
        evidence_id=eid,
        claim="some claim",
        quote="quote content",
        source=_ref_source(),
        relevance=relevance,
        confidence=0.8,
        support_polarity=SupportPolarity.SUPPORTS,
        topics=topics or [],
        priority=Priority.HIGH,
        sensitive=False,
        tokens_estimate=100,
        created_at="2026-06-15T08:30:00Z",
    )


def _evidence_provenance() -> EvidenceProvenance:
    return EvidenceProvenance(
        builder_version="0.1.0",
        built_at="2026-06-15T08:30:00Z",
        embedding_model="bge-m3",
        reference_index_snapshot_id="snap_2026Q2",
        requirements_hash="rhash_x",
        pack_hash="phash_evd",
    )


def test_evidence_pack_minimal_validates() -> None:
    pack = EvidencePack(
        pack_id="evp_01",
        node_id="n_extract",
        attempt_id="att_01",
        run_id="run_01",
        purpose="为研究问题提供来源证据",
        evidences=[_evidence(eid="ev_001", topics=["policy"])],
        coverage=EvidenceCoverage(
            required_topics=["policy"],
            required_topics_covered=["policy"],
            coverage_ratio=1.0,
            avg_relevance=0.8,
            avg_confidence=0.8,
        ),
        requirements_resolved=[
            RequirementResolution(
                requirement_id="req_01",
                required_for="$.research_questions[*]",
                min_coverage=1.0,
                actual_coverage=1.0,
                satisfied=True,
                evidence_ids=["ev_001"],
            ),
        ],
        provenance=_evidence_provenance(),
    )
    assert len(pack.evidences) == 1
    assert pack.coverage.coverage_ratio == 1.0


def test_ep_build_duplicate_evidence_id() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvidencePack(
            pack_id="evp_dup",
            node_id="n_x",
            attempt_id="att_x",
            run_id="run_x",
            purpose="x",
            evidences=[
                _evidence(eid="ev_dup", topics=["t"]),
                _evidence(eid="ev_dup", topics=["t"]),
            ],
            coverage=EvidenceCoverage(
                required_topics=["t"],
                required_topics_covered=["t"],
                coverage_ratio=1.0,
                avg_relevance=0.8,
                avg_confidence=0.8,
            ),
            requirements_resolved=[],
            provenance=_evidence_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "EP_BUILD_DUPLICATE_EVIDENCE_ID")


def test_ep_build_requirement_unresolved() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvidencePack(
            pack_id="evp_unres",
            node_id="n_x",
            attempt_id="att_x",
            run_id="run_x",
            purpose="x",
            evidences=[_evidence(eid="ev_01", topics=["t"])],
            coverage=EvidenceCoverage(
                required_topics=["t"],
                required_topics_covered=["t"],
                coverage_ratio=0.5,
                avg_relevance=0.5,
                avg_confidence=0.5,
            ),
            requirements_resolved=[
                RequirementResolution(
                    requirement_id="req_01",
                    required_for="$.foo",
                    min_coverage=1.0,
                    actual_coverage=0.5,
                    satisfied=False,
                    evidence_ids=["ev_01"],
                )
            ],
            provenance=_evidence_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "EP_BUILD_REQUIREMENT_UNRESOLVED")


def test_ep_build_blocker_conflict_unresolved() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvidenceConflict(
            conflict_id="cf_01",
            evidence_ids=["ev_a", "ev_b"],
            kind=EvidenceConflictKind.CONTRADICTION,
            severity=Severity.BLOCKER,
            resolution_hint=None,
        )
    _assert_validation_error_contains(exc_info.value, "EP_BUILD_BLOCKER_CONFLICT_UNRESOLVED")


def test_ep_build_conflict_dangling_evidence() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvidencePack(
            pack_id="evp_dang",
            node_id="n_x",
            attempt_id="att_x",
            run_id="run_x",
            purpose="x",
            evidences=[_evidence(eid="ev_only", topics=["t"])],
            coverage=EvidenceCoverage(
                required_topics=["t"],
                required_topics_covered=["t"],
                coverage_ratio=1.0,
                avg_relevance=0.8,
                avg_confidence=0.8,
            ),
            conflicts=[
                EvidenceConflict(
                    conflict_id="cf_x",
                    evidence_ids=["ev_only", "ev_missing"],
                    kind=EvidenceConflictKind.CONTRADICTION,
                    severity=Severity.MAJOR,
                    resolution_hint="resolve me",
                )
            ],
            requirements_resolved=[],
            provenance=_evidence_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "EP_BUILD_CONFLICT_DANGLING_EVIDENCE")


def test_ep_build_coverage_inconsistent() -> None:
    """required_topics_covered 含 't' 但无 evidence relevance ≥ 0.5 支撑。"""
    with pytest.raises(ValidationError) as exc_info:
        EvidencePack(
            pack_id="evp_cov",
            node_id="n_x",
            attempt_id="att_x",
            run_id="run_x",
            purpose="x",
            evidences=[_evidence(eid="ev_weak", topics=["t"], relevance=0.3)],
            coverage=EvidenceCoverage(
                required_topics=["t"],
                required_topics_covered=["t"],
                coverage_ratio=1.0,
                avg_relevance=0.3,
                avg_confidence=0.3,
            ),
            requirements_resolved=[],
            provenance=_evidence_provenance(),
        )
    _assert_validation_error_contains(exc_info.value, "EP_BUILD_COVERAGE_INCONSISTENT")


def test_coverage_required_topics_covered_subset() -> None:
    with pytest.raises(ValidationError) as exc_info:
        EvidenceCoverage(
            required_topics=["a"],
            required_topics_covered=["b"],  # 不在 required_topics
            coverage_ratio=1.0,
            avg_relevance=0.5,
            avg_confidence=0.5,
        )
    _assert_validation_error_contains(exc_info.value, "EP_BUILD_COVERAGE_INCONSISTENT")


# =============================================================================
# ExecutionPack — agent_adapter.md §3
# =============================================================================


def test_execution_pack_minimal_validates() -> None:
    from cw_schemas import (
        ExecutionContract,
        ExecutionPack,
        NodeModelPolicy,
        PromptSection,
    )

    pack = ExecutionPack(
        pack_id="exp_01",
        run_id="run_01",
        node_id="n_extract",
        attempt_id="att_01",
        node_contract_snapshot=ExecutionContract(
            contract_id="ctr_exec",
            goal="x",
            model_policy=NodeModelPolicy(primary_model_profile_id="claude-sonnet-default"),
            prompt=PromptSection(user_prompt_template="x"),
        ),
        context_pack=ContextPack(
            pack_id="ctxp_inside",
            node_id="n_extract",
            attempt_id="att_01",
            run_id="run_01",
            node_goal="x",
            fragments=[_fragment(fid="frag_x", kind="node_goal", tokens=10, required=True)],
            budget=_budget(),
            provenance=_provenance(),
        ),
        effective_model_profile_id="claude-sonnet-default",
        cancel_token="tok_abc_01",
        correlation_id="trace_xyz",
    )
    assert pack.schema_version == "0.1.0"
    assert pack.node_contract_snapshot.contract_kind == "execution"
