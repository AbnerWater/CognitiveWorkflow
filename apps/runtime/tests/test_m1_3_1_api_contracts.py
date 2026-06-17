"""M1.3.1 runtime API contract tests."""

from __future__ import annotations

from importlib import import_module

import pytest
from pydantic import SecretStr, ValidationError

from cw_runtime.api import APIErrorCode, ErrorEnvelope, RuntimeDependencyError, create_app
from cw_runtime.api.auth import AuthenticationError, validate_bearer_authorization
from cw_runtime.settings import RuntimeSettings, RuntimeSettingsError


def test_runtime_settings_requires_ephemeral_token() -> None:
    with pytest.raises(RuntimeSettingsError, match="CW_RUNTIME_AUTH_TOKEN"):
        RuntimeSettings.from_environment(environ={}, http_port=0)

    settings = RuntimeSettings.from_environment(
        environ={"CW_RUNTIME_AUTH_TOKEN": "token-123"},
        http_port=5173,
        dev=True,
    )

    assert settings.host == "127.0.0.1"
    assert settings.port == 5173
    assert settings.dev is True


def test_runtime_settings_forbid_non_localhost_bind() -> None:
    with pytest.raises(ValidationError):
        RuntimeSettings.model_validate({"auth_token": "token-123", "host": "0.0.0.0"})


def test_error_envelope_matches_http_sse_shape() -> None:
    envelope = ErrorEnvelope(
        error_code=APIErrorCode.AUTH_FORBIDDEN,
        message="Missing or invalid bearer token.",
        details={"header": "Authorization"},
    )

    assert envelope.model_dump(mode="json") == {
        "schema_version": "0.1.0",
        "error_code": "AUTH_FORBIDDEN",
        "message": "Missing or invalid bearer token.",
        "details": {"header": "Authorization"},
        "cw_failure_type": None,
        "retry_after_ms": None,
        "trace_id": None,
    }

    with pytest.raises(ValidationError):
        ErrorEnvelope.model_validate(
            {
                "error_code": APIErrorCode.AUTH_FORBIDDEN,
                "message": "x",
                "extra_field": True,
            }
        )


def test_bearer_authorization_validation() -> None:
    validate_bearer_authorization("Bearer expected-token", expected_token="expected-token")

    for header in (None, "", "Basic expected-token", "Bearer wrong-token"):
        with pytest.raises(AuthenticationError) as exc_info:
            validate_bearer_authorization(header, expected_token="expected-token")
        assert exc_info.value.envelope.error_code == "AUTH_FORBIDDEN"


def test_create_app_requires_runtime_extra_when_fastapi_missing() -> None:
    try:
        import_module("fastapi")
    except ModuleNotFoundError:
        with pytest.raises(RuntimeDependencyError):
            create_app(RuntimeSettings(auth_token=SecretStr("expected-token")))
    else:
        pytest.skip("fastapi is installed; endpoint behavior is covered by runtime-extra tests")
