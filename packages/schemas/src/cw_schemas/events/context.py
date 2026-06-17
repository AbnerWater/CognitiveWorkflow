"""cw_schemas.events.context — context / planning / artifact 三大 category envelope。

来源：specs/schemas/stream_event.md §3.7 / §3.8 / §3.9
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from ..ids import LooseId
from ..types import EventCategory, PlanningStatus
from .base import StreamEventBase
from .event_types import ArtifactEventType, ContextEventType, PlanningEventType


class ContextEvent(StreamEventBase):
    """ContextPack / EvidencePack 构建过程（§3.7）。"""

    category: Literal[EventCategory.CONTEXT] = EventCategory.CONTEXT
    type: ContextEventType
    context_pack_id: LooseId | None = None
    evidence_pack_id: LooseId | None = None


class PlanningEvent(StreamEventBase):
    """PlanningSession 状态机投影（§3.8 + planning_session.md §2.8）。

    与 PlanningSession 状态机一一对应；`planning.session.transition` 必发，
    其它 4 类与状态卡片对应。
    """

    category: Literal[EventCategory.PLANNING] = EventCategory.PLANNING
    type: PlanningEventType
    planning_session_id: LooseId | None = None
    from_status: PlanningStatus | None = Field(default=None, description="仅 transition 事件填")
    to_status: PlanningStatus | None = Field(default=None, description="仅 transition 事件填")


class ArtifactEvent(StreamEventBase):
    """节点产物 / 文件 emit（§3.9）。"""

    category: Literal[EventCategory.ARTIFACT] = EventCategory.ARTIFACT
    type: ArtifactEventType
    artifact_id: LooseId | None = None


__all__ = ["ArtifactEvent", "ContextEvent", "PlanningEvent"]
