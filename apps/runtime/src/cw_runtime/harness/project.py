"""Project runtime harness initialization.

This module implements the filesystem side of runtime_harness.md for project
creation. It deliberately avoids FastAPI imports so it can be tested as pure
runtime logic.
"""

from __future__ import annotations

import json
import os
import queue
import secrets
import shlex
import subprocess
import threading
import time
from collections.abc import Callable, Mapping
from hashlib import sha256
from http.client import HTTPResponse
from pathlib import Path
from typing import Any, Final, Literal, Protocol, TextIO, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from cw_runtime import __version__
from cw_runtime.persistence import ensure_runtime_databases, record_initial_git_snapshot
from cw_runtime.settings import RUNTIME_SCHEMA_VERSION
from cw_schemas import WorkflowGraph

AGENT_WORKFLOW_DIR: Final = ".agent-workflow"
MANIFEST_REVISION_FILE: Final = "manifest_revision.json"
RUNTIME_LOCK_FILE: Final = "runtime.lock"
GIT_LOCK_FILE: Final = "git.lock"

_CROCKFORD_ALPHABET: Final = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_INVALID_PATH_CHARS: Final = set('/\\:*?"<>|')
_GITIGNORE_LINES: Final = [
    "# CognitiveWorkflow runtime cache & secure",
    ".agent-workflow/cache/",
    ".agent-workflow/secure/",
    ".agent-workflow/locks/",
    ".agent-workflow/traces/",
    ".agent-workflow/runs/*/stream-events/",
    ".agent-workflow/planning_sessions/*/stream-events.jsonl",
    "",
    "# OS",
    ".DS_Store",
    "Thumbs.db",
    "",
    "# Editor",
    ".vscode/",
    ".idea/",
]
_GITATTRIBUTES_LINES: Final = [
    ".agent-workflow/**/*.jsonl    text eol=lf",
    ".agent-workflow/**/*.json     text eol=lf",
    ".agent-workflow/locks/*.lock  binary",
]
_REVISION_MANIFESTS: Final = [
    "project.json",
    "settings.json",
    "workflow.flow.json",
    "memory.json",
    "references.manifest.json",
    "skills.config.json",
    "mcp.config.json",
    "adapters.config.json",
]
_MCP_DISCOVERY_ERROR_STAGES: Final = {
    "client_factory",
    "client_lifecycle",
    "initialize",
    "health_check",
    "discover_tools",
    "invoke_tool",
    "close",
}
_MCP_MAX_RESPONSE_BYTES: Final = 4 * 1024 * 1024
_MCP_PROTOCOL_VERSION: Final = "2025-06-18"
_MCP_HTTP_RESERVED_HEADER_NAMES: Final = {
    "accept",
    "content-length",
    "content-type",
    "host",
    "mcp-protocol-version",
    "mcp-session-id",
}
_TRACKED_INIT_PATHS: Final = [
    ".gitignore",
    ".gitattributes",
    ".agent-workflow/project.json",
    ".agent-workflow/settings.json",
    ".agent-workflow/workflow.flow.json",
    ".agent-workflow/workflow_history.json",
    ".agent-workflow/memory.json",
    ".agent-workflow/reflection_memory.jsonl",
    ".agent-workflow/references.manifest.json",
    ".agent-workflow/skills.config.json",
    ".agent-workflow/mcp.config.json",
    ".agent-workflow/adapters.config.json",
    ".agent-workflow/manifest_revision.json",
    ".agent-workflow/artifacts/index.jsonl",
    ".agent-workflow/snapshots/snapshots.jsonl",
]
_REFERENCE_KINDS: Final = {"pdf", "md", "txt", "csv", "xlsx", "image", "web_url"}
_REFERENCE_CHUNK_STATUSES: Final = {"none", "chunked", "indexed", "stale"}
_REFERENCE_COMMIT_PATHS: Final = [
    ".agent-workflow/references.manifest.json",
    ".agent-workflow/manifest_revision.json",
]


class HarnessError(RuntimeError):
    """Raised when runtime harness initialization fails with a spec error code."""

    def __init__(
        self,
        error_code: str,
        message: str,
        *,
        status_code: int = 500,
        details: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.status_code = status_code
        self.details = {} if details is None else dict(details)


class ProjectCreateRequest(BaseModel):
    """Request body for POST /cw/v1/projects."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"]
    display_name: str = Field(min_length=1, max_length=120)
    host_path: str = Field(min_length=1)
    settings_overrides: dict[str, Any] = Field(default_factory=dict)


class ProjectCreateResponse(BaseModel):
    """Response body for POST /cw/v1/projects."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"] = RUNTIME_SCHEMA_VERSION
    project_id: str
    host_path: str
    git_initialized: bool
    first_commit_sha: str | None


class ProjectDocument(BaseModel):
    """Project resource returned by GET /cw/v1/projects/{project_id}."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"] = RUNTIME_SCHEMA_VERSION
    project_id: str
    display_name: str
    host_path: str
    created_at: str
    cw_version: str
    active_workflow_id: str | None = None
    settings_ref: Literal["settings.json"] = "settings.json"
    manifest_revisions_ref: Literal["manifest_revision.json"] = MANIFEST_REVISION_FILE
    last_opened_at: str
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProjectReferenceEntry(BaseModel):
    """Entry stored in ``references.manifest.json``."""

    model_config = ConfigDict(extra="forbid")

    reference_id: str = Field(min_length=1)
    path: str = Field(min_length=1)
    kind: Literal["pdf", "md", "txt", "csv", "xlsx", "image", "web_url"]
    enabled: bool
    source_url: str | None = None
    content_hash: str = Field(min_length=1)
    chunk_status: Literal["none", "chunked", "indexed", "stale"]
    chunk_size_tokens: int | None = Field(default=None, ge=1)
    sensitive: bool
    imported_at: str


class ProjectReferenceManifest(BaseModel):
    """Project reference manifest from runtime_harness.md §2.7."""

    model_config = ConfigDict(extra="forbid")

    entries: list[ProjectReferenceEntry] = Field(default_factory=list)
    index_snapshot_id: str


class ProjectReferenceImportMetadata(BaseModel):
    """Metadata part for POST /cw/v1/projects/{project_id}/references."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"]
    kind: Literal["pdf", "md", "txt", "csv", "xlsx", "image", "web_url"]
    sensitive: bool = False
    auto_chunk: bool = True
    source_url: str | None = None


class ProjectReferencePatchRequest(BaseModel):
    """Request body for PATCH /cw/v1/projects/{project_id}/references/{reference_id}."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"]
    enabled: bool


class ProjectToolAvailability(BaseModel):
    """Enabled project tool registries used by workflow L4 validation."""

    model_config = ConfigDict(extra="forbid")

    skill_ids: set[str] = Field(default_factory=set)
    skill_refs: set[str] = Field(default_factory=set)
    mcp_server_ids: set[str] = Field(default_factory=set)


class ProjectSkillLockEntry(BaseModel):
    """Run-scoped Skill lock entry projected from project config."""

    model_config = ConfigDict(extra="forbid")

    skill_id: str
    version: str = "latest"


class ProjectMCPLockEntry(BaseModel):
    """Run-scoped MCP lock entry projected from project config."""

    model_config = ConfigDict(extra="forbid")

    server_id: str
    version: str = "latest"
    tools_snapshot: list[dict[str, Any]] = Field(default_factory=list)


class ProjectMCPDiscoveredTools(BaseModel):
    """Discovered MCP server replay metadata for ``mcp_lock.json``."""

    model_config = ConfigDict(extra="forbid")

    version: str = Field(default="latest", min_length=1)
    tools_snapshot: list[dict[str, Any]] = Field(default_factory=list)


class ProjectMCPHealthCheck(BaseModel):
    """Provider-owned MCP server health result used before tool discovery."""

    model_config = ConfigDict(extra="forbid")

    healthy: bool
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProjectMCPServerConfig(BaseModel):
    """Enabled project MCP server config from ``mcp.config.json``."""

    model_config = ConfigDict(extra="forbid")

    server_id: str
    transport: str
    command_or_url: str
    requires_approval: bool = False
    secret_ref: str | None = None


class ProjectMCPDiscoveryError(RuntimeError):
    """Raised when explicit MCP discovery cannot safely produce a lock snapshot."""

    def __init__(
        self,
        server_id: str,
        stage: str,
        message: str,
        *,
        details: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.server_id = server_id
        self.stage = stage
        self.details = {} if details is None else dict(details)
        self._cw_sanitized = False

    @property
    def sanitized(self) -> bool:
        return self._cw_sanitized


class ProjectMCPDiscoveryClient(Protocol):
    """Provider-backed MCP lifecycle client used by ``ProjectMCPDiscoveryRunner``."""

    def start(self, config: ProjectMCPServerConfig) -> None: ...

    def health_check(self) -> ProjectMCPHealthCheck: ...

    def discover_tools(self) -> ProjectMCPDiscoveredTools | None: ...

    def close(self) -> None: ...


ProjectMCPDiscoveryClientFactory = Callable[[ProjectMCPServerConfig], ProjectMCPDiscoveryClient]
ProjectMCPToolDiscovery = Callable[[ProjectMCPServerConfig], ProjectMCPDiscoveredTools | None]


class ProjectMCPDiscoveryRunner:
    """Run a provider-backed MCP client through start, health, discover, close."""

    def __init__(self, client_factory: ProjectMCPDiscoveryClientFactory) -> None:
        self._client_factory = client_factory

    def __call__(self, config: ProjectMCPServerConfig) -> ProjectMCPDiscoveredTools | None:
        client = self._create_client(config)
        primary_error: BaseException | None = None
        try:
            try:
                client.start(config)
                health = client.health_check()
                if not isinstance(health, ProjectMCPHealthCheck):
                    raise _mcp_discovery_error(
                        config,
                        stage="health_check",
                        message="Project MCP discovery client returned an invalid health result.",
                        details={"result_type": type(health).__name__},
                    )
                if not health.healthy:
                    raise _mcp_discovery_error(
                        config,
                        stage="health_check",
                        message="Project MCP server health check failed before tool discovery.",
                    )
                return client.discover_tools()
            except ProjectMCPDiscoveryError as exc:
                primary_error = _sanitize_mcp_discovery_error(
                    config,
                    exc,
                    default_stage="client_lifecycle",
                    message="Project MCP discovery client failed.",
                )
                raise primary_error from exc
            except Exception as exc:
                primary_error = exc
                raise _mcp_discovery_error(
                    config,
                    stage="client_lifecycle",
                    message="Project MCP discovery client failed.",
                    details={"exception_type": type(exc).__name__},
                ) from exc
        finally:
            try:
                client.close()
            except Exception as exc:
                if primary_error is None:
                    raise _mcp_discovery_error(
                        config,
                        stage="close",
                        message="Project MCP discovery client close failed.",
                        details={"exception_type": type(exc).__name__},
                    ) from exc

    def _create_client(self, config: ProjectMCPServerConfig) -> ProjectMCPDiscoveryClient:
        try:
            return self._client_factory(config)
        except Exception as exc:
            raise _mcp_discovery_error(
                config,
                stage="client_factory",
                message="Project MCP discovery client factory failed.",
                details={"exception_type": type(exc).__name__},
            ) from exc


class ProjectMCPStdioDiscoveryClient:
    """Minimal stdio MCP client for initialize, tools/list, and tools/call."""

    def __init__(
        self,
        *,
        timeout_seconds: float = 5.0,
        secret_env: Mapping[str, str] | None = None,
    ) -> None:
        self._timeout_seconds = timeout_seconds
        self._raw_secret_env = {} if secret_env is None else dict(secret_env)
        self._secret_env: dict[str, str] = {}
        self._config: ProjectMCPServerConfig | None = None
        self._process: subprocess.Popen[str] | None = None
        self._stdout_queue: queue.Queue[str | Exception | None] = queue.Queue()
        self._stdout_thread: threading.Thread | None = None
        self._next_id = 1
        self._version = "latest"

    def start(self, config: ProjectMCPServerConfig) -> None:
        self._config = config
        if config.transport != "stdio":
            raise self._error(
                "client_lifecycle",
                "Project MCP stdio discovery client only supports stdio transport.",
                details={"transport": config.transport},
            )
        command = _stdio_command(config.command_or_url)
        if command is None:
            raise self._error(
                "client_lifecycle",
                "Project MCP stdio discovery command is empty.",
            )
        self._secret_env = _mcp_stdio_secret_env(self._raw_secret_env, mcp_config=config)
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=_mcp_stdio_process_env(self._secret_env),
                text=True,
                encoding="utf-8",
            )
        except Exception as exc:
            raise self._error(
                "client_lifecycle",
                "Project MCP stdio discovery client failed to start.",
                details={"exception_type": type(exc).__name__},
            ) from exc
        self._process = process
        if process.stdout is None:
            raise self._error(
                "client_lifecycle",
                "Project MCP stdio discovery client stdout is unavailable.",
            )
        self._stdout_thread = threading.Thread(
            target=_read_stdio_stdout,
            args=(process.stdout, self._stdout_queue),
            daemon=True,
        )
        self._stdout_thread.start()

    def health_check(self) -> ProjectMCPHealthCheck:
        result = self._request(
            "initialize",
            stage="initialize",
            params={
                "protocolVersion": _MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "cognitiveworkflow",
                    "version": __version__,
                },
            },
        )
        protocol_version = _string_mapping_value(result, "protocolVersion")
        if protocol_version is None:
            raise self._error(
                "initialize",
                "Project MCP initialize response is missing protocolVersion.",
            )
        self._version = _mcp_server_version(result, default=protocol_version)
        self._notify("notifications/initialized", stage="initialize")
        return ProjectMCPHealthCheck(healthy=True, metadata={"protocol_version": protocol_version})

    def discover_tools(self) -> ProjectMCPDiscoveredTools | None:
        result = self._request("tools/list", stage="discover_tools")
        tools_value = result.get("tools")
        if not isinstance(tools_value, list):
            raise self._error(
                "discover_tools",
                "Project MCP tools/list response is missing tools list.",
                details={"result_type": type(tools_value).__name__},
            )
        return ProjectMCPDiscoveredTools(
            version=self._version,
            tools_snapshot=[_mcp_tool_snapshot(tool, self._require_config()) for tool in tools_value],
        )

    def invoke_tool(self, tool_name: str, arguments: Mapping[str, object] | None = None) -> dict[str, Any]:
        """Invoke one MCP tool over the active stdio session."""

        if tool_name.strip() == "":
            raise self._error("invoke_tool", "Project MCP tools/call tool name is required.")
        result = self._request(
            "tools/call",
            stage="invoke_tool",
            params=_mcp_tool_call_params(tool_name, arguments),
        )
        return _mcp_tool_call_result(result, self._require_config())

    def close(self) -> None:
        process = self._process
        if process is None:
            return
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()
        try:
            process.wait(timeout=self._timeout_seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=self._timeout_seconds)
        finally:
            if self._stdout_thread is not None:
                self._stdout_thread.join(timeout=self._timeout_seconds)
                self._stdout_thread = None
            self._process = None

    def _request(
        self,
        method: str,
        *,
        stage: str,
        params: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
        request_id = self._next_request_id()
        message: dict[str, object] = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params is not None:
            message["params"] = dict(params)
        self._write_json_rpc(message, stage=stage)
        deadline = time.monotonic() + self._timeout_seconds
        while True:
            remaining_seconds = deadline - time.monotonic()
            if remaining_seconds <= 0:
                raise self._error(
                    stage,
                    "Project MCP stdio read timed out.",
                    details={"timeout_seconds": self._timeout_seconds},
                )
            response = self._read_json_rpc(stage=stage, timeout_seconds=remaining_seconds)
            if response.get("id") != request_id:
                continue
            error = response.get("error")
            if isinstance(error, Mapping):
                raise self._error(
                    stage,
                    "Project MCP JSON-RPC request failed.",
                    details={"jsonrpc_error_type": type(error.get("code")).__name__},
                )
            result = response.get("result")
            if not isinstance(result, Mapping):
                raise self._error(
                    stage,
                    "Project MCP JSON-RPC response is missing object result.",
                    details={"result_type": type(result).__name__},
                )
            return result

    def _notify(self, method: str, *, stage: str) -> None:
        self._write_json_rpc({"jsonrpc": "2.0", "method": method}, stage=stage)

    def _write_json_rpc(self, message: Mapping[str, object], *, stage: str) -> None:
        process = self._require_process(stage)
        if process.stdin is None or process.stdin.closed:
            raise self._error(stage, "Project MCP stdio stdin is unavailable.")
        try:
            process.stdin.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
            process.stdin.flush()
        except Exception as exc:
            raise self._error(
                stage,
                "Project MCP stdio write failed.",
                details={"exception_type": type(exc).__name__},
            ) from exc

    def _read_json_rpc(self, *, stage: str, timeout_seconds: float | None = None) -> Mapping[str, object]:
        read_timeout = self._timeout_seconds if timeout_seconds is None else max(timeout_seconds, 0.0)
        try:
            line = self._stdout_queue.get(timeout=read_timeout)
        except queue.Empty as exc:
            raise self._error(
                stage,
                "Project MCP stdio read timed out.",
                details={"timeout_seconds": self._timeout_seconds},
            ) from exc
        if isinstance(line, Exception):
            raise self._error(
                stage,
                "Project MCP stdio read failed.",
                details={"exception_type": type(line).__name__},
            ) from line
        if line is None:
            raise self._error(stage, "Project MCP stdio stream ended before response.")
        if _utf8_size(line) > _MCP_MAX_RESPONSE_BYTES:
            raise self._error(
                stage,
                "Project MCP stdio response exceeded size limit.",
                details={"response_size_limit": _MCP_MAX_RESPONSE_BYTES},
            )
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            raise self._error(
                stage,
                "Project MCP stdio response was not valid JSON.",
                details={"exception_type": type(exc).__name__},
            ) from exc
        if not isinstance(message, Mapping):
            raise self._error(
                stage,
                "Project MCP stdio response was not a JSON object.",
                details={"result_type": type(message).__name__},
            )
        return message

    def _next_request_id(self) -> int:
        request_id = self._next_id
        self._next_id += 1
        return request_id

    def _require_process(self, stage: str) -> subprocess.Popen[str]:
        if self._process is None:
            raise self._error(stage, "Project MCP stdio process is not started.")
        return self._process

    def _require_config(self) -> ProjectMCPServerConfig:
        if self._config is None:
            raise RuntimeError("ProjectMCPStdioDiscoveryClient used before start().")
        return self._config

    def _error(
        self,
        stage: str,
        message: str,
        *,
        details: Mapping[str, object] | None = None,
    ) -> ProjectMCPDiscoveryError:
        return _mcp_discovery_error(self._require_config(), stage=stage, message=message, details=details)


class ProjectMCPHttpDiscoveryClient:
    """Minimal Streamable HTTP MCP client for initialize, tools/list, and tools/call."""

    def __init__(
        self,
        *,
        timeout_seconds: float = 5.0,
        secret_headers: Mapping[str, str] | None = None,
    ) -> None:
        self._timeout_seconds = timeout_seconds
        self._raw_secret_headers = {} if secret_headers is None else dict(secret_headers)
        self._secret_headers: dict[str, str] = {}
        self._config: ProjectMCPServerConfig | None = None
        self._endpoint_url: str | None = None
        self._next_id = 1
        self._version = "latest"
        self._protocol_version: str | None = None
        self._session_id: str | None = None
        self._legacy_message_endpoint_url: str | None = None
        self._legacy_sse_response: HTTPResponse | None = None
        self._legacy_sse_line_queue: queue.Queue[bytes | Exception | None] | None = None
        self._legacy_sse_reader_thread: threading.Thread | None = None

    def start(self, config: ProjectMCPServerConfig) -> None:
        self._endpoint_url = None
        self._next_id = 1
        self._version = "latest"
        self._protocol_version = None
        self._session_id = None
        self._legacy_message_endpoint_url = None
        self._legacy_sse_response = None
        self._legacy_sse_line_queue = None
        self._legacy_sse_reader_thread = None
        self._config = config
        if config.transport != "http":
            raise self._error(
                "client_lifecycle",
                "Project MCP HTTP discovery client only supports http transport.",
                details={"transport": config.transport},
            )
        endpoint_url = config.command_or_url.strip()
        parsed = urlparse(endpoint_url)
        if parsed.scheme not in {"http", "https"} or parsed.netloc == "":
            raise self._error(
                "client_lifecycle",
                "Project MCP HTTP discovery endpoint URL is invalid.",
                details={"url_scheme": parsed.scheme or "missing"},
            )
        self._endpoint_url = endpoint_url
        self._secret_headers = _mcp_http_secret_headers(self._raw_secret_headers, mcp_config=config)

    def health_check(self) -> ProjectMCPHealthCheck:
        result = self._request(
            "initialize",
            stage="initialize",
            params={
                "protocolVersion": _MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "cognitiveworkflow",
                    "version": __version__,
                },
            },
        )
        protocol_version = _string_mapping_value(result, "protocolVersion")
        if protocol_version is None:
            raise self._error(
                "initialize",
                "Project MCP initialize response is missing protocolVersion.",
            )
        self._protocol_version = protocol_version
        self._version = _mcp_server_version(result, default=protocol_version)
        self._notify("notifications/initialized", stage="initialize")
        return ProjectMCPHealthCheck(healthy=True, metadata={"protocol_version": protocol_version})

    def discover_tools(self) -> ProjectMCPDiscoveredTools | None:
        result = self._request("tools/list", stage="discover_tools")
        tools_value = result.get("tools")
        if not isinstance(tools_value, list):
            raise self._error(
                "discover_tools",
                "Project MCP tools/list response is missing tools list.",
                details={"result_type": type(tools_value).__name__},
            )
        return ProjectMCPDiscoveredTools(
            version=self._version,
            tools_snapshot=[_mcp_tool_snapshot(tool, self._require_config()) for tool in tools_value],
        )

    def invoke_tool(self, tool_name: str, arguments: Mapping[str, object] | None = None) -> dict[str, Any]:
        """Invoke one MCP tool over the active HTTP session."""

        if tool_name.strip() == "":
            raise self._error("invoke_tool", "Project MCP tools/call tool name is required.")
        result = self._request(
            "tools/call",
            stage="invoke_tool",
            params=_mcp_tool_call_params(tool_name, arguments),
        )
        return _mcp_tool_call_result(result, self._require_config())

    def close(self) -> None:
        if self._legacy_sse_response is not None:
            self._legacy_sse_response.close()
        if self._legacy_sse_reader_thread is not None:
            self._legacy_sse_reader_thread.join(timeout=self._timeout_seconds)
        self._endpoint_url = None
        self._next_id = 1
        self._version = "latest"
        self._protocol_version = None
        self._session_id = None
        self._legacy_message_endpoint_url = None
        self._legacy_sse_response = None
        self._legacy_sse_line_queue = None
        self._legacy_sse_reader_thread = None

    def _request(
        self,
        method: str,
        *,
        stage: str,
        params: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
        request_id = self._next_request_id()
        message: dict[str, object] = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params is not None:
            message["params"] = dict(params)
        response = self._post_json_rpc(message, stage=stage, expected_response_id=request_id)
        return self._response_result(response, stage=stage)

    def _notify(self, method: str, *, stage: str) -> None:
        self._post_json_rpc({"jsonrpc": "2.0", "method": method}, stage=stage, expected_response_id=None)

    def _post_json_rpc(
        self,
        message: Mapping[str, object],
        *,
        stage: str,
        expected_response_id: int | None,
    ) -> Mapping[str, object] | None:
        if self._legacy_message_endpoint_url is not None:
            return self._legacy_post_json_rpc(message, stage=stage, expected_response_id=expected_response_id)
        try:
            body = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise self._error(
                stage,
                "Project MCP HTTP request body could not be encoded.",
                details={"exception_type": type(exc).__name__},
            ) from exc
        request = Request(
            self._require_endpoint_url(),
            data=body,
            method="POST",
            headers=self._http_headers(),
        )
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                status = response.status
                if expected_response_id is None:
                    if status != 202:
                        raise self._error(
                            stage,
                            "Project MCP HTTP notification was not accepted.",
                            details={"http_status": status},
                        )
                    return None
                self._capture_http_session_id(response, stage=stage)
                return self._read_http_response(response, expected_response_id=expected_response_id, stage=stage)
        except HTTPError as exc:
            status = exc.code
            exc.close()
            if stage == "initialize" and expected_response_id is not None and 400 <= status < 500:
                self._start_legacy_http_sse(stage=stage)
                return self._legacy_post_json_rpc(message, stage=stage, expected_response_id=expected_response_id)
            raise self._error(
                stage,
                "Project MCP HTTP request failed.",
                details={"http_status": status},
            ) from exc
        except URLError as exc:
            raise self._error(
                stage,
                "Project MCP HTTP request failed.",
                details={"exception_type": type(exc.reason).__name__},
            ) from exc
        except TimeoutError as exc:
            raise self._error(
                stage,
                "Project MCP HTTP request timed out.",
                details={"timeout_seconds": self._timeout_seconds},
            ) from exc

    def _read_http_response(
        self,
        response: HTTPResponse,
        *,
        expected_response_id: int,
        stage: str,
    ) -> Mapping[str, object]:
        content_type = _http_content_type(response)
        if content_type == "application/json":
            message = self._read_json_http_response(response, stage=stage)
            if message.get("id") != expected_response_id:
                raise self._error(
                    stage,
                    "Project MCP HTTP JSON-RPC response id did not match request.",
                    details={"response_id_type": type(message.get("id")).__name__},
                )
            return message
        if content_type == "text/event-stream":
            return self._read_sse_http_response(response, expected_response_id=expected_response_id, stage=stage)
        raise self._error(
            stage,
            "Project MCP HTTP response content type is unsupported.",
            details={"content_type": content_type or "missing"},
        )

    def _read_json_http_response(self, response: HTTPResponse, *, stage: str) -> Mapping[str, object]:
        try:
            body = response.read(_MCP_MAX_RESPONSE_BYTES + 1)
        except Exception as exc:
            raise self._error(
                stage,
                "Project MCP HTTP response read failed.",
                details={"exception_type": type(exc).__name__},
            ) from exc
        if len(body) > _MCP_MAX_RESPONSE_BYTES:
            raise self._error(
                stage,
                "Project MCP HTTP response exceeded size limit.",
                details={"response_size_limit": _MCP_MAX_RESPONSE_BYTES},
            )
        try:
            message = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise self._error(
                stage,
                "Project MCP HTTP response was not valid JSON.",
                details={"exception_type": type(exc).__name__},
            ) from exc
        if not isinstance(message, Mapping):
            raise self._error(
                stage,
                "Project MCP HTTP response was not a JSON object.",
                details={"result_type": type(message).__name__},
            )
        return message

    def _read_sse_http_response(
        self,
        response: HTTPResponse,
        *,
        expected_response_id: int,
        stage: str,
    ) -> Mapping[str, object]:
        deadline = time.monotonic() + self._timeout_seconds
        data_lines: list[str] = []
        data_size_bytes = 0
        line_queue: queue.Queue[bytes | Exception | None] = queue.Queue()
        reader_thread = threading.Thread(
            target=_read_http_sse_lines,
            args=(response, line_queue),
            daemon=True,
        )
        reader_thread.start()
        try:
            while True:
                remaining_seconds = deadline - time.monotonic()
                if remaining_seconds <= 0:
                    raise self._error(
                        stage,
                        "Project MCP HTTP SSE response timed out.",
                        details={"timeout_seconds": self._timeout_seconds},
                    )
                try:
                    line = line_queue.get(timeout=remaining_seconds)
                except queue.Empty as exc:
                    raise self._error(
                        stage,
                        "Project MCP HTTP SSE response timed out.",
                        details={"timeout_seconds": self._timeout_seconds},
                    ) from exc
                if isinstance(line, Exception):
                    if isinstance(line, TimeoutError):
                        raise self._error(
                            stage,
                            "Project MCP HTTP SSE response timed out.",
                            details={"timeout_seconds": self._timeout_seconds},
                        ) from line
                    raise self._error(
                        stage,
                        "Project MCP HTTP SSE read failed.",
                        details={"exception_type": type(line).__name__},
                    ) from line
                if line is None:
                    raise self._error(stage, "Project MCP HTTP SSE stream ended before response.")
                if len(line) > _MCP_MAX_RESPONSE_BYTES:
                    raise self._error(
                        stage,
                        "Project MCP HTTP SSE response exceeded size limit.",
                        details={"response_size_limit": _MCP_MAX_RESPONSE_BYTES},
                    )
                try:
                    decoded_line = line.decode("utf-8").rstrip("\r\n")
                except UnicodeDecodeError as exc:
                    raise self._error(
                        stage,
                        "Project MCP HTTP SSE event was not valid UTF-8.",
                        details={"exception_type": type(exc).__name__},
                    ) from exc
                if decoded_line == "":
                    message = self._sse_message(data_lines, stage=stage)
                    data_lines = []
                    data_size_bytes = 0
                    if message is None or message.get("id") != expected_response_id:
                        continue
                    return message
                if decoded_line.startswith(":"):
                    continue
                field_name, separator, field_value = decoded_line.partition(":")
                if separator == "" or field_name != "data":
                    continue
                data_value = field_value[1:] if field_value.startswith(" ") else field_value
                data_size_bytes = _mcp_sse_data_size(data_size_bytes, data_value)
                if data_size_bytes > _MCP_MAX_RESPONSE_BYTES:
                    raise self._error(
                        stage,
                        "Project MCP HTTP SSE event exceeded size limit.",
                        details={"response_size_limit": _MCP_MAX_RESPONSE_BYTES},
                    )
                data_lines.append(data_value)
        finally:
            response.close()
            reader_thread.join(timeout=self._timeout_seconds)

    def _start_legacy_http_sse(self, *, stage: str) -> None:
        request = Request(
            self._require_endpoint_url(),
            method="GET",
            headers=self._legacy_sse_headers(),
        )
        try:
            response = urlopen(request, timeout=self._timeout_seconds)
        except HTTPError as exc:
            status = exc.code
            exc.close()
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE endpoint request failed.",
                details={"http_status": status},
            ) from exc
        except URLError as exc:
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE endpoint request failed.",
                details={"exception_type": type(exc.reason).__name__},
            ) from exc
        except TimeoutError as exc:
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE endpoint request timed out.",
                details={"timeout_seconds": self._timeout_seconds},
            ) from exc
        if _http_content_type(response) != "text/event-stream":
            response.close()
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE endpoint content type is unsupported.",
                details={"content_type": _http_content_type(response) or "missing"},
            )
        self._legacy_sse_response = response
        line_queue: queue.Queue[bytes | Exception | None] = queue.Queue()
        self._legacy_sse_line_queue = line_queue
        reader_thread = threading.Thread(
            target=_read_http_sse_lines,
            args=(response, line_queue),
            daemon=True,
        )
        self._legacy_sse_reader_thread = reader_thread
        reader_thread.start()
        event_name, endpoint = self._read_legacy_sse_event(
            stage=stage,
            deadline=time.monotonic() + self._timeout_seconds,
        )
        if event_name != "endpoint" or endpoint.strip() == "":
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE endpoint event was missing.",
                details={"legacy_endpoint_event": "missing"},
            )
        message_endpoint_url = urljoin(self._require_endpoint_url(), endpoint.strip())
        parsed = urlparse(message_endpoint_url)
        if parsed.scheme not in {"http", "https"} or parsed.netloc == "":
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE message endpoint URL is invalid.",
                details={"url_scheme": parsed.scheme or "missing"},
            )
        self._legacy_message_endpoint_url = message_endpoint_url

    def _legacy_post_json_rpc(
        self,
        message: Mapping[str, object],
        *,
        stage: str,
        expected_response_id: int | None,
    ) -> Mapping[str, object] | None:
        try:
            body = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE request body could not be encoded.",
                details={"exception_type": type(exc).__name__},
            ) from exc
        request = Request(
            self._require_legacy_message_endpoint_url(),
            data=body,
            method="POST",
            headers=self._legacy_post_headers(),
        )
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                if response.status not in {200, 202}:
                    raise self._error(
                        stage,
                        "Project MCP legacy HTTP+SSE POST was not accepted.",
                        details={"http_status": response.status},
                    )
        except HTTPError as exc:
            status = exc.code
            exc.close()
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE POST failed.",
                details={"http_status": status},
            ) from exc
        except URLError as exc:
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE POST failed.",
                details={"exception_type": type(exc.reason).__name__},
            ) from exc
        except TimeoutError as exc:
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE POST timed out.",
                details={"timeout_seconds": self._timeout_seconds},
            ) from exc
        if expected_response_id is None:
            return None
        deadline = time.monotonic() + self._timeout_seconds
        while True:
            event_name, event_data = self._read_legacy_sse_event(stage=stage, deadline=deadline)
            if event_name != "message":
                continue
            message_payload = self._legacy_sse_message(event_data, stage=stage)
            if message_payload.get("id") != expected_response_id:
                continue
            return message_payload

    def _read_legacy_sse_event(self, *, stage: str, deadline: float) -> tuple[str, str]:
        event_name = "message"
        data_lines: list[str] = []
        data_size_bytes = 0
        while True:
            line = self._read_legacy_sse_line(stage=stage, deadline=deadline)
            try:
                decoded_line = line.decode("utf-8").rstrip("\r\n")
            except UnicodeDecodeError as exc:
                raise self._error(
                    stage,
                    "Project MCP legacy HTTP+SSE event was not valid UTF-8.",
                    details={"exception_type": type(exc).__name__},
                ) from exc
            if decoded_line == "":
                if not data_lines:
                    event_name = "message"
                    continue
                event_data = "\n".join(data_lines)
                return event_name, event_data
            if decoded_line.startswith(":"):
                continue
            field_name, separator, field_value = decoded_line.partition(":")
            if separator == "":
                continue
            value = field_value[1:] if field_value.startswith(" ") else field_value
            if field_name == "event":
                event_name = value
            elif field_name == "data":
                data_size_bytes = _mcp_sse_data_size(data_size_bytes, value)
                if data_size_bytes > _MCP_MAX_RESPONSE_BYTES:
                    raise self._error(
                        stage,
                        "Project MCP legacy HTTP+SSE event exceeded size limit.",
                        details={"response_size_limit": _MCP_MAX_RESPONSE_BYTES},
                    )
                data_lines.append(value)

    def _read_legacy_sse_line(self, *, stage: str, deadline: float) -> bytes:
        remaining_seconds = deadline - time.monotonic()
        if remaining_seconds <= 0:
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE response timed out.",
                details={"timeout_seconds": self._timeout_seconds},
            )
        line_queue = self._require_legacy_sse_line_queue()
        try:
            line = line_queue.get(timeout=remaining_seconds)
        except queue.Empty as exc:
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE response timed out.",
                details={"timeout_seconds": self._timeout_seconds},
            ) from exc
        if isinstance(line, Exception):
            if isinstance(line, TimeoutError):
                raise self._error(
                    stage,
                    "Project MCP legacy HTTP+SSE response timed out.",
                    details={"timeout_seconds": self._timeout_seconds},
                ) from line
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE read failed.",
                details={"exception_type": type(line).__name__},
            ) from line
        if line is None:
            raise self._error(stage, "Project MCP legacy HTTP+SSE stream ended before response.")
        if len(line) > _MCP_MAX_RESPONSE_BYTES:
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE response exceeded size limit.",
                details={"response_size_limit": _MCP_MAX_RESPONSE_BYTES},
            )
        return line

    def _legacy_sse_message(self, event_data: str, *, stage: str) -> Mapping[str, object]:
        try:
            message = json.loads(event_data)
        except json.JSONDecodeError as exc:
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE message was not valid JSON.",
                details={"exception_type": type(exc).__name__},
            ) from exc
        if not isinstance(message, Mapping):
            raise self._error(
                stage,
                "Project MCP legacy HTTP+SSE message was not a JSON object.",
                details={"result_type": type(message).__name__},
            )
        return message

    def _sse_message(self, data_lines: list[str], *, stage: str) -> Mapping[str, object] | None:
        if not data_lines:
            return None
        try:
            message = json.loads("\n".join(data_lines))
        except json.JSONDecodeError as exc:
            raise self._error(
                stage,
                "Project MCP HTTP SSE event was not valid JSON.",
                details={"exception_type": type(exc).__name__},
            ) from exc
        if not isinstance(message, Mapping):
            raise self._error(
                stage,
                "Project MCP HTTP SSE event was not a JSON object.",
                details={"result_type": type(message).__name__},
            )
        return message

    def _response_result(self, response: Mapping[str, object] | None, *, stage: str) -> Mapping[str, object]:
        if response is None:
            raise self._error(stage, "Project MCP HTTP JSON-RPC response is missing.")
        error = response.get("error")
        if isinstance(error, Mapping):
            raise self._error(
                stage,
                "Project MCP JSON-RPC request failed.",
                details={"jsonrpc_error_type": type(error.get("code")).__name__},
            )
        result = response.get("result")
        if not isinstance(result, Mapping):
            raise self._error(
                stage,
                "Project MCP JSON-RPC response is missing object result.",
                details={"result_type": type(result).__name__},
            )
        return result

    def _http_headers(self) -> dict[str, str]:
        headers = dict(self._secret_headers)
        headers.update(
            {
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            }
        )
        if self._protocol_version is not None:
            headers["MCP-Protocol-Version"] = self._protocol_version
        if self._session_id is not None:
            headers["Mcp-Session-Id"] = self._session_id
        return headers

    def _legacy_sse_headers(self) -> dict[str, str]:
        headers = dict(self._secret_headers)
        headers["Accept"] = "text/event-stream"
        return headers

    def _legacy_post_headers(self) -> dict[str, str]:
        headers = dict(self._secret_headers)
        headers["Content-Type"] = "application/json"
        return headers

    def _capture_http_session_id(self, response: HTTPResponse, *, stage: str) -> None:
        session_id = response.headers.get("Mcp-Session-Id")
        if session_id is None:
            return
        if not _valid_mcp_session_id(session_id):
            raise self._error(stage, "Project MCP HTTP session id was invalid.")
        self._session_id = session_id

    def _next_request_id(self) -> int:
        request_id = self._next_id
        self._next_id += 1
        return request_id

    def _require_endpoint_url(self) -> str:
        if self._endpoint_url is None:
            raise self._error("client_lifecycle", "Project MCP HTTP endpoint is not configured.")
        return self._endpoint_url

    def _require_legacy_message_endpoint_url(self) -> str:
        if self._legacy_message_endpoint_url is None:
            raise self._error("client_lifecycle", "Project MCP legacy HTTP+SSE endpoint is not configured.")
        return self._legacy_message_endpoint_url

    def _require_legacy_sse_line_queue(self) -> queue.Queue[bytes | Exception | None]:
        if self._legacy_sse_line_queue is None:
            raise self._error("client_lifecycle", "Project MCP legacy HTTP+SSE stream is not started.")
        return self._legacy_sse_line_queue

    def _require_config(self) -> ProjectMCPServerConfig:
        if self._config is None:
            raise RuntimeError("ProjectMCPHttpDiscoveryClient used before start().")
        return self._config

    def _error(
        self,
        stage: str,
        message: str,
        *,
        details: Mapping[str, object] | None = None,
    ) -> ProjectMCPDiscoveryError:
        return _mcp_discovery_error(self._require_config(), stage=stage, message=message, details=details)


class ProjectToolLockSnapshot(BaseModel):
    """Run startup lock snapshot for enabled project tools."""

    model_config = ConfigDict(extra="forbid")

    skills: list[ProjectSkillLockEntry] = Field(default_factory=list)
    mcps: list[ProjectMCPLockEntry] = Field(default_factory=list)


class RuntimeLock:
    def __init__(self, lock_path: Path, *, timeout_seconds: float = 60.0) -> None:
        self._lock_path = lock_path
        self._timeout_seconds = timeout_seconds
        self._fd: int | None = None

    def __enter__(self) -> RuntimeLock:
        deadline = time.monotonic() + self._timeout_seconds
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                self._fd = os.open(str(self._lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                os.write(self._fd, f"pid={os.getpid()}\nacquired_at={_utc_now()}\n".encode())
                return self
            except FileExistsError as exc:
                if time.monotonic() >= deadline:
                    raise HarnessError(
                        "RH_LOCK_TIMEOUT",
                        f"Timed out acquiring {self._lock_path.name}.",
                        status_code=423,
                        details={"lock_path": _to_posix(self._lock_path)},
                    ) from exc
                time.sleep(0.05)

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None
        try:
            self._lock_path.unlink()
        except FileNotFoundError:
            pass


def initialize_project(request: ProjectCreateRequest) -> ProjectCreateResponse:
    project_root = _resolve_project_root(request.host_path)
    agent_root = project_root / AGENT_WORKFLOW_DIR
    project_json_path = agent_root / "project.json"
    if project_json_path.exists():
        raise HarnessError(
            "RES_ALREADY_EXISTS",
            "CognitiveWorkflow project already exists at host_path.",
            status_code=409,
            details={"host_path": _to_posix(project_root)},
        )

    project_id = _new_ulid()
    workflow_id = _new_ulid()
    now = _utc_now()

    project_root.mkdir(parents=True, exist_ok=True)
    _create_directories(project_root)
    ensure_runtime_databases(project_root)
    _append_missing_lines(project_root / ".gitignore", _GITIGNORE_LINES)
    _append_missing_lines(project_root / ".gitattributes", _GITATTRIBUTES_LINES)

    workflow_graph = _default_workflow_graph(workflow_id=workflow_id, display_name=request.display_name, now=now)
    manifests = _initial_manifests(
        project_id=project_id,
        workflow_id=workflow_id,
        display_name=request.display_name,
        settings_overrides=request.settings_overrides,
        now=now,
        workflow_graph=workflow_graph,
    )
    for relative_path, payload in manifests.items():
        _write_json_atomic(agent_root / relative_path, payload)
    _write_text_atomic(agent_root / "reflection_memory.jsonl", "")
    _write_text_atomic(agent_root / "artifacts" / "index.jsonl", "")
    _write_text_atomic(agent_root / "snapshots" / "snapshots.jsonl", "")
    first_commit_sha = _initialize_git_and_commit(project_root, project_id)
    record_initial_git_snapshot(project_root, project_id=project_id, commit_sha=first_commit_sha, created_at=now)
    return ProjectCreateResponse(
        project_id=project_id,
        host_path=_to_posix(project_root),
        git_initialized=True,
        first_commit_sha=first_commit_sha,
    )


def read_project(project_root: Path) -> ProjectDocument:
    resolved_root = project_root.resolve()
    project_json = _read_json(resolved_root / AGENT_WORKFLOW_DIR / "project.json")
    return ProjectDocument.model_validate({**project_json, "host_path": _to_posix(resolved_root)})


def read_project_references(project_root: Path) -> ProjectReferenceManifest:
    """Read the project reference manifest with spec-limited fields."""

    return _read_project_reference_manifest(project_root)


def import_project_reference(
    project_root: Path,
    *,
    metadata: ProjectReferenceImportMetadata,
    filename: str,
    content: bytes,
) -> ProjectReferenceEntry:
    """Import a reference file and update ``references.manifest.json``."""

    resolved_root = project_root.resolve()
    reference_id = _new_ulid()
    stored_filename = _reference_stored_filename(reference_id, filename, kind=metadata.kind)
    relative_path = f"references/{stored_filename}"
    _validate_project_relative_path(relative_path)
    now = _utc_now()
    content_hash = sha256(content).hexdigest()
    entry = ProjectReferenceEntry(
        reference_id=reference_id,
        path=relative_path,
        kind=metadata.kind,
        enabled=True,
        source_url=_normalized_optional_string(metadata.source_url),
        content_hash=f"sha256:{content_hash}",
        chunk_status="stale" if metadata.auto_chunk else "none",
        sensitive=metadata.sensitive,
        imported_at=now,
    )

    paths = [*_REFERENCE_COMMIT_PATHS]
    if not entry.sensitive:
        paths.append(relative_path)
    agent_root = resolved_root / AGENT_WORKFLOW_DIR
    with _acquire_git_lock(resolved_root):
        with acquire_runtime_lock(resolved_root):
            manifest = _read_project_reference_manifest(resolved_root)
            payload = ProjectReferenceManifest(
                entries=[*manifest.entries, entry],
                index_snapshot_id=manifest.index_snapshot_id,
            )
            _write_bytes_atomic(resolved_root / relative_path, content)
            _update_manifest_json_locked(
                agent_root,
                "references.manifest.json",
                payload.model_dump(mode="json", exclude_none=True),
            )
        _commit_reference_manifest_change_locked(resolved_root, action="import", reference_id=reference_id, paths=paths)
    return entry


def update_project_reference_enabled(
    project_root: Path,
    *,
    reference_id: str,
    enabled: bool,
) -> ProjectReferenceEntry:
    """Enable or disable a project reference entry."""

    normalized_reference_id = _normalize_reference_id(reference_id)
    resolved_root = project_root.resolve()
    agent_root = resolved_root / AGENT_WORKFLOW_DIR
    action: Literal["enable", "disable"] = "enable" if enabled else "disable"
    changed = False
    with _acquire_git_lock(resolved_root):
        with acquire_runtime_lock(resolved_root):
            manifest = _read_project_reference_manifest(resolved_root)
            updated_entries: list[ProjectReferenceEntry] = []
            updated_entry: ProjectReferenceEntry | None = None
            for entry in manifest.entries:
                if entry.reference_id != normalized_reference_id:
                    updated_entries.append(entry)
                    continue
                if entry.enabled == enabled:
                    updated_entry = entry
                    updated_entries.append(entry)
                    continue
                updated_entry = entry.model_copy(update={"enabled": enabled})
                updated_entries.append(updated_entry)
                changed = True
            if updated_entry is None:
                raise HarnessError(
                    "RES_NOT_FOUND",
                    "Project reference is not registered.",
                    status_code=404,
                    details={"reference_id": normalized_reference_id},
                )
            if changed:
                payload = ProjectReferenceManifest(
                    entries=updated_entries,
                    index_snapshot_id=manifest.index_snapshot_id,
                )
                _update_manifest_json_locked(
                    agent_root,
                    "references.manifest.json",
                    payload.model_dump(mode="json", exclude_none=True),
                )

        if changed:
            _commit_reference_manifest_change_locked(
                resolved_root,
                action=action,
                reference_id=normalized_reference_id,
                paths=_REFERENCE_COMMIT_PATHS,
            )
    return updated_entry


def load_project_tool_availability(project_root: Path) -> ProjectToolAvailability:
    """Load enabled Skill and MCP ids from project manifests without starting tools."""

    return ProjectToolAvailability(
        skill_ids=load_enabled_skill_ids(project_root),
        skill_refs=load_enabled_skill_refs(project_root),
        mcp_server_ids=load_enabled_mcp_server_ids(project_root),
    )


def load_project_tool_lock_snapshot(
    project_root: Path,
    *,
    mcp_tool_discovery: ProjectMCPToolDiscovery | None = None,
) -> ProjectToolLockSnapshot:
    """Load replay lock entries for enabled Skill and MCP manifests."""

    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    mcp_configs = load_project_mcp_server_configs(project_root) if mcp_tool_discovery is not None else {}
    return ProjectToolLockSnapshot(
        skills=[
            _skill_lock_entry(entry)
            for _entry_id, entry in _iter_enabled_manifest_entries(
                agent_root / "skills.config.json",
                id_field="skill_id",
            )
        ],
        mcps=[
            _mcp_lock_entry(
                entry,
                mcp_config=mcp_configs.get(_entry_id),
                mcp_tool_discovery=mcp_tool_discovery,
            )
            for _entry_id, entry in _iter_enabled_manifest_entries(
                agent_root / "mcp.config.json",
                id_field="server_id",
            )
        ],
    )


def load_project_mcp_server_configs(project_root: Path) -> dict[str, ProjectMCPServerConfig]:
    """Load enabled project MCP server configs without resolving secrets."""

    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    configs: dict[str, ProjectMCPServerConfig] = {}
    for server_id, entry in _iter_enabled_manifest_entries(
        agent_root / "mcp.config.json",
        id_field="server_id",
    ):
        config = _mcp_server_config_entry(server_id, entry)
        if config is None:
            continue
        configs[server_id] = config
    return configs


def load_enabled_skill_ids(project_root: Path) -> set[str]:
    """Load enabled Skill ids from ``skills.config.json``."""

    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    return _load_enabled_manifest_ids(
        agent_root / "skills.config.json",
        id_field="skill_id",
    )


def load_enabled_skill_refs(project_root: Path) -> set[str]:
    """Load enabled versioned Skill refs from ``skills.config.json``."""

    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    return {
        _skill_ref_from_entry(entry)
        for _entry_id, entry in _iter_enabled_manifest_entries(
            agent_root / "skills.config.json",
            id_field="skill_id",
        )
    }


def load_enabled_mcp_server_ids(project_root: Path) -> set[str]:
    """Load enabled MCP server ids from ``mcp.config.json``."""

    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    return _load_enabled_manifest_ids(
        agent_root / "mcp.config.json",
        id_field="server_id",
    )


def update_manifest_json(
    project_root: Path,
    manifest_name: str,
    payload: Mapping[str, Any],
    *,
    allow_memory_write: bool = False,
    timeout_seconds: float = 60.0,
) -> None:
    if manifest_name not in _REVISION_MANIFESTS:
        raise HarnessError(
            "RH_MANIFEST_REVISION_MISMATCH",
            "Unknown manifest name.",
            status_code=409,
            details={"manifest_name": manifest_name},
        )
    if not isinstance(payload, Mapping):
        raise TypeError("manifest payload must be a JSON object mapping")
    if manifest_name == "memory.json" and not allow_memory_write:
        raise HarnessError(
            "RH_MEMORY_DIRECT_WRITE_FORBIDDEN",
            "memory.json writes must go through memory_task or explicit UI operation.",
            status_code=403,
        )

    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    with acquire_runtime_lock(project_root, timeout_seconds=timeout_seconds):
        _update_manifest_json_locked(agent_root, manifest_name, payload)


def acquire_runtime_lock(project_root: Path, *, timeout_seconds: float = 60.0) -> RuntimeLock:
    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    return RuntimeLock(agent_root / "locks" / RUNTIME_LOCK_FILE, timeout_seconds=timeout_seconds)


def _acquire_git_lock(project_root: Path, *, timeout_seconds: float = 60.0) -> RuntimeLock:
    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    return RuntimeLock(agent_root / "locks" / GIT_LOCK_FILE, timeout_seconds=timeout_seconds)


def _update_manifest_json_locked(agent_root: Path, manifest_name: str, payload: Mapping[str, Any]) -> None:
    revision = _read_json(agent_root / MANIFEST_REVISION_FILE)
    if manifest_name not in revision:
        raise HarnessError(
            "RH_MANIFEST_REVISION_MISMATCH",
            "manifest_revision.json does not track manifest.",
            status_code=409,
            details={"manifest_name": manifest_name},
        )
    _write_json_atomic(agent_root / manifest_name, dict(payload))
    current = revision[manifest_name]
    if not isinstance(current, dict) or "revision" not in current:
        raise HarnessError(
            "RH_MANIFEST_REVISION_MISMATCH",
            "manifest_revision.json entry is invalid.",
            status_code=409,
            details={"manifest_name": manifest_name},
        )
    current_revision = int(current["revision"])
    revision[manifest_name] = {"revision": current_revision + 1, "modified_at": _utc_now()}
    _write_json_atomic(agent_root / MANIFEST_REVISION_FILE, revision)


def _resolve_project_root(host_path: str) -> Path:
    raw_path = Path(host_path).expanduser()
    for part in raw_path.parts:
        if part in (raw_path.anchor, os.sep, ""):
            continue
        if any(char in _INVALID_PATH_CHARS for char in part):
            raise HarnessError(
                "RH_PATH_INVALID_CHAR",
                "host_path contains an OS-forbidden path character.",
                status_code=400,
                details={"host_path": host_path, "path_part": part},
            )
    resolved = raw_path.resolve(strict=False)
    if len(str(resolved)) > 240:
        raise HarnessError(
            "RH_PATH_TOO_LONG",
            "host_path exceeds the 240 character runtime limit.",
            status_code=400,
            details={"host_path": _to_posix(resolved)},
        )
    return resolved


def _create_directories(project_root: Path) -> None:
    directories = [
        ".agent-workflow/runs",
        ".agent-workflow/planning_sessions",
        ".agent-workflow/artifacts",
        ".agent-workflow/snapshots",
        ".agent-workflow/traces",
        ".agent-workflow/secure",
        ".agent-workflow/cache",
        ".agent-workflow/locks",
        "references",
        "workflow",
        "outputs",
    ]
    for directory in directories:
        (project_root / directory).mkdir(parents=True, exist_ok=True)


def _initial_manifests(
    *,
    project_id: str,
    workflow_id: str,
    display_name: str,
    settings_overrides: Mapping[str, Any],
    now: str,
    workflow_graph: WorkflowGraph,
) -> dict[str, Any]:
    settings = _merge_dicts(_default_settings(), settings_overrides)
    return {
        "project.json": {
            "schema_version": RUNTIME_SCHEMA_VERSION,
            "project_id": project_id,
            "display_name": display_name,
            "created_at": now,
            "cw_version": __version__,
            "active_workflow_id": workflow_id,
            "settings_ref": "settings.json",
            "manifest_revisions_ref": MANIFEST_REVISION_FILE,
            "last_opened_at": now,
            "tags": [],
            "metadata": {},
        },
        "settings.json": settings,
        "workflow.flow.json": workflow_graph.model_dump(mode="json"),
        "workflow_history.json": {
            "entries": [
                {
                    "workflow_id": workflow_id,
                    "version": "0.1.0",
                    "instantiated_at": now,
                    "git_commit_sha": "",
                    "git_tag": None,
                    "derived_from_draft_id": None,
                    "change_summary": "Initial empty workflow created with project skeleton.",
                }
            ]
        },
        "memory.json": {
            "schema_version": RUNTIME_SCHEMA_VERSION,
            "goal": display_name,
            "constraints": [],
            "decisions": [],
            "user_preferences": {},
            "active_workflow_id": workflow_id,
            "last_modified_at": now,
            "version": 0,
            "metadata": {},
        },
        "references.manifest.json": {"entries": [], "index_snapshot_id": ""},
        "skills.config.json": [],
        "mcp.config.json": [],
        "adapters.config.json": [],
        MANIFEST_REVISION_FILE: {
            manifest_name: {"revision": 1, "modified_at": now} for manifest_name in _REVISION_MANIFESTS
        },
    }


def _default_settings() -> dict[str, Any]:
    return {
        "schema_version": RUNTIME_SCHEMA_VERSION,
        "models": {
            "default_model_profile_id": "claude-sonnet-default",
            "escalation_chain": ["claude-opus-strong"],
            "forbid_remote_for_sensitive": True,
            "forbid_provider_kinds": [],
        },
        "execution": {
            "default_mode": "semi_auto",
            "max_concurrent_nodes": 1,
            "default_timeout_seconds": 600,
        },
        "review": {
            "default_max_retry": 2,
            "escalate_after_repairs": 3,
            "evidence_required_for_factual_outputs": True,
        },
        "privacy": {
            "sensitive_data_mode": "strict",
            "disable_remote_models": False,
            "encrypt_reflection_memory": True,
        },
        "git": {
            "auto_commit_enabled": True,
            "auto_tag_workflow": True,
            "commit_author_name": "",
            "commit_email": "",
        },
        "streaming": {
            "default_display_level": "default",
            "heartbeat_seconds": 15,
            "cache_ttl_seconds": 300,
        },
        "gc": {
            "runs_retention_days": 90,
            "artifacts_retention_days": 90,
            "cache_retention_days": 30,
        },
        "experiments": {"feature_flags": {}},
    }


def _default_workflow_graph(*, workflow_id: str, display_name: str, now: str) -> WorkflowGraph:
    payload = {
        "workflow_id": workflow_id,
        "version": "0.1.0",
        "schema_version": RUNTIME_SCHEMA_VERSION,
        "title": f"{display_name} Workflow",
        "description": "Initial empty workflow created with the project runtime harness.",
        "nodes": [
            {"node_id": "n_start", "type": "start", "title": "Start", "trigger": "manual"},
            {"node_id": "n_end", "type": "end", "title": "End", "archive_actions": []},
        ],
        "edges": [
            {
                "edge_id": "e_start_end",
                "source_node_id": "n_start",
                "target_node_id": "n_end",
                "type": "normal",
            }
        ],
        "entry_node_id": "n_start",
        "terminal_node_ids": ["n_end"],
        "global_context_refs": [],
        "execution_policy": {
            "mode": "semi_auto",
            "max_concurrent_nodes": 1,
            "default_timeout_seconds": 600,
            "on_node_failure": "human",
        },
        "review_policy": {
            "default_max_retry": 2,
            "escalate_after_repairs": 3,
            "evidence_required_for_factual_outputs": True,
        },
        "model_policy": {
            "default_model_profile_id": "claude-sonnet-default",
            "escalation_chain": ["claude-opus-strong"],
            "forbid_remote_for_sensitive": True,
        },
        "created_by": "manual_editor",
        "created_at": now,
        "last_modified_at": now,
        "metadata": {},
    }
    return WorkflowGraph.model_validate(payload)


def _merge_dicts(base: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in overrides.items():
        existing = merged.get(key)
        if isinstance(existing, dict) and isinstance(value, Mapping):
            merged[key] = _merge_dicts(existing, value)
        else:
            merged[key] = value
    return merged


def _initialize_git_and_commit(project_root: Path, project_id: str) -> str | None:
    init_result = _run_git(project_root, ["rev-parse", "--is-inside-work-tree"], check=False)
    if init_result.returncode != 0:
        _run_git(project_root, ["init", "-b", "main"], error_code="RH_INIT_GIT_FAILED")
    _install_pre_commit_hook(project_root)
    _run_git(project_root, ["add", *_TRACKED_INIT_PATHS], error_code="RH_INIT_GIT_FAILED")
    commit_args = [
        *_git_identity_args(project_root),
        "commit",
        "--only",
        "-m",
        f"chore(cw): initialize CognitiveWorkflow project {project_id}",
        "--",
        *_TRACKED_INIT_PATHS,
    ]
    commit_result = _run_git(project_root, commit_args, check=False)
    if commit_result.returncode != 0:
        raise HarnessError(
            "RH_GIT_AUTOCOMMIT_BLOCKED",
            "Initial CognitiveWorkflow git commit failed.",
            status_code=500,
            details={"stderr": commit_result.stderr.strip()},
        )
    head = _run_git(project_root, ["rev-parse", "HEAD"], error_code="RH_INIT_GIT_FAILED")
    return head.stdout.strip()


def _git_identity_args(project_root: Path) -> list[str]:
    name = _run_git(project_root, ["config", "user.name"], check=False).stdout.strip()
    email = _run_git(project_root, ["config", "user.email"], check=False).stdout.strip()
    if name and email:
        return []
    return ["-c", "user.name=CW Runtime", "-c", "user.email=cw-runtime@local"]


def _run_git(
    project_root: Path,
    args: list[str],
    *,
    check: bool = True,
    error_code: str = "RH_INIT_GIT_FAILED",
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=project_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if check and result.returncode != 0:
        raise HarnessError(
            error_code,
            "git command failed during CognitiveWorkflow project initialization.",
            status_code=500,
            details={"args": ["git", *args], "stderr": result.stderr.strip()},
        )
    return result


def _install_pre_commit_hook(project_root: Path) -> None:
    hook_path_result = _run_git(project_root, ["rev-parse", "--git-path", "hooks/pre-commit"], check=False)
    if hook_path_result.returncode != 0 or hook_path_result.stdout.strip() == "":
        raise HarnessError(
            "RH_INIT_PRECOMMIT_HOOK_FAILED",
            "Failed to resolve git pre-commit hook path.",
            status_code=500,
            details={"stderr": hook_path_result.stderr.strip()},
        )
    hook_path = Path(hook_path_result.stdout.strip())
    if not hook_path.is_absolute():
        hook_path = project_root / hook_path
    hook_body = """#!/bin/sh
set -eu

tracked=$(git diff --cached --name-only)
if printf '%s\n' "$tracked" | grep -E '(^|/)\\.agent-workflow/(secure|cache)/' >/dev/null; then
  echo 'CW pre-commit: secure/cache files must not be committed' >&2
  exit 1
fi
if printf '%s\n' "$tracked" | grep -E '^\\.agent-workflow/runs/[^/]+/stream-events/' >/dev/null; then
  echo 'CW pre-commit: run stream-events must not be committed' >&2
  exit 1
fi
if printf '%s\n' "$tracked" | grep -E '^\\.agent-workflow/planning_sessions/[^/]+/stream-events\\.jsonl$' >/dev/null; then
  echo 'CW pre-commit: planning stream-events must not be committed' >&2
  exit 1
fi
if printf '%s\n' "$tracked" | grep -E '\\.encrypted\\.sqlite$' | grep -v '^\\.agent-workflow/secure/' >/dev/null; then
  echo 'CW pre-commit: encrypted sqlite files outside secure/ are forbidden' >&2
  exit 1
fi
if git diff --cached -G'(sk-[A-Za-z0-9]|sk-proj-|ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|GOOGLE_API_KEY|GITHUB_TOKEN|GITLAB_TOKEN)' --name-only -- | grep . >/dev/null; then
  echo 'CW pre-commit: known secret prefix detected' >&2
  exit 1
fi
"""
    _write_text_atomic(hook_path, hook_body)
    try:
        hook_path.chmod(0o755)
    except OSError as exc:
        raise HarnessError(
            "RH_INIT_PRECOMMIT_HOOK_FAILED",
            "Failed to mark pre-commit hook executable.",
            status_code=500,
            details={"hook_path": _to_posix(hook_path)},
        ) from exc


def _append_missing_lines(path: Path, lines: list[str]) -> None:
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    output = list(existing)
    for line in lines:
        if line == "" or line not in output:
            output.append(line)
    _write_text_atomic(path, "\n".join(output).rstrip() + "\n")


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        loaded = json.load(file)
    if not isinstance(loaded, dict):
        raise HarnessError(
            "RH_RUN_DIR_CORRUPTED",
            "Expected manifest JSON object.",
            status_code=500,
            details={"path": _to_posix(path)},
        )
    return loaded


def _read_project_reference_manifest(project_root: Path) -> ProjectReferenceManifest:
    manifest_path = project_root.resolve() / AGENT_WORKFLOW_DIR / "references.manifest.json"
    try:
        payload = _read_json(manifest_path)
        return ProjectReferenceManifest.model_validate(payload)
    except FileNotFoundError as exc:
        raise HarnessError(
            "RES_NOT_FOUND",
            "Project reference manifest was not found.",
            status_code=404,
            details={"manifest_name": "references.manifest.json"},
        ) from exc
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        raise HarnessError(
            "RES_NOT_FOUND",
            "Project reference manifest is not available.",
            status_code=404,
            details={"manifest_name": "references.manifest.json"},
        ) from exc


def _read_json_list(path: Path) -> list[object]:
    try:
        with path.open("r", encoding="utf-8") as file:
            loaded = json.load(file)
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(loaded, list):
        return []
    return cast(list[object], loaded)


def _iter_enabled_manifest_entries(path: Path, *, id_field: str) -> list[tuple[str, Mapping[str, object]]]:
    entries = _read_json_list(path)
    enabled_entries: list[tuple[str, Mapping[str, object]]] = []
    seen_ids: set[str] = set()
    for raw_entry in entries:
        if not isinstance(raw_entry, Mapping):
            continue
        entry = cast(Mapping[str, object], raw_entry)
        enabled = entry.get("enabled", True)
        if not isinstance(enabled, bool) or not enabled:
            continue
        raw_id = entry.get(id_field)
        if not isinstance(raw_id, str):
            continue
        entry_id = raw_id.strip()
        if entry_id == "" or entry_id in seen_ids:
            continue
        seen_ids.add(entry_id)
        enabled_entries.append((entry_id, entry))
    return enabled_entries


def _load_enabled_manifest_ids(path: Path, *, id_field: str) -> set[str]:
    return {entry_id for entry_id, _entry in _iter_enabled_manifest_entries(path, id_field=id_field)}


def _skill_lock_entry(entry: Mapping[str, object]) -> ProjectSkillLockEntry:
    return ProjectSkillLockEntry(
        skill_id=cast(str, entry["skill_id"]).strip(),
        version=_string_manifest_field(entry, "version", default="latest"),
    )


def _skill_ref_from_entry(entry: Mapping[str, object]) -> str:
    skill_id = cast(str, entry["skill_id"]).strip()
    version = _string_manifest_field(entry, "version", default="latest")
    return f"{skill_id}@{version}"


def _mcp_lock_entry(
    entry: Mapping[str, object],
    *,
    mcp_config: ProjectMCPServerConfig | None,
    mcp_tool_discovery: ProjectMCPToolDiscovery | None,
) -> ProjectMCPLockEntry:
    discovered = (
        _discover_mcp_tools(mcp_config, mcp_tool_discovery)
        if mcp_tool_discovery is not None and mcp_config is not None
        else None
    )
    return ProjectMCPLockEntry(
        server_id=cast(str, entry["server_id"]).strip(),
        version="latest" if discovered is None else discovered.version,
        tools_snapshot=[] if discovered is None else discovered.tools_snapshot,
    )


def _discover_mcp_tools(
    mcp_config: ProjectMCPServerConfig,
    mcp_tool_discovery: ProjectMCPToolDiscovery,
) -> ProjectMCPDiscoveredTools | None:
    try:
        discovered: object | None = mcp_tool_discovery(mcp_config)
    except ProjectMCPDiscoveryError as exc:
        raise _sanitize_mcp_discovery_error(
            mcp_config,
            exc,
            default_stage="discover_tools",
            message="Project MCP tool discovery provider failed.",
        ) from exc
    except Exception as exc:
        raise _mcp_discovery_error(
            mcp_config,
            stage="discover_tools",
            message="Project MCP tool discovery provider failed.",
            details={"exception_type": type(exc).__name__},
        ) from exc
    if discovered is None:
        return None
    if not isinstance(discovered, ProjectMCPDiscoveredTools):
        raise _mcp_discovery_error(
            mcp_config,
            stage="discover_tools",
            message="Project MCP tool discovery provider returned an invalid snapshot.",
            details={"result_type": type(discovered).__name__},
        )
    return discovered


def _mcp_discovery_error(
    mcp_config: ProjectMCPServerConfig,
    *,
    stage: str,
    message: str,
    details: Mapping[str, object] | None = None,
) -> ProjectMCPDiscoveryError:
    error_details: dict[str, object] = {
        "server_id": mcp_config.server_id,
        "transport": mcp_config.transport,
    }
    if details is not None:
        error_details.update(details)
    error = ProjectMCPDiscoveryError(
        mcp_config.server_id,
        stage,
        message,
        details=error_details,
    )
    error._cw_sanitized = True
    return error


def _sanitize_mcp_discovery_error(
    mcp_config: ProjectMCPServerConfig,
    error: ProjectMCPDiscoveryError,
    *,
    default_stage: str,
    message: str,
) -> ProjectMCPDiscoveryError:
    if error.sanitized:
        return error
    return _mcp_discovery_error(
        mcp_config,
        stage=_safe_mcp_discovery_stage(error.stage, default=default_stage),
        message=message,
        details={"exception_type": type(error).__name__},
    )


def _safe_mcp_discovery_stage(stage: str, *, default: str) -> str:
    return stage if stage in _MCP_DISCOVERY_ERROR_STAGES else default


def _http_content_type(response: HTTPResponse) -> str:
    content_type = response.headers.get("Content-Type", "")
    return content_type.split(";", maxsplit=1)[0].strip().lower()


def _valid_mcp_session_id(session_id: str) -> bool:
    return session_id != "" and all(0x21 <= ord(char) <= 0x7E for char in session_id)


def _stdio_command(command_or_url: str) -> str | list[str] | None:
    command = command_or_url.strip()
    if command == "":
        return None
    if os.name == "nt":
        return command
    return shlex.split(command)


def _mcp_stdio_process_env(secret_env: Mapping[str, str]) -> dict[str, str] | None:
    if not secret_env:
        return None
    process_env = dict(os.environ)
    process_env.update(secret_env)
    return process_env


def _mcp_stdio_secret_env(
    secret_env: Mapping[str, str],
    *,
    mcp_config: ProjectMCPServerConfig,
) -> dict[str, str]:
    sanitized: dict[str, str] = {}
    for raw_name, raw_value in secret_env.items():
        env_name = raw_name.strip()
        if env_name == "" or any(char in env_name for char in "\x00="):
            raise _mcp_discovery_error(
                mcp_config,
                stage="client_lifecycle",
                message="Project MCP stdio secret env name is invalid.",
                details={"env_name_type": type(raw_name).__name__},
            )
        if "\x00" in raw_value:
            raise _mcp_discovery_error(
                mcp_config,
                stage="client_lifecycle",
                message="Project MCP stdio secret env value is invalid.",
                details={"env_name": env_name},
            )
        sanitized[env_name] = raw_value
    return sanitized


def _read_stdio_stdout(stdout: TextIO, output_queue: queue.Queue[str | Exception | None]) -> None:
    try:
        while True:
            line = stdout.readline(_MCP_MAX_RESPONSE_BYTES + 1)
            if line == "":
                break
            output_queue.put(line)
    except Exception as exc:
        output_queue.put(exc)
    finally:
        stdout.close()
        output_queue.put(None)


def _read_http_sse_lines(response: HTTPResponse, output_queue: queue.Queue[bytes | Exception | None]) -> None:
    try:
        while True:
            line = response.readline(_MCP_MAX_RESPONSE_BYTES + 1)
            if line == b"":
                break
            output_queue.put(line)
    except Exception as exc:
        output_queue.put(exc)
    finally:
        output_queue.put(None)


def _utf8_size(value: str) -> int:
    return len(value.encode("utf-8"))


def _mcp_sse_data_size(current_size_bytes: int, data_value: str) -> int:
    separator_size = 1 if current_size_bytes > 0 else 0
    return current_size_bytes + separator_size + _utf8_size(data_value)


def _mcp_http_secret_headers(
    secret_headers: Mapping[str, str],
    *,
    mcp_config: ProjectMCPServerConfig,
) -> dict[str, str]:
    sanitized: dict[str, str] = {}
    for raw_name, raw_value in secret_headers.items():
        header_name = raw_name.strip()
        if header_name == "" or any(char in header_name for char in "\r\n:"):
            raise _mcp_discovery_error(
                mcp_config,
                stage="client_lifecycle",
                message="Project MCP HTTP secret header name is invalid.",
                details={"header_name_type": type(raw_name).__name__},
            )
        if header_name.lower() in _MCP_HTTP_RESERVED_HEADER_NAMES:
            raise _mcp_discovery_error(
                mcp_config,
                stage="client_lifecycle",
                message="Project MCP HTTP secret header cannot override protocol headers.",
                details={"header_name": header_name},
            )
        if "\r" in raw_value or "\n" in raw_value:
            raise _mcp_discovery_error(
                mcp_config,
                stage="client_lifecycle",
                message="Project MCP HTTP secret header value is invalid.",
                details={"header_name": header_name},
            )
        sanitized[header_name] = raw_value
    return sanitized


def _mcp_server_version(result: Mapping[str, object], *, default: str) -> str:
    server_info = result.get("serverInfo")
    if isinstance(server_info, Mapping):
        version = _string_mapping_value(server_info, "version")
        if version is not None:
            return version
    return default


def _mcp_tool_snapshot(tool: object, mcp_config: ProjectMCPServerConfig) -> dict[str, Any]:
    if not isinstance(tool, Mapping):
        raise _mcp_discovery_error(
            mcp_config,
            stage="discover_tools",
            message="Project MCP tools/list returned a non-object tool.",
            details={"result_type": type(tool).__name__},
        )
    name = _string_mapping_value(tool, "name")
    if name is None:
        raise _mcp_discovery_error(
            mcp_config,
            stage="discover_tools",
            message="Project MCP tool is missing name.",
        )
    snapshot: dict[str, Any] = {"name": name}
    title = _string_mapping_value(tool, "title")
    if title is not None:
        snapshot["title"] = title
    description = _string_mapping_value(tool, "description")
    if description is not None:
        snapshot["description"] = description
    input_schema = tool.get("inputSchema", tool.get("input_schema"))
    if isinstance(input_schema, Mapping):
        snapshot["input_schema"] = dict(input_schema)
    return snapshot


def _mcp_tool_call_params(tool_name: str, arguments: Mapping[str, object] | None) -> dict[str, object]:
    return {
        "name": tool_name.strip(),
        "arguments": {} if arguments is None else dict(arguments),
    }


def _mcp_tool_call_result(result: Mapping[str, object], mcp_config: ProjectMCPServerConfig) -> dict[str, Any]:
    content = result.get("content")
    if not isinstance(content, list):
        raise _mcp_discovery_error(
            mcp_config,
            stage="invoke_tool",
            message="Project MCP tools/call response is missing content list.",
            details={"result_type": type(content).__name__},
        )
    call_result: dict[str, Any] = {
        "content": [_mcp_json_object(item, mcp_config, field_name="content") for item in content],
    }
    is_error = result.get("isError")
    if isinstance(is_error, bool):
        call_result["isError"] = is_error
    structured_content = result.get("structuredContent")
    if isinstance(structured_content, Mapping):
        call_result["structuredContent"] = _mcp_json_object(
            structured_content,
            mcp_config,
            field_name="structuredContent",
        )
    return call_result


def _mcp_json_object(value: object, mcp_config: ProjectMCPServerConfig, *, field_name: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise _mcp_discovery_error(
            mcp_config,
            stage="invoke_tool",
            message=f"Project MCP tools/call response {field_name} item was not an object.",
            details={"result_type": type(value).__name__},
        )
    return {key: item for key, item in value.items() if isinstance(key, str)}


def _string_mapping_value(payload: Mapping[str, object], field: str) -> str | None:
    value = payload.get(field)
    if isinstance(value, str) and value.strip() != "":
        return value.strip()
    return None


def _mcp_server_config_entry(
    server_id: str,
    entry: Mapping[str, object],
) -> ProjectMCPServerConfig | None:
    transport = _optional_string_manifest_field(entry, "transport")
    command_or_url = _optional_string_manifest_field(entry, "command_or_url")
    if transport is None or command_or_url is None:
        return None
    requires_approval = entry.get("requires_approval", False)
    return ProjectMCPServerConfig(
        server_id=server_id,
        transport=transport,
        command_or_url=command_or_url,
        requires_approval=requires_approval if isinstance(requires_approval, bool) else False,
        secret_ref=_optional_string_manifest_field(entry, "secret_ref"),
    )


def _string_manifest_field(entry: Mapping[str, object], field: str, *, default: str) -> str:
    value = entry.get(field)
    if isinstance(value, str) and value.strip() != "":
        return value.strip()
    return default


def _optional_string_manifest_field(entry: Mapping[str, object], field: str) -> str | None:
    value = entry.get(field)
    if isinstance(value, str) and value.strip() != "":
        return value.strip()
    return None


def _normalized_optional_string(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


def _normalize_reference_id(reference_id: str) -> str:
    normalized = reference_id.strip()
    if (
        normalized == ""
        or any(char in normalized for char in "/\\?#")
        or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in normalized)
    ):
        raise HarnessError(
            "RES_NOT_FOUND",
            "Project reference is not registered.",
            status_code=404,
            details={"reference_id": reference_id},
        )
    return normalized


def _reference_stored_filename(
    reference_id: str,
    filename: str,
    *,
    kind: Literal["pdf", "md", "txt", "csv", "xlsx", "image", "web_url"],
) -> str:
    safe_name = Path(filename).name.strip()
    if safe_name in {"", ".", ".."}:
        safe_name = f"reference.{_default_reference_extension(kind)}"
    cleaned = "".join("_" if char in _INVALID_PATH_CHARS or ord(char) < 32 else char for char in safe_name)
    cleaned = cleaned.strip(" .")
    if cleaned == "":
        cleaned = f"reference.{_default_reference_extension(kind)}"
    if len(cleaned) > 160:
        suffix = Path(cleaned).suffix
        stem_limit = 160 - len(suffix)
        cleaned = f"{Path(cleaned).stem[:stem_limit]}{suffix}"
    return f"{reference_id}-{cleaned}"


def _default_reference_extension(kind: str) -> str:
    if kind in _REFERENCE_KINDS and kind != "web_url":
        return kind
    return "txt"


def _validate_project_relative_path(relative_path: str) -> None:
    if len(relative_path) > 240:
        raise HarnessError(
            "RH_PATH_TOO_LONG",
            "Reference path exceeds the runtime harness path length limit.",
            status_code=400,
            details={"path": relative_path},
        )
    for part in Path(relative_path).parts:
        if part in {"", ".", ".."} or any(char in _INVALID_PATH_CHARS for char in part):
            raise HarnessError(
                "RH_PATH_INVALID_CHAR",
                "Reference path contains an OS-forbidden path character.",
                status_code=400,
                details={"path": relative_path, "path_part": part},
            )


def _write_bytes_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    tmp_path.write_bytes(content)
    tmp_path.replace(path)


def _commit_reference_manifest_change(
    project_root: Path,
    *,
    action: Literal["import", "enable", "disable"],
    reference_id: str,
    paths: list[str],
) -> str | None:
    with _acquire_git_lock(project_root):
        return _commit_reference_manifest_change_locked(
            project_root,
            action=action,
            reference_id=reference_id,
            paths=paths,
        )


def _commit_reference_manifest_change_locked(
    project_root: Path,
    *,
    action: Literal["import", "enable", "disable"],
    reference_id: str,
    paths: list[str],
) -> str | None:
    if _git_paths_have_staged_changes(project_root, paths):
        raise HarnessError(
            "RH_GIT_AUTOCOMMIT_BLOCKED",
            "Reference manifest paths already have staged user changes.",
            status_code=409,
            details={"paths": paths},
        )
    staged_stash_ref = _stash_staged_changes(project_root, reference_id=reference_id)
    try:
        _run_git(project_root, ["add", *paths], error_code="RH_GIT_AUTOCOMMIT_BLOCKED")
        commit_result = _run_git(
            project_root,
            [
                *_git_identity_args(project_root),
                "commit",
                "--only",
                "-m",
                f"chore(refs): {action} {reference_id}",
                "--",
                *paths,
            ],
            check=False,
            error_code="RH_GIT_AUTOCOMMIT_BLOCKED",
        )
        if commit_result.returncode != 0:
            combined = f"{commit_result.stdout}\n{commit_result.stderr}".lower()
            if "nothing to commit" in combined or "no changes added" in combined:
                return None
            raise HarnessError(
                "RH_GIT_AUTOCOMMIT_BLOCKED",
                "Reference manifest git commit failed.",
                status_code=500,
                details={"stderr": commit_result.stderr.strip(), "stdout": commit_result.stdout.strip()},
            )
        return _run_git(project_root, ["rev-parse", "HEAD"], error_code="RH_GIT_AUTOCOMMIT_BLOCKED").stdout.strip()
    finally:
        if staged_stash_ref is not None:
            _restore_git_stash(project_root, restore_index=True, expected_stash_top=staged_stash_ref)


def _git_paths_have_staged_changes(project_root: Path, paths: list[str]) -> bool:
    result = _run_git(
        project_root,
        ["diff", "--cached", "--name-only", "--", *paths],
        check=False,
        error_code="RH_GIT_AUTOCOMMIT_BLOCKED",
    )
    if result.returncode != 0:
        raise HarnessError(
            "RH_GIT_AUTOCOMMIT_BLOCKED",
            "Reference manifest staged-change inspection failed.",
            status_code=500,
            details={"stderr": result.stderr.strip(), "stdout": result.stdout.strip()},
        )
    return result.stdout.strip() != ""


def _stash_staged_changes(project_root: Path, *, reference_id: str) -> str | None:
    before_stash = _git_stash_top(project_root)
    result = _run_git(
        project_root,
        [
            "stash",
            "push",
            "--staged",
            "-m",
            f"cw reference autocommit {reference_id}",
            "--",
            ".",
        ],
        check=False,
        error_code="RH_GIT_AUTOCOMMIT_BLOCKED",
    )
    if result.returncode != 0:
        raise HarnessError(
            "RH_GIT_AUTOCOMMIT_BLOCKED",
            "Reference manifest git stash failed.",
            status_code=500,
            details={"stderr": result.stderr.strip(), "stdout": result.stdout.strip()},
        )
    after_stash = _git_stash_top(project_root)
    if after_stash == before_stash:
        return None
    return after_stash


def _git_stash_top(project_root: Path) -> str | None:
    result = _run_git(
        project_root,
        ["rev-parse", "--verify", "--quiet", "refs/stash"],
        check=False,
        error_code="RH_GIT_AUTOCOMMIT_BLOCKED",
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def _restore_git_stash(project_root: Path, *, restore_index: bool, expected_stash_top: str) -> None:
    if _git_stash_top(project_root) != expected_stash_top:
        raise HarnessError(
            "RH_GIT_AUTOCOMMIT_BLOCKED",
            "Reference manifest git stash restore would pop an unexpected stash.",
            status_code=500,
            details={"expected_stash": expected_stash_top},
        )
    result = _run_git(
        project_root,
        ["stash", "pop", *(["--index"] if restore_index else []), "--quiet"],
        check=False,
        error_code="RH_GIT_AUTOCOMMIT_BLOCKED",
    )
    if result.returncode != 0:
        raise HarnessError(
            "RH_GIT_AUTOCOMMIT_BLOCKED",
            "Reference manifest git stash restore failed.",
            status_code=500,
            details={"stderr": result.stderr.strip(), "stdout": result.stdout.strip()},
        )


def _write_json_atomic(path: Path, payload: object) -> None:
    content = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    _write_text_atomic(path, content)


def _write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    tmp_path.write_text(content, encoding="utf-8", newline="\n")
    tmp_path.replace(path)


def _new_ulid(now_ms: int | None = None) -> str:
    timestamp_ms = int(time.time() * 1000) if now_ms is None else now_ms
    timestamp = timestamp_ms & ((1 << 48) - 1)
    random_bits = secrets.randbits(80)
    value = (timestamp << 80) | random_bits
    chars = []
    for shift in range(125, -1, -5):
        chars.append(_CROCKFORD_ALPHABET[(value >> shift) & 0b11111])
    return "".join(chars)


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _to_posix(path: Path) -> str:
    return path.as_posix()


__all__ = [
    "HarnessError",
    "ProjectCreateRequest",
    "ProjectCreateResponse",
    "ProjectDocument",
    "ProjectMCPDiscoveredTools",
    "ProjectMCPDiscoveryClient",
    "ProjectMCPDiscoveryClientFactory",
    "ProjectMCPDiscoveryError",
    "ProjectMCPDiscoveryRunner",
    "ProjectMCPHealthCheck",
    "ProjectMCPHttpDiscoveryClient",
    "ProjectMCPLockEntry",
    "ProjectMCPServerConfig",
    "ProjectMCPStdioDiscoveryClient",
    "ProjectMCPToolDiscovery",
    "ProjectReferenceEntry",
    "ProjectReferenceImportMetadata",
    "ProjectReferenceManifest",
    "ProjectReferencePatchRequest",
    "ProjectSkillLockEntry",
    "ProjectToolAvailability",
    "ProjectToolLockSnapshot",
    "RuntimeLock",
    "acquire_runtime_lock",
    "import_project_reference",
    "initialize_project",
    "load_enabled_mcp_server_ids",
    "load_enabled_skill_ids",
    "load_enabled_skill_refs",
    "load_project_mcp_server_configs",
    "load_project_tool_availability",
    "load_project_tool_lock_snapshot",
    "read_project",
    "read_project_references",
    "update_manifest_json",
    "update_project_reference_enabled",
]
