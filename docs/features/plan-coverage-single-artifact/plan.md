# Plan Coverage Single Artifact Implementation Plan

**Status:** Implemented

**Goal:** Close the coverage line's unstated one-artifact constraint at both
boundaries — the three plan-authoring prompts state that a coverage line names
exactly one approved scope path, the refusal names that rule when a model
ignores it, and the plan review prompt stops inviting the finding that provokes
the breach — so that the failure measured on 2026-09-05 (`AC-008 ->
src/index.html, src/calculator.js`, $1.25141, run terminated at `plan_review`)
cannot recur through either the author's door or the reviewer's.

**Source:** `docs/proposals/plan-coverage-single-artifact-blocks-run.md`,
remedies 1, 2 and 3, chosen by the operator on 2026-09-06; remedy 4 (letting a
coverage entry carry several artifacts) is explicitly not built, being a change
to what a plan may promise rather than a defect fix. The measured incident is
the paid chain of 2026-09-05 recorded in
`docs/features/spec-section-membership/real-run-evidence.md`, and the response
that blocked it is committed at
`test/fixtures/recorded/plan-reconciliation-web-calculator-multi-artifact-coverage.json`.
`ARCHITECTURE.md` section 8 (a plan Coverage line copies only the approved
criterion ID to the left of `->`; the planning gate requires a bidirectional,
unique relation; artifact targets remain constrained by the separately signed
scope) and section 12 ("refuse promises that cannot be kept"). The immediate
precedent is `docs/features/spec-section-membership/plan.md`, which closed the
same class one document earlier and whose implementation note records what its
own review caught.

**Hazards considered:** 3 (a constrained field must have its constraint stated
in the prompt) is the entry this belongs to, and this is its second measured
instance in two days: the prompts give the coverage form as `- AC-001 ->
<artifact path>` and list the approved scope, but never say that the right side
admits exactly one path, so an author told a criterion has two implementing
artifacts wrote both. Tasks 2 and 4 state it and pin it. 16 (a remediation loop
aimed at the wrong artifact cannot repair an upstream omission) is the sharper
half and is why Task 3 exists: three reviewers asked for a second artifact on a
coverage line, which the document cannot express, so no revision could have
satisfied them and the loop could not converge — a prompt change on the author
side alone would leave the panel raising it again. 6 (promises a later stage
cannot keep) governs the gate this touches: `coverageFitsScope` is section 12's
mechanically decidable half, its refusal is correct and stays, and Task 1
changes only what the refusal says. 7 (retries that vary nothing) bears twice:
the repair for this block is a fresh chain against unchanged prompts, which is
why the defect costs a whole run each time; and Task 7's run is permitted
because Tasks 2-3 change the prompts. 4 (fixtures and code agreeing while both
are wrong) sets the verification shape — Task 5's regression is fed from the
committed recorded response, and every guard carries a break-it step. 13
(specifications inventing obligations) bears on Task 3's wording: the reviewer
is told what is not a coverage finding, never to withhold a finding that the
plan fails to deliver a criterion. 11 (a default installation that cannot
complete a run) was weighed and is not engaged: nothing here tightens what a
plan may contain, so no document that validates today stops validating. 17 is
the removal accounting and no obligation is removed here. 1, 2, 5, 8, 9, 10, 12,
14, 15 and 18 were read and bear on nothing: no parser of model output changes,
nothing is discarded, no executable is spawned, no hook installed, no model
alias matched, no second surface appears, no independence or delivery claim
moves.

**Assumptions:** Three.

1. **A coverage line names exactly one artifact, and that stays true.** Remedy 4
   is not built. The planning gate requires every approved ID to appear exactly
   once (`coverageMeetsCriteria`), delivery proves each declared artifact by
   exact path, and widening the relation would change both. A criterion
   implemented by several files names the one artifact that carries the
   obligation.
2. **The refusal keeps blocking.** Remedy 2 makes the block diagnosable, not
   survivable. A target outside the signed scope is a promise the operator did
   not authorize, whatever its shape.
3. **The list separator is a diagnostic hint, not a parse rule.** The message
   names the one-path rule when an offending target looks like a list. Nothing
   splits on it, and no target is accepted because of it — a hint that guessed
   wrong would still refuse, only less helpfully.

**Approach:** One gate change, four prompt changes, one regression fed from the
recorded response, and the record. `coverageFitsScope` already computes exactly
what the operator needs and throws half of it away, so it keeps returning the
criterion IDs the existing assertions pin and additionally returns the finished
refusal sentence, which the three call sites in `src/plan-stage.ts` currently
build identically and separately. The prompts gain one sentence each on the
author side and one paragraph on the reviewer side. Nothing about parsing,
scope, or the gate's verdict changes.

**Affected areas:** `src/plan-gate.ts` (`coverageFitsScope` only),
`src/plan-stage.ts` (the three refusal sites), `src/prompts.ts` (four
builders), `test/plan-gate.test.ts`, `test/plan-stage.test.ts`,
`test/prompts.test.ts`, `test/reconciliation.test.ts` (the recorded replay),
`ARCHITECTURE.md` section 8, `docs/hazards.md` entry 3, and the proposal.

**Known blockers:** None for Tasks 1-6. Task 7 spends money and needs the
operator's authorization, which was given on 2026-09-06 for one run. `npm test`
intermittently leaks stray commits into the real repository, so every suite run
is executed in a disposable mirror that includes `.git` — without it,
`resolveStartingCommit reads HEAD inside this repository` and the `sign-approval`
containment test fail for want of a repository, which is an artifact of the
mirror and not a regression. A phrase pinned in `CONSTRAINT_STRINGS` must sit on
one source line: the scan reads the file text, so a phrase broken by a
template-literal line wrap fails against a prompt that reads correctly.

**Blast radius:** `coverageFitsScope` has three production call sites, all in
`src/plan-stage.ts` — the draft (`:334`), the self-critique revision (`:428`),
and the reconciled revision (`:673`) — and each builds the same message from
`unkeepable.join("; ")`. Five assertions in `test/plan-gate.test.ts` (`:67`,
`:81`, `:106`, `:113`) compare `unkeepable` to an array of criterion IDs, so the
field keeps that shape and those tests must pass unedited;
`test/plan-stage.test.ts:987` matches the message prefix loosely and
`:998`/`:1388` count the `plan.coverage.unkeepable` audit action, so the audit
action name must not change. `coverageMeetsCriteria` is untouched. The four
prompt builders have no callers outside `src/plan-stage.ts` and the tests.
`buildPlanReviewPrompt(agent, planContent, specContent)` does not receive the
scope, so Task 3 must be expressible without it — it is, because the one-to-one
rule is a property of the document, not of the run. Recorded fixtures replayed
by `test/reconciliation.test.ts` at `:881`, `:988` and `:1122` parse plans and
specifications and are unaffected by a gate message; Task 5 adds a fourth replay
beside them. Out of scope and named, not built: the plan document's `## Tasks`
section admits any non-empty line (`src/plan-doc.ts:68-84`), and a declared
artifact wearing Markdown decoration still parses
(`docs/features/spec-section-membership/plan.md`, implementation note).

**Verification:** `npm run typecheck` and `npm run check:docs` from the
repository root; `npm test` in a disposable mirror including `.git`, against the
current baseline of 782 tests / 781 pass / 0 fail / 1 environmental skip;
`node .claude/skills/run-buildworks/driver.mjs smoke` (13/13); and Task 7's
authorized paid run. Every guard added in Tasks 1-5 is proved by breaking what
it guards, with a byte-identical restore.

---

## Tasks

### Task 1: The refusal names the one-artifact rule

**Depends on:** None

**Files:**
- Modify: `src/plan-gate.ts` — `coverageFitsScope`
- Modify: `src/plan-stage.ts` — the three refusal sites at `:334-343`,
  `:428-434`, `:673-679`
- Validate: `test/plan-gate.test.ts`, `test/plan-stage.test.ts`

**Steps:**

- **Step 1: return the offending targets alongside the criterion IDs.** In
  `coverageFitsScope`, keep `unkeepable: string[]` as the criterion IDs — five
  assertions pin that shape, and `test/plan-gate.test.ts:66` records why in a
  comment: "The criterion is what the operator can act on, not the path." The
  path therefore goes into the message, not into that field. Add
  `reason: string` **to the `ok: false` branch only**: `test/plan-gate.test.ts:56`
  asserts `deepEqual(result, { ok: true })` on the success branch, so a field
  added there breaks a passing test for no gain. Build it as
  `plan promises coverage outside the approved scope: <AC-008 -> src/index.html, src/calculator.js>; <...>`,
  listing each offending entry as `<id> -> <target>` so the operator sees the
  value that failed rather than only the criterion it failed for.
  - Verify: `npm run typecheck`
  - Expected: exit 0 — the three call sites still compile because they read
    `unkeepable`, which is unchanged.
- **Step 2: name the rule when a target looks like a list.** When any offending
  target contains a list separator — a comma, ` and `, ` + `, or a semicolon —
  append to that sentence: `a coverage line names exactly one approved scope
  path; a list of paths is not a path`. State it once for the whole refusal, not
  per entry. This is a hint about the likely cause and changes no verdict.
  - Verify: `npm run typecheck`
  - Expected: exit 0.
- **Step 3: use the built sentence at all three sites.** Replace the three
  identical `plan promises coverage outside the approved scope:
  ${...unkeepable.join("; ")}` constructions in `src/plan-stage.ts` with the
  `reason` the gate returns. The audit action stays `plan.coverage.unkeepable`
  at every site — two tests count it by that name.
  - Verify: `npm run typecheck`
  - Expected: exit 0.
- **Step 4: assert both messages.** In `test/plan-gate.test.ts`, add a test that
  a single out-of-scope path produces the sentence naming the entry and **not**
  the one-path clause, and that the recorded shape `src/index.html,
  src/calculator.js` produces the sentence **with** it. Confirm the five
  existing `unkeepable` assertions pass unedited.
  - Verify: `node --test test/plan-gate.test.ts test/plan-stage.test.ts` in the
    mirror
  - Expected: all pass; no existing assertion edited.
- **Step 5: break it.** With the file hash recorded: drop the list-separator
  clause and confirm the recorded-shape assertion fails while the plain
  out-of-scope assertion still passes — the two must be independently pinned, or
  the clause could be emitted unconditionally and nothing would notice. Restore
  and confirm the hash.
  - Verify: the recorded hash before and after
  - Expected: identical hash; exactly one assertion fails under the mutation.

**Task completion evidence:** A refusal that names the failing value and, when
the shape suggests it, the rule that was broken; three call sites reading one
sentence instead of building three.

### Task 2: The three authoring prompts state the one-artifact rule

**Depends on:** Task 1 (the prompt states the rule the gate names)

**Files:**
- Modify: `src/prompts.ts` — `buildPlanAuthorPrompt` (the scope paragraph at
  `:307-311`), `buildPlanSelfCritiquePrompt` (`:385-389`),
  `buildPlanReconcilePrompt` (`:736-740`)
- Validate: `test/prompts.test.ts`

**Steps:**

- **Step 1: extend the scope paragraph in each of the three builders.** Beside
  the existing "Every artifact path you name in ## Coverage must be one of the
  approved scope paths below", add: each coverage line names exactly one
  approved scope path, copied verbatim; a criterion implemented by several files
  names the one artifact that carries the obligation; and a list of paths is not
  a path and blocks the run. Keep each pinned phrase on one source line.
  - Verify: `node --test test/prompts.test.ts` in the mirror
  - Expected: passes.
- **Step 2: say what to do with the honest case.** The author that provoked this
  was answering a true observation — the criterion does touch two files. Add, in
  the two revising builders only (`buildPlanSelfCritiquePrompt`,
  `buildPlanReconcilePrompt`): when a finding says a criterion needs a second
  artifact, the coverage line cannot carry it — name the one artifact that
  carries the obligation and put the others in the task that builds them, or
  reject the finding with a rationale. This is the sentence that turns a
  terminal block into a decision the author can actually take.
  - Verify: `node --test test/prompts.test.ts` in the mirror
  - Expected: passes.

**Task completion evidence:** All three authoring prompts state the constraint
the gate enforces, and the two revising prompts name the move that resolves the
finding without breaching it.

### Task 3: The plan review prompt stops inviting the finding

**Depends on:** None

**Files:**
- Modify: `src/prompts.ts` — `buildPlanReviewPrompt` (`:428-443`, after the
  finding contract)
- Validate: `test/prompts.test.ts`

**Steps:**

- **Step 1: state the relation and what is not a finding.** Add a paragraph:
  coverage is a one-to-one relation — every acceptance criterion has exactly one
  coverage line, and that line names exactly one artifact. "This criterion also
  touches another file" is therefore not a coverage finding, because the
  document cannot express it. A coverage finding names a criterion the plan does
  not deliver, coverage naming the wrong artifact, or coverage promising a path
  outside the approved scope.
  - Verify: `node --test test/prompts.test.ts` in the mirror
  - Expected: passes.
- **Step 2: do not turn it into a silence.** The paragraph must not read as
  "coverage findings are discouraged". The third sentence enumerates what a
  coverage finding *is*, and it stays — a reviewer that stopped reporting a
  criterion the plan fails to deliver would be a worse outcome than the block
  this fixes. Confirm the rendered prompt still tells the reviewer to judge
  whether the plan's tasks and coverage actually deliver the criteria (the
  sentence at `:422` is untouched).
  - Verify: in `test/prompts.test.ts`, assert one generated review prompt
    contains both "actually deliver the specification's acceptance criteria" and
    the new enumeration of what a coverage finding is
  - Expected: both present in the same rendered prompt.

**Task completion evidence:** The reviewer is told what the document can express
and what a coverage finding is, without being told to report fewer of them.

### Task 4: Every new phrase is pinned, per builder

**Depends on:** Tasks 2 and 3

**Files:**
- Modify: `test/prompts.test.ts` — `CONSTRAINT_STRINGS` and the four
  per-builder assertions

**Steps:**

- **Step 1: add the phrases to the file-wide scan** with a comment naming the
  measured incident and its cost.
  - Verify: `node --test test/prompts.test.ts` in the mirror
  - Expected: passes.
- **Step 2: assert each phrase against the rendered prompt of every builder that
  must carry it.** The file-wide scan passes while any one builder still carries
  a phrase — measured on the spec-side change one day earlier, where deleting the
  rule from one of three builders left the suite green. The plan author,
  self-critique and reconciliation prompts each carry the one-path rule; the two
  revising prompts also carry the second-artifact sentence; the review prompt
  carries the one-to-one paragraph.
  - Verify: `node --test test/prompts.test.ts` in the mirror
  - Expected: passes.
- **Step 3: break one phrase in one builder** and confirm a per-builder
  assertion fails, not only the scan. Restore; confirm the hash.
  - Verify: the recorded hash before and after
  - Expected: identical hash; the named builder's test fails.

**Task completion evidence:** No builder can silently lose a rule another
builder still states.

### Task 5: The recorded response is the regression

**Depends on:** Tasks 1-3

**Files:**
- Modify: `test/reconciliation.test.ts` — beside the three existing recorded
  replays
- Validate:
  `test/fixtures/recorded/plan-reconciliation-web-calculator-multi-artifact-coverage.json`

**Steps:**

- **Step 1: replay the blocking response through the gate it blocked in.** Load
  the fixture, pass `envelope.result` to `extractJsonBody` (it returns a tagged
  result — assert `kind === "ok"` before reading `value`), take
  `proposedContentChanges.plan`, parse it with `validatePlanDoc`, and run
  `coverageFitsScope` against the four paths the run signed —
  `src/index.html`, `src/styles.css`, `src/calculator.js`, `src/theme.js`.
  Assert the result is not ok, that `unkeepable` is exactly `["AC-008",
  "AC-017"]`, and that `reason` names both offending targets and the one-path
  rule.
  - Verify: `node --test test/reconciliation.test.ts` in the mirror
  - Expected: passes. The scope values come from the run's own signed scope, not
    from this session.
- **Step 2: assert the rest of that plan is untouched by the change.** The same
  document's other twenty-four coverage entries name in-scope paths; assert
  `unkeepable` has exactly two entries, so the gate is not newly refusing
  anything it accepted before.
  - Verify: `node --test test/reconciliation.test.ts` in the mirror
  - Expected: passes.
- **Step 3: break the fix against real output.** Remove the list-separator
  clause and confirm Step 1's assertion fails on the recorded document
  specifically. Restore; confirm the hash.
  - Verify: the recorded hash before and after
  - Expected: identical hash.

**Task completion evidence:** A real provider response, not a hand-written plan,
pins the refusal this change produces.

### Task 6: The record

**Depends on:** Tasks 1-5

**Files:**
- Modify: `ARCHITECTURE.md` — section 8, the Coverage decisions subsection
- Modify: `docs/hazards.md` — entry 3
- Modify: `docs/proposals/plan-coverage-single-artifact-blocks-run.md`

**Steps:**

- **Step 1: state the rule in the design.** In section 8, beside the existing
  sentence that a Coverage line copies only the approved criterion ID to the
  left of `->`, record that the right side names exactly one artifact path from
  the signed scope, that a criterion implemented by several files names the one
  artifact carrying the obligation, and that the refusal names this rule when a
  target looks like a list. Describe the prompts as stating it too.
  - Verify: `npm run check:docs`
  - Expected: exit 0, no finding against `ARCHITECTURE.md`, no exit 2.
- **Step 2: record the incident under hazard 3.** A `**Measured, 2026-09-05,
  $1.25141.**` paragraph in the shape of the two before it: three reviewers
  asked for a second implementing artifact, the author listed both on one line,
  the pair parsed as one path outside the signed scope, and the run blocked at
  `plan_review`. Name what fixed it on both boundaries, name the committed
  response as the contract test, and record the generalization this instance
  adds — that a finding a document's schema cannot express will be answered by
  breaking the schema, so the prompt that requests the constrained field and the
  prompt that invites findings about it must agree.
  - Verify: `npm run check:docs`
  - Expected: exit 0.
- **Step 3: disposition the proposal.** Mark remedies 1, 2 and 3 applied by this
  plan and remedy 4 not taken, with the operator's decision date. Do not rewrite
  the observation or the analysis — the record of what was believed when it was
  written is the point.
  - Verify: `npm run check:docs`
  - Expected: exit 0.
- **Step 4: full validation.** `npm run typecheck`, `npm run check:docs`,
  `npm test` in the mirror, `driver.mjs smoke`.
  - Verify: the four commands
  - Expected: typecheck and check:docs exit 0; the suite at the 782/781/0/1
    baseline plus the cases added in Tasks 1, 4 and 5, 0 failures, no existing
    assertion edited; smoke 13/13.

**Task completion evidence:** The design states the rule, the hazard entry
records the third measured instance of its class, and the proposal says which
remedies were taken.

### Task 7: One authorized paid run

**Depends on:** Tasks 1-6. **Authorized by the operator on 2026-09-06 for one
run.**

**Files:**
- Create: `docs/features/plan-coverage-single-artifact/real-run-evidence.md`
- Create: a fixture under `test/fixtures/recorded/`, if the run produces a
  response that becomes load-bearing

**Steps:**

- **Step 1: state the cost, then run.** The previous chain reached stage 5 of 9
  for $1.25141. A chain that passes `plan_review` continues into
  `implementation`, `verification` (deterministic, no dispatch), `code_review`
  (two reviewers) and `delivery_check` (no dispatch) — about three further
  dispatches, of which the implementation author is the largest. Budget
  $2.00-$3.50 rather than the driver's stale $1.00-$2.00 note, and say so before
  spending. Run
  `node .claude/skills/run-buildworks/driver.mjs paid --yes` in the background;
  do not pipe it through `tail`, which buffers until exit. Read progress from
  the target's `state.db` (`agent_run.cost`, keyed by `stage_id`).
  - Verify: the driver's step tally and the target's `state.db`
  - Expected: the chain passes `plan_review`. That is what this plan can claim.
    Reaching `code_review` would additionally close
    `docs/features/code-review-stage/plan.md` Task 10, which is that plan's
    outcome to record, not this one's.
- **Step 2: record the run whatever it does**, with the dispatch table, the
  cost, the target, what it establishes and what it does not, a
  `**Hazards considered:**` line, and both the requested and the effective model
  identity, distinguishing the authoring model from any auxiliary harness query.
  A block for a new reason is recorded under its own name, not rounded into a
  nearer outcome.
  - Verify: `npm run check:docs`
  - Expected: exit 0.
- **Step 3: extract any load-bearing response immediately**, into
  `test/fixtures/recorded/` with a `provenance` block naming the run, the stage,
  the dispatch time, the capture date, the cost, the effective models, what was
  dropped from the envelope and what was sanitized — before anything depends on
  the machine-local target, and before `driver.mjs clean` can delete it.
  - Verify: the committed fixture parses and whatever depends on it passes
  - Expected: nothing outside the repository is load-bearing when this closes.

**Task completion evidence:** A dated evidence document, and either a committed
response with provenance or an explicit statement that the run produced nothing
load-bearing.

---

## Gate

Tasks 1-6 executed; `npm run typecheck` and `npm run check:docs` exit 0; the
suite passes in a disposable mirror with no regression against 782/781/0/1 and
no existing assertion edited; smoke 13/13; every guard added in Tasks 1-5 proved
by breaking what it guards with a byte-identical restore; and one independent
code-review pass reconciled. The status advances to `Implemented` when Task 7's
run exists — Tasks 1-6 prove the gate half against recorded output and prove
nothing about whether a live author and a live panel behave differently, which
only a paid run can show.

---

## Implementation note (2026-09-06)

Tasks 1-6 executed on branch `code-review-stage`, one independent code review
reconciled, and Task 7's run spent and recorded. The status is `Reconciled`, not
`Implemented`: the run blocked at stage 1 for an unrelated defect and never
reached the plan stage, so nothing here is confirmed against a live author or
panel. `real-run-evidence.md` records it.

**The governing proposal's design review was not read until after the run.**
`docs/proposals/2026-09-06-plan-coverage-single-artifact-blocks-run-review.md`
was written before this plan and found on the working tree afterwards. Two of
its findings say the plan specified the wrong thing, and both were corrected
after the fact rather than in the plan. Its dispositions are recorded in that
document. Nothing was lost — the run blocked upstream of this work — but the
sequence was wrong, and the check that would have caught it is reading every
review record beside a proposal before planning from it.

**Deviations from the plan as written, in the order they were forced.**

1. **Task 1 Step 2's separator hint was removed, not refined.** The plan
   specified emitting the membership rule only when a target contained a
   separator; the design review rejected inferring intent from punctuation. The
   refusal now states the rule unconditionally, which is simpler, true in the
   ordinary out-of-scope case too, and independent of how a model spells a list.
   A test asserts both refusals carry the identical sentence, so nothing can
   come to depend on telling them apart.
2. **The coverage line's meaning was added, which the plan never specified.**
   The plan defined the shape — one path — and left "the one artifact that
   carries the obligation" as the only guidance. `ARCHITECTURE.md` and all four
   prompts now state that the path is the criterion's representative delivery
   anchor rather than an exhaustive list, and that an author facing several
   contributing files names the one most directly responsible for the
   criterion's observable outcome.
3. **The review prompt redirects rather than only declining.** A reviewer told
   that a second-path request is not a coverage finding is now also told where
   missing implementation work does belong — the plan's tasks. Without that the
   rule reads as "report fewer coverage findings", which is the worse failure.
4. **The `not_applicable` form had to be restored to prompts this change broke.**
   The first implementation's one-artifact sentence withdrew it by omission: the
   review prompt is the only plan prompt that never restates the schema, so that
   sentence became the whole description a reviewer receives, and the three
   authoring prompts contradicted the two-form schema they state five lines
   earlier. Caught by the independent code review.

**The independent code review raised seven findings, all reconciled.** Four were
defects in this work — the `not_applicable` omission above (two of them), an
`ARCHITECTURE.md` sentence claiming a one-to-one relation that is false in the
recorded plan, and a reconciliation escape hatch that named only the route which
fails closed. Two were smaller: the separator predicate missed space-separated
pairs, and the hazard entry said "instead of" where the message appends. One was
this document's own `**Status:**`.

**A second, concurrent code review (`2026-09-06-code-review-2.md`) raised two
findings, both reconciled.** Its separator-heuristic finding is deviation 1 and
its representative-anchor finding is deviation 2 above; both were corrected in
the tree before that record carried a `**Status:**` line or a disposition, and
the dispositions were written after the fact on 2026-09-06. The record's
withheld concerns had already been fixed by the first review's reconciliation.

**Two process failures worth keeping.** A phrase pinned in `CONSTRAINT_STRINGS`
broke across a template-literal line wrap twice during this change, each time
after a rewrite that read correctly — the plan's own Known blockers section
names this exact trap. And a `python - <<` heredoc with no python on PATH hung
on stdin until it was killed, which is a recorded lesson that was walked into
anyway.

**Task 7 closed (2026-09-06, later pass).** With the extractor fixed, a third
authorized run passed `plan_review` in one round: the live author wrote twenty
coverage lines, nineteen naming exactly one approved path and one in the
`not_applicable` form with a rationale and an alternative verification
(AC-020), and the live panel raised one coverage-adjacent finding — that the
AC-020 alternative verification named an inspection no task performed — which
asked for a *task*, not a second artifact, and the author answered by adding
the task (`addressed`). That is the redirect Task 3 wrote into the review
prompt, observed on a live panel. The chain went on through implementation and
verification and blocked at `code_review` on two correct findings, which is
that feature's evidence. The status advances to `Implemented`; detail in
`real-run-evidence.md`. Hazard 1 shape 8 did not recur on this run, so the
extractor fix is proved by replay only.

**Follow-ups, none built.** The extractor defect Task 7 measured
(`docs/proposals/prose-before-unfenced-json-discards-a-valid-result.md`), which
blocks every paid run until resolved; remedy 4, multi-artifact coverage, still a
separate product decision; and the two named in the sibling feature — the plan
document's open `## Tasks` membership, and a declared artifact wearing Markdown
decoration.
