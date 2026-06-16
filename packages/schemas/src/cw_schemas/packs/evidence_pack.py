"""cw_schemas.packs.evidence_pack — EvidencePack 顶层 + Coverage / Conflict / RequirementResolution.

来源：specs/schemas/evidence_pack.md §1 / §3 / §4 / §5
"""

from __future__ import annotations

from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..ids import LooseId
from ..metadata import MetadataDict
from ..types import EvidenceConflictKind, Severity
from .context_pack import CacheMeta
from .evidence import Evidence

EVIDENCE_PACK_SCHEMA_VERSION = "0.1.0"


class EvidenceCoverage(BaseModel):
    """覆盖度（§3.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    required_topics: list[str] = Field(default_factory=list, description="NodeContract 期望覆盖的主题")
    required_topics_covered: list[str] = Field(default_factory=list, description="已覆盖的主题（子集）")
    coverage_ratio: float = Field(..., ge=0.0, le=1.0)
    evidence_density: float = Field(default=0.0, ge=0.0, description="每千字结论文本的平均 evidence 数")
    avg_relevance: float = Field(..., ge=0.0, le=1.0)
    avg_confidence: float = Field(..., ge=0.0, le=1.0)
    unsupported_claim_estimates: int | None = Field(
        default=None,
        ge=0,
        description="由 CitationChecker 在 evaluation 阶段回填（D-EP-5：构建期不写入）",
    )

    @model_validator(mode="after")
    def _check_covered_subset(self) -> Self:
        for topic in self.required_topics_covered:
            if topic not in self.required_topics:
                raise PydanticCustomError(
                    "EP_BUILD_COVERAGE_INCONSISTENT",
                    f"required_topics_covered 中 {topic!r} 不在 required_topics 集合内",
                )
        return self


class EvidenceConflict(BaseModel):
    """证据冲突（§4.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    conflict_id: LooseId
    evidence_ids: list[str] = Field(..., min_length=2)
    kind: EvidenceConflictKind
    severity: Severity
    resolution_hint: str | None = None
    auto_detected_by: str | None = Field(default=None, description="检测器；如 evidence_builder/conflict_detector_v1")

    @model_validator(mode="after")
    def _check_blocker_has_hint(self) -> Self:
        if self.severity == Severity.BLOCKER and not self.resolution_hint:
            raise PydanticCustomError(
                "EP_BUILD_BLOCKER_CONFLICT_UNRESOLVED",
                f"conflict_id={self.conflict_id} severity=blocker 但缺 resolution_hint",
            )
        return self


class RequirementResolution(BaseModel):
    """RequirementResolution（§5.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    requirement_id: str = Field(..., min_length=1, description="NodeContract 中该 requirement 的稳定 ID")
    required_for: str = Field(..., min_length=1, description="引用产物字段路径（JSONPath）")
    min_coverage: float = Field(..., ge=0.0, le=1.0)
    actual_coverage: float = Field(..., ge=0.0, le=1.0)
    satisfied: bool
    evidence_ids: list[str] = Field(default_factory=list, description="用于满足该 requirement 的 evidence 子集")


class EvidenceProvenance(BaseModel):
    """Pack 产生来源（§5.2）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    builder_version: str = Field(..., description="EvidenceBuilder 版本")
    built_at: str = Field(..., description="ISO-8601")
    embedding_model: str | None = Field(default=None, description="如 bge-m3")
    re_ranker_model: str | None = Field(default=None, description="如 claude-haiku-rerank")
    reference_index_snapshot_id: str = Field(..., min_length=1)
    requirements_hash: str = Field(..., min_length=1)
    pack_hash: str = Field(..., min_length=1, description="EvidencePack 整体（去时间戳）的稳定 hash")


class EvidencePack(BaseModel):
    """事实声明的来源边界（§1.1）。

    强约束（D-EP-1）：写入完成后到 attempt 结束之间不得修改。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    pack_id: LooseId
    schema_version: str = Field(default=EVIDENCE_PACK_SCHEMA_VERSION)
    node_id: LooseId
    attempt_id: LooseId
    run_id: LooseId
    purpose: str = Field(..., min_length=1, max_length=500, description="本 Pack 服务的事实性问题")
    evidences: list[Evidence] = Field(..., min_length=1)
    coverage: EvidenceCoverage
    conflicts: list[EvidenceConflict] = Field(default_factory=list)
    requirements_resolved: list[RequirementResolution] = Field(...)
    provenance: EvidenceProvenance
    cache_meta: CacheMeta | None = None
    metadata: MetadataDict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_invariants(self) -> Self:
        # schema_version 已知
        if self.schema_version != EVIDENCE_PACK_SCHEMA_VERSION:
            raise PydanticCustomError(
                "EP_BUILD_BAD_SCHEMA_VERSION",
                f"EvidencePack.schema_version={self.schema_version!r} 未知",
            )

        # evidence_id 唯一
        seen: set[str] = set()
        for e in self.evidences:
            if e.evidence_id in seen:
                raise PydanticCustomError(
                    "EP_BUILD_DUPLICATE_EVIDENCE_ID",
                    f"evidence_id 重复：{e.evidence_id}",
                )
            seen.add(e.evidence_id)

        # requirements_resolved 中 required=true 且 satisfied=false 视为不完整 → 构建期失败
        unresolved = [r for r in self.requirements_resolved if not r.satisfied and r.min_coverage > 0]
        if unresolved:
            raise PydanticCustomError(
                "EP_BUILD_REQUIREMENT_UNRESOLVED",
                f"以下 requirement 未满足：{[r.requirement_id for r in unresolved]}",
            )

        # conflict.evidence_ids 必须都在 Pack 内
        for c in self.conflicts:
            for eid in c.evidence_ids:
                if eid not in seen:
                    raise PydanticCustomError(
                        "EP_BUILD_CONFLICT_DANGLING_EVIDENCE",
                        f"conflict={c.conflict_id} 引用了不存在的 evidence_id={eid}",
                    )

        # required_topics_covered 中各 topic 必须能在 evidences 找到至少一条 relevance ≥ 0.5
        for topic in self.coverage.required_topics_covered:
            ok = any(topic in e.topics and e.relevance >= 0.5 for e in self.evidences)
            if not ok:
                raise PydanticCustomError(
                    "EP_BUILD_COVERAGE_INCONSISTENT",
                    f"topic={topic} 被标记为已覆盖，但无 evidence relevance ≥ 0.5 支撑",
                )

        return self


__all__ = [
    "EVIDENCE_PACK_SCHEMA_VERSION",
    "EvidenceConflict",
    "EvidenceCoverage",
    "EvidencePack",
    "EvidenceProvenance",
    "RequirementResolution",
]
