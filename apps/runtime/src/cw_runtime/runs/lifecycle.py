"""WorkflowRun lifecycle shell and StreamEvent jsonl persistence.

W1.3.4 deliberately creates the run lifecycle / stream bus boundary without
executing nodes. The node runner and LangGraph orchestration are introduced in
later M1.3 slices.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import time
from collections.abc import AsyncGenerator, Iterable, Mapping
from pathlib import Path
from typing import Any, Final, Literal, cast

from pydantic import BaseModel, ConfigDict, Field

from cw_runtime.engine import compile_workflow_graph, load_workflow_graph
from cw_runtime.harness.project import AGENT_WORKFLOW_DIR, acquire_runtime_lock
from cw_runtime.persistence import (
    create_git_snapshot_locked,
    ensure_runtime_databases,
    index_run_jsonl_append,
    index_run_manifest,
    index_stream_event,
    should_snapshot_event,
)
from cw_runtime.settings import RUNTIME_SCHEMA_VERSION
from cw_schemas.events import LifecycleEvent, StreamEventBase, SystemEvent, validate_stream_event
from cw_schemas.types import DisplayLevel, EventCategory, EventPhase, ExecutionMode, RunState, Sensitivity

_CROCKFORD_ALPHABET: Final = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_TERMINAL_RUN_STATES: Final[frozenset[RunState]] = frozenset({RunState.COMPLETED, RunState.CANCELLED, RunState.FAILED})


class RunError(RuntimeError):
    """Raised when a WorkflowRun operation fails with a spec error code."""

    def __init__(
        self,
        error_code: str,
        message: str,
        *,
        status_code: int = 409,
        details: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.status_code = status_code
        self.details = {} if details is None else dict(details)


class RunFailureSummary(BaseModel):
    """WorkflowRun failed-state summary from workflow_run.md §8."""

    model_config = ConfigDict(extra="forbid")

    failure_type: str | None = None
    failed_node_id: str | None = None
    message: str
    error_code: str | None = None
    traceback_id: str | None = None


class RunCancellationSummary(BaseModel):
    """WorkflowRun cancelled-state summary from workflow_run.md §8."""

    model_config = ConfigDict(extra="forbid")

    by: str
    reason: str | None = None
    cancelled_at: str


class WorkflowRunStartRequest(BaseModel):
    """Request body for POST /cw/v1/workflows/{workflow_id}/run."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"]
    mode: ExecutionMode
    initial_input: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunActionRequest(BaseModel):
    """Request body for run pause/resume/cancel actions."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"]
    reason: str | None = Field(default=None, max_length=1000)
    by: str = Field(default="user", min_length=1, max_length=200)


class WorkflowRunStartResponse(BaseModel):
    """Response body for POST /cw/v1/workflows/{workflow_id}/run."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"] = RUNTIME_SCHEMA_VERSION
    run_id: str
    started_at: str
    stream_url: str


class WorkflowRunDocument(BaseModel):
    """Persisted ``runs/<run_id>/run.json`` document."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    run_id: str
    workflow_id: str
    workflow_version: str
    state: RunState
    previous_state: RunState | None = None
    mode: ExecutionMode
    started_at: str | None = None
    paused_at: str | None = None
    resumed_at: str | None = None
    completed_at: str | None = None
    failed_at: str | None = None
    cancelled_at: str | None = None
    last_heartbeat_at: str
    current_node_ids: list[str] = Field(default_factory=list)
    last_event_id: str | None = None
    summary_metrics: dict[str, Any] = Field(default_factory=dict)
    git_snapshots: list[str] = Field(default_factory=list)
    failure_summary: RunFailureSummary | None = None
    cancellation_summary: RunCancellationSummary | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


def create_workflow_run(
    project_root: Path,
    workflow_id: str,
    request: WorkflowRunStartRequest,
) -> WorkflowRunStartResponse:
    """Create a run directory and emit the initial ``run.started`` event."""

    graph = load_workflow_graph(project_root)
    if graph.workflow_id != workflow_id:
        raise RunError(
            "RES_NOT_FOUND",
            "Workflow is not active in this project runtime.",
            status_code=404,
            details={"workflow_id": workflow_id},
        )
    compiled = compile_workflow_graph(graph)
    with acquire_runtime_lock(project_root):
        ensure_runtime_databases(project_root)
        _ensure_no_active_run(project_root, workflow_id)

        run_id = _new_ulid()
        now = _utc_now_ms()
        metadata = dict(request.metadata)
        if request.initial_input:
            cw_metadata = metadata.get("cw")
            metadata["cw"] = {
                **(cw_metadata if isinstance(cw_metadata, dict) else {}),
                "initial_input": request.initial_input,
            }
        run = WorkflowRunDocument(
            run_id=run_id,
            workflow_id=graph.workflow_id,
            workflow_version=graph.version,
            state=RunState.RUNNING,
            previous_state=RunState.READY,
            mode=request.mode,
            started_at=now,
            last_heartbeat_at=now,
            current_node_ids=[compiled.entry_node_id],
            metadata=metadata,
        )

        run_root = _run_root(project_root, run_id)
        _create_run_directories(run_root)
        _write_json_atomic(run_root / "run.json", run.model_dump(mode="json"))
        _write_text_atomic(run_root / "attempts.jsonl", "")
        _write_text_atomic(run_root / "evaluations.jsonl", "")
        _write_text_atomic(run_root / "repairs.jsonl", "")
        _write_text_atomic(run_root / "decisions.jsonl", "")
        _write_text_atomic(run_root / "routing.jsonl", "")
        _write_text_atomic(run_root / "usage.jsonl", "")
        _write_text_atomic(run_root / "metrics.jsonl", "")
        _write_json_atomic(run_root / "skill_lock.json", {"skills": []})
        _write_json_atomic(run_root / "mcp_lock.json", {"mcps": []})

        event = _build_lifecycle_event(
            run=run,
            seq=_next_event_seq(run_root),
            event_type="run.started",
            phase=EventPhase.RUN_STARTED,
            title="Run started",
            payload={
                "workflow_id": graph.workflow_id,
                "workflow_version": graph.version,
                "mode": request.mode.value,
            },
            expandable=False,
        )
        run = _append_event_and_update_run(project_root, run, event)
    return WorkflowRunStartResponse(
        run_id=run.run_id,
        started_at=cast(str, run.started_at),
        stream_url=f"/cw/v1/runs/{run.run_id}/stream",
    )


def read_workflow_run(project_root: Path, run_id: str) -> WorkflowRunDocument:
    """Read ``runs/<run_id>/run.json``."""

    return WorkflowRunDocument.model_validate(_read_json_object(_run_root(project_root, run_id) / "run.json"))


def run_directory(project_root: Path, run_id: str) -> Path:
    """Return ``runs/<run_id>`` for internal runtime writers."""

    return _run_root(project_root, run_id)


def next_event_seq(project_root: Path, run_id: str) -> int:
    """Return the next StreamEvent seq for callers already holding ``runtime.lock``."""

    return _next_event_seq(_run_root(project_root, run_id))


def append_run_event_locked(
    project_root: Path,
    run: WorkflowRunDocument,
    event: StreamEventBase,
) -> WorkflowRunDocument:
    """Append a StreamEvent and update ``run.json``.

    The caller must hold ``runtime.lock``. This lets the node runner append
    several causally ordered records in one critical section.
    """

    return _append_event_and_update_run(project_root, run, event)


def write_workflow_run_locked(project_root: Path, run: WorkflowRunDocument) -> WorkflowRunDocument:
    """Persist ``run.json`` for callers already holding ``runtime.lock``."""

    _write_json_atomic(_run_root(project_root, run.run_id) / "run.json", run.model_dump(mode="json"))
    index_run_manifest(project_root, cast(dict[str, object], run.model_dump(mode="json")))
    return run


def write_run_json_locked(project_root: Path, run_id: str, relative_path: str, payload: object) -> None:
    """Write a JSON file below ``runs/<run_id>``.

    The relative path is intentionally constrained to the run directory so
    runner-owned pack and overlay writes cannot escape the harness boundary.
    """

    target = (_run_root(project_root, run_id) / relative_path).resolve()
    run_root = _run_root(project_root, run_id).resolve()
    if not target.is_relative_to(run_root):
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Run-relative JSON write escaped the run directory.",
            status_code=500,
            details={"run_id": run_id, "relative_path": relative_path},
        )
    _write_json_atomic(target, payload)


def append_run_jsonl_locked(project_root: Path, run_id: str, filename: str, payload: object) -> None:
    """Append one JSONL record below ``runs/<run_id>``.

    The caller must hold ``runtime.lock``.
    """

    if "/" in filename or "\\" in filename or not filename.endswith(".jsonl"):
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Run JSONL append requires a direct .jsonl filename.",
            status_code=500,
            details={"run_id": run_id, "filename": filename},
        )
    target = _run_root(project_root, run_id) / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8", newline="\n") as file:
        file.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    index_run_jsonl_append(project_root, run_id, filename, payload)


def new_runtime_id(now_ms: int | None = None) -> str:
    """Create a runtime ULID-like identifier."""

    return _new_ulid(now_ms)


def utc_now_ms() -> str:
    """Return current UTC time in the runtime ISO-8601 millisecond format."""

    return _utc_now_ms()


def pause_workflow_run(project_root: Path, run_id: str, request: RunActionRequest) -> WorkflowRunDocument:
    with acquire_runtime_lock(project_root):
        return _pause_workflow_run_locked(project_root, run_id, request)


def pause_active_workflow_run(
    project_root: Path,
    workflow_id: str,
    request: RunActionRequest,
) -> WorkflowRunDocument:
    with acquire_runtime_lock(project_root):
        run = _find_active_run(project_root, workflow_id)
        return _pause_workflow_run_locked(project_root, run.run_id, request)


def _pause_workflow_run_locked(project_root: Path, run_id: str, request: RunActionRequest) -> WorkflowRunDocument:
    run = read_workflow_run(project_root, run_id)
    _ensure_can_transition(run, allowed={RunState.RUNNING})
    now = _utc_now_ms()
    updated = run.model_copy(
        update={
            "state": RunState.PAUSED,
            "previous_state": run.state,
            "paused_at": now,
            "last_heartbeat_at": now,
        }
    )
    event = _build_lifecycle_event(
        run=updated,
        seq=_next_event_seq(_run_root(project_root, run_id)),
        event_type="run.paused",
        phase=EventPhase.RUN_PAUSED,
        title="Run paused",
        payload={"reason": request.reason},
        expandable=False,
    )
    return _append_event_and_update_run(project_root, updated, event)


def resume_workflow_run(project_root: Path, run_id: str, request: RunActionRequest) -> WorkflowRunDocument:
    with acquire_runtime_lock(project_root):
        return _resume_workflow_run_locked(project_root, run_id, request)


def resume_active_workflow_run(
    project_root: Path,
    workflow_id: str,
    request: RunActionRequest,
) -> WorkflowRunDocument:
    with acquire_runtime_lock(project_root):
        run = _find_active_run(project_root, workflow_id)
        return _resume_workflow_run_locked(project_root, run.run_id, request)


def _resume_workflow_run_locked(project_root: Path, run_id: str, request: RunActionRequest) -> WorkflowRunDocument:
    run = read_workflow_run(project_root, run_id)
    if run.state in _TERMINAL_RUN_STATES:
        raise RunError(
            "WR_RESUME_AFTER_TERMINAL",
            "Cannot resume a terminal WorkflowRun.",
            details={"run_id": run_id, "state": run.state.value},
        )
    _ensure_can_transition(run, allowed={RunState.PAUSED})
    now = _utc_now_ms()
    updated = run.model_copy(
        update={
            "state": RunState.RUNNING,
            "previous_state": run.state,
            "resumed_at": now,
            "last_heartbeat_at": now,
        }
    )
    event = _build_lifecycle_event(
        run=updated,
        seq=_next_event_seq(_run_root(project_root, run_id)),
        event_type="run.resumed",
        phase=EventPhase.RUN_RESUMED,
        title="Run resumed",
        payload={"reason": request.reason, "from_checkpoint_id": None},
        expandable=False,
    )
    return _append_event_and_update_run(project_root, updated, event)


def cancel_workflow_run(project_root: Path, run_id: str, request: RunActionRequest) -> WorkflowRunDocument:
    with acquire_runtime_lock(project_root):
        return _cancel_workflow_run_locked(project_root, run_id, request)


def cancel_active_workflow_run(
    project_root: Path,
    workflow_id: str,
    request: RunActionRequest,
) -> WorkflowRunDocument:
    with acquire_runtime_lock(project_root):
        run = _find_active_run(project_root, workflow_id)
        return _cancel_workflow_run_locked(project_root, run.run_id, request)


def _cancel_workflow_run_locked(project_root: Path, run_id: str, request: RunActionRequest) -> WorkflowRunDocument:
    run = read_workflow_run(project_root, run_id)
    _ensure_not_terminal(run)
    now = _utc_now_ms()
    cancellation = RunCancellationSummary(by=request.by, reason=request.reason, cancelled_at=now)
    updated = run.model_copy(
        update={
            "state": RunState.CANCELLED,
            "previous_state": run.state,
            "cancelled_at": now,
            "last_heartbeat_at": now,
            "current_node_ids": [],
            "cancellation_summary": cancellation,
        }
    )
    event = _build_lifecycle_event(
        run=updated,
        seq=_next_event_seq(_run_root(project_root, run_id)),
        event_type="run.cancelled",
        phase=EventPhase.RUN_CANCELLED,
        title="Run cancelled",
        payload={"by": request.by, "reason": request.reason},
        expandable=False,
    )
    return _append_event_and_update_run(project_root, updated, event)


def list_stream_events(
    project_root: Path,
    run_id: str,
    *,
    after_event_id: str | None = None,
    since_seq: int | None = None,
    until_seq: int | None = None,
    categories: set[EventCategory] | None = None,
    display_levels: set[DisplayLevel] | None = None,
) -> list[StreamEventBase]:
    """Read persisted stream events with replay/filter semantics."""

    events = _read_all_events(_run_root(project_root, run_id))
    if after_event_id is not None:
        matching_indexes = [index for index, event in enumerate(events) if event.event_id == after_event_id]
        if not matching_indexes:
            raise RunError(
                "SE_SSE_REPLAY_NOT_FOUND",
                "Last-Event-ID was not found in persisted stream events.",
                status_code=412,
                details={"run_id": run_id, "event_id": after_event_id},
            )
        events = events[matching_indexes[0] + 1 :]
    if since_seq is not None:
        events = [event for event in events if event.seq >= since_seq]
    if until_seq is not None:
        events = [event for event in events if event.seq <= until_seq]
    if categories is not None:
        events = [event for event in events if event.category in categories]
    if display_levels is not None:
        events = [event for event in events if event.display_level in display_levels]
    return events


def format_sse_event(event: StreamEventBase) -> str:
    """Serialize a StreamEvent into stream_event.md D-SE-2 SSE frame format."""

    return f"id: {event.event_id}\nevent: {event.type}\nretry: 3000\ndata: {event.model_dump_json()}\n\n"


async def stream_sse_events(
    project_root: Path,
    run_id: str,
    *,
    after_event_id: str | None = None,
    since_seq: int | None = None,
    until_seq: int | None = None,
    categories: set[EventCategory] | None = None,
    display_levels: set[DisplayLevel] | None = None,
    heartbeat_seconds: float = 15.0,
    poll_seconds: float = 0.2,
) -> AsyncGenerator[str, None]:
    """Yield replayed and live SSE frames for a run channel."""

    replay = list_stream_events(
        project_root,
        run_id,
        after_event_id=after_event_id,
        since_seq=since_seq,
        until_seq=until_seq,
        categories=categories,
        display_levels=display_levels,
    )
    for event in replay:
        yield format_sse_event(event)

    if until_seq is not None:
        return

    last_seen_seq = _last_event_seq(_run_root(project_root, run_id))
    started_at = time.monotonic()
    last_heartbeat_at = started_at
    while True:
        await asyncio.sleep(poll_seconds)
        all_events = _read_all_events(_run_root(project_root, run_id))
        new_events = [event for event in all_events if event.seq > last_seen_seq]
        if new_events:
            last_seen_seq = max(event.seq for event in new_events)
            for event in _filter_events(
                new_events,
                since_seq=since_seq,
                until_seq=until_seq,
                categories=categories,
                display_levels=display_levels,
            ):
                yield format_sse_event(event)
            last_heartbeat_at = time.monotonic()
            continue

        now = time.monotonic()
        if now - last_heartbeat_at >= heartbeat_seconds:
            heartbeat = append_system_heartbeat(project_root, run_id, uptime_seconds=now - started_at)
            last_seen_seq = heartbeat.seq
            last_heartbeat_at = now
            yield format_sse_event(heartbeat)


def _ensure_no_active_run(project_root: Path, workflow_id: str) -> None:
    runs_root = project_root.resolve() / AGENT_WORKFLOW_DIR / "runs"
    if not runs_root.exists():
        return
    for run_json in runs_root.glob("*/run.json"):
        run = WorkflowRunDocument.model_validate(_read_json_object(run_json))
        if run.workflow_id == workflow_id and run.state not in _TERMINAL_RUN_STATES:
            raise RunError(
                "WR_CONCURRENT_RUN_FORBIDDEN",
                "Workflow already has a non-terminal run.",
                details={"workflow_id": workflow_id, "run_id": run.run_id, "state": run.state.value},
            )


def _find_active_run(project_root: Path, workflow_id: str) -> WorkflowRunDocument:
    runs_root = project_root.resolve() / AGENT_WORKFLOW_DIR / "runs"
    if not runs_root.exists():
        raise _active_run_not_found(workflow_id)
    for run_json in sorted(runs_root.glob("*/run.json")):
        run = WorkflowRunDocument.model_validate(_read_json_object(run_json))
        if run.workflow_id == workflow_id and run.state not in _TERMINAL_RUN_STATES:
            return run
    raise _active_run_not_found(workflow_id)


def _active_run_not_found(workflow_id: str) -> RunError:
    return RunError(
        "RES_NOT_FOUND",
        "Workflow has no active non-terminal run.",
        status_code=404,
        details={"workflow_id": workflow_id},
    )


def _ensure_not_terminal(run: WorkflowRunDocument) -> None:
    if run.state in _TERMINAL_RUN_STATES:
        raise RunError(
            "WR_STATE_FORBIDDEN_TRANSITION",
            "Terminal WorkflowRun cannot be mutated.",
            details={"run_id": run.run_id, "state": run.state.value},
        )


def _ensure_can_transition(run: WorkflowRunDocument, *, allowed: set[RunState]) -> None:
    _ensure_not_terminal(run)
    if run.state not in allowed:
        raise RunError(
            "WR_STATE_FORBIDDEN_TRANSITION",
            "WorkflowRun state does not allow this transition.",
            details={
                "run_id": run.run_id,
                "state": run.state.value,
                "allowed": sorted(state.value for state in allowed),
            },
        )


def _append_event_and_update_run(
    project_root: Path,
    run: WorkflowRunDocument,
    event: StreamEventBase,
) -> WorkflowRunDocument:
    appended = _append_stream_event(_run_root(project_root, run.run_id), event)
    snapshot_id = _new_ulid() if should_snapshot_event(appended) else None
    git_snapshots = list(run.git_snapshots)
    if snapshot_id is not None:
        git_snapshots.append(snapshot_id)
    updated = run.model_copy(update={"last_event_id": appended.event_id, "git_snapshots": git_snapshots})
    _write_json_atomic(_run_root(project_root, run.run_id) / "run.json", updated.model_dump(mode="json"))
    index_run_manifest(project_root, cast(dict[str, object], updated.model_dump(mode="json")))
    index_stream_event(project_root, appended)
    if snapshot_id is not None:
        snapshot = create_git_snapshot_locked(
            project_root,
            run_id=updated.run_id,
            workflow_id=updated.workflow_id,
            workflow_version=updated.workflow_version,
            run_state=updated.state.value,
            event=appended,
            snapshot_id=snapshot_id,
            created_at=appended.created_at,
        )
        if snapshot is None:
            updated = updated.model_copy(update={"git_snapshots": run.git_snapshots})
            _write_json_atomic(_run_root(project_root, run.run_id) / "run.json", updated.model_dump(mode="json"))
            index_run_manifest(project_root, cast(dict[str, object], updated.model_dump(mode="json")))
    return updated


def append_system_heartbeat(project_root: Path, run_id: str, *, uptime_seconds: float) -> StreamEventBase:
    """Append a ``system.heartbeat`` StreamEvent for a live SSE channel."""

    with acquire_runtime_lock(project_root):
        run = read_workflow_run(project_root, run_id)
        now = _utc_now_ms()
        updated = run.model_copy(update={"last_heartbeat_at": now})
        event = SystemEvent(
            event_id=_new_ulid(),
            seq=_next_event_seq(_run_root(project_root, run_id)),
            run_id=run.run_id,
            node_id=None,
            attempt_id=None,
            type="system.heartbeat",
            phase=None,
            title="Runtime heartbeat",
            summary=None,
            content=None,
            payload={"uptime_seconds": round(uptime_seconds, 3)},
            display_level=DisplayLevel.MINIMAL,
            expandable=False,
            created_at=now,
        )
        _append_event_and_update_run(project_root, updated, event)
        return event


def _append_stream_event(run_root: Path, event: StreamEventBase) -> StreamEventBase:
    if event.sensitivity == Sensitivity.SENSITIVE:
        raise RunError(
            "SE_PERSIST_SENSITIVE_LEAK",
            "Sensitive StreamEvent cannot be persisted to jsonl.",
            status_code=500,
            details={"event_id": event.event_id},
        )
    events_dir = run_root / "stream-events"
    events_dir.mkdir(parents=True, exist_ok=True)
    expected_seq = _next_event_seq(run_root)
    if event.seq != expected_seq:
        raise RunError(
            "SE_BUILD_SEQ_REGRESSION",
            "StreamEvent seq must match the next persisted run sequence.",
            details={"event_id": event.event_id, "expected_seq": expected_seq, "actual_seq": event.seq},
        )
    day = event.created_at[:10].replace("-", "")
    target = events_dir / f"{day}.jsonl"
    with target.open("a", encoding="utf-8", newline="\n") as file:
        file.write(event.model_dump_json() + "\n")
    return event


def _build_lifecycle_event(
    *,
    run: WorkflowRunDocument,
    seq: int,
    event_type: Literal[
        "run.started",
        "run.paused",
        "run.resumed",
        "run.completed",
        "run.failed",
        "run.cancelled",
    ],
    phase: EventPhase,
    title: str,
    payload: dict[str, Any],
    expandable: bool,
) -> LifecycleEvent:
    return LifecycleEvent(
        event_id=_new_ulid(),
        seq=seq,
        run_id=run.run_id,
        node_id=None,
        attempt_id=None,
        type=event_type,
        phase=phase,
        title=title,
        summary=None,
        content=None,
        payload=payload,
        display_level=DisplayLevel.DEFAULT,
        expandable=expandable,
        created_at=_utc_now_ms(),
    )


def _next_event_seq(run_root: Path) -> int:
    return len(_read_all_events(run_root))


def _last_event_seq(run_root: Path) -> int:
    events = _read_all_events(run_root)
    return max((event.seq for event in events), default=-1)


def _read_all_events(run_root: Path) -> list[StreamEventBase]:
    events_dir = run_root / "stream-events"
    if not events_dir.exists():
        return []
    events: list[StreamEventBase] = []
    for jsonl_path in sorted(events_dir.glob("*.jsonl")):
        for line_number, raw_line in enumerate(jsonl_path.read_text(encoding="utf-8").splitlines(), start=1):
            if not raw_line.strip():
                continue
            try:
                loaded = json.loads(raw_line)
            except json.JSONDecodeError as exc:
                raise RunError(
                    "RH_RUN_DIR_CORRUPTED",
                    "StreamEvent jsonl contains invalid JSON.",
                    status_code=500,
                    details={"path": jsonl_path.as_posix(), "line": line_number},
                ) from exc
            if not isinstance(loaded, dict):
                raise RunError(
                    "RH_RUN_DIR_CORRUPTED",
                    "StreamEvent jsonl record must be an object.",
                    status_code=500,
                    details={"path": jsonl_path.as_posix(), "line": line_number},
                )
            events.append(validate_stream_event(cast(dict[str, Any], loaded)))
    return sorted(events, key=lambda event: event.seq)


def _filter_events(
    events: Iterable[StreamEventBase],
    *,
    since_seq: int | None,
    until_seq: int | None,
    categories: set[EventCategory] | None,
    display_levels: set[DisplayLevel] | None,
) -> list[StreamEventBase]:
    filtered = list(events)
    if since_seq is not None:
        filtered = [event for event in filtered if event.seq >= since_seq]
    if until_seq is not None:
        filtered = [event for event in filtered if event.seq <= until_seq]
    if categories is not None:
        filtered = [event for event in filtered if event.category in categories]
    if display_levels is not None:
        filtered = [event for event in filtered if event.display_level in display_levels]
    return filtered


def _run_root(project_root: Path, run_id: str) -> Path:
    return project_root.resolve() / AGENT_WORKFLOW_DIR / "runs" / run_id


def _create_run_directories(run_root: Path) -> None:
    for directory in [
        run_root,
        run_root / "context_packs",
        run_root / "evidence_packs",
        run_root / "execution_packs",
        run_root / "stream-events",
        run_root / "overlays",
    ]:
        directory.mkdir(parents=True, exist_ok=True)


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Run directory is missing a required file.",
            status_code=500,
            details={"path": path.as_posix()},
        ) from exc
    except json.JSONDecodeError as exc:
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Run JSON file is corrupted.",
            status_code=500,
            details={"path": path.as_posix()},
        ) from exc
    if not isinstance(loaded, dict):
        raise RunError(
            "RH_RUN_DIR_CORRUPTED",
            "Run JSON file must contain an object.",
            status_code=500,
            details={"path": path.as_posix()},
        )
    return cast(dict[str, Any], loaded)


def _write_json_atomic(path: Path, payload: object) -> None:
    _write_text_atomic(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


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


def _utc_now_ms() -> str:
    now = time.time()
    millis = int((now - int(now)) * 1000)
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + f".{millis:03d}Z"


def parse_event_categories(raw: str | None) -> set[EventCategory] | None:
    if raw is None or raw == "":
        return None
    return {EventCategory(part) for part in _split_query_list(raw)}


def parse_display_levels(raw: str | None) -> set[DisplayLevel] | None:
    if raw is None or raw == "":
        return None
    return {DisplayLevel(part) for part in _split_query_list(raw)}


def _split_query_list(raw: str) -> Iterable[str]:
    return (part.strip() for part in raw.split(",") if part.strip())


__all__ = [
    "RunActionRequest",
    "RunCancellationSummary",
    "RunError",
    "RunFailureSummary",
    "WorkflowRunDocument",
    "WorkflowRunStartRequest",
    "WorkflowRunStartResponse",
    "append_run_event_locked",
    "append_run_jsonl_locked",
    "append_system_heartbeat",
    "cancel_active_workflow_run",
    "cancel_workflow_run",
    "create_workflow_run",
    "format_sse_event",
    "list_stream_events",
    "new_runtime_id",
    "next_event_seq",
    "parse_display_levels",
    "parse_event_categories",
    "pause_active_workflow_run",
    "pause_workflow_run",
    "read_workflow_run",
    "resume_active_workflow_run",
    "resume_workflow_run",
    "run_directory",
    "stream_sse_events",
    "utc_now_ms",
    "write_run_json_locked",
    "write_workflow_run_locked",
]
