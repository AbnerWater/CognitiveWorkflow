"""cw_schemas.packs.execution_pack — ExecutionPack（agent_adapter.md §3.1）。

Engine → Adapter 的唯一输入对象。把 NodeContract / ContextPack / EvidencePack / 模型与重试策略 /
Workflow 上下文压成单一 JSON-serializable 容器（D-AA-3）。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ..contract import NodeContract, ValidatorPolicy
from ..contract.policies import RetryPolicy
from ..ids import LooseId
from ..metadata import MetadataDict
from .context_pack import ContextPack, OutputFormatHint
from .evidence_pack import EvidencePack

EXECUTION_PACK_SCHEMA_VERSION = "0.1.0"


class UsageLimits(BaseModel):
    """token / cost 限流（agent_adapter.md §3.1 字段 usage_limits）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    max_input_tokens: int | None = Field(default=None, ge=1)
    max_output_tokens: int | None = Field(default=None, ge=1)
    max_total_tokens: int | None = Field(default=None, ge=1)
    max_cost_usd: float | None = Field(default=None, ge=0.0)


class PromptOverlay(BaseModel):
    """RepairPatch 产生的 prompt 修订（叠加在 NodeContract.prompt 之上）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    append_to_system_prompt: list[str] = Field(default_factory=list)
    append_to_instructions: list[str] = Field(default_factory=list)
    append_to_user_prompt_template: list[str] = Field(default_factory=list)
    extra_few_shot_examples: list[dict[str, Any]] = Field(default_factory=list)
    source_patch_id: LooseId | None = Field(default=None, description="来源 RepairPatch.patch_id")


class ToolsetSpec(BaseModel):
    """解析后的 Skill / MCP / 内置工具列表（Adapter 内部构造 CombinedToolset 用）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    builtin_tools: list[str] = Field(default_factory=list)
    skill_ids_resolved: list[str] = Field(default_factory=list, description="带版本：'skill_id@version'")
    mcp_server_ids: list[str] = Field(default_factory=list)


class ExecutionPack(BaseModel):
    """Engine → Adapter 的单一输入对象（agent_adapter.md §3.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    pack_id: LooseId
    schema_version: str = Field(default=EXECUTION_PACK_SCHEMA_VERSION)
    run_id: LooseId
    node_id: LooseId
    attempt_id: LooseId

    node_contract_snapshot: NodeContract = Field(..., description="本次 attempt 生效的契约（已应用 overlay）")
    context_pack: ContextPack
    evidence_pack: EvidencePack | None = None

    effective_prompt_overlay: PromptOverlay | None = Field(
        default=None, description="RepairPatch 产生的 prompt 修订；overlay 已合并入 contract.prompt"
    )
    effective_model_settings: dict[str, Any] = Field(
        default_factory=dict,
        description="已合并 ModelPolicy / RepairPatch / 全局策略 的最终设置",
    )
    effective_model_profile_id: str = Field(..., min_length=1, description="ModelRouter 已解析的具体 ProfileID")
    effective_toolsets: ToolsetSpec = Field(default_factory=ToolsetSpec)

    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy, description="已合并节点 / 全局")
    validator_policy: ValidatorPolicy = Field(default_factory=ValidatorPolicy)
    output_format_hint: OutputFormatHint | None = None

    usage_limits: UsageLimits | None = None

    cancel_token: str = Field(..., min_length=1, description="Engine 用于触发 cancel 的 token；attempt 内唯一")
    correlation_id: str = Field(..., min_length=1, description="OTel TraceID")

    metadata: MetadataDict = Field(default_factory=dict)


__all__ = [
    "EXECUTION_PACK_SCHEMA_VERSION",
    "ExecutionPack",
    "PromptOverlay",
    "ToolsetSpec",
    "UsageLimits",
]
