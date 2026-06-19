"""M1.3.2 runtime harness project initialization tests."""

from __future__ import annotations

import base64
import json
import os
import queue
import shlex
import sqlite3
import subprocess
import sys
import textwrap
import threading
import time
import uuid
from collections.abc import Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, cast

import pytest

from cw_runtime.harness import (
    HarnessError,
    ProjectCreateRequest,
    ProjectMCPDiscoveredTools,
    ProjectMCPDiscoveryError,
    ProjectMCPDiscoveryRunner,
    ProjectMCPHealthCheck,
    ProjectMCPHttpDiscoveryClient,
    ProjectMCPServerConfig,
    ProjectMCPStdioDiscoveryClient,
    ProjectSecretStoreError,
    build_project_mcp_http_discovery_client_factory,
    build_project_secret_decryptor,
    decrypt_project_secret_value,
    delete_windows_credential_manager_master_key,
    encrypt_project_secret_value,
    initialize_project,
    load_project_mcp_secret_material,
    load_project_mcp_server_configs,
    load_project_tool_availability,
    load_project_tool_lock_snapshot,
    update_manifest_json,
    windows_cng_decrypt_aes_gcm,
    windows_cng_encrypt_aes_gcm,
    windows_credential_manager_master_key_provider,
    write_windows_credential_manager_master_key,
)


def _request(
    display_name: str,
    host_path: Path,
    *,
    settings_overrides: dict[str, object] | None = None,
) -> ProjectCreateRequest:
    return ProjectCreateRequest(
        schema_version="0.1.0",
        display_name=display_name,
        host_path=str(host_path),
        settings_overrides={} if settings_overrides is None else settings_overrides,
    )


def _read_json(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as file:
        loaded = json.load(file)
    assert isinstance(loaded, dict)
    return loaded


def _read_json_value(path: Path) -> object:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _write_json_value(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def _write_text_value(path: Path, payload: str) -> None:
    path.write_text(payload, encoding="utf-8", newline="\n")


def _write_secure_secret(project_root: Path, secret_id: str, encrypted_value: bytes) -> None:
    secure_dir = project_root / ".agent-workflow" / "secure"
    secure_dir.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(secure_dir / "secrets.encrypted.sqlite") as connection:
        connection.execute(
            "CREATE TABLE secrets("
            "secret_id TEXT PRIMARY KEY, "
            "alias TEXT, "
            "value_encrypted BLOB NOT NULL, "
            "scope TEXT, "
            "created_at TEXT)"
        )
        connection.execute(
            "INSERT INTO secrets(secret_id, alias, value_encrypted, scope, created_at) VALUES (?, ?, ?, ?, ?)",
            (secret_id, "test secret", encrypted_value, "project", "2026-06-19T00:00:00Z"),
        )


def _fake_encrypt_aead(key: bytes, nonce: bytes, plaintext: bytes, associated_data: bytes) -> bytes:
    marker = b"cwfake:" + key[:8] + nonce + len(associated_data).to_bytes(4, "big")
    return marker + plaintext


def _fake_decrypt_aead(key: bytes, nonce: bytes, ciphertext: bytes, associated_data: bytes) -> bytes:
    marker = b"cwfake:" + key[:8] + nonce + len(associated_data).to_bytes(4, "big")
    if not ciphertext.startswith(marker):
        raise ValueError("invalid fake AEAD marker")
    return ciphertext[len(marker) :]


def _python_script_command(script_path: Path, *extra_args: str) -> str:
    args = [sys.executable, str(script_path), *extra_args]
    if os.name == "nt":
        return subprocess.list2cmdline(args)
    return shlex.join(args)


def _git_ls_files(project_root: Path) -> set[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return set(result.stdout.splitlines())


def test_initialize_project_creates_runtime_harness_skeleton(tmp_path: Path) -> None:
    project_root = tmp_path / "cw_project"

    response = initialize_project(
        _request(
            "Drone Research",
            project_root,
            settings_overrides={"privacy": {"disable_remote_models": True}},
        )
    )

    agent_root = project_root / ".agent-workflow"
    assert response.host_path == project_root.resolve().as_posix()
    assert response.git_initialized is True
    assert response.first_commit_sha is not None
    assert len(response.project_id) == 26

    for directory in (
        agent_root / "runs",
        agent_root / "planning_sessions",
        agent_root / "artifacts",
        agent_root / "snapshots",
        agent_root / "traces",
        agent_root / "secure",
        agent_root / "cache",
        agent_root / "locks",
        project_root / "references",
        project_root / "workflow",
        project_root / "outputs",
    ):
        assert directory.is_dir()

    project_manifest = _read_json(agent_root / "project.json")
    assert project_manifest["schema_version"] == "0.1.0"
    assert project_manifest["project_id"] == response.project_id
    assert project_manifest["settings_ref"] == "settings.json"
    assert project_manifest["manifest_revisions_ref"] == "manifest_revision.json"

    settings = _read_json(agent_root / "settings.json")
    privacy = settings["privacy"]
    assert isinstance(privacy, dict)
    assert privacy["sensitive_data_mode"] == "strict"
    assert privacy["disable_remote_models"] is True

    workflow = _read_json(agent_root / "workflow.flow.json")
    assert workflow["schema_version"] == "0.1.0"
    assert workflow["entry_node_id"] == "n_start"
    assert workflow["terminal_node_ids"] == ["n_end"]

    revisions = _read_json(agent_root / "manifest_revision.json")
    assert revisions["project.json"] == {"revision": 1, "modified_at": project_manifest["created_at"]}
    assert revisions["settings.json"] == {"revision": 1, "modified_at": project_manifest["created_at"]}

    gitignore = (project_root / ".gitignore").read_text(encoding="utf-8")
    assert ".agent-workflow/cache/" in gitignore
    assert ".agent-workflow/secure/" in gitignore

    gitattributes = (project_root / ".gitattributes").read_text(encoding="utf-8")
    assert ".agent-workflow/**/*.jsonl    text eol=lf" in gitattributes

    tracked = _git_ls_files(project_root)
    assert ".agent-workflow/project.json" in tracked
    assert ".agent-workflow/settings.json" in tracked
    assert ".agent-workflow/cache/" not in tracked
    assert ".agent-workflow/secure/" not in tracked
    assert _read_json_value(agent_root / "skills.config.json") == []
    assert _read_json_value(agent_root / "mcp.config.json") == []
    assert _read_json_value(agent_root / "adapters.config.json") == []


def test_initialize_project_rejects_existing_harness(tmp_path: Path) -> None:
    project_root = tmp_path / "existing_project"
    initialize_project(_request("Existing", project_root))

    with pytest.raises(HarnessError) as exc_info:
        initialize_project(_request("Existing", project_root))

    assert exc_info.value.error_code == "RES_ALREADY_EXISTS"
    assert exc_info.value.status_code == 409


def test_initialize_project_rejects_invalid_path_char() -> None:
    with pytest.raises(HarnessError) as exc_info:
        initialize_project(
            ProjectCreateRequest(schema_version="0.1.0", display_name="Invalid", host_path="bad<project")
        )

    assert exc_info.value.error_code == "RH_PATH_INVALID_CHAR"
    assert exc_info.value.status_code == 400


def test_update_manifest_json_increments_revision_and_uses_runtime_lock(tmp_path: Path) -> None:
    project_root = tmp_path / "update_project"
    initialize_project(_request("Update", project_root))

    agent_root = project_root / ".agent-workflow"
    settings = _read_json(agent_root / "settings.json")
    settings["execution"] = {
        "default_mode": "step",
        "max_concurrent_nodes": 1,
        "default_timeout_seconds": 600,
    }

    update_manifest_json(project_root, "settings.json", settings)

    revisions = _read_json(agent_root / "manifest_revision.json")
    settings_revision = revisions["settings.json"]
    assert isinstance(settings_revision, dict)
    assert settings_revision["revision"] == 2
    assert (agent_root / "locks" / "runtime.lock").exists() is False


def test_update_manifest_json_rejects_non_object_payload_without_revision_bump(tmp_path: Path) -> None:
    project_root = tmp_path / "non_object_manifest_project"
    initialize_project(_request("Non Object Manifest", project_root))
    agent_root = project_root / ".agent-workflow"
    revisions_before = _read_json(agent_root / "manifest_revision.json")
    workflow_before = _read_json(agent_root / "workflow.flow.json")

    with pytest.raises(TypeError):
        update_manifest_json(project_root, "workflow.flow.json", cast(Mapping[str, Any], []))

    assert _read_json(agent_root / "workflow.flow.json") == workflow_before
    assert _read_json(agent_root / "manifest_revision.json") == revisions_before


def test_project_tool_availability_reads_enabled_manifest_entries(tmp_path: Path) -> None:
    project_root = tmp_path / "tool_availability_project"
    initialize_project(_request("Tool Availability", project_root))
    agent_root = project_root / ".agent-workflow"

    _write_json_value(
        agent_root / "skills.config.json",
        [
            {"skill_id": "research_outline", "version": "1.2.0"},
            {"skill_id": "research_outline", "version": "2.0.0"},
            {"skill_id": "disabled_skill", "version": "1.0.0", "enabled": False},
        ],
    )
    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_local_python",
                "version": "0.5.1",
                "secret_ref": "secure://mcp/local-python",
                "tools_snapshot": [{"name": "run", "description": "Run local Python."}],
            },
            {"server_id": "disabled_mcp", "enabled": False},
        ],
    )

    availability = load_project_tool_availability(project_root)
    locks = load_project_tool_lock_snapshot(project_root)

    assert availability.skill_ids == {"research_outline"}
    assert availability.skill_refs == {"research_outline@1.2.0"}
    assert availability.mcp_server_ids == {"mcp_local_python"}
    assert [entry.model_dump(mode="json", exclude_none=True) for entry in locks.skills] == [
        {"skill_id": "research_outline", "version": "1.2.0"}
    ]
    assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
        {
            "server_id": "mcp_local_python",
            "version": "latest",
            "tools_snapshot": [],
        }
    ]


def test_project_tool_lock_snapshot_can_use_injected_mcp_discovery(tmp_path: Path) -> None:
    project_root = tmp_path / "tool_lock_discovery_project"
    initialize_project(_request("Tool Lock Discovery", project_root))
    agent_root = project_root / ".agent-workflow"
    discovered_server_ids: list[str] = []

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_local_python",
                "transport": "stdio",
                "command_or_url": "python -m local_mcp",
            },
            {"server_id": "mcp_missing_transport", "command_or_url": "missing transport"},
        ],
    )

    def discover(config: ProjectMCPServerConfig) -> ProjectMCPDiscoveredTools:
        discovered_server_ids.append(config.server_id)
        return ProjectMCPDiscoveredTools(
            version="0.5.1",
            tools_snapshot=[
                {
                    "name": "run",
                    "description": "Run local Python.",
                    "input_schema": {"type": "object"},
                }
            ],
        )

    locks = load_project_tool_lock_snapshot(project_root, mcp_tool_discovery=discover)

    assert discovered_server_ids == ["mcp_local_python"]
    assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
        {
            "server_id": "mcp_local_python",
            "version": "0.5.1",
            "tools_snapshot": [
                {
                    "name": "run",
                    "description": "Run local Python.",
                    "input_schema": {"type": "object"},
                }
            ],
        },
        {
            "server_id": "mcp_missing_transport",
            "version": "latest",
            "tools_snapshot": [],
        },
    ]


class FakeMCPDiscoveryClient:
    def __init__(
        self,
        events: list[str],
        *,
        healthy: bool = True,
        close_raises: bool = False,
    ) -> None:
        self._events = events
        self._healthy = healthy
        self._close_raises = close_raises

    def start(self, config: ProjectMCPServerConfig) -> None:
        self._events.append(f"start:{config.server_id}")

    def health_check(self) -> ProjectMCPHealthCheck:
        self._events.append("health")
        return ProjectMCPHealthCheck(healthy=self._healthy)

    def discover_tools(self) -> ProjectMCPDiscoveredTools | None:
        self._events.append("discover")
        return ProjectMCPDiscoveredTools(
            version="0.5.1",
            tools_snapshot=[{"name": "run", "description": "Run local Python."}],
        )

    def close(self) -> None:
        self._events.append("close")
        if self._close_raises:
            raise RuntimeError("close failed with fake secret value")


class DirtyErrorMCPDiscoveryClient(FakeMCPDiscoveryClient):
    def start(self, config: ProjectMCPServerConfig) -> None:
        self._events.append(f"start:{config.server_id}")
        raise ProjectMCPDiscoveryError(
            config.server_id,
            "fake-secret-stage",
            "dirty client error with fake secret",
            details={
                "command_or_url": config.command_or_url,
                "secret_ref": config.secret_ref or "secure://fake",
            },
        )


def _write_fake_mcp_stdio_server(script_path: Path) -> None:
    _write_text_value(
        script_path,
        textwrap.dedent(
            """
            import json
            import sys
            import time

            mode = sys.argv[1] if len(sys.argv) > 1 else "ok"

            for line in sys.stdin:
                message = json.loads(line)
                method = message.get("method")
                if method == "initialize":
                    response = {
                        "jsonrpc": "2.0",
                        "id": message.get("id"),
                        "result": {
                            "protocolVersion": "2025-06-18",
                            "capabilities": {"tools": {}},
                            "serverInfo": {"name": "fake-mcp", "version": "0.5.1"},
                        },
                    }
                elif method == "notifications/initialized":
                    continue
                elif method == "tools/list" and mode == "error":
                    response = {
                        "jsonrpc": "2.0",
                        "id": message.get("id"),
                        "error": {"code": -32000, "message": "fake secret should not leak"},
                    }
                elif method == "tools/list" and mode == "noise":
                    while True:
                        print(json.dumps({"jsonrpc": "2.0", "id": "unrelated", "result": {}}), flush=True)
                        time.sleep(0.01)
                elif method == "tools/list":
                    response = {
                        "jsonrpc": "2.0",
                        "id": message.get("id"),
                        "result": {
                            "tools": [
                                {
                                    "name": "run",
                                    "title": "Run",
                                    "description": "Run local Python.",
                                    "inputSchema": {
                                        "type": "object",
                                        "properties": {"code": {"type": "string"}},
                                    },
                                }
                            ]
                        },
                    }
                elif method == "tools/call" and mode == "call_error":
                    response = {
                        "jsonrpc": "2.0",
                        "id": message.get("id"),
                        "error": {"code": -32000, "message": "fake secret should not leak"},
                    }
                elif method == "tools/call":
                    params = message.get("params")
                    arguments = params.get("arguments") if isinstance(params, dict) else {}
                    code = arguments.get("code") if isinstance(arguments, dict) else ""
                    response = {
                        "jsonrpc": "2.0",
                        "id": message.get("id"),
                        "result": {
                            "content": [{"type": "text", "text": f"ran stdio: {code}"}],
                            "isError": False,
                        },
                    }
                else:
                    response = {
                        "jsonrpc": "2.0",
                        "id": message.get("id"),
                        "error": {"code": -32601, "message": "method not found"},
                    }
                print(json.dumps(response), flush=True)
            """
        ).lstrip(),
    )


def _write_external_mcp_http_provider(script_path: Path) -> None:
    _write_text_value(
        script_path,
        textwrap.dedent(
            """
            import json
            import sys
            from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

            endpoint_path = sys.argv[1]

            class ExternalMCPHttpHandler(BaseHTTPRequestHandler):
                protocol_version = "HTTP/1.1"

                def do_POST(self):
                    message = self._read_json_body()
                    method = message.get("method")
                    if method == "initialize":
                        self._send_json(
                            200,
                            {
                                "jsonrpc": "2.0",
                                "id": message.get("id"),
                                "result": {
                                    "protocolVersion": "2025-06-18",
                                    "capabilities": {"tools": {}},
                                    "serverInfo": {"name": "external-http-mcp", "version": "0.7.0"},
                                },
                            },
                            extra_headers={"Mcp-Session-Id": "external-session-1"},
                        )
                        return
                    if method == "notifications/initialized":
                        self._send_empty(202)
                        return
                    if method == "tools/list":
                        self._send_json(
                            200,
                            {
                                "jsonrpc": "2.0",
                                "id": message.get("id"),
                                "result": {
                                    "tools": [
                                        {
                                            "name": "run",
                                            "title": "Run",
                                            "description": "Run external Python.",
                                            "inputSchema": {
                                                "type": "object",
                                                "properties": {"code": {"type": "string"}},
                                            },
                                        }
                                    ]
                                },
                            },
                        )
                        return
                    if method == "tools/call":
                        params = message.get("params")
                        arguments = params.get("arguments") if isinstance(params, dict) else {}
                        code = arguments.get("code") if isinstance(arguments, dict) else ""
                        self._send_json(
                            200,
                            {
                                "jsonrpc": "2.0",
                                "id": message.get("id"),
                                "result": {
                                    "content": [{"type": "text", "text": f"ran external: {code}"}],
                                    "isError": False,
                                    "structuredContent": {"provider": "external"},
                                },
                            },
                        )
                        return
                    self._send_json(
                        200,
                        {
                            "jsonrpc": "2.0",
                            "id": message.get("id"),
                            "error": {"code": -32601, "message": "method not found"},
                        },
                    )

                def log_message(self, format, *args):
                    return

                def _read_json_body(self):
                    length = int(self.headers.get("Content-Length", "0"))
                    message = json.loads(self.rfile.read(length))
                    if not isinstance(message, dict):
                        raise AssertionError("request body was not an object")
                    return message

                def _send_empty(self, status):
                    self.send_response(status)
                    self.send_header("Content-Length", "0")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.close_connection = True

                def _send_json(self, status, payload, *, extra_headers=None):
                    body = json.dumps(payload).encode("utf-8")
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Connection", "close")
                    if extra_headers is not None:
                        for key, value in extra_headers.items():
                            self.send_header(key, value)
                    self.end_headers()
                    self.wfile.write(body)
                    self.close_connection = True

            server = ThreadingHTTPServer(("127.0.0.1", 0), ExternalMCPHttpHandler)
            with open(endpoint_path, "w", encoding="utf-8") as file:
                file.write(f"http://127.0.0.1:{server.server_port}/mcp")
            server.serve_forever()
            """
        ).lstrip(),
    )


def _start_external_mcp_http_provider(tmp_path: Path) -> tuple[subprocess.Popen[str], str]:
    script_path = tmp_path / "external_mcp_http_provider.py"
    endpoint_path = tmp_path / "external_mcp_http_provider_endpoint.txt"
    _write_external_mcp_http_provider(script_path)
    process = subprocess.Popen(
        [sys.executable, str(script_path), str(endpoint_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return process, _wait_for_external_mcp_http_endpoint(process, endpoint_path)


def _wait_for_external_mcp_http_endpoint(process: subprocess.Popen[str], endpoint_path: Path) -> str:
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if endpoint_path.exists():
            endpoint_url = endpoint_path.read_text(encoding="utf-8").strip()
            if endpoint_url:
                return endpoint_url
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=1.0)
            raise AssertionError(
                f"external MCP HTTP provider exited before startup: stdout={stdout!r} stderr={stderr!r}"
            )
        time.sleep(0.05)
    _stop_external_mcp_http_provider(process)
    raise AssertionError("external MCP HTTP provider did not publish an endpoint")


def _stop_external_mcp_http_provider(process: subprocess.Popen[str]) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.communicate(timeout=2.0)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=2.0)
    else:
        process.communicate(timeout=1.0)


class FakeMCPHttpServer(ThreadingHTTPServer):
    daemon_threads = True

    mode: str
    request_headers_log: list[dict[str, str]]
    secret_headers_log: list[dict[str, str]]
    all_headers_log: list[dict[str, str]]
    legacy_response_queue: queue.Queue[Mapping[str, object] | None]

    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[BaseHTTPRequestHandler],
        *,
        mode: str,
    ) -> None:
        super().__init__(server_address, handler_class)
        self.mode = mode
        self.request_headers_log = []
        self.secret_headers_log = []
        self.all_headers_log = []
        self.legacy_response_queue = queue.Queue()


class FakeMCPHttpHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        server = cast(FakeMCPHttpServer, self.server)
        if server.mode in {"legacy", "legacy_error"} and self.path == "/mcp":
            self._send_legacy_sse_endpoint()
            return
        self._send_empty(405)

    def do_POST(self) -> None:
        server = cast(FakeMCPHttpServer, self.server)
        message = self._read_json_body()
        method = message.get("method")
        server.request_headers_log.append(
            {
                "method": method if isinstance(method, str) else "",
                "accept": self.headers.get("Accept", ""),
                "content_type": self.headers.get("Content-Type", ""),
                "protocol_version": self.headers.get("MCP-Protocol-Version", ""),
                "session_id": self.headers.get("Mcp-Session-Id", ""),
            }
        )
        server.secret_headers_log.append(
            {
                "authorization": self.headers.get("Authorization", ""),
                "x_cw_mcp_token": self.headers.get("X-CW-MCP-Token", ""),
            }
        )
        server.all_headers_log.append({key.lower(): value for key, value in self.headers.items()})
        if server.mode in {"legacy", "legacy_error"} and self.path == "/mcp":
            self._send_empty(405)
            return
        if server.mode in {"legacy", "legacy_error"} and self.path == "/messages":
            self._handle_legacy_message(server, message)
            self._send_empty(202)
            return
        if method == "initialize":
            self._send_json(
                200,
                {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "fake-http-mcp", "version": "0.6.0"},
                    },
                },
                extra_headers={"Mcp-Session-Id": "test-session-1"},
            )
            return
        if method == "notifications/initialized":
            self._send_empty(202)
            return
        if method == "tools/list" and server.mode == "http_error":
            self._send_text(500, "fake secret should not leak")
            return
        if method == "tools/list" and server.mode == "error":
            self._send_json(
                200,
                {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {"code": -32000, "message": "fake secret should not leak"},
                },
            )
            return
        if method == "tools/list" and server.mode == "sse":
            self._send_sse(
                [
                    {"jsonrpc": "2.0", "method": "notifications/tools/list_changed"},
                    self._tools_response(message.get("id")),
                ]
            )
            return
        if method == "tools/list" and server.mode == "sse_hang":
            self._send_sse(
                [{"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}],
                keep_open_seconds=1.0,
            )
            return
        if method == "tools/list":
            self._send_json(200, self._tools_response(message.get("id")))
            return
        if method == "tools/call" and server.mode == "call_error":
            self._send_json(
                200,
                {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {"code": -32000, "message": "fake secret should not leak"},
                },
            )
            return
        if method == "tools/call" and server.mode == "sse":
            self._send_sse(
                [
                    {"jsonrpc": "2.0", "method": "notifications/tools/list_changed"},
                    self._tool_call_response(message),
                ]
            )
            return
        if method == "tools/call":
            self._send_json(200, self._tool_call_response(message))
            return
        self._send_json(
            200,
            {
                "jsonrpc": "2.0",
                "id": message.get("id"),
                "error": {"code": -32601, "message": "method not found"},
            },
        )

    def _handle_legacy_message(self, server: FakeMCPHttpServer, message: Mapping[str, object]) -> None:
        method = message.get("method")
        if method == "initialize":
            server.legacy_response_queue.put(
                {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "fake-legacy-mcp", "version": "0.4.0"},
                    },
                }
            )
            return
        if method == "notifications/initialized":
            return
        if method == "tools/list" and server.mode == "legacy_error":
            server.legacy_response_queue.put(
                {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {"code": -32000, "message": "fake secret should not leak"},
                }
            )
            return
        if method == "tools/list":
            server.legacy_response_queue.put(
                {
                    "jsonrpc": "2.0",
                    "method": "notifications/tools/list_changed",
                }
            )
            server.legacy_response_queue.put(self._tools_response(message.get("id"), description="Run legacy Python."))
            return
        if method == "tools/call":
            server.legacy_response_queue.put(
                {
                    "jsonrpc": "2.0",
                    "method": "notifications/tools/list_changed",
                }
            )
            server.legacy_response_queue.put(self._tool_call_response(message, prefix="legacy"))
            return
        server.legacy_response_queue.put(
            {
                "jsonrpc": "2.0",
                "id": message.get("id"),
                "error": {"code": -32601, "message": "method not found"},
            }
        )

    def log_message(self, format: str, *args: object) -> None:
        return

    def _read_json_body(self) -> Mapping[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        message = json.loads(body)
        if not isinstance(message, Mapping):
            raise AssertionError("fake MCP HTTP request body was not an object")
        return message

    def _tools_response(self, request_id: object, *, description: str = "Run remote Python.") -> dict[str, object]:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "tools": [
                    {
                        "name": "run",
                        "title": "Run",
                        "description": description,
                        "inputSchema": {
                            "type": "object",
                            "properties": {"code": {"type": "string"}},
                        },
                    }
                ]
            },
        }

    def _tool_call_response(self, message: Mapping[str, object], *, prefix: str = "remote") -> dict[str, object]:
        params = message.get("params")
        arguments = params.get("arguments") if isinstance(params, Mapping) else {}
        code = arguments.get("code") if isinstance(arguments, Mapping) else ""
        return {
            "jsonrpc": "2.0",
            "id": message.get("id"),
            "result": {
                "content": [{"type": "text", "text": f"ran {prefix}: {code}"}],
                "isError": False,
                "structuredContent": {"ok": True},
            },
        }

    def _send_empty(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    def _send_text(self, status: int, body: str) -> None:
        body_bytes = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body_bytes)
        self.close_connection = True

    def _send_json(
        self,
        status: int,
        payload: object,
        *,
        extra_headers: Mapping[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        if extra_headers is not None:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def _send_sse(self, messages: list[Mapping[str, object]], *, keep_open_seconds: float = 0.0) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()
        for message in messages:
            self.wfile.write(f"data: {json.dumps(message)}\n\n".encode())
        self.wfile.flush()
        if keep_open_seconds > 0:
            time.sleep(keep_open_seconds)
        self.close_connection = True

    def _send_legacy_sse_endpoint(self) -> None:
        server = cast(FakeMCPHttpServer, self.server)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.write(b"event: endpoint\ndata: /messages\n\n")
        self.wfile.flush()
        while True:
            try:
                message = server.legacy_response_queue.get(timeout=0.1)
            except queue.Empty:
                if getattr(server, "_BaseServer__shutdown_request", False):
                    return
                continue
            if message is None:
                return
            self.wfile.write(f"event: message\ndata: {json.dumps(message)}\n\n".encode())
            self.wfile.flush()


def _start_fake_mcp_http_server(mode: str) -> tuple[FakeMCPHttpServer, threading.Thread, str]:
    server = FakeMCPHttpServer(("127.0.0.1", 0), FakeMCPHttpHandler, mode=mode)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, f"http://127.0.0.1:{server.server_port}/mcp"


def test_project_mcp_discovery_runner_executes_lifecycle_for_lock_snapshot(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_discovery_runner_project"
    initialize_project(_request("MCP Discovery Runner", project_root))
    agent_root = project_root / ".agent-workflow"
    events: list[str] = []

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_local_python",
                "transport": "stdio",
                "command_or_url": "python -m local_mcp",
            }
        ],
    )

    def client_factory(config: ProjectMCPServerConfig) -> FakeMCPDiscoveryClient:
        events.append(f"factory:{config.server_id}")
        return FakeMCPDiscoveryClient(events)

    locks = load_project_tool_lock_snapshot(
        project_root,
        mcp_tool_discovery=ProjectMCPDiscoveryRunner(client_factory),
    )

    assert events == ["factory:mcp_local_python", "start:mcp_local_python", "health", "discover", "close"]
    assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
        {
            "server_id": "mcp_local_python",
            "version": "0.5.1",
            "tools_snapshot": [{"name": "run", "description": "Run local Python."}],
        }
    ]


def test_project_mcp_stdio_discovery_client_smoke_lists_tools(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_stdio_discovery_project"
    initialize_project(_request("MCP Stdio Discovery", project_root))
    agent_root = project_root / ".agent-workflow"
    server_script = tmp_path / "fake_mcp_server.py"
    _write_fake_mcp_stdio_server(server_script)

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_stdio_python",
                "transport": "stdio",
                "command_or_url": _python_script_command(server_script),
            }
        ],
    )

    locks = load_project_tool_lock_snapshot(
        project_root,
        mcp_tool_discovery=ProjectMCPDiscoveryRunner(
            lambda config: ProjectMCPStdioDiscoveryClient(timeout_seconds=2.0)
        ),
    )

    assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
        {
            "server_id": "mcp_stdio_python",
            "version": "0.5.1",
            "tools_snapshot": [
                {
                    "name": "run",
                    "title": "Run",
                    "description": "Run local Python.",
                    "input_schema": {
                        "type": "object",
                        "properties": {"code": {"type": "string"}},
                    },
                }
            ],
        }
    ]


def test_project_mcp_stdio_client_smoke_invokes_tool(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_stdio_invocation_project"
    initialize_project(_request("MCP Stdio Invocation", project_root))
    server_script = tmp_path / "fake_mcp_server.py"
    _write_fake_mcp_stdio_server(server_script)
    client = ProjectMCPStdioDiscoveryClient(timeout_seconds=2.0)
    config = ProjectMCPServerConfig(
        server_id="mcp_stdio_python",
        transport="stdio",
        command_or_url=_python_script_command(server_script),
    )

    try:
        client.start(config)
        assert client.health_check().healthy is True
        assert client.discover_tools() is not None

        assert client.invoke_tool("run", {"code": "print(1)"}) == {
            "content": [{"type": "text", "text": "ran stdio: print(1)"}],
            "isError": False,
        }
    finally:
        client.close()


def test_project_mcp_stdio_discovery_client_sanitizes_json_rpc_error(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_stdio_error_project"
    initialize_project(_request("MCP Stdio Error", project_root))
    agent_root = project_root / ".agent-workflow"
    server_script = tmp_path / "fake_mcp_server.py"
    _write_fake_mcp_stdio_server(server_script)

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_stdio_python",
                "transport": "stdio",
                "command_or_url": _python_script_command(server_script, "error"),
            }
        ],
    )

    with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
        load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                lambda config: ProjectMCPStdioDiscoveryClient(timeout_seconds=2.0)
            ),
        )

    assert exc_info.value.server_id == "mcp_stdio_python"
    assert exc_info.value.stage == "discover_tools"
    assert exc_info.value.details == {
        "server_id": "mcp_stdio_python",
        "transport": "stdio",
        "jsonrpc_error_type": "int",
    }
    assert "fake secret" not in str(exc_info.value)
    assert "fake secret" not in str(exc_info.value.details)
    assert "command_or_url" not in str(exc_info.value.details)


def test_project_mcp_stdio_discovery_client_times_out_on_unrelated_messages(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_stdio_noise_project"
    initialize_project(_request("MCP Stdio Noise", project_root))
    agent_root = project_root / ".agent-workflow"
    server_script = tmp_path / "fake_mcp_server.py"
    _write_fake_mcp_stdio_server(server_script)

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_stdio_python",
                "transport": "stdio",
                "command_or_url": _python_script_command(server_script, "noise"),
            }
        ],
    )

    with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
        load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                lambda config: ProjectMCPStdioDiscoveryClient(timeout_seconds=0.2)
            ),
        )

    assert exc_info.value.server_id == "mcp_stdio_python"
    assert exc_info.value.stage == "discover_tools"
    assert exc_info.value.details == {
        "server_id": "mcp_stdio_python",
        "transport": "stdio",
        "timeout_seconds": 0.2,
    }
    assert "command_or_url" not in str(exc_info.value.details)


def test_project_mcp_http_discovery_client_smoke_lists_tools_json(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_discovery_project"
    initialize_project(_request("MCP HTTP Discovery", project_root))
    agent_root = project_root / ".agent-workflow"
    server, thread, endpoint_url = _start_fake_mcp_http_server("json")
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_python",
                    "transport": "http",
                    "command_or_url": endpoint_url,
                }
            ],
        )

        locks = load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                lambda config: ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
            ),
        )

        assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
            {
                "server_id": "mcp_http_python",
                "version": "0.6.0",
                "tools_snapshot": [
                    {
                        "name": "run",
                        "title": "Run",
                        "description": "Run remote Python.",
                        "input_schema": {
                            "type": "object",
                            "properties": {"code": {"type": "string"}},
                        },
                    }
                ],
            }
        ]
        assert server.request_headers_log == [
            {
                "method": "initialize",
                "accept": "application/json, text/event-stream",
                "content_type": "application/json",
                "protocol_version": "",
                "session_id": "",
            },
            {
                "method": "notifications/initialized",
                "accept": "application/json, text/event-stream",
                "content_type": "application/json",
                "protocol_version": "2025-06-18",
                "session_id": "test-session-1",
            },
            {
                "method": "tools/list",
                "accept": "application/json, text/event-stream",
                "content_type": "application/json",
                "protocol_version": "2025-06-18",
                "session_id": "test-session-1",
            },
        ]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_http_client_smoke_with_external_provider_process(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_external_provider_project"
    initialize_project(_request("MCP HTTP External Provider", project_root))
    agent_root = project_root / ".agent-workflow"
    process, endpoint_url = _start_external_mcp_http_provider(tmp_path)
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_external_python",
                    "transport": "http",
                    "command_or_url": endpoint_url,
                }
            ],
        )

        locks = load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                lambda config: ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
            ),
        )

        assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
            {
                "server_id": "mcp_http_external_python",
                "version": "0.7.0",
                "tools_snapshot": [
                    {
                        "name": "run",
                        "title": "Run",
                        "description": "Run external Python.",
                        "input_schema": {
                            "type": "object",
                            "properties": {"code": {"type": "string"}},
                        },
                    }
                ],
            }
        ]

        client = ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
        config = ProjectMCPServerConfig(
            server_id="mcp_http_external_python",
            transport="http",
            command_or_url=endpoint_url,
        )
        try:
            client.start(config)
            assert client.health_check().healthy is True
            assert client.discover_tools() is not None
            assert client.invoke_tool("run", {"code": "print(47)"}) == {
                "content": [{"type": "text", "text": "ran external: print(47)"}],
                "isError": False,
                "structuredContent": {"provider": "external"},
            }
        finally:
            client.close()
    finally:
        _stop_external_mcp_http_provider(process)


def test_project_mcp_http_client_uses_secure_store_headers_for_discovery_and_invocation(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_secure_headers_project"
    response = initialize_project(_request("MCP HTTP Secure Headers", project_root))
    agent_root = project_root / ".agent-workflow"
    secret_ref = "secure://mcp/http"
    plaintext = json.dumps(
        {
            "headers": {
                "Authorization": "Bearer fake-access-token",
                "X-CW-MCP-Token": "fake-access-token",
            },
            "env": {"CW_MCP_TOKEN": "fake-env-token"},
        }
    )
    encrypted = encrypt_project_secret_value(
        response.project_id,
        plaintext,
        master_key=b"test-master-key",
        encrypt_aead=_fake_encrypt_aead,
        nonce_factory=lambda size: b"\x07" * size,
    )
    _write_secure_secret(project_root, secret_ref, encrypted)
    server, thread, endpoint_url = _start_fake_mcp_http_server("json")
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_secure",
                    "transport": "http",
                    "command_or_url": endpoint_url,
                    "secret_ref": secret_ref,
                }
            ],
        )
        decrypt_secret = build_project_secret_decryptor(
            project_root,
            master_key_provider=lambda _project_id: b"test-master-key",
            decrypt_aead=_fake_decrypt_aead,
        )
        client_factory = build_project_mcp_http_discovery_client_factory(
            project_root,
            decrypt_secret=decrypt_secret,
            timeout_seconds=2.0,
        )

        locks = load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(client_factory),
        )

        assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
            {
                "server_id": "mcp_http_secure",
                "version": "0.6.0",
                "tools_snapshot": [
                    {
                        "name": "run",
                        "title": "Run",
                        "description": "Run remote Python.",
                        "input_schema": {
                            "type": "object",
                            "properties": {"code": {"type": "string"}},
                        },
                    }
                ],
            }
        ]

        config = ProjectMCPServerConfig(
            server_id="mcp_http_secure",
            transport="http",
            command_or_url=endpoint_url,
            secret_ref=secret_ref,
        )
        client = client_factory(config)
        try:
            client.start(config)
            assert client.health_check().healthy is True
            assert client.discover_tools() is not None
            assert client.invoke_tool("run", {"code": "print(48)"}) == {
                "content": [{"type": "text", "text": "ran remote: print(48)"}],
                "isError": False,
                "structuredContent": {"ok": True},
            }
        finally:
            client.close()

        expected_secret_headers = {
            "authorization": "Bearer fake-access-token",
            "x_cw_mcp_token": "fake-access-token",
        }
        assert server.secret_headers_log == [expected_secret_headers] * 7
        assert all("cw_mcp_token" not in entry for entry in server.all_headers_log)
        assert all("fake-env-token" not in value for entry in server.all_headers_log for value in entry.values())
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_http_discovery_client_smoke_lists_tools_sse(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_sse_discovery_project"
    initialize_project(_request("MCP HTTP SSE Discovery", project_root))
    agent_root = project_root / ".agent-workflow"
    server, thread, endpoint_url = _start_fake_mcp_http_server("sse")
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_python",
                    "transport": "http",
                    "command_or_url": endpoint_url,
                }
            ],
        )

        locks = load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                lambda config: ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
            ),
        )

        assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
            {
                "server_id": "mcp_http_python",
                "version": "0.6.0",
                "tools_snapshot": [
                    {
                        "name": "run",
                        "title": "Run",
                        "description": "Run remote Python.",
                        "input_schema": {
                            "type": "object",
                            "properties": {"code": {"type": "string"}},
                        },
                    }
                ],
            }
        ]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


@pytest.mark.parametrize("mode", ["json", "sse"])
def test_project_mcp_http_client_smoke_invokes_tool(mode: str) -> None:
    server, thread, endpoint_url = _start_fake_mcp_http_server(mode)
    client = ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
    config = ProjectMCPServerConfig(
        server_id="mcp_http_python",
        transport="http",
        command_or_url=endpoint_url,
    )
    try:
        client.start(config)
        assert client.health_check().healthy is True
        assert client.discover_tools() is not None

        assert client.invoke_tool("run", {"code": "print(2)"}) == {
            "content": [{"type": "text", "text": "ran remote: print(2)"}],
            "isError": False,
            "structuredContent": {"ok": True},
        }
        assert server.request_headers_log[-1] == {
            "method": "tools/call",
            "accept": "application/json, text/event-stream",
            "content_type": "application/json",
            "protocol_version": "2025-06-18",
            "session_id": "test-session-1",
        }
    finally:
        client.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_http_client_rejects_secret_header_protocol_override() -> None:
    client = ProjectMCPHttpDiscoveryClient(
        timeout_seconds=2.0,
        secret_headers={"Content-Type": "fake secret should not leak"},
    )
    config = ProjectMCPServerConfig(
        server_id="mcp_http_secure",
        transport="http",
        command_or_url="http://127.0.0.1:1/mcp",
    )

    with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
        client.start(config)

    assert exc_info.value.server_id == "mcp_http_secure"
    assert exc_info.value.stage == "client_lifecycle"
    assert exc_info.value.details == {
        "server_id": "mcp_http_secure",
        "transport": "http",
        "header_name": "Content-Type",
    }
    assert "fake secret" not in str(exc_info.value)
    assert "fake secret" not in str(exc_info.value.details)


def test_project_mcp_http_client_sanitizes_tool_invocation_error() -> None:
    server, thread, endpoint_url = _start_fake_mcp_http_server("call_error")
    client = ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
    config = ProjectMCPServerConfig(
        server_id="mcp_http_python",
        transport="http",
        command_or_url=endpoint_url,
    )
    try:
        client.start(config)
        assert client.health_check().healthy is True

        with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
            client.invoke_tool("run", {"code": "print-secret"})

        assert exc_info.value.server_id == "mcp_http_python"
        assert exc_info.value.stage == "invoke_tool"
        assert exc_info.value.details == {
            "server_id": "mcp_http_python",
            "transport": "http",
            "jsonrpc_error_type": "int",
        }
        assert "fake secret" not in str(exc_info.value)
        assert "print-secret" not in str(exc_info.value)
        assert "command_or_url" not in str(exc_info.value.details)
    finally:
        client.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_http_discovery_client_times_out_sse_without_matching_response(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_sse_timeout_project"
    initialize_project(_request("MCP HTTP SSE Timeout", project_root))
    agent_root = project_root / ".agent-workflow"
    server, thread, endpoint_url = _start_fake_mcp_http_server("sse_hang")
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_python",
                    "transport": "http",
                    "command_or_url": endpoint_url,
                }
            ],
        )

        started_at = time.monotonic()
        with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
            load_project_tool_lock_snapshot(
                project_root,
                mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                    lambda config: ProjectMCPHttpDiscoveryClient(timeout_seconds=0.2)
                ),
            )
        elapsed = time.monotonic() - started_at

        assert elapsed < 0.8
        assert exc_info.value.server_id == "mcp_http_python"
        assert exc_info.value.stage == "discover_tools"
        assert exc_info.value.details == {
            "server_id": "mcp_http_python",
            "transport": "http",
            "timeout_seconds": 0.2,
        }
        assert "command_or_url" not in str(exc_info.value.details)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_http_discovery_client_reuse_resets_session_headers(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_reuse_project"
    initialize_project(_request("MCP HTTP Reuse", project_root))
    agent_root = project_root / ".agent-workflow"
    first_server, first_thread, first_endpoint_url = _start_fake_mcp_http_server("json")
    second_server, second_thread, second_endpoint_url = _start_fake_mcp_http_server("json")
    client = ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_python",
                    "transport": "http",
                    "command_or_url": first_endpoint_url,
                }
            ],
        )
        load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(lambda config: client),
        )

        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_python",
                    "transport": "http",
                    "command_or_url": second_endpoint_url,
                }
            ],
        )
        load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(lambda config: client),
        )

        assert first_server.request_headers_log[0]["method"] == "initialize"
        assert first_server.request_headers_log[0]["protocol_version"] == ""
        assert first_server.request_headers_log[0]["session_id"] == ""
        assert second_server.request_headers_log[0]["method"] == "initialize"
        assert second_server.request_headers_log[0]["protocol_version"] == ""
        assert second_server.request_headers_log[0]["session_id"] == ""
    finally:
        for server, thread in ((first_server, first_thread), (second_server, second_thread)):
            server.shutdown()
            server.server_close()
            thread.join(timeout=2.0)


def test_project_mcp_http_discovery_client_sanitizes_json_rpc_error(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_error_project"
    initialize_project(_request("MCP HTTP Error", project_root))
    agent_root = project_root / ".agent-workflow"
    server, thread, endpoint_url = _start_fake_mcp_http_server("error")
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_python",
                    "transport": "http",
                    "command_or_url": endpoint_url,
                }
            ],
        )

        with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
            load_project_tool_lock_snapshot(
                project_root,
                mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                    lambda config: ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
                ),
            )

        assert exc_info.value.server_id == "mcp_http_python"
        assert exc_info.value.stage == "discover_tools"
        assert exc_info.value.details == {
            "server_id": "mcp_http_python",
            "transport": "http",
            "jsonrpc_error_type": "int",
        }
        assert "fake secret" not in str(exc_info.value)
        assert "fake secret" not in str(exc_info.value.details)
        assert "command_or_url" not in str(exc_info.value.details)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_http_discovery_client_sanitizes_http_error(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_status_error_project"
    initialize_project(_request("MCP HTTP Status Error", project_root))
    agent_root = project_root / ".agent-workflow"
    server, thread, endpoint_url = _start_fake_mcp_http_server("http_error")
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_python",
                    "transport": "http",
                    "command_or_url": endpoint_url,
                }
            ],
        )

        with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
            load_project_tool_lock_snapshot(
                project_root,
                mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                    lambda config: ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
                ),
            )

        assert exc_info.value.server_id == "mcp_http_python"
        assert exc_info.value.stage == "discover_tools"
        assert exc_info.value.details == {
            "server_id": "mcp_http_python",
            "transport": "http",
            "http_status": 500,
        }
        assert "fake secret" not in str(exc_info.value)
        assert "fake secret" not in str(exc_info.value.details)
        assert "command_or_url" not in str(exc_info.value.details)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_http_discovery_client_falls_back_to_legacy_sse(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_legacy_project"
    initialize_project(_request("MCP HTTP Legacy", project_root))
    agent_root = project_root / ".agent-workflow"
    server, thread, endpoint_url = _start_fake_mcp_http_server("legacy")
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_legacy_python",
                    "transport": "http",
                    "command_or_url": endpoint_url,
                }
            ],
        )

        locks = load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                lambda config: ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
            ),
        )

        assert [entry.model_dump(mode="json") for entry in locks.mcps] == [
            {
                "server_id": "mcp_http_legacy_python",
                "version": "0.4.0",
                "tools_snapshot": [
                    {
                        "name": "run",
                        "title": "Run",
                        "description": "Run legacy Python.",
                        "input_schema": {
                            "type": "object",
                            "properties": {"code": {"type": "string"}},
                        },
                    }
                ],
            }
        ]
        assert [entry["method"] for entry in server.request_headers_log] == [
            "initialize",
            "initialize",
            "notifications/initialized",
            "tools/list",
        ]
        assert server.request_headers_log[1:] == [
            {
                "method": "initialize",
                "accept": "",
                "content_type": "application/json",
                "protocol_version": "",
                "session_id": "",
            },
            {
                "method": "notifications/initialized",
                "accept": "",
                "content_type": "application/json",
                "protocol_version": "",
                "session_id": "",
            },
            {
                "method": "tools/list",
                "accept": "",
                "content_type": "application/json",
                "protocol_version": "",
                "session_id": "",
            },
        ]
    finally:
        server.legacy_response_queue.put(None)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_legacy_http_client_smoke_invokes_tool() -> None:
    server, thread, endpoint_url = _start_fake_mcp_http_server("legacy")
    client = ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
    config = ProjectMCPServerConfig(
        server_id="mcp_http_legacy_python",
        transport="http",
        command_or_url=endpoint_url,
    )
    try:
        client.start(config)
        assert client.health_check().healthy is True
        assert client.discover_tools() is not None

        assert client.invoke_tool("run", {"code": "print(3)"}) == {
            "content": [{"type": "text", "text": "ran legacy: print(3)"}],
            "isError": False,
            "structuredContent": {"ok": True},
        }
        assert [entry["method"] for entry in server.request_headers_log] == [
            "initialize",
            "initialize",
            "notifications/initialized",
            "tools/list",
            "tools/call",
        ]
    finally:
        client.close()
        server.legacy_response_queue.put(None)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_http_discovery_client_sanitizes_legacy_sse_error(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_http_legacy_error_project"
    initialize_project(_request("MCP HTTP Legacy Error", project_root))
    agent_root = project_root / ".agent-workflow"
    server, thread, endpoint_url = _start_fake_mcp_http_server("legacy_error")
    try:
        _write_json_value(
            agent_root / "mcp.config.json",
            [
                {
                    "server_id": "mcp_http_legacy_python",
                    "transport": "http",
                    "command_or_url": endpoint_url,
                }
            ],
        )

        with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
            load_project_tool_lock_snapshot(
                project_root,
                mcp_tool_discovery=ProjectMCPDiscoveryRunner(
                    lambda config: ProjectMCPHttpDiscoveryClient(timeout_seconds=2.0)
                ),
            )

        assert exc_info.value.server_id == "mcp_http_legacy_python"
        assert exc_info.value.stage == "discover_tools"
        assert exc_info.value.details == {
            "server_id": "mcp_http_legacy_python",
            "transport": "http",
            "jsonrpc_error_type": "int",
        }
        assert "fake secret" not in str(exc_info.value)
        assert "fake secret" not in str(exc_info.value.details)
        assert "command_or_url" not in str(exc_info.value.details)
    finally:
        server.legacy_response_queue.put(None)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_project_mcp_discovery_runner_unhealthy_fails_closed_and_closes(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_discovery_unhealthy_project"
    initialize_project(_request("MCP Discovery Unhealthy", project_root))
    agent_root = project_root / ".agent-workflow"
    events: list[str] = []

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_secure",
                "transport": "stdio",
                "command_or_url": "python -m local_mcp",
                "secret_ref": "secure://mcp/local-python",
            }
        ],
    )

    def client_factory(config: ProjectMCPServerConfig) -> FakeMCPDiscoveryClient:
        events.append(f"factory:{config.server_id}")
        return FakeMCPDiscoveryClient(events, healthy=False)

    with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
        load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(client_factory),
        )

    assert events == ["factory:mcp_secure", "start:mcp_secure", "health", "close"]
    assert exc_info.value.server_id == "mcp_secure"
    assert exc_info.value.stage == "health_check"
    assert exc_info.value.details == {"server_id": "mcp_secure", "transport": "stdio"}
    assert "secure://mcp/local-python" not in str(exc_info.value.details)


def test_project_mcp_discovery_runner_sanitizes_dirty_client_error(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_discovery_dirty_client_project"
    initialize_project(_request("MCP Discovery Dirty Client", project_root))
    agent_root = project_root / ".agent-workflow"
    events: list[str] = []

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_secure",
                "transport": "stdio",
                "command_or_url": "python -m local_mcp",
                "secret_ref": "secure://mcp/local-python",
            }
        ],
    )

    def client_factory(config: ProjectMCPServerConfig) -> DirtyErrorMCPDiscoveryClient:
        events.append(f"factory:{config.server_id}")
        return DirtyErrorMCPDiscoveryClient(events)

    with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
        load_project_tool_lock_snapshot(
            project_root,
            mcp_tool_discovery=ProjectMCPDiscoveryRunner(client_factory),
        )

    assert events == ["factory:mcp_secure", "start:mcp_secure", "close"]
    assert exc_info.value.server_id == "mcp_secure"
    assert exc_info.value.stage == "client_lifecycle"
    assert exc_info.value.details == {
        "server_id": "mcp_secure",
        "transport": "stdio",
        "exception_type": "ProjectMCPDiscoveryError",
    }
    assert "fake secret" not in str(exc_info.value)
    assert "command_or_url" not in str(exc_info.value.details)
    assert "secure://mcp/local-python" not in str(exc_info.value.details)


def test_project_mcp_discovery_provider_exception_is_sanitized(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_discovery_exception_project"
    initialize_project(_request("MCP Discovery Exception", project_root))
    agent_root = project_root / ".agent-workflow"

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_local_python",
                "transport": "stdio",
                "command_or_url": "python -m local_mcp",
            }
        ],
    )

    def discover(config: ProjectMCPServerConfig) -> ProjectMCPDiscoveredTools | None:
        raise RuntimeError(f"failed with fake secret for {config.server_id}")

    with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
        load_project_tool_lock_snapshot(project_root, mcp_tool_discovery=discover)

    assert exc_info.value.server_id == "mcp_local_python"
    assert exc_info.value.stage == "discover_tools"
    assert exc_info.value.details == {
        "server_id": "mcp_local_python",
        "transport": "stdio",
        "exception_type": "RuntimeError",
    }
    assert "fake secret" not in str(exc_info.value)
    assert "fake secret" not in str(exc_info.value.details)


def test_project_mcp_discovery_provider_dirty_error_is_sanitized(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_discovery_dirty_error_project"
    initialize_project(_request("MCP Discovery Dirty Error", project_root))
    agent_root = project_root / ".agent-workflow"

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_secure",
                "transport": "stdio",
                "command_or_url": "python -m local_mcp",
                "secret_ref": "secure://mcp/local-python",
            }
        ],
    )

    def discover(config: ProjectMCPServerConfig) -> ProjectMCPDiscoveredTools | None:
        raise ProjectMCPDiscoveryError(
            config.server_id,
            "fake-secret-stage",
            "dirty provider error with fake secret",
            details={
                "command_or_url": config.command_or_url,
                "secret_ref": config.secret_ref or "secure://fake",
            },
        )

    with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
        load_project_tool_lock_snapshot(project_root, mcp_tool_discovery=discover)

    assert exc_info.value.server_id == "mcp_secure"
    assert exc_info.value.stage == "discover_tools"
    assert exc_info.value.details == {
        "server_id": "mcp_secure",
        "transport": "stdio",
        "exception_type": "ProjectMCPDiscoveryError",
    }
    assert "fake secret" not in str(exc_info.value)
    assert "command_or_url" not in str(exc_info.value.details)
    assert "secure://mcp/local-python" not in str(exc_info.value.details)


def test_project_mcp_discovery_provider_bad_result_fails_closed(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_discovery_bad_result_project"
    initialize_project(_request("MCP Discovery Bad Result", project_root))
    agent_root = project_root / ".agent-workflow"

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_local_python",
                "transport": "stdio",
                "command_or_url": "python -m local_mcp",
            }
        ],
    )

    class InvalidDiscoveryResult:
        pass

    def discover(config: ProjectMCPServerConfig) -> ProjectMCPDiscoveredTools | None:
        return cast(ProjectMCPDiscoveredTools, InvalidDiscoveryResult())

    with pytest.raises(ProjectMCPDiscoveryError) as exc_info:
        load_project_tool_lock_snapshot(project_root, mcp_tool_discovery=discover)

    assert exc_info.value.server_id == "mcp_local_python"
    assert exc_info.value.stage == "discover_tools"
    assert exc_info.value.details == {
        "server_id": "mcp_local_python",
        "transport": "stdio",
        "result_type": "InvalidDiscoveryResult",
    }


def test_project_tool_availability_treats_invalid_manifest_entries_as_disabled(tmp_path: Path) -> None:
    project_root = tmp_path / "invalid_tool_availability_project"
    initialize_project(_request("Invalid Tool Availability", project_root))
    skills_path = project_root / ".agent-workflow" / "skills.config.json"
    _write_json_value(
        skills_path,
        [
            {"skill_id": "", "enabled": True},
            {"skill_id": "bad_enabled", "enabled": "yes"},
            "bad_entry",
        ],
    )

    availability = load_project_tool_availability(project_root)

    assert availability.skill_ids == set()
    assert availability.skill_refs == set()


def test_project_mcp_server_configs_read_enabled_spec_fields_only(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_config_project"
    initialize_project(_request("MCP Config", project_root))
    agent_root = project_root / ".agent-workflow"

    _write_json_value(
        agent_root / "mcp.config.json",
        [
            {
                "server_id": "mcp_http",
                "transport": "http",
                "command_or_url": "https://mcp.example.test/http",
                "requires_approval": False,
                "version": "ignored",
                "tools_snapshot": [{"name": "ignored"}],
            },
            {
                "server_id": "mcp_stdio",
                "transport": "stdio",
                "command_or_url": "local-mcp",
                "secret_ref": "secure://mcp/local",
            },
            {"server_id": "missing_transport", "command_or_url": "local-mcp"},
            {"server_id": "disabled_mcp", "transport": "http", "command_or_url": "https://disabled", "enabled": False},
        ],
    )

    configs = load_project_mcp_server_configs(project_root)

    assert [config.model_dump(mode="json") for config in configs.values()] == [
        {
            "server_id": "mcp_http",
            "transport": "http",
            "command_or_url": "https://mcp.example.test/http",
            "requires_approval": False,
            "secret_ref": None,
        },
        {
            "server_id": "mcp_stdio",
            "transport": "stdio",
            "command_or_url": "local-mcp",
            "requires_approval": False,
            "secret_ref": "secure://mcp/local",
        },
    ]


def test_project_mcp_secret_material_loads_from_secure_store(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_secret_store_project"
    initialize_project(_request("MCP Secret Store", project_root))
    _write_secure_secret(project_root, "secure://mcp/local", b"encrypted-local-token")
    decrypted_inputs: list[bytes] = []

    def decrypt_secret(encrypted_value: bytes) -> bytes:
        decrypted_inputs.append(encrypted_value)
        return json.dumps(
            {
                "headers": {"Authorization": "Bearer fake-access-token"},
                "env": {"CW_MCP_TOKEN": "fake-access-token"},
            }
        ).encode()

    material = load_project_mcp_secret_material(
        project_root,
        "secure://mcp/local",
        decrypt_secret=decrypt_secret,
    )

    assert decrypted_inputs == [b"encrypted-local-token"]
    assert material is not None
    assert material.model_dump(mode="json") == {
        "headers": {"Authorization": "Bearer fake-access-token"},
        "env": {"CW_MCP_TOKEN": "fake-access-token"},
    }


def test_project_secret_envelope_round_trips_with_project_salt(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_secret_envelope_project"
    response = initialize_project(_request("MCP Secret Envelope", project_root))
    plaintext = b'{"headers":{"Authorization":"Bearer fake-access-token"}}'

    encrypted = encrypt_project_secret_value(
        response.project_id,
        plaintext,
        master_key=b"test-master-key",
        encrypt_aead=_fake_encrypt_aead,
        nonce_factory=lambda size: b"\x01" * size,
    )
    envelope = json.loads(encrypted.decode("utf-8"))

    assert envelope["version"] == "0.1.0"
    assert envelope["algorithm"] == "AES-GCM-256"
    assert envelope["kdf"] == "PBKDF2-HMAC-SHA256"
    assert envelope["iterations"] >= 100_000
    assert envelope["salt"] != ""
    assert envelope["nonce"] != ""
    assert envelope["ciphertext"] != ""
    assert (
        decrypt_project_secret_value(
            response.project_id,
            encrypted,
            master_key=b"test-master-key",
            decrypt_aead=_fake_decrypt_aead,
        )
        == plaintext
    )


def test_project_secret_envelope_round_trips_with_windows_cng_aes_gcm(tmp_path: Path) -> None:
    if sys.platform != "win32":
        pytest.skip("Windows CNG AES-GCM provider is only available on Windows.")
    project_root = tmp_path / "mcp_secret_windows_cng_project"
    response = initialize_project(_request("MCP Secret Windows CNG", project_root))
    plaintext = b'{"headers":{"Authorization":"Bearer fake-access-token"}}'

    encrypted = encrypt_project_secret_value(
        response.project_id,
        plaintext,
        master_key=b"test-master-key",
        encrypt_aead=windows_cng_encrypt_aes_gcm,
        nonce_factory=lambda size: b"\x04" * size,
    )
    envelope = json.loads(encrypted.decode("utf-8"))
    ciphertext = base64.b64decode(envelope["ciphertext"].encode("ascii"), validate=True)

    assert b"fake-access-token" not in ciphertext
    assert (
        decrypt_project_secret_value(
            response.project_id,
            encrypted,
            master_key=b"test-master-key",
            decrypt_aead=windows_cng_decrypt_aes_gcm,
        )
        == plaintext
    )

    with pytest.raises(ProjectSecretStoreError) as exc_info:
        decrypt_project_secret_value(
            response.project_id,
            encrypted,
            master_key=b"different-master-key",
            decrypt_aead=windows_cng_decrypt_aes_gcm,
        )

    assert "fake-access-token" not in str(exc_info.value)
    assert response.project_id not in str(exc_info.value)


def test_project_secret_decryptor_loads_master_key_from_windows_credential_manager(tmp_path: Path) -> None:
    if sys.platform != "win32":
        pytest.skip("Windows Credential Manager provider is only available on Windows.")
    project_root = tmp_path / "mcp_secret_windows_credential_project"
    response = initialize_project(_request("MCP Secret Windows Credential", project_root))
    target_prefix = f"CognitiveWorkflow/test/{uuid.uuid4()}/"
    secret_ref = "secure://mcp/windows-credential"
    master_key = b"windows-credential-manager-master-key"
    plaintext = json.dumps(
        {
            "headers": {"Authorization": "Bearer fake-access-token"},
            "env": {"CW_MCP_TOKEN": "fake-access-token"},
        }
    )
    credential_deleted = False

    try:
        assert delete_windows_credential_manager_master_key(response.project_id, target_prefix=target_prefix) is False
        write_windows_credential_manager_master_key(
            response.project_id,
            master_key,
            target_prefix=target_prefix,
        )
        assert (
            windows_credential_manager_master_key_provider(response.project_id, target_prefix=target_prefix)
            == master_key
        )
        encrypted = encrypt_project_secret_value(
            response.project_id,
            plaintext,
            master_key=master_key,
            encrypt_aead=windows_cng_encrypt_aes_gcm,
            nonce_factory=lambda size: b"\x06" * size,
        )
        _write_secure_secret(project_root, secret_ref, encrypted)

        def master_key_provider(project_id: str) -> bytes:
            return windows_credential_manager_master_key_provider(project_id, target_prefix=target_prefix)

        decrypt_secret = build_project_secret_decryptor(
            project_root,
            master_key_provider=master_key_provider,
            decrypt_aead=windows_cng_decrypt_aes_gcm,
        )
        material = load_project_mcp_secret_material(project_root, secret_ref, decrypt_secret=decrypt_secret)

        assert material is not None
        assert material.model_dump(mode="json") == {
            "headers": {"Authorization": "Bearer fake-access-token"},
            "env": {"CW_MCP_TOKEN": "fake-access-token"},
        }
        assert delete_windows_credential_manager_master_key(response.project_id, target_prefix=target_prefix) is True
        credential_deleted = True
        with pytest.raises(ProjectSecretStoreError) as exc_info:
            windows_credential_manager_master_key_provider(response.project_id, target_prefix=target_prefix)
        assert response.project_id not in str(exc_info.value)
        assert "fake-access-token" not in str(exc_info.value)
    finally:
        if not credential_deleted:
            delete_windows_credential_manager_master_key(response.project_id, target_prefix=target_prefix)


def test_project_secret_envelope_rejects_wrong_project_salt(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_secret_wrong_project"
    response = initialize_project(_request("MCP Secret Wrong Project", project_root))
    encrypted = encrypt_project_secret_value(
        response.project_id,
        b'{"headers":{"Authorization":"Bearer fake-access-token"}}',
        master_key=b"test-master-key",
        encrypt_aead=_fake_encrypt_aead,
        nonce_factory=lambda size: b"\x02" * size,
    )

    with pytest.raises(ProjectSecretStoreError) as exc_info:
        decrypt_project_secret_value(
            "different-project-id",
            encrypted,
            master_key=b"test-master-key",
            decrypt_aead=_fake_decrypt_aead,
        )

    assert "fake-access-token" not in str(exc_info.value)
    assert response.project_id not in str(exc_info.value)


def test_project_secret_envelope_rejects_oversized_direct_input() -> None:
    with pytest.raises(ProjectSecretStoreError) as exc_info:
        decrypt_project_secret_value(
            "proj_oversized",
            b"{" + (b" " * (70 * 1024)) + b"}",
            master_key=b"test-master-key",
            decrypt_aead=_fake_decrypt_aead,
        )

    assert "size limit" in str(exc_info.value)


def test_project_secret_envelope_rejects_oversized_ciphertext() -> None:
    project_id = "proj_oversized_ciphertext"
    envelope = {
        "version": "0.1.0",
        "algorithm": "AES-GCM-256",
        "kdf": "PBKDF2-HMAC-SHA256",
        "iterations": 600_000,
        "salt": base64.b64encode(project_id.encode("utf-8")).decode("ascii"),
        "nonce": base64.b64encode(b"\x05" * 12).decode("ascii"),
        "ciphertext": base64.b64encode(b"x" * (70 * 1024)).decode("ascii"),
    }

    with pytest.raises(ProjectSecretStoreError) as exc_info:
        decrypt_project_secret_value(
            project_id,
            json.dumps(envelope).encode("utf-8"),
            master_key=b"test-master-key",
            decrypt_aead=_fake_decrypt_aead,
        )

    assert "size limit" in str(exc_info.value)


def test_project_mcp_secret_material_loads_with_project_crypto_decryptor(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_secret_crypto_project"
    response = initialize_project(_request("MCP Secret Crypto", project_root))
    encrypted = encrypt_project_secret_value(
        response.project_id,
        json.dumps(
            {
                "headers": {"Authorization": "Bearer fake-access-token"},
                "env": {"CW_MCP_TOKEN": "fake-access-token"},
            }
        ),
        master_key=b"test-master-key",
        encrypt_aead=_fake_encrypt_aead,
        nonce_factory=lambda size: b"\x03" * size,
    )
    _write_secure_secret(project_root, "secure://mcp/local", encrypted)
    requested_project_ids: list[str] = []

    def master_key_provider(project_id: str) -> bytes:
        requested_project_ids.append(project_id)
        return b"test-master-key"

    decrypt_secret = build_project_secret_decryptor(
        project_root,
        master_key_provider=master_key_provider,
        decrypt_aead=_fake_decrypt_aead,
    )

    material = load_project_mcp_secret_material(
        project_root,
        "secure://mcp/local",
        decrypt_secret=decrypt_secret,
    )

    assert requested_project_ids == [response.project_id]
    assert material is not None
    assert material.model_dump(mode="json") == {
        "headers": {"Authorization": "Bearer fake-access-token"},
        "env": {"CW_MCP_TOKEN": "fake-access-token"},
    }


def test_project_mcp_secret_material_missing_store_or_row_returns_none(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_secret_missing_project"
    initialize_project(_request("MCP Secret Missing", project_root))
    decrypt_calls: list[bytes] = []

    def decrypt_secret(encrypted_value: bytes) -> bytes:
        decrypt_calls.append(encrypted_value)
        return b'{"headers":{"Authorization":"Bearer fake"}}'

    assert load_project_mcp_secret_material(project_root, "secure://mcp/missing", decrypt_secret=decrypt_secret) is None
    _write_secure_secret(project_root, "secure://mcp/other", b"encrypted-other-token")

    assert load_project_mcp_secret_material(project_root, "secure://mcp/missing", decrypt_secret=decrypt_secret) is None
    assert decrypt_calls == []


def test_project_mcp_secret_material_invalid_plaintext_is_sanitized(tmp_path: Path) -> None:
    project_root = tmp_path / "mcp_secret_invalid_project"
    initialize_project(_request("MCP Secret Invalid", project_root))
    _write_secure_secret(project_root, "secure://mcp/local", b"encrypted-local-token")

    def decrypt_secret(encrypted_value: bytes) -> str:
        assert encrypted_value == b"encrypted-local-token"
        return '{"headers":{"Authorization":"fake secret should not leak"},"extra":"invalid"}'

    with pytest.raises(ProjectSecretStoreError) as exc_info:
        load_project_mcp_secret_material(
            project_root,
            "secure://mcp/local",
            decrypt_secret=decrypt_secret,
        )

    assert "fake secret" not in str(exc_info.value)
    assert "secure://mcp/local" not in str(exc_info.value)


def test_update_manifest_json_blocks_direct_memory_write(tmp_path: Path) -> None:
    project_root = tmp_path / "memory_project"
    initialize_project(_request("Memory", project_root))

    memory = _read_json(project_root / ".agent-workflow" / "memory.json")
    with pytest.raises(HarnessError) as exc_info:
        update_manifest_json(project_root, "memory.json", memory)

    assert exc_info.value.error_code == "RH_MEMORY_DIRECT_WRITE_FORBIDDEN"


def test_initialize_project_preserves_pre_staged_user_files(tmp_path: Path) -> None:
    project_root = tmp_path / "existing_git_project"
    project_root.mkdir()
    subprocess.run(["git", "init", "-b", "main"], cwd=project_root, check=True, capture_output=True, text=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Test User",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "initial user commit",
        ],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
    )
    user_file = project_root / "user_notes.txt"
    user_file.write_text("user staged content\n", encoding="utf-8")
    subprocess.run(["git", "add", "user_notes.txt"], cwd=project_root, check=True, capture_output=True, text=True)

    initialize_project(_request("Existing Git", project_root))

    head_files = subprocess.run(
        ["git", "show", "--name-only", "--format=", "HEAD"],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    staged_files = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()

    assert "user_notes.txt" not in head_files
    assert "user_notes.txt" in staged_files
