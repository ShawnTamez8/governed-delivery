# Code Review Remediation Implementation Plan

**Status:** Implemented — Tasks 1-10 complete

**Goal:** Make `code_review` repair actionable code findings inside a bounded,
configurable loop and hand delivery the final policy-clean, verified commit,
without changing `spec_review` or `plan_review`.

**Source:** The operator decisions in this conversation, captured as
`.Codex/sessions/2026-09-06-requirements-code-review-remediation.md`; the two
correct live blocks recorded in
`docs/features/code-review-stage/real-run-evidence.md`; `ARCHITECTURE.md`
sections 3, 4, 6-13, 15, and 18-23; and `docs/hazards.md` entries 1-4, 7,
11-12, 14-16, and 18.

**Hazards considered:** 18 is the gap being extended: code has now been read,
but two correct findings ended otherwise healthy runs because no repair path
exists. 7 requires every repeated panel to receive a materially changed commit
and diff; a remediation that produces no committed change blocks instead of
buying an identical retry. 3 governs the specialized reviewer prompts and the
remediation prompt: the actionable-only boundary, the code-only
classification, the severity meanings, the location form, and the patch base
must be stated where requested. 4 and hard rule 5 require recorded reviewer
responses to keep feeding contract tests and require one
post-change live response before the prompt half is called proven. 11 requires
the default two-seat panel to remain staffable and any configured two-to-five
seat panel to fail at profile freeze when the registry cannot supply distinct
specialists. 12 requires panel size, panel-round budget, and blocking severity
to be visible policy frozen at run start. 14 requires every reviewer and
remediator to remain a separately dispatched `configured_standalone` process,
without claiming independence. 15 requires clean-head and clean-tree checks
after every read-only subprocess, with patch writes performed only by the
system. 16 is deliberately closed out of this stage: code reviewers may report
only defects correctable in current code, so no upstream proposal, spike,
waiver, or wrong-artifact loop is created. 1 and 2 remain inherited from
`extractJsonBody`, `dispatchOnce`, and bounded evidence retention. 5 protects
the final delivery range after remediation. 6, 8-10, 13, and 17 were weighed
and do not govern this change: it adds no later-stage promise, executable or
hook, model alias comparison, specification obligation, or document
reconciliation.

**Assumptions:** The current `high` blocking threshold remains the initial
default, so a final `low` or `medium` finding is retained but non-blocking. The
new `CODE_REVIEW_MAX_ROUNDS` default is two and may be set from one through
five; it counts every complete panel execution, with no hidden closure panel.
Setting it to one deliberately selects one-shot review, so a finding is judged
by the final threshold and no unreviewed remediation patch is applied. The
existing `implementer` is the remediation author. A
verification command failure after a remediation patch blocks this feature's
run; general verification remediation remains deferred. Code-review reviewers
are selected from the frozen registry in deterministic id order up to the
configured size. These are reversible policy and selection choices, not new
persisted compatibility modes.

**Approach:** Keep the stage sequence unchanged and replace the internals of
the single `code_review` stage with `review -> remediate -> verify -> review`.
Extract the implementation stage's already-proven patch application and the
verification stage's already-proven commit verification into concrete helpers
only when this second real consumer exists. Add reviewer-specific instructions
to the two code-review agent definitions, a size-bounded code-review selector,
and two new frozen policy fields. Store every panel execution and remediation
inside one current code-review record shape. The final gate remains a pure
severity-policy decision, so changing one policy constant changes the next
run's blocking behavior without changing orchestration. No generic stage
adapter is introduced; a later QA stage can be its own module and compose the
same concrete patch and verification helpers.

**Affected areas:** Create `src/code-review.ts`,
`src/patch-application.ts`, and `src/commit-verification.ts` with focused tests.
Modify `src/policy.ts`, `src/profile.ts`, `src/agents.ts`, the two files under
`src/agents/code-reviewer-*.ts`, `src/select.ts`, the code-review portion of
`src/prompts.ts`, `src/implementation-stage.ts`, `src/verification-stage.ts`,
`src/code-review-stage.ts`, `src/paths.ts`, `src/delivery-stage.ts`, and
`src/cli.ts`. Modify the corresponding tests and
`test/fixtures/harness/emit-code-review.mjs`. Deliberately do not modify
`src/spec-stage.ts`, `src/plan-stage.ts`, their prompt builders, their agent
definitions, or their reconciliation and upstream-proposal behavior. Update
the current claims in `ARCHITECTURE.md`, `docs/hazards.md`, `README.md`,
`CLAUDE.md`, `AGENTS.md`, and the run-buildworks skill/driver documentation;
do not rewrite historical plans or review records.

**Known blockers:** The live contract checks spent money and required separate
operator authorization; both retained targets must remain until their
load-bearing responses are committed. Existing
profiles lack the new policy fields and become non-executable under hard rule
3, while their records remain readable; implementation must inspect for an
active run before changing the current policy shape. The session record reports
that `npm test` can leak a commit or `base.txt` into the working repository and
has two intermittent Windows failures, so the full suite runs in a disposable
mirror; focused suites remain safe in the working tree.

**Blast radius:** `buildPolicy`, `invalidPolicyReason`, and `Policy` flow into
`freezeProfile`, `invalidProfileReason`, every stage's verified-profile load,
and the policy/profile tests. The existing generic `panelSizeMin` and
`panelSizeMax` are consumed by spec and plan review and therefore remain
unchanged; the new code-review size is a separate field. `codeReviewPanel` and
`codeReviewStaffingShortfall` are called by `freezeProfile`,
`runCodeReviewStage`, and `test/select.test.ts`. `buildCodeReviewPrompt` is
called only by `runCodeReviewStage` and prompt tests. `CodeReviewRecord` is
written by `runCodeReviewStage` and imported by `runDeliveryStage`, making that
handoff a persisted integration boundary. Patch validation and application are
currently embedded only in `runImplementationStage`; commit verification is
currently embedded only in `runVerificationStage`. Extracting each changes its
existing caller before adding the second caller, so the existing implementation
and verification suites are mandatory regression gates. `review` remains one
CLI command and one stage row, so no migration or stage-sequence pin changes.

**Verification:** `npm run typecheck`; focused agent, policy, profile, selector,
prompt, patch-application, implementation, commit-verification, verification,
code-review, delivery, CLI, audit, and recorded-response tests; `npm test` in a
disposable mirror; `npm run check:docs`; and the unpaid run-buildworks smoke.
Every new deterministic guard is proved by breaking it in the disposable
mirror and restoring it byte-identically. Separately authorized paid evidence
records whether live reviewers obey the specialized actionable-only prompts; a
clean first panel can complete without exercising a remediation attempt.

---

## Tasks

### Task 1: Amend the binding design for code-review remediation only

**Depends on:** None

**Files:**

- Modify: `ARCHITECTURE.md` — sections 9, 12-13, 15, and 20
- Modify: `CLAUDE.md` and `AGENTS.md` — the recorded post-step-9 authorization
- Validate: `scripts/doc-check.mjs`

**Steps:**

- **Step 1: record the operator decision and its limits.** Amend only the
  `code_review` design: a configured panel of two through five specialized
  reviewers, a one-through-five total panel-round budget, a post-patch verification
  and full-panel review, and a final severity-policy gate. State that
  `spec_review` and `plan_review` retain their existing author-requested panels,
  reconciliation schemas, upstream routes, and no-closure-pass behavior.
  - Verify: `npm run check:docs`
  - Expected: exit 0; the pinned stage sequence and five deferred stages are
    unchanged.
- **Step 2: define policy-clean precisely.** State that all findings from a
  panel are sent to remediation while another round remains, but the final panel
  blocks only at or above `codeReviewBlockingSeverity`; below-threshold
  findings remain attributable evidence. State that changing the threshold,
  size, or budget affects only profiles frozen after the change.
  - Verify: search `ARCHITECTURE.md` for the three rules and confirm no sentence
    claims that a passed review has zero findings.
  - Expected: the design supports a low-only final panel without a code change.
- **Step 3: remove the code-review-only upstream route.** Replace the existing
  code-review proposal/spike/human wording with the actionable-current-code
  contract. Preserve section 13's upstream handling for `spec_review` and
  `plan_review` verbatim.
  - Verify: `rg -n "upstream|proposal|waiver|spike" ARCHITECTURE.md`
  - Expected: the terms remain for the two document reviews and deferred
    operator behavior, but no code-review finding creates one.
- **Step 4: update both instruction copies together.** Record the 2026-09-06
  authorization for code-review remediation and say explicitly that it grants
  no other deferred stage or behavior. Keep `CLAUDE.md` and `AGENTS.md`
  byte-identical.
  - Verify: `git diff --no-index -- CLAUDE.md AGENTS.md` and
    `npm run check:docs`
  - Expected: the comparison exits 0 and documentation checking is clean.

**Task completion evidence:** The binding sources authorize exactly this loop,
preserve both document-review implementations, and define the final gate before
code changes begin.

### Task 2: Freeze panel size, panel-round budget, and specialized reviewers

**Depends on:** Task 1

**Files:**

- Modify: `src/policy.ts` — `Policy`, `buildPolicy`, and
  `invalidPolicyReason`
- Modify: `src/profile.ts` — code-review staffing preflight
- Modify: `src/agents.ts` — `AgentDefinition`
- Modify: `src/agents/code-reviewer-correctness.ts`
- Modify: `src/agents/code-reviewer-security.ts`
- Modify: `src/select.ts` — `codeReviewPanel` and
  `codeReviewStaffingShortfall`
- Validate: `test/policy.test.ts`, `test/profile.test.ts`,
  `test/agents.test.ts`, and `test/select.test.ts`

**Steps:**

- **Step 1: add independent code-review policy fields.** Add
  `CODE_REVIEW_PANEL_SIZE` with default 2 and permitted bounds 2-5, plus
  `CODE_REVIEW_MAX_ROUNDS` with default 2 and permitted bounds 1-5.
  Freeze both in `Policy`; do not reuse or alter `SPEC_REVIEW_ROUNDS`,
  `PLAN_REVIEW_ROUNDS`, `panelSizeMin`, `panelSizeMax`, or
  `requiredSpecialties`. Keep `CODE_REVIEW_BLOCKING_SEVERITY = "high"` as the
  one-line future release-policy adjustment.
  - Verify: `node --test test/policy.test.ts test/profile.test.ts`
  - Expected: valid boundary values pass; 1/6 reviewers and 0/6 panel
    rounds refuse by field name; a threshold absent from the frozen severity
    order still refuses.
- **Step 2: make specialty instructions part of the protected definition.** Add
  one optional `codeReviewInstructions` string to `AgentDefinition`. Require it
  to be non-empty exactly when an agent emits `code-findings`, and forbid it on
  every other agent. Give correctness concrete instructions for behavioral,
  state-transition, error-path, and acceptance-criterion defects; give security
  concrete instructions for trust-boundary, injection, authorization, secret,
  unsafe-input, and data-integrity defects. Do not modify any spec/plan agent
  file.
  - Verify: `node --test test/agents.test.ts`
  - Expected: both seeded code reviewers carry distinct lenses and non-empty
    instructions; authors and document reviewers carry no code-review
    instructions.
- **Step 3: select exactly the configured number.** Change `codeReviewPanel` to
  sort eligible frozen agents by id and take exactly the frozen size. Change
  `codeReviewStaffingShortfall` to validate the size bounds, unique ids,
  distinct specialties, instructions, executor binding, and sufficient seats
  before returning that panel. Keep `selectReviewers` and `staffingShortfall`
  unchanged.
  - Verify: `node --test test/select.test.ts test/profile.test.ts`
  - Expected: the seed seats correctness and security at size 2; test-only
    third-through-fifth specialists seat deterministically; an unstaffable or
    duplicate-lens panel fails during profile freeze before an agent run.
- **Step 4: prove frozen values, not live constants, govern.** Refreeze test
  profiles at legal non-default values and assert the stage selector receives
  those values. Assert a profile missing either new field is refused as a
  superseded shape rather than defaulted.
  - Verify: `node --test test/policy.test.ts test/profile.test.ts`
  - Expected: a run cannot change panel or remediation behavior after intake.

**Task completion evidence:** One small policy block controls the three
independent decisions—panel size, total panel rounds, and blocking
severity—and every selected reviewer carries an enforced specialized prompt.

### Task 3: Define the code-review-only prompt and record contracts

**Depends on:** Task 2

**Files:**

- Create: `src/code-review.ts`
- Modify: `src/prompts.ts` — `buildCodeReviewPrompt` and a new
  `buildCodeReviewRemediationPrompt`
- Create: `test/code-review.test.ts`
- Modify: `test/prompts.test.ts`
- Validate: the recorded files under `test/fixtures/recorded/` whose
  names begin `code-review-web-calculator-`

**Steps:**

- **Step 1: separate domain records from orchestration.** Move the existing
  code-review record, finding, block, and pure gate types/functions out of
  `src/code-review-stage.ts` into `src/code-review.ts`. Replace the single-round
  record with one current shape containing `initialVerifiedCommit`,
  `finalVerifiedCommit`, `patchBase`, `panel`, `panelSize`,
  `maxRounds`, `blockingSeverity`, `severities`, and ordered `rounds`.
  Each round records its number, reviewed commit, full changed-path set,
  findings, blocking set, and either a remediation record or `null`. A
  remediation record names its author, base commit, resulting commit, changed
  paths, and retained verification result. The top-level `blocking` is the
  final panel's threshold-reaching set only.
  - Verify: `npm run typecheck`
  - Expected: delivery can import the handoff type from the domain module
    without importing the stage orchestrator.
- **Step 2: encode the round decision as a pure function.** Given the current
  findings, frozen severity order and threshold, and whether another panel
  round remains, return exactly one action: `pass` for an empty panel;
  `remediate` for any finding while budget remains; on the final panel, `pass`
  when every finding is below threshold or `block` with the threshold-reaching
  findings. Classification is not part of this decision because this stage
  admits only `current_artifact`.
  - Verify: `node --test test/code-review.test.ts`
  - Expected: low-only final findings pass under `high`; high and critical
    final findings block; every severity triggers remediation before the final
    panel; frozen severity order controls comparison.
- **Step 3: make each reviewer prompt truly specialized and actionable-only.**
  Interpolate the selected definition's `codeReviewInstructions`; define `low`
  as a small but concrete defect rather than the existing “nit or style
  concern”; require a reproducible impact and a changed-path location; and
  explicitly exclude style, preference, optional refactoring, speculative
  hardening, questions, and any concern that requires changing the approved
  spec or plan. Permit only `classification: current_artifact` and keep the
  existing constrained `intentKey` and location forms.
  - Verify: `node --test test/prompts.test.ts`
  - Expected: correctness and security prompts contain different focus text
    and the same actionable-only contract; generated spec-review and
    plan-review prompt assertions remain byte-for-byte unchanged.
- **Step 4: define one remediation patch request, not a reconciliation.** Add a
  prompt for the frozen `implementer` containing the approved spec and plan,
  signed scope, current head, current complete diff, and every attributable
  finding from that panel. Require one or more `proposedPatches` bound to the
  current head and tell the author to fix the code, not return dispositions,
  proposals, waivers, questions, or edits to governing documents.
  - Verify: `node --test test/prompts.test.ts`
  - Expected: the prompt contains every finding id, report, severity, location,
    and subject; its advertised object validates through `validateAgentResult`.
- **Step 5: retain the real-response contract.** Replay the existing provider
  responses through extraction, result validation, code-review location
  validation, and the moved pure gate. Update only the expected current schema,
  not the recorded bytes.
  - Verify: `node --test test/code-review.test.ts test/code-review-stage.test.ts`
  - Expected: all recorded responses still parse and produce their recorded
    findings and severities.

**Task completion evidence:** Review policy is testable without a stage or
store, prompts define each real specialist, deterministic validation excludes
upstream output, and semantic compliance with the actionable-only instruction
is explicitly left for live evidence rather than claimed from schema.

### Task 4: Extract one safe patch-application module for two real callers

**Depends on:** Task 3

**Files:**

- Create: `src/patch-application.ts`
- Modify: `src/implementation-stage.ts`
- Create: `test/patch-application.test.ts`
- Validate: `test/implementation-stage.test.ts` and
  `test/implementation-gate.test.ts`

**Steps:**

- **Step 1: move the existing guard sequence without weakening it.** Extract a
  concrete `applyProposedPatches` operation that accepts the worktree, run id,
  slug, signed scope, proposal base, patches, commit message, and audit callback.
  Preserve, in order, scope/protected-path checks, exact base binding,
  head-movement comparison, link-component refusal, resolved-target checks,
  add/modify existence semantics, literal `git add`, staged-set equality,
  system-authored commit, committed-set equality, and final clean-tree check.
  Return the resulting commit and changed paths or a named refusal; never
  mutate run/stage status inside the helper.
  - Verify: `node --test test/patch-application.test.ts test/implementation-stage.test.ts test/implementation-gate.test.ts`
  - Expected: initial implementation produces the same commit messages,
    handoff, audit summaries, and refusal text as before.
- **Step 2: make the implementation stage the first caller.** Replace its
  embedded apply loop with the helper and keep worktree creation, projections,
  author dispatch, parse validation, and stage transitions in
  `runImplementationStage`.
  - Verify: `node --test test/implementation-stage.test.ts`
  - Expected: every existing success and rejection path remains green.
- **Step 3: prove the shared boundary by breaking it.** In a disposable mirror,
  remove one representative guard from the helper for each layer—scope,
  base/head, link path, staged set, and committed set—and confirm the existing
  or new focused test fails before restoring the exact bytes.
  - Verify: pre/post SHA-256 for `src/patch-application.ts` and the focused
    suites above
  - Expected: each mutation is detected and the restored hash is identical.

**Task completion evidence:** Initial implementation and later code-review
remediation can apply patches through one concrete, already-proven guard path;
no stage adapter or plugin interface exists.

### Task 5: Extract commit verification for the initial and remediated commits

**Depends on:** Task 4

**Files:**

- Create: `src/commit-verification.ts`
- Modify: `src/verification-stage.ts`
- Modify: `src/paths.ts`
- Create: `test/commit-verification.test.ts`
- Validate: `test/verification-stage.test.ts` and
  `test/verify-command.test.ts`

**Steps:**

- **Step 1: extract a stage-neutral commit verifier.** Move the frozen command
  loop and its head/cleanliness checks into `verifyCommit`. Inputs are the
  expected commit, worktree, frozen verification commands and limits, an
  explicit evidence directory, and an audit/progress callback. Return one
  structured record with every command and either pass or the first named
  failure. Do not create/complete stages or change run status in the helper.
  - Verify: `node --test test/commit-verification.test.ts test/verify-command.test.ts`
  - Expected: nonzero exit, spawn failure, timeout, output overflow, moved
    head, dirty tree, and success retain the same evidence and reasons.
- **Step 2: keep `verification` behavior unchanged.** Make
  `runVerificationStage` call the helper and translate its result into the
  existing verification handoff, report, stage transition, and audit actions.
  Do not add retries or alter the verification-stage record schema.
  - Verify: `node --test test/verification-stage.test.ts`
  - Expected: every existing test passes without expectation changes except
    imports made necessary by the extraction.
- **Step 3: give code-review attempts collision-free evidence paths.** Add path
  helpers beneath `.governance/code-review/<run>/round-<n>/verification/` so a
  later attempt never overwrites initial verification or an earlier attempt.
  - Verify: `node --test test/paths.test.ts test/commit-verification.test.ts`
  - Expected: all returned paths remain relative to the repository where the
    record requires a reference, and each round is distinct.

**Task completion evidence:** The same deterministic command and worktree
checks govern the initial implementation and every review-authored patch, with
separate retained evidence.

### Task 6: Implement the bounded remediation loop inside `code_review`

**Depends on:** Tasks 2-5

**Files:**

- Modify: `src/code-review-stage.ts` — `runCodeReviewStage`
- Modify: `test/fixtures/harness/emit-code-review.mjs`
- Modify: `test/code-review-stage.test.ts`
- Validate: `src/store.ts` and migrations 003/005 as unchanged storage
  contracts

**Steps:**

- **Step 1: run the frozen panel against the current verified commit.** Keep
  the current preconditions, hash checks, read-only dispatch, raw retention,
  clean-tree checks, location checks, and one stage row. For each panel
  execution, recompute changed paths and the complete diff from the original
  `patchBase` through the current verified commit, dispatch exactly the frozen
  panel, and persist findings with that panel number in the existing `finding`
  and `finding_report` tables.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: same-round duplicates merge; later-round findings retain separate
    identities; every report remains attributable to its agent run.
- **Step 2: reject outputs this stage cannot act on.** After the shared report
  validator, require `classification === "current_artifact"`. Remove the
  code-review proposal construction, `blocking_dependency` evidence, and
  proposal fields from the code-review record. Do not change proposal behavior
  in either document-review stage.
  - Verify: a fixture mode returning `upstream` blocks as invalid reviewer
    output and `SELECT COUNT(*) FROM proposal` remains zero; run the spec- and
    plan-stage suites unchanged.
  - Expected: no human review, proposal, spike, waiver, or finding-decision row
    is produced by `code_review`.
- **Step 3: remediate all findings together while budget remains.** Dispatch
  the frozen `implementer` once for the panel's complete findings, assert the
  read-only boundary, validate non-empty patches, apply them through
  `applyProposedPatches`, and run `verifyCommit` on the resulting head. Append
  the remediation and verification record to that panel round before the next
  panel begins.
  - Verify: fixture mode `high-then-clean` produces one remediation commit,
    passes frozen verification, then runs both reviewers again on that commit.
  - Expected: with the default two-round configuration the code-review stage passes in
    five agent runs—two initial reviewers, one implementer, and two final
    reviewers—and the final reviewed commit equals worktree `HEAD`.
- **Step 4: enforce the final threshold without an unreviewed patch.** On the
  configured final panel round, do not dispatch another
  author. Apply the pure final gate to the last panel: pass with empty or only
  below-threshold findings; block on threshold-reaching findings. Retain all
  earlier rounds and name only final blocking findings in the terminal reason.
  - Verify: fixture modes for final-low, repeated-high, and high-then-clean
  - Expected: final-low passes under frozen `high`; repeated-high blocks after
    exactly one remediation in the default two rounds; a frozen one-round
    profile performs no remediation; no patch exists after the final panel.
- **Step 5: fail closed on remediation machinery.** Cover invalid/empty patch,
  wrong base, outside-scope/protected path, dirty subprocess tree, failed
  verification, moved head, evidence-write error, and unexpected throw. Each
  completes `code_review` as blocked, blocks the run, retains available
  evidence, and leaves the worktree for diagnosis.
  - Verify: `node --test test/code-review-stage.test.ts`
  - Expected: no failure leaves an in-progress code-review stage or silently
    starts another panel.
- **Step 6: make progress and cost visible.** Print round, reviewer specialty,
  finding count, remediation commit, and verification result to stderr; include
  round and commit identities in audit actions. Keep stdout as the final result
  reference.
  - Verify: CLI integration assertions and `verifyAuditChain`
  - Expected: the operator can tell which frozen panel and budget are in force
    without opening the profile.

**Task completion evidence:** A single code-review stage can converge on a
reviewed, verified commit, or stop at the configured budget with every paid
dispatch and deterministic decision retained.

### Task 7: Bind delivery to the final remediated review handoff

**Depends on:** Task 6

**Files:**

- Modify: `src/delivery-stage.ts` — code-review record parsing and range checks
- Modify: `test/delivery-stage.test.ts`

**Steps:**

- **Step 1: validate the new record as one current schema.** Require a passed
  record with a non-empty ordered round list, no final blocking findings, the
  frozen panel and policy values, and a last round whose `reviewedCommit`
  equals `finalVerifiedCommit`. Do not add a compatibility branch for the
  single-round record.
  - Verify: `node --test test/delivery-stage.test.ts`
  - Expected: missing fields, reordered/duplicated rounds, a blocking final
    panel, or mismatched final commit refuse before a delivery stage row.
- **Step 2: cross-check the initial and final boundaries separately.** Require
  the original verification record to match `worktreePath`, `patchBase`, and
  `initialVerifiedCommit`. Require every remediation to start at its round's
  reviewed commit, end at the next round's reviewed commit, and carry passing
  verification. Require the worktree head to equal `finalVerifiedCommit`, then
  compute delivery coverage over `patchBase..finalVerifiedCommit`.
  - Verify: valid zero-remediation and one-remediation records pass; tampering
    each commit link or verification outcome fails by name.
  - Expected: delivery never certifies bytes that were patched after the last
    review or were not verified.
- **Step 3: retain the two audit prerequisites.** Continue requiring the
  original `verification.gate.pass` and the final `code_review.gate.pass`.
  Include final round and commit in the latter summary so a passed stage row
  without the actual final verdict cannot complete.
  - Verify: audit-event omission tests and `verifyAuditChain`
  - Expected: either missing event refuses delivery with no state mutation.

**Task completion evidence:** `delivery_check` certifies the complete original
plus remediation range and can prove the delivered head is both verified and
the subject of the final policy gate.

### Task 8: Align operator surfaces and current documentation

**Depends on:** Tasks 1-7

**Files:**

- Modify: `src/cli.ts` — `review` usage and progress expectations
- Modify: `README.md`
- Modify: `docs/hazards.md` — entry 18 only
- Modify: `.claude/skills/run-buildworks/SKILL.md`
- Modify: `.claude/skills/run-buildworks/driver.mjs` only where its review
  expectations or reporting assume one panel
- Validate: `scripts/doc-check.mjs`

**Steps:**

- **Step 1: document the three policy knobs together.** Name the defaults and
  legal ranges for panel size and total panel rounds, and name
  `CODE_REVIEW_BLOCKING_SEVERITY` as the release-policy switch. Explain that
  final below-threshold findings are retained and non-blocking, and that policy
  changes affect only new runs.
  - Verify: `npm run check:docs`
  - Expected: no current document claims that one finding always blocks, that
    every registered code reviewer always runs, or that a fresh run is the only
    repair.
- **Step 2: update hazard 18 from observed gap to shipped mitigation.** Preserve
  the two paid blocks as evidence, then describe the bounded remediation,
  re-verification, final panel, and residual threshold behavior. Do not add a
  speculative hazard entry for reviewer persistence; hazards record observed
  failures, not predictions.
  - Verify: `npm run check:docs`
  - Expected: the historical evidence remains intact and the current mitigation
    matches source.
- **Step 3: keep the CLI surface single.** `bw review` continues to invoke one
  core operation; update help and progress text for multiple rounds. Do not add
  a resume, reconcile, waive, QA, or reviewer-management command.
  - Verify: `node --test test/cli.test.ts`
  - Expected: one `review` invocation either passes with a result reference or
    exits nonzero with a retained terminal block.
- **Step 4: keep the free and paid driver modes honest.** Preserve `smoke` as
  the existing dispatch-free 13-step refusal/configuration check. Extend paid
  result reporting to show panel executions, remediation attempts, final
  commit, and final gate without changing the stage sequence; the deterministic
  `high-then-clean` stage test, not the driver smoke, is the free end-to-end
  remediation exercise.
  - Verify: `node .claude/skills/run-buildworks/driver.mjs smoke` and the
    `high-then-clean` case in `test/code-review-stage.test.ts`
  - Expected: smoke remains 13/13 without a dispatch, while the fixture-backed
    stage test completes two panels and one remediation without spending.

**Task completion evidence:** Current docs and the only CLI/driver surface
describe and exercise the behavior the core now implements.

### Task 9: Run the deterministic completion gate and break the new guards

**Depends on:** Tasks 1-8

**Files:**

- Validate: all modified source, tests, and documentation
- Create only if needed: a disposable mirror outside the working repository

**Steps:**

- **Step 1: run focused validation.** Run typecheck, documentation checking,
  and the focused suites named in the header.
  - Verify: `npm run typecheck`; `npm run check:docs`; then `node --test` with
    the affected test files
  - Expected: exit 0 and no existing assertion weakened to accommodate the new
    behavior.
- **Step 2: prove the policy boundaries by mutation.** In the disposable
  mirror, make the final comparison ignore the threshold, bypass the remediation
  limit, select one fewer reviewer, and skip the post-patch verification in
  separate mutations. Each mutation must fail the specifically named test;
  restore and confirm byte-identical hashes.
  - Verify: focused policy, selector, stage, and delivery suites
  - Expected: each guard has demonstrated reachability.
- **Step 3: run the full repository gates safely.** Mirror the repository with
  `.git`, run `npm test`, then run the unpaid smoke. Do not run the full suite
  in the operator's working tree while the recorded leak remains unresolved.
  - Verify: `npm test` in the mirror and
    `node .claude/skills/run-buildworks/driver.mjs smoke`
  - Expected: zero test failures (apart from a separately identified existing
    environmental skip/flake that passes its isolated retry), unchanged main
    worktree/HEAD, valid audit chain, and completed smoke run.
- **Step 4: confirm the exclusion boundary.** Review the diff paths and run the
  full spec-stage and plan-stage suites. Assert that their stage modules,
  agent-definition files, prompt sections, reconciliation, and upstream routes
  have no diff.
  - Verify: `git diff --name-only` plus the two focused suites
  - Expected: no behavioral change to either document-review stage.

**Task completion evidence:** The feature passes focused, full, documentation,
audit, and smoke checks; every new decision guard has failed under mutation and
been restored exactly.

### Task 10: Capture one authorized live remediation chain

**Depends on:** Task 9. Requires explicit operator authorization for one paid
run; do not infer it from approval of this plan or its implementation.

**First outcome on 2026-09-07:** attempted once under explicit authorization. The
chain blocked at `implementation.content.invalid` after 11 dispatches and
$1.00548 because the implementer returned two non-JSON `\U0001f319` escapes.
No code-review panel ran. See `real-run-evidence.md`.

**Post-run correction on 2026-09-07:** BuildWorks now spawns the measured
native `claude.exe` directly, matching PowerShell resolution without a command
shell, and both code-patch author prompts explicitly require JSON-standard
Unicode escaping. The retained response still fails the unchanged strict
parser, as it must.

**Fresh authorized outcome on 2026-09-07:** one separately authorized chain
completed after 13 dispatches costing $1.39473. Implementation returned valid
JSON, verification passed, correctness and security each returned a valid
empty report on panel round 1, the final code-review gate passed with no
remediation needed, all four signed artifacts were delivered at
`b0b1104dc0b045dbc3d8c116ba44e9ed894200e4`, and the audit chain verified.
The two reviewer responses are committed as recorded fixtures. Task 10 is
complete; live remediation remains explicitly unproven because the panel was
clean.

**Files:**

- Create: `docs/features/code-review-remediation/real-run-evidence.md`
- Create: `test/fixtures/recorded/` — only responses that become load-bearing

**Steps:**

- **Step 1: state the cost envelope before starting.** Derive the expected
  maximum dispatch count from the frozen panel size and total round budget,
  and use the two recorded code-review panel costs as historical evidence—not
  a guarantee. Ask for authorization, then run the exact paid command from the
  run-buildworks skill once.
  - Verify: driver output and the scratch target's profile
  - Expected: the run uses the default two specialists and no more than the
    default two panel rounds and one intervening remediation; there is no
    unapproved retry.
- **Step 2: record the outcome under its actual name.** Whether the run passes,
  blocks on a final finding, fails remediation verification, or stops earlier,
  record every dispatch, cost, model, round, finding, commit, and gate, plus
  what the sample establishes and does not establish.
  - Verify: `npm run check:docs`
  - Expected: no percentage or convergence claim is inferred from one sample.
- **Step 3: preserve load-bearing provider output immediately.** Before any
  cleanup, copy every response used by a test or conclusion into
  `test/fixtures/recorded/` with run id, dispatch time, capture date, frozen
  policy, round/commit context, and dropped envelope fields. Replay it through
  the production extractor, validators, and pure gate.
  - Verify: recorded-response tests and `npm run check:docs`
  - Expected: nothing machine-local is required to reproduce the conclusion.

**Task completion evidence:** One authorized fresh chain reached the
specialized panel and recorded its actual terminal decision, cost, and provider
contract evidence without retrying an unchanged run. Its clean first panel
needed no remediation, so convergence after a live patch remains unclaimed.

## Implementation status

Tasks 1-9 completed on 2026-09-07. The bounded `code_review` loop, frozen
reviewer and round controls, specialized prompts, shared patch and exact-commit
verification modules, final delivery handoff, CLI, driver, and documentation
are implemented. The final disposable-mirror suite passes 822 tests with zero
failures and one existing Windows symlink skip; the free BuildWorks smoke
passes 13/13. Focused break tests caught the threshold, round cap, panel size,
and post-patch verification guards, and an independent code review's three
findings are reconciled in `2026-09-07-code-review.md`. No `spec_review` or
`plan_review` behavior changed.

Task 10 completed on a separately authorized fresh chain after the first
authorized attempt exposed the launcher and JSON-output regressions. The fresh
chain reached both specialized reviewers, passed its clean first panel,
delivered all signed artifacts, and verified the audit chain.
`real-run-evidence.md` records both outcomes and their limits. Because the live
panel returned no findings, it proves the final pass path but not live
remediation, post-patch verification, or a second panel; deterministic tests
remain the evidence for those branches.

## Gate

Tasks 1-9 must be complete before implementation can be reported locally
complete: typecheck and documentation checks exit 0; focused and full suites
pass in the prescribed environments; the dispatch-free smoke remains 13/13 and
the fixture-backed integration reaches a passed final review after one retained
remediation; every new deterministic guard has been break-tested
and restored byte-identically; delivery is bound to the final reviewed and
verified commit; and the diff contains no `spec_review` or `plan_review`
behavior change. Those conditions are satisfied, so the plan is `Implemented`.
Task 10's separately authorized contract-evidence gate is satisfied: the fresh
chain reached and passed the specialized panel, completed delivery, and
retained both provider responses. Its clean panel means no claim is made that a
live remediation dispatch converges.
