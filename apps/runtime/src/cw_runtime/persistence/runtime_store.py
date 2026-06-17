"""Derived SQLite indexes, trace exporter tables, and git snapshots.

The JSON/JSONL files under ``.agent-workflow`` remain authoritative. This
module maintains rebuildable indexes and local observability projections for
the W1.3.7 runtime foundation.
"""

from __future__ import annotations

import json
import os
import platform
import secrets
import sqlite3
import subprocess
import time
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Final, Literal, cast

from pydantic import BaseModel, ConfigDict

from cw_runtime import __version__
from cw_runtime.settings import RUNTIME_SCHEMA_VERSION
from cw_schemas.events import StreamEventBase
from cw_schemas.types import EventCategory, Sensitivity

AGENT_WORKFLOW_DIR: Final = ".agent-workflow"
RUNTIME_INDEX_RELATIVE_PATH: Final = Path(AGENT_WORKFLOW_DIR) / "cache" / "runtime_index.sqlite"
TRACE_SQLITE_RELATIVE_PATH: Final = Path(AGENT_WORKFLOW_DIR) / "traces" / "trace.sqlite"
SNAPSHOTS_JSONL_RELATIVE_PATH: Final = Path(AGENT_WORKFLOW_DIR) / "snapshots" / "snapshots.jsonl"

_ATTRIBUTE_LIMIT_BYTES: Final = 64 * 1024
_SPAN_KIND_INTERNAL: Final = 1
_SPAN_KIND_CLIENT: Final = 3
_SPAN_STATUS_OK: Final = 1
_SPAN_STATUS_ERROR: Final = 2
_GIT_SNAPSHOT_EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {
        "run.started",
        "attempt.completed",
        "run.completed",
        "run.failed",
        "run.cancelled",
    }
)


class PersistenceError(RuntimeError):
    """Raised when derived persistence or observability writes fail."""

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


class GitSnapshotResult(BaseModel):
    """Result of one runtime git snapshot hook."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"] = RUNTIME_SCHEMA_VERSION
    snapshot_id: str
    kind: str
    commit_sha: str
    git_tag: str | None = None


def ensure_runtime_databases(project_root: Path) -> None:
    """Create the runtime index and trace exporter SQLite files if needed."""

    _ensure_runtime_index(project_root)
    _ensure_trace_sqlite(project_root)


def index_run_manifest(project_root: Path, run_payload: Mapping[str, object]) -> None:
    """Upsert a ``run.json`` projection into the derived runtime index."""

    ensure_runtime_databases(project_root)
    run_id = _required_string(run_payload, "run_id")
    with _connect_index(project_root) as conn:
        conn.execute(
            """
            INSERT INTO runtime_runs (
                run_id,
                workflow_id,
                workflow_version,
                state,
                mode,
                started_at,
                completed_at,
                failed_at,
                cancelled_at,
                last_event_id,
                current_node_ids_json,
                git_snapshots_json,
                run_json_path,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET
                workflow_id = excluded.workflow_id,
                workflow_version = excluded.workflow_version,
                state = excluded.state,
                mode = excluded.mode,
                started_at = excluded.started_at,
                completed_at = excluded.completed_at,
                failed_at = excluded.failed_at,
                cancelled_at = excluded.cancelled_at,
                last_event_id = excluded.last_event_id,
                current_node_ids_json = excluded.current_node_ids_json,
                git_snapshots_json = excluded.git_snapshots_json,
                run_json_path = excluded.run_json_path,
                updated_at = excluded.updated_at
            """,
            (
                run_id,
                _optional_string(run_payload, "workflow_id"),
                _optional_string(run_payload, "workflow_version"),
                _optional_string(run_payload, "state"),
                _optional_string(run_payload, "mode"),
                _optional_string(run_payload, "started_at"),
                _optional_string(run_payload, "completed_at"),
                _optional_string(run_payload, "failed_at"),
                _optional_string(run_payload, "cancelled_at"),
                _optional_string(run_payload, "last_event_id"),
                _json_value(run_payload.get("current_node_ids", [])),
                _json_value(run_payload.get("git_snapshots", [])),
                f"{AGENT_WORKFLOW_DIR}/runs/{run_id}/run.json",
                _unix_ms_now(),
            ),
        )


def index_stream_event(project_root: Path, event: StreamEventBase) -> None:
    """Index one public StreamEvent and project it to ``trace.sqlite``."""

    ensure_runtime_databases(project_root)
    if event.sensitivity == Sensitivity.SENSITIVE:
        return
    with _connect_index(project_root) as conn:
        conn.execute(
            """
            INSERT INTO runtime_stream_events (
                event_id,
                run_id,
                seq,
                type,
                category,
                phase,
                node_id,
                attempt_id,
                created_at,
                jsonl_path,
                payload_json,
                indexed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(event_id) DO UPDATE SET
                run_id = excluded.run_id,
                seq = excluded.seq,
                type = excluded.type,
                category = excluded.category,
                phase = excluded.phase,
                node_id = excluded.node_id,
                attempt_id = excluded.attempt_id,
                created_at = excluded.created_at,
                jsonl_path = excluded.jsonl_path,
                payload_json = excluded.payload_json,
                indexed_at = excluded.indexed_at
            """,
            (
                event.event_id,
                event.run_id,
                event.seq,
                event.type,
                event.category.value,
                None if event.phase is None else event.phase.value,
                event.node_id,
                event.attempt_id,
                event.created_at,
                _stream_event_relative_path(event),
                _json_value(event.payload),
                _unix_ms_now(),
            ),
        )
    _export_stream_event_span(project_root, event)


def index_run_jsonl_append(project_root: Path, run_id: str, filename: str, payload: object) -> None:
    """Index the line appended to a run JSONL file."""

    ensure_runtime_databases(project_root)
    line_number = _jsonl_line_count(project_root / AGENT_WORKFLOW_DIR / "runs" / run_id / filename)
    record = _as_string_key_mapping(payload)
    with _connect_index(project_root) as conn:
        conn.execute(
            """
            INSERT INTO runtime_jsonl_records (
                run_id,
                filename,
                line_number,
                object_id,
                node_id,
                attempt_id,
                record_json,
                indexed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id, filename, line_number) DO UPDATE SET
                object_id = excluded.object_id,
                node_id = excluded.node_id,
                attempt_id = excluded.attempt_id,
                record_json = excluded.record_json,
                indexed_at = excluded.indexed_at
            """,
            (
                run_id,
                filename,
                line_number,
                _record_object_id(filename, record),
                _mapping_string(record, "node_id"),
                _mapping_string(record, "attempt_id"),
                _json_value(payload),
                _unix_ms_now(),
            ),
        )


def should_snapshot_event(event: StreamEventBase) -> bool:
    """Return whether the event is a runtime git snapshot trigger."""

    return event.type in _GIT_SNAPSHOT_EVENT_TYPES


def create_git_snapshot_locked(
    project_root: Path,
    *,
    run_id: str,
    workflow_id: str,
    workflow_version: str,
    run_state: str,
    event: StreamEventBase,
    snapshot_id: str,
    created_at: str,
) -> GitSnapshotResult | None:
    """Create an automatic git snapshot for a run event.

    The caller must already hold ``runtime.lock`` and must write any metadata
    that should be included in the commit before calling this function.
    """

    plan = _snapshot_plan(
        run_id=run_id,
        workflow_id=workflow_id,
        workflow_version=workflow_version,
        run_state=run_state,
        event=event,
    )
    if plan is None:
        return None

    paths = _existing_snapshot_paths(project_root, run_id)
    if not paths:
        return None
    _git_add_paths(project_root, paths)
    commit_result = _run_git(
        project_root,
        [*_git_identity_args(project_root), "commit", "--only", "-m", plan.message, "--", *paths],
        check=False,
    )
    if commit_result.returncode != 0:
        combined = f"{commit_result.stdout}\n{commit_result.stderr}".lower()
        if "nothing to commit" in combined or "no changes added" in combined:
            return None
        raise PersistenceError(
            "RH_GIT_AUTOCOMMIT_BLOCKED",
            "Runtime git snapshot commit failed.",
            details={"stderr": commit_result.stderr.strip(), "stdout": commit_result.stdout.strip()},
        )

    head = _run_git(project_root, ["rev-parse", "HEAD"], error_code="RH_INIT_GIT_FAILED").stdout.strip()
    git_tag = _create_snapshot_tag(project_root, plan.git_tag, head)
    result = GitSnapshotResult(snapshot_id=snapshot_id, kind=plan.kind, commit_sha=head, git_tag=git_tag)
    _append_snapshot_record(
        project_root,
        {
            "schema_version": RUNTIME_SCHEMA_VERSION,
            "snapshot_id": snapshot_id,
            "kind": plan.kind,
            "run_id": run_id,
            "workflow_id": workflow_id,
            "workflow_version": workflow_version,
            "event_type": event.type,
            "node_id": event.node_id,
            "attempt_id": event.attempt_id,
            "commit_sha": head,
            "git_tag": git_tag,
            "message": plan.message,
            "refs": plan.refs,
            "created_at": created_at,
        },
    )
    _export_git_snapshot_span(project_root, result, event, run_id=run_id, created_at=created_at)
    return result


def record_initial_git_snapshot(
    project_root: Path, *, project_id: str, commit_sha: str | None, created_at: str
) -> None:
    """Record the initial project commit in ``snapshots/snapshots.jsonl``."""

    if commit_sha is None:
        return
    snapshot_id = _new_ulid()
    _append_snapshot_record(
        project_root,
        {
            "schema_version": RUNTIME_SCHEMA_VERSION,
            "snapshot_id": snapshot_id,
            "kind": "project.initialized",
            "run_id": None,
            "workflow_id": None,
            "workflow_version": None,
            "event_type": None,
            "node_id": None,
            "attempt_id": None,
            "commit_sha": commit_sha,
            "git_tag": None,
            "message": f"chore(cw): initialize CognitiveWorkflow project {project_id}",
            "refs": {"project_id": project_id},
            "created_at": created_at,
        },
    )


class _SnapshotPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    message: str
    git_tag: str | None
    refs: dict[str, object]


def _ensure_runtime_index(project_root: Path) -> None:
    path = project_root.resolve() / RUNTIME_INDEX_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS runtime_runs (
                run_id TEXT PRIMARY KEY,
                workflow_id TEXT,
                workflow_version TEXT,
                state TEXT,
                mode TEXT,
                started_at TEXT,
                completed_at TEXT,
                failed_at TEXT,
                cancelled_at TEXT,
                last_event_id TEXT,
                current_node_ids_json TEXT NOT NULL,
                git_snapshots_json TEXT NOT NULL,
                run_json_path TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_runtime_runs_workflow ON runtime_runs(workflow_id);
            CREATE INDEX IF NOT EXISTS idx_runtime_runs_state ON runtime_runs(state);

            CREATE TABLE IF NOT EXISTS runtime_stream_events (
                event_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                type TEXT NOT NULL,
                category TEXT NOT NULL,
                phase TEXT,
                node_id TEXT,
                attempt_id TEXT,
                created_at TEXT NOT NULL,
                jsonl_path TEXT NOT NULL,
                payload_json TEXT,
                indexed_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_stream_run_seq
                ON runtime_stream_events(run_id, seq);
            CREATE INDEX IF NOT EXISTS idx_runtime_stream_type
                ON runtime_stream_events(type);
            CREATE INDEX IF NOT EXISTS idx_runtime_stream_attempt
                ON runtime_stream_events(attempt_id);

            CREATE TABLE IF NOT EXISTS runtime_jsonl_records (
                record_id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                object_id TEXT,
                node_id TEXT,
                attempt_id TEXT,
                record_json TEXT NOT NULL,
                indexed_at INTEGER NOT NULL,
                UNIQUE(run_id, filename, line_number)
            );
            CREATE INDEX IF NOT EXISTS idx_runtime_jsonl_object
                ON runtime_jsonl_records(filename, object_id);
            CREATE INDEX IF NOT EXISTS idx_runtime_jsonl_attempt
                ON runtime_jsonl_records(attempt_id);
            """
        )


def _ensure_trace_sqlite(project_root: Path) -> None:
    path = project_root.resolve() / TRACE_SQLITE_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS spans (
                span_id          BLOB PRIMARY KEY,
                trace_id         BLOB NOT NULL,
                parent_span_id   BLOB,
                name             TEXT NOT NULL,
                kind             INTEGER NOT NULL,
                start_unix_nano  INTEGER NOT NULL,
                end_unix_nano    INTEGER,
                status_code      INTEGER NOT NULL DEFAULT 0,
                status_message   TEXT,
                component        TEXT NOT NULL,
                run_id           TEXT,
                node_id          TEXT,
                attempt_id       TEXT,
                sensitivity      TEXT NOT NULL DEFAULT 'public',
                attributes_json  TEXT NOT NULL,
                events_json      TEXT NOT NULL DEFAULT '[]',
                links_json       TEXT NOT NULL DEFAULT '[]',
                resource_id      INTEGER NOT NULL,
                inserted_at      INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
            CREATE INDEX IF NOT EXISTS idx_spans_run   ON spans(run_id);
            CREATE INDEX IF NOT EXISTS idx_spans_attempt ON spans(attempt_id);
            CREATE INDEX IF NOT EXISTS idx_spans_name  ON spans(name);
            CREATE INDEX IF NOT EXISTS idx_spans_time  ON spans(start_unix_nano);

            CREATE TABLE IF NOT EXISTS resources (
                resource_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                resource_hash BLOB UNIQUE NOT NULL,
                attributes_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS metrics (
                metric_id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name             TEXT NOT NULL,
                kind             TEXT NOT NULL,
                timestamp        INTEGER NOT NULL,
                value_double     REAL,
                value_int        INTEGER,
                histogram_buckets_json TEXT,
                attributes_json  TEXT NOT NULL,
                resource_id      INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_metrics_name_ts ON metrics(name, timestamp DESC);
            """
        )


def _connect_index(project_root: Path) -> sqlite3.Connection:
    return _connect(project_root.resolve() / RUNTIME_INDEX_RELATIVE_PATH)


def _connect_trace(project_root: Path) -> sqlite3.Connection:
    return _connect(project_root.resolve() / TRACE_SQLITE_RELATIVE_PATH)


def _connect(path: Path) -> sqlite3.Connection:
    try:
        conn = sqlite3.connect(path, timeout=5.0)
    except sqlite3.OperationalError as exc:
        raise PersistenceError(
            "OB_EXPORT_SQLITE_BUSY",
            "Timed out opening a runtime SQLite database.",
            details={"path": path.as_posix()},
        ) from exc
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _export_stream_event_span(project_root: Path, event: StreamEventBase) -> None:
    if event.sensitivity == Sensitivity.SENSITIVE:
        raise PersistenceError(
            "OB_SECURE_LEAK_BLOCKED",
            "Sensitive StreamEvent cannot be exported to plain trace.sqlite.",
            details={"run_id": event.run_id, "event_type": event.type},
        )
    resource_id = _ensure_resource(project_root)
    attrs = _stream_event_attributes(event)
    attrs_json = _attributes_json(attrs)
    if _event_projects_to_metrics(event):
        with _connect_trace(project_root) as conn:
            _export_metric_values(conn, resource_id=resource_id, event=event, attributes_json=attrs_json)
        return
    if not _event_projects_to_span(event):
        return

    timestamp_ms = _unix_ms_from_iso(event.created_at)
    timestamp_nano = timestamp_ms * 1_000_000
    events_json = _json_value(
        [
            {
                "name": event.type,
                "time_unix_nano": timestamp_nano,
                "attributes": {
                    "cw.event.type": event.type,
                    "cw.event.category": event.category.value,
                    "cw.event.display_level": event.display_level.value,
                },
            }
        ]
    )
    with _connect_trace(project_root) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO spans (
                span_id,
                trace_id,
                parent_span_id,
                name,
                kind,
                start_unix_nano,
                end_unix_nano,
                status_code,
                status_message,
                component,
                run_id,
                node_id,
                attempt_id,
                sensitivity,
                attributes_json,
                events_json,
                links_json,
                resource_id,
                inserted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                _digest16(event.event_id),
                _trace_id_bytes(event),
                None,
                _span_name_for_event(event),
                _span_kind_for_event(event),
                timestamp_nano,
                timestamp_nano,
                _status_code_for_event(event),
                None,
                _component_for_event(event),
                event.run_id,
                event.node_id,
                event.attempt_id,
                event.sensitivity.value,
                attrs_json,
                events_json,
                "[]",
                resource_id,
                _unix_ms_now(),
            ),
        )


def _export_git_snapshot_span(
    project_root: Path,
    snapshot: GitSnapshotResult,
    event: StreamEventBase,
    *,
    run_id: str,
    created_at: str,
) -> None:
    resource_id = _ensure_resource(project_root)
    attrs = {
        "cw.run.id": run_id,
        "cw.git.kind": snapshot.kind,
        "cw.git.commit_sha": snapshot.commit_sha,
        "cw.git.message_prefix": _message_prefix_for_event(event),
    }
    if snapshot.git_tag is not None:
        attrs["cw.git.tag"] = snapshot.git_tag
        attrs["cw.git.refers_to"] = snapshot.commit_sha
    timestamp_ms = _unix_ms_from_iso(created_at)
    timestamp_nano = timestamp_ms * 1_000_000
    with _connect_trace(project_root) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO spans (
                span_id,
                trace_id,
                parent_span_id,
                name,
                kind,
                start_unix_nano,
                end_unix_nano,
                status_code,
                status_message,
                component,
                run_id,
                node_id,
                attempt_id,
                sensitivity,
                attributes_json,
                events_json,
                links_json,
                resource_id,
                inserted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                _digest16(snapshot.snapshot_id),
                _trace_id_bytes(event),
                None,
                "cw.runtime.git_commit",
                _SPAN_KIND_INTERNAL,
                timestamp_nano,
                timestamp_nano,
                _SPAN_STATUS_OK,
                None,
                "runtime",
                run_id,
                event.node_id,
                event.attempt_id,
                "public",
                _attributes_json(attrs),
                "[]",
                "[]",
                resource_id,
                _unix_ms_now(),
            ),
        )


def _export_metric_values(
    conn: sqlite3.Connection,
    *,
    resource_id: int,
    event: StreamEventBase,
    attributes_json: str,
) -> None:
    if event.category != EventCategory.METRIC:
        return
    metrics_obj = getattr(event, "metrics", None)
    if not isinstance(metrics_obj, dict):
        return
    timestamp = _unix_ms_from_iso(event.created_at)
    for name, value in metrics_obj.items():
        if not isinstance(name, str) or isinstance(value, bool):
            continue
        value_double: float | None = None
        value_int: int | None = None
        if isinstance(value, int):
            value_int = value
        elif isinstance(value, float):
            value_double = value
        else:
            continue
        conn.execute(
            """
            INSERT INTO metrics (
                name,
                kind,
                timestamp,
                value_double,
                value_int,
                histogram_buckets_json,
                attributes_json,
                resource_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, "gauge", timestamp, value_double, value_int, None, attributes_json, resource_id),
        )


def _ensure_resource(project_root: Path) -> int:
    attributes = _resource_attributes(project_root)
    attributes_json = _json_value(attributes)
    resource_hash = _blake3_digest(attributes_json.encode("utf-8"))
    with _connect_trace(project_root) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO resources (resource_hash, attributes_json) VALUES (?, ?)",
            (resource_hash, attributes_json),
        )
        row = conn.execute("SELECT resource_id FROM resources WHERE resource_hash = ?", (resource_hash,)).fetchone()
    if row is None:
        raise PersistenceError(
            "OB_EXPORT_SQLITE_BUSY",
            "Failed to read trace resource row after insert.",
            details={"path": (project_root / TRACE_SQLITE_RELATIVE_PATH).as_posix()},
        )
    return int(row[0])


def _resource_attributes(project_root: Path) -> dict[str, object]:
    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    project = _read_json_object(agent_root / "project.json")
    settings = _read_json_object(agent_root / "settings.json")
    return {
        "service.name": "cognitiveworkflow",
        "service.version": __version__,
        "service.instance.id": str(os.getpid()),
        "cw.component": "runtime",
        "cw.project.id": _string_or_unknown(project.get("project_id")),
        "cw.cw_version": __version__,
        "cw.runtime.os": _runtime_os(),
        "cw.deployment.mode": "dev",
        "cw.privacy.profile": _privacy_profile(settings),
    }


def _stream_event_attributes(event: StreamEventBase) -> dict[str, object]:
    attrs: dict[str, object] = {
        "cw.run.id": event.run_id,
        "cw.event.type": event.type,
        "cw.event.category": event.category.value,
        "cw.event.display_level": event.display_level.value,
    }
    if event.node_id is not None:
        attrs["cw.node.id"] = event.node_id
    if event.attempt_id is not None:
        attrs["cw.attempt.id"] = event.attempt_id
    payload = event.payload
    if isinstance(payload, dict):
        attempt_index = payload.get("attempt_index")
        if isinstance(attempt_index, int) and not isinstance(attempt_index, bool):
            attrs["cw.attempt.index"] = attempt_index
        workflow_id = payload.get("workflow_id")
        if isinstance(workflow_id, str):
            attrs["cw.workflow.id"] = workflow_id
        workflow_version = payload.get("workflow_version")
        if isinstance(workflow_version, str):
            attrs["cw.workflow.version"] = workflow_version
        mode = payload.get("mode")
        if isinstance(mode, str):
            attrs["cw.run.mode"] = mode
    return attrs


def _attributes_json(attrs: Mapping[str, object]) -> str:
    encoded = _json_value(attrs)
    if len(encoded.encode("utf-8")) <= _ATTRIBUTE_LIMIT_BYTES:
        return encoded
    compact = {
        key: value
        for key, value in attrs.items()
        if key in {"cw.run.id", "cw.event.type", "cw.event.category", "cw.event.display_level"}
    }
    return _json_value(compact)


def _snapshot_plan(
    *,
    run_id: str,
    workflow_id: str,
    workflow_version: str,
    run_state: str,
    event: StreamEventBase,
) -> _SnapshotPlan | None:
    if not should_snapshot_event(event):
        return None
    refs: dict[str, object] = {"run_id": run_id, "event_type": event.type}
    if event.type == "run.started":
        return _SnapshotPlan(
            kind="run.started",
            message=f"chore(run): start {run_id} on workflow {workflow_id} v{workflow_version}",
            git_tag=None,
            refs={**refs, "workflow_id": workflow_id, "workflow_version": workflow_version},
        )
    if event.type == "attempt.completed":
        attempt_index = _payload_int(event, "attempt_index")
        node_id = event.node_id or "unknown"
        refs = {
            **refs,
            "node_id": event.node_id,
            "attempt_id": event.attempt_id,
            "attempt_index": attempt_index,
        }
        return _SnapshotPlan(
            kind="attempt.completed",
            message=f"snapshot(run/{run_id}): node {node_id} attempt {attempt_index}",
            git_tag=None,
            refs=refs,
        )
    if event.type in {"run.completed", "run.failed", "run.cancelled"}:
        state = run_state
        return _SnapshotPlan(
            kind=event.type,
            message=f"chore(run): end {run_id} state={state}",
            git_tag=f"run-{run_id}-{state}",
            refs={**refs, "run_state": state},
        )
    return None


def _snapshot_commit_paths(*, project_root_run_id: str) -> list[str]:
    return [
        f"{AGENT_WORKFLOW_DIR}/runs/{project_root_run_id}",
        SNAPSHOTS_JSONL_RELATIVE_PATH.as_posix(),
    ]


def _git_add_paths(project_root: Path, paths: list[str]) -> None:
    _run_git(project_root, ["add", "--", *paths], error_code="RH_GIT_AUTOCOMMIT_BLOCKED")


def _existing_snapshot_paths(project_root: Path, run_id: str) -> list[str]:
    paths = _snapshot_commit_paths(project_root_run_id=run_id)
    existing: list[str] = []
    for relative_path in paths:
        if (project_root / relative_path).exists():
            existing.append(relative_path)
    return existing


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
    error_code: str = "RH_GIT_AUTOCOMMIT_BLOCKED",
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
        raise PersistenceError(
            error_code,
            "git command failed during runtime persistence.",
            details={"args": ["git", *args], "stderr": result.stderr.strip()},
        )
    return result


def _create_snapshot_tag(project_root: Path, tag_name: str | None, commit_sha: str) -> str | None:
    if tag_name is None:
        return None
    result = _run_git(project_root, ["tag", tag_name, commit_sha], check=False)
    if result.returncode == 0:
        return tag_name
    if "already exists" in result.stderr.lower():
        return tag_name
    raise PersistenceError(
        "RH_GIT_AUTOCOMMIT_BLOCKED",
        "Runtime git snapshot tag creation failed.",
        details={"tag": tag_name, "stderr": result.stderr.strip()},
    )


def _append_snapshot_record(project_root: Path, record: Mapping[str, object]) -> None:
    target = project_root.resolve() / SNAPSHOTS_JSONL_RELATIVE_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8", newline="\n") as file:
        file.write(_json_value(record) + "\n")


def _stream_event_relative_path(event: StreamEventBase) -> str:
    day = event.created_at[:10].replace("-", "")
    return f"{AGENT_WORKFLOW_DIR}/runs/{event.run_id}/stream-events/{day}.jsonl"


def _span_name_for_event(event: StreamEventBase) -> str:
    if event.type.startswith("run."):
        return "cw.workflow.run"
    if event.type == "node.state_changed":
        return "cw.workflow.node_execution"
    if event.type.startswith("attempt."):
        return "cw.workflow.attempt"
    if event.type.startswith("model."):
        return "cw.model.request"
    if event.type.startswith("tool."):
        return (
            "cw.tool.approval"
            if "approval" in event.type or event.type in {"tool.approved", "tool.rejected"}
            else "cw.tool.call"
        )
    if event.type.startswith("context."):
        return "cw.context_builder.build"
    if event.type.startswith("evidence."):
        return "cw.evidence_builder.consolidate"
    if event.type.startswith("evaluation."):
        return "cw.evaluation.run"
    if event.type.startswith("repair."):
        return "cw.repair.patch_apply" if "patch" in event.type else "cw.repair.propose"
    if event.type.startswith("human."):
        return "cw.tool.approval"
    if event.type.startswith("planning."):
        return "cw.planning.session"
    if event.type.startswith("git."):
        return "cw.runtime.git_commit"
    if event.type.startswith("metric.") or event.type.startswith("usage."):
        return "cw.stream.dispatch"
    if event.type.startswith("error."):
        return "cw.fault.exception"
    if event.type.startswith("system."):
        return "cw.desktop.sidecar_start"
    return "cw.stream.dispatch"


def _event_projects_to_metrics(event: StreamEventBase) -> bool:
    return event.type in {"metric.snapshot", "usage.delta"}


def _event_projects_to_span(event: StreamEventBase) -> bool:
    return event.type not in {"model.thinking_delta", "model.text_delta", "metric.snapshot", "usage.delta"}


def _span_kind_for_event(event: StreamEventBase) -> int:
    if event.type.startswith("model."):
        return _SPAN_KIND_CLIENT
    return _SPAN_KIND_INTERNAL


def _component_for_event(event: StreamEventBase) -> str:
    if event.type.startswith("context."):
        return "context_builder"
    if event.type.startswith("evidence."):
        return "evidence_builder"
    if event.type.startswith("planning."):
        return "planning_session"
    if event.type.startswith("git.") or event.type.startswith("artifact."):
        return "runtime"
    if event.type.startswith("system."):
        return "runtime"
    return "engine"


def _status_code_for_event(event: StreamEventBase) -> int:
    if event.type.startswith("error.") or event.type.endswith(".failed") or event.type == "run.failed":
        return _SPAN_STATUS_ERROR
    return _SPAN_STATUS_OK


def _message_prefix_for_event(event: StreamEventBase) -> str:
    if event.type == "attempt.completed":
        return "snapshot(run/"
    if event.type == "run.started":
        return "chore(run): start"
    if event.type in {"run.completed", "run.failed", "run.cancelled"}:
        return "chore(run): end"
    return "chore(run):"


def _record_object_id(filename: str, record: Mapping[str, object]) -> str | None:
    id_keys_by_file: Mapping[str, tuple[str, ...]] = {
        "attempts.jsonl": ("attempt_id",),
        "evaluations.jsonl": ("eval_id",),
        "repairs.jsonl": ("patch_id",),
        "decisions.jsonl": ("decision_id", "human_node_id"),
        "usage.jsonl": ("usage_id", "attempt_id"),
        "metrics.jsonl": ("event_id", "metric_id"),
    }
    for key in id_keys_by_file.get(filename, ()):
        value = record.get(key)
        if isinstance(value, str):
            return value
    return None


def _required_string(mapping: Mapping[str, object], key: str) -> str:
    value = mapping.get(key)
    if isinstance(value, str) and value:
        return value
    raise PersistenceError(
        "RH_RUN_DIR_CORRUPTED",
        "Runtime index requires a string field from run.json.",
        details={"field": key},
    )


def _optional_string(mapping: Mapping[str, object], key: str) -> str | None:
    value = mapping.get(key)
    return value if isinstance(value, str) else None


def _mapping_string(mapping: Mapping[str, object], key: str) -> str | None:
    value = mapping.get(key)
    return value if isinstance(value, str) else None


def _payload_int(event: StreamEventBase, key: str) -> int:
    payload = event.payload
    if isinstance(payload, dict):
        value = payload.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return 0


def _as_string_key_mapping(payload: object) -> Mapping[str, object]:
    if not isinstance(payload, Mapping):
        return {}
    mapped: dict[str, object] = {}
    for key, value in payload.items():
        if isinstance(key, str):
            mapped[key] = cast(object, value)
    return mapped


def _jsonl_line_count(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())


def _read_json_object(path: Path) -> dict[str, object]:
    loaded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise PersistenceError(
            "RH_RUN_DIR_CORRUPTED",
            "Expected runtime JSON object.",
            details={"path": path.as_posix()},
        )
    result: dict[str, object] = {}
    for key, value in loaded.items():
        if isinstance(key, str):
            result[key] = cast(object, value)
    return result


def _json_value(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest16(value: str) -> bytes:
    return _blake3_digest(value.encode("utf-8"), length=16)


def _trace_id_bytes(event: StreamEventBase) -> bytes:
    source = event.correlation_id or event.run_id
    if len(source) == 32:
        try:
            return bytes.fromhex(source)
        except ValueError:
            pass
    return _digest16(source)


def _blake3_digest(data: bytes, *, length: int | None = None) -> bytes:
    from blake3 import blake3

    hasher = blake3(data)
    if length is None:
        return hasher.digest()
    return hasher.digest(length=length)


def _unix_ms_now() -> int:
    return int(time.time() * 1000)


def _unix_ms_from_iso(raw: str) -> int:
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return _unix_ms_now()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.timestamp() * 1000)


def _runtime_os() -> str:
    system = platform.system().lower()
    if system.startswith("win"):
        return "windows"
    if system == "darwin":
        return "macos"
    return "linux"


def _privacy_profile(settings: Mapping[str, object]) -> str:
    privacy = settings.get("privacy")
    if isinstance(privacy, Mapping):
        mode = privacy.get("sensitive_data_mode")
        if mode in {"strict", "loose"}:
            return str(mode)
    return "strict"


def _string_or_unknown(value: object) -> str:
    return value if isinstance(value, str) and value else "unknown"


def _new_ulid(now_ms: int | None = None) -> str:
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    timestamp_ms = int(time.time() * 1000) if now_ms is None else now_ms
    timestamp = timestamp_ms & ((1 << 48) - 1)
    random_bits = secrets.randbits(80)
    value = (timestamp << 80) | random_bits
    chars = []
    for shift in range(125, -1, -5):
        chars.append(alphabet[(value >> shift) & 0b11111])
    return "".join(chars)
