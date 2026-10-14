# Design Split Into Features — code review

**Reviewed document:** `plan.md`
**Reviewed change:** the uncommitted working tree on `dashboard-restyling` against `fd756a7`, Tasks 1-11 of the plan
**Reviewer:** an in-session subagent (operator's choice; the operator will run `/code-review ultra` separately). It read the code and callers, ran the focused suite, reproduced finding 2 in a scratch repository outside this one, and edited nothing
**Review date:** 2026-10-12
**Status:** reconciled

**Hazards considered:** 3 (finding 3: the validator's rules imply a minimum criterion count that the trigger did not check), 4 (each fix is proven by a test whose expected values come from rows the stage writes or from the recorded crew-chatter run 4 spec, and by a break-test), 6 (finding 2: a documented step the operator cannot complete), 7 (finding 3: a dispatch that cannot succeed is not sent, so nothing is paid for and then blocked), 13 (finding 1: a reviewer's own split concern must stay its own question, so its answer folds instead of being lost), and 14 (this reviewer ran inside the authoring session, so its independence is self-attested, not proven). Items 1, 2, 5, 8-12 and 15-21 add nothing here: no new output shape, retention, delivery rule, executable path, hook, model alias, seeding, sandbox, remediation loop, normative-node accounting, idle budget, phase size or verification prompt is involved.

---

## Findings as reported

The reviewer reported 6 findings: 0 critical, 0 high, 2 medium, 4 low. Its
focused run (8 files, `--test-concurrency=1`) was 198 tests, 0 failures, and
HEAD stayed at `fd756a7`.

1. **Medium: the split question is found by intent key alone, and a reviewer
   can produce the same key.** `runSpecDecisionStage` and the modify refusal in
   `answerQuestion` matched `intent_key === "design-split"`, and
   `validateReviewerReports` accepts any kebab-case intent key. A reviewer
   finding with that key, made `upstream_blocking` with a question, would be
   taken for the split: approving it ended the run `spec_decision.split.invalid`,
   denying it sent the real split's approve answer to the fold, and modify was
   refused on it. A reviewer report at `upstream:design:split` in the last round
   would also make `upsertCanonicalFinding` attach the split's rows to the
   reviewer's finding. Reachability depends on a model choosing that key; not run.
2. **Medium: the documented `git mv` step fails on the exported file.**
   `proposal-export` writes an untracked file, and `git mv` refuses an
   untracked source (exit 128, with or without the destination directory). The
   blocked reason, the runbook, the README and ARCHITECTURE section 14 all gave
   that step. Reproduced.
3. **Low: a split that cannot pass validation is still dispatched.** The
   validator needs at least `max(2, ceil(declared / threshold))` pieces, each
   with at least one criterion, so a spec with fewer criteria than that cannot
   be split. The stage dispatched anyway, then blocked the run with
   `spec.split.invalid` after the whole spec group had spent, and the operator
   never got "build as one". Derived from the rules; not run.
4. **Low: no test covers the `cwd` added to the decision fold dispatch.** The
   spec and plan stages have `FIXTURE-REPORT-CWD` tests; the fold did not, so
   removing its `cwd` would pass the suite.
5. **Low: the provenance paths in two new recorded fixtures are corrupted.** The
   Windows paths in `declared-paths-vs-plan-items.json` (`provenance.stores`) and
   `spec-crew-chatter-run-4.json` (`provenance.target`) lost their backslashes,
   and `\r` and `\t` survived as JSON escapes. No test reads them.
6. **Low: `status` offers `--answer-file` for the split question, which is
   refused.** The `decision_answer` action's reason named all three forms for
   every question.

---

## Reconciliation

**Date:** 2026-10-12
**Disposition:** 6 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

**Hazards considered:** the same entries as the review.

### Verdicts

- **Accepted — 1, split found by intent key:** the split question is now identified by the finding id in the system-written `spec.split.record` event (`readSplitRecord`, `src/design-split.ts`), in both `runSpecDecisionStage` and the modify refusal. `DESIGN_SPLIT_LOCATION` became `upstream:design:split:proposed`: a reviewer's upstream location is the prefix and one kebab key, so no report can reach it and `upsertCanonicalFinding` cannot merge the two. `approveSplit` reads the evidence ref and hash from the same record. A fixture mode, `FIXTURE-REVIEWER-SPLIT-INTENT`, makes a reviewer report `design-split` at `upstream:design:split`; the new test in `test/spec-decision-stage.test.ts` asserts two findings and two questions, modify accepted on the reviewer's, two proposals from the approved split, and the reviewer's answer carried into the features. A `test/design-split.test.ts` test asserts no reviewer report validates at the split location. Breaking the location, the modify refusal or the question lookup each fails a test.
- **Accepted — 2, `git mv` on an untracked export:** the blocked reason, the README, the runbook and ARCHITECTURE section 14 now say to move the file to `docs/features/<slug>/design.md` and `git add` it, and why `git mv` refuses. The README and runbook give the PowerShell. The free walk, rerun with exactly that step, staged each design as `A`, left nothing under `docs/proposals/`, and committed a clean tree.
- **Accepted — 3, impossible split dispatched:** `splitIsPossible` (`src/design-split.ts`) states the minimum; when a split is wanted and not possible, the spec stage records `spec.split.skipped` with the counts and dispatches nothing, and the run goes on as one build. A test in `test/design-split.test.ts` checks `splitIsPossible` against the validator for 1-4 criteria derived from the recorded run 4 spec, and a spec-decision-stage test asserts the skip event, no record, and the dispatch count. ARCHITECTURE section 12, the README and the runbook say so. Breaking the check fails the skip test.
- **Accepted — 4, fold `cwd` untested:** "the decision fold runs in the target root" counts the `cwd=` lines in the run's raw output against the dispatch count and compares each with `realpathSync`. Removing the fold's `cwd` fails it.
- **Accepted — 5, corrupted provenance paths:** both values rewritten with escaped backslashes and checked by parsing. The older committed fixture `spec-review-note-keeper-runs-5-6-disclosed-decisions.json` has the same corruption; it is outside this change and left as a follow-up.
- **Accepted — 6, `status` offers `--answer-file`:** the action's reason for the split question is "Choose exactly one of --approve (split) or --deny (build as one); this question takes no --answer-file." A test asserts that text for the split question and the existing text for every other. Reverting it fails the test.

After the fixes: typecheck clean; the full serial suite 1470 tests, 1464 pass, 0 fail, 6 skipped, with HEAD still `fd756a7`; `check:docs` clean apart from its 107 standing warnings.
