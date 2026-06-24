const CHAT_TEXT_EVIDENCE_FIELDS = new Set([
  "chatDraftValue",
  "chatDraftDetailsText",
  "chatDraftPreviewText",
  "chatLocalSubmissionText",
]);

const REDACTED_CHAT_TEXT = "[redacted chat text]";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addSensitiveFragment(fragments, value) {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    addSensitiveFragmentVariant(fragments, value);
    addSensitiveFragmentVariant(fragments, trimmed);
  }
}

function addSensitiveFragmentVariant(fragments, value) {
  if (value.length === 0) {
    return;
  }
  fragments.add(value);
  fragments.add(JSON.stringify(value).slice(1, -1));
}

function collectSensitiveChatTextFragments(value, extraFragments = []) {
  const fragments = new Set();
  for (const fragment of extraFragments) {
    addSensitiveFragment(fragments, fragment);
  }

  const visit = (current) => {
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }
    if (!isRecord(current)) {
      return;
    }
    for (const [key, nestedValue] of Object.entries(current)) {
      if (CHAT_TEXT_EVIDENCE_FIELDS.has(key)) {
        addSensitiveFragment(fragments, nestedValue);
      }
      visit(nestedValue);
    }
  };

  visit(value);
  return [...fragments].sort((left, right) => right.length - left.length);
}

function redactSensitiveChatText(value, sensitiveFragments) {
  if (typeof value !== "string") {
    return value;
  }
  let redactedValue = value;
  for (const fragment of sensitiveFragments) {
    redactedValue = redactedValue.split(fragment).join(REDACTED_CHAT_TEXT);
  }
  return redactedValue;
}

function sanitizeVisualSmokeEvidenceValue(value, sensitiveFragments) {
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeVisualSmokeEvidenceValue(item, sensitiveFragments),
    );
  }
  if (!isRecord(value)) {
    return redactSensitiveChatText(value, sensitiveFragments);
  }

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (CHAT_TEXT_EVIDENCE_FIELDS.has(key)) {
      continue;
    }
    sanitized[key] = sanitizeVisualSmokeEvidenceValue(
      nestedValue,
      sensitiveFragments,
    );
  }
  return sanitized;
}

function sanitizeVisualSmokeEvidence(value, options = {}) {
  const sensitiveFragments = collectSensitiveChatTextFragments(
    value,
    options.sensitiveTextFragments,
  );
  return sanitizeVisualSmokeEvidenceValue(value, sensitiveFragments);
}

function sanitizeVisualSmokeText(value, options = {}) {
  const sensitiveFragments = collectSensitiveChatTextFragments(
    null,
    options.sensitiveTextFragments,
  );
  return redactSensitiveChatText(String(value), sensitiveFragments);
}

module.exports = {
  CHAT_TEXT_EVIDENCE_FIELDS,
  REDACTED_CHAT_TEXT,
  collectSensitiveChatTextFragments,
  sanitizeVisualSmokeEvidence,
  sanitizeVisualSmokeText,
};
