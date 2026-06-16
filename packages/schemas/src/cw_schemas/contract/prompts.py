"""cw_schemas.contract.prompts — PromptSection 三层结构。

来源：specs/schemas/node_contract.md §3
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from ..types import TemplateEngine


class PromptSection(BaseModel):
    """节点提示词三层结构（§3）。

    与 Pydantic AI Agent 的 `system_prompt` / `instructions` / `user_prompt` 三层一致。
    模板变量解析顺序由 ContextBuilder 在装填阶段完成（D-CB-6）；
    此 schema 只承载文本+模板引擎声明。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    system_prompt: str | list[str] | None = Field(
        default=None,
        description="静态系统提示；多段时按顺序拼接",
    )
    instructions: str | list[str] | None = Field(
        default=None,
        description="动态指令；与 Pydantic AI `instructions` 对齐——支持 RunContext 闭包，编译时只允许引用 deps 字段",
    )
    user_prompt_template: str = Field(
        ...,
        min_length=1,
        description="节点开始时合成的用户提示词；模板支持变量插值 {{ var }}",
    )
    template_engine: TemplateEngine = Field(
        default=TemplateEngine.HANDLEBARS,
        description="模板渲染引擎（D-NC-1：默认 handlebars）",
    )


__all__ = ["PromptSection"]
