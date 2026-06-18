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
from typing import Any, Final, Protocol

BuiltinToolFunc = Callable[..., Any]

_WEB_FETCH_TIMEOUT_SECONDS: Final = 10.0
_WEB_FETCH_DEFAULT_MAX_BYTES: Final = 64 * 1024
_WEB_FETCH_ABSOLUTE_MAX_BYTES: Final = 256 * 1024
_WEB_FETCH_USER_AGENT: Final = "CognitiveWorkflow/0.1 web_fetch"
_ALLOWED_WEB_FETCH_SCHEMES: Final = frozenset({"http", "https"})


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


def default_builtin_tool_functions() -> dict[str, BuiltinToolFunc]:
    """Return builtin functions implemented by the runtime adapter layer."""

    return {"web_fetch": web_fetch}


def default_builtin_tool_names() -> tuple[str, ...]:
    """Return stable builtin tool ids implemented by this module."""

    return tuple(sorted(default_builtin_tool_functions()))


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
    "web_fetch",
]
