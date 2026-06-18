"""Adapter-owned builtin tool functions.

These functions are intentionally small and dependency-free. They are exposed
to SDK toolsets only when a NodeContract requests the matching builtin tool id.
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import urllib.parse
from collections.abc import Callable, Sequence
from contextlib import closing
from dataclasses import dataclass
from http.client import HTTPMessage
from pathlib import Path
from typing import Any, Final, Protocol

BuiltinToolFunc = Callable[..., Any]

_WEB_FETCH_TIMEOUT_SECONDS: Final = 10.0
_WEB_FETCH_DEFAULT_MAX_BYTES: Final = 64 * 1024
_WEB_FETCH_ABSOLUTE_MAX_BYTES: Final = 256 * 1024
_WEB_FETCH_USER_AGENT: Final = "CognitiveWorkflow/0.1 web_fetch"
_ALLOWED_WEB_FETCH_SCHEMES: Final = frozenset({"http", "https"})
_FILE_IO_DEFAULT_MAX_BYTES: Final = 64 * 1024
_FILE_IO_ABSOLUTE_MAX_BYTES: Final = 256 * 1024
_FILE_IO_DEFAULT_MAX_ENTRIES: Final = 200
_FILE_IO_ABSOLUTE_MAX_ENTRIES: Final = 1000
_FILE_IO_INTERNAL_ROOTS: Final = frozenset({".agent-workflow", ".git"})
_FILE_IO_ACTIONS: Final = frozenset({"read_text", "list_dir", "stat"})


@dataclass(frozen=True)
class _ValidatedWebFetchTarget:
    normalized_url: str
    scheme: str
    host: str
    port: int
    host_header: str
    request_target: str
    address: ipaddress.IPv4Address | ipaddress.IPv6Address


class _WebResponse(Protocol):
    status: int
    headers: HTTPMessage

    def read(self, amt: int = -1) -> bytes: ...

    def close(self) -> None: ...


def default_builtin_tool_functions(*, project_root: str | Path | None = None) -> dict[str, BuiltinToolFunc]:
    """Return builtin functions implemented by the runtime adapter layer."""

    functions: dict[str, BuiltinToolFunc] = {"web_fetch": web_fetch}
    if project_root is not None:
        functions["file_io"] = file_io_for_project_root(project_root)
    return functions


def default_builtin_tool_names() -> tuple[str, ...]:
    """Return stable builtin tool ids implemented by this module."""

    return tuple(sorted({"file_io", *default_builtin_tool_functions()}))


def file_io_for_project_root(project_root: str | Path) -> BuiltinToolFunc:
    """Return a read-only project file tool scoped to one CW project root."""

    root = _validated_file_io_project_root(project_root)

    def file_io(
        action: str,
        path: str,
        max_bytes: int = _FILE_IO_DEFAULT_MAX_BYTES,
        max_entries: int = _FILE_IO_DEFAULT_MAX_ENTRIES,
    ) -> dict[str, Any]:
        """Read project files with action=read_text, list_dir, or stat."""

        return _file_io(root, action=action, path=path, max_bytes=max_bytes, max_entries=max_entries)

    return file_io


def _file_io(
    project_root: Path,
    *,
    action: str,
    path: str,
    max_bytes: int,
    max_entries: int,
) -> dict[str, Any]:
    if action not in _FILE_IO_ACTIONS:
        raise ValueError("file_io action must be read_text, list_dir, or stat.")
    target, relative_path = _validated_file_io_target(project_root, path)
    if action == "read_text":
        return _file_io_read_text(target, relative_path, max_bytes=max_bytes)
    if action == "list_dir":
        return _file_io_list_dir(target, relative_path, max_entries=max_entries)
    return _file_io_stat(target, relative_path)


def _file_io_read_text(target: Path, relative_path: str, *, max_bytes: int) -> dict[str, Any]:
    if not target.is_file():
        raise IsADirectoryError("file_io read_text target must be a file.")
    read_limit = _normalized_file_io_max_bytes(max_bytes)
    with target.open("rb") as file:
        raw = file.read(read_limit + 1)
    truncated = len(raw) > read_limit
    if truncated:
        raw = raw[:read_limit]
    return {
        "action": "read_text",
        "path": relative_path,
        "bytes_read": len(raw),
        "truncated": truncated,
        "text": raw.decode("utf-8", errors="replace"),
    }


def _file_io_list_dir(target: Path, relative_path: str, *, max_entries: int) -> dict[str, Any]:
    if not target.is_dir():
        raise NotADirectoryError("file_io list_dir target must be a directory.")
    entry_limit = _normalized_file_io_max_entries(max_entries)
    entries: list[dict[str, Any]] = []
    truncated = False
    for child in sorted(target.iterdir(), key=lambda item: item.name.lower()):
        if _is_file_io_internal_component(child.name):
            continue
        if len(entries) >= entry_limit:
            truncated = True
            break
        child_stat = child.lstat()
        kind = "symlink" if child.is_symlink() else "directory" if child.is_dir() else "file"
        child_relative_path = child.name if relative_path == "." else f"{relative_path}/{child.name}"
        entries.append(
            {
                "name": child.name,
                "path": child_relative_path,
                "kind": kind,
                "size_bytes": child_stat.st_size,
            }
        )
    return {
        "action": "list_dir",
        "path": relative_path,
        "entries": entries,
        "truncated": truncated,
    }


def _file_io_stat(target: Path, relative_path: str) -> dict[str, Any]:
    stat = target.stat()
    return {
        "action": "stat",
        "path": relative_path,
        "kind": "directory" if target.is_dir() else "file",
        "size_bytes": stat.st_size,
        "modified_at_ms": int(stat.st_mtime * 1000),
    }


def _validated_file_io_project_root(project_root: str | Path) -> Path:
    root = Path(project_root).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("file_io project_root must be an existing directory.")
    if not (root / ".agent-workflow").is_dir():
        raise ValueError("file_io project_root must be an initialized CW project root.")
    return root


def _validated_file_io_target(project_root: Path, path: str) -> tuple[Path, str]:
    if not path:
        raise ValueError("file_io path must be non-empty.")
    raw_path = Path(path)
    if _has_file_io_internal_component(raw_path.parts):
        raise PermissionError("file_io does not allow internal runtime or VCS paths.")
    target = raw_path if raw_path.is_absolute() else project_root / raw_path
    resolved = target.resolve(strict=True)
    if not resolved.is_relative_to(project_root):
        raise PermissionError("file_io path must stay inside project_root.")
    relative_path = _relative_posix_path(resolved, project_root)
    parts = Path(relative_path).parts
    if _has_file_io_internal_component(parts):
        raise PermissionError("file_io does not allow internal runtime or VCS paths.")
    return resolved, relative_path


def _has_file_io_internal_component(parts: Sequence[str]) -> bool:
    return any(_is_file_io_internal_component(part) for part in parts)


def _is_file_io_internal_component(part: str) -> bool:
    return part.lower() in _FILE_IO_INTERNAL_ROOTS


def _relative_posix_path(path: Path, root: Path) -> str:
    relative = path.relative_to(root)
    value = relative.as_posix()
    return "." if value == "" else value


def _normalized_file_io_max_bytes(max_bytes: int) -> int:
    if max_bytes < 1:
        raise ValueError("file_io max_bytes must be >= 1.")
    return min(max_bytes, _FILE_IO_ABSOLUTE_MAX_BYTES)


def _normalized_file_io_max_entries(max_entries: int) -> int:
    if max_entries < 1:
        raise ValueError("file_io max_entries must be >= 1.")
    return min(max_entries, _FILE_IO_ABSOLUTE_MAX_ENTRIES)


def web_fetch(url: str, max_bytes: int = _WEB_FETCH_DEFAULT_MAX_BYTES) -> dict[str, Any]:
    """Fetch public HTTP(S) text content with SSRF-oriented network guards."""

    read_limit = _normalized_max_bytes(max_bytes)
    try:
        target = _validated_public_http_target(url)
        response = _open_web_fetch_target(target, timeout=_WEB_FETCH_TIMEOUT_SECONDS)
    except OSError as exc:
        raise RuntimeError(f"web_fetch request failed: {exc}") from exc

    with closing(response):
        raw = response.read(read_limit + 1)
        truncated = len(raw) > read_limit
        if truncated:
            raw = raw[:read_limit]
        content_type = response.headers.get("Content-Type", "")
        charset = response.headers.get_content_charset() or "utf-8"
        return {
            "url": target.normalized_url,
            "final_url": target.normalized_url,
            "status_code": response.status,
            "content_type": content_type,
            "bytes_read": len(raw),
            "truncated": truncated,
            "text": raw.decode(charset, errors="replace"),
        }


def _open_web_fetch_target(target: _ValidatedWebFetchTarget, *, timeout: float) -> _WebResponse:
    transport = socket.create_connection((str(target.address), target.port), timeout=timeout)
    try:
        if target.scheme == "https":
            context = ssl.create_default_context()
            transport = context.wrap_socket(transport, server_hostname=target.host)
        _send_http_get(transport, target)
        response = http.client.HTTPResponse(transport)
        response.begin()
        return response
    except Exception:
        transport.close()
        raise


def _send_http_get(transport: socket.socket | ssl.SSLSocket, target: _ValidatedWebFetchTarget) -> None:
    request_lines = [
        f"GET {target.request_target} HTTP/1.1",
        f"Host: {target.host_header}",
        f"User-Agent: {_WEB_FETCH_USER_AGENT}",
        "Accept: text/*,*/*;q=0.1",
        "Connection: close",
        "",
        "",
    ]
    transport.sendall("\r\n".join(request_lines).encode("ascii"))


def _normalized_max_bytes(max_bytes: int) -> int:
    if max_bytes < 1:
        raise ValueError("web_fetch max_bytes must be >= 1.")
    return min(max_bytes, _WEB_FETCH_ABSOLUTE_MAX_BYTES)


def _validated_public_http_target(url: str) -> _ValidatedWebFetchTarget:
    parsed = urllib.parse.urlsplit(url)
    scheme = parsed.scheme.lower()
    if scheme not in _ALLOWED_WEB_FETCH_SCHEMES:
        raise ValueError("web_fetch supports only http and https URLs.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("web_fetch does not allow URLs with credentials.")
    host = parsed.hostname
    if host is None or not host:
        raise ValueError("web_fetch URL must include a host.")
    port = _validated_port(parsed, scheme)
    address = _public_host_address(host)
    host_header = parsed.netloc
    path = parsed.path or "/"
    request_target = urllib.parse.urlunsplit(("", "", path, parsed.query, ""))
    if _has_http_control_chars(host_header) or _has_http_control_chars(request_target):
        raise ValueError("web_fetch URL must not contain HTTP control characters.")
    normalized_url = urllib.parse.urlunsplit((scheme, host_header, path, parsed.query, ""))
    return _ValidatedWebFetchTarget(
        normalized_url=normalized_url,
        scheme=scheme,
        host=host,
        port=port,
        host_header=host_header,
        request_target=request_target,
        address=address,
    )


def _validated_port(parsed: urllib.parse.SplitResult, scheme: str) -> int:
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("web_fetch URL has an invalid port.") from exc
    if port is not None:
        return port
    return 443 if scheme == "https" else 80


def _public_host_address(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    lowered = host.lower()
    if lowered == "localhost" or lowered.endswith(".localhost"):
        raise ValueError("web_fetch does not allow localhost targets.")
    host_ips = _resolve_host_ips(host)
    if not host_ips:
        raise ValueError("web_fetch could not resolve host.")
    blocked_ips = [address for address in host_ips if not _is_public_unicast_address(address)]
    if blocked_ips:
        raise ValueError("web_fetch target must resolve only to public internet addresses.")
    return host_ips[0]


def _resolve_host_ips(host: str) -> Sequence[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        parsed_ip = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        resolved = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
        for item in resolved:
            raw_address = item[4][0]
            addresses.append(ipaddress.ip_address(raw_address))
        return addresses
    return (parsed_ip,)


def _is_public_unicast_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        address.is_global
        and not address.is_multicast
        and not address.is_loopback
        and not address.is_link_local
        and not address.is_private
        and not address.is_reserved
        and not address.is_unspecified
    )


def _has_http_control_chars(value: str) -> bool:
    return any(ord(char) < 32 or ord(char) == 127 for char in value)


__all__ = [
    "BuiltinToolFunc",
    "default_builtin_tool_functions",
    "default_builtin_tool_names",
    "file_io_for_project_root",
    "web_fetch",
]
