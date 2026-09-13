# Code Review: Dashboard Enterprise Redesign

**Status:** reconciled

**Reviewed:** 2026-09-12

**Scope:** The complete uncommitted working-tree change implementing
`docs/features/dashboard-enterprise-redesign/plan.md` — the new
`src/dashboard/dashboard-model.js`, the rewritten `src/dashboard/app.js`,
`src/dashboard/index.html`, `src/dashboard/styles.css`, and
`test/dashboard-ui.test.ts`, plus the single-entry static-asset addition in
`src/dashboard-server.ts`, the widened `tsconfig.dashboard.json` include, the
allowlist assertions in `test/dashboard-server.test.ts`, and the new README
subsection.

**Reviewer independence:** A separate `code-review` agent performed the review
in its own context with the plan, the repository instructions, and
`.claude/sessions/project-learnings.md` supplied as input. It re-ran the
dashboard suite and recomputed the theme contrast ratios itself rather than
accepting the implementation's reported values. No same-agent role switch was
used.

**Hazards considered:** 2, because the review had to confirm the new
presentation exposes projected evidence availability without reconstructing raw
provider output; 4, because the new guards must be proved against real `Store`
rows and mutation rather than agreeable hand-written fixtures; 10, because
agent-level model must stay unavailable rather than being derived; 12, because
portfolio aggregation must not merge identity across configured repositories;
14, because recorded reviewer identity must not be strengthened into an
independence claim; and 18, because completed and verified states must stay
evidence labels.

## Findings

### Finding 1 — `aria-busy` is never cleared on the session-unavailable paths (Medium)

`src/dashboard/index.html` ships
`<main id="dashboard" tabindex="-1" aria-busy="true">`, and the normal render
path clears it once content is placed. The four early returns that terminate
into `showSessionExpired` did not. A screen reader therefore encountered a
region still marked busy at exactly the moment the application had finished and
placed its terminal message, which is the case where suppression is most
harmful: the user is told nothing, and no later render will arrive to correct
it.

**Disposition: accepted and fixed.** `showSessionExpired` now sets
`aria-busy="false"` on the target before `replaceChildren`, so the single
function every terminal path already routed through clears the attribute once.

### Finding 2 — the token chart conflates "reported zero" with "nothing reported" (Low)

`renderTokenChart` branched on `maximum === 0` and emitted a `<desc>` saying no
series is drawn, but the reported-zero case does draw baseline points. The
donut chart already carried a correct three-way state, so the token chart was
the inconsistent one. `TokenCoverage.known` is `null` exactly when
`reportedRows === 0`, so a stored `tokensIn: 0` is evidence of a zero, not an
absence of evidence, and describing it as "nothing reported" is the specific
honesty error this dashboard exists to avoid.

**Disposition: accepted and fixed.** `costChartSeries` now returns a three-way
`tokenState` (`"unavailable"` when no class reported at all, `"reported_zero"`
when every reported total is zero, `"available"` otherwise) alongside
`tokenMax`. `renderTokenChart` reads that state: on `"unavailable"` it emits a
callout and the exact data table rather than a chart, and on `"reported_zero"`
it uses baseline wording that names the zero as reported. Extracting the
existing data table into a `tokenTable(groups)` helper keeps the exact recorded
values reachable on both paths.

## Areas the reviewer examined and cleared

The reviewer confirmed each of the following against the source rather than the
implementation's description of it: the unavailable-versus-zero derivations
throughout `dashboard-model.js`, including the `CostTotals.knownUsd` case where
unavailability must come from `costReportedRows === 0`; out-of-window and
cross-repository slot isolation in `repositoryViews`; the `activityItems`
stage-order build, stable newest-first sort, and exactly-once `lastEvent` merge;
`costChartSeries` group ordering and numeric bounds; `parseNormativeChanges`
against what `insertFindingDecision` actually writes; refresh orchestration
against generation races and stale-slot adoption; DOM construction for injection
and element-ID uniqueness; the loopback, bearer, and GET-only server boundary,
with `src/operator-state.ts` and `src/operator-read.ts` confirmed unmodified;
run-window language that never reports a count outside the loaded window; and
the WCAG relative-luminance arithmetic in the contrast test, independently
recomputed to a lowest ratio of 4.55:1.

## Verification after remediation

`npm run typecheck` is clean across both programs.
`node --test test/dashboard-ui.test.ts test/dashboard-server.test.ts` reports
22 of 22 passing, including two regressions added for these findings: a
source-derived case proving a run whose agent row stores zero tokens yields
`tokenState: "reported_zero"` while an unreported run yields `"unavailable"`,
and a static-asset assertion that `showSessionExpired` clears `aria-busy`.

Both new guards were proved by mutation in a disposable mirror rather than
accepted on first pass. Collapsing `tokenState` to a two-way `tokenMax === 0`
test and deleting the `aria-busy` clear each failed the suite, and both files
restored byte-exactly with the baseline still green — eight of eight mutations
proved.
