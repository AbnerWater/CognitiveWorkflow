"""cw_schemas.events.base — StreamEventBase（envelope 公共字段）。

来源：specs/schemas/stream_event.md §1.1 envelope。

不变量（§1.1 / §11）：
- event_id 全局唯一
- seq 单调递增（同一 run / attempt 内由 Runtime 保证）
- category 与 type 一一对应（由各子类 Literal 强约束）
- payload 不含二进制，且序列化后不超过 64 KiB
"""

from __future__ import annotations

import json
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from ..ids import LooseId
from ..metadata import MetadataDict
from ..runtime.attempt import ArtifactRef
from ..types import (
    DisplayLevel,
    EventCategory,
    EventPhase,
    Sensitivity,
    StreamSeverity,
)

STREAM_EVENT_SCHEMA_VERSION = "0.1.0"


class StreamEventBase(BaseModel):
    """所有 StreamEvent envelope 的公共字段（§1.1）。

    `category` 字段在子类中由 `Literal[...]` 收紧；本基类用 `EventCategory` 占位。
    `type` 字段同理。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    # ---- envelope ----
    event_id: LooseId = Field(..., description="ULID/UUIDv7；全局唯一")
    schema_version: Literal["0.1.0"] = Field(default="0.1.0", description="本 spec 版本")
    seq: int = Field(..., ge=0, description="同 run / attempt 流内单调递增")
    parent_event_id: LooseId | None = None
    correlation_id: str | None = Field(default=None, description="OTel TraceID")
    run_id: LooseId
    node_id: LooseId | None = None
    attempt_id: LooseId | None = None

    category: EventCategory = Field(..., description="子类用 Literal 收紧")
    type: str = Field(..., min_length=1, description="子类用 Literal 收紧")
    phase: EventPhase | None = Field(default=None, description="节点 / Run / Attempt / Planning 生命周期相位")
    title: str = Field(..., min_length=1, max_length=200, description="前端折叠态显示标题")
    summary: str | None = Field(default=None, max_length=2000, description="折叠态副标题；不含敏感正文")
    content: str | None = Field(default=None, description="受限 Markdown 子集")
    payload: dict[str, Any] | None = Field(default=None, description="结构化载荷；大对象走 artifact_refs")
    artifact_refs: list[ArtifactRef] = Field(default_factory=list, description="关联产物引用")

    display_level: DisplayLevel = Field(default=DisplayLevel.DEFAULT, description="UI 折叠分级")
    severity: StreamSeverity = Field(default=StreamSeverity.INFO)
    sensitivity: Sensitivity = Field(default=Sensitivity.PROJECT, description="三级隐私分级（D-SE-5）")
    expandable: bool = Field(..., description="是否允许展开查看 detail")
    created_at: str = Field(..., description="ISO-8601 UTC（含毫秒）")

    # ---- 自由扩展 ----
    metadata: MetadataDict = Field(default_factory=dict, description="命名空间化扩展字段")

    @model_validator(mode="after")
    def _check_payload_shape(self) -> Self:
        if self.payload is None:
            return self

        if _contains_binary(self.payload):
            raise PydanticCustomError(
                "SE_BUILD_BINARY_IN_PAYLOAD",
                "payload 不允许包含二进制对象；大文件必须通过 artifact_refs 引用",
            )

        try:
            payload_bytes = json.dumps(self.payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except TypeError as exc:
            raise PydanticCustomError(
                "SE_BUILD_BAD_TYPE",
                f"payload 不是 JSON-serializable object：{exc}",
            ) from exc

        if len(payload_bytes) > 64 * 1024:
            raise PydanticCustomError(
                "SE_BUILD_PAYLOAD_TOO_LARGE",
                "payload 序列化后超过 64 KiB；大块内容必须改走 artifact_refs",
            )

        return self


def _contains_binary(value: Any) -> bool:
    if isinstance(value, bytes | bytearray | memoryview):
        return True
    if isinstance(value, dict):
        return any(_contains_binary(k) or _contains_binary(v) for k, v in value.items())
    if isinstance(value, list | tuple | set | frozenset):
        return any(_contains_binary(item) for item in value)
    return False


__all__ = ["STREAM_EVENT_SCHEMA_VERSION", "StreamEventBase"]
