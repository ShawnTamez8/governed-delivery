# Implementation self-review plan — review

**Reviewed document:** `plan.md`

**Document type:** Plan

**Review date:** 2026-10-13

**Hazards considered:** 1, 2, 14, 16, 20 and 21. Hazard 14 (independence that cannot be proven) applies to this review itself: the session that wrote the plan also reviewed it, so this review is a self-check, not independent review. Hazard 16 (remediation aimed at the wrong artifact) governs the first high-risk area, a remediation rule that turns a passable run into a blocked one. Hazards 1 and 20 (output shapes, one dispatch over too much) govern the second, a new terminal failure point after the most expensive stage. Hazard 2 (discarded output is undiagnosable) bears on where the critique lives. Hazard 21 is satisfied as written. Hazards 3 to 13, 15, 17 to 19 and 22 are not design inputs beyond what the plan already states.

---

## Summary

This review covers the plan for an implementer self-review after the last phase, three remediation-prompt rules, a phase-prompt task check, and a reconciler "update dependent sections" rule. The plan is grounded in code and evidence, and its claims about callers, routing and guards check out against the source. Two design consequences are unaddressed, and two documents stay contradictory as the tasks are written.

## Verdict

**Ready for planning after required changes.** No defect blocks implementation outright, but the two high-risk areas below change run outcomes, and the operator decides both. The document fixes are mechanical.

## Critical issues — must fix before implementation

No critical issues found.

## High-risk areas

**Risk:** Rule 3 blocks runs that pass today

- **Why:** Code review sends every non-empty panel before the final round to remediation, at any severity (`CLAUDE.md`, code-review operating contract). Rule 3 tells the remediator to leave a finding alone when the fix needs an obligation the specification lacks, and `src/code-review-stage.ts` refuses a remediation with no patches. A round-1 panel holding only such findings, for example medium "beyond baseline" hardening findings like run 6's #200, now ends the run at "implementer returned no proposed patches". Without rule 3, the remediator fixes them. Without any remediation, the final panel passes findings below `high`. The spec reviews of crew-chatter runs 5 and 6 routed 48 findings upstream, 19 of them as protection or policy beyond the stated baseline, so reviewers raise this kind of finding routinely.
- **Impact if ignored:** A run whose only findings are out-of-spec hardening blocks after full implementation spend, and nothing records it as a scope question. The plan's assumption calls this "the intended outcome", but that holds only for findings at or above the blocking severity.
- **Mitigation:** The operator decides between three options:
  - let a remediation that returns no patches skip the commit and verification and go to the next panel, which changes `src/code-review-stage.ts` and touches the code-review contract the plan declares out of scope;
  - narrow rule 3 so that it applies only when other findings in the same panel have fixes;
  - accept the block and state it in the hazard entry and the runbook.

**Risk:** A new terminal failure point after the implementation spend

- **Why:** The self-review is one more large-output dispatch after every phase has spent. The project already records failures of exactly this kind:
  - one in 20 phase file replies was beyond the JSON repair (crew-chatter run 3);
  - an earlier implementer dispatch failed at the 64,000-token output cap;
  - a usage-limit refusal stranded $9.63 at phase 6 of 6 (crew-chatter run 2).

  The plan blocks on any self-review failure ("No fallback") by analogy with the spec and plan self-critique. That analogy is weak: the self-critique fails before most of a run's money is spent, while the self-review fails after it, and code review still runs independently on the phase head.
- **Impact if ignored:** A run that would have reached code review blocks with nothing wrong in its code, and no resume exists.
- **Mitigation:** Split the failures by what they prove:
  - a guard refusal (dirty tree, head moved, out-of-scope patch) is a boundary breach and still blocks;
  - a reply failure (dispatch failed, body not JSON, invalid shape) records `implementation.selfreview.skipped` with the reason and continues to verification from the last phase's commit.

  This is the operator's call because it reverses the plan's stated no-fallback rule. The plan should also say whether `docs/features/implementation-phase-retry/plan.md` (Reconciled, not built) covers the self-review reply when it lands.

**Risk:** Current-tier documents left contradicting the code

- **Why:** Task 11 adds a sentence to `CLAUDE.md`, `AGENTS.md` and `ARCHITECTURE.md` section 12. It never amends the sentences that already say the gate event's head "is the last phase's commit" (`CLAUDE.md` line 103; `ARCHITECTURE.md` section 12, at the end of the `implementation` paragraph). `check:docs` does not read that claim.
- **Impact if ignored:** The binding working rules state two different gate heads.
- **Mitigation:** Task 11 rewrites both existing sentences to "the last phase's commit, or the self-review's commit when it changed anything", and records the 2026-10-13 operator authorization in section 12, as earlier authorized changes are recorded.

## Medium and low concerns

- **Medium: the count-assertion list misses a test.** Known blockers omits `test/implementation-stage.test.ts` line 376: `assert.equal(rows.length, 1, "one phase, one dispatch")` in the phase-1 prompt-hash test. That test also reads `rows[0]`, which stays the phase-1 dispatch. Task 9 says to grep `agent_run` across `test/` rather than trusting the list.
- **Medium: the critique is visible only in raw output.** `.governance/raw/` is machine-local, and `driver.mjs clean` deletes it. Neither `status` nor the dashboard shows what the self-review found or fixed. Recording each critique entry, bounded, in an audit event keeps it queryable.
- **Medium: the audit action names are mixed.** Task 9 step 5 prefixes the patch helper's audit actions with `implementation.selfreview.`, but maps refusals to the phase loop's `implementation.*` actions. Pick one scheme and state it, so that a query for self-review events finds all of them.
- **Low:** `dispatchOnce` records `independence: "configured_standalone"` on every row (`src/dispatch.ts`). The self-review row looks like an independent dispatch, although it describes process isolation, not review independence. The hazard 23 entry or the stage comment says so.
- **Low:** Task 9 refuses a missing `implementation-self-review` output after the stage row and worktree exist, as the existing `patches` check does. `frozenGroupReasons` catches it earlier under `bw run`, but not under the low-level `implement` command.

## Missing and underspecified areas

- **The self-review rule sentences are not given verbatim.** Tasks 2, 3 and 4 state each new rule as an exact sentence, but Task 7 step 3 paraphrases the self-review checks. `CONSTRAINT_STRINGS` needs exact text, so the plan states each self-review rule as its final sentence.
- **Task 3's phrase "each acceptance criterion it serves" is undefined.** The plan's `## Tasks` items do not cite criteria, and `## Coverage` maps a criterion to an artifact, not to a task. The rule names how the implementer finds the criteria a task serves (the coverage lines naming the files it returns), or it drops the criterion half.

## Suggested improvements

- Name the hazard 23 entry after the remedy's actual limit. "A fix that never sees the decisions behind the code it changes" describes a mechanism this plan does not remove: the remediator still never sees plan-review decisions (open decision 1). The entry says plainly that prompt rules mitigate it and do not close it.
- Add a frozen policy switch for the self-review only if a paid run shows it costs more than it saves. Until then the plan correctly adds none (hard rule 4 and "configuration means a frozen code constant").

---

## Reconciliation

**Date:** 2026-10-14

**Disposition:** 12 accepted, 0 rejected, 0 deferred, 0 open

**Status:** reconciled

Reconciled in the same pass as the 2026-10-14 review of the same plan, after the code-review reconciler was built. The operator answered three questions on 2026-10-14: drop rule 3, skip the self-review on an unusable reply, and record the critique in the audit log.

### Verdicts

- **Accepted — Rule 3 blocks runs that pass today:** the operator chose to drop rule 3, so the remediation prompt has no rule that lets the remediator leave a finding unfixed and cannot end at "implementer returned no proposed patches" on that account. The 2026-10-14 review's first high-risk area replaced this one's options, and one verdict covers both.
- **Accepted — A new terminal failure point after the implementation spend:** the operator chose to skip on a reply failure. A new assumption and Task 9 step 4 record `implementation.selfreview.skipped` and continue for a failed dispatch, an unparsed body, an invalid result or critique, a non-`proposed` status, or a malformed patch; a moved head, a dirty tree or a patch refusal still blocks. Known blockers states that the phase-retry plan does not cover the self-review.
- **Accepted — Current-tier documents left contradicting the code:** Task 11 rewrites the "last phase's commit" sentences in `CLAUDE.md`, `AGENTS.md` and `ARCHITECTURE.md` section 12, records the authorization in section 12, and greps for the old wording.
- **Accepted — The count-assertion list misses a test:** Known blockers lists line 376, and Task 9 greps `agent_run` and `implementation.` across `test/` instead of trusting the list.
- **Accepted — The critique is visible only in raw output:** the operator chose the audit log. Task 6 adds `critiqueAuditEntries` with a 2,000-character entry cut and a 50-entry cap as code constants; Task 9 records one `implementation.selfreview.critique` event per entry.
- **Accepted — The audit action names are mixed:** one scheme, following the code-review remediation precedent: `implementation.selfreview.patch.apply`, `implementation.selfreview.failed`, `implementation.selfreview.skipped`, `implementation.selfreview.critique` and `implementation.selfreview.pass`.
- **Accepted — The self-review row's `configured_standalone` label:** the independence assumption, the Task 9 header comment and hazard 23 state that the label describes process isolation, not review independence.
- **Accepted — The missing-output refusal comes after the stage row:** Task 9 refuses a missing `implementation-self-review` output before `store.insertStage`.
- **Accepted — The self-review rule sentences are not given verbatim:** Task 7 step 3 and step 4 state each sentence exactly.
- **Accepted — Task 3's "each acceptance criterion it serves" is undefined:** the rule now names each criterion whose `## Coverage` line names a file the phase returns, which is the link `src/plan-doc.ts` parses.
- **Accepted — Name hazard 23 after the remedy's limit:** Task 11 has the entry state plainly that prompt rules mitigate the mechanism and do not close it. The title keeps naming the mechanism, as every `docs/hazards.md` heading does.
- **Accepted — Add a frozen switch only after a paid run:** no change; the plan adds no switch.
