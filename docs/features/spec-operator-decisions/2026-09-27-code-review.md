# Spec Operator Decisions — code review

**Reviewed document:** `docs/features/spec-operator-decisions/plan.md`
**Reviewed change:** the uncommitted working tree on `dashboard-ux-redesign` against `d2954d9`, Tasks 0-9 of the plan
**Reviewer:** an in-session subagent (operator's choice over a billed `/code-review ultra`); it read the code and callers and edited nothing
**Review date:** 2026-09-27
**Status:** reconciled

**Hazards considered:** 4 (each fix below is proven by a test whose expected value comes from rows the stage writes, and by a break-test), 13 (findings 2 and 3 concern the fold changing `## Open decisions` entries the operator never authorized), 14 (answers stay `actor_type: human`; finding 7 moves normalization into the one core both surfaces call), 16 (a denied question stays an open upstream question, so its entry must survive), and 17 (`specNormativeNodes` excludes `## Open decisions`, so entry deletion needs its own accounting). Items 1-3, 5-12, 15 and 18 add nothing here: no new model response shape, retry, executable path, hook, model alias, seeding, sandbox or code-review gate is involved.

---

## Findings as reported

The reviewer reported 7 findings: 0 critical, 3 medium, 4 low. It confirmed
finding 1 by running `formatDecisionQuestions` from a throwaway script and the
rest by reading the code and its callers.

1. **Medium: `status` can print the wrong finding's `decide` commands.**
   `src/operator-output.ts` `formatDecisionQuestions` picked each question's
   action with `a.args.includes(String(q.findingId))`. The args also carry the
   run id, so a finding whose id equals the run id matched an earlier
   question's action. An operator copying the Deny line would answer the wrong
   question, and answers are immutable.
2. **Medium: a denied question from `## Open decisions` can vanish.**
   `deniedDisclosureRefusals` looked the entry up in the already-reconciled
   spec and skipped it when absent. `spec_review` reconciliation refuses only
   added entries, so the reconciler could remove or renumber OD-001 while
   asking about it; a deny then passed, and approval bound a spec with no
   trace of the question the operator chose to leave open.
3. **Medium: the fold can delete or reword any open decision never put to the
   operator.** The fold checked only additions and denied disclosed entries.
4. **Low: the dashboard treats question findings as permanently blocking, and
   does not queue runs waiting for a decision.** `findingStatus` classified
   `upstream_blocking` and `cannot_determine` as blocking even after an
   answer; `needsAttentionQueue` has no `awaiting_decision` entry.
5. **Low: answer actions are offered as eligible when the boundary is
   invalid.** `decision_answer` actions were always eligible, and guided mode
   and the dashboard offered answers on a run whose gated spec hash no longer
   matched, recording immutable answers on a run that cannot advance.
6. **Low: with more than one `spec_review` round, the operator can be asked
   the same thing twice.** Questions persist every round; only reachable when
   `specReviewRounds` is 2 or more.
7. **Low: the CLI and the dashboard record different text for the same
   answer.** `bw decide --answer-file` trimmed; the dashboard did not.

The reviewer also noted, not as a finding, that fold grounding is a verbatim
substring check, so a node a denied question implies can pass when claimed
under an approved answer that shares a phrase. That is the accepted textual
grounding design.

---

## Reconciliation

**Date:** 2026-09-27
**Disposition:** 6 accepted (one in part), 0 rejected, 1 deferred, 0 open
**Status:** reconciled

**Hazards considered:** the same entries as the review. The fix for 2 and 3 is hazard 17 accounting for the one section the normative delta cannot see.

### Verdicts

- **Accepted — 1, wrong `decide` commands:** the lookup now matches the value after `--finding`. `test/operator-state.test.ts` inserts a question whose finding id equals the run id after one that does not, and asserts its Deny line names its own finding; it failed on the old lookup and passes on the fix.
- **Accepted — 2 and 3, open-decision entries lost or changed:** `deniedDisclosureRefusals` became `openDecisionRefusals` (`src/spec-decision-stage.ts`). Every reviewed entry must survive unchanged unless its own disclosed finding carries an approve or modify answer, and a denied disclosed question whose entry is missing from the reviewed spec refuses. It also runs on the all-deny path, which previously skipped every check. Two fixture modes (`FIXTURE-ASK-SECOND`, `FIXTURE-RECONCILE-DROP-OD`) drive the new tests in `test/spec-decision-stage.test.ts`; each fails when its guard is removed.
- **Accepted in part — 4, dashboard status:** `findingStatus` takes the recorded answer: approve or modify reads addressed, deny reads non-blocking, and an unanswered question stays blocking because it holds the run. `findingStatuses` supplies it, and the Findings tab now reads the same map. The real-store dashboard test asserts all three and each mapping was break-tested. **Deferred:** a dedicated `awaiting_decision` group in the attention queue. Unanswered questions already appear there as blocking findings and in the run view's question cards; a new group, chip and action is new interface work rather than a correction.
- **Accepted — 5, ineligible answers offered:** `readRunSnapshot` downgrades `decision_answer` actions with the boundary, `status` prints `decide` commands only for eligible actions, guided `decisionHandoff` refuses before prompting, and the dashboard question card states the reason instead of showing controls. Each has a test that fails with its guard removed. `answerQuestion` still checks only the structural chain, so a direct `bw decide` on an edited spec records an answer the fold will later refuse; the surfaces no longer offer it.
- **Accepted — 7, trimming differs by surface:** `answerQuestion` trims `modify` text before its empty and length checks, so every writer stores the same bytes. Break-tested.
- **Deferred — 6, repeated questions across rounds:** unreachable in the shipped configuration (`SPEC_REVIEW_ROUNDS = 1`, `src/policy.ts`). Trigger: any decision to raise the spec review round count must first decide which round's questions are asked.
