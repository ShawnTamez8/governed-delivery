/** @typedef {import("../operator-output.ts").OperatorResult} OperatorResult */
/** @typedef {import("../operator-state.ts").RunSnapshot} RunSnapshot */

import {
  AGENT_MODEL_UNAVAILABLE, AGENT_TOKEN_CLASS_NOTE, FINDING_ORDER_STATEMENT, MALFORMED_LIST_REASON,
  MALFORMED_NORMATIVE_REASON, TREND_UNAVAILABLE_LABEL,
  cardSeverity, collapsedColumnStatement, constantColumn, coverageQualifier,
  finalPanelBlockingSummary, forbiddenFieldStatement, fullCoverageStatement, identityPresentation,
  latestTimestamp, orderFindings, portfolioProjection, repositoryIdentity, runExecutiveSummary,
  severityOrder, snapshotProjection, snapshotState, statusPresentation, timestampPresentation,
  usdPresentation,
} from "./dashboard-model.js";

const TOKEN_KEY = "governed-delivery-dashboard-token";
const THEME_KEY = "governed-delivery-dashboard-theme";
const SHORTCUTS_KEY = "governed-delivery-dashboard-shortcuts";
const SVG_NS = "http://www.w3.org/2000/svg";

/** @typedef {{ id: string, path: string }} Repository */
/** @typedef {{ observedAt: string, cliPath: string, repositories: Repository[] }} RepositoryInventory */
/** @typedef {{ envelope: OperatorResult | null, stale: boolean, errorCode: string | null, reason: string | null, attemptedAt: string | null, requestedRunId: number | null }} ResourceState */
/** @typedef {{ resource: ResourceState, requestId: number, loading: boolean }} SnapshotSlot */
/** @typedef {{ repository: Repository, runs: ResourceState, runsRequestId: number, snapshots: Map<number, SnapshotSlot> }} RepositoryState */
/** @typedef {{ status: number, envelope?: OperatorResult, reason?: string }} RefreshResponse */
/** @typedef {{ id: number, project: string, featureId: string, slug: string, status: string, phase: string, lastRecordedAt: string }} RunSummary */
/** @typedef {{ runs: RunSummary[], limit: number, hasMore: boolean }} RunListResult */

/** @param {string} hash @returns {string | null} */
export function bootstrapToken(hash) {
  return new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get("token");
}

/** @param {string} hash */
export function routeWithoutToken(hash) {
  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  parameters.delete("token");
  const route = parameters.toString();
  return route === "" ? "" : `#${route}`;
}

/** @param {string} hash */
export function parseRoute(hash) {
  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const repositoryId = parameters.get("repository");
  const runText = parameters.get("run");
  const runId = runText !== null && /^\d+$/.test(runText) && Number.isSafeInteger(Number(runText))
    ? Number(runText) : null;
  return {
    repositoryId: repositoryId !== null && /^[A-Za-z0-9_-]+$/.test(repositoryId) ? repositoryId : null,
    runId,
  };
}

/** @param {string} repositoryId @param {number | null} [runId] */
export function routeHash(repositoryId, runId = null) {
  const parameters = new URLSearchParams({ repository: repositoryId });
  if (runId !== null) parameters.set("run", String(runId));
  return `#${parameters}`;
}

/** @param {string | number} value */
export function validatedLimit(value) {
  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(number) || number < 1 || number > 100) {
    throw new RangeError("run limit must be a safe integer from 1 through 100");
  }
  return number;
}

/** @param {number | null} [requestedRunId] */
export function emptyResourceState(requestedRunId = null) {
  return {
    envelope: null,
    stale: false,
    errorCode: null,
    reason: null,
    attemptedAt: null,
    requestedRunId,
  };
}

/**
 * Replace only complete successful envelopes. A refusal or transport failure
 * retains the prior successful value and labels it stale.
 * @param {ResourceState} previous
 * @param {RefreshResponse} response
 * @param {number | null} [requestedRunId]
 */
export function applyRefresh(previous, response, requestedRunId = previous.requestedRunId) {
  if (response.status === 401) {
    return { resource: previous, sessionExpired: true };
  }
  const envelope = response.envelope;
  if (response.status === 200 && envelope?.outcome === "ok") {
    if (requestedRunId !== null && envelope.runId !== requestedRunId) {
      return {
        resource: {
          ...emptyResourceState(requestedRunId),
          errorCode: "response_identity_mismatch",
          reason: `requested run ${requestedRunId}, received run ${envelope.runId ?? "none"}`,
          attemptedAt: envelope.observedAt,
        },
        sessionExpired: false,
      };
    }
    return {
      resource: {
        envelope,
        stale: false,
        errorCode: null,
        reason: null,
        attemptedAt: envelope.observedAt,
        requestedRunId,
      },
      sessionExpired: false,
    };
  }
  const sameResource = previous.requestedRunId === requestedRunId;
  return {
    resource: {
      envelope: sameResource ? previous.envelope : null,
      stale: sameResource && previous.envelope !== null,
      errorCode: envelope?.errorCode ?? `http_${response.status}`,
      reason: envelope?.reason ?? response.reason ?? "dashboard request failed",
      attemptedAt: envelope?.observedAt ?? new Date().toISOString(),
      requestedRunId,
    },
    sessionExpired: false,
  };
}

/**
 * @param {number} requestId
 * @param {number} currentRequestId
 * @param {string | number} requestedResource
 * @param {string | number} currentResource
 */
export function isCurrentRefresh(requestId, currentRequestId, requestedResource, currentResource) {
  return requestId === currentRequestId && requestedResource === currentResource;
}

/** @param {unknown} target */
export function isEditableTarget(target) {
  if (target === null || typeof target !== "object") return false;
  const candidate = /** @type {{ tagName?: unknown, isContentEditable?: unknown }} */ (target);
  const tagName = typeof candidate.tagName === "string" ? candidate.tagName.toLowerCase() : "";
  return candidate.isContentEditable === true || tagName === "input" || tagName === "textarea" || tagName === "select";
}

/**
 * @param {string} firstKey
 * @param {string | null} secondKey
 * @param {boolean} [editable]
 * @param {boolean} [disabled]
 */
export function shortcutDestination(firstKey, secondKey, editable = false, disabled = false) {
  if (editable || disabled) return null;
  if (firstKey === "/") return "run-search";
  if (firstKey !== "g") return null;
  if (secondKey === "r") return "runs";
  if (secondKey === "f") return "findings";
  if (secondKey === "a") return "governance";
  return null;
}

/** @param {ResourceState} resource @returns {RunListResult | null} */
export function runListResult(resource) {
  const envelope = resource.envelope;
  if (envelope === null || envelope.outcome !== "ok") return null;
  return /** @type {RunListResult | null} */ (envelope.result);
}

/** @param {ResourceState} resource @returns {RunSummary[]} */
export function runSummaries(resource) {
  return runListResult(resource)?.runs ?? [];
}

/** @param {SnapshotSlot} slot @returns {RunSnapshot | null} */
export function slotSnapshot(slot) {
  const envelope = slot.resource.envelope;
  if (envelope === null || envelope.outcome !== "ok") return null;
  return /** @type {RunSnapshot} */ (envelope.result);
}

/** @param {RepositoryState} repositoryState @param {number} runId */
export function ensureSlot(repositoryState, runId) {
  let slot = repositoryState.snapshots.get(runId);
  if (slot === undefined) {
    slot = { resource: emptyResourceState(runId), requestId: 0, loading: false };
    repositoryState.snapshots.set(runId, slot);
  }
  return slot;
}

/**
 * Build the pure portfolio input. Aggregates cover only run IDs inside each
 * repository's current loaded window, so a retained out-of-window slot cannot
 * contribute, and identical run IDs in different repositories stay separate.
 * @param {{ repositories: Map<string, RepositoryState> }} application
 */
export function repositoryViews(application) {
  return [...application.repositories.values()].map((repositoryState) => {
    const list = runListResult(repositoryState.runs);
    const runs = list?.runs ?? [];
    return {
      repositoryId: repositoryState.repository.id,
      path: repositoryState.repository.path,
      available: list !== null,
      runs,
      limit: list?.limit ?? null,
      hasMore: list?.hasMore ?? false,
      snapshots: runs.map((run) => {
        const slot = repositoryState.snapshots.get(run.id);
        return {
          runId: run.id,
          snapshot: slot === undefined ? null : slotSnapshot(slot),
          stale: slot?.resource.stale ?? false,
          loading: slot?.loading ?? false,
        };
      }),
    };
  });
}

/** @param {string} path @param {string} token @returns {Promise<RefreshResponse>} */
async function fetchEnvelope(path, token) {
  try {
    const response = await fetch(new URL(path, window.location.origin), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 200) {
      return { status: response.status, envelope: /** @type {OperatorResult} */ (await response.json()) };
    }
    const failure = /** @type {{ reason?: string }} */ (await response.json());
    return { status: response.status, reason: failure.reason ?? response.statusText };
  } catch (error) {
    return { status: 0, reason: error instanceof Error ? error.message : String(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Safe DOM construction
 * ------------------------------------------------------------------ */

/** @param {string} tag @param {string | null} [content] @param {string} [className] */
function element(tag, content = null, className = "") {
  const node = document.createElement(tag);
  if (content !== null) node.textContent = content;
  if (className !== "") node.className = className;
  return node;
}

/** @param {string} tag @param {Record<string, string>} [attributes] */
function svg(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

/** @type {Record<string, string>} */
const ICON_PATHS = {
  runs: "M4 5h16M4 12h16M4 19h10",
  blocked: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM6 6l12 12",
  active: "M5 12h4l2-6 3 12 2-6h3",
  findings: "M12 3l9 16H3zM12 9v5M12 17h.01",
  cost: "M12 3v18M8 7h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7",
  tokens: "M4 17h4V9H4zM10 17h4V5h-4zM16 17h4v-6h-4z",
  success: "M4 13l5 5L20 6",
  duration: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v6l4 2",
  stale: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
  check: "M4 13l5 5L20 6",
  x: "M5 5l14 14M19 5L5 19",
  arrow: "M5 12h12M12 5l7 7-7 7",
  dot: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
};

/** Decorative icon: adjacent visible text always carries the meaning. @param {string} name */
function icon(name) {
  const node = svg("svg", {
    class: "icon", viewBox: "0 0 24 24", width: "20", height: "20",
    "aria-hidden": "true", focusable: "false",
  });
  node.append(svg("path", {
    d: ICON_PATHS[name] ?? ICON_PATHS["dot"] ?? "", fill: "none", "stroke-width": "2",
    "stroke-linecap": "round", "stroke-linejoin": "round",
  }));
  return node;
}

/** @param {number} value */
function exactCount(value) {
  return value.toLocaleString("en-US");
}

/** @param {number} value */
function abbreviated(value) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return exactCount(value);
}

/**
 * Abbreviated visible text with the exact value still available to assistive
 * technology, so visual formatting never removes a number.
 * @param {number} value
 */
function countNode(value) {
  const wrapper = element("span", null, "count");
  wrapper.append(element("span", abbreviated(value), "count-display"));
  wrapper.append(element("span", ` ${exactCount(value)} exactly`, "visually-hidden"));
  return wrapper;
}

/** @param {string | null} value @param {string} [fallback] */
function text(value, fallback = "Unavailable") {
  return value === null || value === "" ? fallback : value;
}

/** @param {[string, Node | string][]} entries @param {string} [className] */
function definitionList(entries, className = "definitions") {
  const list = element("dl", null, className);
  for (const [label, value] of entries) {
    list.append(element("dt", label));
    const definition = element("dd");
    if (typeof value === "string") definition.textContent = value;
    else definition.append(value);
    list.append(definition);
  }
  return list;
}

/** @param {string} caption @param {string[]} headers @param {(Node | string)[][]} rows */
function dataTable(caption, headers, rows) {
  const scroll = element("div", null, "table-scroll");
  const table = element("table");
  table.append(element("caption", caption));
  const head = element("thead");
  const headRow = element("tr");
  for (const label of headers) {
    const cell = element("th", label);
    cell.setAttribute("scope", "col");
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);
  const body = element("tbody");
  for (const row of rows) {
    const tr = element("tr");
    for (const value of row) {
      const cell = element("td");
      if (typeof value === "string") cell.textContent = value;
      else cell.append(value);
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);
  scroll.append(table);
  return scroll;
}

/** @param {string} title @param {string} id @param {string} [className] */
function panel(title, id, className = "") {
  const section = element("section", null, `panel ${className}`.trim());
  section.id = id;
  section.tabIndex = -1;
  section.append(element("h2", title));
  return section;
}

/** @param {string} label @param {string} tone */
function badge(label, tone) {
  const node = element("span", null, `badge tone-${tone}`);
  node.append(icon(tone === "success" ? "check" : tone === "danger" || tone === "critical" ? "x" : tone === "active" ? "arrow" : "dot"));
  node.append(element("span", label));
  return node;
}

/** @param {string} message @param {string} [tone] */
function callout(message, tone = "warning") {
  const node = element("p", null, `callout tone-${tone}`);
  node.append(icon(tone === "danger" ? "x" : "stale"));
  node.append(element("span", message));
  return node;
}

/** @param {string} summaryText @param {Node} content */
function disclosure(summaryText, content) {
  const details = element("details");
  details.append(element("summary", summaryText));
  details.append(content);
  return details;
}

/**
 * A whole run section behind one native disclosure. The built section keeps its
 * own id, tab stop, and heading — the heading simply moves into the summary
 * line — so deep links, the skip link, and keyboard shortcuts keep resolving.
 *
 * `build` runs immediately and its result is appended, so expanding performs no
 * read and needs no refresh. The open attribute is never set and collapse state
 * is never recorded: it is presentation only and must not reach the route.
 * @param {number | null} count @param {string} staleNote @param {() => HTMLElement} build
 */
function collapsibleSection(count, staleNote, build) {
  const section = build();
  const details = /** @type {HTMLDetailsElement} */ (element("details"));
  const summary = element("summary");
  const heading = section.firstElementChild;
  if (heading instanceof HTMLHeadingElement) summary.append(heading);
  if (count !== null) summary.append(element("span", `${count}`, "section-count"));
  if (staleNote !== "") {
    const note = element("span", null, "section-stale");
    note.append(icon("stale"), element("span", staleNote));
    summary.append(note);
  }
  const body = element("div", null, "section-body");
  while (section.firstChild !== null) body.append(section.firstChild);
  details.append(summary, body);
  section.append(details);
  section.classList.add("collapsible");
  // A keyboard shortcut or skip link that focuses this section must not land on
  // hidden content. Opening on focus is presentation only: nothing is recorded.
  section.addEventListener("focus", () => { details.open = true; });
  return section;
}

/**
 * Copy one recorded value to the clipboard. The button places text and does
 * nothing else: it opens no writer, collects no consent, and executes nothing.
 * @param {string} buttonLabel @param {string} value @param {string} subject
 * @param {DashboardApplication} application @param {string} [suffix]
 */
function copyControl(buttonLabel, value, subject, application, suffix = " It has not been executed.") {
  const copy = /** @type {HTMLButtonElement} */ (element("button", buttonLabel));
  copy.type = "button";
  copy.className = "copy-control";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
      application.live.textContent = `${subject} copied.${suffix}`;
    } catch (error) {
      application.live.textContent = `Clipboard failed for the ${subject}; nothing was copied: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  return copy;
}

/**
 * A long recorded identifier shown short. The untruncated value stays in the
 * accessibility tree and on the clipboard, so shortening never removes it.
 * @param {{ available: boolean, display: string, full: string, truncated: boolean }} presentation
 * @param {string} label @param {DashboardApplication} application
 */
function identityNode(presentation, label, application) {
  if (!presentation.available) return element("span", presentation.display, "unavailable");
  const wrapper = element("span", null, "identity");
  wrapper.append(element("span", presentation.display, "identity-display"));
  if (presentation.truncated) {
    wrapper.append(element("span", ` ${label} in full: ${presentation.full}`, "visually-hidden"));
  }
  wrapper.append(copyControl(`Copy ${label}`, presentation.full, label, application, ""));
  return wrapper;
}

/**
 * A recorded timestamp shown in the viewer's zone with the recorded UTC string
 * retained in the datetime attribute and in the accessibility tree.
 * @param {string | null} value
 */
function recordedTime(value) {
  const presentation = timestampPresentation(value);
  if (!presentation.available) return element("span", presentation.display, "unavailable");
  const node = /** @type {HTMLTimeElement} */ (element("time", presentation.display));
  node.dateTime = presentation.utc;
  const wrapper = element("span", null, "timestamp");
  wrapper.append(node, element("span", ` recorded as ${presentation.utc}`, "visually-hidden"));
  return wrapper;
}

/**
 * Two-decimal money with the recorded value retained for assistive technology.
 * @param {number | null} value
 */
function moneyNode(value) {
  const presentation = usdPresentation(value);
  if (!presentation.available) return element("span", presentation.display, "unavailable");
  const wrapper = element("span", null, "money");
  wrapper.append(element("span", presentation.display, "money-display"));
  wrapper.append(element("span", ` ${presentation.exact} exactly`, "visually-hidden"));
  return wrapper;
}

/** @param {ResourceState} resource */
function resourceStatus(resource) {
  if (resource.errorCode === null) return "";
  const prefix = resource.stale && resource.envelope !== null
    ? `Stale snapshot from ${resource.envelope.observedAt}. ` : "";
  const reason = resource.reason ?? "dashboard request failed";
  const detail = reason.startsWith(`${resource.errorCode}:`) ? reason : `${resource.errorCode}: ${reason}`;
  return `${prefix}${detail}`;
}

/** @param {HTMLElement} target @param {string} message */
function showSessionExpired(target, message) {
  // This function owns the terminal-failure screen, so it also clears the
  // shell's initial busy state: a region left `aria-busy="true"` suppresses
  // announcement of the very message it now holds.
  target.setAttribute("aria-busy", "false");
  target.replaceChildren(
    element("h2", "Dashboard session unavailable"),
    element("p", message),
    element("p", "Return to the terminal and reopen the original bootstrap URL. Reloading this tab works only when it retained the session token."),
  );
}

/* ------------------------------------------------------------------ *
 * Portfolio KPI bar
 * ------------------------------------------------------------------ */

/**
 * @param {string} label @param {string} iconName @param {Node | string} value
 * @param {string} scope @param {string} [detail]
 */
function kpiCard(label, iconName, value, scope, detail = "") {
  const card = element("article", null, "kpi-card");
  const head = element("div", null, "kpi-head");
  head.append(icon(iconName), element("h3", label));
  card.append(head);
  const primary = element("p", null, "kpi-value");
  if (typeof value === "string") primary.textContent = value;
  else primary.append(value);
  card.append(primary);
  card.append(element("p", scope, "kpi-scope"));
  if (detail !== "") card.append(element("p", detail, "kpi-detail"));
  return card;
}

/** @param {ReturnType<typeof portfolioProjection>} projection */
function coverageText(projection) {
  const { coverage } = projection;
  return `${coverage.contributing} of ${coverage.loadedRuns} loaded runs supplied a snapshot` +
    ` (${coverage.fresh} current, ${coverage.stale} stale, ${coverage.pending} loading,` +
    ` ${coverage.unavailable} unavailable).`;
}

/** @param {HTMLElement} parent @param {ReturnType<typeof portfolioProjection>} projection */
function renderKpiBar(parent, projection) {
  const section = panel("Portfolio health", "portfolio-health", "kpi-panel");
  section.append(element("p",
    `Scope: every run in the loaded window across ${projection.repositories.configured} configured ` +
    `${projection.repositories.configured === 1 ? "repository" : "repositories"}.`,
    "source-note"));
  if (projection.limitedScope) {
    section.append(callout("At least one repository reports more runs beyond the selected limit. These metrics cover only the loaded window, and the read route does not report how many runs are outside it."));
  }
  if (projection.repositories.unavailable > 0) {
    section.append(callout(`${projection.repositories.unavailable} configured ${projection.repositories.unavailable === 1 ? "repository has" : "repositories have"} no loaded run list. Their runs are excluded from every metric.`));
  }
  const grid = element("div", null, "kpi-grid");
  const runScope = `${projection.runs} loaded run ${projection.runs === 1 ? "summary" : "summaries"}.`;
  grid.append(kpiCard("Runs", "runs", countNode(projection.runs), runScope));
  grid.append(kpiCard("Blocked Runs", "blocked", countNode(projection.blockedRuns),
    "Persisted status blocked.", runScope));
  grid.append(kpiCard("Active Runs", "active", countNode(projection.activeRuns),
    "Persisted status in progress.", "This does not assert that an agent is executing now."));
  grid.append(kpiCard("Findings", "findings",
    projection.findings.value === null ? "Unavailable" : countNode(projection.findings.value),
    "Canonical findings in loaded snapshots."));
  grid.append(kpiCard("Known Cost", "cost", moneyNode(projection.cost.knownUsd),
    "Reported spend in loaded snapshots.",
    projection.cost.knownUsd === null
      ? "No contributing agent row reported a cost. Unreported rows are not zero-cost executions."
      : `${projection.cost.reportedRows} reported and ${projection.cost.unreportedRows} unreported agent rows of ${projection.cost.agentRows}.`));
  grid.append(kpiCard("Total Tokens", "tokens",
    projection.tokens.known === null ? "Unavailable" : countNode(projection.tokens.known),
    "Sum of reported input, output, cache-read, and cache-write tokens.",
    projection.tokens.classes
      .map((entry) => `${entry.label}: ${entry.known === null ? "unavailable" : exactCount(entry.known)}`)
      .join(", ")));
  grid.append(kpiCard("Success Rate", "success",
    projection.successRate.value === null ? "Unavailable" : `${(projection.successRate.value * 100).toFixed(1)}%`,
    "Completed divided by completed plus blocked terminal runs.",
    projection.successRate.terminalRuns === 0
      ? "No terminal run is loaded, so no rate exists."
      : `${projection.successRate.completedRuns} completed and ${projection.successRate.blockedRuns} blocked terminal runs.`));
  grid.append(kpiCard("Average Execution Time", "duration", "Unavailable",
    "Mean recorded agent execution duration per run.", projection.averageExecution.reason));
  section.append(grid);
  // One shared reason for eight cards is one statement, not eight repetitions.
  section.append(element("p",
    `${TREND_UNAVAILABLE_LABEL} for every metric above: the read route exposes one observation per run and no historical series, so no direction of travel can be derived.`,
    "source-note"));
  section.append(element("p", coverageText(projection), "source-note"));
  parent.append(section);
}

/* ------------------------------------------------------------------ *
 * Repository portfolio
 * ------------------------------------------------------------------ */

/** @param {HTMLElement} parent @param {RepositoryState} repositoryState @param {DashboardApplication} application */
function renderRepository(parent, repositoryState, application) {
  const article = element("article", null, "repository");
  const status = resourceStatus(repositoryState.runs);
  const envelope = repositoryState.runs.envelope;
  const list = runListResult(repositoryState.runs);
  // The heading names the recorded project identity, so the loaded run list
  // must resolve before it is appended rather than after.
  const identity = repositoryIdentity(repositoryState.repository.path, list?.runs ?? []);
  article.append(element("h3", identity.display));
  if (status !== "") {
    const node = callout(status, repositoryState.runs.stale ? "warning" : "danger");
    node.setAttribute("role", "status");
    article.append(node);
  }
  if (envelope === null || list === null) {
    article.append(element("p", repositoryState.runs.reason === null
      ? "No run list has been observed."
      : "No run list is available for this repository.", "empty-state"));
    parent.append(article);
    return;
  }
  if (list.runs.length === 0) {
    // Zero runs: one line. A definition list, a disclosure, and a run-limit
    // note around an empty state say nothing the line does not.
    const empty = element("p", null, "empty-state");
    empty.append(element("span", `${identity.display} has no recorded run (0 of a selected limit of ${list.limit}). `));
    empty.append(identityNode({ available: true, display: identity.canonicalPath, full: identity.canonicalPath, truncated: false },
      "repository path", application));
    article.append(empty);
    parent.append(article);
    return;
  }
  // The submitted path and the canonical repository the route resolved are two
  // different recorded facts, so both are shown and neither is merged away.
  article.append(definitionList([
    ["Canonical repository", text(envelope.repository)],
    ["Observed", recordedTime(envelope.observedAt)],
  ], "definitions compact"));
  article.append(disclosure("Repository request detail", definitionList([
    ["Submitted path", repositoryState.repository.path],
    ["Run limit", String(list.limit)],
  ], "definitions compact")));
  const query = application.search.toLowerCase();
  const visible = list.runs.filter((entry) =>
    (application.statusFilter === "" || entry.status === application.statusFilter) &&
    (application.phaseFilter === "" || entry.phase === application.phaseFilter) &&
    (query === "" || [entry.id, entry.project, entry.featureId, entry.slug].join(" ").toLowerCase().includes(query)));
  if (visible.length === 0) {
    article.append(element("p", "No loaded run matches the current display filters. Portfolio metrics still cover the full loaded window.", "empty-state"));
  } else {
    const scroll = element("div", null, "table-scroll");
    const table = element("table", null, "run-table");
    table.append(element("caption", `Runs for ${identity.display}`));
    const head = element("thead");
    const headRow = element("tr");
    for (const label of ["Run", "Project", "Feature", "Slug", "State", "Last activity", "Snapshot"]) {
      const cell = element("th", label);
      cell.setAttribute("scope", "col");
      headRow.append(cell);
    }
    head.append(headRow);
    table.append(head);
    const body = element("tbody");
    for (const run of visible) {
      const row = element("tr");
      if (application.selectedRepositoryId === repositoryState.repository.id &&
          application.selectedRunId === run.id) row.setAttribute("aria-current", "true");
      const first = element("td");
      const select = /** @type {HTMLButtonElement} */ (element("button", `View run ${run.id}`));
      select.type = "button";
      select.className = "run-select";
      select.addEventListener("click", () => selectRun(application, repositoryState.repository.id, run.id));
      first.append(select);
      row.append(first);
      for (const value of [run.project, run.featureId, run.slug]) row.append(element("td", String(value)));
      const presentation = statusPresentation(run.status, run.phase);
      const stateCell = element("td");
      stateCell.append(badge(presentation.label, presentation.tone));
      row.append(stateCell);
      const activity = element("td");
      activity.append(recordedTime(run.lastRecordedAt));
      row.append(activity);
      const slot = repositoryState.snapshots.get(run.id);
      const state = slot === undefined ? "unavailable" : snapshotState({
        runId: run.id, snapshot: slotSnapshot(slot), stale: slot.resource.stale, loading: slot.loading,
      });
      row.append(element("td", {
        fresh: "Current", stale: "Stale", pending: "Loading", unavailable: "Unavailable",
      }[state], `snapshot-${state}`));
      body.append(row);
    }
    table.append(body);
    scroll.append(table);
    article.append(scroll);
  }
  article.append(element("p", list.hasMore
    ? `More runs exist beyond the selected limit of ${list.limit}. The read route does not report how many.`
    : `All runs within the selected limit of ${list.limit} are shown.`, "source-note"));
  parent.append(article);
}

/* ------------------------------------------------------------------ *
 * Selected run: executive summary, timeline, activity
 * ------------------------------------------------------------------ */

/** @param {string} label @param {Node | string} value @param {string} detail */
function summaryTile(label, value, detail) {
  const tile = element("article", null, "summary-tile");
  tile.append(element("h4", label));
  const primary = element("p", null, "summary-value");
  if (typeof value === "string") primary.textContent = value;
  else primary.append(value);
  tile.append(primary);
  if (detail !== "") tile.append(element("p", detail, "summary-detail"));
  return tile;
}

/** @param {string[]} limitations */
function limitationsBlock(limitations) {
  const block = element("div", null, "subsection");
  block.append(element("p", "Evidence the authoritative projection could not establish. These bound every claim in this run view.", "source-note"));
  if (limitations.length === 0) {
    block.append(element("p", "No recorded limitations.", "empty-state"));
    return block;
  }
  const list = element("ul", null, "limitation-list");
  for (const limitation of limitations) {
    const item = element("li", null, "limitation");
    item.append(icon("x"), element("span", limitation));
    list.append(item);
  }
  block.append(list);
  return block;
}

/**
 * The triage answer the run view opens on. Every claim here is copied from the
 * projected executive summary, which selects from projected records; nothing is
 * parsed out of the eligibility prose and no remediation sentence is invented.
 * @param {ReturnType<typeof runExecutiveSummary>} summary
 * @param {ReturnType<typeof snapshotProjection>} projection
 * @param {DashboardApplication} application
 */
function renderExecutiveSummary(summary, projection, application) {
  const section = panel("Run summary", "run-summary", "executive-summary");
  const run = projection.overview.run;
  // R10: the latest recorded timestamp is surfaced here; the ones it supersedes
  // stay in the Run detail disclosure. Which one is latest is decided by the
  // model, not by the order they are listed in.
  const stamps = latestTimestamp([
    { label: "Created", value: run.createdAt },
    { label: "Updated", value: run.updatedAt },
    { label: "Last recorded activity", value: projection.overview.activity.lastRecordedAt },
  ]);
  const head = element("div", null, `summary-head tone-${summary.state.tone}`);
  head.append(badge(summary.state.label, summary.state.tone));
  head.append(element("p",
    `${summary.repository.display} · run ${summary.run.id} · ${summary.run.slug} · ${summary.run.changeKind}`,
    "summary-identity"));
  head.append(element("p", summary.state.source === "phase"
    ? `Derived phase ${projection.overview.phase}; persisted status ${projection.overview.run.status}.`
    : `Persisted status ${projection.overview.run.status}; derived phase ${projection.overview.phase}.`, "source-note"));
  section.append(head);

  const grid = element("div", null, "summary-grid");
  const blocking = summary.blockingFinding;
  grid.append(summaryTile("Blocking finding",
    blocking.available ? `Finding ${blocking.id}: ${blocking.title}` : "Unavailable",
    blocking.available
      ? `${blocking.finalPanelBlocking
        ? "The final code-review panel recorded this finding as blocking."
        : blocking.finalPanelProjected
          ? "The final code-review panel recorded no blocking finding, so this is the highest-ranked recorded finding."
          : "No final-panel result is projected for this run, so this is the highest-ranked recorded finding."}` +
        ` Severity ${blocking.severityAvailable ? blocking.severity : "unranked"}` +
        `${blocking.tiedWith > 0 ? `, tied with ${blocking.tiedWith} other recorded ${blocking.tiedWith === 1 ? "finding" : "findings"}` : ""}` +
        `. Stage ${blocking.stageId}, round ${blocking.round}, at ${blocking.location}.`
      : blocking.reason ?? ""));
  grid.append(summaryTile("Known cost", moneyNode(summary.cost.available ? projection.cost.knownUsd : null),
    summary.cost.available
      ? `${projection.cost.costReportedRows} reported and ${projection.cost.costUnreportedRows} unreported of ${projection.cost.agentRows} agent rows.`
      : "No contributing agent row reported a cost."));
  grid.append(summaryTile("Known tokens",
    summary.tokens.known === null ? "Unavailable" : countNode(summary.tokens.known),
    summary.tokens.known === null
      ? "No contributing agent row reported a token class."
      : "Sum of reported input, output, cache-read, and cache-write tokens."));

  const action = summary.nextAction;
  const next = element("article", null, "summary-tile next-action");
  next.append(element("h4", "Next action"));
  next.append(element("p", text(action.group), "summary-value"));
  next.append(badge(action.eligible ? "Eligible" : "Not eligible", action.eligible ? "success" : "neutral"));
  if (action.reasons.length === 0) {
    next.append(element("p", "No recorded refusal reason.", "empty-state"));
  } else {
    const reasons = element("ul", null, "reason-list");
    for (const reason of action.reasons) {
      const item = element("li");
      item.append(element("strong", reason.code), element("span", ` ${reason.reason}`));
      reasons.append(item);
    }
    next.append(reasons);
  }
  // snapshotProjection files the workflow action's own command under the kind
  // "workflow". An execution group is never a command kind, so matching on
  // action.group would silently never resolve.
  const projected = projection.governance.commands.find((command) => command.kind === "workflow") ?? null;
  if (projected !== null) {
    next.append(element("code", projected.text, "command-text"));
    next.append(copyControl(`Copy ${projected.kind} command`, projected.text, `${projected.kind} command`, application));
  }
  grid.append(next);
  section.append(grid);

  if (stamps.latest !== null) {
    const recent = element("p", null, "source-note");
    recent.append(element("span", `Most recent recorded timestamp — ${stamps.latest.label}: `));
    recent.append(recordedTime(stamps.latest.value));
    section.append(recent);
  }

  for (const entry of summary.grouped) {
    section.append(element("p", entry.statement, "unavailable"));
  }

  const detail = element("div", null, "subsection");
  detail.append(definitionList([
    ["Repository", summary.repository.canonicalPath],
    ["Run", String(run.id)],
    ["Project", run.project],
    ["Feature", run.featureId],
    ["Slug", run.slug],
    ["Change kind", run.changeKind],
    ["Persisted status", run.status],
    ["Derived phase", projection.overview.phase],
    ...stamps.others.map((entry) =>
      /** @type {[string, Node | string]} */ ([entry.label, recordedTime(entry.value)])),
  ]));
  const writer = projection.overview.writer;
  const writerBlock = element("div");
  writerBlock.append(element("h4", "Writer lock"));
  if (writer.status === "absent") {
    // An absent lock has no process, no creation time, and no reason to show.
    writerBlock.append(element("p", `No writer lock is present at ${writer.path}.`, "empty-state"));
  } else {
    writerBlock.append(definitionList([
      ["Status", writer.status],
      ["Path", writer.path],
      ["Process ID", writer.pid === null ? "Unavailable" : String(writer.pid)],
      ["Created", recordedTime(writer.createdAt)],
      ["Reason", text(writer.reason, "No recorded reason")],
    ], "definitions compact"));
    writerBlock.append(element("p", "A recorded process ID identifies the writer that created the lock; the operating system may have reused that number since.", "source-note"));
  }
  detail.append(writerBlock);
  section.append(disclosure("Run detail", detail));
  section.append(disclosure(
    `Recorded limitations (${projection.overview.limitations.length})`,
    limitationsBlock(projection.overview.limitations)));
  return section;
}

/** @param {ReturnType<typeof snapshotProjection>} projection */
function renderTimeline(projection) {
  const section = panel("Workflow timeline", "workflow");
  section.append(element("p", "Recorded stages in their recorded order. A stage the run never recorded is absent rather than complete, and no stage runs in parallel.", "source-note"));
  if (projection.stageViews.length === 0) {
    section.append(element("p", "No stage has been recorded for this run.", "empty-state"));
    return section;
  }
  const scroll = element("div", null, "timeline-scroll");
  const list = element("ol", null, "timeline");
  for (const view of projection.stageViews) {
    const stage = view.stage;
    const item = element("li", null, `timeline-item tone-${view.presentation.tone}`);
    const marker = element("span", null, "timeline-marker");
    marker.append(icon(view.presentation.symbol));
    item.append(marker);
    item.append(element("h3", `${stage.ordinal + 1}. ${stage.kind}`, "timeline-title"));
    item.append(badge(view.presentation.label, view.presentation.tone));
    item.append(disclosure(`Stage ${stage.id} details`, definitionList([
      ["Stage ID", String(stage.id)],
      ["Input stage", stage.inputStageId === null ? "None" : String(stage.inputStageId)],
      ["Recorded status", stage.status],
      ["Gate result", text(stage.gateResult, "No recorded gate result")],
      ["Output reference", text(stage.outputRef, "No recorded output")],
      ["Started", recordedTime(stage.startedAt)],
      ["Ended", recordedTime(stage.endedAt)],
      ["Start evidence", recordedTime(stage.startEvidence.at)],
      ["Start evidence source", text(stage.startEvidence.source)],
      ["Start evidence audit", stage.startEvidence.auditId === null ? "Unavailable" : String(stage.startEvidence.auditId)],
    ], "definitions compact")));
    list.append(item);
  }
  scroll.append(list);
  section.append(scroll);
  return section;
}

/** @param {ReturnType<typeof snapshotProjection>} projection */
function renderActivity(projection) {
  const section = panel("Activity", "activity");
  section.append(element("p", "Recorded stage start evidence, stage completion timestamps, and the single latest audit event this projection exposes. This is not the complete audit stream.", "source-note"));
  section.append(definitionList([
    ["Last recorded activity", recordedTime(projection.overview.activity.lastRecordedAt)],
  ], "definitions compact"));
  if (projection.activityItems.length === 0) {
    section.append(element("p", "No recorded timestamp produced an activity observation.", "empty-state"));
    return section;
  }
  const list = element("ol", null, "activity-feed");
  for (const item of projection.activityItems) {
    const entry = element("li", null, "activity-item");
    entry.append(recordedTime(item.at));
    entry.append(element("p", item.event, "activity-event"));
    entry.append(definitionList([
      ["Stage", item.stageKind === null ? "Not recorded for this observation" : `${item.stageKind} (stage ${item.stageId})`],
      ["Recorded result", text(item.result, "No recorded result")],
      ["Summary", text(item.summary, "No recorded summary")],
      ["Source", item.source],
    ], "definitions compact"));
    list.append(entry);
  }
  section.append(list);
  return section;
}

/* ------------------------------------------------------------------ *
 * Cost, token, and agent analytics
 * ------------------------------------------------------------------ */

/** @param {ReturnType<typeof snapshotProjection>} projection */
function renderCostCards(projection) {
  const section = panel("Cost and token coverage", "cost");
  section.append(element("p", "Values come only from this run's recorded agent rows. An unreported row is not a zero-cost execution.", "source-note"));
  const grid = element("div", null, "kpi-grid");
  const cost = projection.cost;
  grid.append(kpiCard("Known cost", "cost",
    moneyNode(cost.costReportedRows === 0 ? null : cost.knownUsd), `Currency ${cost.currency}.`,
    `${cost.costReportedRows} reported and ${cost.costUnreportedRows} unreported of ${cost.agentRows} agent rows.`));
  grid.append(kpiCard("Agent rows", "runs", countNode(cost.agentRows), "Recorded agent executions.",
    `${cost.recordedFailedAttempts} recorded failed attempts. A failed attempt carries no inferred spend.`));
  for (const entry of projection.tokens.classes) {
    grid.append(kpiCard(`${entry.label} tokens`, "tokens",
      entry.known === null ? "Unavailable" : countNode(entry.known),
      entry.unreportedRows > 0 ? "Partial coverage." : "Complete coverage.",
      `${entry.reportedRows} reported and ${entry.unreportedRows} unreported rows. Exact total ${entry.known === null ? "unavailable" : exactCount(entry.known)}.`));
  }
  section.append(grid);
  return section;
}

/** @param {number} index */
function seriesClass(index) {
  return `series-${(index % 8) + 1}`;
}

/** @param {number} index @param {string} label */
function legendItem(index, label) {
  const item = element("li", null, "legend-item");
  const swatch = svg("svg", {
    class: `legend-swatch ${seriesClass(index)}`, viewBox: "0 0 10 10",
    width: "12", height: "12", "aria-hidden": "true", focusable: "false",
  });
  swatch.append(svg("rect", { x: "0", y: "0", width: "10", height: "10" }));
  item.append(swatch);
  item.append(element("span", label));
  return item;
}

/** @param {ReturnType<typeof snapshotProjection>} projection */
function renderStageCostChart(projection) {
  const section = panel("Cost by stage", "cost-by-stage");
  const series = projection.charts.stages;
  if (series.length === 0) {
    section.append(element("p", "This run has no recorded stage cost group.", "empty-state"));
    return section;
  }
  const rowHeight = 28;
  const chart = svg("svg", {
    class: "chart bar-chart", role: "img", viewBox: `0 0 100 ${series.length * rowHeight}`,
    preserveAspectRatio: "none", "aria-labelledby": "cost-by-stage-title cost-by-stage-desc",
  });
  const title = svg("title", { id: "cost-by-stage-title" });
  title.textContent = "Known cost by recorded stage";
  const description = svg("desc", { id: "cost-by-stage-desc" });
  description.textContent = projection.charts.stageMax === 0
    ? "No stage group reports a positive cost, so no bar is drawn. The table below lists every stage and its coverage."
    : `Horizontal bars scaled to the largest reported stage cost of ${usdPresentation(projection.charts.stageMax).display}. The table below lists exact values.`;
  chart.append(title, description);
  series.forEach((entry, index) => {
    chart.append(svg("rect", {
      class: `bar ${seriesClass(index)}`, x: "0", y: String(index * rowHeight + 4),
      width: String(entry.fraction * 100), height: String(rowHeight - 8),
    }));
  });
  section.append(chart);
  const legend = element("ul", null, "legend");
  series.forEach((entry, index) => legend.append(legendItem(index,
    `${entry.kind} (stage ${entry.stageId}): ${usdPresentation(entry.knownUsd).display}`)));
  section.append(legend);
  section.append(disclosure("Cost by stage data", dataTable(
    "Exact known cost and coverage for every recorded stage group",
    ["Stage", "Kind", "Known cost", "Reported rows", "Unreported rows", "Agent rows"],
    series.map((entry) => [
      String(entry.stageId), entry.kind, moneyNode(entry.knownUsd),
      String(entry.reportedRows), String(entry.unreportedRows), String(entry.agentRows),
    ]),
  )));
  return section;
}

/** @param {ReturnType<typeof snapshotProjection>} projection */
function renderAgentCostChart(projection) {
  const section = panel("Cost by agent", "cost-by-agent");
  const series = projection.charts.agents;
  if (series.length === 0) {
    section.append(element("p", "This run has no recorded agent cost group.", "empty-state"));
    return section;
  }
  if (projection.charts.agentState === "unavailable") {
    section.append(callout("No agent group reports a cost. A proportional chart would manufacture values the run never recorded."));
  } else if (projection.charts.agentState === "reported_zero") {
    section.append(callout("Every reported agent cost is zero. The run recorded those zeros, and no proportion exists to draw."));
  } else {
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const chart = svg("svg", {
      class: "chart donut-chart", role: "img", viewBox: "0 0 120 120",
      width: "180", height: "180", "aria-labelledby": "cost-by-agent-title cost-by-agent-desc",
    });
    const title = svg("title", { id: "cost-by-agent-title" });
    title.textContent = "Share of known cost by agent";
    const description = svg("desc", { id: "cost-by-agent-desc" });
    description.textContent = "One ring segment per agent with a positive reported cost. The legend and table below carry exact values and coverage.";
    chart.append(title, description);
    chart.append(svg("circle", {
      class: "donut-track", cx: "60", cy: "60", r: String(radius), fill: "none", "stroke-width": "18",
    }));
    series.forEach((entry, index) => {
      if (entry.fraction <= 0) return;
      chart.append(svg("circle", {
        class: `donut-segment ${seriesClass(index)}`, cx: "60", cy: "60", r: String(radius), fill: "none",
        "stroke-width": "18", transform: "rotate(-90 60 60)",
        "stroke-dasharray": `${entry.fraction * circumference} ${circumference}`,
        "stroke-dashoffset": String(-entry.startFraction * circumference),
      }));
    });
    section.append(chart);
  }
  const legend = element("ul", null, "legend");
  series.forEach((entry, index) => legend.append(legendItem(index,
    `${entry.agent}: ${usdPresentation(entry.knownUsd).display}`)));
  section.append(legend);
  section.append(disclosure("Cost by agent data", dataTable(
    "Exact known cost and coverage for every recorded agent group",
    ["Agent", "Known cost", "Reported rows", "Unreported rows", "Agent rows"],
    series.map((entry) => [
      entry.agent, moneyNode(entry.knownUsd),
      String(entry.reportedRows), String(entry.unreportedRows), String(entry.agentRows),
    ]),
  )));
  return section;
}

/** @param {ReturnType<typeof snapshotProjection>} projection */
function renderTokenChart(projection) {
  const section = panel("Recorded token consumption by workflow stage", "tokens");
  section.append(element("p", "The horizontal axis is recorded stage ordinal, not wall-clock time. A stage with no reported row for a class leaves a gap rather than a zero.", "source-note"));
  const groups = projection.charts.tokensByStage;
  if (groups.length === 0) {
    section.append(element("p", "This run has no recorded stage token group.", "empty-state"));
    return section;
  }
  const width = 100;
  const height = 60;
  const maximum = projection.charts.tokenMax;
  const state = projection.charts.tokenState;
  if (state === "unavailable") {
    section.append(callout("No stage group reports a token class. A series would manufacture values the run never recorded."));
    section.append(tokenTable(groups));
    return section;
  }
  const chart = svg("svg", {
    class: "chart line-chart", role: "img", viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none", "aria-labelledby": "tokens-title tokens-desc",
  });
  const title = svg("title", { id: "tokens-title" });
  title.textContent = "Reported token totals across recorded workflow stages";
  const description = svg("desc", { id: "tokens-desc" });
  description.textContent = state === "reported_zero"
    ? `Every reported token total across ${groups.length} recorded ${groups.length === 1 ? "stage" : "stages"} is zero. The run recorded those zeros, so each reported point sits on the baseline and a stage with no reported row still leaves a gap. The table below lists exact values.`
    : `Four series across ${groups.length} recorded ${groups.length === 1 ? "stage" : "stages"}, scaled to ${exactCount(maximum)} tokens. The table below lists exact values.`;
  chart.append(title, description);
  const step = groups.length === 1 ? 0 : width / (groups.length - 1);
  projection.tokens.classes.forEach((entry, index) => {
    /** @type {{ x: number, y: number }[]} */
    let current = [];
    /** @type {{ x: number, y: number }[][]} */
    const segments = [];
    groups.forEach((group, position) => {
      const value = group.tokens.classes[index]?.known ?? null;
      if (value === null) {
        if (current.length > 0) segments.push(current);
        current = [];
        return;
      }
      current.push({
        x: groups.length === 1 ? width / 2 : position * step,
        y: maximum === 0 ? height : height - (value / maximum) * height,
      });
    });
    if (current.length > 0) segments.push(current);
    for (const segment of segments) {
      const first = segment[0];
      if (first === undefined) continue;
      if (segment.length === 1) {
        chart.append(svg("circle", {
          class: `token-point ${seriesClass(index)}`, cx: String(first.x), cy: String(first.y), r: "1.5",
        }));
        continue;
      }
      chart.append(svg("polyline", {
        class: `token-line ${seriesClass(index)}`, fill: "none", "stroke-width": "1.5",
        points: segment.map((point) => `${point.x},${point.y}`).join(" "),
      }));
    }
  });
  section.append(chart);
  const legend = element("ul", null, "legend");
  projection.tokens.classes.forEach((entry, index) => legend.append(legendItem(index,
    `${entry.label}: ${entry.known === null ? "unavailable" : exactCount(entry.known)}`)));
  section.append(legend);
  section.append(tokenTable(groups));
  return section;
}

/** @param {ReturnType<typeof snapshotProjection>["charts"]["tokensByStage"]} groups */
function tokenTable(groups) {
  return disclosure("Token consumption data", dataTable(
    "Exact reported token totals and coverage for every recorded stage group",
    ["Stage", "Kind", "Input", "Output", "Cache read", "Cache write", "Reported rows", "Unreported rows"],
    groups.map((group) => [
      String(group.stageId), group.kind,
      ...group.tokens.classes.map((entry) => entry.known === null ? "Unavailable" : exactCount(entry.known)),
      String(group.tokens.classes[0]?.reportedRows ?? 0),
      String(group.tokens.classes[0]?.unreportedRows ?? 0),
    ]),
  ));
}

/** @param {{ known: number | null, reportedRows: number, unreportedRows: number } | undefined} entry */
function tokenCell(entry) {
  if (entry === undefined) return "Unavailable";
  const qualifier = coverageQualifier(entry);
  const total = entry.known === null ? "Unavailable" : exactCount(entry.known);
  return qualifier === null ? total : `${total} (${qualifier})`;
}

/**
 * Cost and token evidence as one section. The four existing views keep their
 * own ids and captions; grouping them only stops four separate headings from
 * competing for the same attention.
 * @param {ReturnType<typeof snapshotProjection>} projection
 */
function renderCostAndTokens(projection) {
  const section = panel("Cost and tokens", "cost-and-tokens");
  section.append(element("p", AGENT_TOKEN_CLASS_NOTE, "source-note"));
  section.append(
    renderCostCards(projection),
    renderStageCostChart(projection),
    renderAgentCostChart(projection),
    renderTokenChart(projection),
  );
  return section;
}

/** @param {ReturnType<typeof snapshotProjection>} projection */
function renderAgentTable(projection) {
  const section = panel("Agent analytics", "agents");
  const rows = projection.agents;
  if (rows.length === 0) {
    section.append(element("p", "This run has no recorded agent group.", "empty-state"));
    return section;
  }
  section.append(element("p", AGENT_TOKEN_CLASS_NOTE, "source-note"));

  // A value identical on every projected row is a constant, not a column. It is
  // decided against the rows this run actually recorded, so a column that
  // varies in another run still appears there.
  const model = constantColumn(rows, (row) => row.modelLabel);
  const trend = constantColumn(rows, (row) => row.trend);
  const classes = projection.tokens.classes;
  const coverage = fullCoverageStatement(rows.flatMap((row) => row.tokens.classes));
  if (model.constant) {
    section.append(element("p", collapsedColumnStatement("Model", model.value, model.rowCount) +
      " The authoritative projection binds no model to an agent row.", "source-note"));
  }
  if (trend.constant) {
    section.append(element("p", collapsedColumnStatement("Trend", TREND_UNAVAILABLE_LABEL, trend.rowCount) +
      " No per-agent historical series exists.", "source-note"));
  }
  if (coverage !== null) section.append(element("p", coverage, "source-note"));

  /** @type {string[]} */
  const headers = ["Agent"];
  if (!model.constant) headers.push("Model");
  headers.push("Executions", ...classes.map((entry) => `${entry.label} tokens`),
    "Known cost", "Findings generated");
  if (!trend.constant) headers.push("Trend");

  section.append(dataTable(
    "Recorded executions, token coverage, cost coverage, and attributed reports for every agent group",
    headers,
    rows.map((row) => {
      /** @type {(Node | string)[]} */
      const cells = [row.agent];
      if (!model.constant) cells.push(row.modelLabel);
      cells.push(String(row.executions));
      for (let index = 0; index < classes.length; index += 1) cells.push(tokenCell(row.tokens.classes[index]));
      const costQualifier = coverageQualifier({ reportedRows: row.costReportedRows, unreportedRows: row.costUnreportedRows });
      const cost = element("span");
      cost.append(moneyNode(row.knownUsd));
      if (costQualifier !== null) cost.append(element("span", ` (${costQualifier})`));
      if (row.recordedFailedAttempts > 0) {
        cost.append(element("span", ` (${row.recordedFailedAttempts} recorded failed attempts)`));
      }
      cells.push(cost, String(row.findingsGenerated));
      if (!trend.constant) cells.push(TREND_UNAVAILABLE_LABEL);
      return cells;
    }),
  ));
  return section;
}

/* ------------------------------------------------------------------ *
 * Findings, governance, delivery, and evidence
 * ------------------------------------------------------------------ */

/** @param {string} severity */
function severityTone(severity) {
  const value = severity.toLowerCase();
  if (value === "critical") return "critical";
  if (value === "high") return "danger";
  if (value === "medium") return "warning";
  if (value === "low") return "active";
  return "neutral";
}

/** @param {{ available: boolean, values: string[] | null }} parsed @param {string} absent */
function listOrState(parsed, absent) {
  if (!parsed.available) return element("p", MALFORMED_LIST_REASON, "unavailable");
  if (parsed.values === null || parsed.values.length === 0) return element("p", absent, "empty-state");
  const list = element("ul", null, "value-list");
  for (const value of parsed.values) list.append(element("li", value));
  return list;
}

/**
 * One canonical finding as a card. The card body carries only what triage
 * needs; every audit field stays in the per-card disclosure, unaltered.
 * @param {ReturnType<typeof snapshotProjection>["findingCards"][number]} card
 * @param {readonly string[] | null} severities
 * @param {boolean} showFinalPanel
 * @param {DashboardApplication} application
 */
function findingCardNode(card, severities, showFinalPanel, application) {
  const severity = cardSeverity(card, severities);
  const tone = severity.available ? severityTone(severity.severity ?? "") : "neutral";
  // The same tone mapping that colours badges and timeline markers colours the
  // card edge, so one state never reads as two different colours.
  const item = element("li", null, `finding-card tone-${tone}`);
  const head = element("div", null, "finding-head");
  head.append(badge(severity.available ? severity.severity ?? "" : "Severity unranked", tone));
  head.append(element("h3", `Finding ${card.id}: ${card.title}`));
  item.append(head);

  /** @type {[string, Node | string][]} */
  const facts = [
    ["Recorded intent key", card.intentKey],
    ["Location", card.location],
    ["Stage and round", `${card.stageId}, round ${card.round}`],
    ["Disposition", card.decision === null ? "Open: no decision is recorded." : card.decision.disposition],
  ];
  if (showFinalPanel) {
    facts.push(["Final-panel blocking", card.finalPanelBlocking === true ? "Yes" : "No"]);
  }
  item.append(definitionList(facts, "definitions compact"));

  // Report subject text is the reviewer's own recorded words. It stays
  // verbatim and untruncated at card level; nothing here shortens it.
  const reports = element("div", null, "subsection");
  if (card.reports.length === 0) {
    reports.append(element("p", "No recorded report.", "empty-state"));
  } else {
    const reportList = element("ul", null, "report-list");
    for (const report of card.reports) {
      const reportItem = element("li", null, "report");
      reportItem.append(badge(report.severity, severityTone(report.severity)));
      reportItem.append(element("p", report.subject, "report-subject"));
      reportItem.append(element("p",
        `${text(report.reviewerId, "Reviewer not recorded")} · agent run ${report.agentRunId} · ${report.classification}`,
        "source-note"));
      reportList.append(reportItem);
    }
    reports.append(reportList);
  }
  item.append(reports);

  item.append(disclosure(`Recorded decision evidence for finding ${card.id}`,
    decisionEvidence(card, application)));
  return item;
}

/**
 * The audit half of a finding card. A field the recorded disposition forbids
 * states that applicability instead of an absence label; a field it requires
 * keeps its existing recorded value and its existing malformed-record
 * handling, which remains a different and separately named condition.
 * @param {ReturnType<typeof snapshotProjection>["findingCards"][number]} card
 * @param {DashboardApplication} application
 */
function decisionEvidence(card, application) {
  const block = element("div", null, "subsection");
  const decision = card.decision;
  if (decision === null) {
    block.append(element("p", "No recorded decision.", "empty-state"));
    return block;
  }
  const applicability = card.applicability;
  block.append(definitionList([
    ["Rationale", decision.rationale],
    ["Agent run", String(decision.agentRunId)],
  ], "definitions compact"));

  const artifact = card.artifact;
  if (artifact !== null) {
    const artifactBlock = element("div");
    artifactBlock.append(element("h5", "Recorded artifact"));
    artifactBlock.append(element("p", artifact.statement, "source-note"));
    artifactBlock.append(definitionList([
      ["Hash before", identityNode(artifact.before, "artifact hash before", application)],
      ["Hash after", identityNode(artifact.after, "artifact hash after", application)],
    ], "definitions compact"));
    block.append(artifactBlock);
  }

  const grounding = element("div");
  grounding.append(element("h5", "Grounding"));
  if (applicability !== null && applicability.grounding === "forbidden") {
    grounding.append(element("p", forbiddenFieldStatement("Grounding", decision.disposition), "source-note"));
  } else {
    grounding.append(definitionList([
      ["Source", text(decision.groundingSource, "Not recorded")],
      ["Location", text(decision.groundingLocation, "Not recorded")],
      ["Excerpt", text(decision.groundingExcerpt, "Not recorded")],
    ], "definitions compact"));
  }
  block.append(grounding);

  const changed = element("div");
  changed.append(element("h5", "Changed locations"));
  changed.append(listOrState(decision.changedLocations, "No recorded changed location."));
  block.append(changed);

  const normative = element("div");
  normative.append(element("h5", "Normative changes"));
  const changes = decision.normativeChanges;
  if (applicability !== null && applicability.normativeChanges === "forbidden") {
    normative.append(element("p", forbiddenFieldStatement("Normative changes", decision.disposition), "source-note"));
  } else if (!changes.available) {
    normative.append(element("p", MALFORMED_NORMATIVE_REASON, "unavailable"));
  } else if (changes.values === null || changes.values.length === 0) {
    normative.append(element("p", "No recorded normative change.", "empty-state"));
  } else {
    const list = element("ul", null, "value-list");
    for (const change of changes.values) {
      const entry = element("li");
      entry.append(definitionList([
        ["Artifact location", change.artifactLocation],
        ["Artifact text", change.artifactText],
        ["Grounding source", change.groundingSource],
        ["Grounding location", change.groundingLocation],
        ["Grounding excerpt", change.groundingExcerpt],
      ], "definitions compact"));
      list.append(entry);
    }
    normative.append(list);
  }
  block.append(normative);
  return block;
}

/** @param {ReturnType<typeof snapshotProjection>} projection @param {DashboardApplication} application */
function renderFindings(projection, application) {
  const section = panel("Findings", "findings");
  const count = projection.findingCards.length;
  if (count === 0) {
    section.append(element("p", "This run has no canonical finding.", "empty-state"));
    return section;
  }
  section.append(element("p",
    `${count} canonical ${count === 1 ? "finding" : "findings"}. Every immutable report keeps its own reviewer, severity, classification, and subject; the dashboard synthesizes no finding-level severity or disposition.`,
    "source-note"));
  section.append(element("p", FINDING_ORDER_STATEMENT, "source-note"));
  const severities = severityOrder(projection.governance.configuration);
  const ordered = orderFindings(projection.findingCards, severities);
  const finalPanel = finalPanelBlockingSummary(ordered);
  if (finalPanel.statement !== null) section.append(element("p", finalPanel.statement, "source-note"));
  const shown = new Set(finalPanel.shown);
  const list = element("ul", null, "finding-list");
  for (const card of ordered) {
    list.append(findingCardNode(card, severities, shown.has(card), application));
  }
  section.append(list);
  return section;
}

/**
 * @param {ReturnType<typeof snapshotProjection>} projection
 * @param {DashboardApplication} application
 * @param {ReturnType<typeof repositoryIdentity>} identity
 * @param {number} runId
 */
function renderGovernance(projection, application, identity, runId) {
  const section = panel("Governed actions", "governance");
  const shellLabel = application.platform === "win32" ? "PowerShell" : "POSIX shell";
  // The repository and the shell are constant for the whole region, so they are
  // stated once rather than repeated on every tile.
  const scope = element("p", null, "source-note");
  scope.append(element("span", `Copy-only ${shellLabel} commands for run ${runId} in `));
  scope.append(element("strong", identity.display));
  scope.append(element("span", " "));
  scope.append(identityNode({ available: true, display: identity.canonicalPath, full: identity.canonicalPath, truncated: false },
    "repository path", application));
  scope.append(element("span", ". Copying places text on the clipboard; the dashboard never executes a command, opens a writer, or collects consent."));
  section.append(scope);
  const tiles = element("ul", null, "command-tiles");
  for (const command of projection.governance.commands) {
    const tile = element("li", null, `command-tile ${command.eligible ? "eligible" : "ineligible"}`);
    tile.append(element("h3", command.kind));
    tile.append(badge(command.eligible ? "Eligible" : "Not eligible", command.eligible ? "success" : "neutral"));
    /** @type {[string, Node | string][]} */
    const entries = [];
    // A repository-wide command taking no run is a recorded fact about scope,
    // not a repetition of the region's own heading.
    if (command.scope === "repository") {
      entries.push(["Run context", `Run ${runId} is selected; this command is repository-wide and takes no run.`]);
    }
    if (command.reason !== null && command.reason !== "") entries.push(["Reason", command.reason]);
    if (command.proposalId !== null) entries.push(["Proposal", String(command.proposalId)]);
    if (command.title !== null) entries.push(["Title", command.title]);
    if (command.route !== null) entries.push(["Route", command.route]);
    if (command.evidenceRef !== null) entries.push(["Evidence reference", command.evidenceRef]);
    if (entries.length > 0) tile.append(definitionList(entries, "definitions compact"));
    tile.append(element("code", command.text, "command-text"));
    const copy = copyControl(`Copy ${command.kind} command`, command.text, `${command.kind} command`, application);
    copy.disabled = !command.eligible;
    tile.append(copy);
    tiles.append(tile);
  }
  section.append(tiles);
  return section;
}

/** @param {ReturnType<typeof snapshotProjection>} projection @param {DashboardApplication} application */
function renderConfiguration(projection, application) {
  const section = panel("Frozen configuration and approval", "configuration");
  const configuration = projection.governance.configuration;
  section.append(definitionList([
    ["System name", text(configuration.systemName, "Not recorded")],
    ["Profile hash", identityNode(identityPresentation(configuration.profileHash), "profile hash", application)],
    ["Policy hash", identityNode(identityPresentation(configuration.policyHash), "policy hash", application)],
    ["Starting commit", identityNode(identityPresentation(configuration.startingCommit), "starting commit", application)],
    ["Approval deadline", text(configuration.deadline, "Not recorded")],
    ["Approval signer", text(configuration.approvalSigner, "Not recorded")],
  ]));
  const models = element("div", null, "subsection");
  models.append(element("h3", "Model map"));
  const modelEntries = Object.entries(configuration.modelMap ?? {});
  if (modelEntries.length === 0) {
    models.append(element("p", "No model map is recorded for this run.", "empty-state"));
  } else {
    models.append(dataTable("Exact frozen model identifier for each stage", ["Stage", "Model"],
      modelEntries.map(([stage, model]) => [stage, model])));
  }
  section.append(models);
  const verification = element("div", null, "subsection");
  verification.append(element("h3", "Frozen verification commands"));
  if (configuration.verificationCommands === null || configuration.verificationCommands.length === 0) {
    verification.append(element("p", "No verification command is recorded for this run.", "empty-state"));
  } else {
    verification.append(dataTable("Frozen verification command names and argument vectors",
      ["Name", "Argument vector"],
      configuration.verificationCommands.map((entry) => [entry.name, entry.argv.join(" ")])));
  }
  verification.append(element("p", "A passing frozen command records that the command exited zero. It does not prove product correctness.", "source-note"));
  section.append(verification);
  const review = element("div", null, "subsection");
  review.append(element("h3", "Review policy"));
  const documentReview = configuration.documentReview;
  const codeReview = configuration.codeReview;
  review.append(definitionList(documentReview === null
    ? [["Document review", "Not recorded"]]
    : [
      ["Document panel size", `${documentReview.panelSizeMin} to ${documentReview.panelSizeMax}`],
      ["Spec review rounds", String(documentReview.specReviewRounds)],
      ["Plan review rounds", String(documentReview.planReviewRounds)],
      ["Required specialties", documentReview.requiredSpecialties.join(", ") || "None recorded"],
    ], "definitions compact"));
  review.append(definitionList(codeReview === null
    ? [["Code review", "Not recorded"]]
    : [
      ["Code panel size", String(codeReview.panelSize)],
      ["Maximum rounds", String(codeReview.maxRounds)],
      ["Blocking severity", codeReview.blockingSeverity],
      ["Severities", codeReview.severities.join(", ")],
    ], "definitions compact"));
  review.append(element("p", "Recorded reviewer identity is what the run captured. It is not an independence claim.", "source-note"));
  section.append(review);
  const approval = projection.governance.approval;
  const approvalBlock = element("div", null, "subsection");
  approvalBlock.append(element("h3", "Approval"));
  approvalBlock.append(badge(approval.state === "granted" ? "GRANTED" : "MISSING",
    approval.state === "granted" ? "success" : "neutral"));
  // The recorded state is never contradicted: the window closure is stated
  // beside it as a derivation from the two recorded timestamps.
  approvalBlock.append(element("p", projection.governance.approvalWindow.statement, "source-note"));
  approvalBlock.append(definitionList([
    ["Approval ID", approval.id === null ? "Not recorded" : String(approval.id)],
    ["Feature", text(approval.featureId, "Not recorded")],
    ["Signer", text(approval.signer, "Not recorded")],
    ["Risk", text(approval.risk, "Not recorded")],
    ["Specification hash", identityNode(identityPresentation(approval.specHash), "specification hash", application)],
    ["Starting commit", identityNode(identityPresentation(approval.startingCommit), "starting commit", application)],
    ["Profile hash", identityNode(identityPresentation(approval.profileHash), "profile hash", application)],
    ["Created", recordedTime(approval.createdAt)],
    ["Expires", recordedTime(approval.expiresAt)],
  ], "definitions compact"));
  const scopeBlock = element("div");
  scopeBlock.append(element("h4", "Approved scope"));
  if (approval.scope === null || approval.scope.length === 0) {
    scopeBlock.append(element("p", "No approved scope is recorded.", "empty-state"));
  } else {
    const list = element("ul", null, "value-list");
    for (const entry of approval.scope) list.append(element("li", entry));
    scopeBlock.append(list);
  }
  approvalBlock.append(scopeBlock);
  approvalBlock.append(element("p", "Signatures are never displayed or served.", "source-note"));
  section.append(approvalBlock);
  const proposals = element("div", null, "subsection");
  if (projection.governance.proposals.length === 0) {
    proposals.append(element("p", "Proposals: none recorded for this run.", "empty-state"));
  } else {
    proposals.append(element("h3", `Proposals (${projection.governance.proposals.length})`));
    const list = element("ul", null, "proposal-list");
    for (const proposal of projection.governance.proposals) {
      const item = element("li", null, "proposal");
      item.append(element("h4", `Proposal ${proposal.id}: ${proposal.title}`));
      item.append(definitionList([
        ["Identity", identityNode(identityPresentation(proposal.identity), "proposal identity", application)],
        ["Stage", String(proposal.stageId)],
        ["Route", proposal.route],
        ["Problem", proposal.problem],
        ["Why upstream", proposal.whyUpstream],
        ["Evidence reference", proposal.evidenceRef],
        ["Created", recordedTime(proposal.createdAt)],
        ["Source findings", proposal.sourceFindingIds.map((id) => String(id)).join(", ") || "None recorded"],
      ], "definitions compact"));
      list.append(item);
    }
    proposals.append(list);
  }
  section.append(proposals);
  return section;
}

/** @param {string} label @param {string[]} paths */
function pathBlock(label, paths) {
  const block = element("div");
  block.append(element("h4", `${label} (${paths.length})`));
  if (paths.length === 0) {
    block.append(element("p", "None recorded.", "empty-state"));
    return block;
  }
  const list = element("ul", null, "value-list");
  for (const path of paths) list.append(element("li", path));
  block.append(disclosure(`Show ${paths.length} ${label.toLowerCase()}`, list));
  return block;
}

/** @param {ReturnType<typeof snapshotProjection>} projection @param {DashboardApplication} application */
function renderDelivery(projection, application) {
  const section = panel("Delivery", "delivery");
  const delivery = projection.delivery;
  section.append(definitionList([
    ["Delivery stage", delivery.stageId === null ? "Not recorded" : String(delivery.stageId)],
    ["Recorded outcome", text(delivery.outcome, "Not recorded")],
    ["Branch", text(delivery.branch, "Not recorded")],
    ["Worktree", text(delivery.worktreePath, "Not recorded")],
    ["Patch base", identityNode(identityPresentation(delivery.patchBase), "patch base", application)],
    ["Initial verified commit", identityNode(identityPresentation(delivery.initialVerifiedCommit), "initial verified commit", application)],
    ["Final reviewed commit", identityNode(identityPresentation(delivery.finalReviewedCommit), "final reviewed commit", application)],
    ["Delivered commit", identityNode(identityPresentation(delivery.deliveredCommit), "delivered commit", application)],
    ["Result reference", text(delivery.resultRef, "Not recorded")],
    ["Report reference", text(delivery.reportRef, "Not recorded")],
  ]));
  const paths = element("div", null, "subsection");
  paths.append(element("h3", "Recorded paths"));
  paths.append(pathBlock("Changed paths", delivery.changedPaths));
  paths.append(pathBlock("Declared paths", delivery.declaredPaths));
  paths.append(pathBlock("Delivered paths", delivery.deliveredPaths));
  paths.append(pathBlock("Missing paths", delivery.missingPaths));
  section.append(paths);
  const verification = element("div", null, "subsection");
  verification.append(element("h3", `Verification observations (${delivery.verification.length})`));
  if (delivery.verification.length === 0) {
    verification.append(element("p", "No verification observation is recorded for this run.", "empty-state"));
  } else {
    for (const observation of delivery.verification) {
      const card = element("article", null, "verification");
      card.append(element("h4", `Stage ${observation.stageId}`));
      card.append(definitionList([
        ["Round", observation.round === null ? "Not recorded" : String(observation.round)],
        ["Commit", identityNode(identityPresentation(observation.commit), "verified commit", application)],
        ["Outcome", text(observation.outcome, "Not recorded")],
        ["Blocking command", text(observation.blockingCommand, "None recorded")],
        ["Result reference", observation.resultRef],
      ], "definitions compact"));
      card.append(dataTable(`Recorded commands for stage ${observation.stageId}`,
        ["Name", "Argument vector", "Exit code", "Timed out", "Spawn error", "Kill error",
          "Output overflow", "Duration (ms)", "Blocked because", "Evidence"],
        observation.commands.map((command) => [
          command.name, command.argv.join(" "),
          command.exitCode === null ? "Unavailable" : String(command.exitCode),
          command.timedOut ? "Yes" : "No",
          text(command.spawnError, "None"),
          text(command.killError, "None"),
          command.outputOverflow ? "Yes" : "No",
          String(command.durationMs),
          text(command.blockedBecause, "Not blocking"),
          command.evidenceRef,
        ])));
      verification.append(card);
    }
  }
  verification.append(element("p", "A passing verification observation records exit codes for the frozen commands. It is evidence, not a claim that the delivered product is correct.", "source-note"));
  section.append(verification);
  return section;
}

/** @param {ReturnType<typeof snapshotProjection>} projection */
function renderEvidence(projection) {
  const section = panel("Evidence", "evidence");
  section.append(element("p", "Recorded references and their observed availability. The dashboard never links to, serves, or renders evidence contents.", "source-note"));
  if (projection.evidence.length === 0) {
    section.append(element("p", "This run recorded no evidence reference.", "empty-state"));
    return section;
  }
  section.append(dataTable("Every recorded evidence reference with its observed availability",
    ["Kind", "Stage", "Agent run", "Audit", "Reference", "Availability", "Reason"],
    projection.evidence.map((entry) => [
      entry.kind,
      entry.stageId === null ? "None" : String(entry.stageId),
      entry.agentRunId === null ? "None" : String(entry.agentRunId),
      entry.auditId === null ? "None" : String(entry.auditId),
      entry.ref, entry.availability, text(entry.reason, "No recorded reason"),
    ])));
  return section;
}

/* ------------------------------------------------------------------ *
 * Application state and refresh orchestration
 * ------------------------------------------------------------------ */

/** @typedef {{
 * token: string,
 * inventory: RepositoryInventory | null,
 * repositories: Map<string, RepositoryState>,
 * selectedRepositoryId: string | null,
 * selectedRunId: number | null,
 * limit: number,
 * repositoryFilter: string,
 * statusFilter: string,
 * phaseFilter: string,
 * search: string,
 * sessionExpired: boolean,
 * refreshGeneration: number,
 * inFlight: Set<string>,
 * platform: string,
 * main: HTMLElement,
 * live: HTMLElement
 * }} DashboardApplication */

/** @param {DashboardApplication} application */
function render(application) {
  const title = document.querySelector("h1");
  if (title !== null) title.textContent = "Governed Delivery Dashboard";
  if (application.sessionExpired) {
    application.main.setAttribute("aria-busy", "false");
    showSessionExpired(application.main, "The server rejected this tab's bearer token.");
    return;
  }
  application.main.replaceChildren();
  renderKpiBar(application.main, portfolioProjection(repositoryViews(application)));

  const portfolio = panel("Repository portfolio", "runs");
  portfolio.append(element("p", "Every configured repository stays visible. One repository's refusal never suppresses another.", "source-note"));
  for (const repositoryState of application.repositories.values()) {
    if (application.repositoryFilter !== "" &&
        repositoryState.repository.id !== application.repositoryFilter) continue;
    renderRepository(portfolio, repositoryState, application);
  }
  application.main.append(portfolio);

  const repositoryId = application.selectedRepositoryId;
  const runId = application.selectedRunId;
  if (repositoryId === null || runId === null) {
    application.main.setAttribute("aria-busy", "false");
    return;
  }
  const selected = application.repositories.get(repositoryId);
  if (selected === undefined) {
    application.main.append(callout("The selected repository is not configured.", "danger"));
    application.main.setAttribute("aria-busy", "false");
    return;
  }
  const slot = selected.snapshots.get(runId);
  const status = slot === undefined ? "" : resourceStatus(slot.resource);
  if (slot !== undefined && status !== "") {
    application.main.append(callout(status, slot.resource.stale ? "warning" : "danger"));
  }
  const snapshot = slot === undefined ? null : slotSnapshot(slot);
  if (snapshot === null) {
    if (slot?.loading === true) application.main.append(element("p", `Loading run ${runId}.`, "empty-state"));
    else if (status === "") application.main.append(element("p", `No snapshot has been observed for run ${runId}.`, "empty-state"));
    application.main.setAttribute("aria-busy", "false");
    return;
  }
  const projection = snapshotProjection(snapshot, application.inventory?.cliPath ?? "", application.platform,
    slot?.resource.envelope?.observedAt ?? null);
  if (title !== null) title.textContent = projection.systemName;
  const summary = runExecutiveSummary(snapshot, {
    repositoryPath: selected.repository.path,
    runs: runSummaries(selected.runs),
    observedAt: slot?.resource.envelope?.observedAt ?? null,
  });
  const staleNote = slot !== undefined && slot.resource.stale && slot.resource.envelope !== null
    ? `Stale snapshot from ${slot.resource.envelope.observedAt}`
    : "";
  const delivery = projection.delivery;
  // Each collapsed line states how much it hides: cost groups for the cost
  // section, recorded proposals for the configuration section, and every
  // recorded delivery artifact path for the delivery section.
  const costGroups = projection.charts.stages.length + projection.charts.agents.length;
  const deliveryPaths = delivery.changedPaths.length + delivery.declaredPaths.length
    + delivery.deliveredPaths.length + delivery.missingPaths.length;
  application.main.append(
    renderExecutiveSummary(summary, projection, application),
    renderFindings(projection, application),
    collapsibleSection(projection.governance.commands.length, staleNote,
      () => renderGovernance(projection, application, summary.repository, runId)),
    collapsibleSection(costGroups, staleNote, () => renderCostAndTokens(projection)),
    collapsibleSection(projection.stageViews.length, staleNote, () => renderTimeline(projection)),
    collapsibleSection(projection.activityItems.length, staleNote, () => renderActivity(projection)),
    collapsibleSection(projection.agents.length, staleNote, () => renderAgentTable(projection)),
    collapsibleSection(projection.governance.proposals.length, staleNote,
      () => renderConfiguration(projection, application)),
    collapsibleSection(deliveryPaths, staleNote, () => renderDelivery(projection, application)),
    collapsibleSection(projection.evidence.length, staleNote, () => renderEvidence(projection)),
  );
  application.main.setAttribute("aria-busy", "false");
}

/**
 * @param {DashboardApplication} application @param {RepositoryState} repository
 * @param {number} generation @param {number} requestedLimit
 */
async function refreshRuns(application, repository, generation, requestedLimit) {
  const requestId = ++repository.runsRequestId;
  const response = await fetchEnvelope(
    `/api/repositories/${encodeURIComponent(repository.repository.id)}/runs?limit=${requestedLimit}`,
    application.token,
  );
  if (!isCurrentRefresh(requestId, repository.runsRequestId, requestedLimit, application.limit)) return;
  if (generation !== application.refreshGeneration) return;
  const updated = applyRefresh(repository.runs, response);
  repository.runs = updated.resource;
  application.sessionExpired ||= updated.sessionExpired;
}

/**
 * Request one existing status route for one run of one repository. A newer
 * request for the same slot, a replaced slot, or a newer refresh generation
 * makes this response a no-op, and it can never write into another run's slot.
 * @param {DashboardApplication} application @param {RepositoryState} repository
 * @param {number} runId @param {number | null} generation
 */
async function refreshSlot(application, repository, runId, generation) {
  const slot = ensureSlot(repository, runId);
  const requestId = ++slot.requestId;
  const key = `${repository.repository.id}:${runId}`;
  slot.loading = true;
  if (generation !== null) application.inFlight.add(key);
  try {
    const response = await fetchEnvelope(
      `/api/repositories/${encodeURIComponent(repository.repository.id)}/runs/${runId}`,
      application.token,
    );
    if (repository.snapshots.get(runId) !== slot || requestId !== slot.requestId) return;
    if (generation !== null && generation !== application.refreshGeneration) return;
    slot.loading = false;
    const updated = applyRefresh(slot.resource, response, runId);
    slot.resource = updated.resource;
    application.sessionExpired ||= updated.sessionExpired;
  } finally {
    if (generation !== null) application.inFlight.delete(key);
  }
}

/** @param {DashboardApplication} application */
async function refreshSelected(application) {
  const repositoryId = application.selectedRepositoryId;
  const runId = application.selectedRunId;
  if (repositoryId === null || runId === null) {
    render(application);
    return;
  }
  const repository = application.repositories.get(repositoryId);
  if (repository === undefined) {
    render(application);
    return;
  }
  if (application.inFlight.has(`${repositoryId}:${runId}`)) return;
  await refreshSlot(application, repository, runId, null);
  if (application.selectedRepositoryId === repositoryId && application.selectedRunId === runId) render(application);
}

/**
 * One explicit refresh reloads every run list and then every in-window
 * snapshot through the existing status route. No timer, poll, socket, mutation
 * method, or server-side cache is involved.
 * @param {DashboardApplication} application
 */
async function refreshAll(application) {
  const generation = ++application.refreshGeneration;
  const requestedLimit = application.limit;
  application.main.setAttribute("aria-busy", "true");
  await Promise.all([...application.repositories.values()]
    .map((repository) => refreshRuns(application, repository, generation, requestedLimit)));
  if (generation !== application.refreshGeneration || requestedLimit !== application.limit) return;
  if (application.sessionExpired) {
    render(application);
    return;
  }
  for (const repository of application.repositories.values()) {
    const ids = runSummaries(repository.runs).map((run) => run.id);
    const keep = new Set(ids);
    if (application.selectedRepositoryId === repository.repository.id && application.selectedRunId !== null) {
      keep.add(application.selectedRunId);
    }
    for (const cached of [...repository.snapshots.keys()]) {
      if (!keep.has(cached)) repository.snapshots.delete(cached);
    }
    for (const runId of ids) ensureSlot(repository, runId).loading = true;
  }
  render(application);
  /** @type {Promise<void>[]} */
  const pending = [];
  for (const repository of application.repositories.values()) {
    for (const runId of runSummaries(repository.runs).map((run) => run.id)) {
      pending.push(refreshSlot(application, repository, runId, generation));
    }
  }
  await Promise.all(pending);
  if (generation !== application.refreshGeneration) return;
  render(application);
  const repositoryId = application.selectedRepositoryId;
  const runId = application.selectedRunId;
  if (repositoryId === null || runId === null) return;
  const selected = application.repositories.get(repositoryId);
  const covered = selected !== undefined && runSummaries(selected.runs).some((run) => run.id === runId);
  if (!covered) await refreshSelected(application);
}

/** @param {DashboardApplication} application @param {string} repositoryId @param {number} runId */
function selectRun(application, repositoryId, runId) {
  application.selectedRepositoryId = repositoryId;
  application.selectedRunId = runId;
  history.replaceState(null, "", routeHash(repositoryId, runId));
  render(application);
  void refreshSelected(application);
}

async function startBrowserApplication() {
  const main = document.querySelector("main");
  const live = document.querySelector("#live-status");
  if (!(main instanceof HTMLElement) || !(live instanceof HTMLElement)) return;
  const fragmentToken = bootstrapToken(window.location.hash);
  if (fragmentToken !== null) {
    sessionStorage.setItem(TOKEN_KEY, fragmentToken);
    history.replaceState(null, "",
      `${window.location.pathname}${window.location.search}${routeWithoutToken(window.location.hash)}`);
  }
  const token = fragmentToken ?? sessionStorage.getItem(TOKEN_KEY);
  if (token === null) {
    showSessionExpired(main, "This tab has no dashboard token.");
    return;
  }
  let inventoryResponse;
  try {
    inventoryResponse = await fetch(new URL("/api/repositories", window.location.origin), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    showSessionExpired(main, error instanceof Error ? error.message : String(error));
    return;
  }
  if (inventoryResponse.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    showSessionExpired(main, "The dashboard token expired when the terminal process ended.");
    return;
  }
  if (!inventoryResponse.ok) {
    const failure = /** @type {{ reason?: string }} */ (await inventoryResponse.json());
    showSessionExpired(main, failure.reason ?? "The repository inventory could not be loaded.");
    return;
  }
  const inventory = /** @type {RepositoryInventory} */ (await inventoryResponse.json());
  const route = parseRoute(window.location.hash);
  /** @type {DashboardApplication} */
  const application = {
    token,
    inventory,
    repositories: new Map(inventory.repositories.map((repository) => [repository.id, {
      repository,
      runs: emptyResourceState(),
      runsRequestId: 0,
      snapshots: new Map(),
    }])),
    selectedRepositoryId: route.repositoryId,
    selectedRunId: route.runId,
    limit: 20,
    repositoryFilter: "",
    statusFilter: "",
    phaseFilter: "",
    search: "",
    sessionExpired: false,
    refreshGeneration: 0,
    inFlight: new Set(),
    platform: navigator.userAgent.includes("Windows") ? "win32" : "posix",
    main,
    live,
  };
  const repositoryFilter = document.querySelector("#repository-filter");
  const limit = document.querySelector("#run-limit");
  const status = document.querySelector("#status-filter");
  const phase = document.querySelector("#phase-filter");
  const search = document.querySelector("#run-search");
  const refresh = document.querySelector("#refresh");
  const theme = document.querySelector("#theme");
  const shortcuts = document.querySelector("#shortcuts-enabled");
  if (repositoryFilter instanceof HTMLSelectElement) {
    for (const repository of inventory.repositories) {
      const option = document.createElement("option");
      option.value = repository.id;
      option.textContent = repository.path;
      repositoryFilter.append(option);
    }
    repositoryFilter.addEventListener("change", () => {
      application.repositoryFilter = repositoryFilter.value;
      render(application);
    });
  }
  if (limit instanceof HTMLInputElement) limit.addEventListener("change", () => {
    try {
      application.limit = validatedLimit(limit.value);
      void refreshAll(application);
    } catch (error) {
      live.textContent = error instanceof Error ? error.message : String(error);
      limit.value = String(application.limit);
    }
  });
  if (status instanceof HTMLSelectElement) status.addEventListener("change", () => {
    application.statusFilter = status.value;
    render(application);
  });
  if (phase instanceof HTMLSelectElement) phase.addEventListener("change", () => {
    application.phaseFilter = phase.value;
    render(application);
  });
  if (search instanceof HTMLInputElement) search.addEventListener("input", () => {
    application.search = search.value;
    render(application);
  });
  if (refresh instanceof HTMLButtonElement) refresh.addEventListener("click", () => void refreshAll(application));
  if (theme instanceof HTMLSelectElement) {
    const saved = sessionStorage.getItem(THEME_KEY) ?? "system";
    theme.value = saved;
    document.documentElement.dataset.theme = saved;
    theme.addEventListener("change", () => {
      sessionStorage.setItem(THEME_KEY, theme.value);
      document.documentElement.dataset.theme = theme.value;
    });
  }
  if (shortcuts instanceof HTMLInputElement) {
    shortcuts.checked = sessionStorage.getItem(SHORTCUTS_KEY) !== "disabled";
    shortcuts.addEventListener("change", () => {
      sessionStorage.setItem(SHORTCUTS_KEY, shortcuts.checked ? "enabled" : "disabled");
    });
  }
  let pendingG = false;
  document.addEventListener("keydown", (event) => {
    const disabled = shortcuts instanceof HTMLInputElement && !shortcuts.checked;
    const first = event.key === "/" ? "/" : pendingG ? "g" : event.key;
    const second = pendingG ? event.key.toLowerCase() : null;
    const destination = shortcutDestination(first, second, isEditableTarget(event.target), disabled);
    pendingG = !disabled && !isEditableTarget(event.target) && event.key.toLowerCase() === "g";
    if (destination === null) return;
    pendingG = false;
    event.preventDefault();
    document.getElementById(destination)?.focus();
  });
  window.addEventListener("hashchange", () => {
    const next = parseRoute(window.location.hash);
    application.selectedRepositoryId = next.repositoryId;
    application.selectedRunId = next.runId;
    render(application);
    if (next.repositoryId !== null && next.runId !== null && application.repositories.has(next.repositoryId)) {
      void refreshSelected(application);
    }
  });
  await refreshAll(application);
}

if (typeof document !== "undefined") void startBrowserApplication();
