"""W1.2.8：schema 层 custom error code 必须有契约测试断言。"""

from __future__ import annotations

import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_SPECS = PROJECT_ROOT / "specs" / "schemas"
SCHEMA_SRC = PROJECT_ROOT / "packages" / "schemas" / "src" / "cw_schemas"
SCHEMA_TESTS = PROJECT_ROOT / "packages" / "schemas" / "tests"

CUSTOM_ERROR_RE = re.compile(r'PydanticCustomError\(\s*"([A-Z][A-Z0-9_]+)"', re.MULTILINE)
ASSERTED_ERROR_RE = re.compile(
    r'_assert_validation_error_contains\([^)]*?,\s*"([A-Z][A-Z0-9_]+)"\)',
    re.DOTALL,
)

REQUIRED_SCHEMA_LAYER_SPEC_ERROR_CODES: set[str] = {
    "CP_BUILD_DROP_REQUIRED_FORBIDDEN",
    "CP_BUILD_OVER_BUDGET",
    "EP_BUILD_BLOCKER_CONFLICT_UNRESOLVED",
    "EP_BUILD_DUPLICATE_EVIDENCE_ID",
    "EP_BUILD_REQUIREMENT_UNRESOLVED",
    "ER_BUILD_CRITERIA_MISMATCH",
    "ER_BUILD_DANGLING_HUMAN_TARGET",
    "ER_BUILD_DANGLING_REPAIR_TARGET",
    "ER_BUILD_FAILURE_DIAGNOSIS_MISSING",
    "NC_L2_EVAL_BAD_PASS_THRESHOLD",
    "NC_L2_EVAL_NO_CRITERIA",
    "NC_L2_KIND_MISMATCH",
    "NC_L2_MISSING_PROMPT",
    "NC_L2_REPAIR_NO_STRATEGIES",
    "NC_L2_TOOL_HAS_PROMPT",
    "RP_BUILD_BAD_OPERATION_SCHEMA",
    "RP_BUILD_EMPTY_OPERATIONS",
    "RP_BUILD_REVERSAL_NEEDED",
    "RP_BUILD_RISK_HIGH_PERSISTENT_FORBIDDEN",
    "SE_BUILD_BAD_TYPE",
    "SE_BUILD_BINARY_IN_PAYLOAD",
    "SE_BUILD_PAYLOAD_TOO_LARGE",
    "WG_L2_BAD_SCHEMA_VERSION",
    "WG_L2_DUP_EDGE_ID",
    "WG_L2_DUP_NODE_ID",
    "WG_L2_EVAL_FAIL_ROUTE_MISMATCH",
    "WG_L2_EVAL_MISSING_TARGET",
    "WG_L2_EVAL_NO_FAIL_ROUTE",
    "WG_L2_EVAL_NO_PASS_ROUTE",
    "WG_L2_EVAL_PASS_ROUTE_MISMATCH",
    "WG_L2_METADATA_NOT_NAMESPACED",
    "WG_L2_MISSING_ENTRY_NODE",
    "WG_L2_MISSING_TERMINAL_NODES",
    "WG_L2_REPAIR_MISSING_TARGET",
    "WG_L3_MULTIPLE_ENTRIES",
}


def _python_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.py") if path.is_file())


def _implemented_schema_error_codes() -> set[str]:
    codes: set[str] = set()
    for path in _python_files(SCHEMA_SRC):
        codes.update(CUSTOM_ERROR_RE.findall(path.read_text(encoding="utf-8")))
    return codes


def _asserted_contract_error_codes() -> set[str]:
    codes: set[str] = set()
    for path in _python_files(SCHEMA_TESTS):
        if path.name == "test_w1_2_8_error_code_coverage.py":
            continue
        codes.update(ASSERTED_ERROR_RE.findall(path.read_text(encoding="utf-8")))
    return codes


def _schema_spec_text() -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in sorted(SCHEMA_SPECS.glob("*.md")))


def test_schema_layer_required_codes_are_mentioned_by_specs() -> None:
    spec_text = _schema_spec_text()
    missing = sorted(code for code in REQUIRED_SCHEMA_LAYER_SPEC_ERROR_CODES if code not in spec_text)
    assert not missing, f"schema-layer coverage set contains codes not mentioned by specs: {missing}"


def test_schema_custom_error_codes_do_not_drift_from_spec_coverage_set() -> None:
    implemented = _implemented_schema_error_codes()

    assert implemented, "未在 cw_schemas 实现中发现 schema custom error code"
    extra = sorted(implemented - REQUIRED_SCHEMA_LAYER_SPEC_ERROR_CODES)
    missing = sorted(REQUIRED_SCHEMA_LAYER_SPEC_ERROR_CODES - implemented)
    assert not extra, f"以下 schema custom error code 不在 W1.2.8 spec coverage set 内：{extra}"
    assert not missing, f"以下 schema-layer spec error code 尚未由 cw_schemas custom error 实现：{missing}"


def test_schema_custom_error_codes_have_contract_assertions() -> None:
    asserted = _asserted_contract_error_codes()

    missing = sorted(REQUIRED_SCHEMA_LAYER_SPEC_ERROR_CODES - asserted)
    assert not missing, f"以下 schema-layer spec error code 缺少行为测试断言：{missing}"
