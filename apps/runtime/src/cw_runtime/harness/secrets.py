"""Project secure-store helpers.

This module stays below the runtime harness boundary: it reads the spec-defined
``secure/secrets.encrypted.sqlite`` table, but the actual decryption primitive
is injected by the caller so the default runtime does not grow keychain or
crypto dependencies.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Final, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .project import AGENT_WORKFLOW_DIR

ProjectSecretDecryptor: TypeAlias = Callable[[bytes], bytes | str]

_MAX_SECRET_VALUE_BYTES: Final = 64 * 1024


class ProjectSecretStoreError(RuntimeError):
    """Raised when a secure-store secret cannot be safely materialized."""


class ProjectMCPSecretMaterial(BaseModel):
    """Decrypted MCP secret material projected into adapter-local config."""

    model_config = ConfigDict(extra="forbid", strict=True)

    headers: dict[str, str] = Field(default_factory=dict)
    env: dict[str, str] = Field(default_factory=dict)


def load_project_mcp_secret_material(
    project_root: str | Path,
    secret_ref: str,
    *,
    decrypt_secret: ProjectSecretDecryptor,
) -> ProjectMCPSecretMaterial | None:
    """Load and decrypt MCP secret material from the project secure store.

    ``secret_ref`` is used as the spec-defined ``secrets.secret_id``. Missing
    stores or missing rows return ``None`` so callers can fail closed without
    leaking where the lookup failed.
    """

    if secret_ref == "":
        raise ProjectSecretStoreError("Project MCP secret reference is invalid.")
    database_path = Path(project_root) / AGENT_WORKFLOW_DIR / "secure" / "secrets.encrypted.sqlite"
    if not database_path.exists():
        return None
    encrypted_value = _read_encrypted_secret(database_path, secret_ref)
    if encrypted_value is None:
        return None
    plaintext = _decrypt_secret_value(encrypted_value, decrypt_secret=decrypt_secret)
    return _parse_secret_material(plaintext)


def _read_encrypted_secret(database_path: Path, secret_ref: str) -> bytes | None:
    try:
        with sqlite3.connect(database_path) as connection:
            row = connection.execute(
                "SELECT value_encrypted FROM secrets WHERE secret_id = ? LIMIT 1",
                (secret_ref,),
            ).fetchone()
    except sqlite3.Error as exc:
        raise ProjectSecretStoreError("Project secure secret store could not be read.") from exc
    if row is None:
        return None
    return _secret_value_to_bytes(row[0])


def _secret_value_to_bytes(value: object) -> bytes:
    if isinstance(value, bytes):
        encrypted = value
    elif isinstance(value, bytearray):
        encrypted = bytes(value)
    elif isinstance(value, memoryview):
        encrypted = value.tobytes()
    elif isinstance(value, str):
        encrypted = value.encode("utf-8")
    else:
        raise ProjectSecretStoreError("Project secure secret value has an unsupported storage type.")
    if len(encrypted) > _MAX_SECRET_VALUE_BYTES:
        raise ProjectSecretStoreError("Project secure secret value exceeds the size limit.")
    return encrypted


def _decrypt_secret_value(encrypted_value: bytes, *, decrypt_secret: ProjectSecretDecryptor) -> bytes:
    try:
        plaintext = decrypt_secret(encrypted_value)
    except Exception as exc:
        raise ProjectSecretStoreError("Project secure secret value could not be decrypted.") from exc
    if isinstance(plaintext, bytes):
        plaintext_bytes = plaintext
    elif isinstance(plaintext, str):
        plaintext_bytes = plaintext.encode("utf-8")
    else:
        raise ProjectSecretStoreError("Project secure secret decryptor returned an unsupported type.")
    if len(plaintext_bytes) > _MAX_SECRET_VALUE_BYTES:
        raise ProjectSecretStoreError("Project secure secret plaintext exceeds the size limit.")
    return plaintext_bytes


def _parse_secret_material(plaintext: bytes) -> ProjectMCPSecretMaterial:
    try:
        decoded = plaintext.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ProjectSecretStoreError("Project secure secret plaintext was not valid UTF-8.") from exc
    try:
        payload = json.loads(decoded)
    except json.JSONDecodeError as exc:
        raise ProjectSecretStoreError("Project secure secret plaintext was not valid JSON.") from exc
    if not isinstance(payload, dict):
        raise ProjectSecretStoreError("Project secure secret plaintext was not a JSON object.")
    try:
        material = ProjectMCPSecretMaterial.model_validate(payload)
    except ValidationError as exc:
        raise ProjectSecretStoreError("Project secure secret plaintext did not match MCP material.") from exc
    if not material.headers and not material.env:
        raise ProjectSecretStoreError("Project secure secret plaintext did not contain MCP material.")
    return material
