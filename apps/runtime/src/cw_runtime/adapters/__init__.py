"""AgentAdapter protocol and built-in adapter foundations."""

from __future__ import annotations

from .base import (
    AdapterConfig,
    AdapterDescriptor,
    AdapterFactory,
    AdapterRegistry,
    AdapterRuntimeError,
    AgentAdapter,
    AgentAdapterErrorCode,
    AttemptHandle,
    AttemptResumption,
    HumanDecisionResolution,
    build_adapter_error,
)
from .claude_code_adapter import (
    ClaudeCodeAdapter,
    ClaudeCodeResumeRequest,
    ClaudeCodeRunRequest,
    ClaudeCodeSession,
    RawClaudeCodeEvent,
    SessionFactory,
    build_claude_code_descriptor,
)
from .pydantic_ai_adapter import (
    PydanticAIAdapter,
    PydanticAIResumeRequest,
    PydanticAIRunRequest,
    PydanticAISession,
    PydanticAISessionFactory,
    RawPydanticAIEvent,
    build_pydantic_ai_descriptor,
)

__all__ = [
    "AdapterConfig",
    "AdapterDescriptor",
    "AdapterFactory",
    "AdapterRegistry",
    "AdapterRuntimeError",
    "AgentAdapter",
    "AgentAdapterErrorCode",
    "AttemptHandle",
    "AttemptResumption",
    "ClaudeCodeAdapter",
    "ClaudeCodeResumeRequest",
    "ClaudeCodeRunRequest",
    "ClaudeCodeSession",
    "HumanDecisionResolution",
    "PydanticAIAdapter",
    "PydanticAIResumeRequest",
    "PydanticAIRunRequest",
    "PydanticAISession",
    "PydanticAISessionFactory",
    "RawClaudeCodeEvent",
    "RawPydanticAIEvent",
    "SessionFactory",
    "build_adapter_error",
    "build_claude_code_descriptor",
    "build_pydantic_ai_descriptor",
]
