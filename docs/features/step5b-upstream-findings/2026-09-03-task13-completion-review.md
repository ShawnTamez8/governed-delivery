# Step 5b Task 13 — completion gate and independent review

**Status:** reconciled

**Reviewed document:** `docs/features/step5b-upstream-findings/plan.md` (Task
13's own step 2: an independent reviewer assessing the implemented diff
against the plan, the four reconciled review records, the Task 1-approved
architecture amendment, hazard 16, migration safety, and the break-it
evidence), together with the current uncommitted working-tree diff it
describes.

**Review date:** 2026-09-03

**Effort:** high. Read `ARCHITECTURE.md`, `docs/hazards.md`, and the full
`plan.md` (all of Tasks 1-13 and the completion gate) end to end; diffed and
read every changed file in full; read `src/reconciliation.ts` in full and
traced `unclaimedNodes` handling into `src/spec-stage.ts`; read
`src/migrations/005_finding_report_decision.sql` and `006_proposal.sql` in
full; read `scripts/doc-check.mjs` and `test/schema.test.ts` in full, not
only their diffs; independently reran the three gate commands; reproduced
three of Task 11's twenty break-it mutations live in a scratch edit-and-restore
cycle against the real working tree (not the historical scratch worktree),
confirming both the named failure and a byte-identical restoration each time;
opened the retained Task 12 smoke database read-only via `node:sqlite` and
queried it directly rather than trusting the recorded counts; read the
retained Task 1 prototype evidence file the Task 11 item 6c replay is built
on; and confirmed via `git log` that the four plan-level review records are
untouched since commits that predate this diff.

**Hazards considered:**

- **1** (model output shapes) — not newly exercised: this diff adds no parser
  and changes no dispatch path; `src/reconciliation.ts`'s `extractJsonBody`-
  adjacent validators are unchanged.
- **2** (discarded output undiagnosable) — checked against the retained Task
  12 evidence: all ten raw dispatch outputs and the one proposal evidence
  file exist on disk under the scratch target's `.governance/`; nothing here
  discards bytes before validation.
- **3** (unstated prompt constraints) — not newly exercised: no prompt text
  changed in this diff; Tasks 4-9 already carry this guard and are out of
  this diff's scope.
- **4** (fixtures and code agreeing while both are wrong) — the central
  concern for Task 11's break-it table and the constraint-guard false pass it
  recorded. Independently reproduced the exact false-pass mutation (a dropped
  `UNIQUE (finding_id, agent_run_id)` constraint hidden behind an explanatory
  SQL comment) against both `test/schema.test.ts` and
  `scripts/doc-check.mjs --only=constraints` on the current tree: both now
  fail, naming the missing constraint, confirming the `stripLineComments` fix
  this diff adds is real rather than narrated.
- **5, 6** (completion without delivery; promises a later stage cannot keep) —
  not exercised: this diff touches no runtime stage and no coverage/scope
  gate.
- **7** (retries that vary nothing) — not exercised: no dispatch or retry path
  changed.
- **8, 9, 10** (Windows executable resolution; unverified hook interpreters;
  exact-match model aliasing) — not exercised: no executor, hook, or model
  configuration code is in this diff.
- **11** (a default install that cannot complete a run) — checked against the
  retained Task 12 smoke: both panels staffed the default two-reviewer
  registry cleanly on a real run, confirmed by direct query of the retained
  database (two distinct reviewer `agent_run` rows per stage, matching the
  requested specialties).
- **12** (configuration divergence between targets) — checked: the smoke's
  frozen profile and every stored requested/effective model pair were
  inspected via the database query below; no live-policy read and no model
  mismatch.
- **13** (specifications inventing obligations) — checked against the
  retained `11-reconcile2.result.json`: finding 8's `addressed` decision adds
  the "single atomic exclusive-create operation" criterion, which is exactly
  the invented-obligation case hazard 16 and Task 11 item 6c exist to guard
  against; confirmed the guard code (`unclaimedNodes.length > 0 &&
  conversions.length === 0` in both `src/spec-stage.ts` and
  `src/plan-stage.ts`) is present and matches the narrative.
- **14** (independence that cannot be proven) — the plan's Task 12 record
  correctly labels all ten real dispatches `configured_standalone` (verified
  directly against the database), because they ran through the real `bw` CLI
  as a separate process. This review itself is the opposite case and is
  labeled accordingly in the Summary below: it runs as a subagent inside the
  same Claude Code harness session that produced the diff under review, so it
  is `unverified_self_attestation`, not `configured_standalone`.
- **15** (proposal subprocess read-only enforcement) — not exercised: no
  executor invocation code is in this diff.
- **16** (a remediation loop aimed at the wrong artifact) — the diff's own
  subject. Read the full hazard 16 text against `src/reconciliation.ts`'s
  actual `validateReconciliation` (the claim-accounting loop, the `convert()`
  helper, and the `unclaimedNodes` computation) and against the calling
  stages' abort condition, not only against the plan's prose describing them.
  Confirmed the two-path description (a claimed-but-ungrounded node converts
  its decision to `cannot_determine`; a node no decision claims at all
  surfaces in `unclaimedNodes` and aborts the round when no conversion
  already exists) matches the code exactly. One nuance the hazard text does
  not spell out: the abort in `src/spec-stage.ts`/`src/plan-stage.ts` fires
  only when `conversions.length === 0`; if the same round already produced an
  unrelated conversion, the unclaimed node does not itself trigger the abort.
  This does not weaken the guarantee — any conversion already yields a
  `cannot_determine` decision, which `BLOCKING_DISPOSITIONS` blocks on
  regardless — and the Tasks 7-9 implementation note already records this
  exact reasoning, so it is not a new gap. Not raised as a finding below.

**Scope reviewed:** `git diff HEAD` across `.claude/sessions/project-learnings.md`,
`ARCHITECTURE.md`, `README.md`,
`docs/features/step5b-upstream-findings/plan.md`, `docs/hazards.md`, and
`scripts/doc-check.mjs`, plus the new untracked
`docs/features/step5b-upstream-findings/2026-09-02-task10-12-code-review.md`.
Confirmed via `git status --short` that no `src/` file, no `design.md`, no
`spec.md`, and nothing under `docs/proposals/` is touched. Traced the
unchanged `src/reconciliation.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`,
`src/store.ts` (`upsertProposal`), and `src/plan-gate.ts` because Tasks 10-12's
documentation describes their behavior. Read `src/migrations/005_finding_report_decision.sql`
and `006_proposal.sql` in full. Read the four plan-level reconciled review
records' git history (not their content, already reviewed in prior sessions)
to confirm they carry no commit since before this diff existed. Directly
inspected external retained evidence outside the repository:
`../step5b-task1-prototype/evidence/11-reconcile2.result.json` (the Task 1
retained replay input) and the Task 12 scratch smoke target's
`.governance/state.db` and `.governance/proposals/1/finding-1.json`, both at
the path project-learnings.md records.

## Summary

This is documentation, a checker script, and one test file — no `src/`
production code, no stage-sequence change, no requirement-ID scheme, no
`design.md`/`spec.md` edit, and no write under `docs/proposals/`. `npm run
typecheck`, `node --test test/schema.test.ts`, and `npm run check:docs`
(measured with `--json`) are all clean, and the exact numbers match every
count the diff's prose claims: 0 typecheck errors, 8/8 schema tests, 0
doc-check errors, 36 warnings.

The diff is, in effect, the reconciliation of an already-completed
independent review: `docs/features/step5b-upstream-findings/2026-09-02-task10-12-code-review.md`
(status `reconciled`) found seven findings against an earlier state of this
same Tasks 10-12 work — most seriously, a constraint-check guard that stayed
vulnerable to a realistic false pass after its own break-it proof — and every
one is now fixed in the diff I reviewed. I did not take that reconciliation on
faith: I independently re-derived the constraint-guard fix by reproducing the
exact false-pass mutation (a dropped `UNIQUE` constraint hidden behind a
comment quoting it) against the current `test/schema.test.ts` and
`scripts/doc-check.mjs`, and both now fail correctly, naming the missing
constraint. I independently reproduced two further break-it table rows
(`BLOCKING_DISPOSITIONS` reduced to hide `cannot_determine`; the
`usedSpecialties` duplicate-specialty guard in `select.ts`) with the same
mutate-run-restore protocol, and both matched their table entries exactly. I
independently queried the retained Task 12 production-smoke SQLite database
directly (not by reading the narrative) and every row count, cost sum, and
duration sum in the plan's completion record and in the prior review's
verification section is exactly reproduced: 1 run, 5 stages, 10 agent runs,
3 canonical findings, 3 reviewer reports, 3 decisions, 1 proposal, 1
proposal-source link, 34 audit events, total cost $0.3654772, total duration
238045 ms. The proposal evidence file exists at the recorded path, and no
`docs/proposals/` directory exists under the scratch target.

On the specific instruction this task gives every reviewer — flag any place
the diff lets exact-match grounding or a mechanical gate stand in for
semantic correctness — I read every paragraph the prior review's findings 3
and 7 touched (the Task 12 `addressed`/`rejected_with_rationale` semantic
claims, and the before-self-critique count) and confirmed the corrected
wording is genuinely present and consistently hedged: "structurally complete
and textually matched, with the semantic support ... unverified," not
"correctly grounded" or similar. I found no further instance of this pattern
in the diff.

On the "four reconciled review records" reading a prior session flagged for
independent sanity-checking: I read it the same way. `plan.md`'s own
**Source** line (line 7) names `2026-08-31-plan-review.md`,
`2026-08-31-plan-review-2.md`, `2026-09-01-plan-review-3.md`, and
`2026-09-01-plan-review-3-review.md` explicitly as "the four reconciled
review records retained as the decision trail," and every later per-task
code-review file (task5, task6, task6-2, task7-9, task10-12) is referenced
separately throughout the completion records as "independent review in
`<filename>`" — a distinct, later category. `git log` confirms none of the
four plan-level records has been touched by any commit since `84b75e1` /
`911ab0c`, both well before the current `HEAD` (`54ee29b`), and `git status`
shows no modification against any of the four.

No findings.

**Independence disclosure (hazard 14).** This review runs as a subagent
inside the same Claude Code harness session and repository state that
produced the diff under review. Per architecture section 6 and hazard 14's
own vocabulary, this is `unverified_self_attestation` independence, not
`configured_standalone` — a separately spawned reviewer process would be a
stronger guarantee than what this review can claim, and this record should
not be read as implying one.

## Findings

No findings. Every claim checked against source, the retained Task 1 and Task
12 evidence, and a live re-execution of representative break-it mutations
held. This is not a report of a clean-on-inspection diff: it is backed by
independent re-derivation (three live mutate/run/restore cycles, a direct
SQLite query against retained evidence, and a direct read of the retained
prototype JSON), not a re-reading of the plan's own narrative.

## Verification performed

- `npm run typecheck` — clean, no output, exit 0.
- `node --test test/schema.test.ts` — 8 passed, 0 failed, 0 skipped.
- `node scripts/doc-check.mjs --json`, parsed programmatically — `errors:
  0`, `warnings: 36`; plain `node scripts/doc-check.mjs` exits 0 and prints
  `doc-check: clean`. Matches every number the diff's prose claims (36
  warnings, 0 errors, unchanged from before Task 12's records existed).
- `git status --short` and `git diff HEAD --stat` — confirmed the diff is
  exactly `.claude/sessions/project-learnings.md`, `ARCHITECTURE.md`,
  `README.md`, `docs/features/step5b-upstream-findings/plan.md`,
  `docs/hazards.md`, `scripts/doc-check.mjs`, `test/schema.test.ts`, plus one
  new untracked review file. No `src/` file, no stage-sequence change (`git
  diff HEAD -- ARCHITECTURE.md` touches only sections 14, 15, and 22 — 5, 12,
  and 13 are absent from the diff), no requirement-ID text, no `design.md` or
  `spec.md`, and no file under `docs/proposals/`.
- `git log -1` / `git rev-list --left-right --count HEAD...origin/master` —
  `HEAD` is `54ee29b`, identical to `origin/master`, 0 ahead / 0 behind,
  matching project-learnings.md's stated commit.
- **Break-it reproduction 1 (Task 11 item 13, the constraint-guard false
  pass).** Edited `src/migrations/005_finding_report_decision.sql`, replacing
  `finding_report`'s `UNIQUE (finding_id, agent_run_id)` line with the exact
  comment `-- UNIQUE (finding_id, agent_run_id) removed: reports may now
  supersede each other`. `node --test test/schema.test.ts` failed exactly the
  named assertion (`finding_report one report per reviewer`,
  `AssertionError`, `actual: false, expected: true`).
  `node scripts/doc-check.mjs --only=constraints` failed with `constraint
  absent from finding_report's final table body: UNIQUE (finding_id,
  agent_run_id)`. Restored with `git checkout --
  src/migrations/005_finding_report_decision.sql`; `git diff --stat` on that
  file was empty afterward.
- **Break-it reproduction 2 (Task 11 item 9, the human-routing block).**
  Edited `src/plan-gate.ts`, reducing `BLOCKING_DISPOSITIONS` to
  `["upstream_blocking"]`. `node --test test/plan-gate.test.ts` failed the
  named test (`planReviewGate blocks on cannot_determine and
  upstream_blocking, naming their finding ids`), returning `[3]` instead of
  `[2, 3]`. Restored with `git checkout -- src/plan-gate.ts`; clean.
- **Break-it reproduction 3 (Task 11 item 17, the distinct-specialty
  guard).** Edited `src/select.ts`, removing the `usedSpecialties.has(candidate.specialty)`
  clause from `selectReviewers`'s `seat()` closure. `node --test
  test/select.test.ts` failed the named test ("the selector never seats the
  same specialty twice"), seating 2 distinct specialties where 3 were
  expected. Restored with `git checkout -- src/select.ts`; clean.
- After all three reproductions, `git status --short` and `git diff HEAD
  --stat` matched the pre-mutation baseline exactly (same seven modified
  files, same untracked review file, no leftover mutation).
- **Retained Task 12 smoke database, queried directly** (`node:sqlite`,
  read-only, against
  `%LOCALAPPDATA%\Temp\bw-task12-smoke\1788395870372\target\.governance\state.db`):
  `run` 1, `stage` 5, `agent_run` 10, `finding` 3, `finding_report` 3,
  `finding_decision` 3, `proposal` 1, `proposal_source` 1, `audit` 34;
  `SUM(cost)` = 0.3654772, `SUM(duration_ms)` = 238045; all ten `agent_run`
  rows show `requested_model = effective_model = claude-sonnet-5`, `fallback
  = NULL`, `independence = configured_standalone`; decisions and reports by
  finding id match the plan's table exactly (finding 1
  upstream/medium/upstream_follow_up, finding 2 current_artifact/low/addressed,
  finding 3 current_artifact/low/rejected_with_rationale). Confirmed
  `.governance/proposals/1/finding-1.json` exists, and confirmed no
  `docs/proposals/` directory exists under the scratch target's `docs/`.
- **Retained Task 1 prototype evidence, read directly**:
  `../step5b-task1-prototype/evidence/11-reconcile2.result.json` (outside
  this repository, at the path the plan cites) contains finding 8's
  `addressed` decision with the rationale text about the "single atomic
  exclusive-create operation" and the corresponding acceptance criterion in
  the returned spec text, with no `normativeChanges` field present —
  consistent with the plan's and hazard 16's description of this as the
  retained ungrounded-`addressed` case. I did not independently re-run the
  actual replay script against `validateReconciliation`; I verified the input
  evidence matches the narrative and that the guarded code path
  (`unclaimedNodes.length > 0 && conversions.length === 0` in
  `src/spec-stage.ts`) exists and would act on it as described. This one
  piece is corroborated, not independently re-executed end to end.
- `git log --oneline -1 -- <file>` for each of the four plan-level review
  records — `2026-08-31-plan-review.md` and `2026-08-31-plan-review-2.md`
  last touched at `84b75e1`; `2026-09-01-plan-review-3.md` and
  `2026-09-01-plan-review-3-review.md` last touched at `911ab0c`; both
  commits predate `HEAD` (`54ee29b`), and none of the four appears in `git
  status --short`.
- Full `npm test` was **not** run, matching the choice already recorded in
  `2026-09-02-task10-12-code-review.md`: project-learnings.md records that
  `test/verification-stage.test.ts` has intermittently left stray commits and
  a `base.txt` on the real repository in past runs, and this review does not
  need a new full-suite count to support its conclusions. `git log --oneline
  -5` and `git status --short` after every mutation cycle above showed no
  unexpected commit and no stray file at any point in this session. The
  session driving Task 13 separately ran the full suite for its own gate
  step: 625 tests, 624 pass, 1 pre-existing skip, 0 fail, with no repository
  leak observed before or after.

---

## Reconciliation

**Date:** 2026-09-03
**Disposition:** No findings
**Status:** reconciled
