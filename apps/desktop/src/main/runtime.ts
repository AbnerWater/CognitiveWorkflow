export const RUNTIME_API_PREFIX = "/cw/v1" as const;

export type RuntimeBaseUrl =
  `http://127.0.0.1:${number}${typeof RUNTIME_API_PREFIX}`;

export interface RuntimeReady {
  readonly port: number;
  readonly base_url: RuntimeBaseUrl;
  readonly raw_line: string;
}

export interface RuntimeConnectionInfo {
  readonly base_url: RuntimeBaseUrl;
  readonly token: string;
}

const READY_LINE = /^READY\s+([1-9]\d{0,4})$/u;

export function isValidRuntimePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function createRuntimeBaseUrl(port: number): RuntimeBaseUrl {
  if (!isValidRuntimePort(port)) {
    throw new RangeError(
      `Runtime port must be an integer in 1..65535; received ${port}`,
    );
  }

  return `http://127.0.0.1:${port}${RUNTIME_API_PREFIX}` as RuntimeBaseUrl;
}

export function parseRuntimeReadyLine(line: string): RuntimeReady | null {
  const normalized = line.trim();
  const match = READY_LINE.exec(normalized);
  if (match === null) {
    return null;
  }

  const port = Number.parseInt(match[1] ?? "", 10);
  if (!isValidRuntimePort(port)) {
    return null;
  }

  return {
    port,
    base_url: createRuntimeBaseUrl(port),
    raw_line: normalized,
  };
}

export function buildRuntimeConnectionInfo(
  ready: RuntimeReady,
  token: string,
): RuntimeConnectionInfo {
  const normalizedToken = token.trim();
  if (
    normalizedToken.length === 0 ||
    /[\u0000-\u001f\u007f\s]/u.test(normalizedToken)
  ) {
    throw new Error(
      "Runtime auth token must be non-empty and contain no whitespace or control characters",
    );
  }

  return {
    base_url: ready.base_url,
    token: normalizedToken,
  };
}
