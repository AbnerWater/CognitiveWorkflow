function collectChatLocalHistoryLayoutFailures({
  chatLocalHistoryMetrics,
  requestedWidth,
}) {
  if (requestedWidth > 520) {
    return [];
  }

  const failures = [];
  const columnCount =
    chatLocalHistoryMetrics?.chatLocalSubmissionHistoryColumnCount;
  if (columnCount !== 2) {
    failures.push(
      `expected mobile chat local history columns 2, got ${columnCount}`,
    );
  }

  const clientWidth =
    chatLocalHistoryMetrics?.chatLocalSubmissionHistoryClientWidth;
  const scrollWidth =
    chatLocalHistoryMetrics?.chatLocalSubmissionHistoryScrollWidth;
  if (typeof clientWidth !== "number" || typeof scrollWidth !== "number") {
    failures.push(
      `expected mobile chat local history measured widths, got client ${clientWidth} scroll ${scrollWidth}`,
    );
  } else if (scrollWidth > clientWidth) {
    failures.push(
      `expected mobile chat local history no horizontal item overflow, got client ${clientWidth} scroll ${scrollWidth}`,
    );
  }

  return failures;
}

module.exports = {
  collectChatLocalHistoryLayoutFailures,
};
