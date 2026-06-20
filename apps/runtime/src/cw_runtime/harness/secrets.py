"""Project secure-store helpers.

This module stays below the runtime harness boundary: it reads the spec-defined
``secure/secrets.encrypted.sqlite`` table. The envelope and PBKDF2 derivation
live here. The optional Windows Credential Manager and Windows CNG helpers below
keep the runtime dependency-free while macOS/Linux keychain bindings remain
future slices.
"""

from __future__ import annotations

import base64
import binascii
import ctypes
import hashlib
import json
import os
import sqlite3
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, ClassVar, Final, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .project import (
    AGENT_WORKFLOW_DIR,
    ProjectMCPHttpDiscoveryClient,
    ProjectMCPServerConfig,
    ProjectMCPStdioDiscoveryClient,
)

ProjectSecretDecryptor: TypeAlias = Callable[[bytes], bytes | str]
ProjectSecretEncryptor: TypeAlias = Callable[[bytes], bytes | str]
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
_SECRET_AES_GCM_TAG_BYTES: Final = 16
_WINDOWS_CNG_STATUS_SUCCESS: Final = 0
_WINDOWS_CNG_AES_ALGORITHM: Final = "AES"
_WINDOWS_CNG_CHAINING_MODE_PROPERTY: Final = "ChainingMode"
_WINDOWS_CNG_CHAIN_MODE_GCM: Final = "ChainingModeGCM"
_WINDOWS_CNG_AUTH_INFO_VERSION: Final = 1
_WINDOWS_CREDENTIAL_TYPE_GENERIC: Final = 1
_WINDOWS_CREDENTIAL_PERSIST_LOCAL_MACHINE: Final = 2
_WINDOWS_CREDENTIAL_TARGET_PREFIX: Final = "CognitiveWorkflow/project-secret/"
_WINDOWS_CREDENTIAL_USERNAME: Final = "CognitiveWorkflow"
_WINDOWS_CREDENTIAL_BLOB_LIMIT: Final = 5 * 512
_WINDOWS_ERROR_NOT_FOUND: Final = 1168


class _WindowsFileTime(ctypes.Structure):
    """ctypes projection of FILETIME."""

    _fields_: ClassVar[list[tuple[str, Any]]] = [
        ("dwLowDateTime", ctypes.c_ulong),
        ("dwHighDateTime", ctypes.c_ulong),
    ]


class _WindowsCredential(ctypes.Structure):
    """ctypes projection of CREDENTIALW."""

    _fields_: ClassVar[list[tuple[str, Any]]] = [
        ("Flags", ctypes.c_ulong),
        ("Type", ctypes.c_ulong),
        ("TargetName", ctypes.c_wchar_p),
        ("Comment", ctypes.c_wchar_p),
        ("LastWritten", _WindowsFileTime),
        ("CredentialBlobSize", ctypes.c_ulong),
        ("CredentialBlob", ctypes.c_void_p),
        ("Persist", ctypes.c_ulong),
        ("AttributeCount", ctypes.c_ulong),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", ctypes.c_wchar_p),
        ("UserName", ctypes.c_wchar_p),
    ]


class _WindowsCngAuthenticatedCipherModeInfo(ctypes.Structure):
    """ctypes projection of BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO."""

    _fields_: ClassVar[list[tuple[str, Any]]] = [
        ("cbSize", ctypes.c_ulong),
        ("dwInfoVersion", ctypes.c_ulong),
        ("pbNonce", ctypes.c_void_p),
        ("cbNonce", ctypes.c_ulong),
        ("pbAuthData", ctypes.c_void_p),
        ("cbAuthData", ctypes.c_ulong),
        ("pbTag", ctypes.c_void_p),
        ("cbTag", ctypes.c_ulong),
        ("pbMacContext", ctypes.c_void_p),
        ("cbMacContext", ctypes.c_ulong),
        ("cbAAD", ctypes.c_ulong),
        ("cbData", ctypes.c_ulonglong),
        ("dwFlags", ctypes.c_ulong),
    ]


class ProjectSecretStoreError(RuntimeError):
    """Raised when a secure-store secret cannot be safely materialized."""


class ProjectMCPSecretMaterial(BaseModel):
    """Decrypted MCP secret material projected into adapter-local config."""

    model_config = ConfigDict(extra="forbid", strict=True)

    headers: dict[str, str] = Field(default_factory=dict)
    env: dict[str, str] = Field(default_factory=dict)


def windows_cng_encrypt_aes_gcm(key: bytes, nonce: bytes, plaintext: bytes, associated_data: bytes) -> bytes:
    """Encrypt with Windows CNG AES-GCM-256.

    The return shape is ``ciphertext || tag``, matching common AES-GCM AEAD
    providers and the existing project secret envelope seam.
    """

    return _windows_cng_aes_gcm_crypt(
        key=key,
        nonce=nonce,
        data=plaintext,
        associated_data=associated_data,
        decrypt=False,
    )


def windows_cng_decrypt_aes_gcm(key: bytes, nonce: bytes, ciphertext: bytes, associated_data: bytes) -> bytes:
    """Decrypt ``ciphertext || tag`` with Windows CNG AES-GCM-256."""

    if len(ciphertext) < _SECRET_AES_GCM_TAG_BYTES:
        raise ProjectSecretStoreError("Project secure secret AES-GCM ciphertext was invalid.")
    encrypted = ciphertext[:-_SECRET_AES_GCM_TAG_BYTES]
    tag = ciphertext[-_SECRET_AES_GCM_TAG_BYTES:]
    return _windows_cng_aes_gcm_crypt(
        key=key,
        nonce=nonce,
        data=encrypted,
        associated_data=associated_data,
        decrypt=True,
        tag=tag,
    )


def windows_credential_manager_master_key_provider(
    project_id: str,
    *,
    target_prefix: str = _WINDOWS_CREDENTIAL_TARGET_PREFIX,
) -> bytes:
    """Load a project master key from Windows Credential Manager."""

    target_name = _windows_credential_target_name(project_id, target_prefix=target_prefix)
    advapi32 = _load_windows_advapi32()
    credential_pointer = ctypes.POINTER(_WindowsCredential)()
    ok = advapi32.CredReadW(
        target_name,
        _WINDOWS_CREDENTIAL_TYPE_GENERIC,
        0,
        ctypes.byref(credential_pointer),
    )
    if not ok:
        raise ProjectSecretStoreError("Project secure master key could not be loaded from Windows Credential Manager.")
    try:
        credential = credential_pointer.contents
        if credential.CredentialBlobSize == 0:
            raise ProjectSecretStoreError("Project secure master key stored in Windows Credential Manager was empty.")
        if credential.CredentialBlobSize > _WINDOWS_CREDENTIAL_BLOB_LIMIT:
            raise ProjectSecretStoreError(
                "Project secure master key stored in Windows Credential Manager exceeds the size limit."
            )
        if credential.CredentialBlob is None:
            raise ProjectSecretStoreError("Project secure master key stored in Windows Credential Manager was invalid.")
        return ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
    finally:
        advapi32.CredFree(credential_pointer)


def write_windows_credential_manager_master_key(
    project_id: str,
    master_key: bytes | str,
    *,
    target_prefix: str = _WINDOWS_CREDENTIAL_TARGET_PREFIX,
) -> None:
    """Store a project master key in Windows Credential Manager."""

    target_name = _windows_credential_target_name(project_id, target_prefix=target_prefix)
    master_key_bytes = _windows_credential_master_key_to_bytes(master_key)
    advapi32 = _load_windows_advapi32()
    key_buffer = _ctypes_buffer(master_key_bytes)
    credential = _WindowsCredential()
    credential.Flags = 0
    credential.Type = _WINDOWS_CREDENTIAL_TYPE_GENERIC
    credential.TargetName = target_name
    credential.Comment = None
    credential.LastWritten = _WindowsFileTime()
    credential.CredentialBlobSize = len(master_key_bytes)
    credential.CredentialBlob = _ctypes_void_pointer(key_buffer)
    credential.Persist = _WINDOWS_CREDENTIAL_PERSIST_LOCAL_MACHINE
    credential.AttributeCount = 0
    credential.Attributes = None
    credential.TargetAlias = None
    credential.UserName = _WINDOWS_CREDENTIAL_USERNAME
    ok = advapi32.CredWriteW(ctypes.byref(credential), 0)
    if not ok:
        raise ProjectSecretStoreError("Project secure master key could not be stored in Windows Credential Manager.")


def delete_windows_credential_manager_master_key(
    project_id: str,
    *,
    target_prefix: str = _WINDOWS_CREDENTIAL_TARGET_PREFIX,
) -> bool:
    """Delete a project master key from Windows Credential Manager.

    Returns ``False`` when the credential was already absent.
    """

    target_name = _windows_credential_target_name(project_id, target_prefix=target_prefix)
    advapi32 = _load_windows_advapi32()
    ok = advapi32.CredDeleteW(target_name, _WINDOWS_CREDENTIAL_TYPE_GENERIC, 0)
    if ok:
        return True
    if ctypes.get_last_error() == _WINDOWS_ERROR_NOT_FOUND:
        return False
    raise ProjectSecretStoreError("Project secure master key could not be deleted from Windows Credential Manager.")


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


def build_project_secret_encryptor(
    project_root: str | Path,
    *,
    master_key_provider: ProjectSecretMasterKeyProvider,
    encrypt_aead: ProjectSecretAeadEncryptor,
    nonce_factory: Callable[[int], bytes] = os.urandom,
) -> ProjectSecretEncryptor:
    """Build an encryptor from project metadata plus injected key/AEAD providers."""

    project_id = _read_project_id(project_root)

    def encrypt_secret(plaintext: bytes) -> bytes:
        master_key = _load_project_master_key(project_id, master_key_provider=master_key_provider)
        return encrypt_project_secret_value(
            project_id,
            plaintext,
            master_key=master_key,
            encrypt_aead=encrypt_aead,
            nonce_factory=nonce_factory,
        )

    return encrypt_secret


def write_project_mcp_secret_material(
    project_root: str | Path,
    secret_ref: str,
    material: ProjectMCPSecretMaterial,
    *,
    encrypt_secret: ProjectSecretEncryptor,
    alias: str | None = None,
    scope: str = "project",
    created_at: str | None = None,
) -> None:
    """Encrypt and upsert MCP secret material into the project secure store."""

    if secret_ref == "":
        raise ProjectSecretStoreError("Project MCP secret reference is invalid.")
    if scope == "":
        raise ProjectSecretStoreError("Project secure secret scope is invalid.")
    encrypted_value = _encrypt_secret_value(
        _mcp_secret_material_to_plaintext(material),
        encrypt_secret=encrypt_secret,
    )
    database_path = _project_secret_database_path(project_root)
    timestamp = _utc_now() if created_at is None else created_at
    try:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(database_path) as connection:
            _ensure_project_secret_table(connection)
            connection.execute(
                "INSERT INTO secrets(secret_id, alias, value_encrypted, scope, created_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(secret_id) DO UPDATE SET "
                "alias = excluded.alias, "
                "value_encrypted = excluded.value_encrypted, "
                "scope = excluded.scope, "
                "created_at = excluded.created_at",
                (secret_ref, alias, encrypted_value, scope, timestamp),
            )
    except sqlite3.Error:
        raise ProjectSecretStoreError("Project secure secret store could not be written.") from None
    except OSError:
        raise ProjectSecretStoreError("Project secure secret store could not be prepared.") from None


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
    database_path = _project_secret_database_path(project_root)
    if not database_path.exists():
        return None
    encrypted_value = _read_encrypted_secret(database_path, secret_ref)
    if encrypted_value is None:
        return None
    plaintext = _decrypt_secret_value(encrypted_value, decrypt_secret=decrypt_secret)
    return _parse_secret_material(plaintext)


def build_project_mcp_http_discovery_client_factory(
    project_root: str | Path,
    *,
    decrypt_secret: ProjectSecretDecryptor,
    timeout_seconds: float = 5.0,
) -> Callable[[ProjectMCPServerConfig], ProjectMCPHttpDiscoveryClient]:
    """Build an HTTP MCP client factory backed by project secure-store material."""

    project_root_path = Path(project_root)

    def create_client(config: ProjectMCPServerConfig) -> ProjectMCPHttpDiscoveryClient:
        material = None
        if config.secret_ref is not None:
            material = load_project_mcp_secret_material(
                project_root_path,
                config.secret_ref,
                decrypt_secret=decrypt_secret,
            )
            if material is None:
                raise ProjectSecretStoreError("Project MCP secret material could not be loaded.")
        return ProjectMCPHttpDiscoveryClient(
            timeout_seconds=timeout_seconds,
            secret_headers=None if material is None else material.headers,
        )

    return create_client


def build_project_mcp_stdio_discovery_client_factory(
    project_root: str | Path,
    *,
    decrypt_secret: ProjectSecretDecryptor,
    timeout_seconds: float = 5.0,
) -> Callable[[ProjectMCPServerConfig], ProjectMCPStdioDiscoveryClient]:
    """Build a stdio MCP client factory backed by project secure-store material."""

    project_root_path = Path(project_root)

    def create_client(config: ProjectMCPServerConfig) -> ProjectMCPStdioDiscoveryClient:
        material = None
        if config.secret_ref is not None:
            material = load_project_mcp_secret_material(
                project_root_path,
                config.secret_ref,
                decrypt_secret=decrypt_secret,
            )
            if material is None:
                raise ProjectSecretStoreError("Project MCP secret material could not be loaded.")
        return ProjectMCPStdioDiscoveryClient(
            timeout_seconds=timeout_seconds,
            secret_env=None if material is None else material.env,
        )

    return create_client


def _project_secret_database_path(project_root: str | Path) -> Path:
    return Path(project_root) / AGENT_WORKFLOW_DIR / "secure" / "secrets.encrypted.sqlite"


def _ensure_project_secret_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        "CREATE TABLE IF NOT EXISTS secrets("
        "secret_id TEXT PRIMARY KEY, "
        "alias TEXT, "
        "value_encrypted BLOB NOT NULL, "
        "scope TEXT, "
        "created_at TEXT)"
    )


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


def _encrypt_secret_value(plaintext: bytes, *, encrypt_secret: ProjectSecretEncryptor) -> bytes:
    try:
        encrypted = encrypt_secret(plaintext)
    except Exception:
        raise ProjectSecretStoreError("Project secure secret value could not be encrypted.") from None
    return _secret_value_to_bytes(encrypted)


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


def _mcp_secret_material_to_plaintext(material: ProjectMCPSecretMaterial) -> bytes:
    if not material.headers and not material.env:
        raise ProjectSecretStoreError("Project secure secret plaintext did not contain MCP material.")
    payload = material.model_dump(mode="json")
    return _secret_plaintext_to_bytes(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


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


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


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


def _windows_cng_aes_gcm_crypt(
    *,
    key: bytes,
    nonce: bytes,
    data: bytes,
    associated_data: bytes,
    decrypt: bool,
    tag: bytes | None = None,
) -> bytes:
    if sys.platform != "win32":
        raise ProjectSecretStoreError("Windows CNG AES-GCM provider is unavailable on this platform.")
    if len(key) != _SECRET_KEY_BYTES:
        raise ProjectSecretStoreError("Project secure secret AES-GCM key must be 256-bit.")
    if len(nonce) != _SECRET_NONCE_BYTES:
        raise ProjectSecretStoreError("Project secure secret AES-GCM nonce was invalid.")
    if decrypt and (tag is None or len(tag) != _SECRET_AES_GCM_TAG_BYTES):
        raise ProjectSecretStoreError("Project secure secret AES-GCM authentication tag was invalid.")

    bcrypt = _load_windows_bcrypt()
    algorithm_handle = ctypes.c_void_p()
    key_handle = ctypes.c_void_p()
    key_buffer = _ctypes_buffer(key)
    nonce_buffer = _ctypes_buffer(nonce)
    aad_buffer = _ctypes_buffer(associated_data)
    data_buffer = _ctypes_buffer(data)
    output_buffer = _empty_ctypes_buffer(len(data))
    tag_buffer = _ctypes_buffer(b"\x00" * _SECRET_AES_GCM_TAG_BYTES if tag is None else tag)
    result_size = ctypes.c_ulong(0)
    auth_info = _build_windows_cng_auth_info(
        nonce_buffer=nonce_buffer,
        auth_data_buffer=aad_buffer,
        tag_buffer=tag_buffer,
    )

    try:
        _check_windows_cng_status(
            bcrypt.BCryptOpenAlgorithmProvider(
                ctypes.byref(algorithm_handle),
                _WINDOWS_CNG_AES_ALGORITHM,
                None,
                0,
            ),
            "open algorithm",
        )
        _set_windows_cng_chaining_mode(bcrypt, algorithm_handle)
        _check_windows_cng_status(
            bcrypt.BCryptGenerateSymmetricKey(
                algorithm_handle,
                ctypes.byref(key_handle),
                None,
                0,
                _ctypes_void_pointer(key_buffer),
                len(key),
                0,
            ),
            "generate key",
        )
        crypt_function = bcrypt.BCryptDecrypt if decrypt else bcrypt.BCryptEncrypt
        _check_windows_cng_status(
            crypt_function(
                key_handle,
                _ctypes_void_pointer(data_buffer),
                len(data),
                ctypes.byref(auth_info),
                None,
                0,
                _ctypes_void_pointer(output_buffer),
                len(data),
                ctypes.byref(result_size),
                0,
            ),
            "decrypt" if decrypt else "encrypt",
        )
    finally:
        if key_handle.value is not None:
            bcrypt.BCryptDestroyKey(key_handle)
        if algorithm_handle.value is not None:
            bcrypt.BCryptCloseAlgorithmProvider(algorithm_handle, 0)

    if int(result_size.value) != len(data):
        raise ProjectSecretStoreError("Windows CNG AES-GCM provider returned an invalid result.")
    output = bytes(output_buffer)
    if decrypt:
        return output
    return output + bytes(tag_buffer)


def _load_windows_bcrypt() -> Any:
    windll_factory = getattr(ctypes, "WinDLL", None)
    if windll_factory is None:
        raise ProjectSecretStoreError("Windows CNG AES-GCM provider is unavailable on this platform.")
    bcrypt = windll_factory("bcrypt")
    bcrypt.BCryptOpenAlgorithmProvider.argtypes = [
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_wchar_p,
        ctypes.c_wchar_p,
        ctypes.c_ulong,
    ]
    bcrypt.BCryptOpenAlgorithmProvider.restype = ctypes.c_long
    bcrypt.BCryptSetProperty.argtypes = [
        ctypes.c_void_p,
        ctypes.c_wchar_p,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    bcrypt.BCryptSetProperty.restype = ctypes.c_long
    bcrypt.BCryptGenerateSymmetricKey.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    bcrypt.BCryptGenerateSymmetricKey.restype = ctypes.c_long
    bcrypt.BCryptEncrypt.argtypes = _windows_cng_crypt_argtypes()
    bcrypt.BCryptEncrypt.restype = ctypes.c_long
    bcrypt.BCryptDecrypt.argtypes = _windows_cng_crypt_argtypes()
    bcrypt.BCryptDecrypt.restype = ctypes.c_long
    bcrypt.BCryptDestroyKey.argtypes = [ctypes.c_void_p]
    bcrypt.BCryptDestroyKey.restype = ctypes.c_long
    bcrypt.BCryptCloseAlgorithmProvider.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    bcrypt.BCryptCloseAlgorithmProvider.restype = ctypes.c_long
    return bcrypt


def _load_windows_advapi32() -> Any:
    if sys.platform != "win32":
        raise ProjectSecretStoreError("Windows Credential Manager provider is unavailable on this platform.")
    windll_factory = getattr(ctypes, "WinDLL", None)
    if windll_factory is None:
        raise ProjectSecretStoreError("Windows Credential Manager provider is unavailable on this platform.")
    advapi32 = windll_factory("advapi32", use_last_error=True)
    advapi32.CredReadW.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.POINTER(_WindowsCredential)),
    ]
    advapi32.CredReadW.restype = ctypes.c_int
    advapi32.CredWriteW.argtypes = [
        ctypes.POINTER(_WindowsCredential),
        ctypes.c_ulong,
    ]
    advapi32.CredWriteW.restype = ctypes.c_int
    advapi32.CredDeleteW.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    advapi32.CredDeleteW.restype = ctypes.c_int
    advapi32.CredFree.argtypes = [ctypes.c_void_p]
    advapi32.CredFree.restype = None
    return advapi32


def _windows_cng_crypt_argtypes() -> list[Any]:
    return [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.c_ulong,
    ]


def _set_windows_cng_chaining_mode(bcrypt: Any, algorithm_handle: ctypes.c_void_p) -> None:
    chaining_mode = ctypes.create_unicode_buffer(_WINDOWS_CNG_CHAIN_MODE_GCM)
    _check_windows_cng_status(
        bcrypt.BCryptSetProperty(
            algorithm_handle,
            _WINDOWS_CNG_CHAINING_MODE_PROPERTY,
            ctypes.cast(chaining_mode, ctypes.c_void_p),
            ctypes.sizeof(chaining_mode),
            0,
        ),
        "set chaining mode",
    )


def _build_windows_cng_auth_info(
    *,
    nonce_buffer: ctypes.Array[ctypes.c_ubyte],
    auth_data_buffer: ctypes.Array[ctypes.c_ubyte],
    tag_buffer: ctypes.Array[ctypes.c_ubyte],
) -> _WindowsCngAuthenticatedCipherModeInfo:
    auth_info = _WindowsCngAuthenticatedCipherModeInfo()
    auth_info.cbSize = ctypes.sizeof(_WindowsCngAuthenticatedCipherModeInfo)
    auth_info.dwInfoVersion = _WINDOWS_CNG_AUTH_INFO_VERSION
    auth_info.pbNonce = _ctypes_void_pointer(nonce_buffer)
    auth_info.cbNonce = len(nonce_buffer)
    auth_info.pbAuthData = _ctypes_void_pointer(auth_data_buffer)
    auth_info.cbAuthData = len(auth_data_buffer)
    auth_info.pbTag = _ctypes_void_pointer(tag_buffer)
    auth_info.cbTag = len(tag_buffer)
    auth_info.pbMacContext = None
    auth_info.cbMacContext = 0
    auth_info.cbAAD = 0
    auth_info.cbData = 0
    auth_info.dwFlags = 0
    return auth_info


def _ctypes_buffer(value: bytes) -> ctypes.Array[ctypes.c_ubyte]:
    buffer_type = ctypes.c_ubyte * len(value)
    return buffer_type.from_buffer_copy(value)


def _empty_ctypes_buffer(size: int) -> ctypes.Array[ctypes.c_ubyte]:
    buffer_type = ctypes.c_ubyte * size
    return buffer_type()


def _ctypes_void_pointer(buffer: ctypes.Array[ctypes.c_ubyte]) -> ctypes.c_void_p:
    return ctypes.cast(buffer, ctypes.c_void_p)


def _windows_credential_target_name(project_id: str, *, target_prefix: str) -> str:
    if target_prefix == "":
        raise ProjectSecretStoreError("Windows Credential Manager target prefix is required.")
    project_id_bytes = _project_id_to_salt(project_id)
    target_name = f"{target_prefix}{project_id_bytes.decode('utf-8')}"
    if len(target_name) > 32767:
        raise ProjectSecretStoreError("Windows Credential Manager target name exceeds the size limit.")
    return target_name


def _windows_credential_master_key_to_bytes(master_key: bytes | str) -> bytes:
    key_bytes = _master_key_to_bytes(master_key)
    if len(key_bytes) > _WINDOWS_CREDENTIAL_BLOB_LIMIT:
        raise ProjectSecretStoreError("Project secure master key exceeds the Windows Credential Manager size limit.")
    return key_bytes


def _check_windows_cng_status(status: int, operation: str) -> None:
    if int(status) != _WINDOWS_CNG_STATUS_SUCCESS:
        raise ProjectSecretStoreError(f"Windows CNG AES-GCM provider failed during {operation}.")
