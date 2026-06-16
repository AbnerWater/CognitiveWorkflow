"""cw_schemas.packs.fragments — ContextFragment + FragmentSource + FragmentTransformation.

来源：specs/schemas/context_pack.md §2
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..ids import LooseId
from ..metadata import MetadataDict
from ..types import Priority

# =============================================================================
# FragmentSource — 8 类来源（§2.3）
# =============================================================================


class _FragmentSourceBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UpstreamArtifactSource(_FragmentSourceBase):
    source_kind: Literal["upstream_artifact"] = "upstream_artifact"
    from_node_id: LooseId
    artifact_field: str = Field(..., min_length=1, description="支持 JSONPath；如 'research_questions[*]'")
    artifact_run_id: str | None = None


class ReferenceChunkSource(_FragmentSourceBase):
    source_kind: Literal["reference"] = "reference"
    reference_id: str = Field(..., min_length=1)
    chunk_id: str = Field(..., min_length=1)
    chunk_index: int = Field(..., ge=0)
    position: dict[str, int] | None = Field(default=None, description="{ start, end } 在原文中的字符或 token 偏移")
    similarity_score: float | None = Field(default=None, ge=0.0, le=1.0)


class ProjectMemorySource(_FragmentSourceBase):
    source_kind: Literal["project_memory"] = "project_memory"
    memory_key: str = Field(..., min_length=1)
    memory_version: str | None = None


class EvidenceFragmentSource(_FragmentSourceBase):
    """ContextFragment.source 中的 evidence 来源；指向 EvidencePack 内某条 Evidence。"""

    source_kind: Literal["evidence"] = "evidence"
    evidence_pack_id: LooseId
    evidence_id: str = Field(..., min_length=1)


class UserInputSource(_FragmentSourceBase):
    source_kind: Literal["user_input"] = "user_input"
    input_field: str = Field(..., min_length=1)


class StaticTextSource(_FragmentSourceBase):
    source_kind: Literal["static_text"] = "static_text"
    contract_field_path: str = Field(..., min_length=1, description="如 'context_requirements[2]'")


class InjectedSource(_FragmentSourceBase):
    """Capability / ReflectionMemory 等中间件注入。"""

    source_kind: Literal["injected"] = "injected"
    injected_by: str = Field(..., min_length=1, description="capability_id / reflection_memory / planner")
    reason: str = Field(default="")


class FailureHistorySource(_FragmentSourceBase):
    """过往 attempts 失败摘要（仅 repair / re-run 节点）。"""

    source_kind: Literal["failure_history"] = "failure_history"
    attempt_ids: list[LooseId] = Field(..., min_length=1)


FragmentSource = Annotated[
    UpstreamArtifactSource
    | ReferenceChunkSource
    | ProjectMemorySource
    | EvidenceFragmentSource
    | UserInputSource
    | StaticTextSource
    | InjectedSource
    | FailureHistorySource,
    Field(discriminator="source_kind"),
]
"""8 类 FragmentSource 判别式联合。"""


# =============================================================================
# FragmentTransformation （§2.4）
# =============================================================================


class FragmentTransformation(BaseModel):
    """记录 Builder 对该片段做过的处理。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    kind: Literal[
        "as_is",
        "chunk",
        "summarize",
        "quote_extract",
        "truncate",
        "merge",
        "inline_resize",
    ] = Field(..., description="处理类型")
    details: dict[str, Any] = Field(default_factory=dict, description="处理细节")
    original_tokens: int = Field(..., ge=0)
    final_tokens: int = Field(..., ge=0)
    summarizer_model: str | None = Field(default=None, description="kind=summarize 时的模型")
    at: str = Field(..., description="ISO-8601")


# =============================================================================
# ContextFragment — 11 kinds（§2.1 + §2.2）
# =============================================================================

FragmentKindLiteral = Literal[
    "node_goal",
    "global_summary",
    "user_constraint",
    "upstream_artifact",
    "project_memory",
    "reference_chunk",
    "evidence",
    "static_text",
    "user_input",
    "instruction_addendum",
    "failure_history",
]


class ContextFragment(BaseModel):
    """上下文片段（§2.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    fragment_id: LooseId = Field(..., description="Pack 内唯一；可读 ID（如 frag_upstream_research_questions）")
    key: str = Field(..., min_length=1, description="在 template_inputs / deps 中的访问键")
    kind: FragmentKindLiteral = Field(..., description="11 类片段")
    priority: Priority = Field(..., description="压缩时丢弃顺序")
    required: bool = Field(..., description="true 时严禁被 drop（D-CP-2）")
    tokens_estimate: int = Field(..., ge=0, description="估算 token 数")
    tokens_actual: int | None = Field(default=None, ge=0, description="实际写入 prompt 后的 token 数")
    text: str | None = Field(default=None, description="已渲染的文本（多数 kind 用这个）")
    payload: dict[str, Any] | None = Field(default=None, description="结构化数据（upstream_artifact / evidence）")
    source: FragmentSource = Field(..., description="来源描述")
    transformation: FragmentTransformation | None = Field(default=None, description="Builder 处理记录")
    created_at: str = Field(..., description="ISO-8601")
    metadata: MetadataDict = Field(default_factory=dict)


__all__ = [
    "ContextFragment",
    "EvidenceFragmentSource",
    "FailureHistorySource",
    "FragmentKindLiteral",
    "FragmentSource",
    "FragmentTransformation",
    "InjectedSource",
    "ProjectMemorySource",
    "ReferenceChunkSource",
    "StaticTextSource",
    "UpstreamArtifactSource",
    "UserInputSource",
]
