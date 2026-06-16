"""cw_schemas.contract.requirements — ContextRequirement & EvidenceRequirement.

来源：specs/schemas/node_contract.md §4
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..ids import LooseId

# =============================================================================
# ContextRequirement.selector — 5 类来源的判别式联合
# =============================================================================


class _SelectorBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UpstreamArtifactSelector(_SelectorBase):
    """从上游节点产物提取数据。"""

    source_kind: Literal["upstream_artifact"] = "upstream_artifact"
    from_node_id: LooseId = Field(..., description="上游节点 ID")
    artifact_field: str = Field(..., min_length=1, description="JSONPath；如 'research_questions[*]'")
    artifact_run_id: str | None = Field(default=None, description="哪一次 Run；默认当前 run")


class ProjectMemorySelector(_SelectorBase):
    """读取项目级 Memory key。"""

    source_kind: Literal["project_memory"] = "project_memory"
    memory_key: str = Field(..., min_length=1)


class ReferenceSelector(_SelectorBase):
    """读取 ReferenceLibrary 资料；reference_id 可为 '$auto'（由 EvidenceBuilder 候选检索）。"""

    source_kind: Literal["reference"] = "reference"
    reference_id: str = Field(..., min_length=1)
    chunk_filter: dict[str, Any] | None = Field(default=None, description="可选 chunk 过滤条件")


class StaticTextSelector(_SelectorBase):
    """直接嵌入静态文本。"""

    source_kind: Literal["static_text"] = "static_text"
    text: str


class UserInputSelector(_SelectorBase):
    """读取 Run 启动时的初始输入字段。"""

    source_kind: Literal["user_input"] = "user_input"
    input_field: str = Field(..., min_length=1)


ContextSelector = Annotated[
    UpstreamArtifactSelector | ProjectMemorySelector | ReferenceSelector | StaticTextSelector | UserInputSelector,
    Field(discriminator="source_kind"),
]
"""5 类 ContextSelector 判别式联合（§4.1）。"""


# =============================================================================
# ContextRequirement
# =============================================================================


class ContextRequirement(BaseModel):
    """节点上下文需求（§4）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    key: str = Field(..., min_length=1, description="该上下文片段在 deps 中的访问键")
    kind: Literal["upstream_artifact", "project_memory", "reference", "static_text", "user_input"] = Field(
        ...,
        description="来源类型；与 selector.source_kind 必须一致",
    )
    selector: ContextSelector = Field(..., description="来源选择器")
    required: bool = Field(default=True, description="缺失时是否阻塞节点")
    max_tokens: int | None = Field(default=None, ge=1, description="单片段 token 上限；超过由 ContextBuilder 摘要")
    summarize_if_over: bool = Field(default=True, description="超长时是否自动摘要")


# =============================================================================
# EvidenceRequirement（§1.1 evidence_requirements 字段）
# =============================================================================


class EvidenceRequirement(BaseModel):
    """事实性 / 研究类节点的证据要求。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    requirement_id: str = Field(default="", description="稳定 ID；运行时由 EvidenceBuilder 反查")
    required_for: str = Field(
        ...,
        min_length=1,
        description="引用产物字段路径（JSONPath）；例：'research_questions[*].source_evidence_ids'",
    )
    min_coverage: float = Field(default=1.0, ge=0.0, le=1.0, description="最小覆盖率阈值")
    min_evidences: int = Field(default=1, ge=0, description="该 requirement 所需的最少 evidence 数量")


__all__ = [
    "ContextRequirement",
    "ContextSelector",
    "EvidenceRequirement",
    "ProjectMemorySelector",
    "ReferenceSelector",
    "StaticTextSelector",
    "UpstreamArtifactSelector",
    "UserInputSelector",
]
