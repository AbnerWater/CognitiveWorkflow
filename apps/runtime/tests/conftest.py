"""Conftest for cw_runtime tests.

为了在 conda + uv mixed env 下稳定 import cw_runtime（src 布局），显式把 src 加到 sys.path。
"""

from __future__ import annotations

import sys
from pathlib import Path

# 加自身 src
SRC = Path(__file__).resolve().parents[1] / "src"
if SRC.exists() and str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

# 加 cw_schemas src（runtime 依赖它）
SCHEMAS_SRC = Path(__file__).resolve().parents[3] / "packages" / "schemas" / "src"
if SCHEMAS_SRC.exists() and str(SCHEMAS_SRC) not in sys.path:
    sys.path.insert(0, str(SCHEMAS_SRC))
