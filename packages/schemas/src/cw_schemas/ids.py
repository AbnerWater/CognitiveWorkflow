"""cw_schemas.ids — CW 全局 ID 字段约束。

ADR-0003 / D-WG-3 锁定的 ID 形态：

- `workflow_id / node_id / edge_id / run_id / attempt_id / pack_id / patch_id / eval_id`
  全部使用 ULID（默认）或 UUID v7 字符串
- ULID 字符串：26 位 Crockford Base32（[0-9A-HJKMNP-TV-Z]）
- UUID v7 字符串：36 位带 4 个连字符
- 草案阶段（WorkflowDraft）允许使用 stable hash + suffix（如 `n_extract`）；
  实例化为正式 Workflow 时由 Compiler 替换为 ULID（`workflow_graph.md` D-WG-1）

本模块不引入 `python-ulid` 依赖（leaf package 原则）；M1.3 起在 cw_runtime 内做 ULID 生成。
本模块仅提供"形态校验"——给定字符串是否符合 ULID / UUID v7 / 草案 ID。
"""

from __future__ import annotations

import re
from typing import Annotated, TypeAlias

from pydantic import StringConstraints

# ---- 模式 -----------------------------------------------------------------

# Crockford Base32（不含 I/L/O/U）；ULID 26 位；首字符 ≤ '7' 才能容纳 48 bit timestamp
_ULID_RE = re.compile(r"^[0-7][0-9A-HJKMNP-TV-Z]{25}$")

# UUID v7 — 标准 8-4-4-4-12；version nibble = 7
_UUID7_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# 草案阶段 ID — kebab/snake/dot/colon 友好；3..64 字符
_DRAFT_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_:.\-]{2,63}$")


# ---- 公共校验函数 ---------------------------------------------------------


def is_ulid(value: str) -> bool:
    """判断 ULID 形态。"""
    return bool(_ULID_RE.fullmatch(value))


def is_uuid_v7(value: str) -> bool:
    """判断 UUID v7 形态。"""
    return bool(_UUID7_RE.fullmatch(value))


def is_draft_id(value: str) -> bool:
    """判断草案阶段 ID（如 `n_extract` / `wf_draft.alpha`）。"""
    return bool(_DRAFT_ID_RE.fullmatch(value))


def is_valid_id(value: str) -> bool:
    """统一入口：通过 ULID / UUID v7 / 草案 任一即视为合法 CW ID。"""
    return is_ulid(value) or is_uuid_v7(value) or is_draft_id(value)


# ---- Pydantic 类型别名 -----------------------------------------------------

# 实例化后正式 Workflow / 运行时对象使用：仅接受 ULID / UUID v7。
StrictId: TypeAlias = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=26,
        max_length=36,
        pattern=r"^([0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$",
    ),
]

# 草案阶段使用：允许人类可读 ID + ULID + UUID v7。
LooseId: TypeAlias = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=3,
        max_length=64,
        # 注：组合 pattern 太复杂，pydantic-core regex 不支持 alternation with anchors well；
        # 此处放松到字符集 + 长度约束，由 model_validator 在具体模型层调用 is_valid_id 复核。
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_:.\-]{2,63}$",
    ),
]


__all__ = [
    "LooseId",
    "StrictId",
    "is_draft_id",
    "is_ulid",
    "is_uuid_v7",
    "is_valid_id",
]
