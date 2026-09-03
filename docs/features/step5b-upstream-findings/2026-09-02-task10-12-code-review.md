# Step 5b Tasks 10-12 — code review

**Status:** reconciled

**Reviewed document:** `docs/features/step5b-upstream-findings/plan.md`, Tasks
10 through 12, together with their changes to `ARCHITECTURE.md`,
`docs/hazards.md`, `README.md`, `scripts/doc-check.mjs`, and
`.claude/sessions/project-learnings.md`.

**Review date:** 2026-09-02

**Effort:** high. Read-only review of the complete working-tree change, the
shipped proposal and reconciliation call paths that the documentation now
describes, the Task 11 break-and-restore record, and the retained Task 12
smoke database, raw model outputs, proposal evidence, and generated artifacts.

**Hazards considered:** 2 (the new proposal-evidence layout claim was traced
through repeated-candidate deduplication, where later evidence files are not
referenced by `proposal.evidence_ref`), 4 (Task 11 substitutes generic fixtures
for the specifically required retained atomic-exclusive-create replay, and its
constraint mutation demonstrated that source text and the checker can agree
while the live SQL constraint is absent), 12 (the frozen smoke profile and
every stored requested/effective model were inspected; no live-policy read or
model mismatch was found), 13 (the smoke's plan additions and reconciliation
grounding were compared with the approved specification rather than treating
an exact excerpt as semantic authority), and 16 (the review checked the new
hazard text against the exact semantic limitation the Task 12 learning record
claims to have avoided). Hazard 1's retained raw envelopes, hazard 3's prompt
constraints, hazard 7's configured round behavior, hazard 11's two-specialty
staffing, and hazard 14's standalone-process independence records were also
inspected without a new defect. Hazards 5, 6, 8, 9, 10, and 15 are not newly
exercised by this documentation/checker tranche: it performs no delivery,
later-stage coverage, executable resolution, hook probing, alias acceptance,
or proposal-subprocess invocation.

**Scope reviewed:** `git diff HEAD` across
`.claude/sessions/project-learnings.md`, `ARCHITECTURE.md`, `README.md`,
`docs/features/step5b-upstream-findings/plan.md`, `docs/hazards.md`, and
`scripts/doc-check.mjs`. The unchanged `src/proposal.ts`, `src/store.ts`,
`src/spec-stage.ts`, `src/plan-stage.ts`, `src/reconciliation.ts`,
`test/schema.test.ts`, `test/spec-stage.test.ts`, and
`test/plan-stage.test.ts` were traced because they define the facts asserted
by Tasks 10-12. The retained smoke target named in project learnings was read
directly. The personal untracked `.claude/settings.local.json` file was not
reviewed.

## Summary

The hazard-count check works on the current documents, the schema fence agrees
with the final migration table bodies, and the retained production smoke
substantiates its run id, ten dispatches, requested/effective model, cost,
duration, finding/report/decision rows, stored proposal, raw-output count, and
audit events. Typecheck, the focused schema suite, and doc-check are green.

Seven actionable findings remain. The most serious is Task 11's observed
constraint-check false pass: a dropped SQL constraint was accepted because a
comment repeated its text, yet the guard was not strengthened even though the
task says a green mutation must be. Two more Task 11/12 checklist requirements
are marked complete without the evidence they require. The current-state README
and two recorded verification/semantic claims are inaccurate, and the binding
architecture overstates how deduplicated proposal evidence is referenced.

Tasks 10-12 should not be treated as clean input to Task 13 until every finding
below has a recorded disposition. No new hazard entry is recommended: these
findings are concrete instances of hazards 2, 4, and 16 and of current-state
documentation drift already governed by the doc-check rules.

## Findings

### 1 — P1 — the constraint guard remained vulnerable after its observed false pass

**Disposition:** accepted.

**Where:** `docs/features/step5b-upstream-findings/plan.md`, Task 11 completion
record around lines 1071-1089; `test/schema.test.ts`, `migrationTables` and the
final-table constraint assertions around lines 50-65 and 147-181;
`scripts/doc-check.mjs`, `migrationTableBodies` and `checkConstraints` around
lines 180-200 and 402-420.

**Reachable case:** A final migration table body drops
`UNIQUE (finding_id, agent_run_id)` but contains that text in a SQL comment—for
example, a comment explaining which constraint was removed. Task 11 performed
exactly this mutation. Both the schema test and doc-check stayed green because
they call `body.includes(constraint)` over text that still contains comments.

**Why it matters:** The guard treats a comment as executable schema and can
therefore miss removal of an invariant that prevents one reviewer's immutable
report from overwriting or duplicating another. This is the same defect class
the final-table-body change was meant to close: dead text can satisfy a source
scan while SQLite enforces something else. Task 11's own closing instruction
says a test that stays green has not proved its guard and must be strengthened
before the task closes. Retrying the mutation with a quieter comment proves
only that one specially authored mutation is detectable; it does not repair
the guard that false-passed.

**Required correction:** Strip SQL comments before source-level constraint
matching or, preferably, assert the applied SQLite schema in a way that cannot
confuse comments with constraints. Apply the same rule in the schema test and
doc-check, repeat the original mutation including the explanatory comment,
and require both checks to fail before recording Task 11 complete. Correct the
completion record's contradictory statement that the retry against the same
test “passed” after the preceding paragraph says it correctly failed.

### 2 — P2 — Task 11 marks the required retained atomicity replay complete without running it

**Disposition:** accepted.

**Where:** `docs/features/step5b-upstream-findings/plan.md`, the checked Task 11
step at line 1011 and the “Not attempted” completion note around lines
1091-1099.

**Reachable case:** The exact Task 1 artifact change that introduced the
ungrounded “single atomic exclusive-create operation” is replayed as
`addressed`. Task 11 requires that retained case to be rejected by the
normative-delta guard, followed by omitted, duplicated, wrong-node, and grounded
success cases.

**Why it matters:** The completion record explicitly says the retained replay
was not attempted, but the checklist marks the compound step complete and the
summary says every named guard was proven. The generic grounding and exact-set
fixtures cover the same broad branch, but they do not satisfy the plan's
deliberate hazard-4 control: replay the real failure whose wording and shape
motivated the guard rather than rely only on fixtures authored with the
validator.

**Required correction:** Run the retained Task 1 atomic-exclusive-create case
in the scratch mirror and record its failing assertion plus green restoration.
If that evidence is deliberately waived, leave the item incomplete and record
the plan deviation and authority for it instead of claiming all Task 11 guards
were exercised.

### 3 — P2 — the smoke record claims semantic success that textual grounding cannot establish

**Disposition:** accepted.

**Where:** `.claude/sessions/project-learnings.md`, Task 12 session record
around lines 158-161; the corresponding `addressed` row in
`docs/features/step5b-upstream-findings/plan.md` around line 1186.

**Reachable case:** Finding 2's reconciliation adds a plan instruction that
deeply equal object/array values copy `base`'s reference. Its grounding excerpt
from the approved specification says only that a same-valued key “appears once
in the output with that value.” The excerpt does not select which input's
observable reference identity is returned.

**Why it matters:** Project learnings call this a “correctly grounded” decision
with “no invented obligation” and say Hazard 16's failure did not recur. The
deterministic check established only that the excerpt occurs in the
specification and that the added node was claimed once. Architecture section
12 and Hazard 16 expressly say those checks cannot prove logical support or
semantic correctness. The claim is therefore stronger than the retained
evidence and would let Task 13 treat the sample as closing the exact residual
risk it is required to preserve.

**Required correction:** Describe this result as structurally complete and
textually matched, with the semantic support for the base-reference choice
unverified. If an operator judges the choice to be authorized, record that
human judgment separately rather than attributing it to the grounding guard.

### 4 — P2 — Task 12 records a doc-check result that the completed tree does not produce

**Disposition:** accepted.

**Where:** `docs/features/step5b-upstream-findings/plan.md`, Task 12 verification
record around lines 1225-1230; `.claude/sessions/project-learnings.md` around
lines 58-61.

**Reachable case:** Run `npm run check:docs` after both Task 12 records have
been appended, as the completion record says was done.

**Why it matters:** The completed tree reports 41 warnings, not 37. The Task 12
change introduces five historical missing-path warnings: two in project
learnings and three in the plan, including the explanatory code-formatted
references that themselves create warnings. The checker still exits zero, but
the exact verification evidence is false and Task 12 specifically requires
measured rather than estimated numbers.

**Required correction:** Update both records to the final measured count and
name all introduced warnings, or render scratch-only illustrative filenames in
a form the rooted-path checker does not classify as repository paths. Re-run
doc-check after the final text is present and record that result.

### 5 — P2 — the current README still says Tasks 11 and 12 remain

**Disposition:** accepted.

**Where:** `README.md`, status paragraph around lines 52-54.

**Reachable case:** A reader uses the repository's current-tier README to
determine which Step 5b work is outstanding after this Tasks 10-12 change.

**Why it matters:** The README says the break-and-restore sweep and bounded
production smoke remain, while the same working-tree change marks Tasks 11 and
12 complete and project learnings identifies only Task 13 as next. Unlike the
historical plan records, README is current-state documentation and should not
ship a known-stale status.

**Required correction:** State that Tasks 10-12 are complete but uncommitted
and that the independent completion gate/review in Task 13 remains, or defer
the README's “shipped” status until Task 13 and keep one internally consistent
description in the meantime.

### 6 — P2 — the architecture does not describe references for deduplicated proposal evidence

**Disposition:** accepted.

**Where:** `ARCHITECTURE.md`, the new proposal-evidence storage line around
lines 708-709; `src/proposal.ts`, `writeProposalEvidence`; `src/spec-stage.ts`
around lines 626-661 and the parallel `src/plan-stage.ts` path; `src/store.ts`,
`upsertProposal` around lines 644-680.

**Reachable case:** The same normalized proposal candidate is raised by
different canonical findings or in multiple configured rounds. The shipped
dedup tests exercise this: one proposal row is created and later candidates
link additional source finding ids to it.

**Why it matters:** Every upstream decision writes a distinct
finding-numbered evidence file before proposal deduplication. The proposal row
stores only the first candidate's `evidence_ref`; when a later candidate links
to the row, `upsertProposal` ignores its new reference. That later path survives
inside the proposal audit summary, but not in `proposal.evidence_ref`. The new
binding architecture instead says there is one file per candidate “referenced
from proposal.evidence_ref”, which is false for every linked candidate and
does not tell a query how to discover its retained rationale and hashes.

**Required correction:** Either model an evidence reference per
proposal-source/decision link, or document that the proposal row references
only its creating candidate and state the authoritative lookup for linked
candidate evidence without requiring an undocumented filename convention or
prose parsing.

### 7 — P2 — Task 12 omits the required before/after finding and report counts

**Disposition:** accepted.

**Where:** `docs/features/step5b-upstream-findings/plan.md`, the checked Task 12
evidence requirement at line 1123 and the aggregate count around lines
1178-1181.

**Reachable case:** Read the Task 12 completion record looking for canonical
finding and reviewer-report counts before and after self-critique, as the
checked step requires.

**Why it matters:** The record supplies only the final aggregate—three
canonical findings and three reports after the panels ran. It supplies no
before-self-critique counts. In the shipped five-phase flow no panel runs before
self-critique, so those requested canonical/report counts were not measured by
this smoke. Marking the item complete conceals either an evidence omission or
an internally impossible plan requirement.

**Required correction:** Record explicitly that no pre-self-critique panel
exists and therefore no pre-self-critique canonical/report count was measured,
then reconcile the requirement as an approved deviation. If the intended
comparison was self-critique entries versus later reviewer findings, name those
different measures accurately rather than calling both canonical findings or
reviewer reports.

## Verification performed

- `npm run typecheck`: passed, using `npm.cmd` because the machine's PowerShell
  execution policy blocks `npm.ps1`.
- `node --test test/schema.test.ts`: 8 passed, 0 failed, 0 skipped.
- `npm run check:docs`: exit 0 and `doc-check: clean`; 41 historical path
  warnings before this review artifact was added.
- `git diff --check`: passed.
- The retained Task 12 SQLite database was opened read-only: 1 run, 5 stages,
  10 agent runs, 3 canonical findings, 3 reviewer reports, 3 decisions, 1
  proposal, 1 proposal-source link, and 34 audit events. Stored costs sum to
  $0.36548 and durations to 238,045 ms, consistent with the rounded completion
  record.
- All ten retained raw outputs and the proposal evidence file were read. The
  requested/effective model, panel requests, dispositions, artifact hashes,
  proposal route, and audit summaries match the database record.
- The full `npm test` suite was not rerun during this read-only review because
  project learnings record that `test/verification-stage.test.ts` can mutate
  the real repository by leaking commits and a file. This review does not adopt
  a new independent full-suite count.

No existing implementation or documentation file was changed by the review.
This new record remains open until every finding has a disposition; only then
should its status be changed to `reconciled`.

---

## Reconciliation

**Date:** 2026-09-03
**Disposition:** 7 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — the constraint guard remained vulnerable after its observed
  false pass:** `test/schema.test.ts` and `scripts/doc-check.mjs` both gained
  a `stripLineComments` helper that strips `--` comments from the
  concatenated migration source before any structural parsing, including
  the `CREATE TABLE` paren-depth scan, not only the final `.includes()`
  match. Re-ran the exact realistic false-pass mutation (a comment quoting
  the dropped `UNIQUE (finding_id, agent_run_id)` clause): both checkers now
  fail, naming the missing constraint; restored via `git checkout --`,
  reverified byte-identical. The plan's Task 11 completion record was
  corrected to describe this as a real guard weakness rather than a
  scratch-only authoring mistake, in both the per-item paragraph and the
  guard-count summary paragraph, which had contradicted it.
- **Accepted — Task 11 marks the required retained atomicity replay complete
  without running it:** Task 1's actual retained round-2 reconciliation
  output (finding 8's `addressed` decision adding the ungrounded "single
  atomic exclusive-create operation" criterion, with zero
  `normativeChanges` entries) was replayed read-only against the shipped,
  unmutated `validateReconciliation`, using the real retained spec text and
  design text. The criterion surfaced in `unclaimedNodes`, and the calling
  stage's `unclaimedNodes.length > 0 && conversions.length === 0` rule
  aborts the round — a second guard branch distinct from the per-decision
  conversion path item 6a already proved. Recorded in the plan as item 6c
  and a new paragraph; `docs/hazards.md` hazard 16 was also corrected, since
  its text overstated this as a single "converts to `cannot_determine`"
  path when the unclaimed-node path never converts a decision at all.
- **Accepted — the smoke record claims semantic success that textual
  grounding cannot establish:** Both `.claude/sessions/project-learnings.md`
  and the plan's Task 12 completion record now describe finding 2's
  `addressed` decision as structurally complete and textually matched, with
  the semantic support for its specific choice to copy `base`'s reference
  left unverified by the grounding check — the grounding excerpt states
  only that a same-valued key appears once in the output, not which input's
  reference identity is returned.
- **Accepted — Task 12 records a doc-check result that the completed tree
  does not produce:** Measured `npm run check:docs --json` directly after
  every reconciliation edit: 36 warnings, 0 errors — the same count as
  before Task 12's records existed, not 37 or 41. The original shortfall
  was the record's own backtick-quoted scratch-only filenames (a scratch
  design's *scripts/merge-config.mjs* and *scripts/clamp.mjs*), each itself
  a historical-tier path warning; both records now render scratch-only
  filenames without backticks so the rooted-path checker does not classify
  them as repository paths, and both state the measured count and why the
  earlier one was wrong.
- **Accepted — the current README still says Tasks 11 and 12 remain:**
  `README.md` now states Tasks 10 through 12 are complete but uncommitted
  and that Task 13's independent completion gate and review remain.
- **Accepted — the architecture does not describe references for
  deduplicated proposal evidence:** `ARCHITECTURE.md` section 15's storage
  layout now states that `proposal.evidence_ref` references only the
  creating candidate's evidence file, and that a later, deduplicated
  candidate's evidence file is retained but reachable only through the
  audit summary recorded for that link, not through any structured column.
  Modeling a structured evidence reference per proposal-source link is a
  code change, out of scope for this documentation reconciliation, and is
  not deferred as a tracked item here since the review's required
  correction treated it as one of two independent, equally valid fixes.
- **Accepted — Task 12 omits the required before/after finding and report
  counts:** The plan's Task 12 completion record now states explicitly that
  the before-self-critique canonical/report count is zero by construction,
  not by measurement: the shipped five-phase order runs self-critique
  before any panel exists, so no pre-panel count was ever measurable by
  this sample.
