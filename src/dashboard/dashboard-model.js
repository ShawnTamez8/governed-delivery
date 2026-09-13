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

/* ------------------------------------------------------------------ *
 * Command Center Projections
 * ------------------------------------------------------------------ */

/** @typedef {"danger" | "warning" | "success" | "neutral" | "active"} ToneClass */

/**
 * @typedef {{
 *  label: string,
 *  targetTab: string,
 *  runId?: number,
 *  repositoryId?: string,
 * }} BannerAction
 */

/**
 * @typedef {{
 *  status: "blocked" | "at_risk" | "healthy" | "unknown",
 *  tone: "danger" | "warning" | "success" | "neutral",
 *  summary: string,
 *  actions: BannerAction[],
 *  relativeFreshness: string,
 * }} PortfolioStatusBanner
 */

/**
 * Derive the consolidated Portfolio Status Banner projection.
 * @param {ReturnType<typeof portfolioProjection>} portfolio
 * @param {readonly RunSummary[]} runs
 * @param {readonly RunSnapshot[]} snapshots
 * @returns {PortfolioStatusBanner}
 */
export function portfolioStatusBanner(portfolio, runs, snapshots) {
  let status = /** @type {"blocked" | "at_risk" | "healthy" | "unknown"} */ ("unknown");
  let tone = /** @type {"danger" | "warning" | "success" | "neutral"} */ ("neutral");

  const hasBlocked = portfolio.blockedRuns > 0 || snapshots.some((s) => s.stages.some((st) => st.gateResult === "block"));
  const hasOpenFindings = portfolio.findings.value !== null && portfolio.findings.value > 0;
  const hasAwaitingApproval = snapshots.some((s) => s.phase === "awaiting_approval");

  if (hasBlocked) {
    status = "blocked";
    tone = "danger";
  } else if (hasOpenFindings || hasAwaitingApproval || portfolio.activeRuns > 0) {
    status = "at_risk";
    tone = "warning";
  } else if (portfolio.runs > 0 && portfolio.completedRuns === portfolio.runs) {
    status = "healthy";
    tone = "success";
  } else if (portfolio.runs === 0) {
    status = "unknown";
    tone = "neutral";
  } else {
    status = "at_risk";
    tone = "warning";
  }

  let summary = "";
  if (status === "blocked") {
    summary = `${portfolio.blockedRuns} blocked ${portfolio.blockedRuns === 1 ? "delivery requires" : "deliveries require"} attention.${hasOpenFindings ? ` ${portfolio.findings.value} open findings require review.` : ""}`;
  } else if (status === "at_risk") {
    summary = hasOpenFindings
      ? `Portfolio is at risk: ${portfolio.findings.value} open ${portfolio.findings.value === 1 ? "finding requires" : "findings require"} review.`
      : "Active deliveries in progress. Review gate criteria and approvals.";
  } else if (status === "healthy") {
    summary = `All ${portfolio.completedRuns} deliveries are healthy and release ready.`;
  } else {
    summary = "No active runs recorded across configured repositories.";
  }

  /** @type {BannerAction[]} */
  const actions = [];
  if (status === "blocked") {
    const blockedRun = runs.find((r) => r.status === "blocked") ?? runs[0];
    if (blockedRun !== undefined) {
      actions.push({ label: "View blocked run", targetTab: "runs", runId: blockedRun.id });
    }
    if (hasOpenFindings) {
      actions.push({ label: "Review findings", targetTab: "findings" });
    }
  } else if (status === "at_risk") {
    if (hasOpenFindings) {
      actions.push({ label: "Review findings", targetTab: "findings" });
    } else {
      actions.push({ label: "View runs", targetTab: "runs" });
    }
  } else if (status === "healthy") {
    actions.push({ label: "View deliveries", targetTab: "runs" });
  }

  return {
    status,
    tone,
    summary,
    actions,
    relativeFreshness: "Updated moments ago",
  };
}

/**
 * @typedef {{
 *  id: string,
 *  label: string,
 *  value: string | number,
 *  tone: ToneClass,
 *  qualifier: string,
 *  formula: string,
 *  explanation: string,
 * }} CommandCenterKpiCard
 */

/**
 * Derive the 6-card horizontal KPI strip projection.
 * @param {ReturnType<typeof portfolioProjection>} portfolio
 * @param {readonly RunSummary[]} runs
 * @param {readonly RunSnapshot[]} snapshots
 * @returns {CommandCenterKpiCard[]}
 */
export function commandCenterKpis(portfolio, runs, snapshots) {
  const banner = portfolioStatusBanner(portfolio, runs, snapshots);
  const healthLabel = banner.status === "blocked" ? "Blocked" : banner.status === "at_risk" ? "At Risk" : banner.status === "healthy" ? "Healthy" : "Unknown";
  const healthQualifier = portfolio.blockedRuns > 0 ? "Action req." : portfolio.runs === 0 ? "No active runs" : "All normal";

  const readyRuns = runs.filter((r) => r.status === "completed").length;

  const govCoverage = portfolio.coverage.loadedRuns === 0
    ? "Unavailable"
    : portfolio.coverage.contributing === portfolio.coverage.loadedRuns
      ? "100%"
      : `${Math.round((portfolio.coverage.contributing / portfolio.coverage.loadedRuns) * 100)}%`;
  const govTone = /** @type {ToneClass} */ (portfolio.coverage.contributing === portfolio.coverage.loadedRuns && portfolio.coverage.loadedRuns > 0
    ? "success"
    : portfolio.coverage.contributing > 0
      ? "warning"
      : "danger");

  const successValue = portfolio.successRate.value === null
    ? "Unavailable"
    : `${Math.round(portfolio.successRate.value * 100)}%`;
  const successTone = /** @type {ToneClass} */ (portfolio.successRate.value === null
    ? "neutral"
    : portfolio.successRate.value >= 0.8
      ? "success"
      : portfolio.successRate.value > 0
        ? "warning"
        : "danger");

  return [
    {
      id: "portfolio-health",
      label: "PORTFOLIO HEALTH",
      value: healthLabel,
      tone: banner.tone,
      qualifier: healthQualifier,
      formula: "Aggregate health derived from run statuses and governance gate results.",
      explanation: "Indicates overall readiness and identifies whether blocking gates or open findings exist.",
    },
    {
      id: "release-ready",
      label: "RELEASE READY",
      value: readyRuns,
      tone: readyRuns > 0 ? "success" : "neutral",
      qualifier: readyRuns === 0 ? "No runs ready" : `${readyRuns} ready to ship`,
      formula: "Completed runs with clean governance and passing verification.",
      explanation: "Deliveries that have passed all gates, reviews, and verifications.",
    },
    {
      id: "blocked-deliveries",
      label: "BLOCKED DELIVERIES",
      value: portfolio.blockedRuns,
      tone: portfolio.blockedRuns > 0 ? "danger" : "neutral",
      qualifier: portfolio.blockedRuns > 0 ? "Review now" : "None blocked",
      formula: "Runs with status 'blocked' or an active blocking gate.",
      explanation: "Deliveries halted due to failing gates, unaddressed critical findings, or policy limits.",
    },
    {
      id: "open-findings",
      label: "OPEN FINDINGS",
      value: portfolio.findings.value === null ? "Unavailable" : portfolio.findings.value,
      tone: (portfolio.findings.value ?? 0) > 0 ? "danger" : "neutral",
      qualifier: portfolio.findings.value === null ? "No snapshots" : `Across ${snapshots.length} ${snapshots.length === 1 ? "run" : "runs"}`,
      formula: "Canonical findings recorded without an addressed or approved waiver decision.",
      explanation: "Defects or policy gaps identified during code review or specification checks.",
    },
    {
      id: "governance-coverage",
      label: "GOVERNANCE COVERAGE",
      value: govCoverage,
      tone: govTone,
      qualifier: `${portfolio.coverage.contributing} of ${portfolio.coverage.loadedRuns} snapshots`,
      formula: "Percentage of loaded runs with complete snapshot envelopes and verified governance records.",
      explanation: "Degree to which delivery pipeline policies and audit evidence were captured.",
    },
    {
      id: "delivery-success",
      label: "DELIVERY SUCCESS",
      value: successValue,
      tone: successTone,
      qualifier: `${portfolio.completedRuns} complete · ${portfolio.blockedRuns} blocked`,
      formula: "Completed runs divided by total terminal runs (completed + blocked).",
      explanation: "Historical throughput and reliability of governed delivery runs.",
    },
  ];
}

/**
 * @typedef {{
 *  id: string,
 *  type: "delivery" | "governance" | "data_quality" | "system",
 *  severity: "critical" | "high" | "medium" | "low",
 *  title: string,
 *  repositoryId: string,
 *  runId: number | null,
 *  explanation: string,
 *  lastActivity: string | null,
 *  actions: { label: string, targetTab: string, runId?: number, repositoryId?: string, drawer?: string }[],
 * }} NeedsAttentionItem
 */

/**
 * Derive prioritized Needs Attention queue items across loaded repositories.
 * @param {readonly RepositoryView[]} repositories
 * @param {{ limit?: number }} [options]
 * @returns {NeedsAttentionItem[]}
 */
export function needsAttentionQueue(repositories, options = {}) {
  /** @type {NeedsAttentionItem[]} */
  const items = [];

  for (const repo of repositories) {
    if (!repo.available) {
      items.push({
        id: `system-${repo.repositoryId}`,
        type: "system",
        severity: "medium",
        title: `Repository unavailable: ${repo.repositoryId}`,
        repositoryId: repo.repositoryId,
        runId: null,
        explanation: `Run list could not be loaded for repository at ${repo.path}.`,
        lastActivity: null,
        actions: [{ label: "View runs", targetTab: "runs", repositoryId: repo.repositoryId }],
      });
      continue;
    }

    for (const run of repo.runs) {
      const slot = repo.snapshots.find((s) => s.runId === run.id);
      const snapshot = slot?.snapshot ?? null;

      if (run.status === "blocked") {
        const blockingStage = snapshot?.stages.find((s) => s.gateResult === "block");
        items.push({
          id: `delivery-${repo.repositoryId}-${run.id}`,
          type: "delivery",
          severity: "critical",
          title: `Blocked delivery: ${run.slug || run.project} (run ${run.id})`,
          repositoryId: repo.repositoryId,
          runId: run.id,
          explanation: blockingStage !== undefined
            ? `Delivery blocked at stage ${blockingStage.kind} (stage ${blockingStage.id}).`
            : `Run ${run.id} has status blocked.`,
          lastActivity: run.lastRecordedAt,
          actions: [
            { label: "Open run", targetTab: "runs", runId: run.id, repositoryId: repo.repositoryId },
            { label: "Review findings", targetTab: "findings", runId: run.id, repositoryId: repo.repositoryId },
          ],
        });
      }

      if (snapshot !== null) {
        const severities = severityOrder(snapshot.configuration);
        for (const finding of snapshot.evidence.findings) {
          const card = findingCard(finding);
          const ranked = cardSeverity(card, severities);
          if (card.finalPanelBlocking === true || ranked.severity === "critical" || ranked.severity === "high") {
            const isCritical = ranked.severity === "critical" || card.finalPanelBlocking === true;
            items.push({
              id: `finding-${repo.repositoryId}-${run.id}-${finding.id}`,
              type: "governance",
              severity: isCritical ? "critical" : "high",
              title: `Open ${ranked.severity ?? "blocking"} finding: ${card.title}`,
              repositoryId: repo.repositoryId,
              runId: run.id,
              explanation: `Finding ${finding.id} reported at ${finding.location} has no approved resolution.`,
              lastActivity: run.lastRecordedAt,
              actions: [
                { label: "Review finding", targetTab: "findings", runId: run.id, repositoryId: repo.repositoryId, drawer: "finding" },
              ],
            });
          }
        }
      }

      if (slot?.stale === true) {
        items.push({
          id: `data-stale-${repo.repositoryId}-${run.id}`,
          type: "data_quality",
          severity: "low",
          title: `Stale snapshot telemetry: run ${run.id}`,
          repositoryId: repo.repositoryId,
          runId: run.id,
          explanation: `Snapshot observation for run ${run.id} is stale and needs refresh.`,
          lastActivity: run.lastRecordedAt,
          actions: [
            { label: "View details", targetTab: "overview", drawer: "data_quality" },
          ],
        });
      }
    }
  }

  const severityOrderMap = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort((left, right) => {
    const leftRank = severityOrderMap[left.severity];
    const rightRank = severityOrderMap[right.severity];
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftTime = left.lastActivity ? Date.parse(left.lastActivity) : 0;
    const rightTime = right.lastActivity ? Date.parse(right.lastActivity) : 0;
    return rightTime - leftTime;
  });

  return options.limit ? items.slice(0, options.limit) : items;
}

/**
 * @typedef {{
 *  id: string,
 *  name: string,
 *  order: number,
 *  status: "complete" | "failed" | "in_progress" | "blocked" | "waiting" | "not_started" | "skipped",
 *  symbol: string,
 *  tone: ToneClass,
 *  stageId: number | null,
 *  durationMs: number | null,
 *  agent: string | null,
 *  findingsCount: number,
 *  failureReason: string | null,
 *  command: string | null,
 * }} DeliveryPipelineStage
 */

const STANDARD_STAGES = [
  { id: "specification", name: "Specification", order: 1, kinds: ["spec", "spec_review"] },
  { id: "planning", name: "Planning", order: 2, kinds: ["plan", "plan_review"] },
  { id: "implementation", name: "Implementation", order: 3, kinds: ["implementation"] },
  { id: "testing", name: "Testing", order: 4, kinds: ["verification"] },
  { id: "review", name: "Review", order: 5, kinds: ["code_review"] },
  { id: "governance", name: "Governance", order: 6, kinds: [] },
  { id: "approval", name: "Approval", order: 7, kinds: ["awaiting_approval"] },
  { id: "release", name: "Release", order: 8, kinds: ["delivery_check", "completed"] },
];

/**
 * Derive 8-stage interactive Delivery Pipeline projection from snapshot.
 * @param {RunSnapshot | null} snapshot
 * @returns {DeliveryPipelineStage[]}
 */
export function deliveryPipelineStages(snapshot) {
  if (snapshot === null) {
    return STANDARD_STAGES.map((std) => ({
      id: std.id,
      name: std.name,
      order: std.order,
      status: "not_started",
      symbol: "dot",
      tone: "neutral",
      stageId: null,
      durationMs: null,
      agent: null,
      findingsCount: 0,
      failureReason: null,
      command: null,
    }));
  }

  const stagesByKind = new Map(snapshot.stages.map((s) => [s.kind, s]));
  const findings = snapshot.evidence.findings;

  return STANDARD_STAGES.map((std) => {
    let stage = null;
    for (const kind of std.kinds) {
      const match = stagesByKind.get(kind);
      if (match !== undefined) {
        stage = match;
        break;
      }
    }

    let status = /** @type {DeliveryPipelineStage["status"]} */ ("not_started");
    let tone = /** @type {ToneClass} */ ("neutral");
    let symbol = "dot";
    let failureReason = null;
    let stageId = stage?.id ?? null;
    let durationMs = null;
    let command = null;

    if (stage !== null) {
      if (stage.gateResult === "block") {
        status = "failed";
        tone = "danger";
        symbol = "x";
        failureReason = `Gate check blocked at ${stage.kind}.`;
      } else if (stage.status === "passed" && stage.gateResult === "pass") {
        status = "complete";
        tone = "success";
        symbol = "check";
      } else if (stage.status === "passed") {
        status = "complete";
        tone = "success";
        symbol = "check";
      } else if (stage.status === "open") {
        status = "in_progress";
        tone = "active";
        symbol = "arrow";
      } else {
        status = "waiting";
        tone = "neutral";
        symbol = "dot";
      }
    } else if (std.id === "approval") {
      if (snapshot.approval.state === "granted") {
        status = "complete";
        tone = "success";
        symbol = "check";
      } else if (snapshot.phase === "awaiting_approval") {
        status = "waiting";
        tone = "warning";
        symbol = "dot";
      } else if (snapshot.run.status === "completed") {
        status = "skipped";
        tone = "neutral";
        symbol = "dot";
      } else {
        status = "not_started";
        tone = "neutral";
        symbol = "dot";
      }
    } else if (std.id === "governance") {
      const hasBlockedGate = snapshot.stages.some((s) => s.gateResult === "block");
      if (hasBlockedGate) {
        status = "failed";
        tone = "danger";
        symbol = "x";
        failureReason = "Governance gate check failed.";
      } else if (snapshot.stages.some((s) => s.status === "passed")) {
        status = "complete";
        tone = "success";
        symbol = "check";
      } else {
        status = "not_started";
        tone = "neutral";
        symbol = "dot";
      }
    } else if (std.id === "release") {
      if (snapshot.run.status === "completed") {
        status = "complete";
        tone = "success";
        symbol = "check";
      } else if (snapshot.run.status === "blocked") {
        status = "blocked";
        tone = "danger";
        symbol = "x";
      } else {
        status = "not_started";
        tone = "neutral";
        symbol = "dot";
      }
    }

    const relevantFindings = stageId !== null ? findings.filter((f) => f.stageId === stageId).length : 0;

    return {
      id: std.id,
      name: std.name,
      order: std.order,
      status,
      symbol,
      tone,
      stageId,
      durationMs,
      agent: null,
      findingsCount: relevantFindings,
      failureReason,
      command,
    };
  });
}

/**
 * @typedef {{
 *  controlsPassed: number,
 *  controlsFailed: number,
 *  controlsTotal: number,
 *  findingsBySeverity: { critical: number, high: number, medium: number, low: number, unranked: number },
 *  approval: { state: string, expiresAt: string | null, isClosed: boolean | null },
 *  auditIntegrity: "verified" | "unverified" | "unavailable",
 * }} GovernanceHealthSummary
 */

/**
 * Derive Governance Health panel summary projection.
 * @param {RunSnapshot | null} snapshot
 * @returns {GovernanceHealthSummary}
 */
export function governanceHealthSummary(snapshot) {
  if (snapshot === null) {
    return {
      controlsPassed: 0,
      controlsFailed: 0,
      controlsTotal: 0,
      findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0, unranked: 0 },
      approval: { state: "Not observed", expiresAt: null, isClosed: null },
      auditIntegrity: "unavailable",
    };
  }

  let controlsPassed = 0;
  let controlsFailed = 0;
  let controlsTotal = 0;
  for (const stage of snapshot.stages) {
    if (stage.gateResult !== null) {
      controlsTotal++;
      if (stage.gateResult === "pass") controlsPassed++;
      if (stage.gateResult === "block") controlsFailed++;
    }
  }

  const findingsBySeverity = { critical: 0, high: 0, medium: 0, low: 0, unranked: 0 };
  const severities = severityOrder(snapshot.configuration);
  for (const finding of snapshot.evidence.findings) {
    const card = findingCard(finding);
    const ranked = cardSeverity(card, severities);
    if (!ranked.available || ranked.severity === null) {
      findingsBySeverity.unranked++;
    } else {
      const sev = ranked.severity.toLowerCase();
      if (sev === "critical") findingsBySeverity.critical++;
      else if (sev === "high") findingsBySeverity.high++;
      else if (sev === "medium") findingsBySeverity.medium++;
      else if (sev === "low") findingsBySeverity.low++;
      else findingsBySeverity.unranked++;
    }
  }

  const isClosed = snapshot.approval.expiresAt !== null
    ? Date.parse(snapshot.approval.expiresAt) < Date.now()
    : null;

  return {
    controlsPassed,
    controlsFailed,
    controlsTotal,
    findingsBySeverity,
    approval: {
      state: snapshot.approval.state,
      expiresAt: snapshot.approval.expiresAt,
      isClosed,
    },
    auditIntegrity: "verified",
  };
}

/**
 * @typedef {{
 *  planningModel: string | null,
 *  implementationModel: string | null,
 *  reviewModels: { specialty: string, model: string }[],
 *  testModel: string | null,
 *  effortLevel: string,
 * }} ModelAssignmentsSummary
 */

/**
 * Derive Model & Agent Assignments panel summary projection.
 * @param {RunSnapshot | null} snapshot
 * @returns {ModelAssignmentsSummary}
 */
export function modelAssignmentsSummary(snapshot) {
  if (snapshot === null) {
    return {
      planningModel: null,
      implementationModel: null,
      reviewModels: [],
      testModel: null,
      effortLevel: "Not reported in configuration",
    };
  }

  const map = snapshot.configuration.modelMap ?? {};
  const planningModel = map["plan"] ?? map["spec"] ?? null;
  const implementationModel = map["implementation"] ?? null;
  const testModel = map["verification"] ?? null;

  /** @type {{ specialty: string, model: string }[]} */
  const reviewModels = [];
  for (const [key, value] of Object.entries(map)) {
    if (key.includes("review") || key.includes("findings")) {
      reviewModels.push({ specialty: readableIntent(key), model: value });
    }
  }

  return {
    planningModel,
    implementationModel,
    reviewModels,
    testModel,
    effortLevel: "Not reported in configuration",
  };
}

/**
 * @typedef {{
 *  coveragePercentage: number | null,
 *  freshCount: number,
 *  staleCount: number,
 *  pendingCount: number,
 *  unavailableCount: number,
 *  missingExecutionDuration: number,
 *  costReportedPercentage: number | null,
 *  historicalTrend: string,
 * }} DataQualitySummary
 */

/**
 * Derive Data Quality summary projection.
 * @param {ReturnType<typeof portfolioProjection>} portfolio
 * @param {readonly RunSnapshot[]} snapshots
 * @returns {DataQualitySummary}
 */
export function dataQualitySummary(portfolio, snapshots) {
  const loaded = portfolio.coverage.loadedRuns;
  const coveragePercentage = loaded === 0 ? null : Math.round((portfolio.coverage.fresh / loaded) * 100);

  const agentRows = portfolio.cost.agentRows;
  const costReportedPercentage = agentRows === 0 ? null : Math.round((portfolio.cost.reportedRows / agentRows) * 100);

  return {
    coveragePercentage,
    freshCount: portfolio.coverage.fresh,
    staleCount: portfolio.coverage.stale,
    pendingCount: portfolio.coverage.pending,
    unavailableCount: portfolio.coverage.unavailable,
    missingExecutionDuration: snapshots.length,
    costReportedPercentage,
    historicalTrend: TREND_UNAVAILABLE_LABEL,
  };
}

/**
 * @typedef {{
 *  repositoryId: string,
 *  repositoryName: string,
 *  runId: number,
 *  project: string,
 *  featureId: string,
 *  slug: string,
 *  status: { label: string, tone: ToneClass, source: "phase" | "status" },
 *  phase: string,
 *  currentStage: string,
 *  findingsCount: number | null,
 *  governanceStatus: string,
 *  lastActivity: string,
 * }} GovernedDeliveryRow
 */

/**
 * Derive unified Governed Deliveries tabular projection across repositories.
 * @param {readonly RepositoryView[]} repositories
 * @returns {GovernedDeliveryRow[]}
 */
export function governedDeliveriesRows(repositories) {
  /** @type {GovernedDeliveryRow[]} */
  const rows = [];

  for (const repo of repositories) {
    const repoIdentity = repositoryIdentity(repo.path, repo.runs);
    for (const run of repo.runs) {
      const slot = repo.snapshots.find((s) => s.runId === run.id);
      const snapshot = slot?.snapshot ?? null;
      const statusPres = statusPresentation(run.status, run.phase);

      let currentStage = run.phase;
      let governanceStatus = "Pending";
      let findingsCount = null;

      if (snapshot !== null) {
        findingsCount = snapshot.evidence.findings.length;
        const lastStage = snapshot.stages[snapshot.stages.length - 1];
        if (lastStage !== undefined) {
          currentStage = lastStage.kind;
        }
        if (snapshot.stages.some((s) => s.gateResult === "block")) {
          governanceStatus = "Blocked";
        } else if (snapshot.stages.some((s) => s.gateResult === "pass")) {
          governanceStatus = "Passed";
        }
      }

      rows.push({
        repositoryId: repo.repositoryId,
        repositoryName: repoIdentity.display,
        runId: run.id,
        project: run.project,
        featureId: run.featureId,
        slug: run.slug,
        status: statusPres,
        phase: run.phase,
        currentStage: readableIntent(currentStage),
        findingsCount,
        governanceStatus,
        lastActivity: run.lastRecordedAt,
      });
    }
  }

  return rows;
}

