from __future__ import annotations

import ipaddress
from http.client import HTTPMessage
from pathlib import Path
from typing import Any, cast

import pytest

import cw_runtime.adapters.builtin_tools as builtin_tools
from cw_runtime.adapters import (
    default_builtin_tool_functions,
    default_builtin_tool_names,
    file_io_for_project_root,
    python_sandbox,
    web_fetch,
)


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


def _initialized_project_root(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    (path / ".agent-workflow").mkdir()
    return path


def test_default_builtin_registry_exposes_web_fetch() -> None:
    functions = default_builtin_tool_functions()

    assert default_builtin_tool_names() == ("file_io", "python_sandbox", "web_fetch")
    assert functions == {"python_sandbox": python_sandbox, "web_fetch": web_fetch}


def test_default_builtin_registry_exposes_project_scoped_file_io(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path)

    functions = default_builtin_tool_functions(project_root=project_root)

    assert set(functions) == {"file_io", "python_sandbox", "web_fetch"}
    assert functions["python_sandbox"] is python_sandbox
    assert functions["web_fetch"] is web_fetch


def test_python_sandbox_evaluates_bounded_expression() -> None:
    result = python_sandbox(
        "eval_expr",
        "sum(values) + offset if all(flags) else 0",
        variables={"values": [1, 2, 3], "offset": 4, "flags": [True, True]},
    )

    assert result["action"] == "eval_expr"
    assert result["result"] == 10
    assert result["result_type"] == "int"
    assert result["result_chars"] == 2
    assert result["steps"] > 0


@pytest.mark.parametrize(
    "expression, message",
    [
        ("__import__('os')", "does not allow function"),
        ("(1).__class__", "does not allow Attribute"),
        ("[item for item in values]", "does not allow ListComp"),
        ("lambda x: x", "does not allow Lambda"),
    ],
)
def test_python_sandbox_rejects_unsafe_expression(expression: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        python_sandbox("eval_expr", expression, variables={"values": [1, 2, 3]})


def test_python_sandbox_rejects_large_range() -> None:
    with pytest.raises(ValueError, match="range is too large"):
        python_sandbox("eval_expr", "sum(range(1001))")


def test_python_sandbox_rejects_result_larger_than_limit() -> None:
    with pytest.raises(ValueError, match="result is too large"):
        python_sandbox("eval_expr", "'abcdef'", max_result_chars=4)


def test_python_sandbox_rejects_bad_variable_name() -> None:
    with pytest.raises(ValueError, match="safe identifiers"):
        python_sandbox("eval_expr", "value", variables={"__builtins__": {}})


def test_file_io_reads_project_text_file(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path)
    notes_dir = project_root / "notes"
    notes_dir.mkdir()
    (notes_dir / "a.txt").write_text("hello world", encoding="utf-8")
    tool = file_io_for_project_root(project_root)

    result = cast(dict[str, Any], tool("read_text", "notes/a.txt", max_bytes=5))

    assert result == {
        "action": "read_text",
        "path": "notes/a.txt",
        "bytes_read": 5,
        "truncated": True,
        "text": "hello",
    }


def test_file_io_lists_project_directory_without_following_symlinks(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path)
    notes_dir = project_root / "notes"
    notes_dir.mkdir()
    (notes_dir / "a.txt").write_text("alpha", encoding="utf-8")
    tool = file_io_for_project_root(project_root)

    result = cast(dict[str, Any], tool("list_dir", "notes", max_entries=10))

    assert result["action"] == "list_dir"
    assert result["path"] == "notes"
    assert result["truncated"] is False
    assert result["entries"] == [
        {
            "name": "a.txt",
            "path": "notes/a.txt",
            "kind": "file",
            "size_bytes": 5,
        }
    ]


def test_file_io_root_listing_hides_internal_directories(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path)
    (project_root / ".git").mkdir()
    (project_root / "visible.txt").write_text("alpha", encoding="utf-8")
    tool = file_io_for_project_root(project_root)

    result = cast(dict[str, Any], tool("list_dir", ".", max_entries=10))

    entries = cast(list[dict[str, Any]], result["entries"])
    assert [entry["name"] for entry in entries] == ["visible.txt"]


def test_file_io_nested_listing_hides_internal_directories(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path)
    vendor_dir = project_root / "vendor"
    vendor_dir.mkdir()
    (vendor_dir / ".git").mkdir()
    (vendor_dir / "visible.txt").write_text("alpha", encoding="utf-8")
    tool = file_io_for_project_root(project_root)

    result = cast(dict[str, Any], tool("list_dir", "vendor", max_entries=10))

    entries = cast(list[dict[str, Any]], result["entries"])
    assert [entry["name"] for entry in entries] == ["visible.txt"]


def test_file_io_rejects_paths_outside_project_root(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path / "project")
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    tool = file_io_for_project_root(project_root)

    with pytest.raises(PermissionError, match="inside project_root"):
        tool("read_text", str(outside))


def test_file_io_rejects_internal_runtime_paths(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path)
    secure_dir = project_root / ".agent-workflow" / "secure"
    secure_dir.mkdir(parents=True)
    (secure_dir / "secret.txt").write_text("secret", encoding="utf-8")
    tool = file_io_for_project_root(project_root)

    with pytest.raises(PermissionError, match="internal runtime"):
        tool("read_text", ".agent-workflow/secure/secret.txt")


def test_file_io_rejects_nested_internal_paths(tmp_path: Path) -> None:
    project_root = _initialized_project_root(tmp_path)
    nested_git_dir = project_root / "vendor" / ".git"
    nested_git_dir.mkdir(parents=True)
    (nested_git_dir / "config").write_text("secret", encoding="utf-8")
    tool = file_io_for_project_root(project_root)

    with pytest.raises(PermissionError, match="internal runtime"):
        tool("read_text", "vendor/.git/config")
    with pytest.raises(PermissionError, match="internal runtime"):
        tool("read_text", "vendor/.git/missing")


def test_file_io_requires_initialized_project_root(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="initialized CW project root"):
        file_io_for_project_root(tmp_path)


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
