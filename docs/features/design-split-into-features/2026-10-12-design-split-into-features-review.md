# Design split into features plan — review

**Reviewed document:** `plan.md`

**Document type:** Plan

**Review date:** 2026-10-12

**Hazards considered:** 2, 4, 6, 13, 14, 18 and 20. Hazard 13 (specifications inventing obligations) governs the critical issue: embedding the original design makes out-of-scope requirements groundable. Hazard 2 (discarded output is undiagnosable) bears on the medium concern about the unrecorded block reason. Hazard 4 (fixtures and code agreeing while both are wrong) bears on the concern about the validator's blind spot and the unbacked replay claim. Hazard 6 (promises a later stage cannot keep) bears on the working-directory prompt sentence. Hazard 14 (independence that cannot be proven) bears on the discarded operator answers, which are recorded human decisions. Hazards 18 and 20 are the entries the plan amends, and this review found nothing that weakens review or enlarges a reply. Hazards 1, 3, 5, 7 to 12, 15 to 17, 19 and 21 are not design inputs for this review.

---

## Summary

The plan adds a split proposal after the spec review gate, an approve or deny answer through `answerQuestion`, stored feature designs exported with `proposal-export`, and a `new-run --after` link checked by ancestry. Most of its code claims hold against the repository: the re-entrant `Store.transaction` (`src/store.ts` line 448), the `invocation` field on `dispatchOnce` (`src/dispatch.ts` line 26), the read-only executor flags (`src/executor.ts` lines 47 to 54), the `freezePolicyValues` helper (`test/implementation-stage.test.ts` line 990) and the decision-stage fold logic all exist as described. The weak points are in what the operator actually receives: the feature design document, the fate of the operator's other answers, and the evidence the `--after` check trusts.

## Verdict

**Ready for planning after required changes.** One critical issue changes what each feature's spec author can legally specify, and its fix is a change to `renderPieceDesign` that the free tests can check. Three high-risk areas need plan edits before Task 4, Task 7 and Task 8 start. The medium concerns can be folded in during the build.

## Critical issues — must fix before implementation

**Issue:** Embedding the original design makes every out-of-scope requirement groundable in each feature's run

- **Why it matters:** Task 4's `renderPieceDesign` copies the original design verbatim under `## Original design (context only)`. That text becomes the feature's `design.md`, and the spec stage passes the whole design file as `governingText` to `validateReconciliation` (`src/spec-stage.ts` lines 640 to 647; the same in `src/spec-decision-stage.ts` lines 360 to 367). Grounding checks that a reconciler's added requirement quotes the design. With the original embedded, a reviewer finding such as "the spec omits the export feature" can be resolved as `addressed` by adding the other feature's requirements, and the grounding check passes because the text is in the governing design. The heading problem makes it worse: the original design's own `##` headings sit at the same level as the feature's `## Acceptance criteria for this feature`, so the "context only" label ends at the first embedded heading.
- **Where:** Task 4, `renderPieceDesign`; open decision 5; Known blockers, the last `[Unknown]` about whether a feature's spec author stays inside its criteria.
- **Production impact:** A feature's spec can re-specify most of the original design and still pass every mechanical gate. Its declared file count then exceeds the threshold again, and the run proposes a second split of the same design. The plan lists this as an unknown that only a paid pair answers, but the grounding consequence follows from the code and needs no spend.
- **Recommended fix:** Reference the original design by path instead of embedding it. Task 2 makes the spec dispatches run in the target, so *docs/features/&lt;originalSlug&gt;/design.md* is readable there, and the operator keeps it committed. If the operator still wants it embedded (open decision 5), state in the plan that it widens grounding, and change Task 4 (e) to assert that no embedded heading appears at level 2 or above (fence or demote it). Either way, add a Task 6 test in which a feature design's reviewer finding cites text only in the original design and assert the result.

## High-risk areas

**Risk:** An approved split discards the operator's answers to every other question at the same pause

- **Why:** The split question opens beside the reconciler's questions and the disclosed open decisions (`OD-NNN`). Task 7 says "No fold is dispatched, even if other questions were approved." The rendered feature designs come from the reviewed spec, which still carries the open questions unanswered. Each feature run then sees the same gaps, re-discloses them, and asks the operator again, once per feature.
- **Impact if ignored:** The operator answers the same question two or more times. Different features can receive different answers to one question, for example two answers to a `Verification:` open decision about what the lint command requires. The first answers stay in the original run's audit trail but reach no feature.
- **Mitigation:** Pick one before Task 7: (a) `renderPieceDesign` adds a `## Decisions already made` section listing each answered question's text, action and answer verbatim from `decision_answer`; or (b) `answerQuestion` refuses answers to other questions until the split question is answered, and an approved split closes them. Option (a) keeps one pause and adds one rendered section and one test.

**Risk:** The `--after` check parses audit prose instead of the verified delivery record, and the format already has a second copy

- **Why:** Task 8 adds `parseDeliveryGatePass` over the `delivery.gate.pass` summary. The run snapshot already derives `delivery.deliveredCommit` (`src/operator-state.ts` lines 839 to 876) after it cross-checks the retained `delivery_result` record, the final reviewed commit, the approved scope, the stage status and the gate summary. That code also restates the summary format as its own literal at line 867, which the plan's `formatDeliveryGatePass` does not replace. The blast radius says the format is "unchanged byte for byte" but does not list this reader.
- **Impact if ignored:** `--after` trusts a weaker fact than `status` does: an event whose retained record is missing or inconsistent still links. A later change to the summary through the new formatter makes the snapshot verifier mark every newly delivered run `evidence_invalid`, because its literal no longer matches.
- **Mitigation:** Read the earlier run with the existing snapshot builder and require `phase === "completed"` and a non-null `delivery.deliveredCommit`. Drop `formatDeliveryGatePass` and `parseDeliveryGatePass`. If the formatter stays, Task 8 must also replace the literal at `src/operator-state.ts` line 867 and list `src/operator-state.ts` under Files.

**Risk:** The exported file is a proposal record, not a design

- **Why:** `proposal-export` writes a fixed wrapper (`src/cli.ts` lines 590 to 604): an H1 title, `**Route:**`, `**Raised in:**`, `**Source finding id(s):**`, `**Evidence:**` with a `.governance/` path, `## Problem` holding the rendered design, and `## Why this is upstream` holding the `whyUpstream` text. Task 7's `whyUpstream` includes `new-run --after` instructions. The operator moves this file to `design.md` with `git mv`, so the feature's spec author reads BuildWorks bookkeeping and operator instructions as part of the design, and grounding accepts them as design text. Task 7 (b) only checks that the rendered design is "inside" the exported file.
- **Impact if ignored:** Each feature design carries text the spec author can quote as a requirement. Operators either hand-edit each file, which the runbook does not say, or run with the wrapper and get specs that cite it.
- **Mitigation:** Decide in the plan which applies. Either the runbook step in Task 10 tells the operator to delete everything outside `## Problem` before committing, or `whyUpstream` holds only a one-line provenance note and the plan states that the wrapper's metadata lines are accepted in the design. Add a Task 11 walk step that runs the spec stage's emitter against an exported, moved design to show it validates.

## Medium and low concerns

- **Medium: the block reason exists only in a return value.** Task 7 builds the operator's next-step instructions as the `ok: false` reason and never writes them to the audit. `status` shows the last recorded event (`src/operator-state.ts` lines 650 to 655), which is `spec_decision.split.approve` with proposal ids and slugs. Task 11 expects "`status` shows the run blocked with the reason", which this design does not produce. Append the reason as the final event, after the stage and run are blocked.
- **Medium: the capability and setting checks for the split run after the spec group has spent.** Task 6 refuses a missing `spec-split` output only once the threshold trips, after the author, critique, panel and reconciler dispatches. Every other configuration check in the stage precedes the first dispatch. Resolve the author's `spec-split` output and setting before the spec author's first dispatch.
- **Medium: the split dispatch breaks the stage convention for author dispatches.** Task 6 dispatches the author on the review stage. Every existing author dispatch, including the critique and reconcile dispatches that run during review, records on the spec stage (`src/spec-stage.ts` lines 239, 305 and 598). Dispatch on `specStage.id`, or add a grep step for readers that assume review-stage `agent_run` rows are reviewer seats, such as the dashboard's ledger.
- **Medium: the proposals break the table's stated contract.** Migration 006's header says a proposal "is derived from a validated reconciliation decision" and that its route "is derived from the disposition". Task 7 creates proposals with route `follow_up` from an `upstream_blocking` finding, where `deriveRoute` gives `blocking_dependency`. Either use `deriveRoute`, or record the exception in `ARCHITECTURE.md` section 14 in Task 10.
- **Medium: the new prompt sentence claims something nothing enforces.** Task 2's "Your working directory is the target repository at the commit this run started from" is false once the operator commits during a decision or approval pause. The plan stage runs after approval in the same checkout. Say "the target repository's working tree" and drop the commit claim.
- **Medium: Task 2's plan-stage test cannot see its marker.** Plan prompts carry the spec, not the design (`buildPlanAuthorPrompt`, `src/prompts.ts` line 394). A `FIXTURE-REPORT-CWD` marker in the design never reaches the plan emitter. Put the marker in the spec text the plan-stage test seeds.
- **Medium: the replay claim for crew-chatter run 4 overstates Task 6.** The replay section says "Task 6 runs the trigger on it". Task 6's tests use the emitter's base spec with a lowered threshold. Either add a Task 6 case that feeds run 4's recorded spec through the trigger, or correct the sentence.
- **Medium: the validator cannot see a wrong order.** `validateDesignSplit` checks that `dependsOn` points backward, not that a piece's criteria can be built without a later piece's files. The split proposal's "What would settle it" asked for a hand-checked correct split of run 4's spec. Task 4 derives contiguous splits mechanically, which tests the validator's rules but not whether a valid split is a buildable one. State in the plan and in the question text that order correctness rests on the operator.
- **Medium: spec dispatches in the target can read `.governance/`.** `--tools Read,Glob,Grep` does not restrict paths, and the executor's `deniedPaths` is not passed to `claude` (`src/executor.ts` lines 47 to 52 and 70 to 71). A feature run's spec author can read the original run's retained raw outputs, including its full spec. **[Inference]** Grep honors `.gitignore`, so discovery is less likely than a direct read. Name this in Known blockers.
- **Low: guided mode exits on the modify refusal.** `decisionHandoff` turns any refusal into exit 3 (`src/guided-command.ts` lines 454 and 455), so an operator who picks modify on the split question leaves the session and is offered modify again next time. Hide modify for the split question in guided mode, or state the behavior.
- **Low: `status` suggests the wrong export name.** The snapshot's export action derives the name from the proposal title (`src/operator-state.ts` lines 377 to 386), while Task 7's reason uses `--name <slug>`. Set each proposal's title to the slug, or accept the mismatch in the runbook.
- **Low: the `task_decomposition` wording disagrees.** The plan's Source says the decision "lifts the hold on design decomposition for this one use". Its Assumptions say `task_decomposition` "stays deferred". Task 10's section 5 paragraph needs one wording for both.

## Missing and underspecified areas

- **A feature that trips the threshold again.** A feature's own spec can declare more than 43 files. The plan does not say whether a nested split is expected, how its slugs relate to the original, or whether the question text should mention the earlier split.
- **What happens to the original run's documents.** The plan covers the untracked `spec.md`. It does not say whether the original `design.md` stays in *docs/features/&lt;originalSlug&gt;/*, which the critical issue's fix depends on.
- **The split question's `why` field.** Task 6 says only that it "names the threshold". Give the sentence so the dashboard and CLI tests can pin it.
- **The deny path's audit record.** On deny, the split question leaves the fold, but `spec_decision.gate.pass` still counts it in `answers=`. State whether a denied split gets its own event so the run record shows the operator chose to build as one.

## Suggested improvements

- Record the split question's frozen threshold and the declared count in the `decision_question` text as well as the audit event, so the dashboard shows the numbers without parsing an event.
- Add one Task 11 walk step that runs `new-run --after` in the scratch target against the walk's own blocked split run, and confirm it refuses with the "not completed" reason. The walk then covers the refusal the operator is most likely to hit.

---

## Reconciliation

**Date:** 2026-10-12

**Disposition:** 21 accepted, 1 rejected, 0 deferred, 0 open

**Status:** reconciled

The operator decided the three judgment calls on 2026-10-12: name the original design by path, copy the other answers into each feature, and have the operator trim each exported file.

### Verdicts

- **Accepted — Embedding the original design makes every out-of-scope requirement groundable:** operator chose path only. `renderPieceDesign` takes no design text and ends with an `## Original design` paragraph naming the path; Task 4 (e) asserts only the six listed headings appear. The Assumptions and hazard 13 entry explain the grounding reason, Known blockers require the original `design.md` to stay committed, and open decision 5 is removed. The separate Task 6 grounding test was not added: with no design input to the renderer, no original text can reach a feature's `design.md`.
- **Accepted — An approved split discards the operator's other answers:** operator chose to copy them. `renderPieceDesign` takes `decisions` and renders `## Decisions already made` verbatim. Task 7 builds the list from the review stage's other questions, and new test (h) and break-it (5) cover it. Hazard 14's entry records that no human decision is dropped.
- **Accepted — The `--after` check parses audit prose:** Task 8 reads the earlier run with `readRunSnapshot` and requires `phase` `completed` and a non-null `delivery.deliveredCommit`. `formatDeliveryGatePass`, `parseDeliveryGatePass` and the delivery-stage change are removed. Tests build the earlier run with a copy of `withBoundary(10, ...)` and add a deleted-record refusal and break-it (3). The Approach, Affected areas and Blast radius sections match.
- **Accepted — The exported file is a proposal record, not a design:** operator chose to trim by hand. A new assumption states the trim to the `## Problem` body. The approval reason, the Task 10 runbook step and `ARCHITECTURE.md` section 14 say so. `whyUpstream` drops the run instructions, and the Task 11 walk now trims, moves, and runs the spec stage against the result.
- **Accepted — The block reason exists only in a return value:** Task 7 appends `spec_decision.split.blocked` with the reason as the final event. Test (a) checks it through `readRunSnapshot`, and the Blast radius lists the third audit action.
- **Accepted — The capability check runs after spend:** Task 6 aborts with `spec.split.failed` beside the existing capability checks before the author's first dispatch and reuses `authorSettings`. New test (f) and break-it (5) cover it.
- **Accepted — The split dispatch breaks the stage convention:** Task 6 dispatches on `specStage.id`. New test (g) and the Blast radius record it.
- **Accepted — The proposals break the table's stated contract:** route is `deriveRoute("upstream_blocking")`. Task 10's section 14 paragraph records that these are the only proposals created by an operator answer.
- **Accepted — The new prompt sentence claims something nothing enforces:** Task 2's sentence now names the target's working tree and no commit. Hazard 6's entry says why.
- **Accepted — Task 2's plan-stage test cannot see its marker:** the plan-stage test puts `FIXTURE-REPORT-CWD` in the seeded spec.
- **Accepted — The replay claim overstates Task 6:** the replay names what each task checks, and Task 3 adds (d), asserting run 4's 62 declared files exceed the threshold.
- **Accepted — The validator cannot see a wrong order:** a new assumption states the limit, and the question text says the operator decides whether each feature can be built before the next.
- **Accepted — Spec dispatches in the target can read `.governance/`:** added to Known blockers with the unread `deniedPaths` evidence. The plan does not change it.
- **Accepted — Guided mode exits on the modify refusal:** Known blockers and the runbook step state the behavior. Guided mode is not changed.
- **Accepted — `status` suggests the wrong export name:** Known blockers and the runbook say to use `--name <slug>`.
- **Accepted — The `task_decomposition` wording disagrees:** the Source now says the decision authorizes a design split while `task_decomposition` stays deferred.
- **Accepted — A feature that trips the threshold again:** a new assumption says a feature run over the threshold gets its own split proposal and the plan adds nothing for nested splits.
- **Accepted — What happens to the original run's documents:** Known blockers, the approval reason and the runbook keep the original `design.md` committed.
- **Accepted — The split question's `why` field:** Task 4 adds `SPLIT_WHY` with its exact sentence, Task 6 uses it, and Task 4 (f) pins it.
- **Accepted — The deny path's audit record:** Task 7 states that no new event is added, because the `decision.answer` event records `deny` against the `design-split` finding.
- **Rejected — Record the threshold and declared count in the question text:** Task 4's `splitQuestionText` already states both numbers, and test (f) asserts `62` and `43`.
- **Accepted — Add a Task 11 walk step for `new-run --after` against the blocked split run:** added, with the run count unchanged.
