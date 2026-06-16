"""Smoke test for cw_schemas package import."""

from __future__ import annotations


def test_cw_schemas_imports() -> None:
    import cw_schemas

    assert cw_schemas.__version__ == "0.1.0"
