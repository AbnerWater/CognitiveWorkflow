"""cw_schemas.contract.tool — ToolContract.

来源：specs/schemas/node_contract.md §1.2.5
"""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from .base import NodeContractBase


class ToolContract(NodeContractBase):
    """确定性工具节点契约（§1.2.5）。

    `tool_task` 不调用 LLM；`prompt` / `model_policy` 字段对它无意义。
    L2 校验：发现 prompt 非空将报 NC_L2_TOOL_HAS_PROMPT。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    contract_kind: Literal["tool"] = "tool"

    tool_id: str = Field(..., min_length=1, description="ToolRegistry 中的工具 ID")
    args_schema: dict[str, Any] = Field(default_factory=dict, description="入参 JSON Schema")
    requires_sandbox: bool = Field(default=True, description="是否在沙箱中执行")

    @model_validator(mode="after")
    def _check_no_prompt(self) -> Self:
        if self.prompt is not None:
            raise PydanticCustomError(
                "NC_L2_TOOL_HAS_PROMPT",
                "tool contract 不应有 prompt（tool_task 不调用 LLM）",
            )
        return self


__all__ = ["ToolContract"]
