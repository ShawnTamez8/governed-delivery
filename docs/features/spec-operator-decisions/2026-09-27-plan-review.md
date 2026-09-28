# Spec Operator Decisions Implementation Plan — plan review

**Reviewed document:** `docs/features/spec-operator-decisions/plan.md`
**Governing sources:** `ARCHITECTURE.md`, `docs/hazards.md`, and `.claude/sessions/project-learnings.md`
**Repository evidence:** `src/reconciliation.ts`, `src/store.ts`, `src/spec-stage.ts`, `src/operator-state.ts`, `src/run-command.ts`, `src/approval-stage.ts`, `src/dashboard-approval.ts`, `src/dashboard-server.ts`, `src/cli.ts`, `src/cli-args.ts`, `src/migrations/005_finding_report_decision.sql`, and `scripts/doc-check.mjs`
**Review date:** 2026-09-27
**Status:** reconciled

**Hazards considered:** 1-4 govern the new fold response, retained output, question/fold prompt contracts, and fixture authority; 12 governs a new frozen execution group and its projection; 13 governs operator-authorized obligations folded into the specification; 14 requires the operator decision to remain human evidence rather than reviewer evidence; 16 governs the new route for upstream questions; and 17 governs the fold's two-direction normative accounting. Items 5-11, 15, and 18 add no separate material finding because this plan changes no delivery proof, later-stage coverage promise, retry, executable path, hook, model alias, default seeding, proposal sandbox, or code-review inspection boundary.

---

## Summary

The plan chooses a coherent product direction: model-judged blocking questions
pause for an operator decision, both operator surfaces call one core, and the
answered specification still reaches the existing signed approval. The current
task contract is not safe to implement unchanged. It leaves one duplicated
stage identity in the schema, no atomicity requirement for an immutable answer
and its audit evidence, no deterministic preservation rule for denied disclosed
open decisions, a grounding-vocabulary collision, and contradictory runner
boundaries around the new pause. It also omits the architecture's schema block
and the existing "only human gate" statement from the required documentation
changes.

## Verdict

**Not ready for implementation.** Reconcile the six material findings below
before Task 0. None disputes the operator's selected behavior; each closes an
implementation choice that currently permits inconsistent state, a false
projection, or documentation that contradicts the binding architecture.

## Readiness assessment

- **Requirements coverage:** Partial — approve, deny, modify, CLI, dashboard,
  fold, and approval binding are represented, but deny is not mechanically
  preserved for an existing `## Open decisions` entry.
- **Executor handoff:** Revisions required — the post-spec pause alternates
  between `decide` and `decision`, while the current runner needs one exact
  non-execution boundary and one separately consented execution group.
- **Repository grounding:** Material gaps — the plan traces the principal
  callers, but misses the shared source-vocabulary role in
  `src/reconciliation.ts`, the answer/audit transaction boundary, and the
  schema pins in `scripts/doc-check.mjs`.
- **Validation:** Partial — the proposed focused tests cover shape refusals and
  happy paths, but not the six invariants below.
- **Security and operations:** Partial — the dashboard reuses the approval
  route's authentication controls, but immutable human evidence can be wedged
  without an atomic write contract.

## Material findings

### High — `decision_question.stage_id` duplicates authoritative stage identity

- **Where:** Storage approach; Task 3; Task 5's question lookup.
- **Evidence:** A finding already carries `stage_id` in the authoritative
  `finding` table. The proposed `decision_question` row stores both
  `finding_id` and another independently writable `stage_id`, but its foreign
  keys prove only that each referenced row exists; they do not prove that the
  finding belongs to that stage. `getDecisionQuestions(stageId)` and
  `answerQuestion(...findingId...)` would then be able to observe different
  ownership for the same question.
- **Impact:** One bad insert can expose or answer a question under the wrong
  run/stage while every declared foreign key remains valid. This recreates the
  separate-state disagreement that `ARCHITECTURE.md` sections 2 and 4 reject.
- **Required plan change:** Remove `decision_question.stage_id` and derive the
  stage through `decision_question.finding_id -> finding.stage_id` in every
  query, or define and test a composite database constraint that makes a
  mismatched pair impossible. Prefer the derived form because no query needs a
  second stored authority.

### High — An immutable answer and its audit evidence are not required to commit atomically

- **Where:** Task 5, `answerQuestion` recording and refusal behavior.
- **Evidence:** The plan requires one immutable answer per question and a
  `decision.answer` audit event, but says only that the caller holds the writer
  lock. A writer lock prevents concurrent writers; it does not roll back a
  successful `decision_answer` insert when the later audit append throws.
  `approveRun` explicitly uses one store transaction for this same wedge class.
- **Impact:** A process or database failure between the two writes leaves an
  answered question with no human audit evidence. The unique answer constraint
  then refuses the operator's retry, while the decision group may still consume
  the unaudited answer.
- **Required plan change:** Require one store transaction containing the answer
  insert and `decision.answer` append. Add a fault-injection test that makes the
  audit append fail and proves neither row commits, followed by a successful
  retry. State separately that a refusal audit creates no answer row and is not
  part of that success transaction.

### High — Deny does not preserve an existing disclosed open decision

- **Where:** Goal and Source deny semantics; Task 6 fold validation.
- **Evidence:** The selected behavior says deny leaves the question open and
  says nothing new in the specification. Task 6 keeps the current
  no-added-open-decision check and tells the model that denied questions remain
  open and unmentioned, but it defines no before/after preservation check.
  `specNormativeNodes` deliberately excludes `## Open decisions`, so the
  normative removal accounting cannot catch a fold that deletes or rewrites a
  denied disclosed entry.
- **Impact:** In a mixed fold, the model can silently remove or alter the exact
  open decision the operator denied, while every listed validation passes. The
  signed specification would then record the opposite of the operator's answer.
- **Required plan change:** Define a deterministic denied-question invariant.
  For a question sourced from a disclosed open-decision entry, the fold must
  preserve that entry's ID, severity, and text exactly. For a reviewer-raised
  question absent from the specification, the fold must add no entry or
  normative node for it. Add mixed approve-plus-deny tests that break each side
  of this rule; the all-deny no-dispatch path is not sufficient proof.

### High — `operator_decision` collides with the shared upstream-source vocabulary

- **Where:** Task 2's grounding-source change; Task 6 fold validation.
- **Evidence:** `UPSTREAM_SOURCES` in `src/reconciliation.ts` currently serves
  three roles: grounding sources, reviewer upstream-location sources through
  `upstreamPrefixFor`, and the storage boundary's allowed finding-decision
  sources. Adding `operator_decision` to that array would broaden all three.
  `upstreamPrefixFor` also maps every non-`design`, non-`plan` value to
  `upstream:specification:`, so the new value has no correct location mapping.
  The fold's synthetic decisions are not persisted as a second
  `finding_decision`, so the storage vocabulary does not need this source.
- **Impact:** A fold-only authority can leak into ordinary spec/plan decision
  storage or reviewer-location typing, and one helper returns a false prefix
  for it.
- **Required plan change:** Keep the review upstream vocabulary closed to
  `design`, `specification`, and `plan`. Define fold grounding as a
  context-specific accepted source set, with `operator_decision` accepted only
  when its excerpt occurs in the recorded answer for that same question. Add
  tests proving ordinary reconciliation and `insertFindingDecision` still
  refuse `operator_decision`.

### High — The runner contract conflates the `decide` pause with the `decision` execution group

- **Where:** Task 7; `remainingGroups`, `expectedBoundary`, and the promised
  `advanceRun` outcome.
- **Evidence:** The plan says an unanswered snapshot exposes workflow action
  `decide`, is ineligible for `run`, and produces a named `awaiting_decision`
  outcome. It also says the spec group's open-question boundary has next group
  `decision`. In current code, an ineligible action becomes a generic refused
  result, `expectedBoundary` requires one exact next group, and
  `remainingGroups` slices every execution group except `spec`. If `decision`
  is added to `EXECUTION_GROUPS` without another special case, a post-answer
  preview includes post-approval groups even though this invocation must stop
  at approval.
- **Impact:** A successful spec group can be reported as an unexpected or
  refused boundary instead of a deliberate decision pause, and the consent
  preview after answers can claim a wider range than the invocation may
  execute.
- **Required plan change:** Define the states separately: unanswered questions
  yield non-execution action `decide`, phase and operator outcome
  `awaiting_decision`; all answered questions yield execution group `decision`.
  `expectedBoundary(spec)` must accept either `approval` after three stages or
  `decide` after two. `remainingGroups` must return only `decision` for that
  group, as it returns only `spec` before the first human pause. Add assertions
  for previewed groups, result outcome/code, and stage counts on both branches.

### Medium — The required architecture and checker updates are incomplete

- **Where:** Assumptions; Affected areas; Task 1.
- **Evidence:** Task 1 names `ARCHITECTURE.md` sections 3, 5, 12, 13, and 23
  plus `PINNED_SEQUENCE`. The plan also adds two authoritative tables, but does
  not update section 15's schema block or `scripts/doc-check.mjs`
  `PINNED_TABLES` and column pins. Section 12 currently calls
  `awaiting_approval` "The only human gate," while this feature adds a mandatory
  human-controlled pause; saying only that `spec_decision` is not the signature
  gate leaves both statements true only by an unstated terminology change.
- **Impact:** The architecture ceases to describe the authoritative schema, the
  checker does not pin the new tables, and the human-authority contract becomes
  internally ambiguous even if the implementation works.
- **Required plan change:** Add section 15 and the schema/table pins to Task 1.
  Define `spec_decision` as an unsigned human decision boundary and revise
  "only human gate" to the exact surviving claim, such as "only signed
  authorization gate." Mirror the same terminology in source comments and
  operator documentation that currently repeat the old claim.

## Required validation additions

- Prove a question cannot be associated with a finding from another stage.
- Break the answer audit append and prove the answer insert rolls back.
- Fold one approved and one denied question, then prove the denied disclosed
  entry is byte-for-byte preserved.
- Prove `operator_decision` remains invalid in ordinary reconciliation,
  reviewer upstream routing, and stored finding decisions.
- Assert the exact `awaiting_decision` runner outcome and the post-answer
  consent preview containing only `decision`.
- Break the new schema table/column pins in a checker mirror before restoring
  them, following the `doc-check` workflow.

## Evidence limits

- This is a source-and-contract review. It does not claim that any proposed
  implementation exists or that a live provider follows the new question or
  fold prompt.
- No paid run was performed or authorized.
- Existing unrelated full-suite failures were not re-investigated.

---

## Reconciliation

**Date:** 2026-09-27
**Disposition:** 6 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

**Hazards considered:** the same entries as the review (1-4, 12, 13, 14, 16, 17). Fixing 3 changes the fold's denied-question accounting, which is a hazard 17 concern. Fixing 4 keeps the hazard 13 grounding tied to one question's answer. Neither fix adds a new hazard.

Each finding was checked against the code before a disposition was recorded:
- `finding(id, stage_id, …)` in `ARCHITECTURE.md` section 15;
- `store.transaction` in `approveRun` (`src/approval-stage.ts`);
- `specNormativeNodes` returns only artifacts and criteria (`src/reconciliation.ts`), and the spec-stage open-decision check compares added IDs only;
- `UPSTREAM_SOURCES` is used by `upstreamPrefixFor` and the `insertFindingDecision` source check (`src/store.ts`);
- `remainingGroups`, `expectedBoundary` and `boundaryResult` (`src/run-command.ts`);
- `PINNED_TABLES` (`scripts/doc-check.mjs`), and "only human gate" in `ARCHITECTURE.md` sections 12 and 17 and in `src/approval-stage.ts`.

All six claims hold. No finding contradicts an operator choice, so each was applied as a mechanical fix.

### Verdicts

- **Accepted — `decision_question.stage_id` duplicates authoritative stage identity:** Task 3 drops the column. The getters join through `finding.stage_id`, and `answerQuestion` checks the finding's stage. A new store test covers a cross-stage question, and a new stage test covers a refusal.
- **Accepted — An immutable answer and its audit evidence are not required to commit atomically:** Task 5 puts the answer insert and the `decision.answer` append in one `store.transaction`, and keeps the refusal audit outside it. It adds a fault-injection test, a retry test and a break-test.
- **Accepted — Deny does not preserve an existing disclosed open decision:** the Source deny bullet and Task 6 now keep a denied disclosed entry's ID, severity and text exactly, through a separate check. Denied questions get no synthetic `addressed` decision, so a node added for one refuses. Mixed approve-plus-deny tests break each side, with a break-test.
- **Accepted — `operator_decision` collides with the shared upstream-source vocabulary:** Task 2 leaves `UPSTREAM_SOURCES` unchanged. It accepts `operator_decision` only through an `operatorAnswers` context, and only when the excerpt is in that same finding's answer. Tests show that ordinary reconciliation and `insertFindingDecision` still refuse it.
- **Accepted — The runner contract conflates the `decide` pause with the `decision` execution group:** Task 7 now defines the two states separately. It also defines `boundaryResult`, the two-shape `expectedBoundary(spec)`, `expectedBoundary(decision)` → `approval`, and `remainingGroups` → `["decision"]`, and makes `awaiting_decision` exit 3 in `src/operator-output.ts`. It adds branch assertions for outcome, exit code, stage count and preview, plus a break-test.
- **Accepted — The required architecture and checker updates are incomplete:** Task 1 adds the section 15 schema rows, the `PINNED_TABLES` entries and constraint pins with a mirror break-test, and `spec_decision` as an unsigned human decision boundary. It renames approval to "the only signed authorization gate" in sections 12 and 17 and in the `approveRun` comment. Assumptions, Affected areas and Known blockers were updated to match.
