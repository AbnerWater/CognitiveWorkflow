"""cw_schemas.contract.policies — NodeModelPolicy / RetryPolicy / ValidatorPolicy.

来源：specs/schemas/node_contract.md §6 / §7 / §8
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ..types import (
    ArbitrationMode,
    BackoffStrategy,
    ProviderKind,
    ValidatorMode,
)
from .tools import ExtraValidatorRef


class NodeModelPolicy(BaseModel):
    """节点级模型策略（§6）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    primary_model_profile_id: str = Field(
        ...,
        min_length=1,
        description="ModelProfile ID 或 'auto'（走 ModelRouter）",
    )
    escalation_chain: list[str] = Field(
        default_factory=list,
        description="节点级升级链；为空时使用 Workflow 全局链",
    )
    model_settings: dict[str, Any] = Field(
        default_factory=dict,
        description="temperature / top_p / max_tokens / reasoning_effort 等；与 Pydantic AI ModelSettings 兼容",
    )
    seed: int | None = Field(default=None, description="可重放 seed")
    candidate_count: int = Field(default=1, ge=1, description=">1 时进入 CandidateGenerator + 仲裁")
    forbid_provider_kinds: list[ProviderKind] = Field(
        default_factory=list,
        description="禁用的 Provider 类别",
    )


class RetryPolicy(BaseModel):
    """节点级重试策略（§7）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    max_attempts: int = Field(default=3, ge=1, description="节点的总尝试上限（含首次）")
    model_retries: int = Field(default=2, ge=0, description="模型层重试")
    output_validation_retries: int = Field(default=2, ge=0, description="输出校验失败的重试次数")
    tool_retries: int | dict[str, int] = Field(default=2, description="工具调用重试；可按 tool_id 单独设置")
    backoff: BackoffStrategy = Field(default=BackoffStrategy.EXPONENTIAL, description="重试间隔策略")
    timeout_seconds: int | None = Field(default=None, ge=1, description="单次 attempt 超时")
    escalation_after: int = Field(default=2, ge=1, description="第 N 次失败后允许 ModelRouter 升级模型")


class ValidatorPolicy(BaseModel):
    """节点输出校验策略（§8）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    mode: ValidatorMode = Field(
        default=ValidatorMode.STRICT,
        description="strict：严格校验；lenient：允许部分缺失但触发修复；programmatic_only：跳过 LLM 校验",
    )
    extra_validators: list[ExtraValidatorRef] = Field(
        default_factory=list,
        description="ToolRegistry 中已注册的额外校验器（D-NC-3：禁止执行用户代码）",
    )
    partial_output_allowed: bool = Field(
        default=False,
        description="流式中是否允许 partial output（与 Pydantic AI RunContext.partial_output 对齐）",
    )
    arbitration: ArbitrationMode = Field(
        default=ArbitrationMode.SINGLE_JUDGE,
        description="多候选 / 多 judge 仲裁模式（D-NC-7 v0.2 占位）",
    )


__all__ = ["NodeModelPolicy", "RetryPolicy", "ValidatorPolicy"]
