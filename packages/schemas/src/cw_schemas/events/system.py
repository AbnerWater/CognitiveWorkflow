"""cw_schemas.events.system — metric / error / system 三大 category envelope。

来源：specs/schemas/stream_event.md §3.10 / §3.11 / §3.12
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from ..types import AdapterErrorKind, EventCategory, FailureType
from .base import StreamEventBase
from .event_types import ErrorEventType, MetricEventType, SystemEventType


class MetricEvent(StreamEventBase):
    """周期性指标快照（§3.10）。

    频率上限 1 Hz / run（D-OB-3）；超过由 Engine 节流。
    """

    category: Literal[EventCategory.METRIC] = EventCategory.METRIC
    type: MetricEventType
    metrics: dict[str, float] = Field(default_factory=dict, description="名称 → 数值")


class ErrorEvent(StreamEventBase):
    """显式错误（§3.11）。

    与 AdapterError 字段对齐（agent_adapter.md §7）；
    `severity` 通常 = ERROR / FATAL（默认 INFO 由 Engine 在拼接时升级）。
    """

    category: Literal[EventCategory.ERROR] = EventCategory.ERROR
    type: ErrorEventType
    error_kind: AdapterErrorKind | None = None
    failure_type: FailureType | None = None
    message: str = Field(..., min_length=1)
    retryable: bool | None = None
    http_status: int | None = Field(default=None, ge=100, le=599)
    error_payload: dict[str, Any] | None = None


class SystemEvent(StreamEventBase):
    """系统级通知 / 心跳（§3.12）。

    `system.heartbeat` 默认 15s 一次（D-SE-3）。
    """

    category: Literal[EventCategory.SYSTEM] = EventCategory.SYSTEM
    type: SystemEventType


__all__ = ["ErrorEvent", "MetricEvent", "SystemEvent"]
