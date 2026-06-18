"""Project runtime harness initialization.

This module implements the filesystem side of runtime_harness.md for project
creation. It deliberately avoids FastAPI imports so it can be tested as pure
runtime logic.
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, Final, Literal, Protocol, cast

from pydantic import BaseModel, ConfigDict, Field

from cw_runtime import __version__
from cw_runtime.persistence import ensure_runtime_databases, record_initial_git_snapshot
from cw_runtime.settings import RUNTIME_SCHEMA_VERSION
from cw_schemas import WorkflowGraph

AGENT_WORKFLOW_DIR: Final = ".agent-workflow"
MANIFEST_REVISION_FILE: Final = "manifest_revision.json"
RUNTIME_LOCK_FILE: Final = "runtime.lock"

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
    "health_check",
    "discover_tools",
    "close",
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
                        "Timed out acquiring runtime.lock.",
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


def acquire_runtime_lock(project_root: Path, *, timeout_seconds: float = 60.0) -> RuntimeLock:
    agent_root = project_root.resolve() / AGENT_WORKFLOW_DIR
    return RuntimeLock(agent_root / "locks" / RUNTIME_LOCK_FILE, timeout_seconds=timeout_seconds)


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
    "ProjectMCPLockEntry",
    "ProjectMCPServerConfig",
    "ProjectMCPToolDiscovery",
    "ProjectSkillLockEntry",
    "ProjectToolAvailability",
    "ProjectToolLockSnapshot",
    "RuntimeLock",
    "acquire_runtime_lock",
    "initialize_project",
    "load_enabled_mcp_server_ids",
    "load_enabled_skill_ids",
    "load_enabled_skill_refs",
    "load_project_mcp_server_configs",
    "load_project_tool_availability",
    "load_project_tool_lock_snapshot",
    "read_project",
    "update_manifest_json",
]
