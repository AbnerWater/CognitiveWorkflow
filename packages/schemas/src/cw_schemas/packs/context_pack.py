"""cw_schemas.packs.context_pack — ContextPack 顶层 + Provenance / CacheMeta / OutputFormatHint.

来源：specs/schemas/context_pack.md §1 / §5 / §6 / §7
"""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..ids import LooseId
from ..metadata import MetadataDict
from .budget import CompressionLogEntry, ContextBudget
from .fragments import ContextFragment

CONTEXT_PACK_SCHEMA_VERSION = "0.1.0"


class CacheMeta(BaseModel):
    """缓存元（§6）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    fragment_cache_hits: list[str] = Field(default_factory=list, description="命中缓存的 fragment_id 列表")
    cache_namespace: str = Field(default="", description="如 <project_id>::context_fragment::<tokenizer>")
    ttl_seconds: int = Field(default=86400, ge=1, description="默认 24 小时")
    invalidated_by: list[str] = Field(default_factory=list, description="触发失效的事件")


class OutputFormatHint(BaseModel):
    """输出格式提示（§7）— 非强制；OutputFormatHint 不替代 ValidatorPolicy。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    kind: Literal["schema_only", "schema_with_example", "few_shot", "none"]
    example_count: int | None = Field(default=None, ge=0)
    examples: list[dict[str, Any]] = Field(default_factory=list, description="须满足 output_schema")
    style_notes: str | None = Field(default=None)


class ContextProvenance(BaseModel):
    """Pack 产生来源（§5）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    builder_version: str = Field(..., description="ContextBuilder 实现版本（SemVer）")
    built_at: str = Field(..., description="ISO-8601")
    model_profile_id: str = Field(..., min_length=1, description="当前节点目标模型")
    tokenizer: str = Field(..., min_length=1, description="如 cl100k_base / claude-tokenizer-v3")
    requirements_hash: str = Field(..., min_length=1, description="NodeContract.context_requirements 稳定 hash")
    inputs_hash: str = Field(..., min_length=1, description="上游 Artifact + Reference 快照 + Memory 版本的复合 hash")
    pack_hash: str = Field(..., min_length=1, description="ContextPack 整体的稳定 hash（D-CP-5：排除时间戳与缓存元）")


class ContextPack(BaseModel):
    """节点上下文包（§1.1）。

    强约束（D-CP-1）：写入完成后到 attempt 结束之间不得修改；变更须产生新版本 Pack。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    pack_id: LooseId
    schema_version: str = Field(default=CONTEXT_PACK_SCHEMA_VERSION)
    node_id: LooseId
    attempt_id: LooseId
    run_id: LooseId
    node_goal: str = Field(..., min_length=1, max_length=2000, description="复制自 NodeContract.goal")
    global_summary: str | None = Field(default=None, max_length=4000)
    user_constraints: list[str] = Field(default_factory=list, description="来自项目 Memory.constraints")
    fragments: list[ContextFragment] = Field(..., min_length=1, description="按 priority 降序")
    output_format_hint: OutputFormatHint | None = None
    template_inputs: dict[str, Any] = Field(default_factory=dict, description="渲染 user_prompt_template 时使用")
    budget: ContextBudget
    compression_log: list[CompressionLogEntry] = Field(default_factory=list)
    provenance: ContextProvenance
    cache_meta: CacheMeta | None = None
    metadata: MetadataDict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_invariants(self) -> Self:
        # §1.2: schema_version 已知
        if self.schema_version != CONTEXT_PACK_SCHEMA_VERSION:
            raise PydanticCustomError(
                "CP_BUILD_BAD_SCHEMA_VERSION",
                f"ContextPack.schema_version={self.schema_version!r} 未知；当前 {CONTEXT_PACK_SCHEMA_VERSION!r}",
            )

        # §1.2: fragment_id 不重复
        seen_ids: set[str] = set()
        for f in self.fragments:
            if f.fragment_id in seen_ids:
                raise PydanticCustomError(
                    "CP_BUILD_DUP_FRAGMENT_ID",
                    f"fragment_id 重复：{f.fragment_id}",
                )
            seen_ids.add(f.fragment_id)

        # §1.2: sum(tokens_estimate) ≤ budget.hard_limit_tokens
        total = sum(f.tokens_estimate for f in self.fragments)
        if total > self.budget.hard_limit_tokens:
            raise PydanticCustomError(
                "CP_BUILD_OVER_BUDGET",
                f"sum(tokens_estimate)={total} 超过 hard_limit_tokens={self.budget.hard_limit_tokens}",
            )

        # §1.2: required=true 片段不允许出现在 compression_log[action=dropped]
        dropped_ids = {entry.fragment_id for entry in self.compression_log if entry.action.value == "dropped"}
        required_ids = {f.fragment_id for f in self.fragments if f.required}
        leaked = dropped_ids & required_ids
        if leaked:
            raise PydanticCustomError(
                "CP_BUILD_DROP_REQUIRED_FORBIDDEN",
                f"required=true 片段被丢弃（违反 D-CP-2）：{sorted(leaked)}",
            )

        return self


__all__ = [
    "CONTEXT_PACK_SCHEMA_VERSION",
    "CacheMeta",
    "ContextPack",
    "ContextProvenance",
    "OutputFormatHint",
]
