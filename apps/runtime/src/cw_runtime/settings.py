"""Runtime sidecar settings.

The API spec fixes the sidecar to localhost with an ephemeral bearer token
provided by the Electron main process. This module keeps that contract out of
FastAPI so it remains testable without runtime extras installed.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr

API_PREFIX: Final = "/cw/v1"
RUNTIME_SCHEMA_VERSION: Final = "0.1.0"
LOCALHOST_BIND_HOST: Final = "127.0.0.1"


class RuntimeSettingsError(RuntimeError):
    """Raised when sidecar settings violate the runtime API contract."""


class RuntimeSettings(BaseModel):
    """Settings required to serve the local CW runtime API."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["0.1.0"] = RUNTIME_SCHEMA_VERSION
    app_name: Literal["cw-runtime"] = "cw-runtime"
    api_prefix: Literal["/cw/v1"] = API_PREFIX
    host: Literal["127.0.0.1"] = LOCALHOST_BIND_HOST
    port: int = Field(default=0, ge=0, le=65535)
    auth_token: SecretStr = Field(repr=False)
    dev: bool = False

    @classmethod
    def from_environment(
        cls,
        *,
        environ: Mapping[str, str] | None = None,
        http_port: int = 0,
        dev: bool = False,
    ) -> RuntimeSettings:
        source = os.environ if environ is None else environ
        token = source.get("CW_RUNTIME_AUTH_TOKEN")
        if token is None or token == "":
            raise RuntimeSettingsError("CW_RUNTIME_AUTH_TOKEN is required")
        return cls(port=http_port, auth_token=SecretStr(token), dev=dev)


__all__ = [
    "API_PREFIX",
    "LOCALHOST_BIND_HOST",
    "RUNTIME_SCHEMA_VERSION",
    "RuntimeSettings",
    "RuntimeSettingsError",
]
