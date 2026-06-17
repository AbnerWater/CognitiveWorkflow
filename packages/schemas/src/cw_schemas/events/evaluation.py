"""cw_schemas.events.evaluation — evaluation / repair / human 三大 category envelope。

来源：specs/schemas/stream_event.md §3.4 / §3.5 / §3.6
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from ..ids import LooseId
from ..types import EventCategory
from .base import StreamEventBase
from .event_types import EvaluationEventType, HumanEventType, RepairEventType


class EvaluationEvent(StreamEventBase):
    """evaluation 节点 / criterion / 仲裁过程（§3.4）。"""

    category: Literal[EventCategory.EVALUATION] = EventCategory.EVALUATION
    type: EvaluationEventType
    eval_id: LooseId | None = None
    target_node_id: LooseId | None = Field(default=None, description="被评价的节点")


class RepairEvent(StreamEventBase):
    """repair 节点 / patch（§3.5）。"""

    category: Literal[EventCategory.REPAIR] = EventCategory.REPAIR
    type: RepairEventType
    patch_id: LooseId | None = None
    target_node_id: LooseId | None = None
    eval_id: LooseId | None = Field(default=None, description="导致本次 repair 的 evaluation")


class HumanEvent(StreamEventBase):
    """human_checkpoint / 输入要求（§3.6）。"""

    category: Literal[EventCategory.HUMAN] = EventCategory.HUMAN
    type: HumanEventType
    human_node_id: LooseId | None = None
    decision_key: str | None = Field(default=None, description="标准枚举或 custom_ 前缀")
    user_id: str | None = None


__all__ = ["EvaluationEvent", "HumanEvent", "RepairEvent"]
