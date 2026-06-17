"""cw_runtime — CognitiveWorkflow Python sidecar.

ADR 约束：
- engine / nodes / mccl / memory 等模块禁止 import pydantic_ai（ADR-0002）
- 所有 LLM 调用必须经 adapters/ 协议
- LangGraph 仅出现在 engine/（ADR-0004）

M1.3 起逐 spec 落实运行时实现。
"""

from __future__ import annotations

from .settings import API_PREFIX, RuntimeSettings

__version__ = "0.1.0"
__all__ = ["API_PREFIX", "RuntimeSettings", "__version__"]
