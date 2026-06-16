#!/usr/bin/env python
"""generate-json-schemas.py — Pydantic v2 → JSON Schema dump.

把 packages/schemas (cw_schemas) 内的全部 Pydantic 模型导出为 JSON Schema 文件，
落到 packages/schemas-ts/src/generated/json-schema/，作为 TS 类型生成的输入。

ADR-0003：Pydantic 是单一真理；TS 类型由 codegen 派生。

M1.1 stub:
- 当前 cw_schemas 仅含 __version__；后续 M1.2 milestone 内逐 spec 注册 Pydantic 模型
- 本脚本通过约定 cw_schemas.__exported_models__ 自动发现待导出模型

Usage:
    uv run python scripts/codegen/generate-json-schemas.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "packages" / "schemas-ts" / "src" / "generated" / "json-schema"

# sys.path 兜底：当 PowerShell 内已激活 conda base env，uv run 子进程的 PYTHONPATH 可能
# 被外部 site-packages 抢占，导致找不到本仓库 src 布局下的 cw_schemas。
# 为 codegen 脚本显式注入 packages/schemas/src，确保稳定。
SCHEMAS_SRC = ROOT / "packages" / "schemas" / "src"
if SCHEMAS_SRC.exists() and str(SCHEMAS_SRC) not in sys.path:
    sys.path.insert(0, str(SCHEMAS_SRC))


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        import cw_schemas
    except ImportError as exc:
        print(f"[codegen] failed to import cw_schemas: {exc}", file=sys.stderr)
        print(f"   sys.path[0:3] = {sys.path[0:3]}", file=sys.stderr)
        print("   Run `uv sync --all-extras` first.", file=sys.stderr)
        return 1

    exported = getattr(cw_schemas, "__exported_models__", {})

    if not exported:
        # M1.1 stub: cw_schemas not registered any models yet
        # M1.2 milestone will iterate cw_schemas.__exported_models__
        placeholder = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": "CognitiveWorkflow Schema (M1.1 placeholder)",
            "description": "M1.2 milestone will populate this directory with Pydantic-derived JSON Schemas.",
            "type": "object",
            "properties": {
                "cw_schemas_version": {"type": "string", "const": cw_schemas.__version__},
            },
            "required": ["cw_schemas_version"],
        }
        (OUTPUT_DIR / "_placeholder.json").write_text(
            json.dumps(placeholder, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"[codegen] M1.1 stub: wrote {OUTPUT_DIR / '_placeholder.json'}")
        return 0

    for name, model_cls in exported.items():
        schema = model_cls.model_json_schema()
        path = OUTPUT_DIR / f"{name}.json"
        path.write_text(
            json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"[codegen] {name} -> {path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
