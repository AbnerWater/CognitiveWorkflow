"""cw_schemas.contract — NodeContract 6 类契约。

来源：specs/schemas/node_contract.md（v0.1.0 Accepted）

子模块布局：
- base.py        — NodeContractBase 公共字段
- prompts.py     — PromptSection
- requirements.py— ContextRequirement / EvidenceRequirement / ContextSelector
- tools.py       — SkillRef / MCPToolRef / ExtraValidatorRef
- policies.py    — NodeModelPolicy / RetryPolicy / ValidatorPolicy
- execution.py   — ExecutionContract
- evaluation.py  — EvaluationContract / EvaluationCriterion / PassCondition / FailCondition
- repair.py      — RepairContract / RepairStrategy
- human_gate.py  — HumanGateContract / HumanDecision
- tool.py        — ToolContract
- memory.py      — MemoryContract

discriminator = `contract_kind`，与 NodeType 一一对应（W1.2.7 内由 Engine compiler 验证）。
"""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

from .base import NodeContractBase
from .evaluation import EvaluationContract, EvaluationCriterion, FailCondition, PassCondition
from .execution import ExecutionContract
from .human_gate import HumanDecision, HumanGateContract
from .memory import MemoryContract
from .policies import NodeModelPolicy, RetryPolicy, ValidatorPolicy
from .prompts import PromptSection
from .repair import RepairContract, RepairStrategy
from .requirements import (
    ContextRequirement,
    ContextSelector,
    EvidenceRequirement,
    ProjectMemorySelector,
    ReferenceSelector,
    StaticTextSelector,
    UpstreamArtifactSelector,
    UserInputSelector,
)
from .tool import ToolContract
from .tools import ExtraValidatorRef, MCPToolRef, SkillRef

# =============================================================================
# Discriminated union：NodeContract
# =============================================================================

NodeContract = Annotated[
    ExecutionContract | EvaluationContract | RepairContract | HumanGateContract | ToolContract | MemoryContract,
    Field(discriminator="contract_kind"),
]
"""6 类 NodeContract 判别式联合（与 ContractKind 枚举一一对应）。"""


__all__ = [
    "ContextRequirement",
    "ContextSelector",
    "EvaluationContract",
    "EvaluationCriterion",
    "EvidenceRequirement",
    "ExecutionContract",
    "ExtraValidatorRef",
    "FailCondition",
    "HumanDecision",
    "HumanGateContract",
    "MCPToolRef",
    "MemoryContract",
    "NodeContract",
    "NodeContractBase",
    "NodeModelPolicy",
    "PassCondition",
    "ProjectMemorySelector",
    "PromptSection",
    "ReferenceSelector",
    "RepairContract",
    "RepairStrategy",
    "RetryPolicy",
    "SkillRef",
    "StaticTextSelector",
    "ToolContract",
    "UpstreamArtifactSelector",
    "UserInputSelector",
    "UserInputSelector",
    "ValidatorPolicy",
]
