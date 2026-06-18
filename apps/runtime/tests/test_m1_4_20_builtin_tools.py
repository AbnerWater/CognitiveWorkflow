from __future__ import annotations

import ipaddress
from http.client import HTTPMessage

import pytest

import cw_runtime.adapters.builtin_tools as builtin_tools
from cw_runtime.adapters import default_builtin_tool_functions, default_builtin_tool_names, web_fetch


class _FakeWebResponse:
    def __init__(self, *, body: bytes, status: int = 200, content_type: str = "text/plain") -> None:
        self._body = body
        self.status = status
        self.closed = False
        self.headers = HTTPMessage()
        self.headers.add_header("Content-Type", content_type)

    def read(self, amt: int = -1) -> bytes:
        if amt < 0:
            return self._body
        return self._body[:amt]

    def close(self) -> None:
        self.closed = True


def test_default_builtin_registry_exposes_web_fetch() -> None:
    functions = default_builtin_tool_functions()

    assert default_builtin_tool_names() == ("web_fetch",)
    assert functions == {"web_fetch": web_fetch}


def test_web_fetch_returns_public_text_response(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, int, float]] = []
    response = _FakeWebResponse(
        body=b"hello world",
        content_type="text/plain; charset=utf-8",
    )
    resolve_calls = 0

    def resolve_host_ips(_host: str) -> tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, ...]:
        nonlocal resolve_calls
        resolve_calls += 1
        return (ipaddress.ip_address("8.8.8.8"),)

    def fake_open(target: builtin_tools._ValidatedWebFetchTarget, *, timeout: float) -> _FakeWebResponse:
        calls.append((target.normalized_url, str(target.address), target.port, timeout))
        return response

    monkeypatch.setattr(builtin_tools, "_resolve_host_ips", resolve_host_ips)
    monkeypatch.setattr(builtin_tools, "_open_web_fetch_target", fake_open)

    result = web_fetch("https://example.test/path#fragment", max_bytes=5)

    assert resolve_calls == 1
    assert calls == [("https://example.test/path", "8.8.8.8", 443, 10.0)]
    assert response.closed is True
    assert result == {
        "url": "https://example.test/path",
        "final_url": "https://example.test/path",
        "status_code": 200,
        "content_type": "text/plain; charset=utf-8",
        "bytes_read": 5,
        "truncated": True,
        "text": "hello",
    }


def test_web_fetch_does_not_follow_redirect_location(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _FakeWebResponse(body=b"redirect", status=302)
    response.headers.add_header("Location", "http://127.0.0.1/")

    def resolve_host_ips(_host: str) -> tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, ...]:
        return (ipaddress.ip_address("8.8.8.8"),)

    def fake_open(_target: builtin_tools._ValidatedWebFetchTarget, *, timeout: float) -> _FakeWebResponse:
        return response

    monkeypatch.setattr(builtin_tools, "_resolve_host_ips", resolve_host_ips)
    monkeypatch.setattr(builtin_tools, "_open_web_fetch_target", fake_open)

    result = web_fetch("https://example.test/")

    assert result["status_code"] == 302
    assert result["url"] == "https://example.test/"
    assert result["final_url"] == "https://example.test/"


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.test/file"])
def test_web_fetch_rejects_unsupported_schemes(url: str) -> None:
    with pytest.raises(ValueError, match="http and https"):
        web_fetch(url)


def test_web_fetch_rejects_credentials() -> None:
    with pytest.raises(ValueError, match="credentials"):
        web_fetch("https://user:pass@example.test/")


def test_web_fetch_rejects_private_resolved_targets(monkeypatch: pytest.MonkeyPatch) -> None:
    def resolve_host_ips(_host: str) -> tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, ...]:
        return (ipaddress.ip_address("10.0.0.1"),)

    monkeypatch.setattr(builtin_tools, "_resolve_host_ips", resolve_host_ips)

    with pytest.raises(ValueError, match="public internet"):
        web_fetch("https://private.example.test/")


def test_web_fetch_rejects_multicast_resolved_targets(monkeypatch: pytest.MonkeyPatch) -> None:
    def resolve_host_ips(_host: str) -> tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, ...]:
        return (ipaddress.ip_address("224.0.0.1"),)

    monkeypatch.setattr(builtin_tools, "_resolve_host_ips", resolve_host_ips)

    with pytest.raises(ValueError, match="public internet"):
        web_fetch("https://multicast.example.test/")


def test_web_fetch_rejects_bad_max_bytes() -> None:
    with pytest.raises(ValueError, match="max_bytes"):
        web_fetch("https://example.test/", max_bytes=0)
