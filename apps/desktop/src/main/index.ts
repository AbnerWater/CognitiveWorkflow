export {
  DESKTOP_WINDOW_SECURITY,
  assertStrictContentSecurityPolicy,
  buildContentSecurityPolicy,
  getDesktopWindowSecurity,
  type ContentSecurityPolicyOptions,
  type DesktopWindowSecurity,
} from "./security.js";

export {
  RUNTIME_IPC_CHANNELS,
  RUNTIME_IPC_CONNECTION_INFO_CHANNEL,
  RUNTIME_IPC_FETCH_CHANNEL,
  RUNTIME_IPC_METHODS,
  assertRuntimeIpcChannel,
  assertRuntimeIpcRequestPath,
  buildRuntimeIpcFetchRequest,
  buildRuntimeIpcRequestHeaders,
  isRuntimeIpcChannel,
  parseRuntimeIpcFetchRequestPayload,
  type RuntimeIpcChannel,
  type RuntimeIpcConnectionInfo,
  type RuntimeIpcFetchInit,
  type RuntimeIpcFetchRequest,
  type RuntimeIpcMainHandlers,
  type RuntimeIpcMethod,
  type RuntimeIpcRequestHeadersInput,
  type RuntimeIpcRequestPath,
  type RuntimeIpcResponse,
} from "../shared/runtime-ipc.js";

export {
  RUNTIME_API_PREFIX,
  buildRuntimeConnectionInfo,
  createRuntimeBaseUrl,
  isValidRuntimePort,
  normalizeRuntimeAuthToken,
  parseRuntimeReadyLine,
  type RuntimeConnectionInfo,
  type RuntimeReady,
} from "./runtime.js";

export {
  createRuntimeIpcMainHandlers,
  normalizeRuntimeConnectionInfo,
  type RuntimeConnectionInfoProvider,
  type RuntimeIpcMainHandlerOptions,
} from "./runtime-ipc-handlers.js";

export {
  DEFAULT_RUNTIME_CONNECTION_REGISTRY,
  createRuntimeConnectionRegistry,
  type RuntimeConnectionRegistry,
  type RuntimeConnectionRegistryEntry,
  type RuntimeConnectionRegistryOptions,
  type RuntimeConnectionRegistryProjectRootCaseSensitivity,
  type RuntimeConnectionRegistryProjectRootRealpathResolver,
  type RuntimeConnectionRegistryRegisterOptions,
} from "./runtime-connection-registry.js";

export {
  resolveRuntimeConnectionHandoff,
  type ResolveRuntimeConnectionHandoffOptions,
  type RuntimeConnectionHandoffAction,
  type RuntimeConnectionHandoffDecision,
  type RuntimeConnectionHandoffResolver,
} from "./runtime-handoff.js";

export {
  DEFAULT_RUNTIME_STARTUP_LIFECYCLE_RETRY_MS,
  DEFAULT_RUNTIME_STARTUP_LIFECYCLE_TIMEOUT_MS,
  resolveRuntimeStartupLifecycle,
  type ResolveRuntimeStartupLifecycleOptions,
  type RuntimeConnectionHandoffProvider,
  type RuntimeStartupLifecycleAction,
  type RuntimeStartupLifecycleDecision,
  type RuntimeStartupLifecycleSleep,
  type RuntimeStartupLifecycleTransition,
} from "./runtime-lifecycle.js";

export {
  mapRuntimeStartupDecisionToStatus,
  mapRuntimeStartupTransitionToStatus,
  type RuntimeStartupStatus,
  type RuntimeStartupStatusAction,
  type RuntimeStartupStatusKind,
  type RuntimeStartupStatusSeverity,
} from "./runtime-startup-status.js";

export {
  startRuntimeWithLifecycle,
  type RuntimeOrchestrationStarter,
  type RuntimeStartupBlockedDecision,
  type RuntimeStartupControllerLifecycleOptions,
  type RuntimeStartupControllerResult,
  type RuntimeStartupLifecycleResolver,
  type RuntimeStartupReuseDecision,
  type RuntimeStartupStartDecision,
  type RuntimeStartupTimeoutDecision,
  type StartRuntimeWithLifecycleOptions,
} from "./runtime-startup-controller.js";

export {
  RuntimeStartupUnavailableError,
  createRuntimeIpcMainChannelRegistrations,
  createRuntimeIpcStartupHandlers,
  type CreateRuntimeIpcStartupHandlersOptions,
  type RuntimeIpcMainChannelRegistration,
  type RuntimeIpcStartupControllerStarter,
  type RuntimeIpcStartupHandlerSnapshot,
  type RuntimeIpcStartupHandlerState,
  type RuntimeIpcStartupHandlers,
} from "./runtime-ipc-main-factory.js";

export {
  startRuntimeOrchestration,
  type RuntimeOrchestrationLockOptions,
  type RuntimeOrchestrationSession,
  type StartRuntimeOrchestrationOptions,
} from "./runtime-orchestration.js";

export {
  AGENT_WORKFLOW_DIRNAME,
  DEFAULT_RUNTIME_LOCK_ACQUIRE_TIMEOUT_MS,
  DEFAULT_RUNTIME_LOCK_ADAPTER_ID,
  DEFAULT_RUNTIME_LOCK_RETRY_MS,
  DEFAULT_RUNTIME_LOCK_STALE_MS,
  RUNTIME_LOCKS_DIRNAME,
  RUNTIME_LOCK_FILENAME,
  RUNTIME_LOCK_MUTATION_GUARD_SUFFIX,
  acquireRuntimeLock,
  buildRuntimeLockContent,
  decideRuntimeLockAction,
  inspectRuntimeLock,
  parseRuntimeLockContent,
  resolveRuntimeLockPath,
  type AcquireRuntimeLockOptions,
  type BuildRuntimeLockContentOptions,
  type InspectRuntimeLockOptions,
  type RuntimeLockAction,
  type RuntimeLockEnsureDirectory,
  type RuntimeLockInspection,
  type RuntimeLockLease,
  type RuntimeLockRemoveFile,
  type RuntimeLockReadText,
  type RuntimeLockRecord,
  type RuntimeLockSleep,
  type RuntimeLockStatus,
  type RuntimeLockWriteTextExclusive,
} from "./runtime-lock.js";

export {
  PACKAGED_RUNTIME_DIRNAME,
  RUNTIME_EXECUTABLE_BASENAME,
  getRuntimeExecutableName,
  resolvePackagedRuntimePath,
  resolveRuntimeCommand,
  type ResolveRuntimeCommandOptions,
  type RuntimeCommand,
  type RuntimeCommandSource,
  type RuntimeExecutableExists,
} from "./runtime-command.js";

export {
  DEFAULT_RUNTIME_READY_TIMEOUT_MS,
  RUNTIME_AUTH_TOKEN_BYTES,
  RUNTIME_AUTH_TOKEN_ENV,
  RUNTIME_HTTP_PORT_ARG,
  buildRuntimeSidecarArgs,
  buildRuntimeSidecarEnvironment,
  generateRuntimeAuthToken,
  startRuntimeSidecar,
  type RuntimeSidecarExit,
  type RuntimeSidecarProcess,
  type RuntimeSidecarSession,
  type RuntimeSidecarSpawn,
  type RuntimeSidecarSpawnOptions,
  type StartRuntimeSidecarOptions,
} from "./sidecar.js";
