# Code review — dashboard density and triage implementation

**Status:** reconciled
**Date:** 2026-09-12
**Reviews:** `docs/features/dashboard-density-triage/plan.md` as implemented
**Hazards considered:** `invented-evidence` — the central risk of this change is
a render layer that states an absence the projection never recorded, or promotes
a recorded `false` into a recorded nothing; two findings below are exactly that.
`second-mutation-authority` — the dashboard remains a read-only projection, and
the new `copyControl` places text and does nothing else. `stale-read-labelling`
— every collapsed section still carries its stale note. `windows-harness-launch`
is irrelevant: this change dispatches no provider and launches no harness.

## Method

An independent reviewer agent read `ARCHITECTURE.md`, `AGENTS.md`,
`docs/hazards.md`, `.claude/sessions/project-learnings.md`, the plan, and all
five change-set files through physical EOF. Independence was available and used:
the reviewer was a separate agent with its own context, not a role switch.

The change set is untracked in Git (`?? src/dashboard/`,
`?? test/dashboard-ui.test.ts`), so `git diff` shows nothing for it. The review
was therefore performed against current file contents measured against the plan,
and the reviewer was told so explicitly rather than left to infer it from an
empty diff.

## Findings

Five findings: none critical, none high, two medium, three low. All five were
verified against the source before acceptance, and all five were accepted.

### F1 — The executive summary's next-action command lookup can never match

**Severity:** medium. **File:** `src/dashboard/app.js`, the `renderExecutiveSummary`
next-action tile.

`projection.governance.commands.find((command) => command.kind === action.group)`
compared two disjoint vocabularies. `action.group` is an `ExecutionGroup` or
`"approval"` (`src/operator-state.ts`), while the `kind` values that reach
`governance.commands` are the read commands, `proposal_export`,
`approval_request`, `approval_submit`, and the literal `"workflow"` that
`snapshotProjection` assigns to the workflow action's own command. No element of
the first set appears in the second, so `projected` was always `null` and the
command text and its copy control were never rendered.

**Verified:** `dashboard-model.js` assigns `kind: "workflow"` in the
`snapshot.workflowAction.command !== null` block; `operator-state.ts` enumerates
the execution groups separately. Confirmed by reading both.

**Disposition:** accepted and fixed. The lookup now matches `"workflow"`, which
is the command belonging to the very action the tile describes. Guarded by a
source assertion in the boundary test asserting both the presence of the correct
comparison and the absence of the old one, proved by mutation M11.

### F2 — A recorded `finalPanelBlocking: false` was reported as "no flag is projected"

**Severity:** medium. **File:** `src/dashboard/dashboard-model.js`
(`runExecutiveSummary`) and `src/dashboard/app.js` (the blocking-finding tile).

`finalPanelProjected` was derived as `blockingCards.length > 0` — whether any
card blocked, not whether a final panel projected a result at all. When a matched
final panel ran and recorded no blocking finding, `operator-state.ts` assigns
`false` to every finding of that stage and round, not `null`. The summary then
stated "No final-panel blocking flag is projected for this run" while every card
in the same view rendered `Final-panel blocking: No`, and
`finalPanelBlockingSummary` printed no unprojected-count statement. The page
contradicted itself, and it asserted the absence of a value the run recorded.

This is the null-versus-false distinction the projection is built on, and per
`AGENTS.md` the clean final panel is the ordinary passing path, not an exotic
one.

**Verified:** `src/operator-state.ts` —
`for (const f of selected) f.finalPanelBlocking = blocks.some(...)` — assigns
`false` across the matched stage and round when `blocking` is empty. Confirmed by
reading it.

**Disposition:** accepted and fixed. `finalPanelProjected` now means
`ordered.some((card) => card.finalPanelBlocking !== null)`, a separate
`finalPanelBlocking` field carries whether the selected card blocked, and the
render layer words all three states distinctly: the panel blocked this finding;
the panel recorded no blocking finding; no final-panel result is projected. A new
model assertion covers the third state with every card set to `false`, and the
existing unmatched-panel case is now asserted explicitly rather than implied.
Proved by mutation M12.

### F3 — `latestTimestamp` was imported but never called

**Severity:** low. **File:** `src/dashboard/app.js`.

Plan Task 5 Step 3 requires the Run detail disclosure to hold "the non-latest
timestamps from `latestTimestamp`", surfacing the latest. The implementation
listed Created, Updated, and Last recorded activity together inside the
disclosure and surfaced none, leaving R10 without a render-side implementation
and the imported helper exercised only by its own model test.

**Verified:** a search over `app.js` found `latestTimestamp` on the import line
only.

**Disposition:** accepted and implemented rather than waived. The summary now
surfaces the latest recorded timestamp with its label, and the disclosure carries
only `stamps.others`. Where no value parses, `latest` is `null` and all three
entries remain in the disclosure, so nothing recorded is lost. Proved by mutation
M14.

### F4 — Two collapsed sections passed a `null` count the plan specified

**Severity:** low. **File:** `src/dashboard/app.js`, the run-view append.

Plan Task 5 Step 4 enumerates a count for each of the eight disclosures.
`Frozen configuration and approval` and `Delivery` were passed `null`, and
`Cost and tokens` was passed `projection.cost.agentRows` where the plan says
"cost groups".

**Verified:** both counts were available on the projection —
`projection.governance.proposals` and the four delivery path arrays.

**Disposition:** accepted and fixed. Configuration states its recorded proposal
count, Delivery states the total of its changed, declared, delivered, and missing
paths, and Cost and tokens states its stage and agent cost groups. A boundary
assertion now requires eight `collapsibleSection` calls in the run view and no
`null` count among them, so a future section cannot quietly omit one. Proved by
mutation M13.

### F5 — The zero-run-repository guard did not constrain what its comment claimed

**Severity:** low. **File:** `test/dashboard-ui.test.ts`.

The guard asserted
`/if \(list\.runs\.length === 0\) \{[^]*?parent\.append\(article\);\n {4}return;/`
while its comment claimed the branch renders "no definition list, no disclosure,
and no trailing run-limit note". `[^]*?` admits arbitrary intervening content, so
the assertion would pass unchanged against a zero-run branch that rendered all
three before returning — precisely the regression it exists to catch. The
implementation was correct, but the guard was passing for a weaker reason than it
stated.

**Verified:** `renderRepository` contains no second `parent.append(article);` for
the lazy match to reach, so deletion of the early return was the only thing the
assertion could fail on.

**Disposition:** accepted and fixed. The branch body is now sliced out of the
source by index — the pattern the finding and KPI assertions already use — and
each of `definitionList(`, `disclosure(`, `runLimit`, and `hasMore` is asserted
absent inside that slice, with the early return matched at the slice boundary.
Proved by mutation M15, which inserts a definition list into the branch: the
strengthened guard fails, and the original regex would have passed.

## Reconciliation

All five findings are accepted, fixed in code, and guarded. No finding remains
open. Each fix carries a guard proved by deliberate mutation (M11 through M15),
restored byte-exactly and re-verified afterwards; because these files are
untracked, every restoration was asserted by comparing the written text to a
snapshot taken before the mutation rather than by a Git operation.

Nothing was reported at critical or high severity. The reviewer found no
read-only boundary violation, no mutating method, no push or polling transport,
no markup parsed from a projected value, and no DOM, network, or storage access
in `dashboard-model.js`.

## Verification after reconciliation

- `npm test` — full suite, 0 failures.
- `npm run typecheck` — exit 0 for both the strict program and the DOM-enabled
  `tsconfig.dashboard.json` program.
- `npm run check:docs` — `doc-check: clean`, exit 0.
