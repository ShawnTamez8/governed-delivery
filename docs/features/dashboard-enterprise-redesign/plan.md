# Dashboard Enterprise Redesign Implementation Plan

**Status:** Implemented

**Goal:** Replace the dashboard's diagnostic JSON presentation with an accessible, executive-friendly enterprise control plane while preserving the existing authoritative read model and read-only security boundary.

**Source:** `.claude/sessions/2026-09-12-requirements-dashboard-enterprise-redesign.md`, the dashboard authorization in `ARCHITECTURE.md` section 23, and the first-release data and governance boundaries recorded in `docs/features/dashboard/design.md`.

**Hazards considered:** 2 requires showing projected evidence availability without exposing or reconstructing raw provider output; 4 requires metric, finding, and chart expectations to come from real `Store` rows and `RunSnapshot` results rather than hand-written dashboard fixtures, plus mutation proof for the new guards; 10 requires preserving exact recorded model strings and showing agent-level model as unavailable rather than deriving aliases; 12 requires every aggregate, command, and detail view to retain repository-specific configuration and identity; 14 requires displaying recorded reviewer identity without strengthening it into an independence claim; and 18 requires completed, verified, and reviewed states to remain evidence labels rather than claims of product correctness.

**Assumptions:** The new requirements supersede only the conflicting visual guidance in `docs/features/dashboard/design.md` sections 21.2 and 21.5; the document's authorization, source-of-truth, missing-data, and read-only rules remain binding. Portfolio KPIs ignore display filters and cover the loaded 1-100 run window from every configured repository. A retained paid-run target may be used read-only for current browser acceptance, but implementation and automated verification cannot depend on that temporary path. No paid invocation is authorized.

**Approach:** Keep `RunSnapshot`, the authenticated HTTP routes, and persistence unchanged. Add one browser-native, strictly checked `dashboard-model.js` module for pure aggregation and presentation rules; keep authentication, routing, refresh orchestration, and safe DOM construction in `app.js`. Replace the single selected-snapshot slot with repository-scoped run-keyed slots so one explicit refresh can load every in-window snapshot through the existing status route without cross-run reuse. Render semantic HTML and native SVG from those projections, preserve complete arrays and coverage metadata, and show unsupported agent duration, agent model, and historical trends as unavailable.

**Affected areas:** Browser state and rendering, one new allowlisted static JavaScript module, the dashboard DOM shell and CSS design system, dashboard UI/server tests, the DOM-enabled TypeScript program, and README dashboard guidance. No migration, persisted schema, core `RunSnapshot`, CLI command behavior, policy, executor, provider, or mutation route changes.

**Known blockers:** No unresolved implementation blocker. Verified constraints shape the result: `RunSnapshot` has no agent-duration aggregate, agent-to-model binding, or historical series; the existing HTTP server performs synchronous repository reads; the repository has no DOM test runner or browser automation dependency; and the retained rich paid-run target under `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1789245101665\target` is currently present but subject to host cleanup. The first three constraints require explicit unavailable states, bounded 1-100-per-repository loading, pure projection tests, and manual browser observation. The temporary target cannot justify another paid run if it disappears.

**Blast radius:** `src/dashboard/index.html` loads `/app.js` and `/styles.css`; `src/dashboard-server.ts` is their only runtime server and holds the exact static allowlist. `src/dashboard/app.js` is imported only by `test/dashboard-ui.test.ts` and loaded only by the dashboard HTML; its API calls target the existing inventory, run-list, and status routes in `src/dashboard-server.ts`. `test/dashboard-ui.test.ts` also reads all three static assets directly. `tsconfig.dashboard.json` currently checks `app.js` and that UI test together, while `tsconfig.json` excludes the DOM-dependent test. `src/operator-read.ts` supplies the unchanged `OperatorResult` envelopes, and `src/operator-state.ts` remains the sole `RunSnapshot` contract. `README.md` sections "Launch the read-only dashboard" and "Output contracts and refusal handling" describe the operator-visible behavior. No other repository file imports the browser module or serves the dashboard assets.

**Verification:** Build source-derived projection tests from temporary `Store` rows and the existing recorded Claude envelope, exercise refresh identity and stale behavior with Node's test runner, retain the server's transport-boundary tests, run both TypeScript programs and the full suite, run the documentation checker, prove the critical new guards through isolated mutations with exact restoration, and manually inspect light/dark, keyboard, chart, large-array, stale, and 320-pixel behavior without provider spend.

---

## Frontend boundaries and data flow

The redesign keeps four concrete layers:

1. `src/dashboard-server.ts` serves an exact static allowlist and the unchanged
   authenticated read routes.
2. `src/dashboard/app.js` owns token bootstrap, route state, per-request
   generations, repository/run snapshot caches, refresh orchestration, event
   handlers, and safe DOM construction.
3. `src/dashboard/dashboard-model.js` owns pure metric definitions, formatting
   inputs, shell-safe command text, status presentation, chart series,
   finding/report grouping, and recorded activity derivation.
4. `src/dashboard/index.html` and `src/dashboard/styles.css` provide the semantic
   shell and one CSS-variable-driven visual system.

The browser obtains run summaries first, then requests one existing status
route per run in each current loaded window. A repository's snapshot cache is
keyed by its opaque repository ID and then run ID. Aggregates iterate only the
current run summaries, so cached runs outside the active limit never contribute.
Every snapshot slot retains its own request generation, loading state, exact
requested run ID, last complete envelope, stale flag, and current refusal.
Because the run-list contract exposes only `hasMore`, not a total row count,
the aggregate can report that its scope is limited but never invent how many
runs are outside the window.

No dashboard layer reads SQLite, Git, evidence files, or raw provider output
directly. No new HTTP endpoint, batch contract, schema field, or server cache is
introduced.

## Requirements coverage

| Requirement | Plan coverage |
|---|---|
| Eight portfolio KPIs with bounded scope and coverage | Tasks 1-3 |
| Unavailable success denominator, duration, and trends handled honestly | Tasks 1 and 3 |
| Structured selected-run view with no visible JSON | Tasks 4-6 |
| Authoritative status and phase vocabulary | Tasks 1, 3, and 4 |
| Ordered responsive workflow timeline | Task 4 |
| Cost, token, agent charts with accessible equivalents | Task 5 |
| Partial and missing telemetry never shown as zero | Tasks 1, 3, and 5 |
| Immutable reports preserved within canonical finding cards | Tasks 1 and 6 |
| Agent analytics without invented model or trend data | Tasks 1 and 5 |
| Partial recorded activity feed | Tasks 1 and 4 |
| Copy-only Status, Doctor, Verify Audit, and governed handoffs | Task 6 |
| Same-run stale preservation and cross-run isolation | Task 2 |
| Light, dark, forced-color, reduced-motion, keyboard, and narrow layouts | Task 7 |
| Browser checkJs remains separate from the Node program | Tasks 1 and 8 |
| Loopback, bearer, GET-only, no-persistence boundary | Tasks 1, 2, 6, and 8 |

## Tasks

### Task 1: Establish the typed presentation model

**Depends on:** None

**Files:**
- Create: `src/dashboard/dashboard-model.js`
- Modify: `src/dashboard/app.js` — type imports and projection helpers
- Modify: `src/dashboard-server.ts` — exact static allowlist
- Modify: `test/dashboard-server.test.ts` — static-module boundary
- Modify: `test/dashboard-ui.test.ts` — source-derived projection contracts
- Modify: `tsconfig.dashboard.json` — checked browser module set

**Steps:**

- **Step 1: Add failing source-derived model tests**
  - Change: Extend `test/dashboard-ui.test.ts` with temporary repositories populated through `Store`, `readRunsResult`, and `readStatusResult`. Derive agent telemetry from `test/fixtures/harness/claude-code-envelope.json` through `parseEnvelope` and `CLAUDE_CODE`, following `test/operator-state.test.ts`; do not hand-author a `RunSnapshot` as the correctness oracle. Cover duplicate run IDs in different repositories, completed/blocked/in-progress summaries, reported and unreported cost/token rows, multiple immutable reports on one finding, a recorded decision, absent timing, absent agent-level model, stage timestamps, and a latest audit event.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: New imports or assertions fail before the model exists while the existing token, route, refresh, command, and large-finding assertions remain intact.

- **Step 2: Implement pure, authoritative transformations**
  - Change: Add `dashboard-model.js` with exported `portfolioProjection`, `snapshotProjection`, `statusPresentation`, `tokenTotal`, `costChartSeries`, `activityItems`, and `commandText` functions. Move the existing `shellQuote` and `commandText` implementation into this module so `snapshotProjection` can format projected actions without importing back from `app.js`; update the UI test import accordingly. Use JSDoc type-only imports from `operator-output.ts` and `operator-state.ts`. Define portfolio counts and success rate exactly as the requirements specify; include fresh, stale, pending, and unavailable snapshot counts plus a boolean limited-scope signal derived from repository `hasMore`. Never report an out-of-window count because the API does not supply one. Treat cost as unavailable when no contributing row reports cost. Sum only reported input, output, cache-read, and cache-write values, name those classes, and carry each class's coverage. Return a neutral `trend_unavailable` state and an unavailable agent-duration value. Map badge labels only to authoritative persisted values or the two exceptional derived phases. Group finding reports without collapsing severity, classification, reviewer, or subject. Parse `decision.changed_locations` and nullable `decision.normative_changes` only as JSON arrays of strings; on malformed stored text, return a named unavailable field and do not expose the serialized string as presentation content.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Pure tests prove formulas, inclusion/exclusion, unavailable states, stable ordering, repository/run isolation, and preservation of every report and coverage count.

- **Step 3: Wire the browser-native module without broadening static access**
  - Change: Import the pure transformations and `commandText` from `dashboard-model.js` in `app.js`; remove the superseded local `shellQuote`, `commandText`, and `snapshotProjection` implementations after callers move. Add only `/dashboard-model.js` to the fixed asset map in `dashboard-server.ts`, served as JavaScript with the existing security headers. Change `tsconfig.dashboard.json` to include `src/dashboard/*.js` and `test/dashboard-ui.test.ts` while retaining `exclude: []`, DOM libraries, strict `checkJs`, and no emit. Do not change the primary `tsconfig.json`, package scripts, CSP, API routes, or arbitrary-path refusal.
  - Verify: `node --test test/dashboard-server.test.ts test/dashboard-ui.test.ts`; `npm run typecheck`
  - Expected: The new module loads through the exact allowlist, unlisted files still return 404, all browser modules and the UI test are checked together, and DOM globals remain absent from the primary Node program.

**Task completion evidence:** Real-store projections establish every metric and unavailable state without a hand-written snapshot, and the new concrete browser module is both allowlisted and type-checked.

### Task 2: Load portfolio snapshots without identity or freshness drift

**Depends on:** Task 1

**Files:**
- Modify: `src/dashboard/app.js` — `RepositoryState`, `DashboardApplication`, `refreshSnapshot`, and `refreshAll`
- Modify: `test/dashboard-ui.test.ts` — run-keyed state and request-generation cases
- Validate: `test/dashboard-server.test.ts`

**Steps:**

- **Step 1: Replace the single selected-run slot with run-keyed slots**
  - Change: Define each repository state with `snapshots: Map<number, SnapshotSlot>`, where each slot contains `resource`, `requestId`, and `loading`. Keep the map inside its repository state so identical numeric run IDs in different repositories cannot collide. Reuse `emptyResourceState(runId)` and `applyRefresh(..., runId)` for each slot. When a run list changes, aggregate only IDs in that list; retain at most those slots plus the currently selected direct-linked run so changing the limit cannot create an unbounded client cache.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Tests prove two repositories may both expose run 1 without sharing state, an out-of-window cached run does not affect KPIs, and a direct-linked selected run remains renderable without joining the portfolio aggregate.

- **Step 2: Add generation-safe portfolio refresh**
  - Change: Add an application-level refresh generation and a per-slot request generation. `refreshAll` first refreshes every run list, verifies that generation is still current, creates pending slots for every run in each successful or retained stale list, renders the pending coverage, and requests the existing authenticated status URL once per in-window run. A newer refresh, changed limit, or newer selected-run request must make every superseded response a no-op. Reuse the prior complete same-run envelope on refusal and label it stale; a refusal with no prior complete envelope remains unavailable. Any 401 expires the session, while other repositories and runs retain their independent results.
  - Verify: `node --test test/dashboard-ui.test.ts test/dashboard-server.test.ts`
  - Expected: Tests cover out-of-order run lists, out-of-order status responses, limit changes, same-run stale retention, no cross-run replacement, partial repository failure, and 401-only session expiry.

- **Step 3: Reuse the cache for selection without weakening explicit refresh**
  - Change: Render a selected run immediately from its same-repository cached complete snapshot, then issue a current status request unless that run is already part of the active `refreshAll` generation. Run selection and hash changes must address the repository/run slot directly. Manual Refresh reloads both run lists and all in-window snapshots; no timer, polling, WebSocket, mutation method, or server-side cache is added.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: A selected run appears without another run's content, a current fetch can replace it, a failed current fetch marks only that run stale, and duplicate or superseded requests cannot overwrite newer state.

**Task completion evidence:** The browser can derive portfolio-wide snapshot-backed metrics from the loaded window while preserving the existing refusal, stale, token-expiry, and exact-run identity rules.

### Task 3: Build the enterprise shell, portfolio, and KPI bar

**Depends on:** Tasks 1 and 2

**Files:**
- Modify: `src/dashboard/index.html` — product shell and control landmarks
- Modify: `src/dashboard/app.js` — portfolio and KPI rendering
- Modify: `src/dashboard/styles.css` — shell, cards, filters, and portfolio table
- Modify: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Rework the static semantic shell**
  - Change: Preserve the skip link, `header`, filter `nav`, live region, `main`, footer, existing control IDs, and external module entry point. Reorganize the header into product identity, read-only environment label, refresh, and theme controls. Keep repository, limit, persisted-status, phase, and search filters in a labeled filter surface. Keep the shortcut reference and session-scoped disable control accessible without making shortcuts the only navigation path.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Static assertions find all existing selectors and landmarks plus the product/environment hierarchy; token bootstrap and event wiring require no alternate selectors.

- **Step 2: Render the eight loaded-portfolio KPI cards**
  - Change: Render Runs, Blocked Runs, Active Runs, Findings, Known Cost, Total Tokens, Success Rate, and Average Execution Time before the repository portfolio. Give each card a visible label, inline SVG icon, primary value or unavailable label, scope/coverage text, and neutral "Trend unavailable" indicator. Counts and success rate come from current run summaries; findings, cost, and tokens come only from current run IDs with complete snapshot envelopes. Include stale snapshot count and repository `hasMore` disclosure. Keep Average Execution Time unavailable because `RunSnapshot` has no agent duration. Display full values accessibly even when visual formatting abbreviates large token counts.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Tests cover zero runs, no terminal denominator, mixed terminal states, partial snapshots, stale snapshots, all-unreported cost, partial token classes, multiple repositories, and hidden out-of-window cache entries.

- **Step 3: Modernize repository and run selection**
  - Change: Keep every configured repository, submitted path, canonical path, envelope observation time, refusal, run limit, and `hasMore` state visible. Render run rows with authoritative status/phase badges, last activity through a `<time datetime>` element, and a descriptive "View run N" button. Mark the selected row with `aria-current`. Apply filters only to the visible run table; KPI scope remains the full loaded window and says so explicitly.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Empty, unavailable, stale, filtered, selected, and over-limit portfolio states remain distinguishable without raw JSON or cross-repository suppression.

**Task completion evidence:** The first viewport presents an executive-readable eight-card health summary and structured repository inventory with honest scope and coverage.

### Task 4: Render run summary, workflow, and recorded activity

**Depends on:** Tasks 1 through 3

**Files:**
- Modify: `src/dashboard/app.js` — selected-run summary, stage timeline, activity feed, and limitations
- Modify: `src/dashboard/styles.css` — summary, badges, timeline, activity, and callouts
- Modify: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Replace the overview JSON with an authoritative summary**
  - Change: Render repository path; run ID, project, feature ID, slug, and change kind; persisted status; derived phase; created and updated timestamps; last recorded activity; workflow eligibility and every refusal reason; and writer status, PID caveat, creation time, path, and reason. Use `statusPresentation`: `AWAITING APPROVAL` and `ATTENTION REQUIRED` take precedence for those derived phases; otherwise show `IN PROGRESS`, `BLOCKED`, or `COMPLETED` from persisted state. Show same-run stale observation and current refusal as a prominent warning without replacing the summary.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Tests assert exact authoritative labels and prove `in_progress` never renders as `RUNNING` and `completed` never renders as `PASSED`.

- **Step 2: Replace stage JSON with a responsive ordered timeline**
  - Change: Render every recorded stage in ordinal order with stage kind, ID, input stage, status, gate result, output reference, recorded start/end, and start-evidence source/audit ID. Use text, icon, and semantic color together. Show no unrecorded stage as complete and do not create parallel lanes. Use a horizontal, locally scrollable timeline on wide screens and a vertical connected sequence on narrow screens.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Pure projection tests retain stage order and all stage fields; static checks find the timeline's list semantics and non-color state labels.

- **Step 3: Build a clearly bounded recent-activity feed**
  - Change: Use `activityItems` to produce stage-start and stage-completion observations only from recorded timestamps, plus `activity.lastEvent`. When `lastEvent.id` equals a stage `startEvidence.auditId`, represent it once with the richer audit action and summary. Sort entries by recorded timestamp with stable stage-order tie breaking. Label the section "Partial recorded activity" and explain that the projection does not expose the complete audit stream. Keep `activity.lastRecordedAt` in the run summary even when no feed item can be produced.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Missing start times are not inferred, duplicate audit-backed starts are not repeated, and the feed exposes timestamp, event, stage, and recorded result only when present.

- **Step 4: Surface limitations as governance evidence**
  - Change: Render every `snapshot.limitations` entry in an alert-style list below the summary and before analytical claims. Use a purposeful "No recorded limitations" state only when the array is empty.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: The real-store missing-evidence limitation remains visible and no limitation array is serialized or truncated.

**Task completion evidence:** Operators can identify the selected run, its authoritative state, its complete recorded stage chain, its bounded activity evidence, and every limitation without inspecting JSON.

### Task 5: Build cost, token, and agent analytics

**Depends on:** Tasks 1, 3, and 4

**Files:**
- Modify: `src/dashboard/app.js` — cost cards, chart DOM, and agent table
- Modify: `src/dashboard/styles.css` — charts, legends, tables, and unavailable states
- Modify: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Render cost and token coverage cards**
  - Change: Display selected-run known USD cost, agent-row count, reported and unreported cost rows, recorded failed attempts, and separate input, output, cache-read, and cache-write token cards. Show an unavailable value when a class has no reported row, a partial label when any row is unreported, and exact full counts in the detail text. Do not infer spend for failed attempts.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Zero reported cost is distinguishable from reported zero cost, missing token classes do not become zero, and every coverage count matches the real `RunSnapshot`.

- **Step 2: Render accessible stage and agent cost charts**
  - Change: Render Cost by Stage as a labeled horizontal bar chart from `cost.byStage`, preserving every stage including unavailable and reported-zero groups. Render Cost by Agent as a native SVG donut using one labeled circle segment per positive reported value; when every reported value is zero, show the reported-zero state without manufacturing proportions. Pair both charts with visible legends and expandable semantic tables containing exact USD values and row coverage. Use a fixed color-blind-safe categorical palette unrelated to severity colors.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Series tests prove stable source ordering, exact values, all-unreported behavior, reported-zero behavior, and complete table rows; each rendered chart has a title, description, labels, and non-color equivalent.

- **Step 3: Render stage-ordered token consumption**
  - Change: Build a native SVG line chart whose x-axis is recorded stage ordinal and whose series are reported input, output, cache-read, and cache-write totals. Label it "Recorded token consumption by workflow stage" so it is not presented as wall-clock telemetry. Gaps remain unavailable rather than becoming zero. Add an equivalent table with stage, class totals, and reported/unreported rows.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Tests prove stage order, token-class inclusion, partial gaps, and exact table values without inventing time samples.

- **Step 4: Render the agent analytics table**
  - Change: For each `cost.byAgent` entry, display agent, "Not reported at agent level" for model, `agentRows` as executions, input/output coverage, known cost coverage, immutable report count attributed by `reviewerId`, and "Trend unavailable" instead of a sparkline. Preserve agents with failed attempts or unreported telemetry. Wrap the table in a local overflow container so it cannot widen the document.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Agent rows and finding attribution match the selected snapshot, multiple reports count independently, and no model or trend is inferred from `configuration.modelMap`.

**Task completion evidence:** Cost and token values remain traceable to selected-run groups, charts have equivalent data views, and unavailable telemetry is explicit rather than decorative or zero-filled.

### Task 6: Structure findings, governance, delivery, and evidence

**Depends on:** Tasks 1, 3, and 4

**Files:**
- Modify: `src/dashboard/app.js` — finding cards, command tiles, configuration, approval, proposals, delivery, and evidence
- Modify: `src/dashboard/styles.css` — issue cards, action tiles, definition groups, and evidence states
- Modify: `test/dashboard-ui.test.ts`
- Validate: `test/dashboard-server.test.ts`

**Steps:**

- **Step 1: Replace finding JSON with complete issue cards**
  - Change: Render one card per canonical finding with finding ID, stage ID, round, intent key, and location. Within it, render every immutable report as its own reviewer/severity/classification/subject block and every severity as visible text plus semantic styling. Render all recorded decision fields as labeled values and lists, including rationale, parsed changed locations, grounding fields, parsed normative changes, agent-run ID, and before/after hashes. If either persisted list is not a JSON array of strings, show the model's named malformed-record state and direct the operator to the existing status command rather than printing serialized data. Show final-panel blocking separately. Use "No recorded decision" when absent and a purposeful empty state when there are no findings.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: The existing 250-finding case remains complete, a multi-report finding keeps conflicting severities separate, and no synthetic finding-level severity or disposition appears.

- **Step 2: Build the governance command center from projected actions**
  - Change: Render Status, Doctor, and Verify Audit first from their existing `operatorActions` entries, followed by the current workflow handoff and remaining operator actions. Do not reconstruct or normalize their argv: use the projected command and arguments plus the server-provided CLI path through `commandText`. Each tile shows repository and selected run context, eligibility, refusal or explanatory reason, shell type, full command, and a copy button; when present, also show the action's proposal ID, route, title, and evidence reference. Note that Verify Audit is repository-wide even though the tile retains selected-run context. Keep disabled ineligible actions visible. Clipboard success and failure use the existing live region and never imply execution.
  - Verify: `node --test test/dashboard-ui.test.ts test/dashboard-server.test.ts`
  - Expected: Real snapshots produce exact Status, Doctor, and repository-wide Verify Audit commands; spaces, quotes, placeholders, and metacharacters remain shell-quoted; no fetch uses a mutation method.

- **Step 3: Render configuration, approval, and proposals structurally**
  - Change: Render system/profile/policy/starting-commit fields as labeled definitions; model-map entries and verification commands as tables; document and code-review policies as grouped values; and deadline and signer as explicit available/unavailable values. Render approval state, IDs, scope, risk, hashes, signer, expiry, and creation time without signatures. Render every proposal with identity, title, problem, upstream rationale, route, evidence reference, creation time, and source-finding IDs. Preserve exact model strings and do not claim reviewer independence beyond recorded fields.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Every projected configuration, approval, and proposal field is reachable without serialized JSON, and missing profile evidence remains a limitation rather than a default.

- **Step 4: Render delivery, verification, and evidence structurally**
  - Change: Render delivery status, stage, branch, worktree, patch base, initial/final/delivered commits, result/report references, changed/declared/delivered/missing path lists, and every verification observation. Each verification command displays name, argv, exit code, timeout, spawn/kill errors, overflow, duration, blocking reason, and evidence reference. Render every evidence reference with kind, stage, agent run, audit ID, path, availability, and reason. Use cards, definition lists, tables, and `<details>` for dense hashes or path lists; never link to or serve evidence contents.
  - Verify: `node --test test/dashboard-ui.test.ts test/operator-state.test.ts`
  - Expected: All delivery and evidence arrays remain complete, unavailable evidence is labeled by source reason, and passing checks are not described as proof of product correctness.

- **Step 5: Remove every raw-data rendering path**
  - Change: Delete `jsonSection`, all snapshot/governance `<pre>` construction, and every assignment that serializes an object or array into visible text. Keep single command strings in `<code>` elements. Continue using `createElement`, `createElementNS`, `textContent`, `setAttribute`, and explicit list/table construction; do not use `innerHTML`.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Static assertions reject `jsonSection`, user-facing `JSON.stringify`, snapshot `<pre>` elements, and `innerHTML`, while the structured projection completeness tests pass.

**Task completion evidence:** Every currently projected selected-run field is represented by a purpose-built component, all arrays remain complete, and governance commands remain copy-only.

### Task 7: Apply the enterprise visual and accessibility system

**Depends on:** Tasks 3 through 6

**Files:**
- Modify: `src/dashboard/styles.css` — complete token and responsive system
- Modify: `src/dashboard/index.html` — labels and structure required by final styling
- Modify: `src/dashboard/app.js` — accessible names and interaction states
- Modify: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Replace the visual tokens and component styling**
  - Change: Define light background `#f8fafc`, surface `#ffffff`, border `#e2e8f0`, text `#0f172a`, and accent `#0891b2`; define dark background `#0f172a`, surface `#1e293b`, border `#334155`, text `#f8fafc`, and accent `#0891b2`. Define success `#22c55e`, danger/high `#ef4444`, critical `#991b1b`, warning/medium `#f59e0b`, active/low `#3b82f6`, and neutral `#64748b`, plus theme-specific contrast-safe foreground and tinted-background companions. Use the required exact semantic colors for borders, dots, and chart marks rather than small text when their contrast against the surface is below AA. Use an Inter, Segoe UI, `system-ui` stack without a network font. Apply 16-pixel card radii, restrained shadows, subtle header or surface gradients, and a dark-mode translucent overlay with an opaque fallback. Keep color sparse and semantic.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Static checks find every required token and radius, permit the newly authorized restrained gradients, find no external font or framework, and retain readable fallback surfaces.

- **Step 2: Make every visual component perceivable and operable**
  - Change: Preserve logical heading order, landmarks, table headers/captions, `<time datetime>`, button names, live announcements, visible focus, ordinary tab navigation, and existing shortcut suppression/disable behavior. Mark decorative KPI and status icons `aria-hidden`; give informational chart SVGs `role="img"` with `<title>` and `<desc>`. Pair every chart with labels and exact data. Ensure status, severity, availability, and selection use text and icon shape in addition to color. Add a dependency-free WCAG relative-luminance assertion in `test/dashboard-ui.test.ts` that reads the actual CSS hex variables and proves each foreground/background text pair used by badges, cards, controls, and callouts reaches at least 4.5:1; large decorative chart marks are not treated as text.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Source assertions and pure accessibility metadata tests cover names, chart alternatives, non-color labels, focus, live regions, and keyboard policy.

- **Step 3: Support motion, contrast, zoom, and narrow layouts**
  - Change: Limit transitions to subtle hover/focus elevation and disable them under `prefers-reduced-motion`. Under `forced-colors`, replace shadows, gradients, glass effects, chart colors, badges, and connectors with system colors and visible borders. Use grid breakpoints that move the timeline vertical and KPI/detail layouts to one column. Set `min-width: 0`, `max-width: 100%`, `overflow-wrap`, and local table/chart scrolling so long paths, commands, hashes, and findings do not widen the document at 320 CSS pixels.
  - Verify: `node --test test/dashboard-ui.test.ts`; manual browser inspection at 1440, 768, and 320 CSS pixels in light and dark themes
  - Expected: Automated rules cover required media queries and containment; manual observation finds no document-level horizontal overflow, unreachable controls, clipped focus, or illegible status/chart state.

- **Step 4: Preserve purposeful loading, empty, stale, and failure states**
  - Change: Style pending KPI coverage, empty collections, stale snapshots, repository refusals, session expiry, clipboard failure, missing evidence, and partial telemetry as distinct components. Use `aria-busy` during explicit refresh and retain prior content where the state contract permits it. Avoid skeleton animation and avoid success-shaped fallbacks.
  - Verify: `node --test test/dashboard-ui.test.ts`; manual refresh and failure-state inspection
  - Expected: Every non-success state remains visible, textual, non-destructive, and consistent in both themes.

**Task completion evidence:** The dashboard has one responsive, accessible enterprise visual system that remains usable without color, motion, hover, a wide viewport, or complete telemetry.

### Task 8: Document, prove, and review the completed redesign

**Depends on:** Tasks 1 through 7

**Files:**
- Modify: `README.md` — dashboard data loading and presentation behavior
- Modify: `docs/features/dashboard-enterprise-redesign/plan.md` — completion status and implementation note
- Create: `docs/features/dashboard-enterprise-redesign/2026-09-12-code-review.md`
- Validate: `.claude/sessions/2026-09-12-requirements-dashboard-enterprise-redesign.md`
- Validate: `docs/features/dashboard/design.md`
- Validate: `src/operator-state.ts`
- Validate: `src/operator-read.ts`
- Validate: `test/operator-state.test.ts`
- Validate: `test/store.test.ts`

**Steps:**

- **Step 1: Update operator-facing dashboard guidance**
  - Change: Extend the existing README dashboard section with the loaded-window KPI scope, one-status-read-per-loaded-run behavior, coverage and stale labels, structured drilldown, unavailable agent duration/model/trend data, authoritative status vocabulary, and the continued copy-only command boundary. Keep the current launch, token, loopback, synchronous-read, and shutdown instructions unchanged unless implementation evidence requires a direct correction.
  - Verify: `npm run check:docs`
  - Expected: The README explains why some cards say unavailable, how `hasMore` bounds portfolio metrics, and why copied commands do not execute.

- **Step 2: Run focused and repository-wide validation**
  - Change: Run the focused UI, server, operator-state, and store tests first; then run the complete suite, both TypeScript programs, and documentation checks. Do not install a browser framework or new test dependency.
  - Verify: `node --test test/dashboard-ui.test.ts test/dashboard-server.test.ts test/operator-state.test.ts test/store.test.ts`; `npm test`; `npm run typecheck`; `npm run check:docs`
  - Expected: Focused and full tests pass, browser modules remain in the DOM-enabled program only, and documentation checks are clean apart from the repository's known historical path warnings.

- **Step 3: Prove the new high-value guards by mutation**
  - Change: In a disposable mirror, one at a time: change success-rate denominator from terminal runs to all runs; treat all-unreported cost as reported zero; make the Average Execution Time projection use run wall-clock time; remove repository identity from a run snapshot lookup; and replace one safe text assignment with `innerHTML`. Confirm the matching targeted test fails, restore exact bytes, and compare hashes before proceeding to the next mutation. Do not mutate or restore whole files in the active dirty worktree.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Each mutation changes the expected outcome, every restoration is byte-exact, and the restored focused suite passes.

- **Step 4: Perform no-spend browser acceptance**
  - Change: Confirm the retained paid target still exists. If it does, write a temporary repository list containing only that exact path, launch the dashboard, and remove only that temporary file after shutdown. If it does not exist, use only an available no-spend local target and record chart-rich acceptance as unverified rather than authorizing another run. Inspect token removal, KPI loading and coverage, blocked-run summary, horizontal/vertical workflow timeline, cost charts and data equivalents, agent unavailable states, multi-report findings, command copying, partial activity labeling, configuration/delivery/evidence drilldown, stale refresh, keyboard routes, light/dark/system themes, reduced motion, forced colors where the browser supports emulation, 200% zoom, and 1440/768/320 CSS-pixel widths. Stop the dashboard process afterward.
  - Verify: `$Target = 'C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1789245101665\target'; if (-not (Test-Path -LiteralPath $Target)) { throw 'Retained target unavailable; do not run a paid replacement.' }; $RepositoriesFile = Join-Path $env:TEMP 'bw-dashboard-redesign-repositories.json'; @{ repositories = @($Target) } | ConvertTo-Json | Set-Content -LiteralPath $RepositoriesFile -Encoding utf8; & node (Resolve-Path '.\src\cli.ts') dashboard --repositories-file $RepositoriesFile`; no paid driver command
  - Expected: The complete selected-run scenario is legible and keyboard-operable, no raw JSON or document-level horizontal overflow appears, copied commands remain inert, and no dashboard or browser process is left running.

- **Step 5: Complete independent implementation review and records**
  - Change: Run the repository's code-review workflow over the entire redesign diff after all automated and manual checks, inventorying both tracked and untracked in-scope files because `git diff` alone omits new files. Record only confirmed findings in `docs/features/dashboard-enterprise-redesign/2026-09-12-code-review.md`, reconcile every finding without rewriting original evidence, rerun affected checks, set this plan to `Implemented` only when no blocking finding remains, and update the repository-selected continuity record through the context-compaction workflow.
  - Verify: `npm run check:docs`; `git --no-pager diff --check`
  - Expected: The review record has no open finding, the plan status matches implementation state, the continuity record names the result and any unverified browser condition, and no unrelated uncommitted work is overwritten.

**Task completion evidence:** Focused and full validation, five mutation proofs, no-spend browser observations, a reconciled code review, and updated operator documentation establish the redesign without broadening the authorized dashboard boundary.

## Implementation note

All eight tasks shipped as written. `src/dashboard/dashboard-model.js` is the
new pure projection layer, `app.js` was rewritten to render fourteen structured
sections and native SVG charts from it with every user-facing `JSON.stringify`
and `<pre>` removed, and `index.html`, `styles.css`, and
`test/dashboard-ui.test.ts` were rewritten to match. `RunSnapshot`,
`src/operator-state.ts`, `src/operator-read.ts`, persistence, and the loopback
bearer GET-only boundary are unchanged; `src/dashboard-server.ts` gained exactly
one static-asset entry.

Verification: `npm run typecheck` clean across both programs;
`node --test test/dashboard-ui.test.ts test/dashboard-server.test.ts` 22 of 22;
full `npm test` 1129 passing with one unrelated pre-existing failure
(`test/verify-command.test.ts` "a hung command is killed with its whole tree at
the ceiling" hits an `EPERM` Windows temp-directory cleanup race under the full
suite and passes 8 of 8 in isolation); `npm run check:docs` clean;
`git --no-pager diff --check` clean. Headless browser acceptance ran read-only
against the retained paid target with no new spend and confirmed loaded KPIs,
all fourteen sections, every chart, and zero raw JSON.

Deviations from the plan as written. The plan's token-list parsing assumed
`normative_changes` stores strings; reading `insertFindingDecision` showed it
stores `DecisionNormativeChange` objects, so `parseNormativeChanges` and
`MALFORMED_NORMATIVE_REASON` replaced that branch and the finding card renders
the structured grounding — without this the projection would have flagged every
legitimate record as malformed. Eight mutation proofs ran rather than the five
the plan anticipated: the three additional ones cover serialized-state fallback
and the two guards added during review remediation. Nothing in "Deferred scope"
was built, and no paid invocation occurred.

Review: `2026-09-12-code-review.md` is reconciled with two findings, both
accepted and fixed — an uncleared `aria-busy` on the session-unavailable paths
and a token chart that conflated a reported zero with nothing reported. Each fix
carries a regression proved by mutation.

## Deferred scope

- Agent execution duration until the authoritative read projection exposes it
- Historical KPI trends and per-agent sparklines until a source series exists
- Agent-level model attribution until the projection binds model to agent rows
- Runs outside each repository's selected 1-100 loaded window
- Interactive dashboard mutation, approvals, consent, signatures, or execution
- Remote or multi-user access
- WebSockets, notifications, alerts, forecasts, export, or dashboard persistence
- New database schema, telemetry collection, or a dashboard-owned API
- Browser automation dependencies, packaging, installation, or publication
- Another paid run

## Rollback

The redesign changes no persisted state or public read envelope. Rollback
restores the prior `index.html`, `app.js`, `styles.css`, dashboard test, README,
dashboard TypeScript include, and static allowlist; removes
`dashboard-model.js`; and leaves every repository, run, audit row, and retained
evidence file unchanged. Because the working tree already contains uncommitted
dashboard and unrelated work, rollback must reverse only this plan's hunks or
restore from task-specific byte snapshots, never use a whole-file checkout or
reset.
