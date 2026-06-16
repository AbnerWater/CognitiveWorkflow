"""cw_schemas.packs — ContextPack / EvidencePack / ExecutionPack 主链。

来源：specs/schemas/context_pack.md / evidence_pack.md / agent_adapter.md §3
"""

from __future__ import annotations

from .budget import CompressionLogEntry, CompressionStrategy, ContextBudget
from .context_pack import (
    CONTEXT_PACK_SCHEMA_VERSION,
    CacheMeta,
    ContextPack,
    ContextProvenance,
    OutputFormatHint,
)
from .evidence import Citation, Evidence
from .evidence_pack import (
    EVIDENCE_PACK_SCHEMA_VERSION,
    EvidenceConflict,
    EvidenceCoverage,
    EvidencePack,
    EvidenceProvenance,
    RequirementResolution,
)
from .evidence_source import (
    EvidenceSource,
    McpResourceEvidenceSource,
    ProjectMemoryEvidenceSource,
    ReferenceChunkEvidenceSource,
    ToolResultEvidenceSource,
    UpstreamArtifactEvidenceSource,
    UserInputEvidenceSource,
)
from .execution_pack import (
    EXECUTION_PACK_SCHEMA_VERSION,
    ExecutionPack,
    PromptOverlay,
    ToolsetSpec,
    UsageLimits,
)
from .fragments import (
    ContextFragment,
    EvidenceFragmentSource,
    FailureHistorySource,
    FragmentSource,
    FragmentTransformation,
    InjectedSource,
    ProjectMemorySource,
    ReferenceChunkSource,
    StaticTextSource,
    UpstreamArtifactSource,
    UserInputSource,
)

__all__ = [
    "CONTEXT_PACK_SCHEMA_VERSION",
    "EVIDENCE_PACK_SCHEMA_VERSION",
    "EXECUTION_PACK_SCHEMA_VERSION",
    "CacheMeta",
    "Citation",
    "CompressionLogEntry",
    "CompressionStrategy",
    "ContextBudget",
    "ContextFragment",
    "ContextPack",
    "ContextProvenance",
    "Evidence",
    "EvidenceConflict",
    "EvidenceCoverage",
    "EvidenceFragmentSource",
    "EvidencePack",
    "EvidenceProvenance",
    "EvidenceSource",
    "ExecutionPack",
    "FailureHistorySource",
    "FragmentSource",
    "FragmentTransformation",
    "InjectedSource",
    "McpResourceEvidenceSource",
    "OutputFormatHint",
    "ProjectMemoryEvidenceSource",
    "ProjectMemorySource",
    "PromptOverlay",
    "ReferenceChunkEvidenceSource",
    "ReferenceChunkSource",
    "RequirementResolution",
    "StaticTextSource",
    "ToolResultEvidenceSource",
    "ToolsetSpec",
    "UpstreamArtifactEvidenceSource",
    "UpstreamArtifactSource",
    "UsageLimits",
    "UserInputEvidenceSource",
    "UserInputSource",
]
