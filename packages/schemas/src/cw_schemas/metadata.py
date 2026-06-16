"""cw_schemas.metadata — 命名空间化 metadata 工具。

D-WG-4 决定：所有 model 的 `metadata` 字段必须命名空间化为 `metadata.<plugin_id>.<key>`，
非命名空间字段进入 `metadata.cw.<key>` 内部保留段。

本模块提供：
- `MetadataDict` 类型别名（语义提示）
- `validate_namespaced_metadata` 校验函数
- `CW_INTERNAL_NAMESPACE = "cw"` 常量

L2 校验由各模型在 `model_validator(mode='after')` 内调用，触发错误码 `WG_L2_METADATA_NOT_NAMESPACED`。
"""

from __future__ import annotations

import re
from typing import Any, TypeAlias

# 允许的命名空间 key：[a-z][a-z0-9_]{1,31}
_NAMESPACE_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")

CW_INTERNAL_NAMESPACE: str = "cw"
"""CW 内部保留命名空间。第三方插件不允许使用 `cw.*`。"""

MetadataDict: TypeAlias = dict[str, Any]
"""metadata 字段的标称类型。建议结构：{namespace: {key: value}}。"""


def is_valid_namespace(name: str) -> bool:
    """检查命名空间字符串是否合法。"""
    return bool(_NAMESPACE_RE.fullmatch(name))


def validate_namespaced_metadata(
    metadata: MetadataDict,
    *,
    allow_top_level_cw_keys: bool = False,
) -> list[str]:
    """校验 metadata 是否命名空间化。

    Args:
        metadata: 待校验对象
        allow_top_level_cw_keys: 是否允许形如 `metadata.cw_runtime` 这种历史习惯（默认 False）

    Returns:
        发现的不合规 key 列表；空列表代表合规
    """
    if not isinstance(metadata, dict):
        return [f"metadata 必须是 dict，实际：{type(metadata).__name__}"]

    violations: list[str] = []
    for ns, value in metadata.items():
        if not isinstance(ns, str):
            violations.append(f"metadata 顶层 key 必须是 string，实际：{ns!r}")
            continue

        if not is_valid_namespace(ns):
            if allow_top_level_cw_keys and ns == CW_INTERNAL_NAMESPACE:
                continue  # 兜底放宽
            violations.append(f"namespace 不合法：{ns!r}（要求 [a-z][a-z0-9_]{{1,31}}）")
            continue

        if not isinstance(value, dict):
            violations.append(f"metadata.{ns} 必须是 dict（嵌套 key/value 形式），实际：{type(value).__name__}")
            continue

    return violations


def merge_metadata(*sources: MetadataDict) -> MetadataDict:
    """合并多份 metadata；同一 namespace 的 key 后者覆盖前者。"""
    merged: MetadataDict = {}
    for src in sources:
        if not src:
            continue
        for ns, ns_value in src.items():
            if ns not in merged:
                merged[ns] = {}
            if isinstance(ns_value, dict):
                merged[ns].update(ns_value)
            else:
                # 不规范输入：直接覆盖（容错）
                merged[ns] = ns_value
    return merged


__all__ = [
    "CW_INTERNAL_NAMESPACE",
    "MetadataDict",
    "is_valid_namespace",
    "merge_metadata",
    "validate_namespaced_metadata",
]
