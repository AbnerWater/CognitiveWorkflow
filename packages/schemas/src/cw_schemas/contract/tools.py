"""cw_schemas.contract.tools — SkillRef / MCPToolRef / ExtraValidatorRef.

来源：specs/schemas/node_contract.md §5 / §8
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SkillRef(BaseModel):
    """启用的 Skill 引用（§5.1）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    skill_id: str = Field(..., min_length=1, description="SkillRegistry 中的 ID")
    version: str = Field(default="latest", description="锁定版本；运行时不存在则 L4 报 WG_L4_UNKNOWN_SKILL")
    params: dict[str, Any] = Field(default_factory=dict, description="Skill 参数")


class MCPToolRef(BaseModel):
    """MCP 工具引用（§5.2）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    server_id: str = Field(..., min_length=1, description="已配置的 MCP Server ID")
    tool_name: str = Field(default="*", description="限定可调用的 tool 名；'*' = 全部")
    requires_approval: bool = Field(default=False, description="调用前需用户批准")


class ExtraValidatorRef(BaseModel):
    """ValidatorPolicy.extra_validators 引用（§8）。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    validator_id: str = Field(
        ...,
        min_length=1,
        description="ToolRegistry 中已注册的校验器 ID（如 citation_checker / schema_strict_v2）",
    )
    options: dict[str, Any] = Field(default_factory=dict, description="校验器参数")


__all__ = ["ExtraValidatorRef", "MCPToolRef", "SkillRef"]
