"""cw_schemas.runtime.attempt — NodeAttempt + AttemptOutcome + AdapterError.

来源：specs/protocols/agent_adapter.md §6 / §7；runtime_harness.md §3.2
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ..ids import LooseId
from ..metadata import MetadataDict
from ..packs.context_pack import OutputFormatHint as _OutputFormatHintAlias  # 只用于类型同步, 不直接用
from ..types import AdapterErrorKind, AttemptState, FailureType
from .usage import RunUsage

# 解决 ruff F401：导入但不重导出
_ = _OutputFormatHintAlias  # type: ignore[unused-ignore]


class ArtifactRef(BaseModel):
    """节点产物引用（stream_event.md §1.5 + agent_adapter.md §6 复用）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    artifact_id: LooseId
    kind: str = Field(..., description="artifact / pack / evaluation / patch / file / image / chart")
    display_name: str = Field(..., min_length=1)
    mime_type: str | None = None
    size_bytes: int | None = Field(default=None, ge=0)
    preview_text: str | None = Field(default=None, max_length=500)
    path: str | None = Field(default=None, description="项目相对路径")


class AdapterError(BaseModel):
    """Adapter 错误结构化记录（agent_adapter.md §7）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    error_kind: AdapterErrorKind
    failure_type: FailureType = Field(..., description="对齐 8+1 类")
    message: str = Field(..., min_length=1)
    retryable: bool
    http_status: int | None = Field(default=None, ge=100, le=599)
    payload: dict[str, Any] | None = None


class AttemptProvenance(BaseModel):
    """attempt 源信息（agent_adapter.md §6.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    adapter_id: str = Field(..., min_length=1)
    adapter_version: str = Field(..., min_length=1)
    model_profile_id: str = Field(..., min_length=1)
    model_settings_hash: str = Field(..., min_length=1, description="实际使用的设置 hash")
    tools_used: list[str] = Field(default_factory=list, description="调用过的 tool / skill / mcp ID")
    evidence_pack_id: LooseId | None = None
    context_pack_id: LooseId
    pydantic_ai_traceparent: str | None = Field(default=None, description="Adapter=PydanticAI 时回填")
    outcome_hash: str = Field(..., min_length=1)


class AttemptOutcome(BaseModel):
    """Adapter.finalize() 返回的最终结果（agent_adapter.md §6）。

    与 NodeAttempt 一对一对应。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    attempt_id: LooseId
    run_id: LooseId
    node_id: LooseId
    state: AttemptState = Field(..., description="终态 COMPLETED / FAILED / CANCELLED")
    output: dict[str, Any] | None = Field(
        default=None, description="state=COMPLETED 时；符合 NodeContract.output_schema"
    )
    output_hash: str = Field(..., min_length=1, description="稳定 hash，用于 attempt 复盘")
    output_artifact_refs: list[ArtifactRef] = Field(default_factory=list)
    usage: RunUsage | None = None
    messages: list[dict[str, Any]] | None = Field(
        default=None,
        description="Pydantic AI 风格的完整对话记录；可选",
    )
    errors: list[AdapterError] = Field(default_factory=list)
    started_at: str = Field(..., description="ISO-8601")
    finished_at: str = Field(..., description="ISO-8601")
    duration_ms: int = Field(..., ge=0)
    provenance: AttemptProvenance


class NodeAttempt(BaseModel):
    """运行时 NodeAttempt（runtime_harness.md §3.2）。

    与 AttemptOutcome 的关系：NodeAttempt 是 Engine 持久化形态（含 attempt_index / state 流转 /
    overlay 引用 / 错误数组等运行期字段），AttemptOutcome 是 Adapter 返回的"一次性结果包"。
    Engine 会把 AttemptOutcome 拍扁后归并入 NodeAttempt。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    attempt_id: LooseId
    run_id: LooseId
    node_id: LooseId
    attempt_index: int = Field(..., ge=0, description="0-based；retry 后 +1")
    state: AttemptState
    started_at: str = Field(..., description="ISO-8601")
    finished_at: str | None = Field(default=None, description="ISO-8601；进入终态后写入")

    adapter_id: str = Field(..., min_length=1)
    adapter_version: str = Field(..., min_length=1)
    model_profile_id: str = Field(..., min_length=1)

    effective_prompt_overlay_ref: str | None = Field(
        default=None, description="指向 runs/<run_id>/overlays/<attempt_id>.json"
    )
    context_pack_id: LooseId
    evidence_pack_id: LooseId | None = None
    execution_pack_id: LooseId

    output_hash: str | None = None
    output_artifact_refs: list[ArtifactRef] = Field(default_factory=list)

    usage: RunUsage | None = None
    errors: list[AdapterError] = Field(default_factory=list)

    outcome_hash: str | None = None

    metadata: MetadataDict = Field(default_factory=dict)


__all__ = [
    "AdapterError",
    "ArtifactRef",
    "AttemptOutcome",
    "AttemptProvenance",
    "NodeAttempt",
]
