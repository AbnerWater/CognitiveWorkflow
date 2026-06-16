"""cw_schemas — CognitiveWorkflow shared Pydantic v2 schemas.

单一真理来源（ADR-0003）：所有 CW 对象的 Pydantic 模型在此定义。
派生的 TS 类型在 `packages/schemas-ts`（@cw/schemas），由 `make codegen` 自动生成。

强约束：
- 仅依赖 pydantic v2
- 禁止依赖 cw_runtime / pydantic-ai / fastapi 等运行时库
- 内部禁止 IO 操作

本文件作为 M1.1 阶段的 stub，承担类型骨架；M1.2 milestone 内逐 spec 落实细节。
"""

from __future__ import annotations

__version__ = "0.1.0"
__all__ = ["__version__"]
