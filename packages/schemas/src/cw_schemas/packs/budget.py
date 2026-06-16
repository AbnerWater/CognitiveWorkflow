"""cw_schemas.packs.budget — ContextBudget / CompressionStrategy / CompressionLogEntry.

来源：specs/schemas/context_pack.md §4
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..types import CompressionAction, Priority


class CompressionStrategy(BaseModel):
    """压缩策略（context_pack.md §4.2）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    default_long_text_action: Literal[
        "truncate_head",
        "truncate_tail",
        "truncate_middle",
        "summarize",
        "quote_extract",
    ] = Field(default="summarize", description="文本片段长度超出预算时的默认动作")
    summarizer_model_profile_id: str | None = Field(default=None, description="用于摘要的模型；null 时用与节点同模型")
    summarize_min_tokens: int = Field(default=1024, ge=1, description="低于此值不摘要，改用 truncate_middle")
    drop_priority_threshold: Priority = Field(
        default=Priority.LOW, description="预算紧张时允许丢弃的优先级阈值（≤ 该级别可丢）"
    )
    keep_evidence_intact: bool = Field(
        default=True,
        description="EvidencePack 内 Evidence 默认不允许 summarize（D-CP-3 / D-EP-4）",
    )
    chunk_size_tokens: int = Field(default=512, ge=1, description="reference_chunk 目标尺寸")
    chunk_overlap_tokens: int = Field(default=64, ge=0, description="reference_chunk 重叠尺寸")


class ContextBudget(BaseModel):
    """节点级上下文预算（§4.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    model_context_window_tokens: int = Field(..., ge=1024, description="ModelProfile.max_context_tokens")
    reserved_for_output_tokens: int = Field(default=4096, ge=256, description="为模型输出预留")
    reserved_for_history_tokens: int = Field(default=0, ge=0, description="为 message_history 预留")
    reserved_for_tools_tokens: int = Field(default=2048, ge=0, description="为工具定义占位")
    safety_margin_tokens: int = Field(default=512, ge=0, description="误差保护")
    hard_limit_tokens: int = Field(..., ge=1024, description="= window - output - history - tools - safety_margin")
    compression_strategy: CompressionStrategy = Field(default_factory=CompressionStrategy, description="压缩策略")


class CompressionLogEntry(BaseModel):
    """压缩日志条目（§4.4）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    fragment_id: str = Field(..., min_length=1)
    action: CompressionAction
    before_tokens: int = Field(..., ge=0)
    after_tokens: int = Field(..., ge=0)
    reason: str = Field(default="", description="触发原因（budget_exceeded / policy_drop_low / 等）")
    at: str = Field(..., description="ISO-8601")


__all__ = ["CompressionLogEntry", "CompressionStrategy", "ContextBudget"]
