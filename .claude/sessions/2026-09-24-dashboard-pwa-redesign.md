# Dashboard PWA redesign — task record (2026-09-24)

**Requested outcome:** a complete UX redesign of the read-only dashboard on the TheSnitch
design language (`C:\Repositories\AI.Tools\TheSnitch\public\style.css`), refactored as a
Progressive Web App; dense, enterprise, accessible, restrained; no Tailwind/shadcn look.
Work on a new branch.

**Operator decisions:** per-launch PWA install (manifest, icons, static-only service worker;
no port, token, or security-boundary change); review gate = plan plus a static mockup from
real recorded runs, approved in both themes before `src/dashboard/app.js` changes.

**Baseline:** branch `dashboard-ux-redesign` created from `guided-project-bootstrap` at
`1b42825`, clean tree.

**Produced (uncommitted):** `docs/features/dashboard-pwa-redesign/plan.md` (full path, one
self-review pass, six findings reconciled, then corrected by mockup evidence) and
`docs/features/dashboard-pwa-redesign/mockup/` (`index.html`, `mockup.css`, `mockup.js`).
No production file changed.

**Evidence and method:** values come from the real `dashboard-model.js` exports applied to
three snapshots read through a free, read-only `bw dashboard` launch at
2026-09-24T08:15:57Z against `C:\Users\tamezs\buildWorks_test_repos\dashboard-repositories.json`
(process stopped afterwards). Scratch generators and screenshots live in the session
scratchpad only. The mockup accepts review links such as `#view=runs&theme=light&finding=run-0:11`.

**Findings that shaped the plan:** four existing honesty defects (fabricated audit-integrity
claim pinned by a test; "open findings" counting every finding; attention queue ignoring
dispositions; 8-step pipeline misordering recorded stages). The recorded runs showed that
"no decision" is not "open" for code-review findings (non-final rounds are remediation
input; the final panel records `finalPanelBlocking`), so finding status has six classes:
addressed, rejected, open, blocking, non-blocking, earlier round (29 = 19/0/2/2/2/4).
Also: all three runs share project "smoke", so rows lead with slug and path tail; the
executive summary's fallback finding must not be titled "Blocking".

**Validation performed:** token contrast via the test's own functions (all text >= 5.1:1,
series >= 5.6:1, control edges/hatch >= 3.37:1); headless-Chrome screenshots; exact-width
iframe overflow probe (Chrome new headless has a ~500px minimum window) — all six views
clean at 320px and 390px; `npm run check:docs` exit 0.

**Revision 2 (2026-09-24):** the operator reviewed revision 1 in
`docs/features/dashboard-pwa-redesign/mockup-feedback.md`. That review is now reconciled:
35 accepted, 5 rejected, 4 deferred, 0 open. The operator made three decisions:
- page tabs go under the header;
- bounded read-only polling is authorized (15 s `setTimeout` chain, visible-only, with
  a toggle); a new ARCHITECTURE section 23 decision lands in Task 4;
- the `byAgent` projection is extended with roles, requested and effective models,
  unreported-model rows, and `durationMs`. The operator confirmed it can be dropped
  later, leaving `Unavailable` as the fallback.

The plan was rewritten, with tasks renumbered 1-12, and its status is now `Reconciled`.
The mockup was rebuilt from the same stores plus a read-only `agent_run` query (scratch
`agent-rows.mjs`): all 42 rows report an effective model (`claude-sonnet-5`), and
durations come from `duration_ms`.

LIVE cannot be demonstrated from recorded data: every run is terminal and every writer
lock is `absent`. The mockup's "Component states" page shows it as a labelled specimen.

Validation:
- contrast all pass;
- the 320/390 iframe probe is clean on all seven pages after fixing two overflows
  (visually-hidden labels escaping `main`, and a wide scope picker);
- `npm run check:docs` is clean.

**Revision 2 follow-up (2026-09-24):** the operator found that the repository select did
nothing in the mockup. It was inert, and not listed as inert; that was my omission.

Changes made:
- The mockup now renders Overview, Runs, and Findings once per repository. Each
  scope's totals come from a `portfolioProjection` run for that repository alone, and
  the generator refuses to write if a scope disagrees with it.
- The stage map is renamed "Run progression".
- Tokens and Known cost are now a paired card, tokens first.
- Zero counts are drawn in neutral tones.
- Plan updates: the scope rule is in the Frame section, and Task 6 has a
  `repositoryViews` scoping guard.

Validation: the iframe probe is clean at 320, 390, and 700px across the scopes.

**Models view follow-up (2026-09-24):** the operator's stage-usage feedback was taken in
full, with two adjustments:
- the proposed "Total run cost" card was left out, because the Known cost card sits
  directly above it;
- the "anomaly/highlight cards" are plain rankings (highest cost, most tokens, longest
  running), not anomaly claims, because no detection rule exists.

The dash rows became one "No agent runs" line, with recorded reasons (approval granted;
2 frozen commands passed). The figures were checked against the snapshot: code review
is $1.3644, 38.0% of cost and 766,888 tokens (54%). The plan gained `stageUsage` in
Task 3 Step 4.

**Agents table (2026-09-24, operator approved the proposal):** changes made:
- A uniform model becomes one statement (the `uniformModel` rule, plan Task 3 Step 4).
- A share-of-cost bar and a Share column were added.
- Cost per execution and average time moved into the Known cost and Total time tooltips.

Mockup break-check: marking one recorded row's effective model null brought the Model
column back with an "Unavailable" cell; restoring the data removed it.

**Revision 2 approved (2026-09-24):** "Looks great. Continue on."

**Task 2 done (2026-09-24):** `src/operator-state.ts` `cost.byAgent` gained `roles`,
`requestedModels`, `effectiveModels`, `effectiveModelUnreportedRows`, and `durationMs`.
The test "byAgent carries recorded roles, models and duration…" in
`test/operator-state.test.ts` failed first on the missing fields. After the change it
passes, and it failed under both break mutations (null model counted as reported;
`durationMs` 0 instead of null), each reversed by its own edit. `operator-state` plus
`cli-operator` ran 189/189 from the tool shell, and typecheck is clean.

**Task 3 done (2026-09-24):** `dashboard-model.js` gained these projections:
`stageLedger`, `stageMap`, `findingStatus`, `findingStatuses`, `findingStatusCounts`,
`BLOCKING_DECISIONS`, `runOutcome`, `governanceChecks`, `telemetryCoverage`,
`agentRows`, `stageUsage`, `relativeTimePresentation`, `searchIndex`, and
`searchMatches`.

Changes to existing code:
- The two-group `needsAttentionQueue` fixes Defect C.
- `agentAnalytics` and `averageExecution` now read the recorded fields.
- The two unavailability constants and `missingExecutionDuration` are retired.
- `app.js` has minimal interim edits at the call sites that Task 5 replaces.

The unplanned `upstream_*`/`cannot_determine` dispositions follow `plan-gate.ts`
`BLOCKING_DISPOSITIONS`, and a test pins the copy.

Validation: 10 break mutations, each failing its named test and reversed exactly;
234/234 across the dashboard-ui, operator-state, cli-operator, and dashboard-server
suites; typecheck and check:docs clean. The plan's Task 3 Result lists the
deviations. `project-learnings.md` Current state and the byAgent diagnostic line
were corrected.

**Task 4 done (2026-09-24):**
- The ARCHITECTURE section 23 live-observation decision is recorded.
- The model gained `liveness`, `autoRefreshPlan`, and `changedRuns`, tested against real lock states.
- `app.js` gained `scheduleAutoRefresh` (the only `setTimeout`), `trackedRefresh`, `refreshChanged`, and the visibility listener.
- `index.html` gained the `#auto-refresh` toggle.
- The README, docstring, and test comment that still said "no polling" are corrected.

Validation: 7 break mutations; 237/237 across the four suites; typecheck and check:docs clean.

A break-driver defect (an empty replacement could not be restored) left one mutation applied, and I restored it by hand. The driver now refuses such a case, and a lesson was added to `~/.claude/lessons.md`.

Open question for the operator: a stale live-lock observation reads "No live writer".

**Task 5 done (2026-09-24):** The shell, stylesheet, and renderer are replaced from the approved mockup: `index.html`, `styles.css`, and `app.js` (spliced from checked line ranges). Step 3 removed the six command-center model functions, plus `governedDeliveriesRows` once it had no caller.

Validation:
- typecheck is clean;
- the removal grep is empty;
- every import is used;
- the read-only boundary counts hold;
- a free read-only launch with headless screenshots matched the mockup's values in all six views, in both themes, and at 700px; the process was stopped afterwards.

Tests: `dashboard-ui` passes 37 of 42 (the 5 failures are Task 6's rewrite targets); the other three suites pass 195 of 195. Deviations and follow-ups are in the plan's Task 5 Result. Interactions (clicks, search, keyboard) were not exercised; they belong to Task 11.

Rollback: `app.js`, the model, and the test before Task 5 are in scratch `t5/*.pre-*.js` (machine-local); git also holds the committed baseline.

**Remaining:** Tasks 6-12. Forced colours,
reduced motion, and screen-reader checks need a real browser.

**Rollback:** delete `docs/features/dashboard-pwa-redesign/` and the branch; nothing else changed.
