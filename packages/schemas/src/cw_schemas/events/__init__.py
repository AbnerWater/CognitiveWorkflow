"""cw_schemas.events — StreamEvent envelope（12 大 category）。

来源：specs/schemas/stream_event.md（v0.1.0 Accepted）

discriminator = `category`，每类 envelope 内的 `type` 由 Literal 进一步收紧。

提供两类入口：
- `StreamEvent`：判别式联合，运行时通过 `category` 字段反序列化为正确 envelope 子类
- `validate_stream_event(dict) -> StreamEvent`：辅助函数，触发 Pydantic 校验并返回具体子类
"""

from __future__ import annotations

from typing import Annotated, Any, Self, cast, get_args

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator
from pydantic_core import PydanticCustomError

from ..types import EventCategory
from .base import STREAM_EVENT_SCHEMA_VERSION, StreamEventBase
from .context import ArtifactEvent, ContextEvent, PlanningEvent
from .evaluation import EvaluationEvent, HumanEvent, RepairEvent
from .event_types import (
    ArtifactEventType,
    ContextEventType,
    ErrorEventType,
    EvaluationEventType,
    HumanEventType,
    LifecycleEventType,
    MetricEventType,
    ModelEventType,
    PlanningEventType,
    RepairEventType,
    SystemEventType,
    ToolEventType,
)
from .lifecycle import LifecycleEvent, ModelEvent, ToolEvent
from .system import ErrorEvent, MetricEvent, SystemEvent

StreamEvent = Annotated[
    LifecycleEvent
    | ModelEvent
    | ToolEvent
    | EvaluationEvent
    | RepairEvent
    | HumanEvent
    | ContextEvent
    | PlanningEvent
    | ArtifactEvent
    | MetricEvent
    | ErrorEvent
    | SystemEvent,
    Field(discriminator="category"),
]
"""12 大 category envelope 的判别式联合。"""


# 用于 `model_validate` 入口（dict → StreamEvent 子类）
_STREAM_EVENT_ADAPTER: TypeAdapter[Any] = TypeAdapter(StreamEvent)

_EVENT_TYPES_BY_CATEGORY: dict[EventCategory, set[str]] = {
    EventCategory.LIFECYCLE: set(get_args(LifecycleEventType)),
    EventCategory.MODEL: set(get_args(ModelEventType)),
    EventCategory.TOOL: set(get_args(ToolEventType)),
    EventCategory.EVALUATION: set(get_args(EvaluationEventType)),
    EventCategory.REPAIR: set(get_args(RepairEventType)),
    EventCategory.HUMAN: set(get_args(HumanEventType)),
    EventCategory.CONTEXT: set(get_args(ContextEventType)),
    EventCategory.PLANNING: set(get_args(PlanningEventType)),
    EventCategory.ARTIFACT: set(get_args(ArtifactEventType)),
    EventCategory.METRIC: set(get_args(MetricEventType)),
    EventCategory.ERROR: set(get_args(ErrorEventType)),
    EventCategory.SYSTEM: set(get_args(SystemEventType)),
}


class _StreamEventTypeGuard(BaseModel):
    """给 validate_stream_event 提供 spec 错误码，不参与导出。"""

    model_config = ConfigDict(extra="ignore")

    category: EventCategory
    type: str

    @model_validator(mode="after")
    def _check_type_allowed_for_category(self) -> Self:
        allowed = _EVENT_TYPES_BY_CATEGORY[self.category]
        if self.type not in allowed:
            raise PydanticCustomError(
                "SE_BUILD_BAD_TYPE",
                f"StreamEvent.type={self.type!r} 不属于 category={self.category.value!r}",
            )
        return self


def validate_stream_event(data: dict[str, Any]) -> StreamEventBase:
    """带顶层不变量的 StreamEvent 解析入口。

    返回的对象类型是某个 envelope 子类（运行期由 discriminator 决定）。
    错误统一由 Pydantic 包装为 ValidationError。
    """
    _StreamEventTypeGuard.model_validate(data)
    return cast(StreamEventBase, _STREAM_EVENT_ADAPTER.validate_python(data))


__all__ = [
    "STREAM_EVENT_SCHEMA_VERSION",
    "ArtifactEvent",
    "ArtifactEventType",
    "ContextEvent",
    "ContextEventType",
    "ErrorEvent",
    "ErrorEventType",
    "EvaluationEvent",
    "EvaluationEventType",
    "HumanEvent",
    "HumanEventType",
    "LifecycleEvent",
    "LifecycleEventType",
    "MetricEvent",
    "MetricEventType",
    "ModelEvent",
    "ModelEventType",
    "PlanningEvent",
    "PlanningEventType",
    "RepairEvent",
    "RepairEventType",
    "StreamEvent",
    "StreamEventBase",
    "SystemEvent",
    "SystemEventType",
    "ToolEvent",
    "ToolEventType",
    "validate_stream_event",
]
