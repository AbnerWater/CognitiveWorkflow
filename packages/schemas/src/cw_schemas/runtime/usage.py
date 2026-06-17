"""cw_schemas.runtime.usage — RunUsage（与 Pydantic AI RunUsage 兼容）。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class RunUsage(BaseModel):
    """模型调用 token / cost 用量。

    字段与 Pydantic AI `RunUsage` 兼容，便于 Adapter 直接转译。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cache_creation_input_tokens: int = Field(default=0, ge=0)
    cache_read_input_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)
    requests: int = Field(default=0, ge=0)
    est_cost_usd: float | None = Field(default=None, ge=0.0)


__all__ = ["RunUsage"]
