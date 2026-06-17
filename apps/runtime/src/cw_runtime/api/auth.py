"""Bearer-token validation for the local runtime API."""

from __future__ import annotations

import hmac

from pydantic import SecretStr

from .contracts import APIErrorCode, ErrorEnvelope, build_error_envelope


class AuthenticationError(RuntimeError):
    """Raised when an API request fails bearer-token validation."""

    def __init__(self, envelope: ErrorEnvelope) -> None:
        super().__init__(envelope.error_code)
        self.envelope = envelope


def _secret_value(secret: SecretStr | str) -> str:
    if isinstance(secret, SecretStr):
        return secret.get_secret_value()
    return secret


def _extract_bearer_token(authorization: str | None) -> str | None:
    if authorization is None:
        return None
    scheme, separator, token = authorization.partition(" ")
    if separator == "" or scheme.lower() != "bearer":
        return None
    stripped = token.strip()
    if stripped == "":
        return None
    return stripped


def validate_bearer_authorization(
    authorization: str | None,
    *,
    expected_token: SecretStr | str,
) -> None:
    """Validate Authorization: Bearer <token> against the runtime token."""

    candidate = _extract_bearer_token(authorization)
    expected = _secret_value(expected_token)
    if candidate is None or not hmac.compare_digest(candidate, expected):
        raise AuthenticationError(
            build_error_envelope(
                error_code=APIErrorCode.AUTH_FORBIDDEN,
                message="Missing or invalid bearer token.",
            )
        )


__all__ = ["AuthenticationError", "validate_bearer_authorization"]
