"""Adapter-owned builtin tool functions.

These functions are intentionally small and dependency-free. They are exposed
to SDK toolsets only when a NodeContract requests the matching builtin tool id.
"""

from __future__ import annotations

import ast
import http.client
import ipaddress
import json
import socket
import ssl
import urllib.parse
from collections.abc import Callable, Mapping, Sequence
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
_PYTHON_SANDBOX_ACTIONS: Final = frozenset({"eval_expr"})
_PYTHON_SANDBOX_MAX_EXPRESSION_CHARS: Final = 4096
_PYTHON_SANDBOX_DEFAULT_MAX_STEPS: Final = 1000
_PYTHON_SANDBOX_ABSOLUTE_MAX_STEPS: Final = 10000
_PYTHON_SANDBOX_DEFAULT_MAX_RESULT_CHARS: Final = 4096
_PYTHON_SANDBOX_ABSOLUTE_MAX_RESULT_CHARS: Final = 16 * 1024
_PYTHON_SANDBOX_MAX_CONTAINER_ITEMS: Final = 1000
_PYTHON_SANDBOX_MAX_DEPTH: Final = 6
_PYTHON_SANDBOX_MAX_INT_BITS: Final = 4096
_PYTHON_SANDBOX_FUNCTION_NAMES: Final = frozenset(
    {
        "abs",
        "all",
        "any",
        "bool",
        "float",
        "int",
        "len",
        "list",
        "max",
        "min",
        "range",
        "round",
        "sorted",
        "str",
        "sum",
        "tuple",
    }
)


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

    functions: dict[str, BuiltinToolFunc] = {"python_sandbox": python_sandbox, "web_fetch": web_fetch}
    if project_root is not None:
        functions["file_io"] = file_io_for_project_root(project_root)
    return functions


def default_builtin_tool_names() -> tuple[str, ...]:
    """Return stable builtin tool ids implemented by this module."""

    return tuple(sorted({"file_io", *default_builtin_tool_functions()}))


def python_sandbox(
    action: str,
    expression: str,
    variables: Mapping[str, Any] | None = None,
    max_steps: int = _PYTHON_SANDBOX_DEFAULT_MAX_STEPS,
    max_result_chars: int = _PYTHON_SANDBOX_DEFAULT_MAX_RESULT_CHARS,
) -> dict[str, Any]:
    """Evaluate a bounded, expression-only Python subset without eval/exec."""

    if action not in _PYTHON_SANDBOX_ACTIONS:
        raise ValueError("python_sandbox action must be eval_expr.")
    if len(expression) > _PYTHON_SANDBOX_MAX_EXPRESSION_CHARS:
        raise ValueError("python_sandbox expression is too large.")
    try:
        parsed = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise ValueError("python_sandbox expression must be a valid Python expression.") from exc
    budget = _PythonSandboxStepBudget(_normalized_python_sandbox_max_steps(max_steps))
    evaluator = _PythonSandboxEvaluator(_sanitize_python_sandbox_variables(variables), budget)
    result = evaluator.evaluate(parsed)
    jsonable_result = _sanitize_python_sandbox_value(result, depth=0)
    encoded_result = json.dumps(jsonable_result, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    result_limit = _normalized_python_sandbox_max_result_chars(max_result_chars)
    if len(encoded_result) > result_limit:
        raise ValueError("python_sandbox result is too large.")
    return {
        "action": "eval_expr",
        "result": jsonable_result,
        "result_type": _python_sandbox_type_name(jsonable_result),
        "steps": budget.used,
        "result_chars": len(encoded_result),
    }


class _PythonSandboxStepBudget:
    def __init__(self, limit: int) -> None:
        self._limit = limit
        self.used = 0

    def tick(self) -> None:
        self.used += 1
        if self.used > self._limit:
            raise TimeoutError("python_sandbox step limit exceeded.")


class _PythonSandboxEvaluator:
    def __init__(self, variables: Mapping[str, Any], budget: _PythonSandboxStepBudget) -> None:
        self._variables = variables
        self._budget = budget

    def evaluate(self, node: ast.AST) -> Any:
        self._budget.tick()
        if isinstance(node, ast.Expression):
            return self.evaluate(node.body)
        if isinstance(node, ast.Constant):
            return _sanitize_python_sandbox_value(node.value, depth=0)
        if isinstance(node, ast.List):
            return _sanitize_python_sandbox_sequence([self.evaluate(item) for item in node.elts])
        if isinstance(node, ast.Tuple):
            return _sanitize_python_sandbox_sequence([self.evaluate(item) for item in node.elts])
        if isinstance(node, ast.Dict):
            if any(key is None for key in node.keys):
                raise ValueError("python_sandbox does not allow dict unpacking.")
            items: dict[Any, Any] = {}
            for key, value in zip(node.keys, node.values, strict=True):
                if key is None:
                    raise ValueError("python_sandbox does not allow dict unpacking.")
                items[self.evaluate(key)] = self.evaluate(value)
            return _sanitize_python_sandbox_dict(items)
        if isinstance(node, ast.Name):
            return self._evaluate_name(node)
        if isinstance(node, ast.UnaryOp):
            return self._evaluate_unary(node)
        if isinstance(node, ast.BinOp):
            return self._evaluate_binary(node)
        if isinstance(node, ast.BoolOp):
            return self._evaluate_bool(node)
        if isinstance(node, ast.Compare):
            return self._evaluate_compare(node)
        if isinstance(node, ast.IfExp):
            return self.evaluate(node.body if self.evaluate(node.test) else node.orelse)
        if isinstance(node, ast.Subscript):
            return self._evaluate_subscript(node)
        if isinstance(node, ast.Slice):
            return self._evaluate_slice(node)
        if isinstance(node, ast.Call):
            return self._evaluate_call(node)
        raise ValueError(f"python_sandbox does not allow {type(node).__name__} expressions.")

    def _evaluate_name(self, node: ast.Name) -> Any:
        try:
            return self._variables[node.id]
        except KeyError as exc:
            raise ValueError(f"python_sandbox unknown name: {node.id}") from exc

    def _evaluate_unary(self, node: ast.UnaryOp) -> Any:
        value = self.evaluate(node.operand)
        if isinstance(node.op, ast.UAdd):
            result = +_python_sandbox_number(value)
        elif isinstance(node.op, ast.USub):
            result = -_python_sandbox_number(value)
        elif isinstance(node.op, ast.Not):
            result = not bool(value)
        else:
            raise ValueError(f"python_sandbox does not allow {type(node.op).__name__}.")
        return _sanitize_python_sandbox_value(result, depth=0)

    def _evaluate_binary(self, node: ast.BinOp) -> Any:
        left = self.evaluate(node.left)
        right = self.evaluate(node.right)
        op = node.op
        if isinstance(op, ast.Add):
            result = left + right
        elif isinstance(op, ast.Sub):
            result = _python_sandbox_number(left) - _python_sandbox_number(right)
        elif isinstance(op, ast.Mult):
            _validate_python_sandbox_repeat(left, right)
            result = left * right
        elif isinstance(op, ast.Div):
            result = _python_sandbox_number(left) / _python_sandbox_number(right)
        elif isinstance(op, ast.FloorDiv):
            result = _python_sandbox_number(left) // _python_sandbox_number(right)
        elif isinstance(op, ast.Mod):
            result = _python_sandbox_number(left) % _python_sandbox_number(right)
        elif isinstance(op, ast.Pow):
            result = _python_sandbox_pow(left, right)
        else:
            raise ValueError(f"python_sandbox does not allow {type(op).__name__}.")
        return _sanitize_python_sandbox_value(result, depth=0)

    def _evaluate_bool(self, node: ast.BoolOp) -> bool:
        if isinstance(node.op, ast.And):
            return all(bool(self.evaluate(value)) for value in node.values)
        if isinstance(node.op, ast.Or):
            return any(bool(self.evaluate(value)) for value in node.values)
        raise ValueError(f"python_sandbox does not allow {type(node.op).__name__}.")

    def _evaluate_compare(self, node: ast.Compare) -> bool:
        left = self.evaluate(node.left)
        for op, comparator in zip(node.ops, node.comparators, strict=True):
            right = self.evaluate(comparator)
            if not _python_sandbox_compare(left, op, right):
                return False
            left = right
        return True

    def _evaluate_subscript(self, node: ast.Subscript) -> Any:
        target = self.evaluate(node.value)
        key = self.evaluate(node.slice)
        if not isinstance(target, str | list | dict):
            raise ValueError("python_sandbox subscript target must be str, list, or dict.")
        result = target[key]
        return _sanitize_python_sandbox_value(result, depth=0)

    def _evaluate_slice(self, node: ast.Slice) -> slice:
        lower = None if node.lower is None else _python_sandbox_optional_int(self.evaluate(node.lower))
        upper = None if node.upper is None else _python_sandbox_optional_int(self.evaluate(node.upper))
        step = None if node.step is None else _python_sandbox_optional_int(self.evaluate(node.step))
        return slice(lower, upper, step)

    def _evaluate_call(self, node: ast.Call) -> Any:
        if not isinstance(node.func, ast.Name):
            raise ValueError("python_sandbox only allows direct calls to approved functions.")
        if node.keywords:
            raise ValueError("python_sandbox function calls do not allow keyword arguments.")
        function_name = node.func.id
        if function_name not in _PYTHON_SANDBOX_FUNCTION_NAMES:
            raise ValueError(f"python_sandbox does not allow function: {function_name}")
        args = [self.evaluate(arg) for arg in node.args]
        return _sanitize_python_sandbox_value(_call_python_sandbox_function(function_name, args), depth=0)


def _sanitize_python_sandbox_variables(variables: Mapping[str, Any] | None) -> dict[str, Any]:
    if variables is None:
        return {}
    sanitized: dict[str, Any] = {}
    for name, value in variables.items():
        if not name.isidentifier() or name.startswith("_") or name in _PYTHON_SANDBOX_FUNCTION_NAMES:
            raise ValueError("python_sandbox variable names must be safe identifiers.")
        sanitized[name] = _sanitize_python_sandbox_value(value, depth=0)
    return sanitized


def _sanitize_python_sandbox_value(value: Any, *, depth: int) -> Any:
    if depth > _PYTHON_SANDBOX_MAX_DEPTH:
        raise ValueError("python_sandbox value nesting is too deep.")
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        if value.bit_length() > _PYTHON_SANDBOX_MAX_INT_BITS:
            raise ValueError("python_sandbox integer is too large.")
        return value
    if isinstance(value, float):
        if value != value or value in {float("inf"), float("-inf")}:
            raise ValueError("python_sandbox float must be finite.")
        return value
    if isinstance(value, str):
        if len(value) > _PYTHON_SANDBOX_ABSOLUTE_MAX_RESULT_CHARS:
            raise ValueError("python_sandbox string is too large.")
        return value
    if isinstance(value, list | tuple):
        if len(value) > _PYTHON_SANDBOX_MAX_CONTAINER_ITEMS:
            raise ValueError("python_sandbox sequence is too large.")
        return [_sanitize_python_sandbox_value(item, depth=depth + 1) for item in value]
    if isinstance(value, dict):
        return _sanitize_python_sandbox_dict(value, depth=depth)
    raise ValueError(f"python_sandbox value type is not allowed: {type(value).__name__}")


def _sanitize_python_sandbox_sequence(value: Sequence[Any]) -> list[Any]:
    if len(value) > _PYTHON_SANDBOX_MAX_CONTAINER_ITEMS:
        raise ValueError("python_sandbox sequence is too large.")
    return [_sanitize_python_sandbox_value(item, depth=1) for item in value]


def _sanitize_python_sandbox_dict(value: Mapping[Any, Any], *, depth: int = 0) -> dict[str, Any]:
    if len(value) > _PYTHON_SANDBOX_MAX_CONTAINER_ITEMS:
        raise ValueError("python_sandbox dict is too large.")
    sanitized: dict[str, Any] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise ValueError("python_sandbox dict keys must be strings.")
        sanitized[key] = _sanitize_python_sandbox_value(item, depth=depth + 1)
    return sanitized


def _call_python_sandbox_function(name: str, args: Sequence[Any]) -> Any:
    if name == "abs":
        return abs(_python_sandbox_single_number(name, args))
    if name == "all":
        return all(_python_sandbox_single_sequence(name, args))
    if name == "any":
        return any(_python_sandbox_single_sequence(name, args))
    if name == "bool":
        return bool(_python_sandbox_single_arg(name, args))
    if name == "float":
        return float(_python_sandbox_single_number(name, args))
    if name == "int":
        return int(_python_sandbox_single_number(name, args))
    if name == "len":
        return len(_python_sandbox_single_collection(name, args))
    if name == "list":
        return list(_python_sandbox_single_sequence(name, args))
    if name == "max":
        return max(_python_sandbox_variadic_or_sequence(name, args))
    if name == "min":
        return min(_python_sandbox_variadic_or_sequence(name, args))
    if name == "range":
        return _python_sandbox_range(args)
    if name == "round":
        return _python_sandbox_round(args)
    if name == "sorted":
        return sorted(_python_sandbox_single_sequence(name, args))
    if name == "str":
        return str(_python_sandbox_single_arg(name, args))
    if name == "sum":
        return sum(_python_sandbox_numbers(_python_sandbox_single_sequence(name, args)))
    if name == "tuple":
        return list(_python_sandbox_single_sequence(name, args))
    raise ValueError(f"python_sandbox does not allow function: {name}")


def _python_sandbox_single_arg(name: str, args: Sequence[Any]) -> Any:
    if len(args) != 1:
        raise ValueError(f"python_sandbox {name} expects one argument.")
    return args[0]


def _python_sandbox_single_number(name: str, args: Sequence[Any]) -> int | float:
    return _python_sandbox_number(_python_sandbox_single_arg(name, args))


def _python_sandbox_single_collection(name: str, args: Sequence[Any]) -> str | list[Any] | dict[str, Any]:
    value = _python_sandbox_single_arg(name, args)
    if not isinstance(value, str | list | dict):
        raise ValueError(f"python_sandbox {name} expects a collection.")
    return value


def _python_sandbox_single_sequence(name: str, args: Sequence[Any]) -> list[Any] | str:
    value = _python_sandbox_single_arg(name, args)
    if not isinstance(value, str | list):
        raise ValueError(f"python_sandbox {name} expects a sequence.")
    return value


def _python_sandbox_variadic_or_sequence(name: str, args: Sequence[Any]) -> Sequence[Any]:
    if not args:
        raise ValueError(f"python_sandbox {name} expects at least one argument.")
    if len(args) == 1 and isinstance(args[0], str | list):
        return args[0]
    return args


def _python_sandbox_numbers(values: Sequence[Any]) -> list[int | float]:
    return [_python_sandbox_number(value) for value in values]


def _python_sandbox_number(value: Any) -> int | float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError("python_sandbox value must be a number.")
    return value


def _python_sandbox_optional_int(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("python_sandbox slice values must be integers.")
    return value


def _python_sandbox_range(args: Sequence[Any]) -> list[int]:
    if not 1 <= len(args) <= 3:
        raise ValueError("python_sandbox range expects one to three integer arguments.")
    int_args = [_python_sandbox_optional_int(arg) for arg in args]
    value = range(*int_args)
    if len(value) > _PYTHON_SANDBOX_MAX_CONTAINER_ITEMS:
        raise ValueError("python_sandbox range is too large.")
    return list(value)


def _python_sandbox_round(args: Sequence[Any]) -> int | float:
    if len(args) not in {1, 2}:
        raise ValueError("python_sandbox round expects one or two arguments.")
    number = _python_sandbox_number(args[0])
    if len(args) == 1:
        return round(number)
    digits = _python_sandbox_optional_int(args[1])
    return round(number, digits)


def _python_sandbox_pow(left: Any, right: Any) -> int | float:
    base = _python_sandbox_number(left)
    exponent = _python_sandbox_number(right)
    if abs(exponent) > 12:
        raise ValueError("python_sandbox exponent is too large.")
    return base**exponent


def _validate_python_sandbox_repeat(left: Any, right: Any) -> None:
    if isinstance(left, bool) or isinstance(right, bool):
        return
    if isinstance(left, str | list) and isinstance(right, int):
        _validate_python_sandbox_repeat_size(len(left), right)
    if isinstance(right, str | list) and isinstance(left, int):
        _validate_python_sandbox_repeat_size(len(right), left)


def _validate_python_sandbox_repeat_size(item_count: int, multiplier: int) -> None:
    if item_count * abs(multiplier) > _PYTHON_SANDBOX_MAX_CONTAINER_ITEMS:
        raise ValueError("python_sandbox repeated value would be too large.")


def _python_sandbox_compare(left: Any, op: ast.cmpop, right: Any) -> bool:
    if isinstance(op, ast.Eq):
        return bool(left == right)
    if isinstance(op, ast.NotEq):
        return bool(left != right)
    if isinstance(op, ast.Lt):
        return bool(left < right)
    if isinstance(op, ast.LtE):
        return bool(left <= right)
    if isinstance(op, ast.Gt):
        return bool(left > right)
    if isinstance(op, ast.GtE):
        return bool(left >= right)
    if isinstance(op, ast.In):
        return left in _python_sandbox_membership_target(right)
    if isinstance(op, ast.NotIn):
        return left not in _python_sandbox_membership_target(right)
    if isinstance(op, ast.Is):
        return left is right
    if isinstance(op, ast.IsNot):
        return left is not right
    raise ValueError(f"python_sandbox does not allow {type(op).__name__}.")


def _python_sandbox_membership_target(value: Any) -> str | list[Any] | dict[str, Any]:
    if not isinstance(value, str | list | dict):
        raise ValueError("python_sandbox membership target must be str, list, or dict.")
    return value


def _python_sandbox_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "dict"
    return type(value).__name__


def _normalized_python_sandbox_max_steps(max_steps: int) -> int:
    if max_steps < 1:
        raise ValueError("python_sandbox max_steps must be >= 1.")
    return min(max_steps, _PYTHON_SANDBOX_ABSOLUTE_MAX_STEPS)


def _normalized_python_sandbox_max_result_chars(max_result_chars: int) -> int:
    if max_result_chars < 1:
        raise ValueError("python_sandbox max_result_chars must be >= 1.")
    return min(max_result_chars, _PYTHON_SANDBOX_ABSOLUTE_MAX_RESULT_CHARS)


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
    "python_sandbox",
    "web_fetch",
]
