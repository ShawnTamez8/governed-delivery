# Normative Removal Accounting Implementation Plan — plan review

**Reviewed document:** `docs/features/normative-removal-accounting/plan.md`
**Governing sources:** `ARCHITECTURE.md` sections 12 and 21, `docs/hazards.md`, and `.claude/sessions/project-learnings.md`
**Repository evidence:** `src/reconciliation.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/prompts.ts`, `test/reconciliation.test.ts`, both stage-emitter fixtures, focused tests, `.claude/skills/run-buildworks/driver.mjs`, and the retained web-calculator run named in project learnings
**Review date:** 2026-09-04
**Status:** reconciled
**Hazards considered:** 17 is the feature requirement; 3 requires both reconciliation prompts to state the removal constraint; 4 requires break-tested guards and recorded real-output replay; 5 bears on the completion gate accepting an unexercised or disproven outcome; 7 requires separate authorization rather than an automatic repeat of an inconclusive paid run; and 13 constrains removal accounting from inventing obligations absent from the governing input. Entries 1, 2, 6, 8-12, and 14-16 introduce no additional material finding: the plan adds no parser shape, discards no output, adds no downstream promise or executable path, changes no model or configuration contract, claims no reviewer independence, creates no proposal sandbox, and adds no remediation loop.

---

## Summary

The core design covers hazard 17: it derives removals as the reverse multiset
difference, permits only `addressed` decisions to claim them, reuses governing-
source grounding, and makes both stages fail closed. Four execution gaps remain
in the completion evidence, audit ordering, fixture inventory, and safe full-
suite procedure.

## Verdict

**Ready for implementation after required revisions.** The implementation
direction is stable, but the plan cannot be handed off unchanged because it can
declare completion after a live run disproves the accepted path, and its required
full-suite recovery can alter repository history without an authorized procedure.

## Readiness assessment

- **Requirements coverage:** Material gaps — hazard 17 is covered 4 of 4;
  `ARCHITECTURE.md` section 21 is covered 3 of 4 because no recorded real model
  response becomes a durable contract test.
- **Executor handoff:** Revisions required — the blocked-run evidence is
  unavailable at the location Task 6 requires, and two shared fixture files are
  missing from the modification map.
- **Repository grounding:** Material gaps — production consumers are traced
  correctly, but the stage tests load replacement behavior from external emitter
  fixtures rather than defining it in the named test files.
- **Validation:** Material gaps — focused reconciliation tests, typecheck, and
  doc-check pass; the plan's full-suite isolation and live-proof criteria remain
  unresolved.
- **Security and operations:** Material gaps — the new guard fails closed, but
  the proposed test-leak cleanup has no safe recovery or authorization boundary.
- **Specialist rubrics:** Security — untrusted model decisions cross a
  deterministic gate into authoritative pre-approval artifact writes.

## Coverage exceptions

| Requirement(s) | Status | Material gap | Plan location | Required correction |
| --- | --- | --- | --- | --- |
| `ARCHITECTURE.md` section 21 recorded-output contract tests; hazard 4 | Partial | A one-time paid run produces evidence but no durable replay, and outcomes that do not exercise accepted removal claims still satisfy completion. | Verification; Task 6; Gate | Add a sanitized replay of retained real output and make the completion status match the evidence actually obtained. |

## Security and bad-practice assessment

- The removal guard preserves the authority boundary and fails closed; no new
  authentication, secret, network, or privilege exposure exists.
- Task 3's generic instruction to remove a leaked commit or file is unsafe when
  the full suite can move the real repository's `HEAD`. Recovery requires an
  exact pre-run anchor and operator authorization for destructive history repair.

## Material findings

### High risk — Completion accepts failed or unexercised live behavior

- **Where:** Verification, Task 6 steps 2-4 and completion outcomes 2-3, and Gate
- **Affected requirements:** `ARCHITECTURE.md` section 21; hazards 4, 5, and 7
- **Evidence:** `plan.md:149-152` says only the paid run settles the end-to-end
  claim, while `plan.md:567-580` accepts a legitimate reword being falsely
  refused or a run with no removal. The paid driver uses its fixed clamp design
  (`driver.mjs:42-64`, `342-390`) and cannot deliberately induce a replacement.
  The retained web-calculator output contains a genuine task replacement that
  claims only its added half, so a real negative replay already exists.
- **Impact:** The plan can report completion with an unresolved false refusal or
  without exercising the feature, while omitting the durable replay the binding
  verification strategy requires.
- **Required plan change:** Inspect and sanitize the retained response, add the
  minimum durable fixture through the real parse and validation seam, and assert
  that its omitted removed-half claim blocks. Outcome 2 must stop final completion
  pending operator resolution. Outcome 3 must remain inconclusive unless the plan
  explicitly makes live accepted-path proof optional; if proof remains mandatory,
  define a controllable target and require new authorization for each paid run.

### High risk — Full-suite isolation and recovery are not executable safely

- **Where:** Known blockers; Task 3 steps 6-7
- **Affected requirements:** Repository working agreements; hazard 4
- **Evidence:** `plan.md:96-99` and `.claude/sessions/project-learnings.md:53-57`
  record intermittent empty `moved` commits and `base.txt` leakage. Task 3 still
  runs `npm test` in place and says to remove the effects. A disposable checkout
  does not automatically contain the feature's uncommitted changes, and creating
  a worktree or rewriting history requires operator approval.
- **Impact:** Validation can move the real branch, capture unrelated work, or
  force an implementer into an unauthorized destructive recovery before the gate
  can be claimed.
- **Required plan change:** Define one isolation method that includes the exact
  working changes and state its approval boundary. Capture the original `HEAD`
  and status before the run. If leakage occurs, stop and report the delta; do not
  authorize generic commit or file removal in the plan.

### Medium — The primary removal abort produces none of Task 6's expected records

- **Where:** Task 3 step 3; Task 6 steps 3-4
- **Affected requirements:** Completion evidence and operator-visible failure behavior
- **Evidence:** The unclaimed-node branches at `src/spec-stage.ts:582-590` and
  `src/plan-stage.ts:706-715` abort before decision insertion and before the
  `spec.reconcile.record` or `plan.reconcile.record` summaries at lines 679-683
  and 796-800. Adding `unclaimedRemoved` to those later summaries does not make
  the token available on the direct unclaimed-removal path.
- **Impact:** Outcome 2 cannot supply the decision rows and reconciliation summary
  Task 6 requires; only the `*.reconcile.invalid` event and retained raw output
  exist.
- **Required plan change:** Define outcome-2 evidence as the invalid audit event
  plus retained raw response and state that no decision rows or reconcile summary
  exist, or add a dedicated pre-abort audit record without misrepresenting the
  decisions as accepted storage input.

### Medium — Shared replacement fixtures are outside the stated blast radius

- **Where:** Known blockers; Task 3 Files and step 6
- **Affected requirements:** Executor handoff and full-suite validation
- **Evidence:** `test/spec-stage.test.ts:19,57-59` and
  `test/plan-stage.test.ts:18,77-80` load behavior from
  `test/fixtures/harness/emit-spec-stage.mjs:98-125` and
  `test/fixtures/harness/emit-plan-stage.mjs:101-129`. Those emitters currently
  claim only the added half of each replacement, but Task 3 names only the stage
  sources and test files.
- **Impact:** Following the file map leaves both shared fixtures addition-only and
  makes the full suite fail, or encourages changing assertions instead of the
  model-shaped fixture payloads.
- **Required plan change:** Add both emitter fixtures to Affected areas and Task 3
  as modification targets. Require each replacement payload to emit exactly two
  claims, then keep the stage test files as explicit modification targets for the
  new regressions and summary assertions.

## Material evidence limits

- No post-change model response yet demonstrates that the revised prompt produces
  both halves of a legitimate replacement. The retained pre-change response is
  sufficient for a negative contract replay, not accepted-path proof.
- The full suite was not run during this review because the repository records an
  unresolved test-induced history mutation. The focused reconciliation suite
  passed 31 of 31; `npm run typecheck` and `npm run check:docs` passed, with only
  the expected historical and future-path warnings.

---

## Reconciliation

**Date:** 2026-09-04
**Disposition:** 4 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

Every factual claim was re-verified against the repository before disposition.
The abort ordering, both emitter payloads, section 21's verification categories,
and the retained web-calculator response were each read directly; all four
findings held. Two findings carried a sub-question the evidence could not
settle, and the operator answered both.

### Verdicts

- **Accepted — High risk: completion accepts failed or unexercised live
  behavior:** The plan no longer rests its claim on a paid run. Section 21's
  recorded-output category is now load-bearing: Task 2 gains Steps 2c and 2d,
  which copy the retained web-calculator reconciliation response into a
  sanitized repository fixture and drive it through `planNormativeNodes` and
  `validateReconciliation` in both directions — the recorded one-claim form must
  report the superseded task as an unclaimed removal, and a two-claim variant
  derived from it must validate cleanly. The operator ruled that live proof is
  supplementary: Task 6 is now optional beyond its free smoke, and its outcomes
  are four rather than three. No paid run, an accepted two-sided replacement,
  and no replacement each complete the task under their own name; a false
  refusal blocks the gate as a design decision for the operator. Live-provider
  compliance is claimed only where observed. The Verification header, the
  hazards line (5 and 7 now bear on the gate rather than on nothing), and the
  Gate were rewritten to match.
- **Accepted — High risk: full-suite isolation and recovery are not executable
  safely:** The instruction to remove a leaked commit or file is gone. Task 3
  Step 7 now runs the pre-gate full suite in a recursive copy of the working
  directory placed outside the repository, `.git` and `node_modules` included,
  because that is what carries the uncommitted feature work — a worktree or a
  fresh clone would test committed state instead. The step states its approval
  boundary explicitly: creating and deleting a scratch copy needs no approval,
  and repairing the real repository's history or working tree requires the
  operator's authorization, which this plan does not grant. A leak in the copy
  is recorded as evidence toward the untraced root cause, not repaired. The
  matching known blocker was rewritten from "run from a disposable checkout if
  tree purity matters" to the same rule.
- **Accepted — Medium: the primary removal abort produces none of Task 6's
  expected records:** Confirmed by reading both stages — the unclaimed branch
  aborts before decision insertion and before `spec.reconcile.record` and
  `plan.reconcile.record` are written. Task 3 Step 3 now states that
  `unclaimedRemoved` documents rounds that proceeded and is simply absent on the
  path that aborted, and Task 6 Step 3 defines the blocked-round evidence as the
  `*.reconcile.invalid` audit event naming the unclaimed removals plus the
  retained raw response, with no decision rows and no reconcile summary. The
  review's alternative — a dedicated pre-abort audit record — was declined in
  the plan text as new stage behaviour beyond scope, which the finding permitted.
- **Accepted — Medium: shared replacement fixtures are outside the stated blast
  radius:** Both emitters were read and each `reconcile` function does return a
  single added-half claim. `test/fixtures/harness/emit-spec-stage.mjs` and
  `test/fixtures/harness/emit-plan-stage.mjs` are now named in Affected areas,
  in Blast radius, and in Task 3's file map, and Task 3 Step 6 requires each
  revising round to emit exactly two claims — the added node and the superseded
  one, grounded with the same excerpt — and to update the comment above each
  `reconcile` that explains the one-claim rule. The step also records that a
  two-claim emitter is the stage-level positive test, so the accepted path is
  proved in the model-shaped payload rather than by relaxing an assertion.

### Operator decisions taken during reconciliation

- Live accepted-path proof is not mandatory. The recorded negative replay plus
  deterministic positive and negative tests carry the verification claim; a paid
  run is supplementary; an inconclusive run is not repeated; a false refusal
  blocks completion; and live-provider compliance is never claimed unless
  observed.
- The pre-gate full suite runs in an isolated copy that carries the uncommitted
  changes, rather than in place with an anchor.
