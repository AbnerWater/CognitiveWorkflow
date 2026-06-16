"""Smoke test for cw_runtime package import."""

from __future__ import annotations


def test_cw_runtime_imports() -> None:
    import cw_runtime

    assert cw_runtime.__version__ == "0.1.0"
