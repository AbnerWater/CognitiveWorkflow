"""Static Phase 1 ModelRouter.

The implementation intentionally stays pure and deterministic. It reads static
profile declarations, derives node requirements from ``NodeContract``, filters
adapter/profile candidates, and returns an auditable routing decision.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from itertools import pairwise
from os import PathLike
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from cw_runtime import __version__
from cw_runtime.harness.project import AGENT_WORKFLOW_DIR
from cw_runtime.runs.lifecycle import new_runtime_id, utc_now_ms
from cw_schemas.contract import NodeContractBase
from cw_schemas.runtime import RunUsage
from cw_schemas.types import AdapterKind, ArbitrationMode, FailureType, ProviderKind, ValidatorMode
from cw_schemas.workflow import WorkflowModelPolicy

_ROUTER_VERSION = "static-phase1.0.0"
_DEFAULT_GLOBAL_REGISTRY_PATH = Path.home() / ".cw" / "model_profiles.json"
_DETERMINISTIC_ADAPTER_ID = "cw_runtime.deterministic_node_runner"
_TOKENS_PER_MILLION = 1_000_000.0

ReasoningRequired = Literal["low", "medium", "high"]
StructureStrictness = Literal["low", "medium", "high"]
ToolComplexity = Literal["none", "simple", "complex"]
RiskLevel = Literal["low", "medium", "high"]
RoutingStep = Literal[
    "collect_candidates",
    "apply_provider_kind_filter",
    "apply_capability_filter",
    "apply_node_policy",
    "apply_workflow_policy",
    "apply_escalation",
    "tie_break",
    "select",
]
EscalationKind = Literal["model_capability_limit", "logic_gap", "explicit_patch"]
CostTier = Literal["cheap", "standard", "premium", "local_free"]


class ModelRouterError(RuntimeError):
    """Raised when static model routing cannot produce a valid decision."""

    def __init__(self, error_code: str, message: str, *, details: Mapping[str, object] | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.details = {} if details is None else dict(details)


class ModelCapabilities(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_context_tokens: int = Field(ge=1)
    max_output_tokens: int = Field(ge=1)
    structured_output_native: bool
    tool_call: bool
    streaming: bool
    multi_modal: set[str] = Field(default_factory=set)
    reasoning_supported: bool
    vision_supported: bool
    failure_types_supported: set[FailureType] = Field(default_factory=set)
    reliability_score: float = Field(ge=0.0, le=1.0)
    recommended_node_kinds: set[str] = Field(default_factory=set)


class ModelCostProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_per_million_usd: float | None = Field(default=None, ge=0.0)
    output_per_million_usd: float | None = Field(default=None, ge=0.0)
    latency_p50_ms: int = Field(ge=0)
    latency_p95_ms: int = Field(ge=0)
    tier: CostTier


class ModelPerformanceProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_kind_pass_rates: dict[str, float] = Field(default_factory=dict)
    node_kind_avg_attempts: dict[str, float] = Field(default_factory=dict)
    domain_scores: dict[str, float] = Field(default_factory=dict)
    common_failure_types: list[str] = Field(default_factory=list)
    best_prompt_patterns: list[str] = Field(default_factory=list)
    poor_fit_signals: list[str] = Field(default_factory=list)
    last_evaluated_at: str | None = None


class ModelProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_profile_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    provider_kind: ProviderKind
    provider_id: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    capabilities: ModelCapabilities
    default_model_settings: dict[str, Any]
    cost_profile: ModelCostProfile
    performance_profile: ModelPerformanceProfile = Field(default_factory=ModelPerformanceProfile)
    auth_ref: str | None = None
    tags: list[str] = Field(default_factory=list)
    disabled: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class ModelProfileOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_model_settings: dict[str, Any] | None = None
    disabled: bool | None = None
    auth_ref: str | None = None
    tags: list[str] | None = None


class ProjectModelSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_model_profile_id: str | None = None
    escalation_chain: list[str] = Field(default_factory=list)
    forbid_remote_for_sensitive: bool = True
    forbid_provider_kinds: set[ProviderKind] = Field(default_factory=set)
    profile_overrides: dict[str, ModelProfileOverride] = Field(default_factory=dict)
    add_profiles: list[ModelProfile] = Field(default_factory=list)


class ResolvedProfileRegistry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profiles: list[ModelProfile]
    default_profile_id: str | None = None

    def profile_by_id(self) -> dict[str, ModelProfile]:
        return {profile.model_profile_id: profile for profile in self.profiles}


def estimate_usage_cost_usd(usage: RunUsage, cost_profile: ModelCostProfile) -> float | None:
    """Estimate attempt cost from static ModelRouter token prices."""

    input_rate = cost_profile.input_per_million_usd
    output_rate = cost_profile.output_per_million_usd
    if input_rate is None or output_rate is None:
        return None
    billable_input_tokens = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
    return (billable_input_tokens / _TOKENS_PER_MILLION * input_rate) + (
        usage.output_tokens / _TOKENS_PER_MILLION * output_rate
    )


class AdapterCapabilities(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kinds: set[AdapterKind] = Field(default_factory=lambda: {AdapterKind.CHAT})
    provider_kinds: set[ProviderKind] = Field(default_factory=set)
    structured_output: bool
    streaming: bool
    tool_call: bool
    mcp: bool
    human_in_the_loop: bool
    deferred_tool_results: bool
    multi_modal: set[str] = Field(default_factory=set)
    long_context_tokens: int = Field(ge=1)
    max_tool_iterations: int = Field(ge=0)
    cancel: bool
    evidence_lookup_tool: bool
    model_settings_passthrough: set[str] = Field(default_factory=set)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AdapterDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adapter_id: str = Field(min_length=1)
    adapter_version: str = Field(min_length=1)
    capabilities: AdapterCapabilities
    enabled: bool = True
    priority: int = Field(default=100, ge=0)


class NodeCapabilityRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_kind: str
    reasoning_required: ReasoningRequired
    context_required_tokens: int = Field(ge=0)
    structure_strictness: StructureStrictness
    factuality_required: bool
    tool_complexity: ToolComplexity
    risk_level: RiskLevel
    candidate_count: int = Field(ge=1)
    review_required: bool
    human_required: bool
    forbid_provider_kinds: set[ProviderKind] = Field(default_factory=set)
    multi_modal_required: set[str] = Field(default_factory=set)


class RoutingEscalationTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: EscalationKind
    from_model_profile_id: str
    repair_patch_id: str | None = None
    evaluation_id: str | None = None


class RoutingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    request_id: str
    run_id: str
    node_id: str
    attempt_index: int = Field(ge=0)
    previous_decision: RoutingDecision | None = None
    node_contract_snapshot: NodeContractBase
    workflow_model_policy: WorkflowModelPolicy
    project_settings_models: ProjectModelSettings
    requirement: NodeCapabilityRequirement
    escalation_trigger: RoutingEscalationTrigger | None = None
    route_seed: str | None = None
    correlation_id: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class RemovedCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_profile_id: str
    adapter_id: str
    reason: str


class RoutingReasoningStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: RoutingStep
    before_count: int = Field(ge=0)
    after_count: int = Field(ge=0)
    removed: list[RemovedCandidate] = Field(default_factory=list)
    notes: str | None = None


class RoutingCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_profile_id: str
    adapter_id: str
    capability_score: float = Field(ge=0.0, le=1.0)
    cost_score: float = Field(ge=0.0, le=1.0)
    performance_score: float | None = Field(default=None, ge=0.0, le=1.0)
    selected: bool
    rank: int = Field(ge=1)


class RoutingDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision_id: str
    request_id: str
    run_id: str
    node_id: str
    attempt_index: int = Field(ge=0)
    adapter_id: str
    model_profile_id: str
    effective_model_settings: dict[str, Any]
    reasoning_chain: list[RoutingReasoningStep]
    candidates_considered: list[RoutingCandidate]
    escalation_position: int = Field(ge=0)
    escalation_chain: list[str]
    forbidden_provider_kinds: set[ProviderKind]
    seed_used: str | None = None
    decided_at: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class RoutingTrace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision_id: str
    request: RoutingRequest
    decision: RoutingDecision
    engine_version: str
    router_version: str = _ROUTER_VERSION


class _Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile: ModelProfile
    adapter: AdapterDescriptor
    capability_score: float
    cost_score: float
    performance_score: float | None = None
    score: float = 0.0


def load_project_model_settings(project_root: str | PathLike[str]) -> ProjectModelSettings:
    settings_path = Path(project_root) / AGENT_WORKFLOW_DIR / "settings.json"
    try:
        loaded = json.loads(settings_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ProjectModelSettings()
    except json.JSONDecodeError as exc:
        raise ModelRouterError(
            "MR_INTERNAL",
            "settings.json is not valid JSON.",
            details={"path": settings_path.as_posix(), "line": exc.lineno, "column": exc.colno},
        ) from exc
    if not isinstance(loaded, dict):
        raise ModelRouterError("MR_INTERNAL", "settings.json must be a JSON object.")
    models = loaded.get("models", {})
    if not isinstance(models, dict):
        raise ModelRouterError("MR_INTERNAL", "settings.json.models must be a JSON object.")
    try:
        return ProjectModelSettings.model_validate(models)
    except ValidationError as exc:
        raise ModelRouterError(
            "MR_INTERNAL",
            "settings.json.models does not match ModelRouter project settings.",
            details={"errors": exc.errors(include_context=False)},
        ) from exc


def resolve_model_profile_registry(
    project_settings: ProjectModelSettings,
    *,
    global_registry_path: Path | None = None,
) -> ResolvedProfileRegistry:
    profiles_by_id = _global_profiles(global_registry_path or _DEFAULT_GLOBAL_REGISTRY_PATH)
    for profile in _builtin_profiles():
        profiles_by_id.setdefault(profile.model_profile_id, profile)

    for profile in project_settings.add_profiles:
        if profile.model_profile_id in profiles_by_id:
            raise ModelRouterError(
                "MR_PRIMARY_PROFILE_NOT_AVAILABLE",
                "Project add_profiles contains a duplicate ModelProfile id.",
                details={"model_profile_id": profile.model_profile_id},
            )
        profiles_by_id[profile.model_profile_id] = profile

    for profile_id, override in project_settings.profile_overrides.items():
        existing_profile = profiles_by_id.get(profile_id)
        if existing_profile is None:
            raise ModelRouterError(
                "MR_PRIMARY_PROFILE_NOT_AVAILABLE",
                "Project profile_overrides references an unknown ModelProfile.",
                details={"model_profile_id": profile_id},
            )
        update: dict[str, object] = {}
        if override.default_model_settings is not None:
            update["default_model_settings"] = {
                **existing_profile.default_model_settings,
                **override.default_model_settings,
            }
        if override.disabled is not None:
            update["disabled"] = override.disabled
        if override.auth_ref is not None:
            update["auth_ref"] = override.auth_ref
        if override.tags is not None:
            update["tags"] = override.tags
        profiles_by_id[profile_id] = existing_profile.model_copy(update=update)

    visible = [profile for profile in profiles_by_id.values() if not profile.disabled]
    if not visible:
        raise ModelRouterError("MR_REGISTRY_EMPTY", "Resolved ModelProfile registry is empty.")
    return ResolvedProfileRegistry(
        profiles=sorted(visible, key=lambda profile: profile.model_profile_id),
        default_profile_id=project_settings.default_model_profile_id,
    )


def build_routing_request(
    *,
    run_id: str,
    node_id: str,
    attempt_index: int,
    node_contract: NodeContractBase,
    workflow_model_policy: WorkflowModelPolicy,
    project_settings_models: ProjectModelSettings,
    context_required_tokens: int,
    request_id: str | None = None,
    correlation_id: str | None = None,
    primary_model_profile_id: str | None = None,
    escalation_trigger: RoutingEscalationTrigger | None = None,
) -> RoutingRequest:
    contract = _contract_with_primary_override(node_contract, primary_model_profile_id)
    return RoutingRequest(
        request_id=request_id or new_runtime_id(),
        run_id=run_id,
        node_id=node_id,
        attempt_index=attempt_index,
        previous_decision=None,
        node_contract_snapshot=contract,
        workflow_model_policy=workflow_model_policy,
        project_settings_models=project_settings_models,
        requirement=_derive_requirement(
            contract,
            workflow_model_policy,
            project_settings_models,
            context_required_tokens=context_required_tokens,
        ),
        escalation_trigger=escalation_trigger,
        route_seed=None,
        correlation_id=correlation_id or new_runtime_id(),
        metadata={},
    )


def route_model(
    request: RoutingRequest,
    registry: ResolvedProfileRegistry,
    adapters: Sequence[AdapterDescriptor] | None = None,
    *,
    decided_at: str | None = None,
) -> RoutingDecision:
    adapter_list = _default_adapters() if adapters is None else list(adapters)
    reasoning: list[RoutingReasoningStep] = []
    candidates = _collect_candidates(request, registry, adapter_list)
    _append_step(reasoning, "collect_candidates", before=0, after=len(candidates))
    if not candidates:
        raise ModelRouterError("MR_NO_CANDIDATES", "ModelRouter found no adapter/profile candidates.")

    candidates, removed = _apply_provider_kind_filter(request, candidates)
    _append_step(
        reasoning,
        "apply_provider_kind_filter",
        before=len(candidates) + len(removed),
        after=len(candidates),
        removed=removed,
    )
    if not candidates:
        _raise_provider_filter_exhausted(removed)

    candidates, removed = _apply_capability_filter(request, candidates)
    _append_step(
        reasoning,
        "apply_capability_filter",
        before=len(candidates) + len(removed),
        after=len(candidates),
        removed=removed,
    )
    if not candidates:
        raise ModelRouterError(
            "MR_CAPABILITY_NOT_MET",
            "No candidate satisfies the node capability requirement.",
            details={"removed": [item.model_dump(mode="json") for item in removed]},
        )

    candidates, removed, notes = _apply_node_policy(request, registry, candidates)
    _append_step(
        reasoning,
        "apply_node_policy",
        before=len(candidates) + len(removed),
        after=len(candidates),
        removed=removed,
        notes=notes,
    )
    if not candidates:
        raise ModelRouterError(
            "MR_PRIMARY_PROFILE_NOT_AVAILABLE",
            "Primary model profile is not available after filters.",
            details={"primary_model_profile_id": request.node_contract_snapshot.model_policy.primary_model_profile_id},
        )

    _append_step(
        reasoning,
        "apply_workflow_policy",
        before=len(candidates),
        after=len(candidates),
        notes=f"default={request.workflow_model_policy.default_model_profile_id}",
    )
    candidates, escalation_position, escalation_chain = _apply_escalation(request, registry, candidates)
    _append_step(
        reasoning,
        "apply_escalation",
        before=len(candidates),
        after=len(candidates),
        notes="no escalation_trigger" if request.escalation_trigger is None else f"position={escalation_position}",
    )

    ranked = _rank_candidates(candidates, default_profile_ids=_default_profile_ids(request))
    _append_step(reasoning, "tie_break", before=len(ranked), after=len(ranked), notes=_score_notes(ranked))
    selected = ranked[0]
    considered = [
        RoutingCandidate(
            model_profile_id=candidate.profile.model_profile_id,
            adapter_id=candidate.adapter.adapter_id,
            capability_score=candidate.capability_score,
            cost_score=candidate.cost_score,
            performance_score=candidate.performance_score,
            selected=index == 1,
            rank=index,
        )
        for index, candidate in enumerate(ranked, start=1)
    ]
    _append_step(reasoning, "select", before=len(ranked), after=1, notes="rank=1")
    effective_settings = _effective_model_settings(selected.profile, request)
    _ensure_required_model_settings(effective_settings)
    final_escalation_chain = _decision_escalation_chain(selected.profile.model_profile_id, escalation_chain)
    _validate_escalation_chain(
        final_escalation_chain,
        registry.profile_by_id(),
    )
    return RoutingDecision(
        decision_id=new_runtime_id(),
        request_id=request.request_id,
        run_id=request.run_id,
        node_id=request.node_id,
        attempt_index=request.attempt_index,
        adapter_id=selected.adapter.adapter_id,
        model_profile_id=selected.profile.model_profile_id,
        effective_model_settings=effective_settings,
        reasoning_chain=reasoning,
        candidates_considered=considered,
        escalation_position=escalation_position,
        escalation_chain=final_escalation_chain,
        forbidden_provider_kinds=request.requirement.forbid_provider_kinds,
        seed_used=request.route_seed,
        decided_at=decided_at or utc_now_ms(),
        metadata={"cw": {"router_version": _ROUTER_VERSION}},
    )


def build_routing_trace(request: RoutingRequest, decision: RoutingDecision) -> RoutingTrace:
    return RoutingTrace(
        decision_id=decision.decision_id,
        request=request,
        decision=decision,
        engine_version=__version__,
    )


def _global_profiles(path: Path) -> dict[str, ModelProfile]:
    if not path.exists():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ModelRouterError(
            "MR_INTERNAL",
            "Global model profile registry is not valid JSON.",
            details={"path": path.as_posix(), "line": exc.lineno, "column": exc.colno},
        ) from exc
    if not isinstance(loaded, dict):
        raise ModelRouterError("MR_INTERNAL", "Global model profile registry must be a JSON object.")
    raw_profiles = loaded.get("profiles", [])
    if not isinstance(raw_profiles, list):
        raise ModelRouterError("MR_INTERNAL", "Global model profile registry profiles must be an array.")
    profiles: dict[str, ModelProfile] = {}
    for raw_profile in raw_profiles:
        profile = ModelProfile.model_validate(raw_profile)
        if profile.model_profile_id in profiles:
            raise ModelRouterError(
                "MR_PRIMARY_PROFILE_NOT_AVAILABLE",
                "Global model profile registry contains duplicate ModelProfile ids.",
                details={"model_profile_id": profile.model_profile_id},
            )
        profiles[profile.model_profile_id] = profile
    return profiles


def _builtin_profiles() -> list[ModelProfile]:
    return [
        _profile(
            "deterministic-foundation",
            "CW Deterministic Foundation",
            ProviderKind.LOCAL,
            "cw_runtime",
            "deterministic-foundation",
            reliability=1.0,
            tier="local_free",
            settings={"temperature": 0.0, "top_p": 1.0, "max_tokens": 4096},
        ),
        _profile(
            "claude-sonnet-default",
            "Claude Sonnet Default",
            ProviderKind.CLOUD,
            "anthropic",
            "claude-sonnet-default",
            reliability=0.92,
            tier="premium",
            settings={"temperature": 0.3, "top_p": 0.95, "max_tokens": 4096},
        ),
        _profile(
            "claude-opus-strong",
            "Claude Opus Strong",
            ProviderKind.CLOUD,
            "anthropic",
            "claude-opus-strong",
            reliability=0.96,
            tier="premium",
            settings={"temperature": 0.2, "top_p": 0.95, "max_tokens": 8192},
        ),
        _profile(
            "claude-sonnet-judge",
            "Claude Sonnet Judge",
            ProviderKind.CLOUD,
            "anthropic",
            "claude-sonnet-judge",
            reliability=0.9,
            tier="standard",
            settings={"temperature": 0.0, "top_p": 0.95, "max_tokens": 2048},
        ),
        _profile(
            "claude-sonnet-repair",
            "Claude Sonnet Repair",
            ProviderKind.CLOUD,
            "anthropic",
            "claude-sonnet-repair",
            reliability=0.9,
            tier="standard",
            settings={"temperature": 0.2, "top_p": 0.95, "max_tokens": 4096},
        ),
        _profile(
            "human-contract-model",
            "Human Contract Placeholder",
            ProviderKind.LOCAL,
            "cw_runtime",
            "human-contract-model",
            reliability=1.0,
            tier="local_free",
            settings={"temperature": 0.0, "top_p": 1.0, "max_tokens": 1024},
            recommended_node_kinds={"human_gate"},
        ),
    ]


def _profile(
    profile_id: str,
    display_name: str,
    provider_kind: ProviderKind,
    provider_id: str,
    model_id: str,
    *,
    reliability: float,
    tier: CostTier,
    settings: dict[str, Any],
    recommended_node_kinds: set[str] | None = None,
) -> ModelProfile:
    return ModelProfile(
        model_profile_id=profile_id,
        display_name=display_name,
        provider_kind=provider_kind,
        provider_id=provider_id,
        model_id=model_id,
        capabilities=ModelCapabilities(
            max_context_tokens=200_000,
            max_output_tokens=int(settings["max_tokens"]),
            structured_output_native=True,
            tool_call=True,
            streaming=True,
            multi_modal={"image", "document"},
            reasoning_supported=True,
            vision_supported=True,
            failure_types_supported=set(FailureType),
            reliability_score=reliability,
            recommended_node_kinds=recommended_node_kinds or {"execution", "evaluation", "repair", "human_gate"},
        ),
        default_model_settings=settings,
        cost_profile=ModelCostProfile(
            input_per_million_usd=0.0 if tier == "local_free" else 3.0,
            output_per_million_usd=0.0 if tier == "local_free" else 15.0,
            latency_p50_ms=0 if tier == "local_free" else 4500,
            latency_p95_ms=0 if tier == "local_free" else 12000,
            tier=tier,
        ),
        performance_profile=ModelPerformanceProfile(),
        tags=["builtin", profile_id],
        metadata={"cw": {"builtin": True}},
    )


def _default_adapters() -> list[AdapterDescriptor]:
    common_settings = {"temperature", "top_p", "max_tokens", "reasoning_effort", "seed"}
    return [
        AdapterDescriptor(
            adapter_id=_DETERMINISTIC_ADAPTER_ID,
            adapter_version="0.1.0",
            capabilities=AdapterCapabilities(
                kinds={AdapterKind.CHAT, AdapterKind.MODEL_ONLY},
                provider_kinds={ProviderKind.LOCAL},
                structured_output=True,
                streaming=True,
                tool_call=True,
                mcp=True,
                human_in_the_loop=True,
                deferred_tool_results=True,
                multi_modal={"image", "document"},
                long_context_tokens=200_000,
                max_tool_iterations=16,
                cancel=True,
                evidence_lookup_tool=True,
                model_settings_passthrough=common_settings,
            ),
            priority=0,
        ),
        AdapterDescriptor(
            adapter_id="pydantic_ai",
            adapter_version="0.1.0",
            capabilities=AdapterCapabilities(
                kinds={AdapterKind.CHAT},
                provider_kinds={ProviderKind.CLOUD, ProviderKind.PRIVATE, ProviderKind.LOCAL},
                structured_output=True,
                streaming=True,
                tool_call=True,
                mcp=True,
                human_in_the_loop=False,
                deferred_tool_results=True,
                multi_modal=set(),
                long_context_tokens=200_000,
                max_tool_iterations=16,
                cancel=False,
                evidence_lookup_tool=True,
                model_settings_passthrough=common_settings,
                metadata={
                    "cw": {
                        "supported_builtin_tools": [
                            "evidence_lookup",
                            "file_io",
                            "python_sandbox",
                            "web_fetch",
                        ],
                        "supports_unlisted_builtin_tools": False,
                    }
                },
            ),
            priority=10,
        ),
    ]


def _derive_requirement(
    contract: NodeContractBase,
    workflow_policy: WorkflowModelPolicy,
    project_settings: ProjectModelSettings,
    *,
    context_required_tokens: int,
) -> NodeCapabilityRequirement:
    forbid_provider_kinds = set(project_settings.forbid_provider_kinds)
    forbid_provider_kinds.update(contract.model_policy.forbid_provider_kinds)
    risk_level = _risk_level(contract)
    if contract.forbid_remote_models:
        forbid_provider_kinds.add(ProviderKind.CLOUD)
    if risk_level == "high" and (
        workflow_policy.forbid_remote_for_sensitive or project_settings.forbid_remote_for_sensitive
    ):
        forbid_provider_kinds.add(ProviderKind.CLOUD)
    return NodeCapabilityRequirement(
        contract_kind=contract.contract_kind,
        reasoning_required=_reasoning_required(contract),
        context_required_tokens=context_required_tokens,
        structure_strictness=_structure_strictness(contract),
        factuality_required=bool(contract.evidence_requirements),
        tool_complexity=_tool_complexity(contract),
        risk_level=risk_level,
        candidate_count=contract.model_policy.candidate_count,
        review_required=contract.contract_kind == "evaluation",
        human_required=contract.contract_kind == "human_gate" or contract.requires_human_approval,
        forbid_provider_kinds=forbid_provider_kinds,
        multi_modal_required=_multi_modal_required(contract),
    )


def _reasoning_required(contract: NodeContractBase) -> ReasoningRequired:
    if contract.contract_kind == "evaluation" and getattr(contract, "arbitration", None) == ArbitrationMode.MULTI_JUDGE:
        return "high"
    if contract.contract_kind == "execution" and contract.evidence_requirements:
        return "medium"
    return "low"


def _structure_strictness(contract: NodeContractBase) -> StructureStrictness:
    mode = contract.validator_policy.mode
    if mode == ValidatorMode.STRICT:
        return "high"
    if mode == ValidatorMode.LENIENT:
        return "medium"
    return "low"


def _tool_complexity(contract: NodeContractBase) -> ToolComplexity:
    if contract.skills or contract.mcp_tools:
        return "complex"
    if contract.allowed_tools:
        return "simple"
    return "none"


def _risk_level(contract: NodeContractBase) -> RiskLevel:
    cw_metadata = contract.metadata.get("cw")
    metadata_risk = cw_metadata.get("risk_level") if isinstance(cw_metadata, dict) else None
    if contract.requires_human_approval or contract.forbid_remote_models or metadata_risk == "high":
        return "high"
    if metadata_risk == "medium":
        return "medium"
    return "low"


def _multi_modal_required(contract: NodeContractBase) -> set[str]:
    cw_metadata = contract.metadata.get("cw")
    raw_value = cw_metadata.get("multi_modal_required") if isinstance(cw_metadata, dict) else None
    if isinstance(raw_value, list):
        return {item for item in raw_value if isinstance(item, str)}
    return set()


def _collect_candidates(
    request: RoutingRequest,
    registry: ResolvedProfileRegistry,
    adapters: Sequence[AdapterDescriptor],
) -> list[_Candidate]:
    candidates: list[_Candidate] = []
    for profile in registry.profiles:
        if profile.disabled:
            continue
        if request.requirement.contract_kind not in profile.capabilities.recommended_node_kinds:
            continue
        for adapter in adapters:
            if not adapter.enabled:
                continue
            if profile.provider_kind not in adapter.capabilities.provider_kinds:
                continue
            candidates.append(
                _Candidate(
                    profile=profile,
                    adapter=adapter,
                    capability_score=profile.capabilities.reliability_score,
                    cost_score=_cost_score(profile.cost_profile.tier),
                )
            )
    return candidates


def _apply_provider_kind_filter(
    request: RoutingRequest,
    candidates: Sequence[_Candidate],
) -> tuple[list[_Candidate], list[RemovedCandidate]]:
    kept: list[_Candidate] = []
    removed: list[RemovedCandidate] = []
    for candidate in candidates:
        if _sensitive_remote_forbidden(request, candidate.profile):
            removed.append(_removed(candidate, "MR_SENSITIVE_DATA_REMOTE_FORBIDDEN"))
        elif candidate.profile.provider_kind in request.requirement.forbid_provider_kinds:
            removed.append(_removed(candidate, "MR_PROVIDER_KIND_FORBIDDEN_ALL"))
        else:
            kept.append(candidate)
    return kept, removed


def _raise_provider_filter_exhausted(removed: Sequence[RemovedCandidate]) -> None:
    serialized = [item.model_dump(mode="json") for item in removed]
    if removed and all(item.reason == "MR_SENSITIVE_DATA_REMOTE_FORBIDDEN" for item in removed):
        raise ModelRouterError(
            "MR_SENSITIVE_DATA_REMOTE_FORBIDDEN",
            "Sensitive routing requirements forbid all remote cloud candidates.",
            details={"removed": serialized},
        )
    raise ModelRouterError(
        "MR_PROVIDER_KIND_FORBIDDEN_ALL",
        "All candidates were removed by provider-kind privacy filters.",
        details={"removed": serialized},
    )


def _apply_capability_filter(
    request: RoutingRequest,
    candidates: Sequence[_Candidate],
) -> tuple[list[_Candidate], list[RemovedCandidate]]:
    kept: list[_Candidate] = []
    removed: list[RemovedCandidate] = []
    for candidate in candidates:
        reason = _capability_miss_reason(request, candidate)
        if reason is None:
            kept.append(candidate)
        else:
            removed.append(_removed(candidate, reason))
    return kept, removed


def _capability_miss_reason(request: RoutingRequest, candidate: _Candidate) -> str | None:
    requirement = request.requirement
    profile_caps = candidate.profile.capabilities
    adapter_caps = candidate.adapter.capabilities
    if profile_caps.max_context_tokens < requirement.context_required_tokens:
        return "MR_CAPABILITY_NOT_MET:max_context_tokens"
    if adapter_caps.long_context_tokens < requirement.context_required_tokens:
        return "MR_CAPABILITY_NOT_MET:adapter_context_tokens"
    if requirement.structure_strictness == "high" and (
        not adapter_caps.structured_output or not profile_caps.structured_output_native
    ):
        return "MR_CAPABILITY_NOT_MET:structured_output"
    if requirement.tool_complexity in {"simple", "complex"} and (
        not adapter_caps.tool_call or not profile_caps.tool_call
    ):
        return "MR_CAPABILITY_NOT_MET:tool_call"
    if requirement.tool_complexity in {"simple", "complex"} and _unsupported_builtin_tools(
        request.node_contract_snapshot.allowed_tools,
        adapter_caps,
    ):
        return "MR_CAPABILITY_NOT_MET:unsupported_builtin_tools"
    if requirement.tool_complexity == "complex" and not (adapter_caps.mcp or adapter_caps.evidence_lookup_tool):
        return "MR_CAPABILITY_NOT_MET:complex_tools"
    if not requirement.multi_modal_required.issubset(adapter_caps.multi_modal & profile_caps.multi_modal):
        return "MR_CAPABILITY_NOT_MET:multi_modal"
    if requirement.reasoning_required == "high" and not profile_caps.reasoning_supported:
        return "MR_CAPABILITY_NOT_MET:reasoning"
    if requirement.human_required and not adapter_caps.human_in_the_loop:
        return "MR_CAPABILITY_NOT_MET:human_in_the_loop"
    return None


def _unsupported_builtin_tools(allowed_tools: Sequence[str], adapter_caps: AdapterCapabilities) -> list[str]:
    if not allowed_tools:
        return []
    cw_metadata = adapter_caps.metadata.get("cw")
    if not isinstance(cw_metadata, Mapping):
        return []
    if cw_metadata.get("supports_unlisted_builtin_tools") is True:
        return []
    raw_supported = cw_metadata.get("supported_builtin_tools")
    if isinstance(raw_supported, str) or not isinstance(raw_supported, Sequence):
        return []
    supported = {item for item in raw_supported if isinstance(item, str)}
    return [tool_id for tool_id in allowed_tools if tool_id not in supported]


def _apply_node_policy(
    request: RoutingRequest,
    registry: ResolvedProfileRegistry,
    candidates: Sequence[_Candidate],
) -> tuple[list[_Candidate], list[RemovedCandidate], str]:
    primary = request.node_contract_snapshot.model_policy.primary_model_profile_id
    if primary == "auto":
        return list(candidates), [], "primary='auto'"
    profile = registry.profile_by_id().get(primary)
    if profile is not None and _sensitive_remote_forbidden(request, profile):
        raise ModelRouterError(
            "MR_SENSITIVE_DATA_REMOTE_FORBIDDEN",
            "Sensitive routing requirements forbid the primary cloud ModelProfile.",
            details={"model_profile_id": primary},
        )
    if profile is not None and profile.disabled:
        raise ModelRouterError(
            "MR_PROFILE_DISABLED", "Primary ModelProfile is disabled.", details={"model_profile_id": primary}
        )
    kept = [candidate for candidate in candidates if candidate.profile.model_profile_id == primary]
    removed = [
        _removed(candidate, "MR_PRIMARY_PROFILE_NOT_AVAILABLE:not_primary")
        for candidate in candidates
        if candidate not in kept
    ]
    return kept, removed, f"primary={primary}"


def _apply_escalation(
    request: RoutingRequest,
    registry: ResolvedProfileRegistry,
    candidates: Sequence[_Candidate],
) -> tuple[list[_Candidate], int, list[str]]:
    source_chain = _source_escalation_chain(request)
    if len(source_chain) > 5:
        raise ModelRouterError("MR_ESCALATION_CHAIN_TOO_LONG", "Model escalation chain is longer than 5 entries.")
    if request.escalation_trigger is None:
        return list(candidates), 0, source_chain
    trigger = request.escalation_trigger
    try:
        current_index = source_chain.index(trigger.from_model_profile_id)
    except ValueError as exc:
        raise ModelRouterError(
            "MR_ESCALATION_NON_LINEAR",
            "Escalation trigger starts from a profile outside the escalation chain.",
            details={"from_model_profile_id": trigger.from_model_profile_id, "escalation_chain": source_chain},
        ) from exc
    next_index = current_index + 1
    if next_index >= len(source_chain):
        raise ModelRouterError("MR_ESCALATION_EXHAUSTED", "Model escalation chain is exhausted.")
    next_profile_id = source_chain[next_index]
    if next_profile_id not in registry.profile_by_id():
        raise ModelRouterError(
            "MR_PRIMARY_PROFILE_NOT_AVAILABLE",
            "Escalation chain references an unknown ModelProfile.",
            details={"model_profile_id": next_profile_id},
        )
    forced = [candidate for candidate in candidates if candidate.profile.model_profile_id == next_profile_id]
    if not forced:
        raise ModelRouterError(
            "MR_CAPABILITY_NOT_MET",
            "Escalation target does not satisfy current routing filters.",
            details={"model_profile_id": next_profile_id},
        )
    return forced, next_index, source_chain


def _rank_candidates(candidates: Sequence[_Candidate], *, default_profile_ids: Sequence[str]) -> list[_Candidate]:
    scored: list[_Candidate] = []
    for candidate in candidates:
        performance = 0.5 if candidate.performance_score is None else candidate.performance_score
        score = 0.6 * candidate.capability_score - 0.3 * candidate.cost_score + 0.1 * performance
        scored.append(candidate.model_copy(update={"score": score}))
    return sorted(
        scored,
        key=lambda candidate: (
            _default_profile_rank(candidate.profile.model_profile_id, default_profile_ids),
            -candidate.score,
            candidate.adapter.priority,
            candidate.adapter.adapter_id,
            candidate.profile.model_profile_id,
        ),
    )


def _effective_model_settings(profile: ModelProfile, request: RoutingRequest) -> dict[str, Any]:
    return {
        **profile.default_model_settings,
        **request.node_contract_snapshot.model_policy.model_settings,
    }


def _default_profile_ids(request: RoutingRequest) -> list[str]:
    profile_ids = [request.workflow_model_policy.default_model_profile_id]
    if request.project_settings_models.default_model_profile_id is not None:
        profile_ids.append(request.project_settings_models.default_model_profile_id)
    return profile_ids


def _default_profile_rank(profile_id: str, default_profile_ids: Sequence[str]) -> int:
    try:
        return default_profile_ids.index(profile_id)
    except ValueError:
        return len(default_profile_ids)


def _sensitive_remote_forbidden(request: RoutingRequest, profile: ModelProfile) -> bool:
    return (
        profile.provider_kind == ProviderKind.CLOUD
        and request.requirement.risk_level == "high"
        and (
            request.node_contract_snapshot.forbid_remote_models
            or request.workflow_model_policy.forbid_remote_for_sensitive
            or request.project_settings_models.forbid_remote_for_sensitive
        )
    )


def _ensure_required_model_settings(settings: Mapping[str, Any]) -> None:
    missing = [key for key in ("temperature", "top_p", "max_tokens") if key not in settings]
    if missing:
        raise ModelRouterError(
            "MR_REQUIRED_SETTING_MISSING",
            "Required model settings are missing after merge.",
            details={"missing": missing},
        )


def _source_escalation_chain(request: RoutingRequest) -> list[str]:
    node_chain = request.node_contract_snapshot.model_policy.escalation_chain
    if node_chain:
        return list(node_chain)
    if request.workflow_model_policy.escalation_chain:
        return list(request.workflow_model_policy.escalation_chain)
    return list(request.project_settings_models.escalation_chain)


def _decision_escalation_chain(selected_profile_id: str, source_chain: Sequence[str]) -> list[str]:
    if selected_profile_id in source_chain:
        return list(source_chain)
    return [selected_profile_id, *[profile_id for profile_id in source_chain if profile_id != selected_profile_id]]


def _validate_escalation_chain(
    chain: Sequence[str],
    profiles_by_id: Mapping[str, ModelProfile],
) -> None:
    if len(chain) > 5:
        raise ModelRouterError("MR_ESCALATION_CHAIN_TOO_LONG", "Model escalation chain is longer than 5 entries.")
    seen: set[str] = set()
    for profile_id in chain:
        if profile_id in seen:
            raise ModelRouterError(
                "MR_ESCALATION_NON_LINEAR",
                "Model escalation chain contains duplicate profile ids.",
                details={"model_profile_id": profile_id},
            )
        seen.add(profile_id)
        if profile_id not in profiles_by_id:
            raise ModelRouterError(
                "MR_PRIMARY_PROFILE_NOT_AVAILABLE",
                "Model escalation chain references an unknown profile.",
                details={"model_profile_id": profile_id},
            )
    for current, next_profile in pairwise(chain):
        current_profile = profiles_by_id[current]
        next_profile_obj = profiles_by_id[next_profile]
        if current_profile.provider_kind == ProviderKind.LOCAL and next_profile_obj.provider_kind == ProviderKind.CLOUD:
            raise ModelRouterError(
                "MR_ESCALATION_CROSS_PROVIDER_KIND_FORBIDDEN",
                "Escalation chain cannot move from local to cloud in Phase 1.",
                details={"from": current, "to": next_profile},
            )


def _contract_with_primary_override(
    contract: NodeContractBase,
    primary_model_profile_id: str | None,
) -> NodeContractBase:
    if primary_model_profile_id is None:
        return contract
    return contract.model_copy(
        update={
            "model_policy": contract.model_policy.model_copy(
                update={"primary_model_profile_id": primary_model_profile_id}
            )
        }
    )


def _cost_score(tier: CostTier) -> float:
    return {"local_free": 0.0, "cheap": 0.2, "standard": 0.4, "premium": 0.8}[tier]


def _removed(candidate: _Candidate, reason: str) -> RemovedCandidate:
    return RemovedCandidate(
        model_profile_id=candidate.profile.model_profile_id,
        adapter_id=candidate.adapter.adapter_id,
        reason=reason,
    )


def _append_step(
    steps: list[RoutingReasoningStep],
    step: RoutingStep,
    *,
    before: int,
    after: int,
    removed: Iterable[RemovedCandidate] = (),
    notes: str | None = None,
) -> None:
    steps.append(
        RoutingReasoningStep(
            step=step,
            before_count=before,
            after_count=after,
            removed=list(removed),
            notes=notes,
        )
    )


def _score_notes(candidates: Sequence[_Candidate]) -> str:
    return "scores: " + ", ".join(
        f"{candidate.profile.model_profile_id}={candidate.score:.3f}" for candidate in candidates
    )


__all__ = [
    "AdapterCapabilities",
    "AdapterDescriptor",
    "ModelCapabilities",
    "ModelCostProfile",
    "ModelPerformanceProfile",
    "ModelProfile",
    "ModelRouterError",
    "NodeCapabilityRequirement",
    "ProjectModelSettings",
    "ResolvedProfileRegistry",
    "RoutingCandidate",
    "RoutingDecision",
    "RoutingRequest",
    "RoutingTrace",
    "build_routing_request",
    "build_routing_trace",
    "load_project_model_settings",
    "resolve_model_profile_registry",
    "route_model",
]
