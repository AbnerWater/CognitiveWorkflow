"""cw_schemas.events.lifecycle — lifecycle / model / tool 三大 category envelope。

来源：specs/schemas/stream_event.md §3.1 / §3.2 / §3.3
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from ..types import EventCategory
from .base import StreamEventBase
from .event_types import LifecycleEventType, ModelEventType, ToolEventType


class LifecycleEvent(StreamEventBase):
    """run / node / attempt 生命周期（§3.1）。"""

    category: Literal[EventCategory.LIFECYCLE] = EventCategory.LIFECYCLE
    type: LifecycleEventType


class ModelEvent(StreamEventBase):
    """模型调用（§3.2）。

    `model.text_delta` 由 stream_text 触发（D-SE-2 节流）；
    `model.request_completed` 末次必发。
    """

    category: Literal[EventCategory.MODEL] = EventCategory.MODEL
    type: ModelEventType
    model_profile_id: str | None = Field(default=None, description="模型 ID 冗余便于过滤")


class ToolEvent(StreamEventBase):
    """工具调用（§3.3）。"""

    category: Literal[EventCategory.TOOL] = EventCategory.TOOL
    type: ToolEventType
    tool_id: str | None = None
    invocation_id: str | None = Field(default=None, description="幂等键，用于配对 called/finished")


__all__ = ["LifecycleEvent", "ModelEvent", "ToolEvent"]
