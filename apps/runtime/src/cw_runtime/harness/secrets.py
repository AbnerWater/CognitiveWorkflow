"""Project secure-store helpers.

This module stays below the runtime harness boundary: it reads the spec-defined
``secure/secrets.encrypted.sqlite`` table. The envelope and PBKDF2 derivation
live here, while the OS keychain and AES-GCM primitive are injected by the
caller so the default runtime does not grow platform keychain or crypto
dependencies.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Final, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .project import AGENT_WORKFLOW_DIR

ProjectSecretDecryptor: TypeAlias = Callable[[bytes], bytes | str]
ProjectSecretMasterKeyProvider: TypeAlias = Callable[[str], bytes | str]
ProjectSecretAeadEncryptor: TypeAlias = Callable[[bytes, bytes, bytes, bytes], bytes]
ProjectSecretAeadDecryptor: TypeAlias = Callable[[bytes, bytes, bytes, bytes], bytes]

_MAX_SECRET_VALUE_BYTES: Final = 64 * 1024
_SECRET_ENVELOPE_VERSION: Final = "0.1.0"
_SECRET_ENCRYPTION_ALGORITHM: Final = "AES-GCM-256"
_SECRET_KDF: Final = "PBKDF2-HMAC-SHA256"
_SECRET_KEY_BYTES: Final = 32
_SECRET_NONCE_BYTES: Final = 12
_SECRET_PBKDF2_ITERATIONS: Final = 600_000


class ProjectSecretStoreError(RuntimeError):
    """Raised when a secure-store secret cannot be safely materialized."""


class ProjectMCPSecretMaterial(BaseModel):
    """Decrypted MCP secret material projected into adapter-local config."""

    model_config = ConfigDict(extra="forbid", strict=True)

    headers: dict[str, str] = Field(default_factory=dict)
    env: dict[str, str] = Field(default_factory=dict)


class ProjectSecretEncryptedValue(BaseModel):
    """Spec-shaped encrypted secret envelope stored in ``value_encrypted``."""

    model_config = ConfigDict(extra="forbid", strict=True)

    version: Literal["0.1.0"] = _SECRET_ENVELOPE_VERSION
    algorithm: Literal["AES-GCM-256"] = _SECRET_ENCRYPTION_ALGORITHM
    kdf: Literal["PBKDF2-HMAC-SHA256"] = _SECRET_KDF
    iterations: int = Field(default=_SECRET_PBKDF2_ITERATIONS, ge=100_000, le=5_000_000)
    salt: str = Field(..., min_length=1)
    nonce: str = Field(..., min_length=1)
    ciphertext: str = Field(..., min_length=1)


def encrypt_project_secret_value(
    project_id: str,
    plaintext: bytes | str,
    *,
    master_key: bytes | str,
    encrypt_aead: ProjectSecretAeadEncryptor,
    nonce_factory: Callable[[int], bytes] = os.urandom,
) -> bytes:
    """Encrypt a secret payload into the spec-shaped secure-store envelope.

    ``encrypt_aead`` is expected to implement AES-GCM with a 256-bit key. It is
    injected so this leaf harness module does not acquire a hard crypto or
    platform keychain dependency.
    """

    project_id_bytes = _project_id_to_salt(project_id)
    plaintext_bytes = _secret_plaintext_to_bytes(plaintext)
    nonce = nonce_factory(_SECRET_NONCE_BYTES)
    if not isinstance(nonce, bytes) or len(nonce) != _SECRET_NONCE_BYTES:
        raise ProjectSecretStoreError("Project secure secret nonce factory returned an invalid nonce.")
    key = _derive_project_secret_key(
        master_key,
        salt=project_id_bytes,
        iterations=_SECRET_PBKDF2_ITERATIONS,
    )
    salt_b64 = _b64encode(project_id_bytes)
    nonce_b64 = _b64encode(nonce)
    associated_data = _secret_envelope_associated_data(
        version=_SECRET_ENVELOPE_VERSION,
        algorithm=_SECRET_ENCRYPTION_ALGORITHM,
        kdf=_SECRET_KDF,
        iterations=_SECRET_PBKDF2_ITERATIONS,
        salt=salt_b64,
        nonce=nonce_b64,
    )
    try:
        ciphertext = encrypt_aead(key, nonce, plaintext_bytes, associated_data)
    except Exception as exc:
        raise ProjectSecretStoreError("Project secure secret value could not be encrypted.") from exc
    if not isinstance(ciphertext, bytes):
        raise ProjectSecretStoreError("Project secure secret encryptor returned an unsupported type.")
    envelope = ProjectSecretEncryptedValue(
        version=_SECRET_ENVELOPE_VERSION,
        algorithm=_SECRET_ENCRYPTION_ALGORITHM,
        kdf=_SECRET_KDF,
        iterations=_SECRET_PBKDF2_ITERATIONS,
        salt=salt_b64,
        nonce=nonce_b64,
        ciphertext=_b64encode(ciphertext),
    )
    envelope_bytes = envelope.model_dump_json().encode("utf-8")
    if len(envelope_bytes) > _MAX_SECRET_VALUE_BYTES:
        raise ProjectSecretStoreError("Project secure secret envelope exceeds the size limit.")
    return envelope_bytes


def decrypt_project_secret_value(
    project_id: str,
    encrypted_value: bytes,
    *,
    master_key: bytes | str,
    decrypt_aead: ProjectSecretAeadDecryptor,
) -> bytes:
    """Decrypt a spec-shaped secure-store envelope."""

    if len(encrypted_value) > _MAX_SECRET_VALUE_BYTES:
        raise ProjectSecretStoreError("Project secure secret envelope exceeds the size limit.")
    envelope = _parse_secret_envelope(encrypted_value)
    project_id_bytes = _project_id_to_salt(project_id)
    salt = _b64decode(envelope.salt, field_name="salt")
    if salt != project_id_bytes:
        raise ProjectSecretStoreError("Project secure secret envelope is not scoped to this project.")
    nonce = _b64decode(envelope.nonce, field_name="nonce")
    if len(nonce) != _SECRET_NONCE_BYTES:
        raise ProjectSecretStoreError("Project secure secret envelope nonce is invalid.")
    ciphertext = _b64decode(envelope.ciphertext, field_name="ciphertext")
    if len(ciphertext) > _MAX_SECRET_VALUE_BYTES:
        raise ProjectSecretStoreError("Project secure secret ciphertext exceeds the size limit.")
    key = _derive_project_secret_key(master_key, salt=salt, iterations=envelope.iterations)
    associated_data = _secret_envelope_associated_data(
        version=envelope.version,
        algorithm=envelope.algorithm,
        kdf=envelope.kdf,
        iterations=envelope.iterations,
        salt=envelope.salt,
        nonce=envelope.nonce,
    )
    try:
        plaintext = decrypt_aead(key, nonce, ciphertext, associated_data)
    except Exception as exc:
        raise ProjectSecretStoreError("Project secure secret value could not be decrypted.") from exc
    if not isinstance(plaintext, bytes):
        raise ProjectSecretStoreError("Project secure secret AEAD decryptor returned an unsupported type.")
    if len(plaintext) > _MAX_SECRET_VALUE_BYTES:
        raise ProjectSecretStoreError("Project secure secret plaintext exceeds the size limit.")
    return plaintext


def build_project_secret_decryptor(
    project_root: str | Path,
    *,
    master_key_provider: ProjectSecretMasterKeyProvider,
    decrypt_aead: ProjectSecretAeadDecryptor,
) -> ProjectSecretDecryptor:
    """Build a decryptor from project metadata plus injected key/AEAD providers."""

    project_id = _read_project_id(project_root)

    def decrypt_secret(encrypted_value: bytes) -> bytes:
        master_key = _load_project_master_key(project_id, master_key_provider=master_key_provider)
        return decrypt_project_secret_value(
            project_id,
            encrypted_value,
            master_key=master_key,
            decrypt_aead=decrypt_aead,
        )

    return decrypt_secret


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


def _secret_plaintext_to_bytes(value: bytes | str) -> bytes:
    if isinstance(value, bytes):
        plaintext = value
    else:
        plaintext = value.encode("utf-8")
    if len(plaintext) > _MAX_SECRET_VALUE_BYTES:
        raise ProjectSecretStoreError("Project secure secret plaintext exceeds the size limit.")
    return plaintext


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


def _parse_secret_envelope(encrypted_value: bytes) -> ProjectSecretEncryptedValue:
    try:
        decoded = encrypted_value.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ProjectSecretStoreError("Project secure secret envelope was not valid UTF-8.") from exc
    try:
        payload = json.loads(decoded)
    except json.JSONDecodeError as exc:
        raise ProjectSecretStoreError("Project secure secret envelope was not valid JSON.") from exc
    if not isinstance(payload, dict):
        raise ProjectSecretStoreError("Project secure secret envelope was not a JSON object.")
    try:
        return ProjectSecretEncryptedValue.model_validate(payload)
    except ValidationError as exc:
        raise ProjectSecretStoreError("Project secure secret envelope did not match the secure-store schema.") from exc


def _derive_project_secret_key(
    master_key: bytes | str,
    *,
    salt: bytes,
    iterations: int,
) -> bytes:
    master_key_bytes = _master_key_to_bytes(master_key)
    return hashlib.pbkdf2_hmac(
        "sha256",
        master_key_bytes,
        salt,
        iterations,
        dklen=_SECRET_KEY_BYTES,
    )


def _master_key_to_bytes(master_key: bytes | str) -> bytes:
    if isinstance(master_key, bytes):
        key_bytes = master_key
    else:
        key_bytes = master_key.encode("utf-8")
    if len(key_bytes) == 0:
        raise ProjectSecretStoreError("Project secure master key was empty.")
    if len(key_bytes) > _MAX_SECRET_VALUE_BYTES:
        raise ProjectSecretStoreError("Project secure master key exceeds the size limit.")
    return key_bytes


def _load_project_master_key(
    project_id: str,
    *,
    master_key_provider: ProjectSecretMasterKeyProvider,
) -> bytes | str:
    try:
        master_key = master_key_provider(project_id)
    except Exception as exc:
        raise ProjectSecretStoreError("Project secure master key could not be loaded.") from exc
    if not isinstance(master_key, bytes | str):
        raise ProjectSecretStoreError("Project secure master key provider returned an unsupported type.")
    return master_key


def _project_id_to_salt(project_id: str) -> bytes:
    if project_id == "":
        raise ProjectSecretStoreError("Project id is required for secure secret encryption.")
    return project_id.encode("utf-8")


def _secret_envelope_associated_data(
    *,
    version: str,
    algorithm: str,
    kdf: str,
    iterations: int,
    salt: str,
    nonce: str,
) -> bytes:
    return json.dumps(
        {
            "version": version,
            "algorithm": algorithm,
            "kdf": kdf,
            "iterations": iterations,
            "salt": salt,
            "nonce": nonce,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _b64encode(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _b64decode(value: str, *, field_name: str) -> bytes:
    try:
        return base64.b64decode(value.encode("ascii"), validate=True)
    except (binascii.Error, UnicodeEncodeError) as exc:
        raise ProjectSecretStoreError(f"Project secure secret envelope {field_name} was invalid.") from exc


def _read_project_id(project_root: str | Path) -> str:
    project_json_path = Path(project_root) / AGENT_WORKFLOW_DIR / "project.json"
    try:
        decoded = project_json_path.read_text(encoding="utf-8")
        payload = json.loads(decoded)
    except (OSError, json.JSONDecodeError) as exc:
        raise ProjectSecretStoreError("Project metadata could not be read for secure secret decryption.") from exc
    if not isinstance(payload, dict):
        raise ProjectSecretStoreError("Project metadata was not a JSON object.")
    project_id = payload.get("project_id")
    if not isinstance(project_id, str) or project_id == "":
        raise ProjectSecretStoreError("Project metadata did not contain a valid project id.")
    return project_id


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
