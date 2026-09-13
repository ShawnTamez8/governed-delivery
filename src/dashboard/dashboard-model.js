/**
 * Pure presentation model for the read-only dashboard.
 *
 * Every function here is a total function over values the authenticated read
 * routes already return. Nothing in this module reads the DOM, the network,
 * SQLite, Git, or raw provider output, and nothing invents a value the
 * authoritative projection does not carry: a quantity the source does not
 * report becomes an explicit unavailable state, never zero.
 */

/** @typedef {import("../operator-state.ts").RunSnapshot} RunSnapshot */
/** @typedef {import("../operator-state.ts").CostTotals} CostTotals */
/** @typedef {import("../operator-state.ts").RunPhase} RunPhase */

/** @typedef {"input" | "output" | "cacheRead" | "cacheWrite"} TokenClassKey */
/** @typedef {{ key: TokenClassKey, label: string, known: number | null, reportedRows: number, unreportedRows: number }} TokenClassTotal */
/** @typedef {{ known: number | null, classes: TokenClassTotal[], partial: boolean }} TokenTotal */

/** @typedef {{ id: number, project: string, featureId: string, slug: string, status: string, phase: string, lastRecordedAt: string }} RunSummary */
/** @typedef {{ runId: number, snapshot: RunSnapshot | null, stale: boolean, loading: boolean }} SnapshotView */
/**
 * @typedef {{
 *  repositoryId: string,
 *  path: string,
 *  available: boolean,
 *  runs: RunSummary[],
 *  limit: number | null,
 *  hasMore: boolean,
 *  snapshots: SnapshotView[],
 * }} RepositoryView
 */

/** The four token classes the authoritative projection reports, in fixed order. */
/** @type {readonly { key: TokenClassKey, label: string }[]} */
export const TOKEN_CLASSES = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
];

export const TREND_UNAVAILABLE = "trend_unavailable";
export const TREND_UNAVAILABLE_LABEL = "Trend unavailable";
export const AGENT_MODEL_UNAVAILABLE = "Not reported at agent level";
export const AVERAGE_EXECUTION_UNAVAILABLE_REASON =
  "The authoritative run projection records no agent execution duration, and run wall-clock, stage elapsed, or verification-command time is not a substitute.";

/* ------------------------------------------------------------------ *
 * Presentation primitives
 *
 * Each narrows how a recorded value is shown without altering, re-deriving,
 * or discarding it: the exact recorded form stays on the returned object so
 * the render layer can keep it reachable.
 * ------------------------------------------------------------------ */

/** @typedef {{ available: boolean, display: string, exact: string }} UsdPresentation */

/**
 * Money as two decimal places for reading, with the recorded value retained
 * verbatim. The input is already an aggregate; this never rounds a component,
 * sums, or re-derives a total.
 * @param {number | null} value
 * @returns {UsdPresentation}
 */
export function usdPresentation(value) {
  if (value === null) return { available: false, display: "Unavailable", exact: "Unavailable" };
  return { available: true, display: `$${value.toFixed(2)}`, exact: `$${value}` };
}

/** The number of leading characters of a recorded identifier shown by default. */
export const IDENTITY_FRAGMENT_LENGTH = 12;

/** @typedef {{ available: boolean, display: string, full: string, truncated: boolean }} IdentityPresentation */

/**
 * A long recorded identifier shortened for reading. The untruncated string
 * stays on `full` so the render layer can expose it to assistive technology
 * and to a copy affordance; nothing here pads, normalises, or re-cases it.
 * @param {string | null} value
 * @param {number} [length]
 * @returns {IdentityPresentation}
 */
export function identityPresentation(value, length = IDENTITY_FRAGMENT_LENGTH) {
  if (value === null || value === "") return { available: false, display: "Not recorded", full: "", truncated: false };
  if (value.length <= length) return { available: true, display: value, full: value, truncated: false };
  return { available: true, display: `${value.slice(0, length)}\u2026`, full: value, truncated: true };
}

/**
 * Whether a recorded artifact changed, stated in words rather than left to a
 * by-eye comparison of two hashes. Both recorded hashes stay reachable.
 * @param {string | null} before
 * @param {string | null} after
 */
export function artifactChange(before, after) {
  const beforePresentation = identityPresentation(before);
  const afterPresentation = identityPresentation(after);
  if (!beforePresentation.available || !afterPresentation.available) {
    const missing = !beforePresentation.available && !afterPresentation.available
      ? "Neither the before nor the after artifact hash is recorded"
      : !beforePresentation.available
        ? "The before artifact hash is not recorded"
        : "The after artifact hash is not recorded";
    return {
      before: beforePresentation,
      after: afterPresentation,
      equal: /** @type {boolean | null} */ (null),
      statement: `${missing}, so whether the recorded artifact changed cannot be determined.`,
    };
  }
  const equal = beforePresentation.full === afterPresentation.full;
  return {
    before: beforePresentation,
    after: afterPresentation,
    equal,
    statement: equal
      ? "The recorded artifact is unchanged: the before and after hashes are identical."
      : "The recorded artifact changed: the before and after hashes differ.",
  };
}

/** @typedef {{ available: boolean, utc: string, display: string }} TimestampPresentation */

/**
 * A recorded timestamp shown in the viewer's zone with the recorded UTC string
 * retained byte-for-byte. Never throws: an unparseable value, or a time zone
 * the runtime rejects, becomes an explicit unavailable state.
 * @param {string | null} value
 * @param {string} [timeZone]
 * @returns {TimestampPresentation}
 */
export function timestampPresentation(value, timeZone = undefined) {
  const unavailable = { available: false, utc: "", display: "Unavailable" };
  if (value === null || value === "") return unavailable;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return unavailable;
  try {
    const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium", timeZone });
    return { available: true, utc: value, display: formatter.format(new Date(parsed)) };
  } catch {
    return unavailable;
  }
}

/**
 * Reduce several recorded timestamps to the most recent one plus the rest, so
 * a summary can show one line and keep the others behind a disclosure. Input
 * order is preserved among `others`; an unparseable entry is never `latest`.
 * @param {readonly { label: string, value: string | null }[]} entries
 */
export function latestTimestamp(entries) {
  /** @type {{ label: string, value: string | null } | null} */
  let latest = null;
  let latestParsed = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry.value === null || entry.value === "") continue;
    const parsed = Date.parse(entry.value);
    if (Number.isNaN(parsed) || parsed <= latestParsed) continue;
    latest = entry;
    latestParsed = parsed;
  }
  return { latest, others: entries.filter((entry) => entry !== latest) };
}

/* ------------------------------------------------------------------ *
 * Repetition collapse
 *
 * A value repeated on every row of a table is a constant, not a column, and
 * a qualifier repeated on every cell is a section statement. Both are decided
 * per render against the rows actually present.
 * ------------------------------------------------------------------ */

/**
 * Whether every row carries the same accessed value. Zero rows are never a
 * constant column: an absent collection is governed by the empty-collection
 * rule, not by collapse. Evaluated against the rows given, so a column that is
 * constant in one run and varying in another is treated correctly in each.
 * @template T
 * @param {readonly T[]} rows
 * @param {(row: T) => unknown} accessor
 * @returns {{ constant: boolean, value: unknown, rowCount: number }}
 */
export function constantColumn(rows, accessor) {
  if (rows.length === 0) return { constant: false, value: null, rowCount: 0 };
  const first = accessor(rows[0]);
  for (const row of rows) if (accessor(row) !== first) return { constant: false, value: null, rowCount: rows.length };
  return { constant: true, value: first, rowCount: rows.length };
}

/**
 * The sentence that replaces a collapsed constant column. The recorded value is
 * interpolated unchanged, so it stays verbatim and selectable.
 * @param {string} columnLabel
 * @param {unknown} value
 * @param {number} rowCount
 */
export function collapsedColumnStatement(columnLabel, value, rowCount) {
  const rows = rowCount === 1 ? "the single recorded row" : `all ${rowCount} recorded rows`;
  return `${columnLabel} is ${String(value)} for ${rows}.`;
}

/**
 * The per-cell coverage parenthetical, present only where a contributing row
 * reported nothing. A fully reported cell carries no qualifier at all.
 * @param {{ reportedRows: number, unreportedRows: number }} entry
 * @returns {string | null}
 */
export function coverageQualifier(entry) {
  if (entry.unreportedRows <= 0) return null;
  const total = entry.reportedRows + entry.unreportedRows;
  return `${entry.reportedRows} of ${total} rows reported`;
}

/**
 * The one section-level sentence that replaces a qualifier repeated on every
 * cell, available only when every entry is fully reported.
 * @param {readonly { reportedRows: number, unreportedRows: number }[]} entries
 * @returns {string | null}
 */
export function fullCoverageStatement(entries) {
  if (entries.length === 0) return null;
  if (entries.some((entry) => entry.unreportedRows > 0)) return null;
  return "Every contributing row reported this section's totals.";
}

export const AGENT_TOKEN_CLASS_NOTE =
  "Input, output, cache-read, and cache-write totals are reported separately. An input total shown without its cache-read counterpart misrepresents what the run consumed, so all four are listed even where a class reported nothing.";

/**
 * Sum the four reported token classes across any set of cost groups. A class
 * with no reporting row stays `null`; it never becomes a zero total.
 * @param {readonly CostTotals[]} costs
 * @returns {TokenTotal}
 */
function aggregateTokens(costs) {
  const classes = TOKEN_CLASSES.map(({ key, label }) => {
    let known = 0;
    let reportedRows = 0;
    let unreportedRows = 0;
    for (const cost of costs) {
      const coverage = cost.tokens[key];
      if (coverage.known !== null) known += coverage.known;
      reportedRows += coverage.reportedRows;
      unreportedRows += coverage.unreportedRows;
    }
    return { key, label, known: reportedRows === 0 ? null : known, reportedRows, unreportedRows };
  });
  const reported = classes.filter((entry) => entry.known !== null);
  return {
    known: reported.length === 0 ? null : reported.reduce((sum, entry) => sum + (entry.known ?? 0), 0),
    classes,
    partial: classes.some((entry) => entry.known === null || entry.unreportedRows > 0),
  };
}

/**
 * Reported token coverage for one cost group.
 * @param {CostTotals} cost
 * @returns {TokenTotal}
 */
export function tokenTotal(cost) {
  return aggregateTokens([cost]);
}

/**
 * Known spend for one cost group. Unavailable when no contributing agent row
 * reported a cost, because unreported rows are not zero-cost executions.
 * @param {readonly CostTotals[]} costs
 */
function aggregateCost(costs) {
  let knownUsd = 0;
  let reportedRows = 0;
  let unreportedRows = 0;
  let agentRows = 0;
  let recordedFailedAttempts = 0;
  for (const cost of costs) {
    knownUsd += cost.knownUsd;
    reportedRows += cost.costReportedRows;
    unreportedRows += cost.costUnreportedRows;
    agentRows += cost.agentRows;
    recordedFailedAttempts += cost.recordedFailedAttempts;
  }
  return {
    knownUsd: reportedRows === 0 ? null : knownUsd,
    reportedRows,
    unreportedRows,
    agentRows,
    recordedFailedAttempts,
    partial: unreportedRows > 0,
  };
}

/**
 * Classify one snapshot slot for coverage reporting.
 * @param {SnapshotView} view
 * @returns {"fresh" | "stale" | "pending" | "unavailable"}
 */
export function snapshotState(view) {
  if (view.snapshot !== null) return view.stale ? "stale" : "fresh";
  return view.loading ? "pending" : "unavailable";
}

/**
 * Portfolio metrics over the currently loaded run window across every
 * configured repository. Display filters do not narrow this scope; the
 * repository run limit does, and `limitedScope` says so whenever any
 * repository reported `hasMore`.
 *
 * Run counts come from loaded run summaries. Findings, cost, and tokens come
 * only from run IDs in that same window that also carry a complete snapshot
 * envelope, so a cached snapshot outside the window contributes nothing.
 * @param {readonly RepositoryView[]} repositories
 */
export function portfolioProjection(repositories) {
  /** @type {RunSummary[]} */
  const runs = [];
  /** @type {RunSnapshot[]} */
  const contributing = [];
  const coverage = { loadedRuns: 0, fresh: 0, stale: 0, pending: 0, unavailable: 0 };
  let limitedScope = false;
  let repositoriesUnavailable = 0;
  for (const repository of repositories) {
    if (!repository.available) repositoriesUnavailable++;
    if (repository.hasMore) limitedScope = true;
    const windowIds = new Set(repository.runs.map((run) => run.id));
    runs.push(...repository.runs);
    const slots = new Map(repository.snapshots.map((view) => [view.runId, view]));
    for (const runId of windowIds) {
      coverage.loadedRuns++;
      const view = slots.get(runId);
      const state = view === undefined ? "unavailable" : snapshotState(view);
      coverage[state]++;
      if (view?.snapshot != null) contributing.push(view.snapshot);
    }
  }
  const blockedRuns = runs.filter((run) => run.status === "blocked").length;
  const activeRuns = runs.filter((run) => run.status === "in_progress").length;
  const completedRuns = runs.filter((run) => run.status === "completed").length;
  const terminalRuns = completedRuns + blockedRuns;
  const costs = contributing.map((snapshot) => snapshot.cost);
  const cost = aggregateCost(costs);
  const tokens = aggregateTokens(costs);
  const snapshotsContributing = contributing.length;
  return {
    runs: runs.length,
    blockedRuns,
    activeRuns,
    completedRuns,
    successRate: {
      value: terminalRuns === 0 ? null : completedRuns / terminalRuns,
      completedRuns,
      blockedRuns,
      terminalRuns,
    },
    findings: {
      value: snapshotsContributing === 0
        ? null
        : contributing.reduce((sum, snapshot) => sum + snapshot.evidence.findings.length, 0),
    },
    cost: snapshotsContributing === 0
      ? { knownUsd: null, reportedRows: 0, unreportedRows: 0, agentRows: 0, recordedFailedAttempts: 0, partial: false }
      : cost,
    tokens: snapshotsContributing === 0
      ? { known: null, classes: TOKEN_CLASSES.map(({ key, label }) => ({ key, label, known: null, reportedRows: 0, unreportedRows: 0 })), partial: false }
      : tokens,
    averageExecution: { value: null, reason: AVERAGE_EXECUTION_UNAVAILABLE_REASON },
    coverage: { ...coverage, contributing: snapshotsContributing },
    repositories: {
      configured: repositories.length,
      available: repositories.length - repositoriesUnavailable,
      unavailable: repositoriesUnavailable,
    },
    limitedScope,
    trend: TREND_UNAVAILABLE,
  };
}

/**
 * The authoritative badge for a run. A derived exceptional phase wins because
 * it is the operator-relevant signal; otherwise the persisted status speaks.
 * `in_progress` is never "running" and `completed` is never "passed".
 * @param {string} status
 * @param {string} phase
 * @returns {{ label: string, tone: "success" | "danger" | "warning" | "active" | "neutral", source: "phase" | "status" }}
 */
export function statusPresentation(status, phase) {
  if (phase === "awaiting_approval") return { label: "AWAITING APPROVAL", tone: "warning", source: "phase" };
  if (phase === "interrupted_or_inconsistent") return { label: "ATTENTION REQUIRED", tone: "danger", source: "phase" };
  if (status === "in_progress") return { label: "IN PROGRESS", tone: "active", source: "status" };
  if (status === "blocked") return { label: "BLOCKED", tone: "danger", source: "status" };
  if (status === "completed") return { label: "COMPLETED", tone: "success", source: "status" };
  return { label: status.replaceAll("_", " ").toUpperCase(), tone: "neutral", source: "status" };
}

/**
 * The non-color state of one recorded stage.
 * @param {RunSnapshot["stages"][number]} stage
 * @returns {{ label: string, tone: "success" | "danger" | "warning" | "active" | "neutral", symbol: string }}
 */
export function stagePresentation(stage) {
  if (stage.gateResult === "block") return { label: "Blocked", tone: "danger", symbol: "x" };
  if (stage.status === "passed" && stage.gateResult === "pass") return { label: "Passed", tone: "success", symbol: "check" };
  if (stage.status === "passed") return { label: "Recorded", tone: "neutral", symbol: "dot" };
  if (stage.status === "open") return { label: "In progress", tone: "active", symbol: "arrow" };
  return { label: stage.status.replaceAll("_", " "), tone: "neutral", symbol: "dot" };
}

/**
 * Cost and token series for the selected run's existing groups. Source order
 * is preserved: `byStage` already arrives in recorded stage order and
 * `byAgent` in the projection's own sorted order.
 * @param {RunSnapshot} snapshot
 */
export function costChartSeries(snapshot) {
  const ordinals = new Map(snapshot.stages.map((stage) => [stage.id, stage.ordinal]));
  const stages = snapshot.cost.byStage.map((group) => ({
    stageId: group.stageId,
    kind: group.kind,
    ordinal: ordinals.get(group.stageId) ?? null,
    knownUsd: group.costReportedRows === 0 ? null : group.knownUsd,
    reportedRows: group.costReportedRows,
    unreportedRows: group.costUnreportedRows,
    agentRows: group.agentRows,
  }));
  const stageMax = stages.reduce((max, entry) => Math.max(max, entry.knownUsd ?? 0), 0);
  const agentValues = snapshot.cost.byAgent.map((group) => ({
    agent: group.agent,
    knownUsd: group.costReportedRows === 0 ? null : group.knownUsd,
    reportedRows: group.costReportedRows,
    unreportedRows: group.costUnreportedRows,
    agentRows: group.agentRows,
  }));
  const positive = agentValues.reduce((sum, entry) => sum + Math.max(entry.knownUsd ?? 0, 0), 0);
  const anyReported = agentValues.some((entry) => entry.knownUsd !== null);
  let offset = 0;
  const agents = agentValues.map((entry) => {
    const value = Math.max(entry.knownUsd ?? 0, 0);
    const fraction = positive === 0 ? 0 : value / positive;
    const startFraction = offset;
    offset += fraction;
    return { ...entry, fraction, startFraction };
  });
  const tokensByStage = snapshot.cost.byStage.map((group) => ({
    stageId: group.stageId,
    kind: group.kind,
    ordinal: ordinals.get(group.stageId) ?? null,
    tokens: tokenTotal(group),
  }));
  // A run that reported zero tokens is not a run that reported nothing. The
  // three states stay distinct so a chart description never denies evidence
  // the run actually recorded.
  const reportedTokens = tokensByStage
    .flatMap((group) => group.tokens.classes)
    .filter((entry) => entry.known !== null);
  const tokenMax = reportedTokens.reduce((max, entry) => Math.max(max, entry.known ?? 0), 0);
  return {
    stages: stages.map((entry) => ({ ...entry, fraction: stageMax === 0 ? 0 : (entry.knownUsd ?? 0) / stageMax })),
    stageMax,
    agents,
    agentState: !anyReported ? "unavailable" : positive === 0 ? "reported_zero" : "available",
    tokensByStage,
    tokenMax,
    tokenState: reportedTokens.length === 0 ? "unavailable" : tokenMax === 0 ? "reported_zero" : "available",
  };
}

/**
 * Per-agent analytics rows. Model and trend stay unavailable: the projection
 * binds neither a model nor a historical series to an agent row.
 * @param {RunSnapshot} snapshot
 */
export function agentAnalytics(snapshot) {
  /** @type {Map<string, number>} */
  const reportsByReviewer = new Map();
  for (const finding of snapshot.evidence.findings) {
    for (const report of finding.reports) {
      if (report.reviewerId === null) continue;
      reportsByReviewer.set(report.reviewerId, (reportsByReviewer.get(report.reviewerId) ?? 0) + 1);
    }
  }
  return snapshot.cost.byAgent.map((group) => ({
    agent: group.agent,
    model: null,
    modelLabel: AGENT_MODEL_UNAVAILABLE,
    executions: group.agentRows,
    tokens: tokenTotal(group),
    knownUsd: group.costReportedRows === 0 ? null : group.knownUsd,
    costReportedRows: group.costReportedRows,
    costUnreportedRows: group.costUnreportedRows,
    recordedFailedAttempts: group.recordedFailedAttempts,
    findingsGenerated: reportsByReviewer.get(group.agent) ?? 0,
    trend: TREND_UNAVAILABLE,
  }));
}

/**
 * Read a persisted JSON-encoded array of strings. Malformed stored text is a
 * named unavailable field, never serialized data promoted to presentation.
 * @param {string | null} text
 */
function parseStringList(text) {
  if (text === null) return { available: false, values: /** @type {string[] | null} */ (null) };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { available: false, values: /** @type {string[] | null} */ (null) };
  }
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    return { available: false, values: /** @type {string[] | null} */ (null) };
  }
  return { available: true, values: /** @type {string[] | null} */ (parsed) };
}

export const MALFORMED_LIST_REASON =
  "The stored record is not a JSON array of strings. Read it with the status command; the dashboard does not display serialized data.";

export const MALFORMED_NORMATIVE_REASON =
  "The stored record is not a JSON array of normative changes. Read it with the status command; the dashboard does not display serialized data.";

/**
 * Read the persisted normative-change array. Each entry carries an artifact
 * location, the artifact text, and its own grounding object; the store writes
 * objects here, not strings, and a malformed record stays a named unavailable
 * field rather than serialized text promoted to presentation.
 * @param {string | null} text
 */
function parseNormativeChanges(text) {
  /** @type {{ available: boolean, values: { artifactLocation: string, artifactText: string, groundingSource: string, groundingLocation: string, groundingExcerpt: string }[] | null }} */
  const unavailable = { available: false, values: null };
  if (text === null) return { available: true, values: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unavailable;
  }
  if (!Array.isArray(parsed)) return unavailable;
  const values = [];
  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object") return unavailable;
    const grounding = entry.grounding;
    if (typeof entry.artifactLocation !== "string" || typeof entry.artifactText !== "string") return unavailable;
    if (grounding === null || typeof grounding !== "object") return unavailable;
    if (typeof grounding.source !== "string" || typeof grounding.location !== "string" ||
        typeof grounding.excerpt !== "string") return unavailable;
    values.push({
      artifactLocation: entry.artifactLocation,
      artifactText: entry.artifactText,
      groundingSource: grounding.source,
      groundingLocation: grounding.location,
      groundingExcerpt: grounding.excerpt,
    });
  }
  return { available: true, values };
}

/* ------------------------------------------------------------------ *
 * Finding precision, applicability, and ordering
 * ------------------------------------------------------------------ */

/**
 * Which decision fields the recorded disposition permits. These are the two
 * cross-column rules `insertFindingDecision` enforces in `src/store.ts`:
 * grounding exactly when `rejected_with_rationale`, normative changes exactly
 * when `addressed`. The dashboard restates their consequence so a field the
 * record structurally forbids is never reported as missing; it never
 * re-validates the stored record.
 * @param {string} disposition
 * @returns {{ grounding: "required" | "forbidden", normativeChanges: "required" | "forbidden" }}
 */
export function decisionFieldApplicability(disposition) {
  return {
    grounding: disposition === "rejected_with_rationale" ? "required" : "forbidden",
    normativeChanges: disposition === "addressed" ? "required" : "forbidden",
  };
}

/**
 * The sentence shown in place of an absence label for a field the recorded
 * disposition forbids. "Not recorded" would be wrong: the record could not
 * have carried this field.
 * @param {string} fieldLabel
 * @param {string} disposition
 */
export function forbiddenFieldStatement(fieldLabel, disposition) {
  return `${fieldLabel} does not apply to a finding decided ${disposition.replaceAll("_", " ")}; the recorded decision could not carry it.`;
}

/**
 * A recorded intent key made readable. Separators become spaces and the first
 * character is upper-cased; nothing else changes, and the recorded key is
 * always rendered alongside this, never replaced by it.
 * @param {string} intentKey
 */
export function readableIntent(intentKey) {
  const spaced = intentKey.replaceAll(/[-_]+/g, " ").trim();
  if (spaced === "") return intentKey;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The run's own frozen ascending severity vocabulary. `src/code-review.ts`
 * indexes this same list when it picks a finding's highest severity, so the
 * dashboard ranks with the order the gate used. A run that froze no
 * code-review profile froze no severity order, and gets `null`.
 * @param {RunSnapshot["configuration"]} configuration
 * @returns {readonly string[] | null}
 */
export function severityOrder(configuration) {
  return configuration.codeReview === null ? null : configuration.codeReview.severities;
}

/**
 * The highest recorded severity across a finding's reports, ranked only
 * against the run's frozen vocabulary. A severity that vocabulary does not
 * contain is reported unavailable rather than silently ranked.
 * @param {{ reports: readonly { severity: string }[] }} card
 * @param {readonly string[] | null} severities
 * @returns {{ available: boolean, severity: string | null, rank: number | null }}
 */
export function cardSeverity(card, severities) {
  const unavailable = { available: false, severity: /** @type {string | null} */ (null), rank: /** @type {number | null} */ (null) };
  if (severities === null || card.reports.length === 0) return unavailable;
  let rank = -1;
  for (const report of card.reports) {
    const index = severities.indexOf(report.severity);
    if (index === -1) return unavailable;
    if (index > rank) rank = index;
  }
  return { available: true, severity: severities[rank] ?? null, rank };
}

export const FINDING_ORDER_STATEMENT =
  "Findings are ordered by whether the final panel recorded them as blocking, then by the highest severity across their reports using this run's own frozen severity order, then by recorded identifier. A finding whose severity cannot be ranked against that order is listed last.";

/**
 * Triage order over finding cards. Returns a new array: the projection's own
 * `findingCards` must keep the authoritative recorded order.
 * @template {{ id: number, finalPanelBlocking: boolean | null, reports: readonly { severity: string }[] }} T
 * @param {readonly T[]} cards
 * @param {readonly string[] | null} severities
 * @returns {T[]}
 */
export function orderFindings(cards, severities) {
  const ranked = cards.map((card) => ({ card, severity: cardSeverity(card, severities) }));
  return ranked
    .slice()
    .sort((left, right) => {
      const blocking = Number(right.card.finalPanelBlocking === true) - Number(left.card.finalPanelBlocking === true);
      if (blocking !== 0) return blocking;
      const leftRank = left.severity.available ? left.severity.rank ?? -1 : -1;
      const rightRank = right.severity.available ? right.severity.rank ?? -1 : -1;
      if (leftRank !== rightRank) return rightRank - leftRank;
      return left.card.id - right.card.id;
    })
    .map((entry) => entry.card);
}

/**
 * Aggregate the findings for which no final-panel result was projected, so the
 * section states that absence once instead of on every card.
 * @template {{ finalPanelBlocking: boolean | null }} T
 * @param {readonly T[]} cards
 * @returns {{ shown: T[], nullCount: number, statement: string | null }}
 */
export function finalPanelBlockingSummary(cards) {
  const shown = cards.filter((card) => card.finalPanelBlocking !== null);
  const nullCount = cards.length - shown.length;
  return {
    shown,
    nullCount,
    statement: nullCount === 0
      ? null
      : `${nullCount} of ${cards.length} findings carry no projected final-panel result; a blocking decision is shown only for the findings that do.`,
  };
}

/**
 * One canonical finding as a card. Reports stay separate, severities are never
 * merged, and a missing decision stays missing.
 * @param {RunSnapshot["evidence"]["findings"][number]} finding
 */
export function findingCard(finding) {
  const decision = finding.decision;
  return {
    id: finding.id,
    stageId: finding.stageId,
    round: finding.round,
    intentKey: finding.intentKey,
    title: readableIntent(finding.intentKey),
    location: finding.location,
    reports: finding.reports,
    finalPanelBlocking: finding.finalPanelBlocking,
    applicability: decision === null ? null : decisionFieldApplicability(decision.disposition),
    artifact: decision === null ? null : artifactChange(decision.artifact_hash_before, decision.artifact_hash_after),
    decision: decision === null ? null : {
      id: decision.id,
      agentRunId: decision.agent_run_id,
      disposition: decision.disposition,
      rationale: decision.rationale,
      changedLocations: parseStringList(decision.changed_locations),
      normativeChanges: parseNormativeChanges(decision.normative_changes),
      groundingSource: decision.grounding_source,
      groundingLocation: decision.grounding_location,
      groundingExcerpt: decision.grounding_excerpt,
      artifactHashBefore: decision.artifact_hash_before,
      artifactHashAfter: decision.artifact_hash_after,
    },
  };
}

/** @typedef {{ at: string, event: string, summary: string | null, stageId: number | null, stageKind: string | null, ordinal: number | null, result: string | null, source: string, auditId: number | null }} ActivityItem */

/**
 * The bounded recorded-activity feed. It carries only stage start evidence,
 * stage completion timestamps, and the one projected latest audit event; it is
 * not the audit stream. Missing timestamps produce no item rather than an
 * inferred one. Items are built in recorded stage order and then stably sorted
 * newest first, so equal timestamps retain stage order.
 * @param {RunSnapshot} snapshot
 * @returns {ActivityItem[]}
 */
export function activityItems(snapshot) {
  const lastEvent = snapshot.activity.lastEvent;
  /** @type {ActivityItem[]} */
  const items = [];
  let mergedLastEvent = false;
  for (const stage of snapshot.stages) {
    if (stage.startEvidence.at !== null) {
      const auditId = stage.startEvidence.auditId;
      const merged = lastEvent !== null && auditId !== null && auditId === lastEvent.id;
      if (merged) mergedLastEvent = true;
      items.push({
        at: stage.startEvidence.at,
        event: merged ? lastEvent.action : "Stage started",
        summary: merged ? lastEvent.summary : null,
        stageId: stage.id,
        stageKind: stage.kind,
        ordinal: stage.ordinal,
        result: null,
        source: stage.startEvidence.source ?? "stage.started_at",
        auditId,
      });
    }
    if (stage.endedAt !== null) {
      items.push({
        at: stage.endedAt,
        event: "Stage completed",
        summary: null,
        stageId: stage.id,
        stageKind: stage.kind,
        ordinal: stage.ordinal,
        result: stage.gateResult,
        source: "stage.ended_at",
        auditId: null,
      });
    }
  }
  if (lastEvent !== null && !mergedLastEvent) {
    items.push({
      at: lastEvent.at,
      event: lastEvent.action,
      summary: lastEvent.summary,
      stageId: null,
      stageKind: null,
      ordinal: null,
      result: null,
      source: "activity.lastEvent",
      auditId: lastEvent.id,
    });
  }
  return items.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

/** @param {string} value @param {string} platform */
function shellQuote(value, platform) {
  return platform === "win32"
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/**
 * Display-only command text. It quotes for the operator's shell without
 * changing the projected argv, and copying it never executes anything.
 * @param {string} cliPath @param {string} command @param {string[]} args @param {string} [platform]
 */
export function commandText(cliPath, command, args, platform = "win32") {
  const tokens = [cliPath, command, ...args].map((value) => shellQuote(value, platform));
  return platform === "win32" ? `& node ${tokens.join(" ")}` : `node ${tokens.join(" ")}`;
}

const READ_COMMAND_ORDER = ["status", "doctor", "verify-audit"];

/* ------------------------------------------------------------------ *
 * Executive summary
 * ------------------------------------------------------------------ */

/**
 * Whether the recorded approval window has closed, derived from the two
 * recorded timestamps and named as derived. The recorded `state` is passed
 * through and never contradicted: a granted approval whose window has closed
 * still reads granted, with the closure stated beside it.
 * @param {RunSnapshot["approval"]} approval
 * @param {string | null} observedAt
 */
export function approvalWindow(approval, observedAt) {
  const expires = approval.expiresAt === null ? Number.NaN : Date.parse(approval.expiresAt);
  const observed = observedAt === null ? Number.NaN : Date.parse(observedAt);
  if (Number.isNaN(expires) || Number.isNaN(observed)) {
    return {
      state: approval.state,
      closed: /** @type {boolean | null} */ (null),
      statement: approval.expiresAt === null
        ? "No approval expiry is recorded, so whether the window has closed cannot be derived."
        : "No observation time accompanies this read, so whether the approval window has closed cannot be derived.",
      derivedFrom: /** @type {string[]} */ ([]),
    };
  }
  const closed = expires < observed;
  return {
    state: approval.state,
    closed,
    statement: closed
      ? "The recorded approval window has closed: the recorded expiry precedes the time this state was observed."
      : "The recorded approval window is still open at the time this state was observed.",
    derivedFrom: [`approval.expiresAt ${approval.expiresAt}`, `observedAt ${observedAt}`],
  };
}

/**
 * How a repository is named on screen. The recorded project wins when runs are
 * loaded, because that is the identity the operator recognises; otherwise the
 * final path segment stands in. The canonical path is always retained verbatim
 * — it remains the repository's identity, not a decoration.
 * @param {string} path
 * @param {readonly { project: string }[]} runs
 * @returns {{ display: string, source: "project" | "path_segment", canonicalPath: string }}
 */
export function repositoryIdentity(path, runs) {
  if (runs.length > 0) return { display: runs[0].project, source: "project", canonicalPath: path };
  const segments = path.split(/[/\\]+/).filter((segment) => segment !== "");
  return {
    display: segments.length === 0 ? path : segments[segments.length - 1],
    source: "path_segment",
    canonicalPath: path,
  };
}

/**
 * The triage answer a run opens on: what happened, why it is in this state,
 * what it cost, and what to do next. Every field is copied or selected from
 * the authoritative projection. In particular the next action is the recorded
 * workflow action and its recorded reason strings — no remediation sentence is
 * generated, rewritten, or inferred here — and the blocking finding is
 * selected from projected finding records, never parsed out of that prose.
 * @param {RunSnapshot} snapshot
 * @param {{ repositoryPath: string, runs: readonly { project: string }[], observedAt: string | null }} options
 */
export function runExecutiveSummary(snapshot, options) {
  const severities = severityOrder(snapshot.configuration);
  const cards = snapshot.evidence.findings.map((finding) => findingCard(finding));
  const ordered = orderFindings(cards, severities);
  const blockingCards = ordered.filter((card) => card.finalPanelBlocking === true);
  const group = blockingCards.length > 0 ? blockingCards : ordered;
  const selected = group[0] ?? null;
  const selectedSeverity = selected === null
    ? { available: false, severity: null, rank: null }
    : cardSeverity(selected, severities);

  // Whether a final panel projected a result at all is a different question
  // from whether it blocked. A matched final panel that recorded no blocking
  // finding writes false on every card of that stage and round; only an
  // unmatched panel leaves null. Deriving presence from the blocking count
  // would report a recorded false as an absent projection.
  const finalPanelProjected = ordered.some((card) => card.finalPanelBlocking !== null);
  const blockingFinding = selected === null
    ? {
      available: false,
      reason: `This run records ${snapshot.evidence.findings.length} findings, so no finding can be named.`,
      finalPanelProjected: false,
      finalPanelBlocking: false,
      id: null, title: null, intentKey: null, location: null, stageId: null, round: null,
      severity: null, severityAvailable: false, tiedWith: 0,
    }
    : {
      available: true,
      reason: /** @type {string | null} */ (null),
      finalPanelProjected,
      finalPanelBlocking: selected.finalPanelBlocking === true,
      id: selected.id,
      title: selected.title,
      intentKey: selected.intentKey,
      location: selected.location,
      stageId: selected.stageId,
      round: selected.round,
      severity: selectedSeverity.severity,
      severityAvailable: selectedSeverity.available,
      tiedWith: selectedSeverity.available
        ? group.filter((card) => card.id !== selected.id &&
          cardSeverity(card, severities).rank === selectedSeverity.rank).length
        : 0,
    };

  const cost = usdPresentation(snapshot.cost.costReportedRows === 0 ? null : snapshot.cost.knownUsd);
  const tokens = tokenTotal(snapshot.cost);
  const repository = repositoryIdentity(options.repositoryPath, options.runs);

  /** @type {{ label: string, reason: string }[]} */
  const unavailable = [];
  if (!cost.available) {
    unavailable.push({ label: "Total known cost", reason: "No contributing agent row reported a cost." });
  }
  if (tokens.known === null) {
    unavailable.push({ label: "Total known tokens", reason: "No contributing agent row reported a token class." });
  }
  if (!blockingFinding.available) {
    unavailable.push({ label: "Blocking finding", reason: blockingFinding.reason ?? "" });
  } else if (!blockingFinding.severityAvailable) {
    unavailable.push({
      label: "Finding severity",
      reason: severities === null
        ? "This run froze no code-review severity order, so recorded severities cannot be ranked."
        : "A recorded severity is absent from this run's frozen severity order, so it cannot be ranked.",
    });
  }

  /** @type {Map<string, string[]>} */
  const byReason = new Map();
  for (const entry of unavailable) {
    byReason.set(entry.reason, [...(byReason.get(entry.reason) ?? []), entry.label]);
  }
  const grouped = [...byReason.entries()].map(([reason, labels]) => ({
    labels,
    reason,
    statement: `${labels.join(" and ")} ${labels.length === 1 ? "is" : "are"} unavailable. ${reason}`,
  }));

  return {
    run: {
      id: snapshot.run.id,
      project: snapshot.run.project,
      featureId: snapshot.run.featureId,
      slug: snapshot.run.slug,
      changeKind: snapshot.run.changeKind,
    },
    state: statusPresentation(snapshot.run.status, snapshot.phase),
    blockingFinding,
    cost,
    tokens,
    repository,
    nextAction: {
      group: snapshot.workflowAction.group,
      eligible: snapshot.workflowAction.eligible,
      reasons: snapshot.workflowAction.reasons,
      command: snapshot.workflowAction.command,
      args: snapshot.workflowAction.args,
    },
    unavailable,
    grouped,
  };
}

/**
 * @param {RunSnapshot} snapshot @param {string} cliPath @param {string} [platform]
 * @param {string | null} [observedAt]
 */
export function snapshotProjection(snapshot, cliPath, platform = "win32", observedAt = null) {
  const commands = [];
  for (const kind of READ_COMMAND_ORDER) {
    for (const action of snapshot.operatorActions.filter((entry) => entry.kind === kind)) {
      commands.push({
        kind: action.kind,
        eligible: action.eligible,
        reason: action.reason,
        command: action.command,
        args: action.args,
        proposalId: action.proposalId,
        route: action.route,
        title: action.title,
        evidenceRef: action.evidenceRef,
        scope: action.kind === "verify-audit" ? "repository" : "run",
        text: commandText(cliPath, action.command, action.args, platform),
      });
    }
  }
  if (snapshot.workflowAction.command !== null) {
    commands.push({
      kind: "workflow",
      eligible: snapshot.workflowAction.eligible,
      reason: snapshot.workflowAction.reasons.map((entry) => entry.reason).join("; ") || null,
      command: snapshot.workflowAction.command,
      args: snapshot.workflowAction.args,
      proposalId: null,
      route: null,
      title: null,
      evidenceRef: null,
      scope: "run",
      text: commandText(cliPath, snapshot.workflowAction.command, snapshot.workflowAction.args, platform),
    });
  }
  for (const action of snapshot.operatorActions.filter((entry) => !READ_COMMAND_ORDER.includes(entry.kind))) {
    commands.push({
      kind: action.kind,
      eligible: action.eligible,
      reason: action.reason,
      command: action.command,
      args: action.args,
      proposalId: action.proposalId,
      route: action.route,
      title: action.title,
      evidenceRef: action.evidenceRef,
      scope: "run",
      text: commandText(cliPath, action.command, action.args, platform),
    });
  }
  return {
    systemName: snapshot.configuration.systemName ?? "Governed Delivery Dashboard",
    status: statusPresentation(snapshot.run.status, snapshot.phase),
    overview: {
      run: snapshot.run,
      phase: snapshot.phase,
      workflowAction: snapshot.workflowAction,
      activity: snapshot.activity,
      writer: snapshot.writer,
      limitations: snapshot.limitations,
    },
    stages: snapshot.stages,
    stageViews: snapshot.stages.map((stage) => ({ stage, presentation: stagePresentation(stage) })),
    activityItems: activityItems(snapshot),
    cost: snapshot.cost,
    tokens: tokenTotal(snapshot.cost),
    charts: costChartSeries(snapshot),
    agents: agentAnalytics(snapshot),
    findings: snapshot.evidence.findings,
    findingCards: snapshot.evidence.findings.map((finding) => findingCard(finding)),
    governance: {
      configuration: snapshot.configuration,
      approval: snapshot.approval,
      approvalWindow: approvalWindow(snapshot.approval, observedAt),
      proposals: snapshot.proposals,
      commands,
    },
    delivery: snapshot.delivery,
    evidence: snapshot.evidence.references,
  };
}
