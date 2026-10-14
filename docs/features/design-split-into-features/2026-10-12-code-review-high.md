# Design Split Into Features — second code review (`/code-review high`)

**Reviewed document:** `plan.md`
**Reviewed change:** the uncommitted working tree on `dashboard-restyling` against `fd756a7`, after the fixes recorded in `2026-10-12-code-review.md`
**Reviewer:** the `/code-review high` skill, run by the operator as a forked agent inside this session. It read the code and edited nothing. `/code-review ultra` was refused first: its diff against `master` (72 files, 11,606 lines) also carried the earlier dashboard restyling and passed the 8,000-line limit
**Review date:** 2026-10-12
**Status:** reconciled

**Hazards considered:** 1 (finding 6: a refusal must name its cause, and the check showed the boundary's first reason already does), 4 (each fix is proven by a test whose expected values come from rows the stages write, the emitter's own BASE_SPEC, or the recorded crew-chatter run 4 spec, and by a break-test), 14 (finding 1: reviewers started in the target could read their siblings' raw reports; this reviewer also ran inside the authoring session, so its independence is self-attested), and 20 (finding 2: the guided menu's "Deny" committed the operator to building as one, which the plan ceiling can still refuse after the plan is paid for). Items 2, 3, 5-13 and 15-19 and 21 add nothing here: no output shape, retention, constrained field, delivery rule, retry, executable path, hook, model alias, seeding, configuration divergence, invented obligation, sandbox, remediation loop, normative-node accounting, idle budget or verification prompt is involved.

---

## Findings as reported

The skill returned 10 findings as a JSON list, each with a file, line, summary
and failure scenario, and no severities. The numbering below is the list order.

1. **Spec and plan reviewers start in the target root** (`src/spec-stage.ts:539`).
   The executor's `deniedPaths: ['.governance/**']` is declared but not enforced,
   so a reviewer could read `.governance/raw/<run>/...` and see the round-1
   reviewers' reports, the reconciler output and `split.json`. Before this change
   the cwd was the launch directory.
2. **Guided mode shows the split question the generic menu**
   (`src/guided-command.ts:424`). "2. Deny - Leave this question open" means build
   as one, and "3. Modify" is always refused and ends the session.
3. **An approved split is checked again against the feature directories present
   at approve time** (`src/spec-decision-stage.ts:324`). A directory created during
   the pause blocks the run for good, and the comparison is case-sensitive, so on
   Windows `Crew-Core` does not stop the slug `crew-core`.
4. **`status` suggests a title-derived `--name` for a split feature's export**
   (`src/operator-state.ts:379`), while the blocked reason and the runbook say to
   use the slug.
5. **`--after` accepts a completed run from another project**
   (`src/run-intake.ts:437`).
6. **`--after` takes its refusal reason from `workflowAction.reasons[0]`**
   (`src/run-intake.ts:442`), which "can be an unrelated worktree or lock refusal"
   when the run's worktree was also removed.
7. **The split question is a special case in four places**
   (`src/spec-decision-stage.ts:112`): `answerQuestion`, `operator-state`, guided
   mode and the dashboard each re-derive it, and two of them rendered the generic
   menu. The allowed actions could be stored on the `decision_question` row.
8. **The slug listing under `docs/features/` is duplicated** in `spec-stage.ts` and
   `spec-decision-stage.ts`; one copy sorts and the other does not.
9. **`splitIsPossible` is called twice in back-to-back `if` blocks, and the skip
   message copies its formula** (`src/spec-stage.ts:862`).
10. **`DESIGN_SPLIT_PROMPT_PREFIX` calls the spec "approved"** (`src/prompts.ts:284`);
    at that point it has only passed spec review.

---

## Reconciliation

**Date:** 2026-10-13
**Disposition:** 8 accepted, 1 rejected, 1 deferred, 0 open
**Status:** reconciled

**Hazards considered:** the same entries as the review.

The operator chose option (a) for finding 1 and asked for 2, 3/8, 4, 5, 6, 9 and
10 to be fixed. Finding 3's permanent-block half and finding 7 were left as they
are. Finding 6 was fixed, then reverted when the check below showed its premise
does not hold.

### Verdicts

- **Accepted — 1, reviewers in the target:** the spec and plan reviewer dispatches no longer pass `invocation: { cwd: rootDir }`; the authors (draft, self-critique, reconciliation, decision fold, split) still do. The cwd tests in `test/spec-stage.test.ts`, `test/plan-stage.test.ts` and `test/spec-decision-stage.test.ts` now count the `cwd=` reports: author dispatches in the target, reviewer dispatches elsewhere (3 and 2; 4 and 2 with the split; 4 and 2 with the fold). Restoring either reviewer cwd fails them. ARCHITECTURE section 7 and the hazard 21 addendum say which dispatches run where and why.
- **Accepted — 2, generic split menu:** for the split question, guided mode offers `1` Split, `2` Build as one (with the plan-ceiling warning) and `4` Exit, and refuses anything else as an attempt. A new test in `test/guided-command.test.ts` drives a real split pause: three `3`s exit with code 3 and no answer recorded, then `3` followed by `2` records deny and the run passes `spec_decision`. Accepting `3` as deny fails it. The README and runbook describe the menu.
- **Accepted — 3, the case-sensitive half:** `featureSlugsInUse` (`src/design-split.ts`) lowercases directory names, and the validator compares without case. A test in `test/design-split.test.ts` makes an `Other-Feature` directory and refuses the slug `other-feature`, both through the helper and with a cased name handed straight to the validator; removing either lowercasing fails it. ARCHITECTURE section 12 says "in any letter case".
- **Deferred — 3, the permanent block during the pause:** answers are immutable by design, and the approve-time check is what stops a split overwriting a feature directory that appeared meanwhile. The block names the slug, and a fresh run is the repair. Revisit if it is observed.
- **Accepted — 4, title-derived export name:** for a proposal named in the `spec_decision.split.approve` event (`readSplitApproval`), the `proposal_export` action carries `--name <slug>` unless that file already exists. The approved-split test asserts both features' actions; reverting fails it. ARCHITECTURE section 14, the README and the runbook say `status` suggests the slug.
- **Accepted — 5, cross-project `--after`:** `checkAfter` refuses a run whose `project` differs, before the run row. A test in `test/run-intake.test.ts` asserts the refusal, an unchanged run count, and that the same link from the run's own project is accepted; removing the check fails it. ARCHITECTURE section 14, the README, the runbook, CLAUDE.md and AGENTS.md say "same project".
- **Rejected — 6, unrelated first reason:** the fix (prefer the `delivery_result` reference's reason) was written, and its first test passed against both orderings, so it showed nothing. Tracing `interpretBoundary` in `src/operator-state.ts`: `deliveredCommit` is null only after an evidence check has refused, and the worktree checks at line 909 run only when it is set, so a worktree reason cannot be first when `checkAfter` reaches this branch. With the verification record deleted, the first reason is "cannot read verification evidence at ...", the cause, while the delivery record's own reason is only "does not match the final reviewed handoff". The fix made the message worse, so `run-intake.ts` is back to `reasons[0]`. A new test pins that the missing verification record is named; putting the delivery reason first fails it.
- **Deferred — 7, allowed answers as data:** a schema change to `decision_question`, not a fix. The dashboard's split card still offers Modify, which `answerQuestion` refuses with the split message; that is the remaining surface this finding names. Revisit with the next question type that restricts its answers, or when the dashboard card is changed.
- **Accepted — 8, duplicated slug listing:** both stages now call `featureSlugsInUse`; the copies and their `readdirSync` imports are gone.
- **Accepted — 9, double check and copied formula:** the split block in `runSpecStage` is one if/else, and `minimumSplitPieces` (`src/design-split.ts`) is used by `splitIsPossible` and by the `spec.split.skipped` message. A test pins 62 files at 30 to three pieces (the recorded run 4 spec), 31 to two and 1 to two. Making the skip unconditional fails the skip test.
- **Accepted — 10, "approved" in the split prompt:** `DESIGN_SPLIT_PROMPT_PREFIX` now says "a reviewed specification", with a comment on why, and `emit-spec-stage.mjs` routes on the new text; `emit-cli-run.mjs` imports the constant. ARCHITECTURE section 5 says "reviewed" too.

After the fixes: typecheck clean; `check:docs` clean apart from its standing warnings; CLAUDE.md and AGENTS.md identical. Each accepted fix and the reverted finding 6 have a break-test that fails as expected, nine in all. The full serial suite result is in the plan's implementation note.
