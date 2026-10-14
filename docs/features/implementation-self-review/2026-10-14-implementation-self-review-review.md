# Implementation self-review plan — second review

**Reviewed document:** `plan.md`

**Document type:** Plan

**Review date:** 2026-10-14

**Hazards considered:** 4, 13, 14, 15, 16 and 20. Hazard 16 (remediation aimed at the wrong artifact) governs the first high-risk area, because the code-review reconciler built on 2026-10-14 now handles the case the plan's remediation rule 3 was written for. Hazard 15 (a read-only proposal subprocess) governs the head-moved test gap. Hazard 4 (fixtures agreeing with code) governs the stand-in executor concerns. Hazard 13 bears on the #209 history, and hazard 20 on the self-review's output size. Hazard 14 applies to this review itself: the same model that wrote the plan in an earlier session reviewed it, so this is a self-check, not independent review. Hazards 1 to 3, 5 to 12, 17 to 19, 21 and 22 add nothing the plan and the 2026-10-13 review do not already state.

---

## Summary

This second review checks the unchanged plan against the code as it stands after the code-review reconciler was built, and against the recorded run 6 evidence. Every finding of the 2026-10-13 review still holds and stays open in that review's own record. This review adds two high-risk areas and four lower concerns the first review missed or the reconciler created.

## Verdict

**Ready for planning after required changes.** Nothing blocks implementation outright. The plan was written before the code-review reconciler existed, and its remediation rule 3 now works against it. A self-review that returns an unchanged file also blocks a run that has nothing wrong. The operator decides the first, and the second has a mechanical fix.

## Critical issues — must fix before implementation

No critical issues found.

## High-risk areas

**Risk:** Rule 3 is a second, unchecked rejection path beside the built reconciler

- **Why:** The plan predates the code-review reconciler (`docs/features/code-review-reconciler/plan.md`, `Implemented` 2026-10-14) and never mentions it. Remediation now receives only the findings the reconciler keeps (`src/code-review-stage.ts`, `remediationFindings` near line 769). A kept finding has survived the reconciler's checks: the frozen calls must all agree, each must quote the approved specification exactly, and a failed check keeps the finding. Rule 3 then lets the remediator skip any of those kept findings on its own judgment that a fix "can be fixed only by adding" an obligation. That skip has no quote, no second call and no record beyond a free-text summary. The case rule 3 was written for, #211 (session invalidation added to fix #200), is the case the reconciler already handles: `test/fixtures/recorded/code-review-reconciler-replay-crew-chatter-run-6.json` rejected #200 in 10 of 10 calls, quoting the reset-hash sentence. The block the 2026-10-13 review found also remains, in a narrower form: a panel whose every kept finding the remediator declines ends at "implementer returned no proposed patches" (`src/code-review-stage.ts` line 861).
- **Impact if ignored:** A real in-spec defect that the reconciler kept can go unfixed on the remediator's judgment. If the next panel does not report it again, nothing records that it was skipped. Each Haiku reviewer call finds about 2 of 8 known defects (`test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`), so a skipped defect often is not reported again. The `Hazards considered` line and the planned hazard 23 remedy also describe rule 3 as the answer to #211, which the reconciler now provides with checks.
- **Mitigation:** The operator chooses one option. This replaces the three options of the 2026-10-13 review's first high-risk area.
  - Drop rule 3 from the remediation prompt and rely on the reconciler. Keep the self-review's no-invention rule, which constrains only what the self-review adds, because the self-review has no findings to decline.
  - Keep only rule 3's first clause ("never add an obligation the specification does not state") and drop the "leave that code unchanged" clause. A remediator that meets a kept finding it cannot fix within the specification then faces two instructions that conflict, and nothing records which one it followed.
  - Keep rule 3 as written, and say in hazard 23 and the runbook that it is an unchecked skip beside the reconciler and can block a run.

  Whichever option is chosen, the plan's Source, Assumptions, `Hazards considered` line and the hazard 23 remedy name the code-review reconciler and state its effect on remediation.

**Risk:** A self-review that returns an unchanged file blocks the run

- **Why:** `applyProposedPatches` writes each file, runs `git add`, and refuses when the staged set differs from the proposed set (`src/patch-application.ts` lines 179-191). A file whose content is byte-identical to the checkout stages nothing, so the patch is refused with "staged set differs from the proposed patch". The repository already records this: the comment at `test/fixtures/harness/emit-implementation-stage.mjs` lines 81-83 says "identical content stages nothing, and the stage refuses a patch whose staged set differs from the proposed one". Phases rarely hit this because they mostly add files. The self-review is different: its usual result is that little or nothing needs fixing, and its patches modify files the model has just read in full. Task 7 step 4 asks the model to "never return a file unchanged", but that is a prompt request with a terminal consequence. Task 9 maps the refusal to `implementation.patch.refused` and blocks.
- **Impact if ignored:** A run whose code is fine blocks after every phase has spent, because the model re-emitted one file it decided not to change. No resume exists. The 2026-10-13 review's mitigation for the second high-risk area would not catch this, because it classes a patch refusal as a guard failure that still blocks.
- **Mitigation:** Before applying the self-review's patches, the stage drops every file whose content equals the file at `finalHead` byte for byte. It names each dropped path in the `implementation.selfreview.pass` event and treats a patch left with no files as no patch. Task 8 adds a `self-review-unchanged` emitter mode that returns the first scope path with its current content. Task 9 adds a test that the run passes with no self-review commit and the event names the dropped path, plus a break-it that removes the drop. Phases and remediation keep their current behaviour, which is out of this plan's scope.

## Medium and low concerns

- **Medium: the #209 history is incomplete, and the learning record's planned correction uses the wrong count.** The Replay section says the remediation fixed the NUL byte in the notes route (#201) only, and that rule 2 targets #209. That is true but incomplete. The email NUL defect already existed at the round-1 reviewed commit `bb7f3f6`. In `test/fixtures/recorded/code-review-replay-crew-chatter-run-6-security.json`, call `control-4` reports it as `unvalidated-nul-in-email-address` (high) and call `b-8` reports it as `email-nul-character-passes-validation` (low). That is 1 of 10 control calls, not the "5 of 10" in `.claude/sessions/project-learnings.md` (work list item 3). The 5 of 10 is the fixture's `"201 NUL byte"` count for the notes route. The Replay section and hazard 23 should say that #209 was a round-1 recall miss as well as a missed sweep, and cite those two calls. Rule 2 and the self-review sweep still target it.
- **Medium: the head-moved check after the self-review has no test.** Task 9 step 3 checks that the head is still `finalHead`. When `proposedPatches` is empty, `applyProposedPatches` never runs, so this check is the only thing that catches a model that committed in the checkout (hazard 15). Task 8 has no mode that commits, and Task 9's break-it list does not cover the check. Add a `self-review-commit` mode that commits a scope file and returns the clean answer, a test that the run blocks naming both heads, and a break-it that removes the check.
- **Medium: the code-review stage already settles the audit naming question from the 2026-10-13 review.** Remediation prefixes its successful patch events `code_review.remediation.` and maps every refusal to one action, `code_review.remediation.failed`, with a round prefix in the reason (`src/code-review-stage.ts` lines 871-874). Separately, `test/implementation-stage.test.ts` line 700 counts `implementation.patch.apply`, so the self-review's apply events must stay under `implementation.selfreview.` or that count changes. Following the remediation precedent gives one scheme: `implementation.selfreview.patch.apply` for successes and `implementation.selfreview.failed` for every refusal. Task 9's tests that expect `implementation.worktree.dirty` and the phase loop's out-of-scope action change to match.
- **Low: the self-review emitter modes work only with a one-phase plan.** Task 8 says the phases "answer as `ok` does" in the self-review modes. `ok` adds every scope path, so in a plan with two or more phases the second phase's add of an existing file is refused before any self-review runs. State that these modes run against a one-phase plan, or pair them with `phased`.
- **Low: several line references have moved.** The code-review stage's `patches` output check is at line 310, not 277; the "no proposed patches" refusal is at line 861; the `delivery-stage.test.ts` count is at line 470, not 467; and the `cli-operator.test.ts` author count is at line 1845, not 1798. `readiness.ts` line 238, `operator-state.ts` line 541, `implementation-stage.ts` line 393 and the emitter's line 27 are still correct.

## Missing and underspecified areas

- **What the stage does with a self-review file that differs only in line endings.** A target with `core.autocrlf=true` normalizes line endings on `git add`, so a file the model returns with LF endings over a CRLF checkout can also stage nothing. The unchanged-file drop should compare in the way `git add` will stage the file, or the plan should state that the drop compares raw bytes and accept the rest as a refusal.
- **How hazard 23 describes the remedy now.** Task 11 names the remedy as "Tasks 2 and 9". After the reconciler, the entry also states which part of #211's cause the reconciler addresses with checks, and which parts the prompt rules only ask for.

## Suggested improvements

- Mirror the design-split precedent in Task 5: `test/cli-operator.test.ts` near line 3120 already proves that a frozen author missing `spec-split` refuses by name through the CLI. A matching test for `implementation-self-review` covers the `bw run` path as well as the stage.
- Run Task 1's break-it against a scratch copy of the fixture. `test/code-review-reconcile.test.ts` and `test/prompts.test.ts` now read the same fixture, so a broken working-tree copy affects any concurrent test run until the copy is restored.

---

## Reconciliation

**Date:** 2026-10-14

**Disposition:** 10 accepted, 1 rejected, 0 deferred, 0 open

**Status:** reconciled

Reconciled in the same pass as the 2026-10-13 review of the same plan. The operator answered three questions on 2026-10-14: drop rule 3, skip the self-review on an unusable reply, and record the critique in the audit log.

### Verdicts

- **Accepted — Rule 3 is a second, unchecked rejection path beside the built reconciler:** the operator chose to drop rule 3. Task 2 now adds two rules; Source, Assumptions, `Hazards considered`, the Replay section's #211 trace and open decision 1 name the code-review reconciler as the only filter before remediation. The same verdict closes the 2026-10-13 review's first high-risk area.
- **Accepted — A self-review that returns an unchanged file blocks the run:** a new assumption and Task 9 step 5 drop each `modify` file whose blob equals the one at the last commit, and the pass event names it; Task 8 adds `self-review-unchanged`, and Task 9 adds its test and break-it.
- **Accepted — #209 history incomplete:** the Replay section and Task 11's hazard 23 step say #209 was in the round-1 reviewed commit and was missed by the round-1 panel, citing `control-4` and `b-8`; Task 1 asserts the `control-4` fact from the fixture. The learning record's "5 of 10" is corrected to 1 of 10.
- **Accepted — Head-moved check has no test:** Task 8 adds `self-review-commit`; Task 9 adds a test naming both heads and a break-it that removes the check.
- **Accepted — Audit naming settled by the code-review precedent:** successes are `implementation.selfreview.patch.apply`, every guard refusal is `implementation.selfreview.failed`, and a reply failure is `implementation.selfreview.skipped`; Task 9's tests follow that scheme.
- **Accepted — Emitter modes work only with a one-phase plan:** Task 8 states that the self-review modes run against a one-phase plan.
- **Accepted — Line references moved:** Known blockers and Blast radius carry the 2026-10-14 line numbers.
- **Accepted — Line endings:** the unchanged-file drop compares `git hash-object --path=<path> --stdin`, which applies the conversion `git add` applies, against `git rev-parse <head>:<path>`.
- **Accepted — Hazard 23 remedy:** Task 11 names the code-review reconciler as the checked remedy for #211's cause and the prompt rules and self-review as requests.
- **Accepted — Mirror the design-split test:** Task 5 adds a CLI test that removes `implementation-self-review` from the frozen implementer, beside the `spec-split` test.
- **Rejected — Run Task 1's break-it against a scratch copy:** the break-it runs only the new test file and restores the fixture by hash; reading the fixture through a configurable path would add a test seam for a one-time check. Task 1 now says to run only the new file.
