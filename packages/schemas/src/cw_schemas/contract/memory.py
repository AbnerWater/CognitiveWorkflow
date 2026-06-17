"""cw_schemas.contract.memory — MemoryContract.

来源：specs/schemas/node_contract.md §1.2.6
"""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import Field, model_validator

from .base import NodeContractBase


class MemoryContract(NodeContractBase):
    """memory_task 节点契约（§1.2.6）。

    与 D-RH-2 一致：仅 memory_task 节点或显式 UI 操作可写 memory.json。
    """

    contract_kind: Literal["memory"] = "memory"

    operation: Literal["read", "write", "upsert", "delete"] = Field(..., description="操作类型")
    target: Literal["project_memory", "reflection_memory"] = Field(..., description="操作对象")
    key_schema: dict[str, Any] = Field(default_factory=dict, description="操作 key 的 schema")
    value_schema: dict[str, Any] | None = Field(
        default=None,
        description="当 operation ∈ {write, upsert} 时必填",
    )

    @model_validator(mode="after")
    def _check_value_schema_required(self) -> Self:
        if self.operation in ("write", "upsert") and self.value_schema is None:
            raise ValueError(f"memory.operation={self.operation} 时必须提供 value_schema")
        # tool 同样规则：memory contract 不调用 LLM，不应有 prompt
        if self.prompt is not None:
            raise ValueError("memory contract 不应有 prompt（memory_task 不调用 LLM）")
        return self


__all__ = ["MemoryContract"]
