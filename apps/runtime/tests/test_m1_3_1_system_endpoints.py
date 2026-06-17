"""M1.3.1 FastAPI system endpoint tests.

These tests run when the runtime extra is installed:
    uv run --package cw_runtime --extra runtime pytest apps/runtime/tests/test_m1_3_1_system_endpoints.py
"""

from __future__ import annotations

from importlib import import_module
from typing import Any

import pytest
from pydantic import SecretStr

from cw_runtime.api import create_app
from cw_runtime.settings import RuntimeSettings

pytest.importorskip("fastapi")
pytest.importorskip("starlette.testclient")


def _test_client() -> Any:
    testclient_module = import_module("starlette.testclient")
    app = create_app(RuntimeSettings(auth_token=SecretStr("expected-token")))
    return testclient_module.TestClient(app)


def test_system_endpoints_require_bearer_token() -> None:
    client = _test_client()

    missing_response = client.get("/cw/v1/system/health")
    assert missing_response.status_code == 401
    assert missing_response.json() == {
        "schema_version": "0.1.0",
        "error_code": "AUTH_FORBIDDEN",
        "message": "Missing or invalid bearer token.",
        "details": {},
        "cw_failure_type": None,
        "retry_after_ms": None,
        "trace_id": None,
    }
    assert "detail" not in missing_response.json()

    wrong_response = client.get(
        "/cw/v1/system/health",
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert wrong_response.status_code == 401
    assert wrong_response.json()["error_code"] == "AUTH_FORBIDDEN"


def test_system_endpoints_reject_external_http_origin() -> None:
    client = _test_client()

    response = client.get(
        "/cw/v1/system/health",
        headers={
            "Authorization": "Bearer expected-token",
            "Origin": "http://example.com",
        },
    )

    assert response.status_code == 401
    assert response.json()["error_code"] == "AUTH_FORBIDDEN"
    assert response.json()["message"] == "Origin is not allowed for the local runtime API."
    assert "detail" not in response.json()


def test_system_endpoints_accept_local_and_app_origins() -> None:
    client = _test_client()

    for origin in ("http://127.0.0.1:5173", "app://cw"):
        response = client.get(
            "/cw/v1/system/health",
            headers={
                "Authorization": "Bearer expected-token",
                "Origin": origin,
            },
        )
        assert response.status_code == 200


def test_system_info_and_health_responses() -> None:
    client = _test_client()
    headers = {"Authorization": "Bearer expected-token"}

    info_response = client.get("/cw/v1/system/info", headers=headers)
    assert info_response.status_code == 200
    assert info_response.json() == {
        "schema_version": "0.1.0",
        "runtime_name": "cw-runtime",
        "runtime_version": "0.1.0",
        "api_prefix": "/cw/v1",
        "bind_host": "127.0.0.1",
    }
    assert info_response.headers["x-frame-options"] == "DENY"
    assert info_response.headers["content-security-policy"] == "default-src 'none'"
    assert info_response.headers["x-content-type-options"] == "nosniff"

    health_response = client.get("/cw/v1/system/health", headers=headers)
    assert health_response.status_code == 200
    assert health_response.json() == {
        "schema_version": "0.1.0",
        "status": "ok",
        "checks": {"api": "ok"},
    }


def test_system_capabilities_and_shutdown_foundation() -> None:
    client = _test_client()
    headers = {"Authorization": "Bearer expected-token"}

    capabilities_response = client.get("/cw/v1/system/capabilities", headers=headers)
    assert capabilities_response.status_code == 200
    assert capabilities_response.json() == []

    shutdown_response = client.post("/cw/v1/system/shutdown", headers=headers)
    assert shutdown_response.status_code == 202
    assert shutdown_response.json() == {"schema_version": "0.1.0", "accepted": True}
