"""cw_schemas.packs.evidence — Evidence + Citation.

来源：specs/schemas/evidence_pack.md §2 / §2.3
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from ..ids import LooseId
from ..metadata import MetadataDict
from ..types import Priority, SupportPolarity
from .evidence_source import EvidenceSource


class Evidence(BaseModel):
    """单条 Evidence（§2.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    evidence_id: str = Field(..., min_length=1, description="Pack 内唯一；建议格式 ev_<8 字符 base32>")
    claim: str = Field(..., min_length=1, max_length=500, description="该证据所支持的核心论点")
    quote: str = Field(..., min_length=1, max_length=4000, description="原文片段（精确引用，不允许改写）")
    paraphrase: str | None = Field(default=None, description="模型可读摘要；CitationChecker 优先使用 quote")
    source: EvidenceSource
    relevance: float = Field(..., ge=0.0, le=1.0, description="与节点 purpose 的相关性")
    confidence: float = Field(..., ge=0.0, le=1.0, description="来源可信度")
    support_polarity: SupportPolarity = Field(default=SupportPolarity.SUPPORTS, description="对 claim 的极性")
    topics: list[str] = Field(default_factory=list, description="主题标签，用于覆盖度统计")
    priority: Priority = Field(default=Priority.NORMAL, description="保留优先级")
    sensitive: bool = Field(default=False, description="敏感数据标记")
    tokens_estimate: int = Field(..., ge=0, description="渲染后 token 估算（含引用元信息）")
    created_at: str = Field(..., description="ISO-8601")
    metadata: MetadataDict = Field(default_factory=dict)


class Citation(BaseModel):
    """带 span 的精细引用（§2.3）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    evidence_id: str = Field(..., min_length=1)
    claim_text_span: dict[str, int] | None = Field(
        default=None, description="{ start, end } 在产物文本字段内的字符范围"
    )
    note: str | None = Field(default=None, description="解释如何被该 evidence 支撑")


# 重新导出 LooseId 便于 evidence_pack 等需要
__all__ = ["Citation", "Evidence", "LooseId"]
