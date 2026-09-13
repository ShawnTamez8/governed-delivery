# Dashboard Density and Triage Implementation Plan

**Status:** Implemented

**Goal:** Rework the read-only dashboard so a run opens on an executive summary that answers what happened, why it is in its current state, what it cost, and what to do next, with every other recorded value present behind a deliberate, collapsed disclosure and every label narrowed or repositioned rather than dropped.

**Source:** `.claude/sessions/2026-09-12-requirements-dashboard-density-triage.md`, including the four questions the operator closed on 2026-09-12 in its `## Open Questions` section. The dashboard authorization in `ARCHITECTURE.md` section 23 and the data and governance boundaries in `docs/features/dashboard/design.md` remain binding; `docs/features/dashboard-enterprise-redesign/plan.md` is the shipped implementation this plan modifies.

**Hazards considered:** 4 governs every new rule here — each formatting, collapse, ordering, and applicability guard takes its expected values from real `Store` rows read back through `readStatusResult`, never from a hand-written `RunSnapshot`, and each new guard is proved by breaking the behaviour it guards and restoring byte-exactly. 10 forbids deriving, aliasing, or normalising a recorded model identifier while collapsing the constant `Model` column: the collapsed statement reports the projection's own unavailability wording and every surviving model string stays verbatim and copyable. 13 is the reason the executive summary's next action is copied from `workflowAction` and its recorded `reasons` and the blocking finding is selected from projected finding records: inventing a remediation the projection never recorded is exactly the obligation-invention this entry describes. 14 keeps recorded reviewer identity a record and not an independence claim, so shortening reviewer and agent identifiers must not merge two reviewers into one row. 18 is why a shorter page may not become a more confident one — collapsing a section never upgrades "recorded" into "correct", and the two recorded limitations stay reachable from the summary region. 2 bears only indirectly: nothing here reads, serves, or reconstructs raw provider output, and truncation applies to projected identifiers, never to evidence contents.

**Assumptions:** A1-A5 of the requirements stand as written, with hash truncation fixed at twelve characters by the operator's answer to Open Question 2. Three further assumptions are needed to reconcile the section list in U4 with R1's rule that no recorded value may leave the page. First, `renderLimitations` is not one of U4's ten sections but its content is recorded, so it becomes a disclosure inside the executive summary region rather than a tenth top-level section; that keeps the top-level order byte-identical to U4 while satisfying R1. Second, the three cost and token charts and `renderCostCards` are one U4 section, "cost and tokens", because they are alternative presentations of the same recorded cost groups. Third, "persistent" in the In Scope line for governed actions means the region is unconditionally present in the run view, not that it is expanded: U5 is explicit that every section below findings is collapsed by default, and Open Question 3 removed stickiness. Severity ordering is read from the run's frozen `configuration.codeReview.severities`; where that is `null` the run recorded no severity order, and severity comparison is reported unavailable rather than ranked against a vocabulary the run never froze.

**Approach:** Add the new projection, formatting, ordering, and applicability rules to `src/dashboard/dashboard-model.js` as pure exported functions, keeping that module free of DOM, `window`, and `fetch` as N2 requires, and keeping `RunSnapshot`, `src/operator-state.ts`, and `src/operator-read.ts` untouched. Extend `snapshotProjection` with the envelope's `observedAt`, which R15's derived approval-window statement needs and the snapshot alone cannot supply. Then rewrite the run region of `src/dashboard/app.js` so it renders one executive summary, an expanded findings section, and eight collapsed native `<details>` sections in U4's order, and apply the same density and label-precision rules to the portfolio region. Finish with a light-theme accent and surface pass in `src/dashboard/styles.css` guarded by an extended contrast test. Every new rule is tested in `test/dashboard-ui.test.ts` against rows seeded into a real `Store` and read back through `readStatusResult` or `readRunsResult`.

**Affected areas:** `src/dashboard/dashboard-model.js` (new pure rules and one signature extension), `src/dashboard/app.js` (run and portfolio rendering), `src/dashboard/styles.css` (visual system and light-theme accents), and `test/dashboard-ui.test.ts` (new and extended guards). No change to routes, methods, headers, the Content-Security-Policy, the loopback binding, the bearer check, persistence, migrations, `RunSnapshot`, `src/operator-state.ts`, `src/operator-read.ts`, `src/dashboard-server.ts`, `src/dashboard-config.ts`, `tsconfig.dashboard.json`, or any CLI command.

**Known blockers:** No unresolved implementation blocker. Four verified constraints shape the work. The deferred `RunSnapshot` extension means `agentAnalytics` still binds no model, harness, or duration to an agent row, so R3's collapse must state that unavailability rather than fill it — the operator locked that deferral on 2026-09-12 and it is recorded in `.claude/sessions/project-learnings.md`. The Content-Security-Policy is `style-src 'self'` with no inline allowance, stated in the header comment of `src/dashboard/styles.css`, so no collapse, tone, or accent may be applied from script; every visual rule is a class or an SVG presentation attribute. The repository has no DOM test runner and no browser automation dependency — `test/dashboard-ui.test.ts` imports the modules directly and reads the static assets as text — so render-level rules are proved through the pure model functions plus source assertions over `app.js`, and viewport behaviour (U1, U18) is manual observation. The only chart-rich acceptance target is the retained paid run under a Windows per-session temp directory on a logoff deletion timer, recorded in `.claude/sessions/project-learnings.md`; it may be read for manual acceptance but nothing automated may depend on it, and its disappearance authorizes no paid run.

**Blast radius:** Verified by search, not inferred. `src/dashboard/dashboard-model.js` is imported by exactly two files: `src/dashboard/app.js` and `test/dashboard-ui.test.ts`; nothing in `src/` outside `src/dashboard/` imports it. `src/dashboard/app.js` is imported only by `test/dashboard-ui.test.ts` and loaded only by `src/dashboard/index.html`. `src/dashboard-server.ts` holds the exact static allowlist for all four dashboard assets and is unchanged by this plan because no asset is added or renamed. `test/dashboard-ui.test.ts` additionally reads `src/dashboard/index.html`, `src/dashboard/styles.css`, `src/dashboard/app.js`, and `src/dashboard/dashboard-model.js` as text in its boundary test, so a source-level assertion there is a real coupling to respect. `tsconfig.dashboard.json` includes `src/dashboard/*.js` and `test/dashboard-ui.test.ts` with `checkJs`, so every new JSDoc type in the model is type-checked. The integration boundaries the plan deliberately does not cross: the `RunSnapshot` contract in `src/operator-state.ts`, the `OperatorResult` envelope in `src/operator-output.ts`, the cross-column decision rule in `src/store.ts` `insertFindingDecision`, and the severity vocabulary in `src/finding.ts` — this plan reads the recorded consequences of all four and changes none of them.

**Verification:** `npm run typecheck` (strict `tsc --noEmit` plus the DOM-enabled `tsconfig.dashboard.json` program), `npm test` (`node --test test/*.test.ts`), and `npm run check:docs`. Every new model rule is asserted against rows seeded into a temporary `Store` and read back through `readStatusResult` or `readRunsResult`, following the existing `repository`, `newRun`, and `seedPartialRun` helpers in `test/dashboard-ui.test.ts`. Every new guard is proved by mutation: break the behaviour in the source, confirm the named test fails, restore byte-exactly and confirm it passes. Viewport, keyboard, forced-colors, reduced-motion, 200% zoom, and 320-pixel behaviour are observed manually against the retained paid-run target with no provider spend.

**Self-review:** One end-to-end critical pass was performed against the saved draft on 2026-09-12 and twelve material findings were reconciled inline; no separate review record was produced and no finding remains open. Three would have stopped an implementer outright and are called out here because they change what the tasks assert: Task 2's collapse proof originally keyed on `modelLabel`, which `agentAnalytics` hard-codes to `AGENT_MODEL_UNAVAILABLE` for every row of every run, so the assertion could never fail and proved nothing — it now keys on a column that genuinely varies, with the `modelLabel` constancy kept as a separately labelled statement about the current projection. Task 7's second repository originally reused the `repository` helper under one parent, which throws `EEXIST` because that helper hard-codes the directory name `target with spaces`; it now uses a separate `workspace()` root. Task 7's heading change originally read the loaded run list before `renderRepository` declares it, since the current code appends the `h3` first; the step now requires the reordering explicitly. The remaining nine tightened assertions that were trivially satisfiable, named fields whose recorded type is nullable without requiring a non-null check first, left `usd` call sites and the SVG `<desc>` interpolation unaccounted for when deleting that helper, or left an ambiguous field reference in a matrix assertion.

**Implementation note (2026-09-12):** All nine tasks shipped. The pure model
layer, the run view, the finding cards, the governed-actions region, the
portfolio, and the visual system are complete, with fifteen guards proved by
deliberate mutation (M1 through M15) and restored byte-exactly each time.
Verification at completion: `npm test` 1145 tests with 0 failures,
`npm run typecheck` exit 0 for both programs, `npm run check:docs` clean. The
independent code review is
`docs/features/dashboard-density-triage/2026-09-12-implementation-code-review.md`;
it returned five findings — none critical, none high — all accepted, fixed in
code, and guarded.

What deviated, all deliberate and all verified:

- `collapsibleSection` takes `(count, staleNote, build)` rather than the
  `(title, id, count, staleNote, build)` the task text implied. It calls
  `build()`, then moves the built section's own `<h2>` into the `<summary>` and
  the remaining children into a `.section-body`. Every existing element id and
  `tabIndex` therefore survives untouched, so the deep links and the `g r`,
  `g f`, and `g a` shortcuts keep resolving to the same elements.
- `collapsibleSection` registers `section.addEventListener("focus", ...)` to open
  a section a keyboard shortcut lands on, so a shortcut can never focus hidden
  content. This is the only `.open =` assignment in `app.js` and the boundary
  test pins that count at one, which is what would catch a collapse state
  restored from storage — the thing the read-only boundary forbids.
- Chart legends render `usdPresentation(...).display` as a plain string rather
  than a node, because no visually hidden span may be nested inside an SVG
  `<title>` or `<desc>`. The exact value stays in the adjacent disclosure table
  through `moneyNode`, so nothing recorded leaves the page.
- Task 8's per-tone wash tokens were not added. Per-tone distinction comes from
  the existing `tone-*` classes through `currentcolor`, which the widened
  contrast guard already covers; three tokens carry the surface and accent work
  instead — `--surface-raised`, `--surface-sunken`, and `--accent-wash` — in all
  three theme blocks. `--accent` was kept and is now referenced rather than
  deleted.
- Darkening surfaces forced three light-theme text tokens down to keep 4.5:1
  against the new sunken surface: `--muted` to `#5a6778`, `--success` to
  `#166534`, and `--warning` to `#92400e`. The threshold was never relaxed. The
  contrast guard was widened past the plan's pair list to the full product of
  nine text tokens against four surfaces, including the two new ones.
- The dead `.kpi-trend` rules were removed, since Task 7 removed the element
  they styled.

What was deferred: Task 8 Step 5's manual browser observation. The retained
paid-run target still exists, so the observation remains possible for the
operator, but a CLI agent cannot perform a visual check of focus rings, 200%
zoom, or a 320 CSS-pixel viewport. The mechanically checkable part of it was
converted into boundary assertions instead — no rule suppresses an outline, the
`:focus-visible` indicator rule stays unscoped so it reaches the new disclosure
summaries and copy buttons, and every `auto-fit` grid clamps its track with
`minmax(min(Xrem, 100%), 1fr)`. The visual confirmation is outstanding and
authorizes no paid run.

---

## Requirements coverage

Every rule in the source maps to at least one task. `R` is Business and Data
Rules, `U` is UI Requirements, `P` Permissions and Security, `E` Error
Handling, `X` Edge Cases, `N` Non-Functional.

| Requirement | Task |
|---|---|
| R1, R2 (presentation narrows, identifiers verbatim) | Tasks 1-7, asserted in Task 9 |
| R3, R5, R6, X6 (constant columns, coverage qualifier, empty collections) | Tasks 2, 5, 6, 7 |
| R4 (aggregated unavailability) | Tasks 2, 5, 7 |
| R7, R8, R9, R10, X8, A2 (money, identity strings, timestamps) | Tasks 1, 5 |
| R11, R12, U8-U11, A1 (finding precision, ordering, cards) | Tasks 3, 6 |
| R13, R14, U1-U3, X1-X5, A5 (executive summary) | Tasks 4, 5 |
| R15 (derived approval window) | Tasks 4, 5 |
| R16 (four token classes) | Tasks 2, 5 |
| U4-U7, E1-E3 (section order, disclosure, staleness) | Task 5 |
| U12-U15 (governed actions, repository identity, notes, writer lock) | Tasks 6, 7 |
| U16-U18 (visual system, light theme, retained accessibility) | Task 8 |
| Portfolio density pass, X7 (Open Question 4) | Task 7 |
| P1-P4 (read-only boundary unchanged) | Asserted in Task 9 |
| N1-N5 (no new dependency, pure model, real rows, mutation proof) | Every task; consolidated in Task 9 |

## Module boundary for this work

`src/dashboard/dashboard-model.js` gains every rule that decides *what* is
shown: rounding, truncation, ordering, applicability, collapse eligibility, and
summary derivation. `src/dashboard/app.js` gains only the DOM that renders
those decisions. A rule that could be asserted without a browser belongs in the
model; this is what makes the acceptance criteria testable at all, given the
repository has no DOM test runner.

Two rules deliberately stay in `app.js` because they are DOM facts rather than
projection facts: which element is a native disclosure, and which class carries
a tone. Both are asserted through source-text assertions in the existing static
boundary test rather than through the model.

## Tasks

### Task 1: Money, identity-string, and timestamp primitives

**Depends on:** None

**Files:**
- Modify: `src/dashboard/dashboard-model.js` — new exports beside `tokenTotal`
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Add the monetary rule (R7).**
  - Change: export `usdPresentation(value)` returning
    `{ available: boolean, display: string, exact: string }`. When `value` is
    `null`, return `{ available: false, display: "Unavailable", exact: "Unavailable" }`.
    Otherwise `display` is the value passed through `toFixed(2)` with a leading
    dollar sign, and `exact` is the stored float interpolated unchanged — the
    exact form the current `usd()` helper in `src/dashboard/app.js` produces, so
    nothing is lost. The function must not round, re-derive, or sum; it receives
    an already aggregated value.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Add the identity-string rule (R8, X8, A2).**
  - Change: export `IDENTITY_FRAGMENT_LENGTH` with the value 12 and
    `identityPresentation(value, length = IDENTITY_FRAGMENT_LENGTH)` returning
    `{ available: boolean, display: string, full: string, truncated: boolean }`.
    A `null` or empty `value` returns `available: false`, a `display` of
    `Not recorded`, an empty `full`, and `truncated: false`. A value whose
    length is less than or equal to `length` returns it unchanged with
    `truncated: false` and no padding. A longer value returns its first
    `length` characters followed by a single ellipsis character as `display`,
    the untouched string as `full`, and `truncated: true`. A value exactly one
    character longer than `length` is truncated — assert that boundary directly.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Add the artifact-comparison rule (R9).**
  - Change: export `artifactChange(before, after)` returning
    `{ before, after, equal: boolean | null, statement: string }` where `before`
    and `after` are `identityPresentation` results. When either recorded value
    is absent, `equal` is `null` and `statement` names which side is not
    recorded. When both are present and identical, `equal` is `true` and
    `statement` says the recorded artifact is unchanged because both hashes are
    identical. When both are present and differ, `equal` is `false` and
    `statement` says the recorded artifact changed because the hashes differ.
    Both full hashes stay reachable through the returned presentations, so R8's
    rule that a by-eye comparison is replaced by a stated result — not by
    hiding a value — holds.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Add the timestamp rules (R10).**
  - Change: export `timestampPresentation(value, timeZone)` returning
    `{ available: boolean, utc: string, display: string }`. `utc` is the
    recorded string byte-for-byte. `display` is produced by
    `Intl.DateTimeFormat` with a medium date style, a medium time style, and the
    supplied `timeZone`, left `undefined` by default so the viewer's zone is
    used. An unparseable or `null` value returns `available: false`, an empty
    `utc`, and a `display` of `Unavailable`, and never throws. Also export
    `latestTimestamp(entries)` taking objects of `{ label, value }` and
    returning `{ latest, others }`, choosing the greatest parseable timestamp as
    `latest` and preserving input order among the others. This is what collapses
    created, updated, and last-recorded activity to one visible line with the
    rest behind the run's detail disclosure.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Prove the rules against real rows.**
  - Change: in `test/dashboard-ui.test.ts`, add a test named
    `monetary, identity, and timestamp presentation narrow without altering a recorded value`.
    Seed a run through the existing `repository` and `newRun` helpers, then open
    the store, insert one stage and two agent rows under **two distinct agent
    identifiers** — the distinct names are required, because `cost.byAgent`
    groups by agent and the per-agent assertion below needs two separate groups
    — whose recorded costs are `0.5452318` and `0.26745660000000004`. Close the
    store and read the snapshot back with `readStatusResult`. Assert that each
    per-agent cost display carries exactly two decimal places and that the
    `0.5452318` group displays two decimals while its `exact` field still
    carries the unrounded recorded value. Assert that the run aggregate's
    `exact` equals the store-read `snapshot.cost.knownUsd` interpolated
    directly, which is what proves the aggregate is the stored sum and not a sum
    of rounded components. Assert that `snapshot.cost.knownUsd` and each
    `snapshot.cost.byAgent[i].knownUsd` are unchanged after the calls. Assert
    `identityPresentation` over a long identifier taken from the recorded
    snapshot — `snapshot.configuration.profileHash` or
    `snapshot.configuration.startingCommit`, both of which are `string | null`
    in `src/operator-state.ts`, so assert the chosen source is non-null before
    using it rather than letting the test pass silently on a `null` — yields a
    thirteen-character `display` whose `full` is the recorded string, and that a
    twelve-character and a thirteen-character input differ in `truncated`.
    Assert that `timestampPresentation(snapshot.run.createdAt, "UTC").utc`
    equals `snapshot.run.createdAt` exactly and that the `display` produced with
    `UTC` differs from the one produced with `America/New_York`, proving the
    local-zone rendering is real while the recorded value is untouched. Assert
    `latestTimestamp` over the run's created, updated, and last-recorded
    activity values returns the greatest as `latest`. `artifactChange` is not
    proved here: it needs a seeded finding decision, whose full seeding is
    specified in Task 3 Step 6, and duplicating that setup in two tests would
    create two places to keep correct.
  - Verify: `node --test --test-name-pattern "monetary, identity, and timestamp" test/dashboard-ui.test.ts`
  - Expected: The test passes.

- **Step 6: Prove the guards by mutation (N4).**
  - Change: apply one mutation at a time — change the two-decimal rounding to
    four decimals; change the truncation length comparison so an equal-length
    value is truncated; return a re-serialized ISO string as `utc` instead of
    the recorded string verbatim.
  - Verify: after each single mutation, run
    `node --test --test-name-pattern "monetary, identity, and timestamp" test/dashboard-ui.test.ts`,
    then restore the exact original text and rerun. `git diff` cannot confirm
    the restoration: `src/dashboard/dashboard-model.js` is untracked on this
    branch, so a tracked-only diff reports nothing and would pass vacuously.
    Confirm instead that the file contains none of the mutation strings.
  - Expected: Each mutation fails the test with a named assertion; each
    restoration passes.

**Task completion evidence:** `usdPresentation`, `identityPresentation`, `artifactChange`, `timestampPresentation`, and `latestTimestamp` exist and are exported; the new test passes against store-read values; each of the three mutations failed and each restoration passed.

### Task 2: Constant-column collapse, coverage qualifiers, and four token classes

**Depends on:** Task 1

**Files:**
- Modify: `src/dashboard/dashboard-model.js` — new exports, and `agentAnalytics`
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Add the constant-column rule (R3, X6).**
  - Change: export `constantColumn(rows, accessor)` returning
    `{ constant: boolean, value, rowCount }`. Zero rows return
    `constant: false` with a `null` value and a zero count — a column with no
    rows is not a constant column, and R6 already governs the empty case. One or
    more rows return `constant: true` only when every accessed value is strictly
    equal to the first. The function takes rows, so it is evaluated per render
    and never per column definition, which is exactly what X6 requires.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Add the collapse statement helper (R3, R4).**
  - Change: export `collapsedColumnStatement(columnLabel, value, rowCount)`
    returning a single sentence naming the column it replaces, the recorded
    value verbatim, and the row count it covers. The value is interpolated
    unchanged, so R2 holds: the recorded identifier is still rendered verbatim
    and is still selectable text.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Add the coverage-qualifier rule (R5).**
  - Change: export `coverageQualifier(entry)` taking an object with
    `reportedRows` and `unreportedRows` and returning the existing parenthetical
    wording only when `unreportedRows` is greater than zero, and `null`
    otherwise. Export `fullCoverageStatement(entries)` returning one
    section-level sentence when every entry reports zero unreported rows and
    `null` otherwise, so R5's second branch is available without a per-cell
    qualifier.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Name the token-class completeness rule (R16).**
  - Change: `agentAnalytics` already returns `tokens: tokenTotal(group)`, whose
    `classes` array carries all four classes in `TOKEN_CLASSES` order, so the
    projection shape needs no change and must not be changed. The omission is a
    render defect, fixed in Task 5. Export `AGENT_TOKEN_CLASS_NOTE`, one
    sentence stating that input, output, cache-read, and cache-write totals are
    reported separately and that an input total shown without its cache-read
    counterpart misrepresents the run, so the render layer has one authoritative
    sentence rather than an invented one.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Prove the rules against real rows.**
  - Change: add a test named
    `constant columns collapse per render and coverage qualifiers appear only where a row is unreported`.
    Prove the collapse rule on a column that can genuinely vary, not on one that
    is hard-coded: `modelLabel` is the constant `AGENT_MODEL_UNAVAILABLE` for
    every row of every run, so a test that only asserts it is constant can never
    fail and proves nothing. Seed one run whose agent rows all record the same
    execution count and assert `constantColumn` over `agentAnalytics(snapshot)`
    keyed on `executions` reports `constant: true` with the correct row count;
    seed a second run in the same temporary workspace whose agent rows record
    different execution counts and assert the same accessor reports
    `constant: false`. Separately, and labelled as a statement about the current
    projection rather than about the rule, assert `constantColumn` keyed on
    `modelLabel` is `constant: true` — that is the condition the render layer
    relies on, and it should fail loudly if the deferred `RunSnapshot` extension
    ever lands. Assert `coverageQualifier` returns `null` for a fully reported
    group and a non-null string for the partially reported group the existing
    `seedPartialRun` helper creates, whose second agent row reports no tokens.
    Assert each agent row's `tokens.classes` has length four and that its keys
    equal the keys of `TOKEN_CLASSES`.
  - Verify: `node --test --test-name-pattern "constant columns collapse" test/dashboard-ui.test.ts`
  - Expected: The test passes.

- **Step 6: Prove the guards by mutation (N4).**
  - Change: apply one mutation at a time — make `constantColumn` report
    `constant: true` for zero rows; relax `coverageQualifier` so it returns a
    string when `unreportedRows` is zero.
  - Verify: after each single mutation run
    `node --test --test-name-pattern "constant columns collapse" test/dashboard-ui.test.ts`,
    then restore byte-exactly and rerun.
  - Expected: Each mutation fails; each restoration passes.

**Task completion evidence:** `constantColumn`, `collapsedColumnStatement`, `coverageQualifier`, `fullCoverageStatement`, and `AGENT_TOKEN_CLASS_NOTE` exist; the new test passes against two runs read from a real store; both mutations failed and both restorations passed.

### Task 3: Finding precision, applicability, and ordering

**Depends on:** Task 1

**Files:**
- Modify: `src/dashboard/dashboard-model.js` — `findingCard` and new exports
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Encode the disposition field matrix (R11).**
  - Change: export `decisionFieldApplicability(disposition)` returning
    `{ grounding, normativeChanges }`, each either `required` or `forbidden`.
    `grounding` is `required` exactly when the disposition is
    `rejected_with_rationale` and `forbidden` otherwise; `normativeChanges` is
    `required` exactly when the disposition is `addressed` and `forbidden`
    otherwise. These are the two cross-column rules `insertFindingDecision`
    enforces in `src/store.ts`; the dashboard restates their consequence and
    never re-validates the record. Export
    `forbiddenFieldStatement(fieldLabel, disposition)` returning one sentence
    saying the field does not apply under the recorded disposition, so the
    render layer never prints an absence label for a structurally impossible
    field.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Extend `findingCard` (R9, R11, A1, U8).**
  - Change: inside `findingCard`, add to the returned object a `title` from
    `readableIntent(finding.intentKey)`, an `applicability` from
    `decisionFieldApplicability` (or `null` when there is no decision), and an
    `artifact` from `artifactChange` over the decision's recorded before and
    after hashes (or `null` when there is no decision). Keep `intentKey` on the
    card unchanged so R2 holds — the readable title accompanies the recorded key
    and never replaces it. Export `readableIntent(intentKey)` performing
    separator and capitalisation formatting only: hyphens and underscores become
    spaces and the first character is upper-cased, and nothing else changes.
    Keep every existing `findingCard` field, including `reports`, `decision`,
    and `finalPanelBlocking`, exactly as it is: `test/dashboard-ui.test.ts`
    already asserts the card's `reports` deep-equals the finding's.
  - Verify: `node --test --test-name-pattern "finding cards keep every report separate" test/dashboard-ui.test.ts`
  - Expected: The existing test still passes, proving the extension is additive.

- **Step 3: Derive severity from the frozen vocabulary (U11, X3).**
  - Change: export `severityOrder(configuration)` returning the run's own frozen
    ascending severity list from `configuration.codeReview`, or `null` when that
    is `null`. That frozen list is what `src/code-review.ts` indexes when it
    picks a finding's highest severity, so the dashboard uses the same order the
    gate used. Export `cardSeverity(card, severities)` returning
    `{ available, severity, rank }`: with a `null` list or no report,
    `available` is `false`; otherwise it is the highest-indexed severity across
    the card's reports, with a severity absent from the frozen list reported
    through `available: false` rather than silently ranked. Nothing here invents
    a severity vocabulary the run did not freeze.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Order findings (U11).**
  - Change: export `orderFindings(cards, severities)` returning a new array
    sorted by, in order: findings whose `finalPanelBlocking` is `true` first;
    then descending `cardSeverity` rank, with unavailable ranks last; then
    ascending recorded identifier. Export `FINDING_ORDER_STATEMENT`, the single
    sentence the section states about its own ordering, so U11's requirement
    that the rule be stated comes from one place. Do not mutate the input array:
    the projection's `findingCards` must keep the authoritative order that
    `test/dashboard-ui.test.ts` asserts against `snapshot.evidence.findings`.
  - Verify: `node --test --test-name-pattern "snapshot projection preserves authoritative arrays" test/dashboard-ui.test.ts`
  - Expected: The existing 250-finding assertion still passes.

- **Step 5: Aggregate final-panel unavailability (R12).**
  - Change: export `finalPanelBlockingSummary(cards)` returning
    `{ shown, nullCount, statement }`, where `shown` holds only cards whose
    `finalPanelBlocking` is non-null and `statement` is non-null only when
    `nullCount` is greater than zero, naming how many findings carry no
    projected final-panel result. The render layer shows the per-finding value
    only for the `shown` set.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 6: Prove the rules against real rows.**
  - Change: add a test named
    `a decision field the recorded disposition forbids is never reported as missing`.
    Seed a run and insert, through the store, two canonical findings on the same
    stage: one decided `addressed` with a `null` grounding and a normative-change
    array, and one decided `rejected_with_rationale` with a grounding object and
    `null` normative changes. Both shapes are exactly what `insertFindingDecision`
    permits; the inverse would throw, which is the point. Read back through
    `readStatusResult` and assert the addressed finding's `applicability`
    reports `grounding: "forbidden"` and `normativeChanges: "required"`, and the
    rejected finding's reports `grounding: "required"` and
    `normativeChanges: "forbidden"`. Assert `forbiddenFieldStatement`
    contains neither the absence label `Not recorded` nor the
    normative-change absence label the current card renders. Seed a third
    decision whose recorded before and after artifact hashes are two distinct
    64-character strings and a fourth whose before and after hashes are equal,
    and assert the corresponding cards' `artifact.equal` is `false` and `true`
    respectively, that each `statement` names the recorded outcome in words, and
    that both `full` values remain the recorded strings — this is where
    `artifactChange` from Task 1 Step 3 is proved, because the seeded finding
    and decision it needs exist only here. Add a
    second test named
    `findings order blocking first, then severity, then recorded identifier`
    seeding at least three findings with differing recorded severities and a tie
    at the highest severity, and assert `orderFindings` produces the documented
    order and that a tie resolves to the lower recorded identifier. Assert
    `finalPanelBlockingSummary` counts the findings with no projected result and
    that no card in `shown` carries a `null` value.
  - Verify: `node --test --test-name-pattern "a decision field the recorded disposition forbids" test/dashboard-ui.test.ts`
    then `node --test --test-name-pattern "findings order blocking first" test/dashboard-ui.test.ts`
  - Expected: Both tests pass. Run the two patterns as separate invocations of
    `node` rather than one alternation through another shell: a shell-interposed
    `--test-name-pattern` has previously lost alternation and grouping
    characters in this repository.

- **Step 7: Prove the guards by mutation (N4).**
  - Change: apply one mutation at a time — invert one branch of
    `decisionFieldApplicability` so `addressed` reports grounding as `required`;
    change `orderFindings`'s final comparator from ascending to descending
    identifier; make `finalPanelBlockingSummary` include the null findings in
    `shown`.
  - Verify: after each single mutation run the two named tests, then restore
    byte-exactly and rerun.
  - Expected: Each mutation fails; each restoration passes.

**Task completion evidence:** `decisionFieldApplicability`, `forbiddenFieldStatement`, `readableIntent`, `severityOrder`, `cardSeverity`, `orderFindings`, `FINDING_ORDER_STATEMENT`, and `finalPanelBlockingSummary` exist; both new tests pass against store-read decisions of both permitted shapes; all three mutations failed and all three restorations passed; the two pre-existing finding tests still pass unchanged.

### Task 4: Executive summary projection and the derived approval window

**Depends on:** Tasks 1, 2, 3

**Files:**
- Modify: `src/dashboard/dashboard-model.js` — new exports and `snapshotProjection`
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Extend `snapshotProjection` with the observation time (R15).**
  - Change: add a fourth parameter `observedAt`, defaulted to `null`, after the
    existing `platform` parameter. Because it is last and defaulted, the three
    existing call sites — two assertions in `test/dashboard-ui.test.ts` and the
    one in `render` in `src/dashboard/app.js` — keep compiling unchanged. Task 5
    passes the envelope's `observedAt` from `app.js`.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Derive the approval window (R15).**
  - Change: export `approvalWindow(approval, observedAt)` returning
    `{ state, closed, statement, derivedFrom }`. `state` is passed through
    verbatim and is never contradicted — a granted approval whose window has
    closed still displays granted. `closed` is `true` only when both the
    recorded `expiresAt` and the supplied `observedAt` parse and the expiry
    precedes the observation; it is `null` when either is absent or
    unparseable. When `closed` is `true`, `statement` says the recorded approval
    window has closed and `derivedFrom` names the two recorded timestamps it was
    derived from, so the render layer can label the statement as derived.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Derive the repository display identity (U13, A4, X7).**
  - Change: export `repositoryIdentity(path, runs)` returning
    `{ display, source, canonicalPath }`. With a non-empty `runs` array,
    `display` is the first run summary's recorded `project` and `source` is
    `project`. Otherwise `display` is the final non-empty segment of `path`
    after splitting on both forward and backward slashes and `source` is
    `path_segment`. `canonicalPath` is always the unmodified `path`: R2 and U13
    both require the canonical path to remain the repository's identity,
    available verbatim.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Build the executive summary (R13, R14, U2, U3, X1-X5, A5).**
  - Change: export `runExecutiveSummary(snapshot, options)` where `options`
    carries `repositoryPath`, the loaded `runs` summaries, and `observedAt`.
    Return:
    - `run`: the recorded identifier, project, feature, and slug, each verbatim.
    - `state`: `statusPresentation(snapshot.run.status, snapshot.phase)`, the
      existing authoritative vocabulary, unchanged.
    - `blockingFinding`: computed only from `snapshot.evidence.findings` mapped
      through `findingCard` and ordered by `orderFindings`. Select the first
      card whose `finalPanelBlocking` is `true`. Where none has it, select the
      highest-severity card by `cardSeverity` and report
      `finalPanelProjected: false` so X2's wording is available. Report
      availability, severity, recorded location, stage, round, identifier,
      title, and a `tiedWith` count of the other cards that share the selected
      severity *within the selected group* — among the blocking cards where a
      blocking card was selected, and across all cards otherwise — satisfying
      X3, and the selected card is the lowest identifier among them because
      `orderFindings` already breaks ties that way. With zero
      findings, report unavailable with a reason naming the zero count (X1).
      When `severityOrder` is `null` because the run froze no code-review
      profile, report the severity unavailable and select the first card in
      `orderFindings` order rather than ranking against a vocabulary the run
      never froze.
      This function must not read any string from
      `snapshot.workflowAction.reasons` for any part of this selection.
    - `cost`: `usdPresentation` over the run's aggregate, passing `null` when
      `snapshot.cost.costReportedRows` is zero, so X5's unavailable case never
      shows a zero.
    - `tokens`: `tokenTotal(snapshot.cost)`, whose `known` is `null` when no
      class reported and zero when every reported class is zero — X4's existing
      three-way distinction reused rather than re-derived (A5).
    - `repository`: `repositoryIdentity(options.repositoryPath, options.runs)`.
    - `nextAction`: the group, eligibility, reasons, command, and argument
      vector copied from `snapshot.workflowAction`. No text is generated,
      rewritten, or inferred (R14).
    - `unavailable`: one entry per unavailable row above, plus a `grouped`
      array collapsing rows that share one reason into a single statement (U3).
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Attach the approval window to the projection.**
  - Change: in `snapshotProjection`, add `approvalWindow` to the returned
    `governance` object and leave every other returned field exactly as it is.
    Do not attach `runExecutiveSummary` to `snapshotProjection`: it needs the
    repository path and the loaded run summaries, which live in application
    state, so `app.js` calls it directly.
  - Verify: `node --test --test-name-pattern "snapshot projection preserves authoritative arrays" test/dashboard-ui.test.ts`
  - Expected: The existing test passes, proving the addition did not disturb
    `governance.configuration`, `governance.approval`, or the command array.

- **Step 6: Prove the rules against real rows.**
  - Change: before writing the severity assertions, read back one seeded
    snapshot and confirm `snapshot.configuration.codeReview` is non-null. Where
    the existing helpers do not freeze a code-review profile, either extend the
    seeding to freeze one exactly as the production path does, or assert the
    `null` branch instead — `severityOrder` returning `null` and `cardSeverity`
    reporting `available: false`. Do not invent a severity list in the test:
    the frozen configuration is the only source of that order.
    Then add a test named
    `the executive summary is derived from projected records, never from the eligibility prose`.
    Seed a run and insert stages and findings so that **at least two** findings
    project `finalPanelBlocking: true` with different recorded severities —
    one blocking finding alone would satisfy the selection assertion trivially
    and prove nothing about ranking. Read back through
    `readStatusResult`, and assert: the selected blocking finding's identifier
    is the blocking finding whose recorded reports carry the highest severity in
    the run's own frozen `configuration.codeReview.severities`, not the first
    seeded or the lowest identifier; the summary's
    `nextAction.reasons` deep-equals `snapshot.workflowAction.reasons`; and the
    summary's next-action text is a member of the recorded reason strings rather
    than any generated sentence. Add a second assertion block on a run with zero
    findings proving the blocking finding is reported unavailable (X1), and one
    covering a run whose agent rows record zero tokens against one whose rows
    record none, proving the summary reports zero in the first case and
    unavailable in the second (X4) — the existing test named
    `a run that reported zero tokens is distinguished from a run that reported none`
    already seeds both shapes and its helper pattern should be reused. Add a
    test named
    `a closed approval window is derived without contradicting the recorded state`
    inserting an approval whose recorded expiry precedes a supplied observation
    time, and assert `closed` is `true`, `state` is unchanged, and `derivedFrom`
    names both recorded timestamps.
  - Verify: `node --test --test-name-pattern "the executive summary is derived" test/dashboard-ui.test.ts`
    then `node --test --test-name-pattern "a closed approval window is derived" test/dashboard-ui.test.ts`
  - Expected: Both tests pass.

- **Step 7: Prove the guards by mutation (N4).**
  - Change: apply one mutation at a time — make `runExecutiveSummary` select the
    blocking finding by scanning the workflow reason strings for a findings
    count; make the cost row fall back to zero when no row reported; make
    `approvalWindow` overwrite `state` when `closed` is `true`.
  - Verify: after each single mutation run the two named tests, then restore
    byte-exactly and rerun.
  - Expected: Each mutation fails; each restoration passes.

**Task completion evidence:** `approvalWindow`, `repositoryIdentity`, and `runExecutiveSummary` exist; `snapshotProjection` carries the approval window and the fourth parameter; the two new tests and every pre-existing projection test pass; all three mutations failed and all three restorations passed.

### Task 5: Run view — executive summary region, U4 section order, and disclosure

**Depends on:** Task 4

**Files:**
- Modify: `src/dashboard/app.js` — `render`, plus new and reshaped section renderers
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Add the disclosure section helper (U5, U6, U7, E1).**
  - Change: add `collapsibleSection(title, id, count, staleNote, build)`
    returning a section element carrying the given id and containing a single
    native disclosure whose summary line carries the section name, the count
    where the section has a countable body, and — when `staleNote` is non-empty
    — the stale or unavailable indicator and its reason. Invoke `build`
    immediately and append its result inside the disclosure, so expanding
    performs no network read and requires no refresh (U6). Do not set the open
    attribute and do not read or write collapse state anywhere: U7 makes it
    presentation only, so `parseRoute` and `routeHash` in
    `src/dashboard/app.js` must stay unchanged and the deep link must never
    encode it.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Add the copy-affordance helper (R1, R2, R8, P2).**
  - Change: extract the clipboard logic currently inline in `renderGovernance`
    into `copyControl(label, value, application)` returning a button that writes
    `value` to the clipboard and reports success or failure through
    `application.live.textContent`, preserving the existing wording. Add
    `identityNode(presentation, label, application)` rendering the truncated
    `display` as visible text, the `full` value in a visually hidden span, and a
    `copyControl` for the full value. This is the single mechanism that
    satisfies R8's requirement that a shortened value stay available to
    assistive technology and through a copy affordance. The button places text
    on the clipboard and does nothing else (P2).
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Build the executive summary region (U1, U2, U3, E3).**
  - Change: add `renderExecutiveSummary(summary, projection)` producing a panel
    with the existing `run-summary` id — reused so the skip link and the run
    shortcut destination keep working — containing, in order: a heading line
    with run identity, project, and the state badge; a compact grid of the
    blocking finding with its severity badge, recorded location, stage and
    round, total known cost, total known tokens, the repository display
    identity, and the projected next action with its eligibility; one line per
    unavailable row, with grouped unavailability rendered as a single statement
    per shared reason; a disclosure labelled `Run detail` holding the remaining
    run fields — slug, change kind, persisted status, derived phase, the
    non-latest timestamps from `latestTimestamp`, and the verbatim workflow
    eligibility reason strings; and a disclosure labelled
    `Recorded limitations` with its count, holding the existing
    `renderLimitations` body. Remove `renderSummary` once its content has moved,
    including its flat definition list and its writer-lock block, whose
    replacement is specified in Task 6 Step 5. Where the snapshot is
    unavailable, the caller already states that in place of the summary through
    the early returns in `render`; leave those returns unchanged (E3).
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Reorder and collapse the run sections (U4, U5, E1, E2).**
  - Change: in `render`, replace the current fourteen-argument append for the
    selected run with, in exactly this order: the executive summary; the
    findings section, expanded, per the operator's answer to Open Question 1;
    then eight `collapsibleSection` calls titled `Governed actions`,
    `Cost and tokens`, `Workflow timeline`, `Activity`, `Agent analytics`,
    `Frozen configuration and approval`, `Delivery`, and `Evidence`.
    `Cost and tokens` builds `renderCostCards`, `renderStageCostChart`,
    `renderAgentCostChart`, and `renderTokenChart` into one body, so no chart
    and no data table is lost. Pass each section its count: projected commands,
    cost groups, stages, activity items, agent groups, proposals, the count of
    recorded delivery artifact paths the projected delivery record carries, and
    evidence references respectively. Pass
    `resourceStatus(slot.resource)` as `staleNote` to every section so a stale
    or unavailable read shows on each collapsed summary line (E1); keep the
    existing top-level callout as well, and keep the surrounding per-repository
    loop untouched so one repository's failure still cannot affect another (E2).
    Keep the ids `runs`, `findings`, and `governance` on their sections so
    `shortcutDestination` keeps resolving. Pass the slot envelope's `observedAt`
    into `snapshotProjection` as its new fourth argument.
  - Verify: `node --test --test-name-pattern "keyboard policy suppresses editable targets" test/dashboard-ui.test.ts`
  - Expected: The existing shortcut test passes, confirming the three shortcut
    destinations are still the ones the run view renders.

- **Step 5: Apply the density rules inside the moved sections (R3-R5, R7, R8, R10, R15, R16).**
  - Change: in `renderAgentTable`, replace the `Model` and `Trend` columns with
    two `collapsedColumnStatement` lines where `constantColumn` reports them
    constant, and keep the columns where it does not. Replace the two token
    columns with four — input, output, cache read, and cache write — read from
    each row's `tokens.classes`, appending `coverageQualifier` only where it
    returns a non-null value and stating `fullCoverageStatement` once for the
    section otherwise. Place `AGENT_TOKEN_CLASS_NOTE` inside the section's
    disclosure. Across every section in the run view, replace `usd(...)` with
    `usdPresentation(...)`, rendering `display` as visible text and `exact` in a
    visually hidden span, and replace `timeNode` with a node carrying the local
    `display` as text, the recorded `utc` in the `datetime` attribute, and the
    recorded `utc` in a visually hidden span. Delete the now-unused `usd`
    helper — which requires first updating every one of its call sites in
    `renderCostCards`, `renderStageCostChart`, `renderAgentCostChart`, and
    `renderAgentTable`. Inside an SVG `<title>` or `<desc>`, where no visually
    hidden span may be nested, render the two-decimal `display` alone; the exact
    value stays reachable in that chart's adjacent data table, which each chart
    renderer already produces. Apply the same rule to the raw interpolated axis
    maximum in each chart description, which is currently printed unrounded.
    In `renderConfiguration`, render the profile hash, policy hash,
    starting commit, and the approval's specification hash, profile hash, and
    starting commit through `identityNode`, and render the derived approval
    window from `projection.governance.approvalWindow` beside the verbatim state
    badge, labelled as derived from the two recorded timestamps (R15). Collapse
    the model map to a `collapsedColumnStatement` where `constantColumn` finds
    one value across all rows, keeping the table where it does not.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 6: Prove the render-level rules by source assertion.**
  - Change: extend the existing test named
    `static assets keep the approved accessible boundary and omit unauthorized transports`
    with assertions over the `app.js` text: it declares `collapsibleSection`; it
    no longer declares the `usd` helper; it calls `usdPresentation`,
    `identityNode`, and `collapsedColumnStatement`; and it never assigns the
    open property of a disclosure element, which is what keeps U5's default
    collapsed and U7's presentation-only rule honest. Keep every existing
    assertion in that test unchanged.
  - Verify: `node --test --test-name-pattern "static assets keep the approved accessible boundary" test/dashboard-ui.test.ts`
  - Expected: The test passes.

- **Step 7: Observe the run view manually (U1, U6).**
  - Change: none. Launch the dashboard against the retained paid-run target
    recorded in `.claude/sessions/project-learnings.md`, using the documented
    read-only launch command in `README.md`, and observe at 1440 by 900 CSS
    pixels.
  - Verify: the executive summary is the first content in the run region; the
    run state, blocking finding severity and location, total known cost, total
    known tokens, and projected next action are all readable without scrolling;
    and expanding each of the eight disclosures produces content with no request
    in the browser's network panel.
  - Expected: All three observations hold. If the retained target is gone,
    record that the manual observation could not be performed; that does not
    authorize a paid run.

**Task completion evidence:** The run region renders the executive summary, an expanded findings section, and eight collapsed disclosures in U4's order; the extended static-asset test passes; the shortcut and server boundary tests pass unchanged; the manual observation is recorded, or its impossibility is.

### Task 6: Finding cards and governed actions

**Depends on:** Tasks 3, 5

**Files:**
- Modify: `src/dashboard/app.js` — `renderFindings`, `renderGovernance`
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Restructure the finding card (U8, U9, U10, U11).**
  - Change: in `renderFindings`, order the cards with `orderFindings` and state
    `FINDING_ORDER_STATEMENT` once in the section. Each card's collapsed body
    presents only the severity badge from `cardSeverity`, the readable title
    with the recorded intent key alongside it as copyable text, the recorded
    location, the stage and round, the recorded disposition or an open indicator
    where the decision is `null`, and the final-panel blocking value only where
    it is non-null. Report subject text stays at card level, verbatim and
    untruncated (U9) — do not route it through `identityPresentation`. Move the
    artifact hashes, normative changes, grounding, rationale, changed locations,
    and agent-run identifiers into one disclosure per card (U10). Render the
    artifact pair through the card's `artifact`, showing the statement in words
    and both hashes through `identityNode` (R9).
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Apply the applicability rule (R11).**
  - Change: inside the card disclosure, branch on the card's `applicability`.
    Where a field is `forbidden`, render `forbiddenFieldStatement` and render no
    absence label for that field. Where it is `required`, render the recorded
    value as today, including the existing malformed-record handling through
    `MALFORMED_LIST_REASON` and `MALFORMED_NORMATIVE_REASON`, which must stay
    reachable: a malformed stored record is a different condition from a
    structurally forbidden field, and the two must remain distinguishable.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Aggregate final-panel unavailability (R12).**
  - Change: state `finalPanelBlockingSummary(cards).statement` once in the
    section where it is non-null, and render the per-finding value only for
    cards in its `shown` set.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Rework the governed-actions region (U12, R6, P2).**
  - Change: state the repository once for the region using the display identity
    from `repositoryIdentity`, with the canonical path behind an `identityNode`
    copy control, and remove the per-tile repository row, the duplicated path,
    the shell row, and the no-recorded-reason row — render the reason only where
    the projected command records one. State the shell once for the region. Each
    tile keeps the command's name, its eligibility badge, its full command text,
    and its copy control from `copyControl`, and keeps the recorded scope row
    that states a command is repository-wide rather than run-scoped: that is a
    distinct recorded fact, not a repetition, and R1 forbids dropping it. Keep
    the existing disabled state
    for an ineligible command and the existing live-region wording unchanged:
    the region stays copy-only and executes nothing.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Reduce empty and absent states to one line (R6, U15).**
  - Change: render proposals as a single line naming the collection and its zero
    count where the projected proposals array is empty, with no heading and no
    body. Render the writer lock as one line where the recorded lock state is
    absent, and render its path, process identifier, created time, and reason
    rows only where the lock is present. Apply the same one-line rule to every
    other zero-count collection reached by this plan's sections.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 6: Prove the render-level rules by source assertion.**
  - Change: extend the static-asset test with assertions that `app.js` calls
    `orderFindings`, `forbiddenFieldStatement`, and `finalPanelBlockingSummary`,
    and that the two absence labels the current cards render for grounding and
    normative changes no longer appear within the `renderFindings` body.
    Extract that body with a non-greedy match anchored on the `renderFindings`
    declaration and the next top-level function declaration, and assert against
    the extracted text rather than the whole file, so an unrelated occurrence
    elsewhere cannot pass or fail the rule by accident.
  - Verify: `node --test --test-name-pattern "static assets keep the approved accessible boundary" test/dashboard-ui.test.ts`
  - Expected: The test passes.

- **Step 7: Prove the guard by mutation (N4).**
  - Change: temporarily restore one absence label inside the `renderFindings`
    grounding branch.
  - Verify: run the named test, then restore byte-exactly and rerun.
  - Expected: The mutation fails; the restoration passes.

**Task completion evidence:** Finding cards present triage fields at card level with audit evidence behind a per-card disclosure; forbidden fields state applicability instead of absence; final-panel unavailability is one section statement; the governed-actions region names the repository once and stays copy-only; the extended static-asset test passes and its mutation failed.

### Task 7: Portfolio view density and label precision

**Depends on:** Tasks 1, 2, 4

**Files:**
- Modify: `src/dashboard/app.js` — `kpiCard`, `renderKpiBar`, `renderRepository`
- Modify: `src/dashboard/index.html` — the duplicated filter-scope sentence
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Aggregate the repeated trend label (R4).**
  - Change: remove the trend line from `kpiCard` and state
    `TREND_UNAVAILABLE_LABEL` once for the portfolio section, naming what is
    unavailable and why in the projection's own terms. The eight cards currently
    repeat that label eight times for one shared reason, which is exactly the
    repetition R4 forbids.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Apply the monetary rule to the portfolio (R7).**
  - Change: replace the known-cost `usd` call in `renderKpiBar` with
    `usdPresentation`, rendering `display` visibly and `exact` in a visually
    hidden span, matching the pattern `countNode` already establishes for
    counts.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Lead the repository card with project identity (U13, R2).**
  - Change: in `renderRepository`, reorder the opening so `const envelope` and
    `const list = runListResult(...)` are computed *before* the heading is
    appended — today the `h3` is appended first, so using the loaded run
    summaries in the heading without reordering is a use-before-declaration.
    Replace that heading's submitted path with the display identity from
    `repositoryIdentity`, passing `list.runs` where the run list resolved and an
    empty array otherwise, and present the canonical path through
    `identityNode` so it stays verbatim, copyable, and exposed to assistive
    technology. Collapse the four-row definition list to the canonical
    repository and the observed time, moving the submitted path and the run
    limit into a disclosure. Keep the submitted path and the canonical
    repository as two distinct rows wherever both are shown: they are different
    recorded facts and R1 forbids merging them.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 4: Reduce the empty repository to one line (X7, R6).**
  - Change: where the loaded run list is empty, render one line naming the
    repository display identity and its zero run count, and suppress the
    definition list, the disclosure, and the trailing run-limit note for that
    case — today the zero-run repository still renders all three around a
    one-line empty state. Where a single run exists, render the existing table
    unchanged — the rule is about zero, not about one. Leave the separate
    "no loaded run matches the current display filters" branch exactly as it is:
    a filtered-to-empty view is not an empty repository.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 5: Move and de-duplicate the explanatory notes (U14).**
  - Change: move each section-explaining note into that section's disclosure.
    Where the same explanation repeats — the filter-scope sentence that appears
    both in the filter bar of `src/dashboard/index.html` and again in
    `renderKpiBar`, and the coverage sentence repeated across KPI cards — state
    it once for the view and delete the repetitions. Delete no sentence that
    carries a distinct recorded fact.
  - Verify: `node --test --test-name-pattern "static assets keep the approved accessible boundary" test/dashboard-ui.test.ts`
  - Expected: The test passes; its existing landmark and read-only assertions
    over `index.html` still hold.

- **Step 6: Prove the portfolio rules against real rows.**
  - Change: add a test named
    `a repository leads with its recorded project identity and reports a zero run count in one line`.
    Seed one repository with three runs and read it through `readRunsResult`;
    assert the display identity equals the recorded project — `newRun` records
    the literal project `project` — and that the source is `project`. Create the
    second, run-free repository under a **separate `workspace()` root**: the
    `repository` helper hard-codes the directory name `target with spaces` and
    `mkdirSync` throws if it is called twice under one parent. Assert that
    repository's display is the final path segment `target with spaces`,
    including its spaces, that the source is `path_segment`, and that
    `canonicalPath` is the unmodified path.
  - Verify: `node --test --test-name-pattern "a repository leads with its recorded project identity" test/dashboard-ui.test.ts`
  - Expected: The test passes.

- **Step 7: Prove the guard by mutation (N4).**
  - Change: make `repositoryIdentity` prefer the path segment even where runs
    are present.
  - Verify: run the named test, then restore byte-exactly and rerun.
  - Expected: The mutation fails; the restoration passes.

**Task completion evidence:** The portfolio states its trend unavailability once, formats money to two decimals with the exact value retained, leads each repository with project identity while keeping the canonical path copyable, reduces a zero-run repository to one line, and states each explanation once; the new test passes and its mutation failed.

### Task 8: Visual system, light-theme accent pass, and the contrast guard

**Depends on:** Tasks 5, 6, 7

**Files:**
- Modify: `src/dashboard/styles.css` — token declarations and tone rules
- Modify: `test/dashboard-ui.test.ts` — the contrast test
- Validate: `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Unify the state colour mapping (U16).**
  - Change: apply the existing tone classes to the finding card, the executive
    summary's state and severity regions, and the timeline marker, so one
    mapping serves badges, cards, and markers. The cost and token charts encode
    agents and stages rather than state, so they keep the series scale; state
    that distinction in the stylesheet's header comment. Every state already
    pairs colour with text through the badge helper, which already appends a
    non-colour icon — keep both and add no colour-only indicator.
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 2: Add surface and accent variation (U17).**
  - Change: add raised and sunken surface tokens and per-tone wash tokens to
    each of the three theme blocks, and use them to distinguish the executive
    summary region, a collapsed disclosure summary line, and a finding card at a
    glance. Either use the existing `--accent` token, which is declared in all
    three theme blocks and referenced nowhere, or delete it — a declared, unused
    token is exactly the drift the contrast guard cannot catch. Add no inline
    style, no build step, and no new asset (N1, P4).
  - Verify: `npm run typecheck:dashboard`
  - Expected: Exit 0.

- **Step 3: Extend the contrast guard (U17).**
  - Change: in the test named
    `declared theme tokens meet the 4.5:1 text contrast requirement in both themes`,
    widen the pair list to the cartesian product of the text tokens `--text`,
    `--muted`, `--primary`, `--success`, `--warning`, `--error`, `--critical`,
    `--active`, and `--neutral` with the surface tokens `--panel` and
    `--background`, keeping the existing reference assertion that black on white
    rounds to 21. Add a second test named
    `non-text state indicators meet the 3:1 contrast requirement in both themes`
    extracting the eight series colours for each theme with a regex over the
    stylesheet and asserting each is at least 3 to 1 against that theme's
    `--panel`. Both tests read `src/dashboard/styles.css` from disk, matching
    the existing     `declaredTokens` pattern. Note before changing any surface token that the
    tightest existing margin is the light `--muted` on `--background` at roughly
    4.60 to 1: lightening `--background` or lightening `--muted` in Step 2 will
    break this test, and the correct response is to darken the text token, not
    to relax the threshold.
  - Verify: `node --test --test-name-pattern "declared theme tokens meet" test/dashboard-ui.test.ts`
    then `node --test --test-name-pattern "non-text state indicators meet" test/dashboard-ui.test.ts`
  - Expected: Both tests pass against the palette as changed by Step 2. Where a
    token fails, change the token — never the threshold.

- **Step 4: Prove the guard by mutation (N4).**
  - Change: apply one mutation at a time — set the light `--muted` token to a
    value that fails 4.5 to 1 on `--panel`; set the light first series colour to
    a value that fails 3 to 1 on `--panel`.
  - Verify: after each single mutation run the two named contrast tests, then
    restore byte-exactly and rerun.
  - Expected: Each mutation fails with the computed ratio in its assertion
    message; each restoration passes.

- **Step 5: Observe retained accessibility manually (U18).**
  - Change: none.
  - Verify: against the retained target, confirm visible focus on every new
    control including each disclosure summary and each copy button; confirm
    reduced-motion and forced-colors still render every state with its text and
    icon; confirm 200% zoom and a 320 CSS-pixel viewport produce no
    document-level horizontal scrolling.
  - Expected: All four observations hold, or the failure is recorded and fixed
    before the task is complete.

**Task completion evidence:** One state colour mapping spans badges, cards, and markers; the light theme carries surface and accent variation; the widened contrast test and the new 3 to 1 test pass; both mutations failed and both restorations passed; the manual accessibility observations are recorded.

### Task 9: Consolidated verification, boundary proof, and review

**Depends on:** Tasks 1, 2, 3, 4, 5, 6, 7, 8

**Files:**
- Modify: `test/dashboard-ui.test.ts` — boundary assertions
- Modify: `docs/features/dashboard-density-triage/plan.md` — status and implementation note
- Modify: `.claude/sessions/project-learnings.md` — the `Current state` block
- Validate: the whole repository

**Steps:**

- **Step 1: Reassert the read-only boundary (P1-P4, N1).**
  - Change: confirm the existing boundary assertions in the test named
    `static assets keep the approved accessible boundary and omit unauthorized transports`
    still hold unmodified — no push transport, no timer, no markup parsed from a
    projected value, no request carrying a method, no serialized state promoted
    to presentation, no style assigned from script, and no DOM, network, or
    storage access in `src/dashboard/dashboard-model.js`. Confirm
    `git --no-pager diff --stat` shows no change to `src/dashboard-server.ts`,
    `src/dashboard-config.ts`, `src/operator-read.ts`, `src/operator-state.ts`,
    `package.json`, or `tsconfig.dashboard.json`.
  - Verify: `npm test`
  - Expected: The full suite passes, including `test/dashboard-server.test.ts`
    unchanged.

- **Step 2: Run both TypeScript programs.**
  - Change: none.
  - Verify: `npm run typecheck`
  - Expected: Exit 0 for the strict program and for the DOM-enabled
    `tsconfig.dashboard.json` program.

- **Step 3: Run the documentation checker.**
  - Change: none.
  - Verify: `npm run check:docs`
  - Expected: Exit 0. Path findings from documents under `docs/features/` are
    warnings by tier and are not chased to zero.

- **Step 4: Review the diff.**
  - Change: none.
  - Verify: run a code review over the complete change range with a separate
    reviewer where one is available, supplying this plan, `AGENTS.md`,
    `docs/hazards.md`, and `.claude/sessions/project-learnings.md`. Reconcile
    every accepted finding in code and rerun the affected checks. Where
    independence is unavailable, record that as a limitation rather than
    claiming it.
  - Expected: No accepted finding remains open, and the dated review record is
    written beside this plan in `docs/features/dashboard-density-triage/`.

- **Step 5: Record the outcome.**
  - Change: advance this plan's `**Status:**` to `Implemented`, add an
    implementation note stating what shipped, what deviated, and what was
    deferred, and rewrite the `Current state` block in
    `.claude/sessions/project-learnings.md` with the new working state and next
    action. Create no task document and add no task checkboxes.
  - Verify: `npm run check:docs`
  - Expected: Exit 0.

**Task completion evidence:** `npm test`, `npm run typecheck`, and `npm run check:docs` all pass; the untouched-file list is confirmed by diff; the code review is written and reconciled; the plan status and the learning record are updated.

## Deferred scope

Explicitly not built here, and not implied by anything above: the `RunSnapshot`
extension that would project `executor`, `requested_model`, `effective_model`,
`fallback`, `duration_ms`, `role`, and `independence` from the recorded agent
rows, which the operator deferred on 2026-09-12; historical trend series and
cross-run comparison; tabs, sticky section navigation, and client-side routing
beyond the existing hash deep link; any executable action, consent collection,
writer open, or signature display; and any paid provider invocation.

## Rollback

Every change is confined to five files, none of which is committed yet on this
branch, and none of which participates in persistence or migration. Reverting is
a working-tree operation on `src/dashboard/app.js`,
`src/dashboard/dashboard-model.js`, `src/dashboard/styles.css`,
`src/dashboard/index.html`, and `test/dashboard-ui.test.ts`. Because the branch
carries a large uncommitted tree, never revert with a whole-file checkout or
restore: reverse the specific edits, or snapshot the file first. No stored data,
no schema, and no run state is touched, so no migration or data repair is
possible or needed.
