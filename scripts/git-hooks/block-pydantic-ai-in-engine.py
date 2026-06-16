#!/usr/bin/env python
"""block-pydantic-ai-in-engine.py — 拦截 Engine / Compiler / MCCL / nodes / memory 等模块直接 import pydantic_ai。

ADR-0002：所有 LLM 调用必须经 AgentAdapter 协议；仅允许在 cw_runtime/adapters/ 子包内 import。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

IMPORT_RE = re.compile(r"^\s*(import|from)\s+pydantic_ai(\s|\.|$)", re.MULTILINE)
ADAPTERS_PREFIX = "cw_runtime/adapters/"


def main(argv: list[str]) -> int:
    bad = 0
    for raw in argv[1:]:
        normalized = raw.replace("\\", "/")
        if ADAPTERS_PREFIX in normalized:
            continue

        path = Path(raw)
        if not path.is_file():
            continue

        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        for match in IMPORT_RE.finditer(text):
            line_no = text[: match.start()].count("\n") + 1
            print(f"❌ {raw}:{line_no}  pydantic_ai import 非法（ADR-0002）", file=sys.stderr)
            bad += 1

    if bad:
        print("", file=sys.stderr)
        print("   ADR-0002：Engine / Compiler / MCCL / nodes 等模块禁止直接依赖 pydantic_ai。", file=sys.stderr)
        print("   所有 LLM 调用必须经 cw_runtime.adapters.base.AgentAdapter 协议。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
