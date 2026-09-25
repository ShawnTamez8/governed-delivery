/** @typedef {import("../operator-output.ts").OperatorResult} OperatorResult */
/** @typedef {import("../operator-state.ts").RunSnapshot} RunSnapshot */

import {
  AGENT_TOKEN_CLASS_NOTE, AUTO_REFRESH_INTERVAL_MS, FINDING_ORDER_STATEMENT, MALFORMED_LIST_REASON,
  MALFORMED_NORMATIVE_REASON,
  agentRows, autoRefreshPlan, cardSeverity, changedRuns, finalPanelBlockingSummary, findingCard, findingStatus,
  findingStatusCounts, findingStatuses, forbiddenFieldStatement, governanceChecks, identityPresentation,
  latestTimestamp, liveness, needsAttentionQueue, orderFindings, portfolioProjection, readableIntent,
  relativeTimePresentation, repositoryIdentity, runExecutiveSummary, runOutcome, searchIndex, searchMatches,
  severityOrder, snapshotProjection, snapshotState, stageLedger, stageMap, stageUsage, statusPresentation,
  telemetryCoverage, timestampPresentation, usdPresentation,
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

export const ALLOWED_TABS = ["overview", "runs", "findings", "governance", "models", "audit"];

/** @param {string} hash */
export function parseRoute(hash) {
  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const repositoryId = parameters.get("repository");
  const runText = parameters.get("run");
  const runId = runText !== null && /^\d+$/.test(runText) && Number.isSafeInteger(Number(runText))
    ? Number(runText) : null;
  const tabParam = parameters.get("tab");
  const tab = tabParam !== null && ALLOWED_TABS.includes(tabParam) ? tabParam : "overview";
  return {
    repositoryId: repositoryId !== null && /^[A-Za-z0-9_-]+$/.test(repositoryId) ? repositoryId : null,
    runId,
    tab,
  };
}

/** @param {string | null} repositoryId @param {number | null} [runId] @param {string} [tab] */
export function routeHash(repositoryId, runId = null, tab = "overview") {
  const parameters = new URLSearchParams();
  if (tab !== "overview" && ALLOWED_TABS.includes(tab)) parameters.set("tab", tab);
  if (repositoryId !== null) parameters.set("repository", repositoryId);
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
  if (firstKey === "?") return "shortcuts";
  if (firstKey !== "g") return null;
  if (secondKey === "o") return "overview";
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
 * When a repository is selected (via selectedRepositoryId or repositoryFilter),
 * only that repository is included in the portfolio view.
 * @param {{
 *   repositories: Map<string, RepositoryState>,
 *   selectedRepositoryId?: string | null,
 *   repositoryFilter?: string,
 * }} application
 */
export function repositoryViews(application) {
  const filterRepoId = application.selectedRepositoryId || application.repositoryFilter || "";
  const states = filterRepoId !== ""
    ? [...application.repositories.values()].filter((r) => r.repository.id === filterRepoId)
    : [...application.repositories.values()];

  return states.map((repositoryState) => {
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
  stale: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
  check: "M4 13l5 5L20 6",
  x: "M5 5l14 14M19 5L5 19",
  arrow: "M5 12h12M12 5l7 7-7 7",
  dot: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  copy: "M9 9h10v10H9zM5 15V5h10",
};

/** Decorative icon: adjacent visible text always carries the meaning. @param {string} name @param {string} [extra] */
function icon(name, extra = "") {
  const node = svg("svg", {
    class: `icon${extra}`, viewBox: "0 0 24 24", width: "20", height: "20",
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
  if (magnitude >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
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

/** @param {number} count @param {string} one @param {string} [many] */
function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** A readable stage name in lower case, for use inside a sentence. @param {string} kind */
function stageLower(kind) {
  return readableIntent(kind).toLowerCase();
}

/** The last two segments of a recorded path; the full path stays on hover. @param {string} path */
function pathTail(path) {
  const separator = path.includes("\\") ? "\\" : "/";
  return path.split(/[/\\]+/).filter((segment) => segment !== "").slice(-2).join(separator);
}

/** A recorded duration in the largest two units. @param {number | null} ms */
function duration(ms) {
  if (ms === null) return "Unavailable";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

/** A share of a known total; a share below one percent is never rounded to zero. @param {number | null} share */
function shareText(share) {
  if (share === null) return "Unavailable";
  return share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;
}

/** @param {...(Node | string)} parts */
function fragment(...parts) {
  const node = document.createDocumentFragment();
  node.append(...parts);
  return node;
}

/** A count that takes its alarm tone only when it is above zero. @param {number} count @param {string} tone @param {string} label */
function toned(count, tone, label) {
  return element("span", label, count > 0 ? `tone-${tone}` : "");
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
  const table = element("table", null, "table");
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

/** @typedef {"ascending" | "descending"} SortDirection */
/**
 * @template T
 * @typedef {{
 *   label: string,
 *   cell: (row: T) => Node | string,
 *   sort?: (row: T) => number | string,
 *   numeric?: boolean,
 *   className?: string,
 *   headClass?: string,
 *   title?: (row: T) => string,
 * }} TableColumn
 */

/**
 * One table with optional sortable headings. The sort is presentation only: it
 * reorders loaded rows and never reaches the route or a request.
 * @template T
 * @param {{
 *   caption: string, key: string, rows: readonly T[], columns: TableColumn<T>[],
 *   application: DashboardApplication, defaultSort?: { column: string, direction: SortDirection },
 *   rowSetup?: (tr: HTMLElement, row: T) => void,
 * }} spec
 */
function sortableTable(spec) {
  const scroll = element("div", null, "table-scroll");
  const table = element("table", null, "table");
  table.append(element("caption", spec.caption, "visually-hidden"));
  const state = spec.application.sorts.get(spec.key) ?? spec.defaultSort ?? null;
  const headRow = element("tr");
  for (const column of spec.columns) {
    const heading = element("th", null, column.numeric === true ? "num" : column.headClass ?? "");
    heading.setAttribute("scope", "col");
    const sort = column.sort;
    if (sort === undefined) {
      heading.textContent = column.label;
    } else {
      if (state?.column === column.label) heading.setAttribute("aria-sort", state.direction);
      const button = /** @type {HTMLButtonElement} */ (element("button", column.label, "sort"));
      button.type = "button";
      button.dataset.control = `sort:${spec.key}:${column.label}`;
      button.addEventListener("click", () => {
        const direction = state?.column === column.label && state.direction === "descending" ? "ascending" : "descending";
        spec.application.sorts.set(spec.key, { column: column.label, direction });
        render(spec.application);
      });
      heading.append(button);
    }
    headRow.append(heading);
  }
  const head = element("thead");
  head.append(headRow);
  const sortBy = state === null ? undefined : spec.columns.find((column) => column.label === state.column)?.sort;
  const rows = [...spec.rows];
  if (sortBy !== undefined && state !== null) {
    const sign = state.direction === "ascending" ? 1 : -1;
    rows.sort((left, right) => {
      const a = sortBy(left);
      const b = sortBy(right);
      const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      return sign * order;
    });
  }
  const body = element("tbody");
  for (const row of rows) {
    const tr = element("tr");
    for (const column of spec.columns) {
      const cell = element("td", null, `${column.numeric === true ? "num " : ""}${column.className ?? ""}`.trim());
      cell.append(column.cell(row));
      if (column.title !== undefined) cell.title = column.title(row);
      tr.append(cell);
    }
    spec.rowSetup?.(tr, row);
    body.append(tr);
  }
  table.append(head, body);
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

let headingSequence = 0;

/**
 * A region heading row: title, then an optional count, information control,
 * trailing controls, and a subtitle.
 * @param {string} title
 * @param {{ count?: string | null, info?: HTMLElement | null, end?: Node | null, sub?: Node | string | null }} [parts]
 */
function regionHead(title, parts = {}) {
  const head = element("div", null, "region-head");
  const heading = element("h3", title);
  heading.id = `heading-${++headingSequence}`;
  head.append(heading);
  if (parts.count !== undefined && parts.count !== null) head.append(element("span", parts.count, "count num"));
  if (parts.info !== undefined && parts.info !== null) head.append(parts.info);
  if (parts.end !== undefined && parts.end !== null) {
    const end = element("span", null, "end");
    end.append(parts.end);
    head.append(end);
  }
  if (parts.sub !== undefined && parts.sub !== null) {
    const sub = element("span", null, "sub");
    sub.append(parts.sub);
    head.append(sub);
  }
  return head;
}

/** @param {string} title @param {Parameters<typeof regionHead>[1]} [parts] */
function region(title, parts = {}) {
  const section = element("section", null, "region");
  const head = regionHead(title, parts);
  section.setAttribute("aria-labelledby", head.firstElementChild?.id ?? "");
  section.append(head);
  return section;
}

/** @param {string} title @param {Node} right */
function viewHead(title, right) {
  const head = element("div", null, "view-head");
  head.append(element("h2", title, "view-title"), right);
  return head;
}

/** @param {string} title */
function layer(title) {
  const section = element("section", null, "layer");
  const heading = element("h3", title, "layer-label");
  heading.id = `heading-${++headingSequence}`;
  section.setAttribute("aria-labelledby", heading.id);
  section.append(heading);
  return section;
}

/**
 * A filled badge states a state; an outline badge states a severity.
 * @param {string} label @param {string} tone @param {"state" | "severity"} [shape]
 */
function badge(label, tone, shape = "state") {
  return element("span", label, shape === "state" ? `badge is-state tone-${tone}` : `badge tone-${tone}`);
}

/** @param {string} message @param {string} [tone] */
function callout(message, tone = "warning") {
  const node = element("p", null, `callout tone-${tone}`);
  node.append(icon(tone === "danger" ? "x" : "stale"));
  node.append(element("span", message));
  return node;
}

/** @param {string} summaryText @param {HTMLElement} content */
function disclosure(summaryText, content) {
  const details = element("details", null, "technical");
  details.append(element("summary", summaryText));
  content.classList.add("technical-body");
  details.append(content);
  return details;
}

/**
 * A method explanation behind the section's information control, so it stays
 * one activation away and in the accessibility tree without taking a line.
 * @param {string} title @param {string} explanation
 */
function sectionNote(title, explanation) {
  const note = element("div", null, "section-note");
  note.append(metricInfoButton(title, explanation), element("span", "About this section"));
  return note;
}

/**
 * A single-choice chip group. Choosing a chip records the filter and re-renders.
 * A chip whose count is zero is disabled unless it is the one selected.
 * @param {string} label @param {string} key
 * @param {{ value: string, label: string, count?: number }[]} options
 * @param {string} selected @param {(value: string) => void} choose
 */
function chipGroup(label, key, options, selected, choose) {
  const group = element("span", null, "chips");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  for (const option of options) {
    const chip = /** @type {HTMLButtonElement} */ (element("button", option.label, "chip"));
    chip.type = "button";
    chip.dataset.control = `${key}:${option.value}`;
    chip.setAttribute("aria-pressed", String(option.value === selected));
    if (option.count !== undefined) {
      chip.append(element("span", String(option.count), "num"));
      chip.disabled = option.count === 0 && option.value !== selected && option.value !== "";
    }
    chip.addEventListener("click", () => choose(option.value));
    group.append(chip);
  }
  return group;
}

/**
 * A whole run section behind one native disclosure. The built section keeps its
 * own id, tab stop, and heading — the heading simply moves into the summary
 * line — so deep links, the skip link, and keyboard shortcuts keep resolving.
 *
 * `build` runs immediately and its result is appended, so expanding performs no
 * read and needs no refresh. The open attribute is never set and collapse state
 * is never recorded: it is presentation only and must not reach the route.
 * @param {string} countLabel @param {string} staleNote @param {() => HTMLElement} build
 * @param {Node | string | null} [hint]
 */
function collapsibleSection(countLabel, staleNote, build, hint = null) {
  const section = build();
  const details = /** @type {HTMLDetailsElement} */ (element("details", null, "section"));
  const summary = element("summary");
  const heading = section.firstElementChild;
  if (heading instanceof HTMLHeadingElement) summary.append(heading);
  summary.append(element("span", countLabel, "section-count"));
  if (staleNote !== "") {
    const note = element("span", null, "section-stale");
    note.append(icon("stale"), element("span", staleNote));
    summary.append(note);
  }
  if (hint !== null) {
    const node = element("span", null, "section-hint");
    node.append(hint);
    summary.append(node);
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
 * It reads "Copied" until it loses focus.
 * @param {string} buttonLabel @param {string} value @param {string} subject
 * @param {DashboardApplication} application @param {string} [suffix]
 */
function copyControl(buttonLabel, value, subject, application, suffix = " It has not been executed.") {
  const copy = /** @type {HTMLButtonElement} */ (element("button", null, "copy-control"));
  copy.type = "button";
  const label = element("span", buttonLabel);
  copy.append(icon("copy", " is-small"), label);
  if (!buttonLabel.toLowerCase().includes(subject.toLowerCase())) {
    copy.append(element("span", ` (${subject})`, "visually-hidden"));
  }
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
      application.live.textContent = `${subject} copied.${suffix}`;
      copy.classList.add("is-copied");
      label.textContent = "Copied";
      copy.addEventListener("blur", () => {
        copy.classList.remove("is-copied");
        label.textContent = buttonLabel;
      }, { once: true });
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
 * Slide-over Drawer & Popover System
 * ------------------------------------------------------------------ */

/** @type {(() => void) | null} */
let currentDrawerCloser = null;

/**
 * Open the slide-over details drawer with focus trapping and accessibility.
 * @param {string} title
 * @param {string} category
 * @param {() => HTMLElement} contentBuilder
 * @param {DashboardApplication} application
 * @param {HTMLElement | null} [triggerElement]
 */
export function openDrawer(title, category, contentBuilder, application, triggerElement = null) {
  if (currentDrawerCloser !== null) currentDrawerCloser();

  const container = document.querySelector("#drawer");
  const panelEl = document.querySelector("#drawer-panel");
  const categoryEl = document.querySelector("#drawer-category");
  const titleEl = document.querySelector("#drawer-title");
  const bodyEl = document.querySelector("#drawer-body");
  const closeBtn = document.querySelector("#drawer-close");
  const backdrop = document.querySelector("#drawer-backdrop");

  if (!(container instanceof HTMLElement) || !(panelEl instanceof HTMLElement) ||
      !(bodyEl instanceof HTMLElement)) return;

  if (categoryEl instanceof HTMLElement) categoryEl.textContent = category;
  if (titleEl instanceof HTMLElement) titleEl.textContent = title;
  bodyEl.replaceChildren(contentBuilder());

  container.setAttribute("aria-hidden", "false");
  container.classList.add("open");
  document.body.classList.add("modal-open");

  const lastFocused = triggerElement ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const activePanel = panelEl;

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key === "Tab") {
      const focusables = Array.from(activePanel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        if (last instanceof HTMLElement) last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        if (first instanceof HTMLElement) first.focus();
      }
    }
  }

  function closeDrawer() {
    container?.setAttribute("aria-hidden", "true");
    container?.classList.remove("open");
    document.body.classList.remove("modal-open");
    bodyEl?.replaceChildren();
    document.removeEventListener("keydown", onKeydown);
    backdrop?.removeEventListener("click", closeDrawer);
    closeBtn?.removeEventListener("click", closeDrawer);
    currentDrawerCloser = null;
    if (lastFocused !== null) lastFocused.focus();
  }

  currentDrawerCloser = closeDrawer;
  document.addEventListener("keydown", onKeydown);
  backdrop?.addEventListener("click", closeDrawer, { once: true });
  closeBtn?.addEventListener("click", closeDrawer, { once: true });

  panelEl.focus();
}

export function closeDrawer() {
  if (currentDrawerCloser !== null) currentDrawerCloser();
}

/**
 * An accessible information control for a heading or metric. The popover holds
 * method text that would otherwise take a line of its own.
 * @param {string} title
 * @param {string} formula
 * @param {string} [explanation]
 */
export function metricInfoButton(title, formula, explanation = "") {
  const wrapper = element("span", null, "info-trigger-wrapper");
  const button = /** @type {HTMLButtonElement} */ (element("button", "i", "info-trigger"));
  button.type = "button";
  button.setAttribute("aria-label", `Information about ${title}`);
  button.setAttribute("aria-expanded", "false");

  const popover = element("span", null, "metric-popover");
  popover.setAttribute("role", "tooltip");
  popover.setAttribute("aria-hidden", "true");
  popover.append(element("h4", title), element("p", formula));
  if (explanation !== "") popover.append(element("p", explanation));

  function closePopover() {
    button.setAttribute("aria-expanded", "false");
    popover.setAttribute("aria-hidden", "true");
    popover.classList.remove("open");
    document.removeEventListener("click", onDocumentClick);
  }

  /** @param {Event} event */
  function onDocumentClick(event) {
    if (!wrapper.contains(/** @type {Node} */ (event.target))) {
      closePopover();
    }
  }

  /** @param {Event} event */
  function togglePopover(event) {
    event.stopPropagation();
    const isOpen = button.getAttribute("aria-expanded") === "true";
    if (isOpen) {
      closePopover();
    } else {
      button.setAttribute("aria-expanded", "true");
      popover.setAttribute("aria-hidden", "false");
      popover.classList.add("open");
      document.addEventListener("click", onDocumentClick);
    }
  }

  button.addEventListener("click", togglePopover);

  wrapper.append(button, popover);
  return wrapper;
}

/* ------------------------------------------------------------------ *
 * Recorded vocabulary shared by every view
 * ------------------------------------------------------------------ */

/** @typedef {import("./dashboard-model.js").FindingStatus} FindingStatus */

/** @type {Record<FindingStatus, { label: string, tone: string, rank: number, active: boolean }>} */
const FINDING_STATUS = {
  blocking: { label: "Blocking", tone: "danger", rank: 0, active: true },
  open: { label: "Open", tone: "warning", rank: 1, active: true },
  non_blocking: { label: "Non-blocking", tone: "neutral", rank: 2, active: true },
  earlier_round: { label: "Earlier round", tone: "neutral", rank: 3, active: false },
  rejected: { label: "Rejected", tone: "neutral", rank: 4, active: false },
  addressed: { label: "Addressed", tone: "success", rank: 5, active: false },
};

/** @type {Record<string, { name: string, description: string }>} */
const COMMAND_PRESENTATION = {
  status: { name: "Run status", description: "Inspect one run without changing state." },
  doctor: { name: "Readiness check", description: "Inspect local readiness without spending." },
  "verify-audit": { name: "Verify audit chain", description: "Recompute the whole audit chain for this repository." },
  workflow: { name: "Next workflow step", description: "The run's recorded next governed action." },
};

/** @type {Record<import("./dashboard-model.js").CheckResult, [string, string]>} */
const CHECK_RESULT = {
  passed: ["Passed", "success"],
  granted: ["Granted", "success"],
  blocked: ["Blocked", "danger"],
  in_progress: ["In progress", "active"],
  not_reached: ["Not reached", "neutral"],
  not_evaluated: ["Not evaluated", "neutral"],
  not_verified: ["Not verified in this view", "neutral"],
};

/** @type {Record<string, string>} */
const TOKEN_SERIES = { input: "series-2", output: "series-3", cacheRead: "series-4", cacheWrite: "series-8" };

/**
 * @typedef {{
 *   repositoryId: string, runId: number, runLabel: string, path: string,
 *   card: ReturnType<typeof findingCard>, status: FindingStatus, stageKind: string,
 *   severity: ReturnType<typeof cardSeverity>,
 * }} FindingRow
 */

/* ------------------------------------------------------------------ *
 * Finding drawer
 * ------------------------------------------------------------------ */

/**
 * Build finding detail drawer content. The recorded report subjects stay
 * verbatim, and the decision evidence keeps every audit field.
 * @param {FindingRow} row
 * @param {DashboardApplication} application
 * @returns {HTMLElement}
 */
export function buildFindingDetailDrawer(row, application) {
  const card = row.card;
  const container = element("div", null, "drawer-content");
  const chips = element("div", null, "drawer-chips");
  const status = FINDING_STATUS[row.status];
  chips.append(
    badge(status.label, status.tone),
    badge(row.severity.available ? row.severity.severity ?? "" : "Severity unranked",
      row.severity.available ? severityTone(row.severity.severity ?? "") : "neutral", "severity"),
    copyControl("Copy location", card.location, "finding location", application, ""),
  );
  container.append(chips);
  container.append(definitionList([
    ["Location", element("span", card.location, "mono")],
    ["Stage", `${readableIntent(row.stageKind)} · stage ${card.stageId} · round ${card.round}`],
    ["Intent key", element("span", card.intentKey, "mono")],
    ["Disposition", card.decision === null
      ? row.stageKind === "code_review" ? "None: code-review findings carry no disposition" : "None recorded"
      : card.decision.disposition],
    ["Final panel", card.finalPanelBlocking === true ? "Blocking"
      : card.finalPanelBlocking === false ? "Below threshold" : "Not a final-panel result"],
  ]));
  const reports = element("section");
  reports.append(element("h4", `Reports (${card.reports.length})`, "eyebrow"));
  for (const report of card.reports) {
    const tone = severityTone(report.severity);
    const item = element("article", null, `report tone-${tone}`);
    item.append(
      badge(report.severity, tone, "severity"),
      element("p", report.subject, "report-subject"),
      element("p", `${text(report.reviewerId, "Reviewer not recorded")} · agent run ${report.agentRunId} · ${report.classification}`, "report-meta"),
    );
    reports.append(item);
  }
  container.append(reports);
  container.append(disclosure("Recorded decision evidence", decisionEvidence(card, application)));
  return container;
}

/** @param {DashboardApplication} application @param {FindingRow} row @param {HTMLElement | null} trigger */
function openFindingDrawer(application, row, trigger) {
  openDrawer(`${row.card.title} #${row.card.id}`, `Finding · ${row.runLabel} · ${pathTail(row.path)}`,
    () => buildFindingDetailDrawer(row, application), application, trigger);
}

/**
 * Every finding of one snapshot as a row, with its status from `findingStatus`
 * and its severity ranked by `cardSeverity` against the run's frozen order.
 * @param {string} repositoryId @param {string} path @param {RunSnapshot} snapshot
 * @returns {FindingRow[]}
 */
function snapshotFindingRows(repositoryId, path, snapshot) {
  const severities = severityOrder(snapshot.configuration);
  const kinds = new Map(snapshot.stages.map((stage) => [stage.id, stage.kind]));
  return snapshot.evidence.findings.map((finding) => {
    const card = findingCard(finding);
    const stageKind = kinds.get(finding.stageId) ?? "";
    return {
      repositoryId, runId: snapshot.run.id, runLabel: `${snapshot.run.slug} #${snapshot.run.id}`, path,
      card, status: findingStatus(card, stageKind), stageKind, severity: cardSeverity(card, severities),
    };
  });
}

/** Status first, then the higher ranked severity, then the identifier. @param {FindingRow} left @param {FindingRow} right */
function compareFindingRows(left, right) {
  return FINDING_STATUS[left.status].rank - FINDING_STATUS[right.status].rank ||
    (right.severity.rank ?? -1) - (left.severity.rank ?? -1) || left.card.id - right.card.id;
}

/**
 * The drawer opener for a finding named by identifiers, as search and the
 * attention queue carry them.
 * @param {DashboardApplication} application @param {string} repositoryId @param {number} runId
 * @param {number} findingId @param {HTMLElement | null} trigger
 */
function openFindingById(application, repositoryId, runId, findingId, trigger) {
  const state = application.repositories.get(repositoryId);
  const slot = state?.snapshots.get(runId);
  const snapshot = slot === undefined ? null : slotSnapshot(slot);
  if (state === undefined || snapshot === null) return;
  const row = snapshotFindingRows(repositoryId, state.repository.path, snapshot).find((entry) => entry.card.id === findingId);
  if (row !== undefined) openFindingDrawer(application, row, trigger);
}

/* ------------------------------------------------------------------ *
 * Scope: the repository selection every view honours
 * ------------------------------------------------------------------ */

/**
 * The header selection scopes every view. A selected run does not narrow the
 * scope: opening a run from another repository returns the scope to all
 * repositories instead, so only the header's own value is passed.
 * @param {DashboardApplication} application
 */
function scopeViews(application) {
  return repositoryViews({ repositories: application.repositories, repositoryFilter: application.repositoryFilter });
}

/** @typedef {{ repositoryId: string, path: string, run: RunSummary, snapshot: RunSnapshot | null, stale: boolean, loading: boolean }} ScopeEntry */

/**
 * The loaded runs in scope with the snapshot each carries, newest activity first.
 * @param {ReturnType<typeof repositoryViews>} views
 * @returns {ScopeEntry[]}
 */
function scopeEntries(views) {
  const entries = views.flatMap((view) => view.runs.map((run) => {
    const slot = view.snapshots.find((entry) => entry.runId === run.id);
    return {
      repositoryId: view.repositoryId, path: view.path, run,
      snapshot: slot?.snapshot ?? null, stale: slot?.stale ?? false, loading: slot?.loading ?? false,
    };
  }));
  return entries.sort((left, right) =>
    Date.parse(right.run.lastRecordedAt) - Date.parse(left.run.lastRecordedAt) ||
    left.repositoryId.localeCompare(right.repositoryId) || right.run.id - left.run.id);
}

/** The latest run-list observation across every configured repository. @param {DashboardApplication} application */
function observationTime(application) {
  /** @type {string | null} */
  let latest = null;
  for (const state of application.repositories.values()) {
    const at = state.runs.envelope?.observedAt ?? null;
    if (at !== null && (latest === null || Date.parse(at) > Date.parse(latest))) latest = at;
  }
  return latest;
}

/** @param {DashboardApplication} application @param {string} repositoryId @param {number} runId */
function snapshotObservedAt(application, repositoryId, runId) {
  return application.repositories.get(repositoryId)?.snapshots.get(runId)?.resource.envelope?.observedAt ?? null;
}

/** @param {DashboardApplication} application */
function scopeData(application) {
  const views = scopeViews(application);
  const entries = scopeEntries(views);
  const snapshots = entries.flatMap((entry) => entry.snapshot === null ? [] : [entry.snapshot]);
  return {
    views, entries, snapshots,
    portfolio: portfolioProjection(views),
    counts: findingStatusCounts(snapshots),
    observedAt: observationTime(application),
  };
}

/** @typedef {ReturnType<typeof scopeData>} ScopeData */

/**
 * The view's scope, named by the recorded project and the path tail, never by
 * a repository identifier.
 * @param {DashboardApplication} application @param {ScopeData} data
 */
function scopeLabel(application, data) {
  const label = element("span", null, "scope-label");
  const count = element("strong", `${plural(data.entries.length, "run")} loaded`);
  const view = application.repositoryFilter === "" ? null : data.views[0] ?? null;
  if (view === null) {
    label.append(element("span", "All repositories · "), count,
      element("span", ` from ${plural(application.repositories.size, "repository", "repositories")}`));
  } else {
    const identity = repositoryIdentity(view.path, view.runs);
    const tail = element("span", pathTail(view.path), "mono");
    tail.title = view.path;
    label.append(element("span", `${identity.display} · `), tail, element("span", " · "), count);
  }
  return label;
}

/** Loaded values are unavailable, or still loading, until a snapshot contributes. @param {ScopeData} data @param {() => Node | string} value */
function snapshotValue(data, value) {
  if (data.snapshots.length > 0 || data.entries.length === 0) return value();
  return data.entries.some((entry) => entry.loading) ? "Loading" : "Unavailable";
}

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

/**
 * One status card: label, primary value with status, breakdown, optional
 * visualization, and a named click-through on one stretched button.
 * @param {{
 *   label: string, info?: HTMLElement, value: Node | string, textValue?: boolean,
 *   unit?: Node | string, status?: Node | null, breakdown?: Node | string, viz?: Node[],
 *   go?: string, onGo?: () => void,
 * }} spec
 */
function statusCard(spec) {
  const card = element("article", null, spec.onGo === undefined ? "card" : "card is-link");
  if (spec.onGo !== undefined && spec.go !== undefined) {
    const target = /** @type {HTMLButtonElement} */ (element("button", null, "card-target"));
    target.type = "button";
    target.setAttribute("aria-label", `${spec.label}: ${spec.go}`);
    target.dataset.control = `card:${spec.label}`;
    target.addEventListener("click", spec.onGo);
    card.append(target);
  }
  const label = element("div", null, "card-label");
  label.append(element("span", spec.label, "eyebrow"));
  if (spec.info !== undefined) label.append(spec.info);
  const row = element("div", null, "card-row");
  const value = element("span", null, spec.textValue === true ? "card-value is-text" : "card-value");
  value.append(spec.value);
  row.append(value);
  if (spec.unit !== undefined) {
    const unit = element("span", null, "card-unit");
    unit.append(spec.unit);
    row.append(unit);
  }
  if (spec.status !== undefined && spec.status !== null) row.append(spec.status);
  card.append(label, row);
  if (spec.breakdown !== undefined) {
    const breakdown = element("div", null, "card-breakdown");
    breakdown.append(spec.breakdown);
    card.append(breakdown);
  }
  for (const node of spec.viz ?? []) card.append(node);
  if (spec.go !== undefined) card.append(element("span", spec.go, "card-go"));
  return card;
}

/** Tokens consumed and the cost they generated: two cards in one frame, tokens first. @param {HTMLElement} tokens @param {HTMLElement} cost */
function usagePair(tokens, cost) {
  const pair = element("div", null, "card-pair");
  pair.setAttribute("role", "group");
  pair.setAttribute("aria-label", "Usage: tokens and known cost");
  pair.append(tokens, cost);
  return pair;
}

function costInfo() {
  return metricInfoButton("Known cost", "The sum of costs reported on recorded agent rows in scope.",
    "Complete reporting means every tracked row reported a cost. It is not a claim that every possible cost is known: process loss and missing telemetry can hide spend.");
}

/** @param {number} reported @param {number} rows */
function reportingBadge(reported, rows) {
  if (rows === 0) return null;
  return reported === rows ? badge("Reporting complete", "success") : badge("Partial", "warning");
}

/**
 * A proportion bar drawn with SVG attributes, because the policy forbids inline style.
 * @param {[string, number][]} parts @param {string} label
 */
function splitBar(parts, label) {
  const total = parts.reduce((sum, [, count]) => sum + count, 0) || 1;
  const bar = svg("svg", {
    class: "split-bar", viewBox: "0 0 100 6", preserveAspectRatio: "none", role: "img", "aria-label": label,
  });
  let x = 0;
  for (const [className, count] of parts) {
    if (count <= 0) continue;
    const width = (count / total) * 100;
    bar.append(svg("rect", {
      class: className, x: x.toFixed(2), y: "0", width: Math.max(width - 0.8, 0.5).toFixed(2), height: "6",
    }));
    x += width;
  }
  return bar;
}

/** A text legend for a proportion bar; the bar's own label carries the counts. @param {[string, string][]} items */
function legend(items) {
  const node = element("div", null, "legend");
  node.setAttribute("aria-hidden", "true");
  for (const [tone, label] of items) {
    const item = element("span", null, `tone-${tone}`);
    item.append(element("span", null, "swatch"), element("span", label));
    node.append(item);
  }
  return node;
}

/** A muted share bar; the top entry is drawn slightly stronger. @param {number} fraction @param {boolean} top */
function meterBar(fraction, top) {
  const bar = svg("svg", {
    class: `bar-svg is-muted${top ? " is-top" : ""}`, viewBox: "0 0 100 8", preserveAspectRatio: "none",
    "aria-hidden": "true", focusable: "false",
  });
  bar.append(svg("rect", { x: "0", y: "0", width: (Math.max(0, fraction) * 100).toFixed(1), height: "8", rx: "1" }));
  return bar;
}

/** @param {import("./dashboard-model.js").TokenTotal} tokens @param {string} [label] @param {() => void} [onGo] */
function tokensCard(tokens, label = "Tokens", onGo = undefined) {
  const known = tokens.known;
  const pairs = element("dl", null, "card-list is-pairs");
  for (const entry of tokens.classes) {
    pairs.append(element("dt", entry.known === null ? "Unavailable" : abbreviated(entry.known)), element("dd", entry.label.toLowerCase()));
  }
  return statusCard({
    label,
    value: known === null ? "Unavailable" : fragment(abbreviated(known), element("span", " tokens", "visually-hidden")),
    breakdown: known === null ? "No contributing agent row reported a token class"
      : fragment(element("span", exactCount(known), "mono"), " exact"),
    viz: [pairs],
    ...(onGo === undefined ? {} : { go: "View token usage", onGo }),
  });
}

/**
 * @param {{ knownUsd: number | null, reportedRows: number, agentRows: number }} cost
 * @param {string} [label] @param {() => void} [onGo]
 */
function costCard(cost, label = "Known cost", onGo = undefined) {
  return statusCard({
    label, info: costInfo(), value: moneyNode(cost.knownUsd),
    status: reportingBadge(cost.reportedRows, cost.agentRows),
    breakdown: `Cost reported for ${cost.reportedRows} of ${cost.agentRows} tracked rows`,
    ...(onGo === undefined ? {} : { go: "View cost by stage", onGo }),
  });
}

/**
 * The Overview's four status cards. Each click-through carries the filter it names.
 * @param {ScopeData} data @param {DashboardApplication} application
 */
function renderStatusCards(data, application) {
  const { portfolio, counts } = data;
  const blocked = portfolio.blockedRuns;
  const active = portfolio.activeRuns;
  const completed = portfolio.completedRuns;
  const cards = element("div", null, "cards is-four");
  cards.append(statusCard({
    label: "Run health", value: String(blocked), unit: toned(blocked, "danger", "Blocked"),
    breakdown: fragment(`${completed} completed · ${active} in progress · `, element("strong", `${portfolio.runs} total`)),
    viz: [
      splitBar([["is-blocked", blocked], ["is-running", active], ["is-completed", completed]],
        `${blocked} blocked, ${active} in progress, ${completed} completed`),
      legend([["danger", "Blocked"], ["active", "In progress"], ["success", "Completed"]]),
    ],
    go: "View blocked runs",
    onGo: () => { application.runFilter = "blocked"; switchTab(application, "runs"); application.main.focus(); },
  }));
  const settled = counts.total - counts.requireAttention;
  const settledBreakdown = element("div", null, "card-breakdown");
  settledBreakdown.append(
    `${counts.addressed} addressed · ${counts.non_blocking} non-blocking · ${counts.earlier_round} earlier round · ${counts.rejected} rejected · `,
    element("strong", `${counts.total} total`));
  cards.append(statusCard({
    label: "Active findings",
    info: metricInfoButton("Finding states",
      "Require attention: blocking (a final code-review panel result at or above the frozen threshold, or a blocking recorded decision) and open (a document-review finding with no recorded decision).",
      "Non-blocking: a final-panel result below the threshold. Earlier round: code-review input the remediation loop consumed. Addressed and rejected: recorded decisions."),
    value: snapshotValue(data, () => String(counts.requireAttention)), unit: "require attention",
    breakdown: fragment(toned(counts.blocking, "danger", `${counts.blocking} blocking`), " · ",
      toned(counts.open, "warning", `${counts.open} open`)),
    viz: [
      splitBar([["is-attention", counts.blocking], ["is-open", counts.open], ["is-settled", settled]],
        `${counts.requireAttention} of ${counts.total} findings require attention`),
      settledBreakdown,
    ],
    go: "View findings",
    onGo: () => { application.findingStatusFilter = "attention"; switchTab(application, "findings"); application.main.focus(); },
  }));
  const toModels = () => { switchTab(application, "models"); application.main.focus(); };
  cards.append(usagePair(
    tokensCard(portfolio.tokens, "Tokens", toModels),
    costCard({ knownUsd: portfolio.cost.knownUsd, reportedRows: portfolio.cost.reportedRows, agentRows: portfolio.cost.agentRows },
      "Known cost", toModels)));
  return cards;
}

/* ------------------------------------------------------------------ *
 * Stage ledger and liveness
 * ------------------------------------------------------------------ */

/** @param {"passed" | "blocked" | "open" | "other"} result */
function segmentClass(result) {
  return `is-${result}`;
}

/**
 * Whether a loaded run may be drawn live: the model's four-part rule, and only
 * while auto-refresh keeps the observation fresh.
 * @param {DashboardApplication} application @param {string} repositoryId @param {RunSnapshot} snapshot
 */
function runLiveness(application, repositoryId, snapshot) {
  return liveness(snapshot, snapshotObservedAt(application, repositoryId, snapshot.run.id), Date.now(), AUTO_REFRESH_INTERVAL_MS);
}

/**
 * The run's recorded stages in recorded order, from `stageLedger`. At micro
 * size it is one segment per stage and a terminal cell; at full size each
 * stage carries its name, gate result, and duration.
 * @param {RunSnapshot} snapshot @param {boolean} full @param {boolean} live
 */
function stageLedgerNode(snapshot, full, live) {
  const ledger = stageLedger(snapshot);
  const segments = ledger.segments;
  const endClass = ledger.terminal === "completed" ? "is-completed" : ledger.terminal === "stopped" ? "is-stopped" : "is-progress";
  if (!full) {
    const endText = ledger.terminal === "completed" ? "run completed" : ledger.terminal === "stopped" ? "run stopped" : "run in progress";
    const node = element("span", null, "ledger");
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", `${plural(segments.length, "recorded stage")}: ${segments
      .map((segment) => `${stageLower(segment.kind)} ${segment.label.toLowerCase()}`).join(", ")}; ${endText}`);
    node.title = segments.map((segment) => `${readableIntent(segment.kind)}: ${segment.label}`).join("\n");
    for (const segment of segments) {
      node.append(element("span", null,
        `ledger-seg ${segmentClass(segment.result)}${live && segment.result === "open" ? " is-live" : ""}`));
    }
    node.append(element("span", null, `ledger-end ${endClass}`));
    return node;
  }
  const list = element("ol", null, "ledger-full");
  list.setAttribute("aria-label", "Recorded stages in recorded order");
  for (const segment of segments) {
    const step = element("li", null,
      `ledger-step ${segmentClass(segment.result)}${live && segment.result === "open" ? " is-live" : ""}`);
    step.append(element("span", null, "bar"), element("span", readableIntent(segment.kind), "name"),
      element("span", `gate ${segment.gateResult ?? "none"} · ${duration(segment.durationMs)}`, "meta"));
    list.append(step);
  }
  if (ledger.terminal !== "in_progress") {
    const step = element("li", null, `ledger-step ${endClass}`);
    const meta = element("span", null, "meta");
    if (ledger.terminal === "stopped") meta.textContent = "no later stage";
    else meta.append(shortTimeNode(snapshot.activity.lastRecordedAt));
    step.append(element("span", null, "bar"), element("span", ledger.terminal === "stopped" ? "Stopped" : "Completed", "name"), meta);
    list.append(step);
  }
  return list;
}

/**
 * The liveness tag. The lock names a process in this repository, not a run or
 * an agent. With auto-refresh off the observation ages, so LIVE is stated as
 * of the last observation and never pulses.
 * @param {ReturnType<typeof liveness>} state @param {boolean} autoRefresh
 */
function liveTag(state, autoRefresh) {
  if (state === "not_in_progress") return null;
  const live = state === "live" && autoRefresh;
  const tag = element("span", null, `live-tag ${live ? "is-live" : "is-static"}`);
  tag.title = "The repository writer lock names a process in this repository, not a run or an agent.";
  tag.append(element("span", null, "dot"), element("span", state === "live"
    ? autoRefresh ? "Live" : "Live at last observation"
    : state === "lock_unreadable" ? "Writer lock unreadable" : "No live writer"));
  return tag;
}

/** A recorded time as "N min ago" relative to the observation; the exact time is on hover. @param {string | null} value @param {string | null} observedAt */
function relativeNode(value, observedAt) {
  const presentation = relativeTimePresentation(value, observedAt);
  if (!presentation.available) return element("span", presentation.relative, "unavailable");
  const node = /** @type {HTMLTimeElement} */ (element("time", presentation.relative));
  node.dateTime = presentation.utc;
  node.title = presentation.exact;
  return node;
}

const SHORT_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

/** A recorded time as a short local date and time; the exact time is on hover. @param {string | null} value */
function shortTimeNode(value) {
  const presentation = relativeTimePresentation(value, null);
  if (!presentation.available) return element("span", "Unavailable", "unavailable");
  const node = /** @type {HTMLTimeElement} */ (element("time", SHORT_TIME.format(new Date(presentation.utc))));
  node.dateTime = presentation.utc;
  node.title = presentation.exact;
  return node;
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

/** @type {Record<string, string>} */
const MAP_CELL_LABEL = { passed: "passed", blocked: "blocked", open: "in progress", other: "recorded", not_reached: "not reached" };

/**
 * How far each loaded run got, from `stageMap`.
 * @param {ScopeData} data @param {DashboardApplication} application
 */
function renderStageMap(data, application) {
  const loaded = data.entries.filter((entry) => entry.snapshot !== null);
  const snapshots = loaded.map((entry) => /** @type {RunSnapshot} */ (entry.snapshot));
  const map = stageMap(snapshots);
  const section = region("Run progression", {
    info: metricInfoButton("Run progression",
      "Columns are the stage kinds the loaded runs recorded, in recorded stage order. Each run is one cell per column; an empty cell is a stage that run has not reached.",
      "A marker shows where a run stopped or completed. Only a stage with fresh live-writer telemetry animates."),
  });
  if (map.columns.length === 0) {
    section.append(element("p", loaded.length === 0 ? "No loaded run has a snapshot yet." : "No loaded run has recorded a stage.", "att-empty"));
    return section;
  }
  const live = loaded.map((entry) => application.autoRefresh && entry.snapshot !== null &&
    runLiveness(application, entry.repositoryId, entry.snapshot) === "live");
  const list = element("ol", null, "stage-map");
  list.setAttribute("aria-label", "Loaded runs by recorded stage");
  map.columns.forEach((column, index) => {
    const item = element("li", null, "map-stage");
    const name = element("span", readableIntent(column.kind), "name");
    name.title = readableIntent(column.kind);
    const track = element("span", null, "map-track");
    track.setAttribute("aria-hidden", "true");
    /** @type {string[]} */
    const spoken = [];
    map.rows.forEach((row, rowIndex) => {
      const entry = loaded[rowIndex];
      const cell = row.cells[index] ?? "not_reached";
      if (entry === undefined) return;
      const className = cell === "passed" ? "" : cell === "not_reached" ? " is-empty" : ` is-${cell}`;
      const node = element("span", null, `map-cell${className}${cell === "open" && live[rowIndex] === true ? " is-live" : ""}`);
      const label = `${entry.run.slug} #${entry.run.id} · ${pathTail(entry.path)}: ${MAP_CELL_LABEL[cell] ?? cell}`;
      node.title = label;
      spoken.push(label);
      track.append(node);
    });
    const marks = element("span", null, "map-marks");
    if (column.stopped > 0) marks.append(element("span", `${column.stopped} blocked here`, "map-mark tone-danger"));
    if (column.completed > 0) marks.append(element("span", `${column.completed} completed`, "map-mark tone-success"));
    item.append(name, track, element("span", `${column.reached}/${column.total} reached`, "reached"), marks,
      element("span", spoken.join("; "), "visually-hidden"));
    list.append(item);
  });
  section.append(list);
  return section;
}

const ATTENTION_CAP = 8;

/**
 * What needs the operator, from `needsAttentionQueue`: blocked runs, then
 * blocking and open findings. Findings carry no age because a finding row
 * records no time.
 * @param {ScopeData} data @param {DashboardApplication} application
 */
function renderAttentionQueue(data, application) {
  const queue = needsAttentionQueue(data.views);
  const blocking = queue.findings.filter((item) => item.status === "blocking").length;
  const open = queue.findings.length - blocking;
  const total = queue.runs.length + queue.findings.length;
  const title = total === 0 ? "Nothing requires attention" : `${plural(total, "item")} require${total === 1 ? "s" : ""} attention`;
  const filter = application.attentionFilter;
  const section = region(title, total === 0 ? {} : {
    info: metricInfoButton("Order", "Ordered by operational impact, severity, and recency: blocked runs by latest activity, then blocking findings, then open findings, each by recorded severity."),
    end: chipGroup("Show", "attention", [
      { value: "", label: "All", count: total },
      { value: "run", label: "Blocked runs", count: queue.runs.length },
      { value: "blocking", label: "Blocking findings", count: blocking },
      { value: "open", label: "Open findings", count: open },
    ], filter, (value) => { application.attentionFilter = value; render(application); }),
    sub: "Blocked runs are prioritized, followed by blocking and open findings.",
  });
  if (total === 0) {
    section.append(element("p", "No blocked runs and no blocking or open findings in this scope.", "att-empty"));
    return section;
  }
  const runs = filter === "" || filter === "run" ? queue.runs : [];
  const findings = filter === "run" ? [] : queue.findings.filter((item) => filter === "" || item.status === filter);
  const shownRuns = runs.slice(0, ATTENTION_CAP);
  const shownFindings = findings.slice(0, Math.max(0, ATTENTION_CAP - shownRuns.length));
  if (shownRuns.length > 0) {
    const head = element("div", "Blocked runs ", "group-head");
    head.append(element("span", String(runs.length), "num"));
    const list = element("ol");
    for (const item of shownRuns) {
      const entry = element("li", null, "att-item tone-danger");
      const badges = element("span", null, "att-badges");
      badges.append(badge("Blocked", "danger"));
      const main = element("span", null, "att-main");
      const target = /** @type {HTMLButtonElement} */ (element("button", null, "att-title"));
      target.type = "button";
      target.dataset.control = `attention-run:${item.repositoryId}:${item.runId}`;
      target.append(`${item.slug} `, element("span", `#${item.runId}`, "num"),
        ` · stopped at ${item.stageKind === null ? "an unrecorded stage" : stageLower(item.stageKind)}`);
      target.addEventListener("click", () => openRun(application, item.repositoryId, item.runId));
      const meta = element("span", null, "att-meta");
      const tail = element("span", pathTail(item.repositoryPath), "mono");
      tail.title = item.repositoryPath;
      meta.append(`${item.project} · `, tail, item.stageNumber === null ? "" : ` · stage ${item.stageNumber}`);
      main.append(target, meta);
      const facts = element("span", null, "att-facts");
      facts.append(item.blocking > 0 ? element("strong", plural(item.blocking, "blocking finding"), "tone-danger")
        : item.open > 0 ? element("strong", plural(item.open, "open finding"), "tone-warning")
          : element("span", "No blocking or open finding"),
      ` · ${usdPresentation(item.knownUsd).display} known cost`);
      const age = element("span", null, "att-age");
      age.append(relativeNode(item.lastRecordedAt, data.observedAt));
      const actions = element("span", null, "att-actions");
      const view = /** @type {HTMLButtonElement} */ (element("button", "View findings", "text-btn is-quiet"));
      view.type = "button";
      view.addEventListener("click", () => openRun(application, item.repositoryId, item.runId, true));
      actions.append(view);
      entry.append(badges, main, facts, age, actions);
      list.append(entry);
    }
    section.append(head, list);
  }
  if (shownFindings.length > 0) {
    const head = element("div", "Findings ", "group-head");
    head.append(element("span", String(findings.length), "num"));
    const list = element("ol");
    for (const item of shownFindings) {
      const status = item.status === "blocking" ? FINDING_STATUS.blocking : FINDING_STATUS.open;
      const entry = element("li", null, `att-item tone-${status.tone}`);
      const badges = element("span", null, "att-badges");
      badges.append(badge(status.label, status.tone),
        badge(item.severity ?? "Unranked", item.severity === null ? "neutral" : severityTone(item.severity), "severity"));
      const main = element("span", null, "att-main");
      const target = /** @type {HTMLButtonElement} */ (element("button", null, "att-title"));
      target.type = "button";
      target.dataset.control = `attention-finding:${item.repositoryId}:${item.runId}:${item.findingId}`;
      target.append(`${item.title} `, element("span", `#${item.findingId}`, "num"));
      target.addEventListener("click", () => openFindingById(application, item.repositoryId, item.runId, item.findingId, target));
      const meta = element("span", null, "att-meta");
      meta.append(`${item.slug} #${item.runId} · ${item.stageKind === null ? "Unrecorded stage" : readableIntent(item.stageKind)}, round ${item.round} · `,
        element("span", item.location, "mono"));
      main.append(target, meta);
      const facts = element("span", item.status === "blocking"
        ? `Final panel, round ${item.round}${item.maxRounds === null ? "" : ` of ${item.maxRounds}`}`
        : "No recorded decision", "att-facts");
      const actions = element("span", null, "att-actions");
      actions.append(copyControl("Copy location", item.location, "finding location", application, ""));
      entry.append(badges, main, facts, element("span", null, "att-age"), actions);
      list.append(entry);
    }
    section.append(head, list);
  }
  if (runs.length > shownRuns.length || findings.length > shownFindings.length) {
    const foot = element("div", null, "region-foot");
    foot.append(element("span", `Showing ${shownRuns.length + shownFindings.length} of ${runs.length + findings.length}`));
    if (runs.length > shownRuns.length) {
      const all = /** @type {HTMLButtonElement} */ (element("button", "View all blocked runs", "text-btn"));
      all.type = "button";
      all.addEventListener("click", () => { application.runFilter = "blocked"; switchTab(application, "runs"); });
      foot.append(all);
    }
    if (findings.length > shownFindings.length) {
      const all = /** @type {HTMLButtonElement} */ (element("button", "View all findings requiring attention", "text-btn"));
      all.type = "button";
      all.addEventListener("click", () => { application.findingStatusFilter = "attention"; switchTab(application, "findings"); });
      foot.append(all);
    }
    section.append(foot);
  }
  return section;
}

/**
 * @param {ScopeEntry[]} entries @param {string} filter
 * @param {Map<string, Map<number, FindingStatus>>} statuses
 */
function filterEntries(entries, filter, statuses) {
  return entries.filter((entry) => {
    const status = entry.run.status;
    if (filter === "blocked") return status === "blocked";
    if (filter === "completed") return status === "completed";
    if (filter === "running") return status !== "blocked" && status !== "completed";
    if (filter === "has-blocking") {
      return [...(statuses.get(`${entry.repositoryId}:${entry.run.id}`)?.values() ?? [])].includes("blocking");
    }
    return true;
  });
}

/** @param {ScopeEntry[]} entries */
function entryStatuses(entries) {
  /** @type {Map<string, Map<number, FindingStatus>>} */
  const statuses = new Map();
  for (const entry of entries) {
    if (entry.snapshot !== null) statuses.set(`${entry.repositoryId}:${entry.run.id}`, findingStatuses(entry.snapshot));
  }
  return statuses;
}

/**
 * The loaded runs as one table. Every ledger comes from `stageLedger`; a
 * pending snapshot shows a skeleton rather than an empty ledger.
 * @param {ScopeEntry[]} entries @param {Map<string, Map<number, FindingStatus>>} statuses
 * @param {DashboardApplication} application @param {string} key
 * @param {{ repositoryId: string, runId: number } | null} selected @param {string | null} observedAt
 */
function runTableNode(entries, statuses, application, key, selected, observedAt) {
  /** @param {ScopeEntry} entry */
  const counts = (entry) => {
    const values = [...(statuses.get(`${entry.repositoryId}:${entry.run.id}`)?.values() ?? [])];
    return { total: values.length, blocking: values.filter((value) => value === "blocking").length, open: values.filter((value) => value === "open").length };
  };
  /** @param {ScopeEntry} entry */
  const knownUsd = (entry) => entry.snapshot === null || entry.snapshot.cost.costReportedRows === 0 ? null : entry.snapshot.cost.knownUsd;
  /** @type {TableColumn<ScopeEntry>[]} */
  const columns = [
    {
      label: "Run", sort: (entry) => `${entry.run.slug} ${entry.run.id}`,
      cell: (entry) => {
        const cell = element("div", null, "run-cell");
        const link = /** @type {HTMLButtonElement} */ (element("button", null, "row-link"));
        link.type = "button";
        link.dataset.control = `${key}-run:${entry.repositoryId}:${entry.run.id}`;
        link.append(`${entry.run.slug} `, element("span", `#${entry.run.id}`, "num"));
        const tail = element("span", pathTail(entry.path), "run-path");
        tail.title = entry.path;
        cell.append(link, tail);
        return cell;
      },
    },
    { label: "Project", className: "muted col-secondary", headClass: "col-secondary", cell: (entry) => entry.run.project },
    {
      label: "State", sort: (entry) => entry.run.status,
      cell: (entry) => {
        const presentation = statusPresentation(entry.run.status, entry.run.phase);
        const cell = element("span", null, "state-stage");
        cell.append(badge(presentation.label, presentation.tone));
        if (entry.snapshot !== null) {
          const stopped = stageLedger(entry.snapshot).segments.findLast((segment) => segment.result === "blocked") ?? null;
          if (stopped !== null && entry.run.status === "blocked") cell.append(element("span", readableIntent(stopped.kind), "stage-name"));
          const tag = liveTag(runLiveness(application, entry.repositoryId, entry.snapshot), application.autoRefresh);
          if (tag !== null) cell.append(tag);
        }
        if (entry.stale) cell.append(element("span", "Stale", "section-stale"));
        return cell;
      },
    },
    {
      label: "Recorded stages",
      cell: (entry) => {
        if (entry.snapshot !== null) {
          return stageLedgerNode(entry.snapshot, false, application.autoRefresh &&
            runLiveness(application, entry.repositoryId, entry.snapshot) === "live");
        }
        const state = snapshotState({ runId: entry.run.id, snapshot: null, stale: entry.stale, loading: entry.loading });
        if (state === "pending") {
          const pending = element("span", null, "skeleton ledger-skeleton");
          pending.append(element("span", "Loading", "visually-hidden"));
          return pending;
        }
        return element("span", "Unavailable", "unavailable");
      },
    },
    {
      label: "Findings", numeric: true, sort: (entry) => counts(entry).total,
      cell: (entry) => {
        if (entry.snapshot === null) return element("span", "Unavailable", "unavailable");
        const value = counts(entry);
        const cell = element("span", null, "count-cell");
        if (value.blocking > 0) cell.append(element("span", `${value.blocking} blocking`, "count-flag tone-danger"));
        else if (value.open > 0) cell.append(element("span", `${value.open} open`, "count-flag tone-warning"));
        cell.append(element("span", String(value.total)));
        return cell;
      },
    },
    { label: "Known cost", numeric: true, sort: (entry) => knownUsd(entry) ?? -1, cell: (entry) => moneyNode(knownUsd(entry)) },
    {
      label: "Last activity", numeric: true, className: "muted", sort: (entry) => Date.parse(entry.run.lastRecordedAt),
      cell: (entry) => relativeNode(entry.run.lastRecordedAt, observedAt),
    },
  ];
  return sortableTable({
    caption: selected === null ? "Loaded runs" : "Loaded runs; select a row to inspect the run",
    key, rows: entries, columns, application,
    defaultSort: { column: "Last activity", direction: "descending" },
    rowSetup: (tr, entry) => {
      tr.className = application.justUpdated.has(`${entry.repositoryId}:${entry.run.id}`) ? "is-row-link just-updated" : "is-row-link";
      if (selected !== null) {
        tr.setAttribute("aria-selected", String(selected.repositoryId === entry.repositoryId && selected.runId === entry.run.id));
      }
      tr.addEventListener("click", () => openRun(application, entry.repositoryId, entry.run.id));
    },
  });
}

/**
 * Recent runs on the Overview: newest activity first, state chips, sortable
 * headings, and a footer naming the per-repository limit.
 * @param {ScopeData} data @param {DashboardApplication} application
 */
function renderRunTable(data, application) {
  const statuses = entryStatuses(data.entries);
  const blocked = data.entries.filter((entry) => entry.run.status === "blocked").length;
  const completed = data.entries.filter((entry) => entry.run.status === "completed").length;
  const all = /** @type {HTMLButtonElement} */ (element("button", "View all runs", "text-btn"));
  all.type = "button";
  all.addEventListener("click", () => switchTab(application, "runs"));
  const section = region("Recent runs", {
    count: String(data.entries.length),
    end: fragment(chipGroup("State", "recent", [
      { value: "", label: "All", count: data.entries.length },
      { value: "blocked", label: "Blocked", count: blocked },
      { value: "running", label: "In progress", count: data.entries.length - blocked - completed },
      { value: "completed", label: "Completed", count: completed },
    ], application.recentFilter, (value) => { application.recentFilter = value; render(application); }), all),
  });
  const shown = filterEntries(data.entries, application.recentFilter, statuses);
  if (data.entries.length === 0) section.append(element("p", "No run is loaded in this scope.", "att-empty"));
  else if (shown.length === 0) section.append(element("p", "No loaded run matches this filter.", "att-empty"));
  else section.append(runTableNode(shown, statuses, application, "recent", null, data.observedAt));
  section.append(element("div", `Latest ${application.limit} per repository · select a column heading to sort`, "region-foot"));
  return section;
}

/** @param {string} label @param {string} state @param {string} tone @param {string} note */
function coverageCell(label, state, tone, note) {
  const cell = element("div", null, "coverage-cell");
  const value = element("span", null, `coverage-state tone-${tone}`);
  value.append(element("span", null, "dot"), element("span", state, "text-default"));
  cell.append(element("span", label, "eyebrow"), value, element("span", note, "coverage-note"));
  return cell;
}

/** @param {{ reported: number, total: number }} count @param {string} complete */
function coverageState(count, complete) {
  if (count.total === 0) return /** @type {[string, string]} */ (["No agent rows", "neutral"]);
  return /** @type {[string, string]} */ (count.reported === count.total ? [complete, "success"] : ["Partial", "warning"]);
}

/** "Can I trust this data?" as counts of what the loaded rows reported. @param {ReturnType<typeof repositoryViews>} views */
function coverageStrip(views) {
  const coverage = telemetryCoverage(views);
  const strip = element("div", null, "coverage");
  const snapshots = coverage.snapshots;
  strip.append(coverageCell("Snapshots",
    snapshots.total === 0 ? "None loaded" : snapshots.current === snapshots.total ? "Current" : "Partial",
    snapshots.total === 0 ? "neutral" : snapshots.current === snapshots.total ? "success" : "warning",
    `${snapshots.current} of ${snapshots.total} loaded and current`));
  strip.append(coverageCell("Cost", ...coverageState(coverage.cost, "Reported"), `${coverage.cost.reported} of ${coverage.cost.total} agent rows`));
  strip.append(coverageCell("Tokens", ...coverageState(coverage.tokens, "Reported"), `${coverage.tokens.reported} of ${coverage.tokens.total} agent rows`));
  strip.append(coverageCell("Model attribution", ...coverageState(coverage.model, "Reported"),
    `effective model on ${coverage.model.reported} of ${coverage.model.total} rows`));
  strip.append(coverageCell("Duration", ...coverageState(coverage.duration, "Recorded"), `${coverage.duration.reported} of ${coverage.duration.total} agent rows`));
  strip.append(coverageCell("History", "Not collected", "neutral", "each view is a current snapshot"));
  strip.append(coverageCell("Audit chain", "Not verified here", "neutral", "verify-audit recomputes it"));
  return strip;
}

/** @param {ScopeData} data */
function renderCoverage(data) {
  const section = element("section", null, "region");
  section.setAttribute("aria-label", "Telemetry coverage");
  section.append(coverageStrip(data.views));
  return section;
}

/**
 * The Overview as four labelled layers over the header's repository scope.
 * @param {DashboardApplication} application
 * @returns {HTMLElement}
 */
export function renderOverviewTab(application) {
  const data = scopeData(application);
  const container = element("div", null, "overview-view");
  container.append(viewHead("Overview", scopeLabel(application, data)));
  const status = layer("Operational status");
  status.append(renderStatusCards(data, application), renderStageMap(data, application));
  const attention = element("div", null, "layer");
  attention.append(renderAttentionQueue(data, application));
  const recent = element("div", null, "layer");
  recent.append(renderRunTable(data, application));
  const trust = layer("Can I trust this data?");
  trust.append(renderCoverage(data));
  container.append(status, attention, recent, trust);
  return container;
}

/* ------------------------------------------------------------------ *
 * Repository notices
 * ------------------------------------------------------------------ */

/**
 * A repository that cannot contribute table rows still says so: a refused or
 * failed run list, a stale one, or a repository with no recorded run. A
 * repository whose runs are in the table and current needs no notice.
 * @param {HTMLElement} parent @param {RepositoryState} repositoryState @param {DashboardApplication} application
 */
function renderRepositoryNotice(parent, repositoryState, application) {
  const article = element("article", null, "region");
  const status = resourceStatus(repositoryState.runs);
  const envelope = repositoryState.runs.envelope;
  const list = runListResult(repositoryState.runs);
  // The heading names the recorded project identity, so the loaded run list
  // must resolve before it is appended rather than after.
  const identity = repositoryIdentity(repositoryState.repository.path, list?.runs ?? []);
  article.append(regionHead(`${identity.display} · ${pathTail(repositoryState.repository.path)}`));
  if (status !== "") {
    const node = callout(status, repositoryState.runs.stale ? "warning" : "danger");
    node.setAttribute("role", "status");
    article.append(node);
  }
  if (envelope === null || list === null) {
    if (status === "" && repositoryState.runs.attemptedAt === null) return;
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
  if (status !== "") parent.append(article);
}

/* ------------------------------------------------------------------ *
 * Selected run: header, KPI strip, ledger, outcome, timeline, activity
 * ------------------------------------------------------------------ */

/**
 * @typedef {{
 *   snapshot: RunSnapshot, statuses: Map<number, FindingStatus>, observedAt: string | null,
 *   repositoryId: string, path: string,
 * }} RunContext
 */

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

/** One figure of a KPI strip. @param {string} label @param {Node | string} value @param {Node | string} note @param {string} [extra] @param {string} [valueClass] */
function kpi(label, value, note, extra = "", valueClass = "") {
  const node = element("div", null, `kpi ${extra}`.trim());
  const primary = element("span", null, `kpi-value ${valueClass}`.trim());
  primary.append(value);
  const secondary = element("span", null, "kpi-note");
  secondary.append(note);
  node.append(element("span", label, "eyebrow"), primary, secondary);
  return node;
}

/**
 * The outcome statement: the model's headline and derived sentence, whether a
 * governed action is eligible, the actions an operator takes next, and the
 * verbatim technical facts behind a disclosure. Nothing is parsed from event
 * prose.
 * @param {ReturnType<typeof runExecutiveSummary>} summary
 * @param {ReturnType<typeof snapshotProjection>} projection
 * @param {DashboardApplication} application @param {RunContext} context
 */
function renderRunOutcome(summary, projection, application, context) {
  const outcome = runOutcome(context.snapshot, context.statuses);
  const node = element("div", null, `outcome tone-${outcome.tone}`);
  const statement = element("div");
  statement.append(element("h4", outcome.headline), element("p", outcome.sentence),
    element("p", outcome.ineligibleStatement === null ? "A governed action is eligible." : `${outcome.ineligibleStatement}.`, "next"));
  const statuses = [...context.statuses.values()];
  const blocking = statuses.filter((status) => status === "blocking").length;
  const open = statuses.filter((status) => status === "open").length;
  const actions = element("div", null, "outcome-actions");
  if (blocking + open > 0) {
    const view = /** @type {HTMLButtonElement} */ (element("button", `View ${blocking > 0 ? "blocking" : "open"} findings`, "btn"));
    view.type = "button";
    view.addEventListener("click", () => focusRunSection("run-findings"));
    actions.append(view);
  }
  const status = projection.governance.commands.find((command) => command.kind === "status") ?? null;
  if (status !== null) actions.append(copyControl("Copy status command", status.text, "status command", application));
  // snapshotProjection files the workflow action's own command under the kind
  // "workflow". An execution group is never a command kind, so matching on
  // action.group would silently never resolve.
  const projected = projection.governance.commands.find((command) => command.kind === "workflow") ?? null;
  if (projected !== null && projected.eligible) {
    actions.append(copyControl("Copy next-step command", projected.text, "next-step command", application));
  }

  const action = summary.nextAction;
  const event = context.snapshot.activity.lastEvent;
  const codeReview = projection.governance.configuration.codeReview;
  const writer = projection.overview.writer;
  /** @type {[string, Node | string][]} */
  const facts = [];
  if (event !== null) {
    facts.push(["Last event", fragment(element("span", event.action, "mono"), " · ", recordedTime(event.at))]);
    facts.push(["Event summary", element("span", event.summary, "mono")]);
  }
  facts.push(["Next action", `${text(action.group, "No recorded group")} · ${action.eligible ? "eligible" : "not eligible"}`]);
  if (action.reasons.length > 0) {
    facts.push(["Refusal", fragment(...action.reasons.flatMap((reason, index) => [
      ...(index === 0 ? [] : ["; "]), element("span", reason.code, "mono"), ` ${reason.reason}`,
    ]))]);
  }
  if (projected !== null) facts.push(["Next-step command", element("code", projected.text, "command-text")]);
  if (codeReview !== null) {
    facts.push(["Blocking threshold", fragment(element("span", codeReview.blockingSeverity, "mono"),
      ` · panel ${codeReview.panelSize} · max rounds ${codeReview.maxRounds}`)]);
  }
  if (projection.delivery.finalReviewedCommit !== null) {
    facts.push(["Final reviewed commit", identityNode(identityPresentation(projection.delivery.finalReviewedCommit), "final reviewed commit", application)]);
  }
  facts.push(["Writer lock", fragment(element("span", writer.status, "mono"),
    writer.status === "live" ? " — a writer process holds this repository's lock" : " — no live writer in this repository")]);
  const details = element("details", null, "technical");
  details.append(element("summary", "Technical details"), definitionList(facts, "definitions technical-body"));
  node.append(statement, actions, details);
  return node;
}

/**
 * The run view's opening region: the run header, the selected-run KPI strip
 * (kept separate from the page cards), the full ledger, and the outcome. Every
 * claim here is copied from the projected summary and the model's outcome.
 * @param {ReturnType<typeof runExecutiveSummary>} summary
 * @param {ReturnType<typeof snapshotProjection>} projection
 * @param {DashboardApplication} application @param {RunContext} context
 */
function renderExecutiveSummary(summary, projection, application, context) {
  const section = element("section", null, "region");
  section.id = "run-summary";
  section.tabIndex = -1;
  section.dataset.control = "run-summary";
  const run = projection.overview.run;
  // R10: the latest recorded timestamp is surfaced here; the ones it supersedes
  // stay in the Run detail disclosure. Which one is latest is decided by the
  // model, not by the order they are listed in.
  const stamps = latestTimestamp([
    { label: "Created", value: run.createdAt },
    { label: "Updated", value: run.updatedAt },
    { label: "Last recorded activity", value: projection.overview.activity.lastRecordedAt },
  ]);
  const state = runLiveness(application, context.repositoryId, context.snapshot);
  const live = state === "live" && application.autoRefresh;

  const body = element("div", null, "region-body");
  const eyebrow = element("div", null, "run-head");
  eyebrow.append(element("span", "Selected run", "eyebrow"));
  const head = element("div", null, "run-head");
  const title = element("h2", `${summary.run.slug}`, "run-title");
  title.id = `heading-${++headingSequence}`;
  section.setAttribute("aria-labelledby", title.id);
  title.append(element("span", `#${summary.run.id}`, "num"));
  head.append(title, badge(summary.state.label, summary.state.tone));
  const tag = liveTag(state, application.autoRefresh);
  if (tag !== null) head.append(tag);
  const meta = element("div", null, "run-meta");
  const path = element("span", context.path, "mono");
  path.title = context.path;
  const latest = element("span");
  if (stamps.latest !== null) latest.append(`${stamps.latest.label.toLowerCase()} `, relativeNode(stamps.latest.value, context.observedAt));
  meta.append(path, element("span", `project ${summary.run.project}`), element("span", `feature ${summary.run.featureId}`),
    element("span", `change ${summary.run.changeKind}`), latest);
  body.append(eyebrow, head, meta);
  section.append(body);

  const segments = stageLedger(context.snapshot).segments;
  const stopped = segments.findLast((segment) => segment.result === "blocked") ?? null;
  const counts = [...context.statuses.values()];
  const blocking = counts.filter((status) => status === "blocking").length;
  const open = counts.filter((status) => status === "open").length;
  const tokens = summary.tokens;
  const output = tokens.classes.find((entry) => entry.key === "output")?.known ?? null;
  const strip = element("div", null, "kpis");
  strip.append(stopped !== null && run.status === "blocked"
    ? kpi("State", `Blocked at ${stageLower(stopped.kind)}`, `stage ${segments.indexOf(stopped) + 1} of ${segments.length} recorded`, "", "is-text tone-danger")
    : run.status === "completed"
      ? kpi("State", "Completed", `${plural(segments.length, "stage")} recorded`, "", "is-text tone-success")
      : kpi("State", summary.state.label, segments.length === 0 ? "no stage recorded"
        : `latest ${stageLower(segments[segments.length - 1]?.kind ?? "")}`, "", `is-text tone-${summary.state.tone}`));
  const [findingCount, findingLabel, findingTone] = blocking > 0 ? [blocking, "blocking findings", "tone-danger"]
    : open > 0 ? [open, "open findings", "tone-warning"] : [0, "findings require attention", ""];
  strip.append(kpi("Findings", String(findingCount), `${findingLabel} · ${context.snapshot.evidence.findings.length} recorded`, "", findingTone));
  const tokenNote = element("span", tokens.known === null ? "No row reported a token class"
    : `${exactCount(tokens.known)} total · ${output === null ? "output unavailable" : `${exactCount(output)} out`}`, "mono");
  tokenNote.title = "input · output · cache read · cache write";
  strip.append(kpi("Tokens", tokens.known === null ? "Unavailable" : abbreviated(tokens.known), tokenNote, "is-usage"));
  strip.append(kpi("Known cost", moneyNode(summary.cost.available ? projection.cost.knownUsd : null), "for these tokens", "is-usage"));
  strip.append(kpi("Telemetry", fragment(String(projection.cost.costReportedRows),
    element("span", ` of ${projection.cost.agentRows}`, "muted")), "agent rows reported"));
  section.append(strip);
  section.append(stageLedgerNode(context.snapshot, true, live));
  section.append(renderRunOutcome(summary, projection, application, context));

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
  section.append(sectionNote("Workflow timeline", "Recorded stages in their recorded order. A stage the run never recorded is absent rather than complete, and no stage runs in parallel."));
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
  section.append(sectionNote("Activity", "Recorded stage start evidence, stage completion timestamps, and the single latest audit event this projection exposes. This is not the complete audit stream."));
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
  const strip = element("div", null, "kpis");
  const cost = projection.cost;
  strip.append(kpi("Known cost", moneyNode(cost.costReportedRows === 0 ? null : cost.knownUsd),
    `${cost.costReportedRows} reported and ${cost.costUnreportedRows} unreported of ${cost.agentRows} agent rows · ${cost.currency}`, "is-usage"));
  strip.append(kpi("Agent rows", countNode(cost.agentRows),
    `${plural(cost.recordedFailedAttempts, "recorded failed attempt")}; a failed attempt carries no inferred spend`));
  for (const entry of projection.tokens.classes) {
    strip.append(kpi(`${entry.label} tokens`, entry.known === null ? "Unavailable" : countNode(entry.known),
      `${entry.reportedRows} reported and ${entry.unreportedRows} unreported rows${entry.unreportedRows > 0 ? " · partial" : ""}`, "is-usage"));
  }
  section.append(strip);
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
  section.append(sectionNote("Token consumption", "The horizontal axis is recorded stage ordinal, not wall-clock time. A stage with no reported row for a class leaves a gap rather than a zero."));
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

/**
 * Cost and token evidence as one section. The four existing views keep their
 * own ids and captions; grouping them only stops four separate headings from
 * competing for the same attention.
 * @param {ReturnType<typeof snapshotProjection>} projection
 */
function renderCostAndTokens(projection) {
  const section = panel("Cost and tokens", "cost-and-tokens");
  section.append(sectionNote("Cost and tokens", `${AGENT_TOKEN_CLASS_NOTE} Values come only from this run's recorded agent rows; an unreported row is not a zero-cost execution.`));
  section.append(
    renderCostCards(projection),
    renderStageCostChart(projection),
    renderAgentCostChart(projection),
    renderTokenChart(projection),
  );
  return section;
}

/** @typedef {ReturnType<typeof agentRows>["rows"][number]} AgentRow */
/** @typedef {ReturnType<typeof stageUsage>["stages"][number]} UsageStage */

/**
 * The agents of one run as a sortable table, sorted by known cost, with the
 * model stated once when every row reported the same requested model.
 * @param {RunSnapshot} snapshot @param {DashboardApplication} application
 */
function agentTableParts(snapshot, application) {
  const { rows, uniformModel } = agentRows(snapshot);
  const executions = rows.reduce((sum, row) => sum + row.executions, 0);
  const modelLine = uniformModel !== null
    ? fragment("Every agent row reported model ", element("span", uniformModel, "mono"), ` (${executions} of ${executions} rows, as requested).`)
    : fragment("Model is each agent's recorded effective model; the requested model is in its tooltip.");
  if (rows.length === 0) return { rows, modelLine, table: element("p", "This run has no recorded agent group.", "empty-state") };
  const maxCost = Math.max(0, ...rows.map((row) => row.knownUsd ?? 0));
  const top = rows.reduce((/** @type {AgentRow | null} */ best, row) =>
    row.knownUsd !== null && (best === null || row.knownUsd > (best.knownUsd ?? 0)) ? row : best, null);
  /** @type {TableColumn<AgentRow>[]} */
  const columns = [
    { label: "Agent", className: "mono", sort: (row) => row.agent, cell: (row) => row.agent },
    { label: "Role", className: "muted", cell: (row) => row.roles.length === 0 ? "Not recorded" : row.roles.join(", ") },
  ];
  if (uniformModel === null) {
    columns.push({
      label: "Model", className: "mono",
      cell: (row) => row.effectiveModels.length === 0 ? element("span", "Unavailable", "unavailable") : row.effectiveModels.join(", "),
      title: (row) => `requested ${row.requestedModels.join(", ") || "not recorded"} · effective ${row.effectiveModels.join(", ") || "not reported"}` +
        `${row.effectiveModelUnreportedRows > 0 ? ` · ${plural(row.effectiveModelUnreportedRows, "row")} reported no model` : ""}`,
    });
  }
  columns.push(
    { label: "Share of known cost", className: "usage-bar", cell: (row) => meterBar(maxCost === 0 ? 0 : (row.knownUsd ?? 0) / maxCost, row === top) },
    {
      label: "Known cost", numeric: true, sort: (row) => row.knownUsd ?? -1, cell: (row) => moneyNode(row.knownUsd),
      title: (row) => row.costPerExecution === null ? "Cost per execution unavailable" : `${usdPresentation(row.costPerExecution).display} per execution`,
    },
    { label: "Share", numeric: true, className: "muted", cell: (row) => shareText(row.share) },
    {
      label: "Executions", numeric: true, sort: (row) => row.executions, cell: (row) => String(row.executions),
      title: (row) => row.recordedFailedAttempts > 0 ? plural(row.recordedFailedAttempts, "recorded failed attempt") : "No recorded failed attempt",
    },
    {
      label: "Tokens", numeric: true, sort: (row) => row.tokens.known ?? -1,
      cell: (row) => row.tokens.known === null ? element("span", "Unavailable", "unavailable") : abbreviated(row.tokens.known),
      title: (row) => row.tokens.known === null ? "No row reported a token class" : `${exactCount(row.tokens.known)} tokens`,
    },
    {
      label: "Total time", numeric: true, sort: (row) => row.durationMs ?? -1, cell: (row) => duration(row.durationMs),
      title: (row) => row.averageDurationMs === null ? "Average time unavailable" : `${duration(Math.round(row.averageDurationMs))} per execution`,
    },
  );
  const table = sortableTable({
    caption: "Agents, highest known cost first", key: "agents", rows, columns, application,
    defaultSort: { column: "Known cost", direction: "descending" },
  });
  table.firstElementChild?.classList.add("usage-table");
  return { rows, modelLine, table };
}

function agentInfo() {
  return metricInfoButton("Agent comparison",
    "Shares are of this run's known cost. Hover Known cost for cost per execution and Total time for average time per execution. The model column appears whenever agents report different models, a requested model differs from the effective one, or a row reported none.",
    `A higher value is a place to look, not proof of inefficiency. ${AGENT_TOKEN_CLASS_NOTE}`);
}

/** The run view's agent section. @param {RunSnapshot} snapshot @param {DashboardApplication} application */
function renderAgentAnalytics(snapshot, application) {
  const section = panel("Agent analytics", "agents");
  const parts = agentTableParts(snapshot, application);
  const note = element("div", null, "section-note");
  const line = element("span");
  line.append(parts.modelLine);
  note.append(agentInfo(), line);
  section.append(note, parts.table);
  return section;
}

/** The Models view's agent region. @param {RunSnapshot} snapshot @param {DashboardApplication} application @param {string} label */
function renderAgentTable(snapshot, application, label) {
  const parts = agentTableParts(snapshot, application);
  const section = region("Agents", { count: String(parts.rows.length), info: agentInfo(), sub: parts.modelLine });
  section.dataset.control = `agents:${label}`;
  section.append(parts.table);
  return section;
}

/**
 * Where one run's cost, tokens, and time went, from `stageUsage`. The three
 * facts are plain maxima of recorded values, not judgements that a stage is
 * abnormal.
 * @param {RunSnapshot} snapshot @param {DashboardApplication} application @param {string} label
 */
function renderStageUsage(snapshot, application, label) {
  const usage = stageUsage(snapshot);
  const section = region("Where cost, tokens, and time went", {
    count: label,
    info: metricInfoButton("Stage usage",
      "Shares are of this run's known cost and known tokens. Known cost is what agent rows reported, not a complete bill.",
      "Highest, most, and longest are plain rankings of recorded values, not judgements that a stage is abnormal."),
  });
  const facts = element("div", null, "usage-facts");
  /** @param {string} name @param {string} kind @param {Node | string} value @param {string} note */
  const fact = (name, kind, value, note) => {
    const node = element("div", null, "usage-fact");
    const amount = element("span", null, "usage-value");
    amount.append(value);
    node.append(element("span", name, "eyebrow"), element("span", readableIntent(kind), "usage-stage"), amount, element("span", note, "usage-note"));
    facts.append(node);
  };
  const { cost, tokens, duration: longest } = usage.highest;
  if (cost !== null) fact("Highest cost", cost.kind, moneyNode(cost.knownUsd), `${shareText(cost.share)} of known cost`);
  if (tokens !== null && tokens.tokens !== null) fact("Most tokens", tokens.kind, abbreviated(tokens.tokens), `${shareText(tokens.tokenShare)} of tokens`);
  if (longest !== null) fact("Longest running", longest.kind, duration(longest.durationMs), "from stage creation to end");
  if (facts.childElementCount > 0) section.append(facts);

  const maxCost = Math.max(0, ...usage.stages.map((stage) => stage.knownUsd ?? 0));
  if (usage.stages.length > 0) {
    /** @type {TableColumn<UsageStage>[]} */
    const columns = [
      { label: "Stage", className: "nowrap", cell: (stage) => readableIntent(stage.kind) },
      { label: "Share of known cost", className: "usage-bar", cell: (stage) => meterBar(maxCost === 0 ? 0 : (stage.knownUsd ?? 0) / maxCost, stage === cost) },
      { label: "Known cost", numeric: true, cell: (stage) => moneyNode(stage.knownUsd) },
      { label: "Share", numeric: true, className: "muted", cell: (stage) => shareText(stage.share) },
      {
        label: "Tokens", numeric: true, cell: (stage) => stage.tokens === null ? element("span", "Unavailable", "unavailable") : abbreviated(stage.tokens),
        title: (stage) => stage.tokens === null ? "No row reported a token class" : `${exactCount(stage.tokens)} tokens`,
      },
    ];
    const table = sortableTable({ caption: "Stages with agent runs, highest known cost first", key: "stage-usage", rows: usage.stages, columns, application });
    table.firstElementChild?.classList.add("usage-table");
    section.append(table);
  }
  if (usage.idle.length > 0) {
    const idle = element("p", null, "usage-idle");
    idle.append(badge("No agent runs", "neutral"));
    for (const stage of usage.idle) {
      const item = element("span");
      item.append(element("strong", readableIntent(stage.kind)), ` · ${stage.reason}`);
      idle.append(item);
    }
    section.append(idle);
  }

  const composition = element("div", null, "usage-composition");
  const bar = svg("svg", {
    class: "composition-bar", viewBox: "0 0 100 8", preserveAspectRatio: "none", role: "img",
    "aria-label": usage.composition.map((entry) => `${entry.label.toLowerCase()} ${shareText(entry.share)}`).join(", "),
  });
  let x = 0;
  for (const entry of usage.composition) {
    const width = (entry.share ?? 0) * 100;
    if (width > 0) {
      bar.append(svg("rect", {
        class: TOKEN_SERIES[entry.key] ?? "series-1", x: x.toFixed(2), y: "0", width: Math.max(width - 0.4, 0.2).toFixed(2), height: "8",
      }));
    }
    x += width;
  }
  const keys = element("ul", null, "legend composition-legend");
  for (const entry of usage.composition) {
    const item = element("li", null, TOKEN_SERIES[entry.key] ?? "series-1");
    item.append(element("span", null, "swatch"), element("span", entry.label.toLowerCase(), "legend-label"),
      element("span", entry.known === null ? "Unavailable" : abbreviated(entry.known), "num"), element("span", shareText(entry.share), "muted"));
    keys.append(item);
  }
  composition.append(element("span", "Token composition", "eyebrow"), bar, keys);
  section.append(composition);

  const durations = new Map(stageLedger(snapshot).segments.map((segment) => [segment.stageId, segment.durationMs]));
  const groups = new Map(snapshot.cost.byStage.map((group) => [group.stageId, group]));
  /** @param {RunSnapshot["stages"][number]} stage @param {"input" | "output" | "cacheRead" | "cacheWrite"} key */
  const tokenCell = (stage, key) => {
    const group = groups.get(stage.id);
    const known = group === undefined || group.agentRows === 0 ? null : group.tokens[key].known;
    return known === null ? element("span", "Unavailable", "muted") : exactCount(known);
  };
  /** @type {TableColumn<RunSnapshot["stages"][number]>[]} */
  const rawColumns = [
    { label: "Stage", className: "nowrap", cell: (stage) => readableIntent(stage.kind) },
    {
      label: "Known cost", numeric: true, cell: (stage) => {
        const group = groups.get(stage.id);
        return group === undefined || group.agentRows === 0 ? element("span", "None", "muted") : moneyNode(group.costReportedRows === 0 ? null : group.knownUsd);
      },
    },
    { label: "Input", numeric: true, cell: (stage) => tokenCell(stage, "input") },
    { label: "Output", numeric: true, cell: (stage) => tokenCell(stage, "output") },
    { label: "Cache read", numeric: true, cell: (stage) => tokenCell(stage, "cacheRead") },
    { label: "Cache write", numeric: true, cell: (stage) => tokenCell(stage, "cacheWrite") },
    {
      label: "Agent runs", numeric: true, cell: (stage) => {
        const rows = groups.get(stage.id)?.agentRows ?? 0;
        return rows === 0 ? badge("None", "neutral") : String(rows);
      },
    },
    { label: "Duration", numeric: true, className: "muted", cell: (stage) => duration(durations.get(stage.id) ?? null) },
  ];
  const raw = element("details", null, "history");
  const summary = element("summary", "Token classes and agent runs by stage ");
  summary.append(element("span", "· recorded order", "num"));
  raw.append(summary, sortableTable({ caption: "Token classes and agent runs for every recorded stage", key: "stage-raw", rows: snapshot.stages, columns: rawColumns, application }));
  section.append(raw);
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
 * The finding table's columns. Report subjects and every audit field stay in
 * the drawer, unaltered; the row carries only what triage needs, and the
 * status column is the recorded status from `findingStatus`.
 * @param {DashboardApplication} application @param {boolean} withRun
 * @returns {TableColumn<FindingRow>[]}
 */
function findingColumns(application, withRun) {
  /** @type {TableColumn<FindingRow>[]} */
  const columns = [
    {
      label: "Severity",
      cell: (row) => row.severity.available
        ? badge(row.severity.severity ?? "", severityTone(row.severity.severity ?? ""), "severity")
        : badge("Unranked", "neutral", "severity"),
    },
    {
      label: "Finding",
      cell: (row) => {
        const link = /** @type {HTMLButtonElement} */ (element("button", null, "row-link"));
        link.type = "button";
        link.dataset.control = `finding:${row.repositoryId}:${row.runId}:${row.card.id}`;
        link.append(`${row.card.title} `, element("span", `#${row.card.id}`, "num"));
        link.addEventListener("click", () => openFindingDrawer(application, row, link));
        return link;
      },
    },
    {
      label: "Location", className: "mono muted",
      cell: (row) => {
        const location = element("span", row.card.location, "clamp-2");
        location.title = row.card.location;
        return location;
      },
    },
  ];
  if (withRun) {
    columns.push({
      label: "Run", className: "muted nowrap",
      cell: (row) => fragment(`${row.runLabel} `, element("span", `· ${pathTail(row.path)}`, "mono")),
      title: (row) => row.path,
    });
  }
  columns.push(
    { label: "Stage", className: "muted nowrap", cell: (row) => `${readableIntent(row.stageKind)} · r${row.card.round}` },
    { label: "Status", cell: (row) => badge(FINDING_STATUS[row.status].label, FINDING_STATUS[row.status].tone) },
  );
  return columns;
}

/**
 * @param {FindingRow[]} rows @param {string} caption @param {string} key
 * @param {DashboardApplication} application @param {boolean} withRun
 */
function findingTable(rows, caption, key, application, withRun) {
  return sortableTable({
    caption, key, rows, columns: findingColumns(application, withRun), application,
    rowSetup: (tr, row) => {
      tr.dataset.status = row.status;
      if (!FINDING_STATUS[row.status].active) tr.className = "is-quiet";
    },
  });
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

/**
 * The run's findings: active findings in one table with a "Blocking only"
 * toggle, and addressed, earlier-round, and rejected findings in a collapsed
 * history. Within a status, the recorded triage order is kept.
 * @param {ReturnType<typeof snapshotProjection>} projection @param {DashboardApplication} application
 * @param {RunContext} context
 */
function renderFindings(projection, application, context) {
  const severities = severityOrder(projection.governance.configuration);
  const ordered = orderFindings(projection.findingCards, severities);
  const finalPanel = finalPanelBlockingSummary(ordered);
  const kinds = new Map(projection.stages.map((stage) => [stage.id, stage.kind]));
  const runLabel = `${projection.overview.run.slug} #${projection.overview.run.id}`;
  /** @type {FindingRow[]} */
  const rows = ordered.map((card) => {
    const stageKind = kinds.get(card.stageId) ?? "";
    return {
      repositoryId: context.repositoryId, runId: projection.overview.run.id, runLabel, path: context.path,
      card, status: context.statuses.get(card.id) ?? findingStatus(card, stageKind), stageKind,
      severity: cardSeverity(card, severities),
    };
  }).sort((left, right) => FINDING_STATUS[left.status].rank - FINDING_STATUS[right.status].rank);
  const active = rows.filter((row) => FINDING_STATUS[row.status].active);
  const history = rows.filter((row) => !FINDING_STATUS[row.status].active);
  const blocking = rows.filter((row) => row.status === "blocking").length;
  /** @type {HTMLButtonElement | null} */
  let toggle = null;
  if (blocking > 0) {
    toggle = /** @type {HTMLButtonElement} */ (element("button", "Blocking only", "chip"));
    toggle.type = "button";
    toggle.dataset.control = "blocking-only";
    toggle.setAttribute("aria-pressed", String(application.blockingOnly));
    toggle.append(element("span", String(blocking), "num"));
    toggle.addEventListener("click", () => { application.blockingOnly = !application.blockingOnly; render(application); });
  }
  const section = region("Findings", {
    count: `${active.length} active · ${rows.length} recorded`,
    info: metricInfoButton("Finding order", FINDING_ORDER_STATEMENT, finalPanel.statement ?? ""),
    end: toggle,
    sub: "Active findings are listed; addressed and earlier-round findings are in history.",
  });
  section.id = "run-findings";
  section.tabIndex = -1;
  section.dataset.control = "run-findings";
  if (rows.length === 0) {
    section.append(element("p", "This run has no canonical finding.", "att-empty"));
    return section;
  }
  const shown = application.blockingOnly && blocking > 0 ? active.filter((row) => row.status === "blocking") : active;
  section.append(shown.length === 0
    ? element("p", "No active findings.", "att-empty")
    : findingTable(shown, `Active findings for ${runLabel}`, "run-findings", application, false));
  if (history.length > 0) {
    /** @type {Map<FindingStatus, number>} */
    const counts = new Map();
    for (const row of history) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    const details = element("details", null, "history");
    const summary = element("summary", "History ");
    summary.append(element("span", `· ${[...counts.entries()].map(([status, count]) => `${count} ${FINDING_STATUS[status].label.toLowerCase()}`).join(" · ")}`, "num"));
    details.append(summary, findingTable(history, `Finding history for ${runLabel}`, "run-finding-history", application, false));
    section.append(details);
  }
  return section;
}

/**
 * Copy-only commands for the selected run. Copying places text on the
 * clipboard; the dashboard never executes a command, opens a writer, or
 * collects consent.
 * @param {ReturnType<typeof snapshotProjection>} projection
 * @param {DashboardApplication} application
 * @param {number} runId
 */
function renderCommands(projection, application, runId) {
  const shellLabel = application.platform === "win32" ? "PowerShell" : "POSIX shell";
  const commands = projection.governance.commands;
  const section = region("Available commands", {
    count: String(commands.length),
    sub: `Copy-only ${shellLabel}. Run a command outside this read-only dashboard.`,
  });
  section.id = "commands";
  const list = element("ul", null, "actions-list");
  for (const command of commands) {
    const presentation = COMMAND_PRESENTATION[command.kind]
      ?? { name: command.title ?? readableIntent(command.kind), description: command.reason ?? "A recorded operator action." };
    const item = element("li", null, "action-row");
    const description = element("div");
    description.append(element("h4", presentation.name), element("p", presentation.description));
    const controls = element("div", null, "action-controls");
    const copy = copyControl("Copy command", command.text, `${presentation.name} command`, application);
    copy.disabled = !command.eligible;
    controls.append(badge(command.eligible ? "Eligible" : "Not eligible", command.eligible ? "success" : "neutral"), copy);
    /** @type {[string, Node | string][]} */
    const entries = [];
    // A repository-wide command taking no run is a recorded fact about scope.
    if (command.scope === "repository") {
      entries.push(["Run context", `Run ${runId} is selected; this command is repository-wide and takes no run.`]);
    }
    if (command.reason !== null && command.reason !== "") entries.push(["Reason", command.reason]);
    if (command.proposalId !== null) entries.push(["Proposal", String(command.proposalId)]);
    if (command.title !== null) entries.push(["Title", command.title]);
    if (command.route !== null) entries.push(["Route", command.route]);
    if (command.evidenceRef !== null) entries.push(["Evidence reference", command.evidenceRef]);
    const body = element("div");
    body.append(element("code", command.text, "command-text"));
    if (entries.length > 0) body.append(definitionList(entries, "definitions compact"));
    item.append(description, controls, disclosure("View command", body));
    list.append(item);
  }
  section.append(list);
  return section;
}

/** @param {ReturnType<typeof snapshotProjection>} projection @param {DashboardApplication} application */
function renderConfiguration(projection, application) {
  const section = panel("Configuration and approvals", "configuration");
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
  section.append(sectionNote("Evidence", "Recorded references and their observed availability. The dashboard never links to, serves, or renders evidence contents."));
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
 * Application state and views
 * ------------------------------------------------------------------ */

/** @typedef {{
 * token: string,
 * inventory: RepositoryInventory | null,
 * repositories: Map<string, RepositoryState>,
 * selectedRepositoryId: string | null,
 * selectedRunId: number | null,
 * currentTab: string,
 * limit: number,
 * repositoryFilter: string,
 * runFilter: string,
 * recentFilter: string,
 * attentionFilter: string,
 * findingStatusFilter: string,
 * findingSeverityFilter: string,
 * blockingOnly: boolean,
 * sorts: Map<string, { column: string, direction: SortDirection }>,
 * sessionExpired: boolean,
 * refreshGeneration: number,
 * inFlight: Set<string>,
 * autoRefresh: boolean,
 * refreshing: number,
 * refreshTimer: ReturnType<typeof setTimeout> | null,
 * justUpdated: Set<string>,
 * platform: string,
 * main: HTMLElement,
 * live: HTMLElement
 * }} DashboardApplication */

/**
 * Rebuild the visible view. A focused control that carries a `data-control`
 * key keeps focus across the rebuild, so a chip or sort heading can be used
 * repeatedly from the keyboard.
 * @param {DashboardApplication} application
 */
function render(application) {
  if (application.sessionExpired) {
    application.main.setAttribute("aria-busy", "false");
    showSessionExpired(application.main, "The server rejected this tab's bearer token.");
    renderChrome(application);
    return;
  }
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement && application.main.contains(active) ? active.dataset.control ?? null : null;
  application.main.replaceChildren();

  if (application.currentTab === "overview") {
    application.main.append(renderOverviewTab(application));
  } else if (application.currentTab === "runs") {
    application.main.append(renderRunsTab(application));
  } else if (application.currentTab === "findings") {
    application.main.append(renderFindingsTab(application));
  } else if (application.currentTab === "governance") {
    application.main.append(renderGovernanceTab(application));
  } else if (application.currentTab === "models") {
    application.main.append(renderModelsTab(application));
  } else if (application.currentTab === "audit") {
    application.main.append(renderAuditTab(application));
  } else {
    application.main.append(renderOverviewTab(application));
  }

  if (focusKey !== null) {
    for (const node of application.main.querySelectorAll("[data-control]")) {
      if (node instanceof HTMLElement && node.dataset.control === focusKey) {
        node.focus();
        break;
      }
    }
  }
  application.main.setAttribute("aria-busy", "false");
  renderChrome(application);
}

/**
 * The header's data status, freshness, and tab counts. The status pill covers
 * every configured repository, because scoping is presentation only; the tab
 * counts follow the scope.
 * @param {DashboardApplication} application
 */
function renderChrome(application) {
  const data = scopeData(application);
  const loaded = [...application.repositories.values()].some((state) => state.runs.envelope !== null);
  const runs = document.querySelector('[data-tab-count="runs"]');
  if (runs instanceof HTMLElement) {
    runs.textContent = String(data.entries.length);
    runs.hidden = !loaded;
  }
  const attention = document.querySelector('[data-tab-count="attention"]');
  if (attention instanceof HTMLElement) {
    attention.textContent = String(data.counts.requireAttention);
    attention.hidden = !loaded;
    attention.classList.toggle("tone-danger", data.counts.requireAttention > 0);
  }
  const everything = portfolioProjection(repositoryViews({ repositories: application.repositories }));
  const coverage = everything.coverage;
  const stale = coverage.stale;
  const cadence = `Auto-refresh every ${AUTO_REFRESH_INTERVAL_MS / 1000} s while this tab is visible`;
  /** @type {[string, string, string]} */
  const [label, tone, title] = application.sessionExpired
    ? ["Session expired", "danger", "The launch token was refused; reopen the URL bw dashboard prints."]
    : stale > 0
      ? [`${plural(stale, "snapshot")} stale`, "warning", `${plural(stale, "snapshot")} failed to refresh; the last values stay, labelled stale.`]
      : !application.autoRefresh || document.visibilityState !== "visible"
        ? ["Auto-refresh paused", "neutral", "Refresh reloads on demand."]
        : loaded
          ? ["Data current", "success", `${coverage.fresh} of ${coverage.loadedRuns} snapshots current across all configured repositories. ${cadence}.`]
          : ["Loading", "neutral", "The first observation has not completed."];
  const pill = document.querySelector("#data-status");
  if (pill instanceof HTMLElement) {
    pill.className = `status-pill tone-${tone}`;
    pill.title = title;
    const pillLabel = pill.querySelector(".pill-label");
    if (pillLabel !== null) pillLabel.textContent = label;
  }
  const updated = document.querySelector("#last-updated");
  if (updated instanceof HTMLTimeElement && data.observedAt !== null) {
    const presentation = relativeTimePresentation(data.observedAt, null);
    updated.dateTime = data.observedAt;
    updated.title = presentation.exact;
    updated.textContent = new Date(data.observedAt).toLocaleTimeString("en-US", { hour12: false });
  }
  document.querySelector("#refresh")?.classList.toggle("is-refreshing", application.refreshing > 0);
  const cadenceNode = document.querySelector("#refresh-cadence");
  if (cadenceNode !== null) cadenceNode.textContent = application.autoRefresh ? cadence : "Auto-refresh paused · Refresh reloads on demand";
}

/**
 * The run the run-scoped views show: the selection, or else the most recent
 * loaded run in scope.
 * @param {DashboardApplication} application @param {ScopeEntry[]} entries
 */
function selectedEntry(application, entries) {
  if (application.selectedRepositoryId !== null && application.selectedRunId !== null) {
    return { repositoryId: application.selectedRepositoryId, runId: application.selectedRunId };
  }
  const first = entries[0];
  return first === undefined ? null : { repositoryId: first.repositoryId, runId: first.run.id };
}

/** The Runs page cards, scoped to the header selection. @param {ScopeData} data @param {DashboardApplication} application */
function renderRunsCards(data, application) {
  const { portfolio, counts } = data;
  const cards = element("div", null, "cards is-six");
  cards.append(statusCard({
    label: "Runs", value: String(portfolio.runs),
    breakdown: application.repositoryFilter === "" ? `from ${plural(application.repositories.size, "repository", "repositories")}` : "in this repository",
  }));
  cards.append(statusCard({
    label: "Blocked", value: toned(portfolio.blockedRuns, "danger", String(portfolio.blockedRuns)),
    breakdown: `of ${portfolio.runs} loaded`,
  }));
  cards.append(statusCard({
    label: "Findings requiring attention", value: snapshotValue(data, () => String(counts.requireAttention)),
    breakdown: fragment(toned(counts.blocking, "danger", `${counts.blocking} blocking`), " · ", toned(counts.open, "warning", `${counts.open} open`)),
  }));
  cards.append(usagePair(tokensCard(portfolio.tokens),
    costCard({ knownUsd: portfolio.cost.knownUsd, reportedRows: portfolio.cost.reportedRows, agentRows: portfolio.cost.agentRows })));
  cards.append(statusCard({
    label: "Audit status", value: "Not verified", textValue: true, breakdown: "in this view · verify-audit per repository",
  }));
  return cards;
}

/**
 * The Runs view: page cards, repository notices, the run table with its
 * quick filters and per-repository limit, and the selected run.
 * @param {DashboardApplication} application
 * @returns {HTMLElement}
 */
export function renderRunsTab(application) {
  const data = scopeData(application);
  const container = element("div", null, "runs-view");
  container.append(viewHead("Runs", scopeLabel(application, data)), renderRunsCards(data, application));
  for (const repositoryState of application.repositories.values()) {
    if (application.repositoryFilter !== "" && repositoryState.repository.id !== application.repositoryFilter) continue;
    renderRepositoryNotice(container, repositoryState, application);
  }

  const statuses = entryStatuses(data.entries);
  const count = (/** @type {string} */ filter) => filterEntries(data.entries, filter, statuses).length;
  const tableRegion = element("section", null, "region");
  tableRegion.setAttribute("aria-label", "Loaded runs");
  const toolbar = element("div", null, "toolbar");
  const limitField = element("span", null, "end");
  const limitLabel = /** @type {HTMLLabelElement} */ (element("label", "Per repository", "field"));
  limitLabel.htmlFor = "run-limit";
  const limit = /** @type {HTMLInputElement} */ (element("input", null, "input num run-limit"));
  limit.id = "run-limit";
  limit.type = "number";
  limit.min = "1";
  limit.max = "100";
  limit.value = String(application.limit);
  limit.dataset.control = "run-limit";
  limit.addEventListener("change", () => {
    try {
      application.limit = validatedLimit(limit.value);
      void trackedRefresh(application, () => refreshAll(application));
    } catch (error) {
      application.live.textContent = error instanceof Error ? error.message : String(error);
      limit.value = String(application.limit);
    }
  });
  limitField.append(limitLabel, limit);
  toolbar.append(chipGroup("Quick filters", "runs", [
    { value: "", label: "All", count: data.entries.length },
    { value: "blocked", label: "Blocked", count: count("blocked") },
    { value: "completed", label: "Completed", count: count("completed") },
    { value: "has-blocking", label: "Has blocking findings", count: count("has-blocking") },
  ], application.runFilter, (value) => { application.runFilter = value; render(application); }), limitField);
  tableRegion.append(toolbar);
  const selected = selectedEntry(application, data.entries);
  const shown = filterEntries(data.entries, application.runFilter, statuses);
  if (data.entries.length === 0) tableRegion.append(element("p", "No run is loaded in this scope.", "att-empty"));
  else if (shown.length === 0) tableRegion.append(element("p", "No loaded run matches this filter.", "att-empty"));
  else tableRegion.append(runTableNode(shown, statuses, application, "runs", selected, data.observedAt));
  tableRegion.append(element("div", data.portfolio.limitedScope
    ? `Latest ${application.limit} per repository · more runs exist beyond this limit; the read route does not report how many`
    : `Latest ${application.limit} per repository · every run within the limit is shown`, "region-foot"));
  container.append(tableRegion);

  if (selected !== null) container.append(renderRunView(application, selected.repositoryId, selected.runId));
  return container;
}

/**
 * One run: the header region, findings, commands, and the collapsed sections.
 * @param {DashboardApplication} application @param {string} repositoryId @param {number} runId
 */
function renderRunView(application, repositoryId, runId) {
  const container = element("div");
  container.dataset.runView = `${repositoryId}:${runId}`;
  const selected = application.repositories.get(repositoryId);
  if (selected === undefined) {
    container.append(callout("The selected repository is not configured.", "danger"));
    return container;
  }
  const slot = selected.snapshots.get(runId);
  const status = slot === undefined ? "" : resourceStatus(slot.resource);
  if (slot !== undefined && status !== "") {
    container.append(callout(status, slot.resource.stale ? "warning" : "danger"));
  }
  const snapshot = slot === undefined ? null : slotSnapshot(slot);
  if (snapshot === null) {
    if (slot?.loading === true) container.append(element("p", `Loading run ${runId}.`, "empty-state"));
    else if (status === "") container.append(element("p", `No snapshot has been observed for run ${runId}.`, "empty-state"));
    return container;
  }
  const observedAt = slot?.resource.envelope?.observedAt ?? null;
  const projection = snapshotProjection(snapshot, application.inventory?.cliPath ?? "", application.platform, observedAt);
  const summary = runExecutiveSummary(snapshot, {
    repositoryPath: selected.repository.path,
    runs: runSummaries(selected.runs),
    observedAt,
  });
  /** @type {RunContext} */
  const context = { snapshot, statuses: findingStatuses(snapshot), observedAt, repositoryId, path: selected.repository.path };
  const staleNote = slot !== undefined && slot.resource.stale && slot.resource.envelope !== null
    ? `Stale snapshot from ${slot.resource.envelope.observedAt}`
    : "";
  const delivery = projection.delivery;
  // Each collapsed line states how much it hides.
  const deliveryPaths = delivery.changedPaths.length + delivery.declaredPaths.length
    + delivery.deliveredPaths.length + delivery.missingPaths.length;
  container.append(
    renderExecutiveSummary(summary, projection, application, context),
    renderFindings(projection, application, context),
    renderCommands(projection, application, runId),
    collapsibleSection(plural(projection.charts.stages.length, "stage"), staleNote, () => renderCostAndTokens(projection),
      fragment(moneyNode(summary.cost.available ? projection.cost.knownUsd : null), " known")),
    collapsibleSection(plural(projection.stageViews.length, "stage"), staleNote, () => renderTimeline(projection), "recorded order"),
    collapsibleSection(plural(projection.activityItems.length, "event"), staleNote, () => renderActivity(projection), "latest first"),
    collapsibleSection(plural(snapshot.cost.byAgent.length, "agent"), staleNote, () => renderAgentAnalytics(snapshot, application),
      plural(projection.cost.agentRows, "execution")),
    collapsibleSection(plural(projection.governance.proposals.length, "proposal"), staleNote,
      () => renderConfiguration(projection, application), badge("Frozen at run start", "neutral")),
    collapsibleSection(plural(deliveryPaths, "path"), staleNote, () => renderDelivery(projection, application),
      deliveryPaths === 0 ? "no delivery recorded" : "declared and delivered"),
    collapsibleSection(plural(projection.evidence.length, "evidence reference"), staleNote, () => renderEvidence(projection)),
  );
  return container;
}

/** @type {string[]} */
const SEVERITY_CHIPS = ["critical", "high", "medium", "low"];

/**
 * The Findings view: status and severity chips over one table. Status comes
 * from `findingStatus` and severity from `cardSeverity`, never from the first
 * report's own severity.
 * @param {DashboardApplication} application
 * @returns {HTMLElement}
 */
export function renderFindingsTab(application) {
  const data = scopeData(application);
  const rows = data.entries.flatMap((entry) =>
    entry.snapshot === null ? [] : snapshotFindingRows(entry.repositoryId, entry.path, entry.snapshot)).sort(compareFindingRows);
  const counts = data.counts;
  /** @type {Map<string, number>} */
  const bySeverity = new Map();
  for (const row of rows) {
    const key = row.severity.available ? row.severity.severity ?? "unranked" : "unranked";
    bySeverity.set(key, (bySeverity.get(key) ?? 0) + 1);
  }
  const severities = [...SEVERITY_CHIPS, ...[...bySeverity.keys()].filter((key) => !SEVERITY_CHIPS.includes(key) && key !== "unranked").sort()];
  if (bySeverity.has("unranked")) severities.push("unranked");

  const container = element("div", null, "findings-view");
  const label = scopeLabel(application, data);
  label.append(" · ", element("strong", plural(rows.length, "finding")));
  container.append(viewHead("Findings", label));
  const section = element("section", null, "region");
  section.setAttribute("aria-label", "Findings in scope");
  const toolbar = element("div", null, "toolbar");
  const statusFilter = application.findingStatusFilter;
  const severityFilter = application.findingSeverityFilter;
  const severityChips = element("span", null, "end");
  severityChips.append(chipGroup("Severity", "finding-severity", [
    { value: "", label: "Any severity" },
    ...severities.map((key) => ({ value: key, label: readableIntent(key), count: bySeverity.get(key) ?? 0 })),
  ], severityFilter, (value) => { application.findingSeverityFilter = value; render(application); }));
  toolbar.append(chipGroup("Status", "finding-status", [
    { value: "", label: "All", count: rows.length },
    { value: "attention", label: "Require attention", count: counts.requireAttention },
    ...(/** @type {FindingStatus[]} */ (["blocking", "open", "non_blocking", "earlier_round", "addressed", "rejected"]))
      .map((key) => ({ value: key, label: FINDING_STATUS[key].label, count: counts[key] })),
  ], statusFilter, (value) => { application.findingStatusFilter = value; render(application); }), severityChips);
  section.append(toolbar);
  const shown = rows.filter((row) => {
    const statusMatch = statusFilter === "" ||
      (statusFilter === "attention" ? row.status === "blocking" || row.status === "open" : row.status === statusFilter);
    const severity = row.severity.available ? row.severity.severity ?? "unranked" : "unranked";
    return statusMatch && (severityFilter === "" || severity === severityFilter);
  });
  if (rows.length === 0) {
    section.append(element("p", data.snapshots.length === 0 && data.entries.length > 0
      ? "No loaded snapshot has been observed yet." : "No finding is recorded in this scope.", "att-empty"));
  } else if (shown.length === 0) {
    section.append(element("p", "No finding matches these filters.", "att-empty"));
  } else {
    section.append(findingTable(shown, "Findings in scope", "findings", application, true));
  }
  const foot = element("div", null, "region-foot");
  foot.append(element("span", `Showing ${shown.length} of ${rows.length}`));
  section.append(foot);
  container.append(section);
  return container;
}

/**
 * The run picker the run-scoped views share. It lists the scope's loaded runs
 * and names each by slug and path tail, never by repository identifier.
 * @param {DashboardApplication} application @param {ScopeEntry[]} entries
 * @param {{ repositoryId: string, runId: number } | null} selected @param {string} id
 */
function runPicker(application, entries, selected, id) {
  const wrapper = element("span", null, "view-actions");
  const label = /** @type {HTMLLabelElement} */ (element("label", "Run", "scope-label"));
  label.htmlFor = id;
  const select = /** @type {HTMLSelectElement} */ (element("select", null, "input"));
  select.id = id;
  select.dataset.runPicker = "";
  select.dataset.control = id;
  const options = entries.map((entry) => ({ repositoryId: entry.repositoryId, runId: entry.run.id, label: `${entry.run.slug} #${entry.run.id} · ${pathTail(entry.path)}` }));
  if (selected !== null && !options.some((option) => option.repositoryId === selected.repositoryId && option.runId === selected.runId)) {
    const state = application.repositories.get(selected.repositoryId);
    options.unshift({ ...selected, label: `Run #${selected.runId} · ${pathTail(state?.repository.path ?? "")}` });
  }
  for (const option of options) {
    const node = /** @type {HTMLOptionElement} */ (element("option", option.label));
    node.value = `${option.repositoryId}|${option.runId}`;
    node.selected = selected !== null && selected.repositoryId === option.repositoryId && selected.runId === option.runId;
    select.append(node);
  }
  select.disabled = options.length === 0;
  select.addEventListener("change", () => {
    const [repositoryId, runText] = select.value.split("|");
    if (repositoryId !== undefined && runText !== undefined) selectRun(application, repositoryId, Number(runText));
  });
  wrapper.append(label, select);
  return wrapper;
}

/**
 * The snapshot a run-scoped view reads, or the reason it has none.
 * @param {DashboardApplication} application @param {{ repositoryId: string, runId: number } | null} selected
 */
function runTarget(application, selected) {
  if (selected === null) return { snapshot: null, message: "No run is loaded in this scope.", state: undefined, observedAt: null };
  const state = application.repositories.get(selected.repositoryId);
  const slot = state?.snapshots.get(selected.runId);
  const snapshot = slot === undefined ? null : slotSnapshot(slot);
  const status = slot === undefined ? "" : resourceStatus(slot.resource);
  const message = snapshot !== null ? "" : slot?.loading === true ? `Loading run ${selected.runId}.`
    : status !== "" ? status : `No snapshot has been observed for run ${selected.runId}.`;
  return { snapshot, message, state, observedAt: slot?.resource.envelope?.observedAt ?? null };
}

/**
 * The Governance view: a categorical status, the policy checks, the
 * auditability timeline, and the frozen configuration. No score is computed.
 * @param {DashboardApplication} application
 * @returns {HTMLElement}
 */
export function renderGovernanceTab(application) {
  const data = scopeData(application);
  const selected = selectedEntry(application, data.entries);
  const container = element("div", null, "governance-view");
  container.append(viewHead("Governance", runPicker(application, data.entries, selected, "governance-picker")));
  const target = runTarget(application, selected);
  const snapshot = target.snapshot;
  if (snapshot === null || target.state === undefined) {
    container.append(element("p", target.message, "empty-state"));
    return container;
  }
  const projection = snapshotProjection(snapshot, application.inventory?.cliPath ?? "", application.platform, target.observedAt);
  const statuses = findingStatuses(snapshot);
  const segments = stageLedger(snapshot).segments;
  const gates = segments.filter((segment) => segment.gateResult !== null);
  const passed = gates.filter((segment) => segment.gateResult === "pass").length;
  const stopped = segments.findLast((segment) => segment.result === "blocked") ?? null;
  const [verdict, tone, short] = stopped !== null ? ["Blocked at a governed gate", "danger", "Blocked"]
    : snapshot.run.status === "completed" ? ["All recorded gates passed", "success", "Passed"]
      : ["No recorded gate has blocked", "active", "In progress"];
  const status = region("Governance status", {
    info: metricInfoButton("Governance status",
      "A category derived from recorded gate results. No score is computed: there is no scoring model, and missing evidence stays Not evaluated rather than counting as a pass."),
  });
  const line = element("div", null, "summary-line");
  line.append(badge(short, tone), element("span", verdict, "verdict"),
    element("span", `${passed} of ${plural(gates.length, "recorded stage gate")} passed${stopped === null ? "" : ` · stopped at ${stageLower(stopped.kind)}`}`, "muted"));
  const checks = element("ol", null, "checks");
  for (const check of governanceChecks(snapshot, statuses, target.observedAt)) {
    const item = element("li", null, "check");
    const [resultLabel, resultTone] = CHECK_RESULT[check.result];
    const result = element("span");
    result.append(badge(resultLabel, resultTone));
    item.append(element("span", check.label, "check-name"), result, element("span", check.evidence, "check-evidence"));
    checks.append(item);
  }
  status.append(line, checks);

  const groups = new Map(snapshot.cost.byStage.map((group) => [group.stageId, group]));
  const durations = new Map(segments.map((segment) => [segment.stageId, segment.durationMs]));
  const models = projection.governance.configuration.modelMap ?? {};
  const timeline = region("Auditability timeline", {
    count: plural(snapshot.stages.length, "stage"),
    sub: "Recorded order. Start is the stage-creation audit time when no start is recorded; the model is the frozen configuration's, per stage.",
  });
  /** @type {TableColumn<RunSnapshot["stages"][number]>[]} */
  const columns = [
    { label: "#", numeric: true, className: "muted", cell: (stage) => String(stage.id) },
    { label: "Stage", cell: (stage) => readableIntent(stage.kind) },
    {
      label: "Result",
      cell: (stage) => badge(stage.gateResult ?? stage.status,
        stage.gateResult === "block" ? "danger" : stage.gateResult === "pass" ? "success" : stage.status === "in_progress" ? "active" : "neutral"),
    },
    { label: "Started", className: "mono muted nowrap", cell: (stage) => shortTimeNode(stage.startedAt ?? stage.startEvidence.at) },
    { label: "Duration", numeric: true, cell: (stage) => duration(durations.get(stage.id) ?? null) },
    {
      label: "Agent runs", numeric: true,
      cell: (stage) => {
        const rows = groups.get(stage.id)?.agentRows ?? 0;
        return rows === 0 ? element("span", "none", "muted") : String(rows);
      },
    },
    { label: "Configured model", className: "mono muted", cell: (stage) => models[stage.kind] ?? "Not configured" },
  ];
  timeline.append(sortableTable({ caption: "Recorded stages with result, start, duration, agent runs, and configured model", key: "governance-timeline", rows: snapshot.stages, columns, application }));
  container.append(status, timeline,
    collapsibleSection(plural(projection.governance.proposals.length, "proposal"), "",
      () => renderConfiguration(projection, application), badge("Frozen at run start", "neutral")),
    element("p", `Known cost for this run is ${usdPresentation(snapshot.cost.costReportedRows === 0 ? null : snapshot.cost.knownUsd).display}; cost detail is under Models & agents.`, "note-line"));
  return container;
}

/**
 * The run as a one-repository view, for the scope-sized projections.
 * @param {DashboardApplication} application @param {string} repositoryId @param {RunSnapshot} snapshot
 * @returns {ReturnType<typeof repositoryViews>}
 */
function singleRunView(application, repositoryId, snapshot) {
  const state = application.repositories.get(repositoryId);
  const slot = state?.snapshots.get(snapshot.run.id);
  const summary = runSummaries(state?.runs ?? emptyResourceState()).find((run) => run.id === snapshot.run.id) ?? {
    id: snapshot.run.id, project: snapshot.run.project, featureId: snapshot.run.featureId, slug: snapshot.run.slug,
    status: snapshot.run.status, phase: snapshot.phase, lastRecordedAt: snapshot.activity.lastRecordedAt,
  };
  return [{
    repositoryId, path: state?.repository.path ?? "", available: true, runs: [summary], limit: null, hasMore: false,
    snapshots: [{ runId: snapshot.run.id, snapshot, stale: slot?.resource.stale ?? false, loading: false }],
  }];
}

/**
 * The Models & agents view: scoped hero cards, telemetry coverage, where cost,
 * tokens, and time went, and the agents table.
 * @param {DashboardApplication} application
 * @returns {HTMLElement}
 */
export function renderModelsTab(application) {
  const data = scopeData(application);
  const selected = selectedEntry(application, data.entries);
  const container = element("div", null, "models-view");
  container.append(viewHead("Models & agents", runPicker(application, data.entries, selected, "models-picker")));
  const target = runTarget(application, selected);
  const snapshot = target.snapshot;
  if (snapshot === null || selected === null) {
    container.append(element("p", target.message, "empty-state"));
    return container;
  }
  const name = `${snapshot.run.slug} #${snapshot.run.id}`;
  const { rows } = agentRows(snapshot);
  /** @type {Map<string, number>} */
  const roles = new Map();
  for (const row of rows) for (const role of row.roles) roles.set(role, (roles.get(role) ?? 0) + 1);
  const cards = element("div", null, "cards is-four");
  const views = singleRunView(application, selected.repositoryId, snapshot);
  const portfolio = portfolioProjection(views);
  cards.append(
    statusCard({
      label: `Agents · ${name}`, value: String(rows.length),
      breakdown: roles.size === 0 ? "no recorded role" : [...roles.entries()].map(([role, count]) => plural(count, role)).join(" · "),
    }),
    statusCard({ label: `Executions · ${name}`, value: String(snapshot.cost.agentRows), breakdown: "recorded agent rows" }),
    usagePair(tokensCard(portfolio.tokens, `Tokens · ${name}`),
      costCard({ knownUsd: portfolio.cost.knownUsd, reportedRows: portfolio.cost.reportedRows, agentRows: portfolio.cost.agentRows }, `Known cost · ${name}`)),
  );
  const coverage = region("Telemetry coverage", { count: name });
  coverage.append(coverageStrip(views));
  container.append(cards, coverage, renderStageUsage(snapshot, application, name), renderAgentTable(snapshot, application, name));
  return container;
}

/**
 * The Audit view: the audit status this read-only view can state, the full
 * ledger, recorded limitations, and evidence references.
 * @param {DashboardApplication} application
 * @returns {HTMLElement}
 */
export function renderAuditTab(application) {
  const data = scopeData(application);
  const selected = selectedEntry(application, data.entries);
  const container = element("div", null, "audit-view");
  container.append(viewHead("Audit", runPicker(application, data.entries, selected, "audit-picker")));
  const target = runTarget(application, selected);
  const snapshot = target.snapshot;
  if (snapshot === null) {
    container.append(element("p", target.message, "empty-state"));
    return container;
  }
  const projection = snapshotProjection(snapshot, application.inventory?.cliPath ?? "", application.platform, target.observedAt);
  const status = region("Audit status");
  const line = element("div", null, "summary-line");
  line.append(badge("Not verified in this view", "neutral"),
    element("span", "This dashboard reads the record; only verify-audit recomputes the audit chain.", "muted"));
  const verify = projection.governance.commands.find((command) => command.kind === "verify-audit") ?? null;
  if (verify !== null) {
    const actions = element("span", null, "view-actions");
    actions.append(copyControl("Copy verify-audit command", verify.text, "verify-audit command", application));
    line.append(actions);
  }
  status.append(line);
  const ledger = region("Workflow timeline", { count: plural(snapshot.stages.length, "stage") });
  ledger.append(stageLedgerNode(snapshot, true, false));
  const limitations = region("Recorded limitations", { count: String(snapshot.limitations.length) });
  if (snapshot.limitations.length === 0) {
    limitations.append(element("p", "No recorded limitations.", "att-empty"));
  } else {
    const list = element("ul", null, "region-body limitation-list");
    for (const limitation of snapshot.limitations) list.append(element("li", limitation, "muted"));
    limitations.append(list);
  }
  container.append(status, ledger, limitations,
    collapsibleSection(plural(projection.evidence.length, "evidence reference"), "", () => renderEvidence(projection)));
  return container;
}

/* ------------------------------------------------------------------ *
 * Refresh orchestration
 * ------------------------------------------------------------------ */

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
 * snapshot through the existing status route. No socket, mutation method, or
 * server-side cache is involved; the only timer is `scheduleAutoRefresh`.
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

/**
 * What a re-render would change, per repository and per held snapshot: the
 * run-list outcome, and each snapshot's staleness, writer status, latest
 * activity, and stage results.
 * @param {DashboardApplication} application
 */
function observationSignatures(application) {
  /** @type {Map<string, string>} */
  const signatures = new Map();
  for (const [repositoryId, state] of application.repositories) {
    signatures.set(repositoryId, `${state.runs.errorCode ?? "ok"}|${state.runs.stale}`);
    for (const [runId, slot] of state.snapshots) {
      const snapshot = slotSnapshot(slot);
      signatures.set(`${repositoryId}:${runId}`, snapshot === null
        ? `absent|${slot.resource.errorCode ?? "none"}`
        : [slot.resource.stale, snapshot.writer.status, snapshot.activity.lastRecordedAt,
          snapshot.stages.map((stage) => `${stage.id}:${stage.status}:${stage.gateResult ?? "none"}`).join(",")].join("|"));
    }
  }
  return signatures;
}

/**
 * One auto-refresh tick (ARCHITECTURE.md section 23, 2026-09-24): re-read every
 * run list, then only the snapshots `autoRefreshPlan` names. The runs that
 * changed are highlighted in the render that follows, and only in that one.
 * When nothing changed, only the header is refreshed, so an open disclosure
 * is not collapsed every interval.
 * @param {DashboardApplication} application
 */
async function refreshChanged(application) {
  const generation = ++application.refreshGeneration;
  const requestedLimit = application.limit;
  const previous = repositoryViews({ repositories: application.repositories });
  const before = observationSignatures(application);
  await Promise.all([...application.repositories.values()]
    .map((repository) => refreshRuns(application, repository, generation, requestedLimit)));
  if (generation !== application.refreshGeneration || requestedLimit !== application.limit) return;
  if (application.sessionExpired) {
    render(application);
    return;
  }
  /** @type {Promise<void>[]} */
  const pending = [];
  for (const repository of application.repositories.values()) {
    const held = [...repository.snapshots.entries()].map(([runId, slot]) => ({
      runId, snapshot: slotSnapshot(slot), stale: slot.resource.stale, loading: slot.loading,
    }));
    for (const runId of autoRefreshPlan(held, runSummaries(repository.runs))) {
      pending.push(refreshSlot(application, repository, runId, generation));
    }
  }
  await Promise.all(pending);
  if (generation !== application.refreshGeneration) return;
  const changed = changedRuns(previous, repositoryViews({ repositories: application.repositories }));
  const after = observationSignatures(application);
  const differs = changed.length > 0 || before.size !== after.size ||
    [...after].some(([key, signature]) => before.get(key) !== signature);
  if (!differs) {
    renderChrome(application);
    return;
  }
  application.justUpdated = new Set(changed);
  render(application);
  application.justUpdated = new Set();
}

/**
 * Arm the single auto-refresh timer, replacing any armed one. It stays unarmed
 * while the operator's toggle is off, the page is hidden, the session has
 * expired, or a refresh is outstanding; `trackedRefresh` re-arms it once the
 * outstanding refresh settles, so two reads never overlap.
 * @param {DashboardApplication} application
 */
function scheduleAutoRefresh(application) {
  if (application.refreshTimer !== null) clearTimeout(application.refreshTimer);
  application.refreshTimer = null;
  if (!application.autoRefresh || application.sessionExpired || application.refreshing > 0 ||
      document.visibilityState !== "visible") return;
  application.refreshTimer = setTimeout(() => {
    application.refreshTimer = null;
    void trackedRefresh(application, () => refreshChanged(application));
  }, AUTO_REFRESH_INTERVAL_MS);
}

/**
 * Run one refresh with the timer disarmed, then re-arm it after the refresh
 * settles, whether it succeeded, was superseded, or expired the session. The
 * header shows the request in flight for exactly that span.
 * @param {DashboardApplication} application @param {() => Promise<void>} work
 */
async function trackedRefresh(application, work) {
  application.refreshing += 1;
  if (application.refreshTimer !== null) clearTimeout(application.refreshTimer);
  application.refreshTimer = null;
  renderChrome(application);
  try {
    await work();
  } finally {
    application.refreshing -= 1;
    renderChrome(application);
    scheduleAutoRefresh(application);
  }
}

/**
 * The route for the current state: a selected run names its repository and
 * run; otherwise the route carries the header scope.
 * @param {DashboardApplication} application
 */
function routeFor(application) {
  return application.selectedRunId === null
    ? routeHash(application.repositoryFilter === "" ? null : application.repositoryFilter, null, application.currentTab)
    : routeHash(application.selectedRepositoryId, application.selectedRunId, application.currentTab);
}

/**
 * Apply a parsed route. A route without a run is a scope; a route with a run
 * is a selection viewed across all repositories.
 * @param {DashboardApplication} application @param {ReturnType<typeof parseRoute>} route
 */
function applyRoute(application, route) {
  application.currentTab = route.tab;
  if (route.runId === null || route.repositoryId === null) {
    application.repositoryFilter = route.repositoryId !== null && application.repositories.has(route.repositoryId) ? route.repositoryId : "";
    application.selectedRepositoryId = null;
    application.selectedRunId = null;
  } else {
    application.repositoryFilter = "";
    application.selectedRepositoryId = route.repositoryId;
    application.selectedRunId = route.runId;
  }
}

/**
 * Select one run. Selecting a run outside the header scope returns the scope
 * to all repositories rather than hiding the run.
 * @param {DashboardApplication} application @param {string} repositoryId @param {number} runId
 */
function selectRun(application, repositoryId, runId) {
  if (application.repositoryFilter !== "" && application.repositoryFilter !== repositoryId) {
    application.repositoryFilter = "";
    const filterEl = document.querySelector("#repository-filter");
    if (filterEl instanceof HTMLSelectElement) filterEl.value = "";
  }
  application.selectedRepositoryId = repositoryId;
  application.selectedRunId = runId;
  history.replaceState(null, "", routeFor(application));
  render(application);
  void refreshSelected(application);
}

/** Bring one run-view region into view and give it focus. @param {string} id */
function focusRunSection(id) {
  const target = document.getElementById(id);
  if (target === null) return;
  target.scrollIntoView({ block: "start" });
  target.focus({ preventScroll: true });
}

/**
 * Open a run in the Runs view, optionally at its findings.
 * @param {DashboardApplication} application @param {string} repositoryId @param {number} runId
 * @param {boolean} [atFindings]
 */
function openRun(application, repositoryId, runId, atFindings = false) {
  application.currentTab = "runs";
  updateTabUI("runs");
  selectRun(application, repositoryId, runId);
  focusRunSection(atFindings ? "run-findings" : "run-summary");
}

/** @param {string} tab */
export function updateTabUI(tab) {
  const tabButtons = document.querySelectorAll('.tabs-nav button[role="tab"]');
  for (const btn of tabButtons) {
    const isSelected = btn.getAttribute("data-tab") === tab;
    btn.setAttribute("aria-selected", isSelected ? "true" : "false");
    if (btn instanceof HTMLElement) btn.tabIndex = isSelected ? 0 : -1;
  }
}

/** @param {DashboardApplication} application @param {string} tab */
export function switchTab(application, tab) {
  if (!ALLOWED_TABS.includes(tab)) return;
  application.currentTab = tab;
  history.replaceState(null, "", routeFor(application));
  updateTabUI(tab);
  render(application);
}

/** @param {HTMLInputElement} input @param {HTMLElement} results */
function closeSearch(input, results) {
  results.hidden = true;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

/**
 * Unified search over the scope's loaded runs, findings, and agents, grouped
 * and at most six per group. Returns each option's activation, in order.
 * @param {DashboardApplication} application @param {HTMLInputElement} input @param {HTMLElement} results
 * @returns {(() => void)[]}
 */
function renderSearch(application, input, results) {
  results.replaceChildren();
  input.removeAttribute("aria-activedescendant");
  const query = input.value.trim();
  if (query === "") {
    closeSearch(input, results);
    return [];
  }
  const views = scopeViews(application);
  const matches = searchMatches(searchIndex(views), query);
  const tails = new Map(views.map((view) => [view.repositoryId, pathTail(view.path)]));
  /** @type {(() => void)[]} */
  const activations = [];
  /** @param {string} name @param {{ label: string, meta: string, activate: () => void }[]} entries */
  const group = (name, entries) => {
    if (entries.length === 0) return;
    const head = element("div", name, "search-group");
    head.setAttribute("role", "presentation");
    results.append(head);
    for (const entry of entries.slice(0, 6)) {
      const option = element("div", null, "search-option");
      option.id = `search-option-${activations.length}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.append(element("span", entry.label, "label"), element("span", entry.meta, "meta"));
      const activate = () => {
        closeSearch(input, results);
        entry.activate();
      };
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        activate();
      });
      activations.push(activate);
      results.append(option);
    }
  };
  group("Runs", matches.runs.map((run) => ({
    label: `${run.label} #${run.runId}`, meta: `${tails.get(run.repositoryId) ?? ""} · ${run.detail}`,
    activate: () => openRun(application, run.repositoryId, run.runId),
  })));
  group("Findings", matches.findings.map((finding) => ({
    label: `${finding.label} #${finding.findingId}`, meta: `run #${finding.runId} · ${finding.detail}`,
    activate: () => openFindingById(application, finding.repositoryId, finding.runId, finding.findingId, input),
  })));
  group("Agents", matches.agents.map((agent) => ({
    label: agent.label, meta: `${agent.detail || "no recorded role"} · run #${agent.runId} · ${tails.get(agent.repositoryId) ?? ""}`,
    activate: () => {
      application.currentTab = "models";
      updateTabUI("models");
      selectRun(application, agent.repositoryId, agent.runId);
      application.main.focus();
    },
  })));
  if (activations.length === 0) {
    results.append(element("div", application.repositoryFilter === ""
      ? "Nothing in the loaded runs matches." : "Nothing in this repository matches.", "search-empty"));
  }
  results.hidden = false;
  input.setAttribute("aria-expanded", "true");
  return activations;
}

/**
 * Set the theme and keep the browser chrome colour in step with it.
 * @param {"light" | "dark"} theme @param {HTMLButtonElement} button
 */
function applyTheme(theme, button) {
  document.documentElement.dataset.theme = theme;
  const next = theme === "dark" ? "light" : "dark";
  button.setAttribute("aria-label", `Switch to ${next} theme`);
  button.title = `Switch to ${next} theme`;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", theme === "dark" ? "#121316" : "#ffffff");
  }
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
    selectedRepositoryId: null,
    selectedRunId: null,
    currentTab: "overview",
    limit: 20,
    repositoryFilter: "",
    runFilter: "",
    recentFilter: "",
    attentionFilter: "",
    findingStatusFilter: "",
    findingSeverityFilter: "",
    blockingOnly: false,
    sorts: new Map(),
    sessionExpired: false,
    refreshGeneration: 0,
    inFlight: new Set(),
    autoRefresh: true,
    refreshing: 0,
    refreshTimer: null,
    justUpdated: new Set(),
    platform: navigator.userAgent.includes("Windows") ? "win32" : "posix",
    main,
    live,
  };
  applyRoute(application, parseRoute(window.location.hash));
  updateTabUI(application.currentTab);

  const tabButtons = Array.from(document.querySelectorAll('.tabs-nav button[role="tab"]'));
  tabButtons.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) switchTab(application, tab);
    });
    btn.addEventListener("keydown", (e) => {
      if (e instanceof KeyboardEvent) {
        let targetIndex = -1;
        if (e.key === "ArrowRight") targetIndex = (index + 1) % tabButtons.length;
        else if (e.key === "ArrowLeft") targetIndex = (index - 1 + tabButtons.length) % tabButtons.length;
        else if (e.key === "Home") targetIndex = 0;
        else if (e.key === "End") targetIndex = tabButtons.length - 1;
        if (targetIndex >= 0) {
          e.preventDefault();
          const targetBtn = /** @type {HTMLButtonElement} */ (tabButtons[targetIndex]);
          targetBtn.focus();
          const targetTab = targetBtn.getAttribute("data-tab");
          if (targetTab) switchTab(application, targetTab);
        }
      }
    });
  });

  const helpTrigger = document.querySelector("#help-trigger");
  const shortcutsDialog = document.querySelector("#shortcuts-dialog");
  const shortcutsClose = document.querySelector("#shortcuts-close");
  if (helpTrigger instanceof HTMLButtonElement && shortcutsDialog instanceof HTMLDialogElement) {
    helpTrigger.addEventListener("click", () => {
      shortcutsDialog.showModal();
    });
  }
  if (shortcutsClose instanceof HTMLButtonElement && shortcutsDialog instanceof HTMLDialogElement) {
    shortcutsClose.addEventListener("click", () => {
      shortcutsDialog.close();
    });
  }

  const repositoryFilter = document.querySelector("#repository-filter");
  const search = document.querySelector("#run-search");
  const results = document.querySelector("#search-results");
  const refresh = document.querySelector("#refresh");
  const theme = document.querySelector("#theme");
  const shortcuts = document.querySelector("#shortcuts-enabled");
  if (repositoryFilter instanceof HTMLSelectElement) {
    const all = repositoryFilter.options[0];
    if (all !== undefined) all.textContent = `All repositories (${inventory.repositories.length})`;
    for (const repository of inventory.repositories) {
      const option = document.createElement("option");
      option.value = repository.id;
      option.textContent = pathTail(repository.path);
      option.title = repository.path;
      repositoryFilter.append(option);
    }
    repositoryFilter.value = application.repositoryFilter;
    repositoryFilter.addEventListener("change", () => {
      application.repositoryFilter = repositoryFilter.value;
      if (application.repositoryFilter !== "" && application.selectedRepositoryId !== application.repositoryFilter) {
        application.selectedRepositoryId = null;
        application.selectedRunId = null;
      }
      history.replaceState(null, "", routeFor(application));
      render(application);
    });
  }
  if (search instanceof HTMLInputElement && results instanceof HTMLElement) {
    /** @type {(() => void)[]} */
    let activations = [];
    let active = -1;
    /** @param {number} index */
    const highlight = (index) => {
      const options = results.querySelectorAll(".search-option");
      options.forEach((option, position) => option.setAttribute("aria-selected", String(position === index)));
      active = index;
      const current = options[index];
      if (current !== undefined) {
        search.setAttribute("aria-activedescendant", current.id);
        current.scrollIntoView({ block: "nearest" });
      }
    };
    search.addEventListener("input", () => {
      activations = renderSearch(application, search, results);
      active = -1;
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && activations.length > 0) {
        event.preventDefault();
        highlight((active + 1) % activations.length);
      } else if (event.key === "ArrowUp" && activations.length > 0) {
        event.preventDefault();
        highlight((active - 1 + activations.length) % activations.length);
      } else if (event.key === "Enter" && active >= 0) {
        event.preventDefault();
        activations[active]?.();
      } else if (event.key === "Escape") {
        closeSearch(search, results);
      }
    });
    search.addEventListener("blur", () => closeSearch(search, results));
  }
  if (refresh instanceof HTMLButtonElement) {
    refresh.addEventListener("click", () => void trackedRefresh(application, () => refreshAll(application)));
  }
  const autoRefresh = document.querySelector("#auto-refresh");
  if (autoRefresh instanceof HTMLButtonElement) {
    autoRefresh.setAttribute("aria-pressed", String(application.autoRefresh));
    autoRefresh.addEventListener("click", () => {
      application.autoRefresh = !application.autoRefresh;
      autoRefresh.setAttribute("aria-pressed", String(application.autoRefresh));
      live.textContent = application.autoRefresh
        ? `Auto-refresh on: every ${AUTO_REFRESH_INTERVAL_MS / 1000} seconds while this page is visible.`
        : "Auto-refresh off. Refresh reloads on demand.";
      scheduleAutoRefresh(application);
      renderChrome(application);
    });
  }
  document.addEventListener("visibilitychange", () => {
    scheduleAutoRefresh(application);
    renderChrome(application);
  });
  if (theme instanceof HTMLButtonElement) {
    const saved = sessionStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") applyTheme(saved, theme);
    theme.addEventListener("click", () => {
      const current = document.documentElement.dataset.theme
        ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      sessionStorage.setItem(THEME_KEY, next);
      applyTheme(next, theme);
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
    if (shortcutsDialog instanceof HTMLDialogElement && shortcutsDialog.open) return;
    if (document.body.classList.contains("modal-open")) return;
    const disabled = shortcuts instanceof HTMLInputElement && !shortcuts.checked;
    const editable = isEditableTarget(event.target);
    const first = pendingG ? "g" : event.key;
    const second = pendingG ? event.key.toLowerCase() : null;
    const destination = shortcutDestination(first, second, editable, disabled);
    pendingG = !pendingG && !disabled && !editable && event.key.toLowerCase() === "g";
    if (destination === null) return;
    pendingG = false;
    event.preventDefault();
    if (destination === "shortcuts") {
      if (shortcutsDialog instanceof HTMLDialogElement) shortcutsDialog.showModal();
      return;
    }
    if (destination === "run-search") {
      if (search instanceof HTMLInputElement) search.focus();
      return;
    }
    switchTab(application, destination);
    main.focus();
  });
  window.addEventListener("hashchange", () => {
    const next = parseRoute(window.location.hash);
    applyRoute(application, next);
    if (repositoryFilter instanceof HTMLSelectElement) {
      repositoryFilter.value = application.repositoryFilter;
    }
    updateTabUI(application.currentTab);
    render(application);
    if (application.selectedRepositoryId !== null && application.selectedRunId !== null &&
        application.repositories.has(application.selectedRepositoryId)) {
      void refreshSelected(application);
    }
  });
  await trackedRefresh(application, () => refreshAll(application));
}

if (typeof document !== "undefined") void startBrowserApplication();
