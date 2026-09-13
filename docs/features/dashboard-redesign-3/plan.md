# Dashboard Redesign 3 Implementation Plan

**Status:** Implemented

**Goal:** Transform the read-only dashboard into an enterprise-grade governed delivery command center featuring a compact, single-view canvas with a horizontal KPI strip, paired analytical panels, an interactive delivery pipeline, a governed deliveries portfolio table, and progressive disclosure drawers while strictly preserving the loopback read-only boundary.

**Source:** `docs/features/dashboard-redesign-3/design.md`, the dashboard authorization in `ARCHITECTURE.md` section 23, `docs/hazards.md`, `AGENTS.md`, and the decisions in `.claude/sessions/project-learnings.md`.

**Hazards considered:** 2 (evidence and telemetry availability must be explicit rather than hiding gaps or reconstructing raw output; unavailable execution duration and absent token classes are labeled as missing or unavailable rather than zero); 4 (UI and model expectations derive from authoritative `Store` rows and `RunSnapshot` contracts rather than hand-written fixtures; all guards are proved by breaking them with mutation and confirming failure); 10 (recorded model identifiers remain verbatim without alias normalization; agent-level model and execution duration remain explicitly unavailable as deferred by operator decision); 12 (repository identity and configuration remain isolated and labeled per repository); 14 (recorded reviewer identity is presented as recorded evidence, not an independence claim; multi-reviewer panels remain attributed); and 18 (completed stages and passed checks remain evidence records, never claims of semantic product correctness; stage and gate outcomes are explicitly stated).

**Assumptions:** The redesign replaces the page layout and presentation of `src/dashboard/` to implement the compact, single-view command center defined in `docs/features/dashboard-redesign-3/design.md` section 26 and its progressive disclosure drawers; the core backend (`src/operator-state.ts`, `src/operator-read.ts`, persistence, migrations) and read-only loopback security boundary remain strictly unchanged. Agent duration and agent-level model attribution remain deferred by operator decision and render as unavailable. The existing HTTP server static allowlist serves the updated HTML, CSS, app.js, and dashboard-model.js assets. No paid run is authorized.

**Approach:** Build a pure presentation model in `src/dashboard/dashboard-model.js` that derives the command-center projections (portfolio status banner, 6-card KPI strip, prioritized Needs Attention queue, 8-stage Delivery Pipeline mapping, governance health breakdown, model assignments, and unified governed deliveries rows) from existing authoritative `RunSnapshot` and `RunSummary` data. In `src/dashboard/index.html` and `src/dashboard/app.js`, restructure the application into an enterprise command center with a persistent primary navigation bar (Overview, Runs, Findings, Governance, Models & Agents, Audit), a consolidated scope and header surface, a slide-over drawer system for progressive disclosure, and responsive 12-column desktop grid layouts (1440px+). In `src/dashboard/styles.css`, implement a modern enterprise SaaS visual system in light and dark themes with subtle borders, 6-8px corner radii, and WCAG 2.2 AA contrast. Exercise all projections and interactions in `test/dashboard-ui.test.ts` against real SQLite store rows, enforce read-only boundary invariants, and prove high-value guards through mutations.

**Affected areas:** Browser state, presentation logic, and rendering in `src/dashboard/dashboard-model.js` and `src/dashboard/app.js`; semantic markup in `src/dashboard/index.html`; design tokens, grid layout, and component styling in `src/dashboard/styles.css`; automated tests in `test/dashboard-ui.test.ts`; and operator documentation in `README.md`. No changes to `src/dashboard-server.ts`, `src/operator-state.ts`, `src/operator-read.ts`, `src/store.ts`, migrations, CLI commands, policy, or provider harnesses.

**Known blockers:** No unresolved implementation blocker. Verified constraints shape the result: `RunSnapshot` has no agent-duration aggregate, agent-to-model binding, or historical series (governed by Hazard 10 and operator deferral), requiring explicit unavailable states; Content Security Policy is `style-src 'self'` with no inline style attributes, requiring pure CSS classes and SVG presentation attributes; the repository has no DOM test runner or browser automation dependency, requiring pure model tests and source-boundary assertions; and the environment remains strictly read-only and loopback-only, forbidding mutation methods, WebSockets, or background timers.

**Blast radius:** Verified by search: `src/dashboard/dashboard-model.js` is imported by `src/dashboard/app.js` and `test/dashboard-ui.test.ts`; `src/dashboard/app.js` is imported by `test/dashboard-ui.test.ts` and loaded by `src/dashboard/index.html`; `src/dashboard-server.ts` statically serves exactly `/`, `/app.js`, `/dashboard-model.js`, and `/styles.css` without modification; `tsconfig.dashboard.json` checks `src/dashboard/*.js` and `test/dashboard-ui.test.ts` with DOM libraries; and `README.md` documents operator launch and inspection commands. No core delivery stage, runner, or database file is affected.

**Verification:** Build source-derived unit tests in `test/dashboard-ui.test.ts` from real `Store` rows and `readStatusResult` / `readRunsResult` outputs; verify the 6-card KPI calculations, Needs Attention prioritization, Delivery Pipeline stage mapping, drawer state transitions, and keyboard navigation; verify theme contrast ratios (>= 4.5:1 text, >= 3:1 non-text) across light and dark palettes; verify static boundary assertions; run `npm run typecheck` across both TypeScript programs; run `npm run check:docs`; and execute mutation proofs for core guards.

**Self-review:** One end-to-end critical pass was performed against the draft on 2026-09-13 and four material findings were reconciled inline:
1. *Active inspection run fallback for Overview panels:* When `selectedRunId` is null, the Overview analytical panels (Delivery Pipeline, Model Assignments) resolve the primary exception run (the first blocked run, or the latest active run from the loaded window) with a clear contextual label (`Inspecting: <project> run <id>`) so the above-the-fold canvas remains fully populated.
2. *Deep-link preservation during tab transitions:* Action buttons (e.g. `[Review findings]`, `[View blocked run]`) and tab navigation explicitly preserve active `repository` and `run` query parameters via `routeHash(repoId, runId, tab)`.
3. *Keyboard shortcuts trigger & dialog:* The static `<aside>` shortcut reference is upgraded to an accessible modal dialog / popover triggered from the header Settings button, freeing vertical canvas space while preserving accessibility.
4. *Delivery pipeline stage resolution:* Stage mapping explicitly specifies fallback rules when specific pipeline stages (e.g. `awaiting_approval` or `verification`) were skipped or have not yet executed.

---

## Architecture and UI Component Layout

### Information Architecture & Primary Navigation

The command center adopts an enterprise navigation structure anchored by the Overview command center canvas:

- **Header & Scope Bar:** Product identity (`BUILDWORKS Governed Delivery`), repository selector, loaded window scope / run limit (1-100), search filter, manual refresh button with timestamp, settings / keyboard shortcut launcher, and theme selector (`System`, `Light`, `Dark`).
- **Primary Navigation Tabs:**
  - `Overview` (Default): The consolidated command center canvas (Banner, KPIs, Needs Attention, Pipeline, Governance Health, Model Assignments, Governed Deliveries).
  - `Runs`: Full repository run inventory with search, filters, and detailed run inspection.
  - `Findings`: Unified cross-run findings triage queue with severity filters and decision inspection.
  - `Governance`: Policy configurations, approvals, and copy-only CLI command execution center.
  - `Models & Agents`: AI governance, token consumption charts, and agent analytics.
  - `Audit`: Tamper-evident audit event stream, delivery results, and evidence references.
- **Routing:** Controlled via URL hash (`#tab=overview`, `#tab=runs`, `#tab=findings`, etc.), preserving repository and run selections (`#tab=overview&repository=repoA&run=1`) and maintaining deep linking.

### Compact, Single-View Overview Canvas (Section 26)

On desktop viewports (1440px and wider), the Overview canvas displays all critical operational signals in an above-the-fold composition:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ BUILDWORKS Governed Delivery  [Repo: All ▼] [Limit: 20] [Search...] [Refresh] [Theme] │
│                                                                                        │
│ [Overview]  Runs  Findings  Governance  Models & Agents  Audit                         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PORTFOLIO STATUS BANNER                                                     AT RISK ●  │
│ 1 blocked delivery requires attention. 4 open findings require review.                 │
│ [View blocked run] [Review findings]                               Updated moments ago│
├────────────┬────────────┬────────────┬────────────┬─────────────┬──────────────────────┤
│ PORTFOLIO  │ RELEASE    │ BLOCKED    │ OPEN       │ GOVERNANCE  │ DELIVERY             │
│ HEALTH     │ READY      │ DELIVERIES │ FINDINGS   │ COVERAGE    │ SUCCESS              │
│ At Risk    │ 0          │ 1          │ 4          │ At Risk     │ 0%                   │
│ Action req.│ No runs    │ Review now │ Across 1   │ 1 failure   │ 0 completed          │
├────────────┴────────────┴────────────┴────────────┴─────────────┴──────────────────────┤
│ PRIMARY ANALYTICAL ROW (12 columns: 7 col / 5 col)                                     │
│ ┌─────────────────────────────────────────┐ ┌────────────────────────────────────────┐ │
│ │ NEEDS ATTENTION                         │ │ DELIVERY PIPELINE                      │ │
│ │ 🔴 BLOCKED DELIVERY                     │ │ Specification  ● Complete              │ │
│ │    web-calculator                       │ │ Planning       ● Complete              │ │
│ │    4 findings require review            │ │ Implementation ● Complete              │ │
│ │    [Open run] [Review findings]         │ │ Testing        ● Complete              │ │
│ │ 🟡 DATA QUALITY                         │ │ Review         ● Failed                │ │
│ │    Execution duration not reported      │ │ Governance     ● Failed                │ │
│ │    [View telemetry details]             │ │ Approval       ○ Waiting               │ │
│ │                                         │ │ Release        ○ Blocked               │ │
│ └─────────────────────────────────────────┘ └────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ SECONDARY ANALYTICAL ROW (12 columns: 6 col / 6 col)                                   │
│ ┌─────────────────────────────────────────┐ ┌────────────────────────────────────────┐ │
│ │ GOVERNANCE HEALTH                       │ │ MODEL & AGENT ASSIGNMENTS              │ │
│ │ Controls: 5 passed · 1 failed           │ │ Planning: claude-3-5-sonnet            │ │
│ │ Findings: 1 High · 2 Medium · 1 Low     │ │ Implementer: claude-3-5-sonnet         │ │
│ │ Approval: Open (Expires in 2h)          │ │ Reviewers: Correctness, Security       │ │
│ │ Audit: Tamper-evident chain verified    │ │ Effort levels: Not reported            │ │
│ │ [Open governance view]                  │ │ [View assignments]                     │ │
│ └─────────────────────────────────────────┘ └────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ LOWER ANALYTICAL ROW (12 columns: 7 col / 5 col)                                       │
│ ┌─────────────────────────────────────────┐ ┌────────────────────────────────────────┐ │
│ │ AI GOVERNANCE & UTILIZATION             │ │ DATA QUALITY                           │ │
│ │ Total tokens: 1.21M · Known cost: $1.81 │ │ Coverage: 100% · Current: 1 · Stale: 0 │ │
│ │ Reporting: 16 of 16 agent rows          │ │ Duration: Missing · Trends: Unavailable│ │
│ │ [View token breakdown]                  │ │ [View telemetry details]               │ │
│ └─────────────────────────────────────────┘ └────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ GOVERNED DELIVERIES PORTFOLIO TABLE (12 columns)                                       │
│ ┌──────────────────┬──────────┬────────────┬──────────┬────────────┬─────────────────┐ │
│ │ Repository / Run │ Status   │ Stage      │ Findings │ Activity   │ Action          │ │
│ ├──────────────────┼──────────┼────────────┼──────────┼────────────┼─────────────────┤ │
│ │ web-calculator/1 │ Blocked  │ Review     │ 4        │ Sep 12     │ [Details]       │ │
│ └──────────────────┴──────────┴────────────┴──────────┴────────────┴─────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Progressive Disclosure via Slide-Over Drawers

To eliminate report-like vertical bloat while preserving 100% of recorded audit and diagnostic data, details open in a right-side slide-over drawer (`#drawer`):
- **Run Detail Drawer:** Full run executive summary, stage timeline, cost & tokens, limitations, delivery paths, and evidence.
- **Finding Detail Drawer:** Finding title, location, reviewer reports, severity, decision rationale, grounding excerpt, normative changes, and artifact hashes.
- **Failed Stage Drawer:** Stage identity, gate result, failure explanation, policy constraint, associated findings, evidence references, and recommended CLI command.
- **Data Quality Drawer:** Detailed snapshot freshness, missing telemetry fields, agent row reporting coverage, and provenance.
- **Model Assignments Drawer:** Full model map, reviewer specialties, and harness configurations.

---

## Requirements Coverage

| Requirement | Plan Task |
|---|---|
| Command Center direction & 5-second scannability (Sec 1, 2) | Tasks 2, 4, 7 |
| Primary navigation tabs (Overview, Runs, Findings, etc.) (Sec 3.1) | Tasks 2, 6 |
| Portfolio Status Banner (Sec 7) | Tasks 1, 4 |
| 6-card outcome-focused Horizontal KPI Strip (Sec 8, 26.4) | Tasks 1, 4 |
| Prioritized Needs Attention exception queue (Sec 9) | Tasks 1, 4 |
| 8-stage interactive Delivery Pipeline (Sec 11) | Tasks 1, 4 |
| Governance Health & Model/Agent Assignments panels (Sec 13, 26.5) | Tasks 1, 5 |
| AI Governance & Data Quality panels (Sec 13, 14, 26.5) | Tasks 1, 5 |
| Governed Deliveries enterprise table (Sec 12, 26.7) | Tasks 1, 5 |
| Progressive disclosure slide-over drawers (Sec 15, 19, 20) | Tasks 3, 5 |
| Dedicated Tab Views (Runs, Findings, Governance, etc.) (Sec 3.1) | Task 6 |
| Modern enterprise SaaS visual design (Sec 17, 26.8) | Task 7 |
| WCAG 2.2 AA accessibility, contrast, and focus management (Sec 18) | Tasks 3, 7, 8 |
| Read-only loopback security boundary & CSP compliance | Tasks 2, 3, 8 |
| Automated testing, real-store derivation, and mutation proofs | Tasks 1, 8 |

---

## Tasks

### Task 1: Establish Command Center Presentation Model Primitives & Projections

**Depends on:** None

**Files:**
- Modify: `src/dashboard/dashboard-model.js` — add command-center projection exports
- Modify: `test/dashboard-ui.test.ts` — add unit tests for new projection functions
- Validate: `tsconfig.dashboard.json`

**Steps:**

- **Step 1: Implement Portfolio Status Banner projection**
  - Change: In `src/dashboard/dashboard-model.js`, export `portfolioStatusBanner(portfolio, runs, snapshots)`. Determine overall portfolio state: `blocked` if any run is blocked or has a failed gate; `at_risk` if any open finding exists, approval window is closed, or run is in progress with warnings; `healthy` if all runs are completed with clean gates; `unknown` if no runs or snapshots exist. Generate a single-sentence summary (e.g., "1 blocked delivery requires attention. 4 open findings require review.") and up to two primary actions (e.g., `{ label: "View blocked run", target: "run", runId }`, `{ label: "Review findings", target: "findings" }`). Compute relative freshness string from latest observation.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Implement 6-card outcome-focused Horizontal KPI Strip projection**
  - Change: In `src/dashboard/dashboard-model.js`, export `commandCenterKpis(portfolio, runs, snapshots)`. Return six structured cards:
    1. `portfolioHealth`: `{ label: "PORTFOLIO HEALTH", value: "At Risk" | "Healthy" | "Blocked" | "Unknown", tone: "danger" | "success" | "warning" | "neutral", qualifier: "Action req." | "All systems normal" | "No active runs" }`.
    2. `releaseReady`: `{ label: "RELEASE READY", value: number, tone: "success" | "neutral", qualifier: string }` (runs completed with clean governance and passing verification).
    3. `blockedDeliveries`: `{ label: "BLOCKED DELIVERIES", value: number, tone: "danger" | "neutral", qualifier: number > 0 ? "Review now" : "None blocked" }`.
    4. `openFindings`: `{ label: "OPEN FINDINGS", value: number | null, tone: "danger" | "warning" | "neutral", qualifier: `Across ${N} runs` }`.
    5. `governanceCoverage`: `{ label: "GOVERNANCE COVERAGE", value: string, tone: "danger" | "success" | "warning", qualifier: string }` (status or pass/fail count of governance gates).
    6. `deliverySuccess`: `{ label: "DELIVERY SUCCESS", value: string, tone: "success" | "neutral" | "danger", qualifier: string }` (completed divided by terminal runs, with count qualifier e.g. "0 complete · 1 blocked").
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Implement prioritized Needs Attention queue projection**
  - Change: In `src/dashboard/dashboard-model.js`, export `needsAttentionQueue(repositories, options)`. Scan loaded runs, snapshots, and repository states to produce a prioritized exception list. Item types:
    - `delivery`: Blocked runs or failed verification (severity: `critical` or `high`, title: "Blocked delivery", repository, runId, explanation, actions: `[Open run]`, `[Review findings]`).
    - `governance`: Failed gates, unaddressed high findings, or closed approval windows (severity: `high`, title: "Governance control failed", explanation, actions: `[Open run]`, `[View decision]`).
    - `data_quality`: Missing execution duration or stale snapshots (severity: `medium` or `low`, title: "Data quality", explanation: "Execution duration was not reported", action: `[View telemetry details]`).
    - `system`: Unreachable or refused repository (severity: `medium`, title: "Repository unavailable").
    Sort items deterministically: `critical` -> `high` -> `medium` -> `low`, then newest activity first.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Implement 8-stage Delivery Pipeline projection**
  - Change: In `src/dashboard/dashboard-model.js`, export `deliveryPipelineStages(snapshot)`. Map the snapshot's recorded stages and lifecycle phase to the enterprise 8-stage sequence:
    1. `specification` (maps from `spec`, `spec_review`)
    2. `planning` (maps from `plan`, `plan_review`)
    3. `implementation` (maps from `implementation`)
    4. `testing` (maps from `verification`)
    5. `review` (maps from `code_review`)
    6. `governance` (maps from gate checks, policy compliance, and audit chain)
    7. `approval` (maps from `awaiting_approval`)
    8. `release` (maps from `delivery_check`, `completed`)
    Assign each stage a status: `not_started`, `in_progress`, `complete`, `at_risk`, `failed`, `waiting`, `blocked`, or `skipped`. Include drill-down metadata: start/completion timestamps, assigned model/agent, gate result, findings count, failure reason, and relevant command.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Implement Governance Health, Model Assignments, and Governed Deliveries projections**
  - Change: In `src/dashboard/dashboard-model.js`, export:
    - `governanceHealthSummary(snapshot)`: Controls passed/failed, findings by severity distribution (`critical`, `high`, `medium`, `low`), approval status, and audit chain status.
    - `modelAssignmentsSummary(snapshot)`: Planning model, implementation agent, review models by review type, test model/harness, and effort levels (`"Not reported in configuration"`).
    - `dataQualitySummary(portfolio, snapshots)`: Snapshot coverage percentage, current count, stale count, missing execution duration count, cost coverage, and historical trend status.
    - `governedDeliveriesRows(repositories)`: Unified tabular array of deliveries across repositories with columns: repository display name, run ID, status presentation, current pipeline stage, findings count, governance status, last activity timestamp, and raw run summary.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 6: Add automated tests for all new model projections**
  - Change: In `test/dashboard-ui.test.ts`, add a test suite exercising the new projection functions against real `Store` rows and envelopes from `seedPartialRun`:
    - Prove `portfolioStatusBanner` derives correct status (`blocked` when a blocked run exists, `at_risk` when open findings exist, `healthy` when all passed).
    - Prove `commandCenterKpis` outputs the exact 6 cards with correct counts, labels, and unavailable handling.
    - Prove `needsAttentionQueue` groups delivery, governance, and data-quality issues, prioritizing critical/high severity first.
    - Prove `deliveryPipelineStages` correctly maps recorded stages to the 8 standard stages, accurately assigning `failed` to stages with blocking gates.
    - Prove `governedDeliveriesRows` aggregates across repositories without cross-run collisions.
  - Verify: `node --test --test-name-pattern "command center projections" test/dashboard-ui.test.ts`
  - Expected: All tests pass.

**Task completion evidence:** `src/dashboard/dashboard-model.js` exports `portfolioStatusBanner`, `commandCenterKpis`, `needsAttentionQueue`, `deliveryPipelineStages`, `governanceHealthSummary`, `modelAssignmentsSummary`, `dataQualitySummary`, and `governedDeliveriesRows`; all tests in `test/dashboard-ui.test.ts` pass; `npm run typecheck` exits 0.

---

### Task 2: Build Application Shell, Navigation Bar, Scope Controls, and View Router

**Depends on:** Task 1

**Files:**
- Modify: `src/dashboard/index.html` — restructure semantic shell, navigation bar, and controls
- Modify: `src/dashboard/app.js` — navigation state, URL hash routing, and view switching
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Update static HTML shell in `index.html`**
  - Change: In `src/dashboard/index.html`:
    - Update `<header class="app-header">`: Include product branding (`BUILDWORKS`, subtitle `Governed Delivery`), scope controls, search field, manual refresh button with timestamp indicator, settings/shortcuts trigger button, and theme select dropdown.
    - Replace the static `<aside class="shortcut-reference">` in document flow with a native `<dialog id="shortcuts-dialog" class="shortcuts-dialog" aria-labelledby="shortcuts-dialog-title">` triggered by the header shortcuts button, maintaining full keyboard accessibility without taking up permanent vertical canvas space.
    - Add primary navigation bar `<nav class="primary-nav" aria-label="Primary Navigation">` with tabs:
      `<button role="tab" id="tab-overview" aria-controls="view-overview" aria-selected="true" data-tab="overview">Overview</button>`
      `<button role="tab" id="tab-runs" aria-controls="view-runs" aria-selected="false" data-tab="runs">Runs</button>`
      `<button role="tab" id="tab-findings" aria-controls="view-findings" aria-selected="false" data-tab="findings">Findings</button>`
      `<button role="tab" id="tab-governance" aria-controls="view-governance" aria-selected="false" data-tab="governance">Governance</button>`
      `<button role="tab" id="tab-models" aria-controls="view-models" aria-selected="false" data-tab="models">Models & Agents</button>`
      `<button role="tab" id="tab-audit" aria-controls="view-audit" aria-selected="false" data-tab="audit">Audit</button>`
    - Add drawer container `<aside id="drawer" class="drawer-container" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Details Drawer">` with backdrop and sliding panel.
    - Retain skip link, live region, and read-only footer.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Implement tab routing and view switching in `app.js`**
  - Change: In `src/dashboard/app.js`:
    - Extend `parseRoute(hash)` to parse `tab`:
      `const tab = parameters.get("tab") || "overview";` (validating against allowlist: `overview`, `runs`, `findings`, `governance`, `models`, `audit`).
    - Extend `routeHash(repositoryId, runId, tab)` to preserve active repository and run when switching tabs:
      `#tab=overview&repository=repoA&run=1`. Action buttons across panels (e.g., `[Review findings]`, `[View blocked run]`) construct destination hashes preserving the contextual `repository` and `run` parameters.
    - In `DashboardApplication`, track `currentTab: string`.
    - Implement tab click handlers and keyboard arrow navigation (`ArrowLeft` / `ArrowRight` between tabs, `Home` / `End`).
    - Update `render(application)` to branch by `currentTab`, dispatching to `renderOverviewTab`, `renderRunsTab`, `renderFindingsTab`, `renderGovernanceTab`, `renderModelsTab`, or `renderAuditTab`.
  - Verify: `node --test --test-name-pattern "client token, token-free routes" test/dashboard-ui.test.ts`
  - Expected: Route tests pass, tab parameter is recognized and preserved.

- **Step 3: Add automated tests for tab routing and accessibility**
  - Change: In `test/dashboard-ui.test.ts`, add test asserting:
    - `parseRoute` parses valid tabs and falls back to `overview` for missing or invalid tabs.
    - `routeHash` formats URL hash with tab, repository, and run.
    - Static HTML check confirms all 6 primary navigation buttons carry `role="tab"` and `aria-controls`.
  - Verify: `node --test --test-name-pattern "tab routing and accessibility" test/dashboard-ui.test.ts`
  - Expected: Tests pass.

**Task completion evidence:** `index.html` contains the updated enterprise header, primary navigation tabs, and drawer container; `app.js` manages tab state and route synchronization; all routing tests in `test/dashboard-ui.test.ts` pass.

---

### Task 3: Implement Slide-Over Drawer & Popover System

**Depends on:** Tasks 1, 2

**Files:**
- Modify: `src/dashboard/app.js` — drawer controller and content rendering functions
- Modify: `src/dashboard/styles.css` — drawer layout, animations, backdrop, and focus styling
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Implement accessible Slide-Over Drawer controller in `app.js`**
  - Change: In `src/dashboard/app.js`, implement `openDrawer(title, category, contentBuilder, application, triggerElement)`:
    - Locate `#drawer` container.
    - Create backdrop element with click handler to close.
    - Create drawer panel with header: category badge, `<h2>` title, and `<button class="drawer-close" aria-label="Close details drawer">&times;</button>`.
    - Create drawer body and append content generated by `contentBuilder()`.
    - Manage accessibility: set `#drawer` `aria-hidden="false"`, lock body scroll (`overflow: hidden`), trap focus inside drawer (`Tab` / `Shift+Tab`), register `Escape` key listener to close drawer.
    - On close: restore body scroll, set `aria-hidden="true"`, empty drawer children, return focus to `triggerElement`.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Implement drawer content builders for domain entities**
  - Change: In `src/dashboard/app.js`, implement specialized drawer content renderers:
    - `buildRunDetailDrawer(snapshot, summary, application)`: Renders executive summary, recorded workflow timeline, token and cost cards, limitations, delivery paths, and evidence references.
    - `buildFindingDetailDrawer(card, application)`: Renders full finding metadata, severity, reviewer reports, decision disposition, rationale, grounding excerpt, normative changes, and artifact hashes with copy affordances.
    - `buildPipelineStageDrawer(stageView, application)`: Renders stage kind, gate result, start/end timestamps, failure reason, policy rules, associated findings, evidence references, and shell command.
    - `buildDataQualityDrawer(dataQuality, application)`: Renders snapshot freshness, missing telemetry fields, agent reporting rows, and provenance.
    - `buildModelAssignmentsDrawer(assignments, application)`: Renders model map, reviewer specialties, and harness configurations.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Implement metric definition popover / tooltip helper**
  - Change: In `src/dashboard/app.js`, implement `metricInfoButton(title, formula, explanation)`:
    - Renders `<button type="button" class="info-trigger" aria-label="Information about ${title}" aria-expanded="false">ⓘ</button>`.
    - Toggles a lightweight, accessible disclosure popover containing metric definition, formula, and caveats without permanently cluttering the primary layout.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Add automated tests for drawer and popover controllers**
  - Change: In `test/dashboard-ui.test.ts`, extend the static boundary tests asserting:
    - Drawer structure exists with `role="dialog"`, `aria-modal="true"`, and `aria-hidden`.
    - Drawer close button carries an explicit `aria-label`.
    - Escape key listener and focus restoration logic are declared.
    - No script assigns inline styles (`.style.` or `setAttribute("style", ...)`).
  - Verify: `node --test --test-name-pattern "static assets keep the approved accessible boundary" test/dashboard-ui.test.ts`
  - Expected: Tests pass.

**Task completion evidence:** Slide-over drawer and popover system are implemented and keyboard-operable with focus trapping; domain content builders exist for runs, findings, stages, data quality, and model assignments; static boundary tests pass.

---

### Task 4: Construct Command Center Overview Canvas — Banner, Horizontal KPI Strip, & Primary Analytical Row

**Depends on:** Tasks 1, 2, 3

**Files:**
- Modify: `src/dashboard/app.js` — `renderOverviewTab`, banner, KPI strip, Needs Attention, and Pipeline renderers
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Implement Portfolio Status Banner rendering**
  - Change: In `src/dashboard/app.js`, implement `renderPortfolioBanner(banner, application)`:
    - Renders `<section class="portfolio-banner tone-${banner.tone}">`.
    - Left side: Status badge (`Healthy`, `At Risk`, `Blocked`, `Unknown`) with non-color icon and text, followed by the single-sentence summary.
    - Right side: Up to two primary action buttons (e.g., `View blocked run`, `Review findings`) that trigger run selection, tab navigation, or drawer opening, plus a quiet freshness indicator (`Updated moments ago`).
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Implement 6-card outcome-focused Horizontal KPI Strip rendering**
  - Change: In `src/dashboard/app.js`, implement `renderCommandCenterKpis(kpis, application)`:
    - Renders `<div class="kpi-strip" role="region" aria-label="Portfolio Key Performance Indicators">`.
    - Renders exactly six compact cards in one horizontal row at desktop:
      1. Portfolio Health (`At Risk`, `Action req.`)
      2. Release Ready (`0`, `No runs ready`)
      3. Blocked Deliveries (`1`, `Review now`)
      4. Open Findings (`4`, `Across 1 run`)
      5. Governance Coverage (`At Risk`, `1 failure`)
      6. Delivery Success (`0%`, `0 complete · 1 blocked`)
    - Each card includes an info trigger (`metricInfoButton`) revealing the formula/definition in a popover, a dominant metric value (with tabular numerals), and a concise qualifier.
    - Clicking a KPI card navigates to the relevant tab or opens the filtered view.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Implement Needs Attention exception queue rendering**
  - Change: In `src/dashboard/app.js`, implement `renderNeedsAttention(queue, application)`:
    - Renders `<section class="panel needs-attention-panel" id="needs-attention">`.
    - Panel header: Title `Needs Attention` and count badge (`${queue.length}`).
    - If empty, renders a clean state: `No items require attention. All delivery gates and governance checks have passed.`.
    - If items exist, renders a prioritized queue:
      - Each item card carries a severity indicator (`critical`, `high`, `medium`, `low`), an issue category chip (`Delivery`, `Governance`, `Data Quality`, `System`), title, repository/run tag, explanation, last activity timestamp, and primary/secondary action buttons (e.g., `[Open run]`, `[Review findings]`, `[View telemetry details]`).
      - Clicking action buttons directly opens the corresponding drawer or selects the run.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Implement Delivery Pipeline interactive stepper rendering**
  - Change: In `src/dashboard/app.js`, implement `renderDeliveryPipeline(stages, application)`:
    - Renders `<section class="panel delivery-pipeline-panel" id="delivery-pipeline">`.
    - Active Run Fallback: If `application.selectedRunId` is not explicitly set in the route, automatically resolve the primary exception run (the first blocked run, or the latest active run from the loaded window) so the Overview canvas is immediately populated with actionable delivery progress. Display a clear subtitle badge: `Inspecting: <repository>/<run>`.
    - Panel header: Title `Delivery Pipeline` and current delivery status indicator with a compact run-picker dropdown or link to switch target runs.
    - Renders the 8 enterprise stages in sequence: Specification, Planning, Implementation, Testing, Review, Governance, Approval, Release.
    - Stage Resolution: If an upstream stage was skipped (e.g., approval was waived or verification was deferred), render with status `skipped`. If not yet reached, render as `not_started`.
    - Visual representation: Connected stepper nodes with status badges (`Complete`, `Failed`, `Waiting`, `In Progress`, `Blocked`, `Skipped`, `Not Started`), status symbols (check, cross, clock, dot), and stage duration/timestamp.
    - Interactive: Clicking any stage (especially failed or blocked stages) calls `openDrawer` with `buildPipelineStageDrawer`, displaying root-cause gate results, associated findings, policy constraints, and recommended CLI commands.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Assemble Primary Analytical Row in `renderOverviewTab`**
  - Change: In `src/dashboard/app.js`, assemble the upper half of `renderOverviewTab(application)`:
    - Append Portfolio Status Banner.
    - Append Horizontal KPI Strip.
    - Append Primary Analytical Row container `<div class="analytical-row primary-row">` containing:
      - Needs Attention (7 columns on 12-col grid).
      - Delivery Pipeline (5 columns on 12-col grid).
  - Verify: `node --test --test-name-pattern "command center projections" test/dashboard-ui.test.ts`
  - Expected: Model and render functions compile and pass tests.

**Task completion evidence:** The Overview tab renders the Portfolio Status Banner, the 6-card Horizontal KPI Strip, the Needs Attention queue, and the 8-stage interactive Delivery Pipeline in desktop side-by-side composition; clicking failed stages opens detail drawers.

---

### Task 5: Construct Command Center Overview Canvas — Secondary Row & Governed Deliveries Table

**Depends on:** Tasks 1, 2, 3, 4

**Files:**
- Modify: `src/dashboard/app.js` — Governance Health, Model Assignments, Lower Analytics, and Governed Deliveries Table
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Implement Governance Health panel rendering**
  - Change: In `src/dashboard/app.js`, implement `renderGovernanceHealth(summary, application)`:
    - Renders `<section class="panel governance-health-panel" id="governance-health">`.
    - Header: Title `Governance Health` and summary status.
    - Content:
      - Controls summary: Passed vs failed controls count.
      - Findings severity distribution: Compact horizontal segmented bar and count breakdown for `Critical`, `High`, `Medium`, `Low`.
      - Approval status: Current state (`Granted`, `Awaiting approval`, `Expired`) and derived window closure note.
      - Audit verification: Tamper-evident hash chain status.
      - Action: `<button class="action-link" data-tab="governance">Open governance view &rarr;</button>`.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Implement Model & Agent Assignments panel rendering**
  - Change: In `src/dashboard/app.js`, implement `renderModelAssignments(assignments, application)`:
    - Renders `<section class="panel model-assignments-panel" id="model-assignments">`.
    - Header: Title `Model & Agent Assignments` and executor label.
    - Content: Definition list showing:
      - Planning model (from configuration)
      - Implementation agent (from configuration/run)
      - Reviewer models and assigned specialties (e.g. Correctness, Security)
      - Test harness/executor
      - Effort levels: `"Not reported in run configuration"` (explicitly stating unavailability per Hazard 10 and operator deferral).
      - Action: `<button class="action-link" data-action="model-drawer">View assignment details &rarr;</button>` opening the Model Assignments drawer.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Implement Lower Analytical Pair (AI Governance & Data Quality)**
  - Change: In `src/dashboard/app.js`, implement `renderLowerAnalytics(projection, portfolio, application)`:
    - Renders `<div class="analytical-row lower-row">` containing:
      - **AI Governance & Utilization panel:** Total tokens (formatted with exact hidden count), known USD cost, and reporting coverage (X of Y agent rows), with a button opening the Token & Cost drill-down drawer.
      - **Data Quality panel:** Snapshot coverage percentage, current snapshots count, stale count, missing execution duration count, cost reporting coverage, and historical trend status (`Trend unavailable`), with a button opening the Data Quality drawer.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Implement Governed Deliveries enterprise table rendering**
  - Change: In `src/dashboard/app.js`, implement `renderGovernedDeliveriesTable(repositories, application)`:
    - Renders `<section class="panel governed-deliveries-panel" id="deliveries">`.
    - Panel header: Title `Governed Deliveries`, total run count badge, and table controls (search input, status filter, sorting options).
    - Enterprise table structure:
      - Columns: `Repository / Run`, `Status`, `Stage / Phase`, `Findings`, `Governance Decision`, `Last Activity`, `Action`.
      - Features: Sticky table header, compact row heights, right-aligned numbers, non-color status badges with icons, formatted timestamps.
      - Each row provides an `[Open]` button that selects the run and opens the Run Detail slide-over drawer without losing table context.
      - Empty and filtered states: Distinct visual treatments for zero configured runs vs zero search matches.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Assemble complete Overview tab in `renderOverviewTab`**
  - Change: In `src/dashboard/app.js`, complete `renderOverviewTab(application)`:
    - Append Portfolio Status Banner.
    - Append Horizontal KPI Strip.
    - Append Primary Analytical Row (Needs Attention + Delivery Pipeline).
    - Append Secondary Analytical Row (Governance Health + Model Assignments).
    - Append Lower Analytical Row (AI Governance + Data Quality).
    - Append Governed Deliveries Table.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: All automated tests pass.

**Task completion evidence:** The complete Overview tab renders all analytical panels and the Governed Deliveries table in desktop 12-column grid layout; clicking any delivery row opens the Run Detail drawer.

---

### Task 6: Implement Dedicated Tab Views (Runs, Findings, Governance, Models & Agents, Audit)

**Depends on:** Tasks 2, 4, 5

**Files:**
- Modify: `src/dashboard/app.js` — dedicated tab renderers
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Implement Runs tab view (`renderRunsTab`)**
  - Change: In `src/dashboard/app.js`, implement `renderRunsTab(application)`:
    - Renders full repository inventory, per-repository run tables, limit selector (1-100), phase filters, and run search.
    - If a run is selected, renders the structured Run Detail view directly or opens the Run Detail drawer.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Implement Findings tab view (`renderFindingsTab`)**
  - Change: In `src/dashboard/app.js`, implement `renderFindingsTab(application)`:
    - Renders a cross-run findings triage queue across all loaded repositories.
    - Filter controls: severity (`All`, `High`, `Medium`, `Low`), stage, and decision disposition (`Addressed`, `Rejected with rationale`, `Unaddressed`).
    - Renders finding cards with readable title, severity badge, location, stage, round, and decision summary.
    - Clicking a finding card opens the Finding Detail slide-over drawer with full grounding and normative change metadata.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Implement Governance tab view (`renderGovernanceTab`)**
  - Change: In `src/dashboard/app.js`, implement `renderGovernanceTab(application)`:
    - Renders approval authorizations, upstream proposals, frozen profile/policy hashes, and the copy-only CLI command center (`Status`, `Doctor`, `Verify-Audit`, and current `Workflow` handoff).
    - Every command tile includes command text, copy affordance, eligibility status, and explanatory reason.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Implement Models & Agents tab view (`renderModelsTab`)**
  - Change: In `src/dashboard/app.js`, implement `renderModelsTab(application)`:
    - Renders AI governance analytics: Cost by Stage horizontal bar chart, Cost by Agent native SVG donut chart, and stage-ordered Token Consumption polyline chart.
    - Renders the Agent Analytics table with execution counts, token class breakdowns, and model availability statements.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Implement Audit tab view (`renderAuditTab`)**
  - Change: In `src/dashboard/app.js`, implement `renderAuditTab(application)`:
    - Renders the recorded activity timeline, verification command exit codes, delivery result records (changed/declared/delivered paths), and evidence references table.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

**Task completion evidence:** All six primary navigation tabs (`Overview`, `Runs`, `Findings`, `Governance`, `Models & Agents`, `Audit`) are fully functional and render dedicated domain views from loaded snapshot state.

---

### Task 7: Apply Modern Enterprise SaaS Visual System, Themes, and Responsive Styling

**Depends on:** Tasks 2, 3, 4, 5, 6

**Files:**
- Modify: `src/dashboard/styles.css` — complete design system rewrite
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Define modern enterprise design tokens and palette**
  - Change: In `src/dashboard/styles.css`, establish enterprise design tokens:
    - Typography: `Inter, "Segoe UI", system-ui, sans-serif`. Tabular numerals (`font-variant-numeric: tabular-nums`) for all metric values and timestamps.
    - Spacing system: 8px base grid (`--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-6: 24px`, `--space-8: 32px`).
    - Border radii: 6-8px (`--radius: 8px`, `--radius-sm: 6px`, `--radius-lg: 12px`).
    - Surfaces & borders: Light theme background `#f8fafc`, surface `#ffffff`, raised `#ffffff`, sunken `#f1f5f9`, border `#e2e8f0`, text `#0f172a`, muted `#475569`. Dark theme background `#0f172a`, surface `#1e293b`, raised `#273449`, sunken `#16203a`, border `#334155`, text `#f8fafc`, muted `#94a3b8`.
    - Semantic tones: Success `#166534` (dark `#4ade80`), Warning `#92400e` (dark `#fbbf24`), Danger/Critical `#991b1b` (dark `#fca5a5`), Active/Info `#0e7490` (dark `#67e8f9`), Neutral `#475569` (dark `#94a3b8`).
    - Restrained shadows: Replace heavy drop shadows with 1px border definitions and subtle elevation.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Implement responsive 12-column grid and panel layouts**
  - Change: In `src/dashboard/styles.css`:
    - Layout container constrained to max-width 1600px with centered alignment and padding.
    - Desktop (1440px+):
      - Horizontal KPI strip: 6-column grid (`grid-template-columns: repeat(6, 1fr)`).
      - Primary row: 12-column grid with Needs Attention (7 columns) and Delivery Pipeline (5 columns).
      - Secondary row: 12-column grid with Governance Health (6 columns) and Model Assignments (6 columns).
      - Lower row: 12-column grid with AI Utilization (7 columns) and Data Quality (5 columns).
      - Governed Deliveries: Full 12 columns.
    - Tablet (768px - 1439px):
      - KPI strip: 3x2 grid.
      - Analytical rows: Stacked full-width panels.
      - Governed Deliveries: Horizontally scrollable table with preserved columns.
    - Mobile (320px - 767px):
      - KPI strip: 2-column or 1-column stack.
      - Pipeline: Vertical connected stepper sequence.
      - Drawers: Full-width overlay.
      - Zero document-level horizontal scroll (`overflow-wrap: anywhere`, `min-width: 0`).
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Implement slide-over drawer and popover styles**
  - Change: In `src/dashboard/styles.css`:
    - Drawer container: Fixed overlay (`z-index: 1000`, `inset: 0`).
    - Backdrop: Semi-transparent dark wash with fade transition.
    - Drawer panel: Right-anchored sliding sheet (`width: min(44rem, 100%)`, `background: var(--panel)`, `border-left: 1px solid var(--border)`).
    - Slide transition: Transform translation from right (`transform: translateX(100%)` to `transform: translateX(0)`), disabled under `prefers-reduced-motion`.
    - Popover / tooltip styles: Absolute floating container with subtle border and shadow, fully accessible to keyboard focus.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Implement Delivery Pipeline stepper and Needs Attention styles**
  - Change: In `src/dashboard/styles.css`:
    - Delivery Pipeline: Horizontal flex/grid chain with circular stage badges, connectors, label hierarchy, and hover/focus highlight states.
    - Needs Attention: Cards with 4px left-border severity accents, category tags, clear action button hierarchy (`btn-primary`, `btn-secondary`), and hover lift.
    - Governed Deliveries Table: Sticky header (`position: sticky; top: 0; z-index: 10`), alternating row hover, tabular number alignment, compact padding.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Enforce accessibility, high contrast, and reduced motion**
  - Change: In `src/dashboard/styles.css`:
    - Visible focus rings: Unscoped `:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }`.
    - High contrast / `forced-colors`: Replace custom colors with system `Canvas`, `CanvasText`, `Highlight`, `ButtonText`, and solid borders.
    - Reduced motion: `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }`.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

**Task completion evidence:** `src/dashboard/styles.css` delivers the modern enterprise SaaS control plane visual system, supporting 12-column responsive layouts, slide-over drawers, horizontal pipeline stepper, and dark/light modes meeting WCAG 2.2 AA.

---

### Task 8: Comprehensive Automated Tests, Contrast Verification, and Mutation Proofs

**Depends on:** Tasks 1 through 7

**Files:**
- Modify: `test/dashboard-ui.test.ts` — new test suites, contrast assertions, and mutation proofs
- Validate: `test/dashboard-server.test.ts`

**Steps:**

- **Step 1: Add automated tests for the complete command center workflow**
  - Change: In `test/dashboard-ui.test.ts`, add comprehensive tests exercising the redesigned dashboard:
    - Test that `commandCenterKpis` accurately computes all six KPI cards from multiple repositories, properly identifying blocked runs, release readiness, and uncalculated duration.
    - Test that `needsAttentionQueue` correctly identifies blocked runs, open findings, and missing telemetry, sorting critical/high items first.
    - Test that `deliveryPipelineStages` maps stages to the 8 standard stages and marks failed stages with actionable gate details.
    - Test that `portfolioStatusBanner` reflects portfolio health (`blocked`, `at_risk`, `healthy`) with actionable buttons.
    - Test that tab switching updates navigation attributes (`aria-selected`) and correctly renders the target view without network requests.
    - Test that `openDrawer` and `closeDrawer` properly update `aria-hidden`, trap focus, and restore focus to trigger buttons.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: All tests pass.

- **Step 2: Update contrast verification tests for all new surface tokens**
  - Change: In `test/dashboard-ui.test.ts`:
    - Update `declared theme tokens meet the 4.5:1 text contrast requirement in both themes` to include all text tokens (`--text`, `--muted`, `--primary`, `--success`, `--warning`, `--error`, `--critical`, `--neutral`) evaluated against `--panel`, `--background`, `--surface-raised`, and `--surface-sunken` in both light and dark themes.
    - Verify non-text state indicators and series colors meet the 3:1 contrast requirement.
  - Verify: `node --test --test-name-pattern "contrast requirement" test/dashboard-ui.test.ts`
  - Expected: Both contrast tests pass with ratio >= 4.5:1 for text and >= 3:1 for graphical marks.

- **Step 3: Update static asset boundary assertions**
  - Change: In `test/dashboard-ui.test.ts`:
    - Verify `index.html` contains the 6 primary navigation tabs, header landmarks, skip link, and drawer container.
    - Verify `styles.css` contains required grid rules, drawer classes, focus indicators, and no `outline: none`.
    - Verify `app.js` and `dashboard-model.js` maintain the read-only security boundary: no `WebSocket`, `EventSource`, `setInterval`, `innerHTML`, or mutating fetch methods.
    - Verify normalized line endings in assertions so CRLF/LF mismatches on Windows do not manufacture false failures.
  - Verify: `node --test --test-name-pattern "static assets keep the approved accessible boundary" test/dashboard-ui.test.ts`
  - Expected: Static boundary test passes.

- **Step 4: Execute mutation proofs for core guards**
  - Change: In a disposable mirror or isolated edits, execute and record five mutation proofs:
    - M1: Invert `portfolioStatusBanner` so a blocked run reports `healthy`. Confirm test fails, restore byte-exactly.
    - M2: Modify `commandCenterKpis` so `releaseReady` counts blocked runs. Confirm test fails, restore byte-exactly.
    - M3: Modify `needsAttentionQueue` so data-quality issues outrank critical delivery blockers. Confirm test fails, restore byte-exactly.
    - M4: Modify `deliveryPipelineStages` so a failed verification stage reports `complete`. Confirm test fails, restore byte-exactly.
    - M5: Modify drawer focus trap to allow tab focus to escape. Confirm boundary test fails, restore byte-exactly.
  - Verify: `node --test test/dashboard-ui.test.ts`
  - Expected: Each mutation fails its targeted test; every restoration passes.

**Task completion evidence:** All automated test suites in `test/dashboard-ui.test.ts` pass; contrast verification confirms WCAG 2.2 AA compliance; all five mutation proofs fail and restore cleanly.

---

### Task 9: Operator Documentation, Boundary Verification, and Review

**Depends on:** Tasks 1 through 8

**Files:**
- Modify: `README.md` — operator guide for the redesigned command center
- Modify: `docs/features/dashboard-redesign-3/plan.md` — completion status and implementation notes
- Validate: `npm run typecheck`
- Validate: `npm run check:docs`
- Validate: `npm test`

**Steps:**

- **Step 1: Update operator-facing dashboard guidance in `README.md`**
  - Change: In `README.md`, update the dashboard operator documentation:
    - Describe the new Governed Delivery Command Center layout, primary navigation tabs (Overview, Runs, Findings, Governance, Models & Agents, Audit), and the 6-card KPI strip.
    - Document the Needs Attention queue and interactive Delivery Pipeline.
    - Explain the slide-over drawer progressive disclosure system and popover formulas.
    - Document keyboard navigation shortcuts and accessibility features.
    - Reaffirm the loopback read-only security boundary and copy-only command model.
  - Verify: `npm run check:docs`
  - Expected: Clean documentation check.

- **Step 2: Run complete repository validation**
  - Change: Run the complete test suite, strict typechecks for both TypeScript programs, and documentation checks.
  - Verify: `npm test`; `npm run typecheck`; `npm run check:docs`
  - Expected: All 1145+ tests pass, both TypeScript programs exit 0, and `check:docs` reports clean.

- **Step 3: Document completion and implementation notes**
  - Change: Update `docs/features/dashboard-redesign-3/plan.md` with implementation notes, deviations, and confirmed verification results.
  - Verify: `npm run check:docs`
  - Expected: Exit 0.

**Task completion evidence:** `README.md` reflects the command center capabilities; full test suite and typechecks pass clean; `check:docs` exits 0.

---

## Deferred Scope

- Agent execution duration until the authoritative read projection exposes it from `agent_runs` (operator deferral).
- Historical trend lines and sparklines until authoritative historical time-series storage exists.
- Agent-level model attribution until the read projection binds model identifiers to agent rows.
- Interactive dashboard mutation, approval signing, or remote multi-user access (violates Section 23 of `ARCHITECTURE.md`).
- WebSockets, background push polling, or server-side telemetry caching.
- Any paid provider invocation.

## Rollback

All changes are strictly confined to the static dashboard front-end files (`src/dashboard/index.html`, `src/dashboard/app.js`, `src/dashboard/dashboard-model.js`, `src/dashboard/styles.css`), dashboard UI tests (`test/dashboard-ui.test.ts`), and `README.md`. No database schemas, persisted tables, core operator read functions, or backend routes are modified. Reverting is a surgical git restore of these specific files. No data migration or state recovery is required.

## Implementation Notes

- **Shipped:**
  - Modern enterprise SaaS command center in `src/dashboard/` featuring 6-tab primary navigation (`#tab=overview`, `runs`, `findings`, `governance`, `models`, `audit`), horizontal 6-card KPI strip (`commandCenterKpis`), prioritized Needs Attention queue (`needsAttentionQueue`), 8-stage interactive Delivery Pipeline stepper (`deliveryPipelineStages`), Governance Health and Model Assignments panels, AI Governance and Data Quality panels, unified Governed Deliveries portfolio table, and slide-over progressive disclosure drawers (`openDrawer`/`closeDrawer`).
  - Strict compliance with read-only loopback architecture and Content Security Policy (`style-src 'self'` with zero inline styles, no WebSockets, no background timers, no mutation operations).
  - WCAG 2.2 AA accessibility with full keyboard navigation (`ArrowLeft`/`ArrowRight` between tabs, `?` for shortcuts modal dialog, `Escape` to close drawers/modals, focus trapping), visible focus rings, high contrast forced-colors support, and verified text (>= 4.5:1) and non-text (>= 3:1) color contrast.
  - Comprehensive unit, integration, and contrast tests in `test/dashboard-ui.test.ts` with all 5 mutation proofs (M1-M5) verified and restored cleanly.
  - Operator guide in `README.md` documenting navigation, drawer interaction, and keyboard controls.
- **Deviations:** None. All 9 tasks executed according to the approved plan and architecture constraints.
- **Deferred:**
  - Agent execution duration and agent-level model attribution (explicitly labeled as unavailable per Hazard 10 and operator deferral).
  - Historical time-series storage and trend sparklines (deferred until historical persistence exists).
  - Interactive mutation, approval signing, WebSockets, or background timers (strictly prohibited by Section 23 of `ARCHITECTURE.md`).

