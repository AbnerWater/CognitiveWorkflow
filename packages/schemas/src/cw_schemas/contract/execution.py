"""cw_schemas.contract.execution — ExecutionContract（§1.2.1）。

execution_task 节点的契约——公共字段 + 默认 prompt 必填即可。
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import model_validator

from .base import NodeContractBase


class ExecutionContract(NodeContractBase):
    """执行任务契约。

    公共字段已足够；output_schema 是节点要交付的业务产物 schema。
    """

    contract_kind: Literal["execution"] = "execution"

    @model_validator(mode="after")
    def _check_prompt_required(self) -> Self:
        # execution 节点必须有 prompt
        if self.prompt is None:
            from pydantic_core import PydanticCustomError

            raise PydanticCustomError(
                "NC_L2_MISSING_PROMPT",
                "execution contract 必须提供 prompt",
            )
        return self


__all__ = ["ExecutionContract"]
