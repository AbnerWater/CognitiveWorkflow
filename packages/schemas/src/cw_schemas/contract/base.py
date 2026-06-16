"""cw_schemas.contract.base — NodeContractBase 公共字段。

来源：specs/schemas/node_contract.md §1.1
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ..ids import LooseId
from ..metadata import MetadataDict
from ..types import FailureType
from .policies import NodeModelPolicy, RetryPolicy, ValidatorPolicy
from .prompts import PromptSection
from .requirements import ContextRequirement, EvidenceRequirement
from .tools import MCPToolRef, SkillRef


class NodeContractBase(BaseModel):
    """所有 NodeContract 子类的公共字段（§1.1）。

    `contract_kind` 字段在子类用 Literal 收紧；本基类用 `str` 占位（与 nodes.py 同策略）。

    `prompt` 在 base 默认为 `None`，由各子类按需重写：
    - execution / evaluation / repair → 必填（@model_validator 检查）
    - tool → 禁止设置（mypy 不阻拦，运行时校验）
    - human_gate / memory → 不要求
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    contract_id: LooseId = Field(..., description="ULID/UUIDv7；与节点解耦的唯一 ID，便于跨 Workflow 复用模板")
    contract_kind: str = Field(..., description="子类用 Literal 收紧，必须 ∈ ContractKind 枚举值")
    goal: str = Field(..., min_length=1, max_length=2000, description="节点必须完成的业务目标（业务语言、非 prompt）")
    description: str | None = Field(default=None, max_length=4000, description="节点说明（Canvas / API 文档使用）")

    # 输入 / 输出 schema：M1.2 用 dict[str, Any] 承载 JSON Schema 对象；M1.3 起可考虑用 jsonschema-rs 校验形态
    input_schema: dict[str, Any] = Field(default_factory=dict, description="节点入参 JSON Schema")
    output_schema: dict[str, Any] = Field(default_factory=dict, description="节点产物 JSON Schema")

    context_requirements: list[ContextRequirement] = Field(
        default_factory=list,
        description="节点对上下文的需求；详见 §4",
    )
    evidence_requirements: list[EvidenceRequirement] = Field(
        default_factory=list,
        description="仅事实性 / 研究类节点",
    )

    prompt: PromptSection | None = Field(
        default=None,
        description="提示词三层结构；execution/evaluation/repair 必填，tool/memory 不允许设置",
    )

    allowed_tools: list[str] = Field(default_factory=list, description="内置工具白名单")
    skills: list[SkillRef] = Field(default_factory=list, description="启用的 Skill")
    mcp_tools: list[MCPToolRef] = Field(default_factory=list, description="可调用的 MCP 工具")

    model_policy: NodeModelPolicy = Field(..., description="节点级模型策略（覆盖 WorkflowModelPolicy）")
    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy, description="节点级重试")
    validator_policy: ValidatorPolicy = Field(default_factory=ValidatorPolicy, description="输出校验策略")

    failure_taxonomy: list[FailureType] = Field(
        default_factory=lambda: list(FailureType),
        description="关注的失败类型子集（D-FT-6：未声明则全 9 类；不在子集内的失败归 unknown）",
    )

    forbid_remote_models: bool = Field(default=False, description="标记敏感节点；与 WorkflowModelPolicy 配合")
    requires_human_approval: bool = Field(
        default=False,
        description="高风险节点：成功也走 human_checkpoint（D-NC-5）",
    )
    metadata: MetadataDict = Field(default_factory=dict, description="命名空间化扩展字段")


__all__ = ["NodeContractBase"]
