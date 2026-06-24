function parseTargetLocation(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("CW_VISUAL_SMOKE_URL must be a valid URL");
  }
  const streamEventMode =
    parsedUrl.searchParams.get("streamEvent") === "unknown"
      ? "unknown"
      : "known";
  return {
    origin: parsedUrl.origin,
    pathname: parsedUrl.pathname,
    streamEventMode,
  };
}

function parsePositiveIntegerEnv(env, name, defaultValue) {
  const value = env[name] ?? defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeIntegerEnv(env, name, defaultValue) {
  const value = env[name] ?? defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function resolveVisualSmokePreflight(env) {
  const targetUrl = env.CW_VISUAL_SMOKE_URL;
  const outputPath = env.CW_VISUAL_SMOKE_OUTPUT;
  if (!targetUrl || !outputPath) {
    throw new Error(
      "CW_VISUAL_SMOKE_URL and CW_VISUAL_SMOKE_OUTPUT are required",
    );
  }
  const targetLocation = parseTargetLocation(targetUrl);
  return {
    targetUrl,
    outputPath,
    width: parsePositiveIntegerEnv(env, "CW_VISUAL_SMOKE_WIDTH", "1280"),
    height: parsePositiveIntegerEnv(env, "CW_VISUAL_SMOKE_HEIGHT", "720"),
    scrollY: parseNonNegativeIntegerEnv(env, "CW_VISUAL_SMOKE_SCROLL_Y", "0"),
    targetLocation,
    streamEventMode: targetLocation.streamEventMode,
  };
}

module.exports = {
  parseTargetLocation,
  parsePositiveIntegerEnv,
  parseNonNegativeIntegerEnv,
  resolveVisualSmokePreflight,
};
