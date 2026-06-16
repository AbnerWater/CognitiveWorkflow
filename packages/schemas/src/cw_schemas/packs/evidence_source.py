"""cw_schemas.packs.evidence_source — EvidenceSource 7 类判别式联合。

来源：specs/schemas/evidence_pack.md §2.2
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..ids import LooseId


class _EvidenceSourceBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReferenceChunkEvidenceSource(_EvidenceSourceBase):
    source_kind: Literal["reference_chunk"] = "reference_chunk"
    reference_id: str = Field(..., min_length=1)
    reference_title: str = Field(..., min_length=1, description="冗余便于阅读")
    reference_url: str | None = None
    chunk_id: str = Field(..., min_length=1)
    chunk_index: int = Field(..., ge=0)
    position: dict[str, int] = Field(..., description="{start, end} 字符 / token 偏移")
    page: int | None = Field(default=None, ge=0)
    paragraph: int | None = Field(default=None, ge=0)


class UpstreamArtifactEvidenceSource(_EvidenceSourceBase):
    source_kind: Literal["upstream_artifact"] = "upstream_artifact"
    from_node_id: LooseId
    artifact_field: str = Field(..., min_length=1)
    artifact_run_id: str | None = None


class ToolResultEvidenceSource(_EvidenceSourceBase):
    source_kind: Literal["tool_result"] = "tool_result"
    tool_id: str = Field(..., min_length=1)
    invocation_id: str = Field(..., min_length=1)
    arguments_hash: str = Field(..., min_length=1, description="调用参数 hash，用于回放")
    invoked_at: str = Field(..., description="ISO-8601")


class McpResourceEvidenceSource(_EvidenceSourceBase):
    source_kind: Literal["mcp_resource"] = "mcp_resource"
    server_id: str = Field(..., min_length=1)
    resource_uri: str = Field(..., min_length=1, description="MCP Resource URI")
    resource_revision: str | None = None


class UserInputEvidenceSource(_EvidenceSourceBase):
    source_kind: Literal["user_input"] = "user_input"
    input_field: str = Field(..., min_length=1)
    user_id: str | None = None
    asserted_at: str = Field(..., description="ISO-8601")


class ProjectMemoryEvidenceSource(_EvidenceSourceBase):
    source_kind: Literal["project_memory"] = "project_memory"
    memory_key: str = Field(..., min_length=1)
    memory_version: str | None = None


EvidenceSource = Annotated[
    ReferenceChunkEvidenceSource
    | UpstreamArtifactEvidenceSource
    | ToolResultEvidenceSource
    | McpResourceEvidenceSource
    | UserInputEvidenceSource
    | ProjectMemoryEvidenceSource,
    Field(discriminator="source_kind"),
]
"""6 类 EvidenceSource 判别式联合（§2.2）。"""


__all__ = [
    "EvidenceSource",
    "McpResourceEvidenceSource",
    "ProjectMemoryEvidenceSource",
    "ReferenceChunkEvidenceSource",
    "ToolResultEvidenceSource",
    "UpstreamArtifactEvidenceSource",
    "UserInputEvidenceSource",
]
