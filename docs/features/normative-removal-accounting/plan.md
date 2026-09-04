# Normative Removal Accounting Implementation Plan

**Status:** Reconciled

**Goal:** Make the reconciliation normative delta account for removed nodes as
well as added ones, so an `addressed` decision can no longer discharge a
reviewer's finding by silently deleting the acceptance criterion the finding
was about.

**Source:** `docs/hazards.md` entry 17 ("A reconciliation that answers a
finding by deleting the obligation") and its closing remedy paragraph;
`ARCHITECTURE.md` section 12, the `addressed` paragraph and the closing
sentence of "What these checks do not establish".

**Hazards considered:** 17 is the subject — its remedy paragraph is the
requirement this plan implements, and the plan follows it literally rather than
substituting a cheaper rule. 13 (specifications inventing obligations) is the
constraint in the other direction and shapes Task 2's all-or-nothing matching:
a removal rule that refuses a legitimate reword would be the validator
inventing an obligation the source never stated, which is why the accepted path
for a replacement is spelled out and tested rather than left to discovery. 3 (a
constrained field must have its constraint stated in the prompt) makes Task 4
mandatory and non-deferrable: the author cannot satisfy an obligation the
prompt never states, and skipping it would turn a correct guard into a
guaranteed paid-run block. 4 (fixtures and code agreeing while both are wrong)
is why every new guard in Tasks 2 and 3 carries a break-it step, and why Task 2
replays a retained real response instead of resting on fixtures — the existing
fixtures were written against addition-only accounting, so a suite that passes
after Task 2 proves the fixtures were updated, not that the guard works.
5 (completion without delivery) bears on the gate: a completion criterion
satisfiable by a run that never exercised the guard, or by one that disproved
it, is the same mistake at the level of evidence, which is why Task 6's
outcomes are separated and only one of them is live proof. 7 (retries that vary
nothing) bore on the design and on Task 6: the change adds no dispatch and no
round, because both directions of the delta come from artifacts the stage
already holds, and a paid run that produced no replacement is not repeated in
hope of a different answer. Entries 6, 11, 12, 14, 15 and 16 were read and bear
on nothing here — this change adds no stage, no downstream promise, no panel
seat, no configuration surface, no independence claim, no scope surface, and no
remediation loop.

**Assumptions:** The remedy paragraph of hazard 17 is read literally: every
node present before reconciliation and absent after must be claimed, with no
exemption for the superseded half of a replacement. The alternative — treating
a removal whose stable criterion ID still appears in the after-set as a
modification already covered by the addition claim — is a narrower rule that
would cost less in author obligation, but it is not what the requirement says,
and inventing it here would be the plan choosing its own expected value. It is
recorded as the deferred follow-up in Task 6 instead, to be reopened only if a
live run shows authors failing the literal rule on legitimate rewords.

**Approach:** Removals ride the claim channel that already exists. An
`addressed` decision's `normativeChanges` entries keep their exact shape
(`artifactLocation`, `artifactText`, `grounding`), and deterministic code
decides whether each claimed `artifactText` is an added node or a removed one —
the author never asserts the direction, which preserves the authority split
section 12 states, where the author supplies the semantic disposition and
deterministic code validates. Because the entry shape does not change, there is
no schema change, no migration, and no change to `finding_decision` or its
storage guard. The multiset diff is reused with its arguments swapped rather
than reimplemented.

**Affected areas:** The reconciliation contract and validator
(`src/reconciliation.ts`), the two stages that call it (`src/spec-stage.ts`,
`src/plan-stage.ts`), the reconciliation prompt (`src/prompts.ts`), the two
shared harness emitters the stage tests drive their reconciliation behaviour
from (`test/fixtures/harness/emit-spec-stage.mjs`,
`test/fixtures/harness/emit-plan-stage.mjs`), and the binding design documents
(`ARCHITECTURE.md` section 12, `docs/hazards.md` entry 17).

**Known blockers:**

- **This is a design change, not a patch.** `ARCHITECTURE.md` section 12
  currently specifies the asymmetry in the `addressed` paragraph, which
  requires that every added node be claimed exactly once and says nothing about
  a removed one, and it states the consequence outright in the closing sentence
  of "What these checks do not establish": stable criterion identity does not
  authorize removal, the normative delta remains addition-only, and hazard 17's
  deleted-obligation gap is unchanged. Code that closes the gap without
  amending both places leaves the binding document contradicting the
  implementation. Task 5 is therefore not optional cleanup — it is part of the
  change. Verified by reading section 12.
- **The build-order stop at step 9 does not apply.** `CLAUDE.md` forbids
  building past step 9 without an explicit decision. This work adds no deferred
  stage, no dashboard, and no notifications; it closes a recorded hazard inside
  `spec_review` and `plan_review`, both of which shipped in build-order steps 3
  and 5. Verified against `ARCHITECTURE.md` section 23 and the section 12
  deferred list, neither of which names this work.
- **There is no remediation round, so a false refusal is terminal.** Section
  12's "Deferred before the step 9 milestone" states that a fresh run is the
  only repair for the three deferred behaviours, and spec reconciliation runs
  before the approval gate. A removal rule that refuses a legitimate revision
  therefore costs a whole paid run, which is why Task 4 states the obligation
  in the prompt, Task 2 proves the accepted path against a retained real
  response before anything is spent, and a live false refusal blocks
  completion rather than being noted and passed over.
- **The existing suite was written against addition-only accounting, and the
  stage half of it lives outside the test files.**
  `test/reconciliation.test.ts` carries replacement fixtures that reword a
  criterion from one text to another. The stage tests do the same, but they do
  not define that behaviour themselves: `test/spec-stage.test.ts` and
  `test/plan-stage.test.ts` drive the harness through
  `test/fixtures/harness/emit-spec-stage.mjs` and
  `test/fixtures/harness/emit-plan-stage.mjs`, and each emitter's `reconcile`
  function returns exactly one claim — the added half of the replacement it
  makes. Verified by reading both emitters. Editing only the two test files
  leaves both emitters addition-only and the suite failing, and the tempting
  repair then looks like weakening an assertion instead of fixing a
  model-shaped payload. Broad failure after Task 2 is expected fixture debt,
  not evidence the design is wrong; Task 2 names how to tell the two apart.
- **`npm test` intermittently leaks empty `moved` commits and a stray
  `base.txt` onto the real repository**, root cause untraced, recorded in
  `.claude/sessions/project-learnings.md`. This plan does not authorize
  repairing that: rewriting the real repository's history or deleting files
  from it is a destructive operation requiring the operator's explicit
  approval, and a plan that pre-authorizes it in a step is exactly the failure
  the lessons file warns about. The pre-gate full-suite run is therefore
  executed in an isolated copy that carries the uncommitted work, per Task 3
  Step 7, so a leak cannot reach the real branch and nothing needs repairing.
- **Task 6 spends real money, is optional, and needs the operator.** The paid
  chain requires operator authorization per
  `.claude/skills/run-buildworks/SKILL.md`, and a lapsed `claude` OAuth session
  fails the spec dispatch closed, recorded in
  `.claude/sessions/project-learnings.md` for 2026-09-03. Do not start Task 6
  without both. It is supplementary evidence, not the verification claim — that
  rests on Task 2's recorded-output replay.
- **The paid driver cannot be aimed at a replacement.**
  `.claude/skills/run-buildworks/SKILL.md` describes one fixed scratch design
  the driver commits, so whether a live reconciliation rewords a normative node
  is the model's choice, not the operator's. That is why live proof is optional
  here and why an inconclusive run is not repeated: an identical dispatch
  rerun in hope of a different answer is hazard 7.

**Blast radius:** Verified by searching for every consumer of the delta, not
inferred.

- `deriveAddedNormativeNodes` is exported from `src/reconciliation.ts` and has
  exactly two consumers: `validateReconciliation` in the same file, and
  `test/reconciliation.test.ts`, which imports it directly. No stage calls it,
  and it is not re-exported anywhere.
- `validateReconciliation` has exactly two production callers,
  `src/spec-stage.ts` and `src/plan-stage.ts`, each passing
  `beforeNormativeNodes` and `afterNormativeNodes` built from
  `specNormativeNodes` and `planNormativeNodes` respectively. Both node
  builders live in `src/reconciliation.ts` and have no other callers.
- `unclaimedNodes` is read in exactly four places: the abort branch and the
  reconcile audit summary of `src/spec-stage.ts`, and the same two sites in
  `src/plan-stage.ts`. It is not persisted to any table.
- The `normativeChanges` field crosses one persistence boundary:
  `FindingDecisionInput.normativeChanges` in `src/store.ts`, written as JSON
  into the `normative_changes` column declared in
  `src/migrations/005_finding_report_decision.sql`. Because this plan does not
  change the entry shape, that boundary is untouched — no migration, no change
  to the `requiresNormativeChanges` guard, and no edit to the schema fence in
  `ARCHITECTURE.md`. This was the deciding argument for reusing the channel: a
  separate removals column would have required rebuilding the
  `finding_decision` table in a new migration, because `scripts/doc-check.mjs`
  derives table columns from `CREATE TABLE` bodies only and would not see a
  column added by `ALTER TABLE`.
- `reconciliationDecisionContract` in `src/prompts.ts` has exactly two callers,
  both in the same file: the spec reconciliation prompt, which passes the
  design as the governing source and "declared artifact or acceptance
  criterion" as the node description, and the plan reconciliation prompt, which
  passes the specification and "task or coverage line". One edit reaches both
  prompts, which is why Task 4 asserts the new sentence per prompt and not only
  in a whole-file scan.
- The stage tests do not define their own reconciliation behaviour. Both
  `test/spec-stage.test.ts` and `test/plan-stage.test.ts` point the harness at
  a shared emitter under `test/fixtures/harness/`, and each emitter's
  `reconcile` function builds the decision payload — including the single
  `normativeChanges` claim for the replacement it makes. Verified by reading
  both emitters. They are therefore modification targets in their own right,
  and they are where the stage-level accepted path is expressed: an emitter
  that claims both halves is the positive stage test, and the suite passing
  with it is that path proved deterministically.
- The retained web-calculator target named in
  `.claude/sessions/project-learnings.md` holds a real reconciliation response
  whose `addressed` decision reworks a plan task and claims only the added
  half. Verified by reading the retained raw response in that target's run
  store. It is the negative contract fixture Task 2 needs, so no new spend is
  required to obtain one — but it exists only in machine-local scratch state
  that `driver.mjs clean` deletes, which is why Task 2 copies what it needs
  into the repository rather than reading it from there at test time.
- `docs/hazards.md` is `current` tier per `.claude/skills/doc-check/SKILL.md`,
  so entry 17 must assert what is true after this change. The hazard count
  stated in `ARCHITECTURE.md` section 22 is derived from heading count and is
  unaffected, because no entry is added or removed.

**Verification:** `node --test test/reconciliation.test.ts` for the unit
guards, `npm test` for the whole suite, `npm run typecheck`,
`npm run check:docs`, and `node .claude/skills/run-buildworks/driver.mjs smoke`
for the twelve free steps. Each new guard is proved by break-and-restore, per
the working rule that a test passing on first write has shown only that the
reading matched the code.

The load-bearing evidence is the recorded-output replay `ARCHITECTURE.md`
section 21 names, not a live run. Section 21 puts contract tests fed by
recorded real output above test-driven work, and hard rule 5 forbids a
hand-written fixture from defining correctness, so Task 2 replays a retained
real reconciliation response through the validator in both directions: the
negative case, where the response claims only the added half of a genuine
replacement and must now block, and the positive case, where both halves are
claimed and must pass. Those two plus the deterministic stage tests carry the
verification claim on their own.

A paid live run is optional supplementary evidence. No free path reaches a
reconciliation dispatch — `.claude/skills/run-buildworks/SKILL.md` states the
free path stops at `approval-request` — so a live run is the only way to see a
real author answer the revised prompt. A run in which the author claims both
halves of a replacement strengthens the evidence; a run that produced no
replacement is inconclusive and settles nothing; a run in which a legitimate
replacement is falsely refused is a completion blocker. Live-provider
compliance is claimed only where it was actually observed, and never inferred
from a run that did not exercise it.

---

## Tasks

### Task 1: the gap is reproduced as a failing unit assertion

**Depends on:** None

**Files:**
- Modify: `test/reconciliation.test.ts` — new tests beside the existing
  `deriveAddedNormativeNodes` cases

**Steps:**

- **Step 1: confirm the baseline is already pinned, and add nothing for it.**
  `test/reconciliation.test.ts` already asserts the addition-only behaviour on a
  deletion in two places — a before-set holding one criterion against an empty
  after-set, and a two-node before-set against a one-node after-set, both
  expecting an empty result. Read them and leave them exactly as they are: this
  plan keeps `deriveAddedNormativeNodes` addition-only and adds a second named
  function beside it, so those assertions stay correct and a third copy of them
  would be duplication rather than coverage.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: green, unchanged. Nothing was added in this step; it exists so the
    implementer does not re-assert what is already pinned.

- **Step 2: write the removal assertion that cannot pass yet.** Add a test
  asserting that `deriveRemovedNormativeNodes` returns the node for a before-set
  holding one criterion against an empty after-set, returns an empty array for a
  pure addition, and collapses whitespace on both sides the way its sibling
  does. Import the symbol from `src/reconciliation.ts`.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: the file fails to run, because `deriveRemovedNormativeNodes` does
    not exist and the import does not resolve. This is the regression Task 2
    Step 1 turns green.

**Task completion evidence:** `test/reconciliation.test.ts` contains a
removal-derivation test that fails for a named reason, and the pre-existing
addition assertions still pass unmodified.

### Task 2: removals are derived and must be claimed exactly once

**Depends on:** Task 1

**Files:**
- Modify: `src/reconciliation.ts` — `deriveRemovedNormativeNodes` (new),
  `ReconciliationValidation`, `validateReconciliation`
- Create: a sanitized recorded-response fixture under `test/fixtures/`,
  carrying the retained web-calculator plan reconciliation payload and the two
  plan revisions it sits between
- Validate: `test/reconciliation.test.ts`

**Steps:**

- **Step 1: add `deriveRemovedNormativeNodes` as a named wrapper over the
  existing multiset diff.** Place it immediately after
  `deriveAddedNormativeNodes`. The body returns
  `deriveAddedNormativeNodes(after, before)` — removals are the before-set minus
  the after-set, which is the same computation with its arguments swapped. Do
  not copy the counting loop; a second implementation of one diff is a second
  place for the whitespace tolerance to drift. Say in the doc comment that the
  swap is the whole implementation, and why a separate name still earns its
  place: the swapped call reads as a bug at a call site.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: Task 1's removal test passes, and every pre-existing derivation
    assertion still passes.

- **Step 2: extend the claim accounting to both directions.** In
  `validateReconciliation`, build a second local map beside the existing
  `claimable`, populated from `deriveRemovedNormativeNodes(
  ctx.beforeNormativeNodes, ctx.afterNormativeNodes)`. Rename the two *local*
  variables so the pair reads correctly at every use — this is the local
  bookkeeping only; the public `unclaimedNodes` field keeps its name for the
  reason Step 3 gives. In the normative-accounting loop, a claim consumes an
  available added node if one remains and otherwise an available removed node.
  Check additions first so the order is deterministic; a text cannot be both,
  because the multiset diff leaves at most one direction non-zero for a given
  node. Keep the all-or-nothing-per-decision rule exactly as it is: a
  decision's entries are consumed only if every one of them claims a unique
  still-claimable node in one direction or the other, and a decision that fails
  is converted rather than partially credited.
  - Change: the provisional `wouldUse` bookkeeping must become one map per
    direction, not one map keyed by text. A decision may legitimately claim the
    same text twice — a node can appear twice in an artifact — and a single
    shared counter would decrement the wrong direction's budget and either
    convert a valid decision or credit an unavailable node. Decide each claim's
    direction once and record the provisional use against that direction only.
  - Change: the failure message that feeds `convert` names only added nodes
    today. It must name both directions, and the assertion in
    `test/reconciliation.test.ts` that pins the old wording is updated with it.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: the claim-matching tests pass with the new message, and a claim
    naming neither an added nor a removed node still converts its decision.

- **Step 2a: confirm removals inherit the grounding requirement rather than
  adding a second check.** Every `normativeChanges` entry already passes
  through `groundingTextuallyFails` against the governing input before it is
  pushed onto the decision, and a failure converts the whole decision. Because
  a removal claim is an ordinary entry, hazard 17's requirement that a removal
  be "grounded in the governing input like any addition" is satisfied by that
  existing check — do not add a parallel one. Prove it rather than assuming it:
  add a test where an `addressed` decision claims a removed node with an
  excerpt that does not occur in the governing text, and assert the decision
  converts to `cannot_determine` and the removal surfaces as unclaimed.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: the new test passes without any new grounding code. If it fails,
    the entry is bypassing the grounding check and that is the defect to fix.

- **Step 2b: state and test which dispositions can claim a removal.**
  `normativeChanges` is forbidden on every disposition except `addressed`, so
  `addressed` is the only disposition that can claim a removal — which is
  exactly hazard 17's "a disposition that permits removal". The consequence
  needs a test because it is the guard's whole point: a reconciliation that
  deletes a normative node while every decision is `rejected_with_rationale` or
  an upstream disposition has no channel to claim it, so the removal stays
  unclaimed and the round fails closed. Add that test.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: the removal is reported in `unclaimedRemovals` and no decision
    was converted, which is the shape Task 3's stage-level abort depends on.

- **Step 2c: replay a retained real response as the negative contract test.**
  `ARCHITECTURE.md` section 21 makes contract tests fed by recorded real output
  the load-bearing category, and hard rule 5 forbids a hand-written fixture
  from defining correctness. The retained web-calculator target named in
  `.claude/sessions/project-learnings.md` holds the response this needs: an
  `addressed` decision that reworks a plan task and supplies exactly one
  `normativeChanges` claim, the added half. Copy the decisions payload and the
  two plan revisions it sits between out of that target's retained raw output
  into a new fixture under `test/fixtures/`, sanitized to remove the session
  id, cost, usage, and any absolute machine path — keep the model-returned
  shape byte-for-byte otherwise, because the shape is the whole point of the
  fixture. Drive it through the same seam production uses: build the node lists
  with `planNormativeNodes` from the two parsed revisions and pass the recorded
  decisions to `validateReconciliation`. Assert that the reworded task's
  superseded text is reported in `unclaimedRemovals`, which is this real
  response failing the new accounting exactly as intended.
  - Change: record in the fixture file's own header where the response came
    from, the run it belongs to, and the date it was captured, so a later
    reader can tell recorded output from an invention. The retained target is
    machine-local and `driver.mjs clean` deletes it, so the copy in the
    repository is the durable artifact.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: the replay reports the superseded task text as an unclaimed
    removal. If it reports nothing, the fixture is not reaching the accounting
    — fix the seam, not the assertion.

- **Step 2d: make the same recorded response the positive test.** Add one
  claim to a copy of the recorded decisions — the superseded half, grounded
  with the excerpt the recorded added-half claim already carries — and assert
  the decision is not converted, that `unclaimedRemovals` is empty, and that
  `unclaimedNodes` is empty. Keep the recorded payload untouched and derive the
  two-claim variant from it in the test, so the negative and the positive are
  visibly the same real response one claim apart. This pair is what the
  verification claim rests on, and it is deterministic: it needs no dispatch,
  no authorization, and no spend.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: the two-claim variant validates cleanly. Together with Step 2c
    this demonstrates both directions of the accepted path against real model
    output rather than an invented payload.

- **Step 3: report unclaimed removals as their own field.** Add
  `unclaimedRemovals: string[]` to `ReconciliationValidation`, populated from
  whatever remains in the removal map after the accounting loop, exactly as
  `unclaimedNodes` is populated from the addition map. Leave `unclaimedNodes`
  named as it is and add one line to its doc comment stating that it carries
  added nodes only and that removals are reported separately. The name is kept
  deliberately: renaming it would churn four production sites and about ten test
  assertions for no behavioural gain, and the doc comment removes the ambiguity
  a reader of the pair would otherwise have. Do not fold removals into
  `unclaimedNodes` — the operator needs to know which direction went
  unaccounted, because the repairs differ.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: a reconciliation that deletes a node with no claim returns
    `unclaimedRemovals` holding that node and `unclaimedNodes` empty.

- **Step 4: prove the guard by breaking what it guards.** Temporarily change
  Step 2's matching so a claim can consume only added nodes, which is the
  pre-change behaviour, and confirm the deletion test fails; restore.
  Separately, temporarily make `unclaimedRemovals` always empty and confirm the
  same test fails; restore.
  - Verify: `node --test test/reconciliation.test.ts` after each mutation and
    each restore
  - Expected: each mutation produces a failing assertion naming the deleted
    node, and each restore returns the file to green. Reverse each mutation by
    editing it back, never with `git checkout --`, which would discard the
    uncommitted work the same file carries.

- **Step 5: reconcile the unit fixtures that reword a node.** Run the file and
  treat each failure by this test: if the fixture's reconciliation replaces a
  node, meaning its before-set carries a node the after-set does not, the
  fixture now owes a second `normativeChanges` entry claiming the superseded
  text, grounded with the same excerpt that grounds the added half. That is
  fixture debt and the fix is mechanical. If instead a fixture fails while
  removing nothing, stop: the accounting is over-claiming and the design is
  wrong, which is a blocking finding for the operator rather than a fixture to
  edit.
  - Verify: `node --test test/reconciliation.test.ts`
  - Expected: the file is green, and every edited fixture gained a claim rather
    than losing an assertion.

**Task completion evidence:** `test/reconciliation.test.ts` passes, including a
test that a deleted acceptance criterion is reported in `unclaimedRemovals`, and
both break-it mutations were observed failing before restore.

### Task 3: both stages fail closed on an unaccounted removal

**Depends on:** Task 2

**Files:**
- Modify: `src/spec-stage.ts` — the unclaimed-node abort branch and the spec
  reconcile audit summary
- Modify: `src/plan-stage.ts` — the same two sites
- Modify: `test/fixtures/harness/emit-spec-stage.mjs` — the `reconcile`
  function's `normativeChanges` payload
- Modify: `test/fixtures/harness/emit-plan-stage.mjs` — the same
- Modify: `test/spec-stage.test.ts`, `test/plan-stage.test.ts` — the new
  removal regressions and any summary assertion the new token changes
- Validate: `test/spec-stage.test.ts`, `test/plan-stage.test.ts`

**Steps:**

- **Step 1: extend the abort branch in `src/spec-stage.ts`.** The existing
  branch fires when there is at least one unclaimed node and no conversions,
  and its long comment explains why a conversion must instead be allowed to
  reach the gate, so the typed answer and the canonical finding id are not
  discarded. That reasoning applies unchanged to removals: a converted decision
  drops its claims, so its removals surface as unclaimed while the
  `cannot_determine` decision still owns the finding. Add `unclaimedRemovals`
  to the same condition and give it its own message, reusing the existing
  sentence shape so an operator reading the refusal can tell which direction
  failed. Keep the abort key `spec.reconcile.invalid`.
  - Verify: `node --test test/spec-stage.test.ts`
  - Expected: the pre-existing unclaimed-addition test still aborts with its
    original message, and nothing else changes yet.

- **Step 2: mirror it in `src/plan-stage.ts`.** The same condition and the same
  two messages, with the plan's wording and the abort key
  `plan.reconcile.invalid`. The two stages deliberately mirror each other
  without a shared abstraction, per hard rule 4 and section 9's note that the
  plan stage mirrors the spec stage; keep it that way rather than extracting a
  helper for two call sites.
  - Verify: `node --test test/plan-stage.test.ts`
  - Expected: as Step 1, for the plan stage.

- **Step 3: carry the count into the audit summary, and know what it cannot
  cover.** Both stages' reconcile summaries end with
  `unclaimed=<n>; proposals=...`. Insert `unclaimedRemoved=<n>; ` immediately
  after the existing `unclaimed=<n>; ` in both stages. Use that exact token in
  both stages and in every test that pins the summary — the two summaries are
  separate string literals, so a spelling that differs between them would make
  one stage's audit unqueryable by the other's key.
  - Change: do not describe this token as the evidence for a blocked removal,
    because it is not. The unclaimed branch in each stage aborts before any
    decision row is inserted and before the `spec.reconcile.record` and
    `plan.reconcile.record` summaries are written, so a round that fails on an
    unaccounted removal produces no decision rows and no reconcile summary at
    all. Verified by reading the ordering in both stages. The token therefore
    documents rounds that proceeded — it carries a zero on every round that
    passed and is simply absent on the path that aborted. A blocked round's
    evidence is the `spec.reconcile.invalid` or `plan.reconcile.invalid` audit
    event, whose message names the unclaimed removals, plus the retained raw
    response.
  - Change: do not add a pre-abort audit record to make the token appear on the
    failing path. That is new stage behaviour beyond this plan's scope, and the
    invalid event plus retained output already name the cause.
  - Verify: `node --test test/spec-stage.test.ts test/plan-stage.test.ts`
  - Expected: any test pinning the summary string is updated to the new shape
    and passes.

- **Step 4: add the stage-level regression in both stages.** A fixture whose
  reconciliation returns an `addressed` decision, changes the artifact so one
  acceptance criterion (spec) or one coverage line (plan) is gone, and claims
  nothing for it. Assert the stage aborts with the removal message and the run
  blocks rather than the round passing. Follow the fixture convention these
  files already use, where the executor fixture echoes the revised artifact, so
  the removal is expressed by the document the fixture returns rather than by
  editing a written file.
  - Verify: `node --test test/spec-stage.test.ts test/plan-stage.test.ts`
  - Expected: both new tests pass and name the deleted node in the refusal.

- **Step 5: prove each new abort by breaking it.** Remove `unclaimedRemovals`
  from the condition in one stage, confirm that stage's new test fails, restore,
  then repeat for the other stage.
  - Verify: `node --test test/spec-stage.test.ts` and
    `node --test test/plan-stage.test.ts` after each mutation and restore
  - Expected: each mutation makes exactly the new test fail. A mutation that
    changes nothing means the test is not reaching the branch, in which case fix
    the test rather than the assertion.

- **Step 6: give both shared emitters their second claim.** The replacement
  behaviour these stage tests exercise is defined in
  `test/fixtures/harness/emit-spec-stage.mjs` and
  `test/fixtures/harness/emit-plan-stage.mjs`, not in the test files: each
  emitter's `reconcile` function returns one `normativeChanges` entry for the
  added half of the revision it makes. Change each so a revising round emits
  exactly two entries — the added node and the superseded one, the second
  grounded with the same excerpt the first carries — and update the comment
  above each `reconcile` that currently explains why exactly one decision
  claims one node. Emit two claims, not a second decision: the round's other
  decisions still claim nothing.
  - Change: this is the stage-level positive test. An emitter that claims both
    halves and a suite that passes with it is the accepted path proved
    deterministically at stage level, which is why the fix belongs in the
    model-shaped payload rather than in an assertion.
  - Change: apply Task 2 Step 5's test to any remaining failure in the two test
    files, with the same stop condition — a failure while removing nothing
    means the accounting is over-claiming and is a blocking finding for the
    operator, not a fixture to edit.
  - Verify: `node --test test/spec-stage.test.ts test/plan-stage.test.ts`
  - Expected: both files green with two claims per replacement payload.

- **Step 7: run the full suite in an isolated copy that carries the
  uncommitted work.** The suite intermittently leaks empty `moved` commits and
  a stray `base.txt` onto the repository it runs in, root cause untraced. Do
  not run the pre-gate full suite in place and repair the damage afterwards —
  repairing the real repository's history is destructive and this plan does not
  authorize it. Instead copy the whole working directory, `.git` and
  `node_modules` included, to a path outside the repository, and run the suite
  there. A recursive copy is what carries the uncommitted feature work, which a
  `git worktree` or a fresh clone would not: both would check out committed
  state and silently test something other than what is being verified.
  Including `node_modules` keeps `npm run typecheck` working without a reinstall.
  - Change: creating and deleting a scratch copy outside the repository is
    non-destructive and needs no approval. Everything on the other side of that
    line does: if the copy shows a leaked commit or file, record the exact
    delta as evidence toward the untraced root cause and stop. Do not repair
    the copy, and do not touch the real repository's history or working tree
    without the operator's explicit authorization.
  - Verify: in the copy, `npm test`, then `git status --short` and
    `git log -1 --oneline` inside the copy; then the same two commands in the
    real repository
  - Expected: the copy's suite is green — record the counts against the
    pre-change baseline measured 2026-09-04, which was 695 tests, 694 passing,
    0 failing, and 1 environmental skip. In the real repository, only the files
    this plan edits are modified and HEAD is unmoved, which now holds by
    construction rather than by luck. Delete the copy afterwards.

**Task completion evidence:** Both stages abort by name on an unaccounted
removal, each abort was observed failing under a targeted mutation, both shared
emitters claim two halves per replacement, and the full suite is green in an
isolated copy with the real repository provably untouched.

### Task 4: the prompt states the removal obligation

**Depends on:** Task 3

**Files:**
- Modify: `src/prompts.ts` — `reconciliationDecisionContract`
- Validate: `test/prompts.test.ts`

**Steps:**

- **Step 1: state the obligation where it is requested.** The `addressed` block
  of the contract currently asks for one entry per node the revision adds or
  replaces. Change it to cover removal, and extend the paragraph that follows so
  the derived set is described honestly: the system derives both the added and
  the removed set itself, one entry claims one node in either direction, and a
  node that is missing, duplicated, in neither set, or ungrounded makes the
  decision `cannot_determine`. Keep the existing sentence saying the added half
  of a replacement counts as an added node, and add its sibling — that the
  superseded half counts as a removed node and needs its own entry, which may
  cite the same excerpt. Say plainly that deleting an obligation is not a way to
  answer a finding, and name the two routes that are: a grounded
  `rejected_with_rationale`, or an upstream disposition with a proposal
  candidate. This is hazard 3, since the author cannot satisfy a constraint the
  prompt does not state, and it is also the sentence that keeps the guard from
  reading as a trap.
  - Change: `artifactText` is documented as the added node's exact text; widen
    it to the exact text of the added or removed node.
  - Verify: `node --test test/prompts.test.ts`
  - Expected: any whole-file prompt scan that pins the old wording is updated
    and passes.

- **Step 2: assert the new constraint per prompt, not only in the scan.** Both
  reconciliation prompts render from the one `reconciliationDecisionContract`,
  so a single missing sentence would be invisible in a whole-file assertion. Add
  one assertion per prompt, spec reconciliation and plan reconciliation, that
  the rendered prompt contains the removal sentence, following the per-prompt
  convention this file already uses.
  - Verify: `node --test test/prompts.test.ts`
  - Expected: both assertions pass.

- **Step 3: prove them.** Delete the removal sentence from
  `reconciliationDecisionContract`, confirm both per-prompt assertions fail, and
  restore.
  - Verify: `node --test test/prompts.test.ts` after the mutation and the
    restore
  - Expected: two failures naming the two prompts, then green.

**Task completion evidence:** Both reconciliation prompts state the removal
obligation, and both statements are asserted per prompt and were observed
failing when the sentence was removed.

### Task 5: the binding documents assert what the code now does

**Depends on:** Task 4

**Files:**
- Modify: `ARCHITECTURE.md` — section 12, the `addressed` paragraph and the
  closing sentence of "What these checks do not establish"
- Modify: `docs/hazards.md` — entry 17
- Validate: `npm run check:docs`

**Steps:**

- **Step 1: amend the `addressed` paragraph of section 12.** It currently
  requires that every added node, including the added half of a replacement, be
  claimed exactly once by an `addressed` decision and carry an excerpt from the
  governing input. Extend it to removals in the same sentence structure: a node
  present before reconciliation and absent after must be claimed exactly once
  and grounded the same way, and an unclaimed, twice-claimed, or ungrounded
  removal is handled as `cannot_determine` and blocks. Keep the paragraph's
  closing note that this adds no round and no dispatch, which stays true because
  both directions come from artifacts the stage already holds.
  - Verify: `npm run check:docs`
  - Expected: clean. Section 12 is prose, so the checker proves only that cited
    paths resolve; the correctness of the amendment is the reviewer's judgement.

- **Step 2: replace the sentence that records the gap as open.** The closing
  sentence of "What these checks do not establish" says that stable criterion
  identity does not authorize removal, that the delta remains addition-only, and
  that hazard 17's gap is unchanged. That becomes false when Task 2 lands.
  Replace it with what is true afterwards — the delta accounts for removals, so
  a deleted obligation must be claimed and grounded like an addition — and state
  the residual honestly, because the grounding check proves textual occurrence
  only and still does not prove the cited words justify the deletion. Do not
  delete the paragraph's governing point: the section exists to say what the
  checks fail to establish, and the removal guard inherits exactly the limit the
  addition guard has.
  - Verify: `npm run check:docs`
  - Expected: clean.

- **Step 3: close entry 17 in `docs/hazards.md`.** The entry is `current` tier
  per `.claude/skills/doc-check/SKILL.md`, so it must assert the present state.
  Keep the mechanism description and the paragraph explaining that this was a
  code-path gap found by reading rather than a filed incident, because that
  record stays accurate and is why the entry exists. Replace the closing remedy
  paragraph's imperative with a statement of what now enforces it, naming
  `deriveRemovedNormativeNodes` and the claim accounting in
  `validateReconciliation`, and keep the sentence naming the honest routes for a
  wrong obligation, because that is now advice the prompt gives the author.
  - Verify: `npm run check:docs`
  - Expected: clean, and section 22's derived hazard count is unchanged because
    no heading was added or removed.

- **Step 4: confirm the checker still derives.** A section-12 edit that broke a
  heading or a fence would exit 2, which means the checker is stale rather than
  the document wrong.
  - Verify: `npm run check:docs` and `npm run typecheck`
  - Expected: exit 0 from both. Warnings from historical documents are expected
    and must not be chased to zero.

**Task completion evidence:** `ARCHITECTURE.md` section 12 and `docs/hazards.md`
entry 17 describe the implemented behaviour, `check:docs` is clean, and no
hazard heading was added or removed.

### Task 6: optional live evidence, and what it can and cannot settle

**Depends on:** Task 5

This task is supplementary. The verification claim is already carried by Task
2's recorded-response replay in both directions and by the deterministic stage
tests, so the plan can reach its gate without spending anything. What a live
run adds is the one thing no fixture can: a real author answering the revised
prompt. It cannot be aimed — the driver commits a fixed scratch design, so
whether a reconciliation rewords a normative node is the model's choice — which
is why an inconclusive result is accepted here rather than retried.

**Files:**
- Create: `docs/features/normative-removal-accounting/real-run-evidence.md`
- Validate: the retained scratch target's run store

**Steps:**

- **Step 1: run the free smoke, whether or not a paid run follows.** It reaches
  no reconciliation dispatch, so it proves only that nothing upstream of the
  change regressed, which is worth ten seconds either way. This step is not
  optional; the rest of the task is.
  - Verify: `node .claude/skills/run-buildworks/driver.mjs smoke`
  - Expected: twelve of twelve steps as expected.

- **Step 2: if the operator authorizes it, drive one paid chain.** State the
  expected cost before running it: comparable runs recorded in
  `.claude/sessions/project-learnings.md` cost between $0.25 and $0.85
  depending on remediation rounds. Do not start without an explicit
  authorization and a working `claude` session, and treat the authorization as
  covering one run — a second attempt is a second decision.
  - Verify: `node .claude/skills/run-buildworks/driver.mjs paid --yes`
  - Expected: all eight stages pass and the run completes, or the run blocks
    with its cause named. Both are results; Step 3 decides which.

- **Step 3: read what the reconciliation actually did, before cleaning
  anything.** Query the retained target's store rather than inferring from the
  exit code, and query before any `driver.mjs clean` — cleaning deletes the
  only record of the run, which is how a previous session lost the `stats`
  run's per-dispatch detail. Two different reads are needed depending on what
  happened. A round that proceeded has decision rows and a reconcile summary
  carrying `unclaimed=<n>; unclaimedRemoved=<n>`. A round that blocked on an
  unaccounted removal has neither: it aborted before decision insertion and
  before the summary was written, so its evidence is the
  `spec.reconcile.invalid` or `plan.reconcile.invalid` audit event, whose
  message names the unclaimed removals, plus the retained raw response.
  - Verify: `node .claude/skills/run-buildworks/driver.mjs report --dir` against
    the target path the driver printed, plus a direct read of that target's run
    database for either the round's decisions or the invalid audit event
  - Expected: one of the three outcomes below, identified by evidence rather
    than by impression.

- **Step 4: record the outcome under its own name.** Write the run's
  identifiers, cost, per-dispatch counts, whichever records exist per Step 3,
  and the retained target path into the evidence document with a
  `**Hazards considered:**` line. Name the outcome explicitly and do not round
  it up.
  - Change: if the run blocked on a removal the author should have been able to
    claim, that is the reword tax landing in production and it blocks
    completion of this plan. Record it as the trigger for reopening the
    narrower identity-aware rule described in this plan's Assumptions and bring
    it to the operator as a design decision. Do not soften the guard, relax the
    prompt, or edit a fixture to make the run pass.
  - Verify: `npm run check:docs`
  - Expected: clean. The new document is historical tier, so path findings in
    it are warnings.

**Task completion evidence:** One of four recorded outcomes. Three of them
complete this task; one blocks the plan.

1. **No paid run.** The operator did not authorize one. The task is complete at
   Step 1, and the plan's verification claim stands on Task 2's replay and the
   deterministic stage tests. Say exactly that, and claim nothing about how a
   live provider behaves.
2. **Accepted two-sided replacement.** A completed run whose reconciliation
   reworded a normative node and claimed both halves, with
   `unclaimedRemoved=0` in the reconcile summary. This is the strongest
   available evidence: the revised prompt produced the behaviour it asks for
   against a real provider. Record the decision payload, not just the counts.
3. **No replacement.** A completed run whose reconciliation added nodes without
   removing any. Inconclusive — it exercised nothing this plan changed, so it
   neither strengthens nor weakens the claim. Record it as inconclusive and do
   not repeat the run to fish for outcome 2; an identical dispatch rerun for a
   different answer is hazard 7, and a second run is the operator's decision.
4. **False refusal — this one blocks.** A run that blocked on a removal the
   author should have been able to claim. The guard refused a legitimate
   revision, which is the reword tax the Assumptions section names as the
   trigger for reopening the narrower identity-aware rule. Completion of this
   plan stops here pending the operator's design decision.

Do not report outcome 1 or 3 as outcome 2, and do not adjust a fixture, a
prompt, or the accounting to manufacture outcome 2 after the fact. Live-provider
compliance is claimed only under outcome 2, and only for what the run actually
did.

## Gate

This plan is complete when `deriveRemovedNormativeNodes` and the two-direction
claim accounting are in `src/reconciliation.ts`; the retained real
reconciliation response replays through the validator in both directions, its
one-claim form reporting the superseded node as an unclaimed removal and its
two-claim form validating cleanly; both stages abort by name on an unaccounted
removal and carry `unclaimedRemoved` into the reconcile summary of every round
that proceeds; both shared harness emitters claim two halves per replacement;
both reconciliation prompts state the obligation with per-prompt assertions;
section 12 and hazard 17 assert the implemented behaviour; `npm test`,
`npm run typecheck`, `npm run check:docs` and the free smoke all pass, with the
full suite run in an isolated copy and the real repository provably untouched;
every new guard has been observed failing under a targeted mutation and
restored; and Task 6 has recorded outcome 1, 2, or 3 under its own name.

Outcome 4 — a live run that falsely refused a legitimate replacement — blocks
this gate. It is a design decision for the operator, not a defect to work
around, and no fixture, prompt, or accounting change may be made to clear it
without that decision.
