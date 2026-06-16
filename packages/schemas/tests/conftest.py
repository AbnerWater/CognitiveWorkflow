"""Conftest for cw_schemas tests.

为了在 conda + uv mixed env 下稳定 import cw_schemas（src 布局），显式把 src 加到 sys.path。
"""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
if SRC.exists() and str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
