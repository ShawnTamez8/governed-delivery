# Code-review reconciler plan — review

**Reviewed document:** `plan.md`

**Document type:** Plan

**Review date:** 2026-10-13

**Hazards considered:** 2, 4, 7, 13, 14, 15, 16 and 20. Hazard 14 (independence that cannot be proven) applies to this review itself: the session that wrote the plan also reviewed it, so this is a self-check, not independent review. Hazard 14 also bears on the plan's 2-of-2 rule, because two calls with the same model, prompt and input are not shown to be independent samples. Hazard 4 (fixtures agreeing with code) drives the critical issue: Task 8 tests the projection against a record the test builds, not the record the stage writes. Hazard 2 (output that cannot be diagnosed) bears on failed reconciler dispatches, which the audit records under the implementer's name. Hazards 7, 13, 16 and 20 bear on the all-rejected rule, the re-report risk and the prompt ceiling. The plan already handles hazard 15 (the dirty-tree check after each call) as written. Hazards 1, 3, 5, 6, 8 to 12, 17 to 19, 21 and 22 add nothing beyond what the plan states.

---

## Summary

This review covers the plan that adds a Haiku reconciler before each code-review remediation. The plan holds up against the code and the recorded data. The pair results in Task 3 match the fixtures (`[200]` in all five replay pairs, nothing agreed in 5a, `[905]` in pairs 3-4 and 7-8 of 5b). All 25 recorded rejects carry a rationale, so the extra rationale rule does not break Task 3's equality test. The planned `finding_decision` row passes every rule `insertFindingDecision` enforces. A failed dispatch writes no `agent_run` row, which matches Task 6's `reconcile-exit` assertion. One gap would break the exact case Task 8 adds, and one design consequence goes unstated.

## Verdict

**Ready for planning after required changes.** The critical issue below takes a two-line change to Task 6 and one test that runs the stage's own record through the projection. The first high-risk area needs only a written statement and the operator's acknowledgement, not a redesign.

## Critical issues — must fix before implementation

**Issue:** A round decided early because every finding was rejected writes a record the projection refuses

- **Why it matters:** `src/code-review-stage.ts:588` sets `roundRecord.blocking` from the first decision. Before the reconciler runs, that decision is `remediate`, so the round's `blocking` is `[]`. Task 6 step 6 then re-decides and says to "take the existing pass or block branch unchanged". That branch writes the new `decision.blocking` into the record's top-level `blocking` but leaves the round's `blocking` at `[]`. The blocked branch in `src/operator-state.ts` requires `canonicalJson(value.blocking) === canonicalJson(final.blocking)`, so the record from `reconcile-reject-all-high` is reported as "the blocked final code-review panel does not match its recorded gate". That is the same false "invalid evidence" Task 8 sets out to remove.
- **Where:** Task 6, step 6. Task 8, the tests step.
- **Production impact:** A run blocked by a rejected high finding shows on `bw status` and the dashboard as invalid evidence instead of as a gate block. The operator loses the readable reason for the block in the one case the plan adds.
- **Recommended fix:** In Task 6 step 6, set `roundRecord.blocking` from the re-decision before writing the record. Then run the stage's own result through the projection: either Task 6's `reconcile-reject-all-high` test calls the status projection on the store and asserts `available`, or Task 7 adds a full-chain `reconcile-reject-all-high` run and asserts `bw status --json` shows the stage `available` with a blocking finding. Keep Task 8's built-record tests for the "one finding lacks a rejection" case, but do not let them stand in for the real record (hazard 4).

## High-risk areas

**Risk:** A correctly rejected high finding can turn a pass into a block

- **Why:** Withholding a fix leaves the code unchanged, and the next panel reviews that same code. Round 2's reviewers can report the same concern again. It gets a new round-scoped finding with no decision (intent keys are unstable across rounds), and the final gate counts it. Without the reconciler, the remediator would have fixed it, out of spec or not, and the run could pass. The plan states that the reconciler "never turns a block into a pass" but not the reverse. No recorded data covers this: every out-of-spec finding measured (#200, #905) was `medium`, below the `high` threshold.
- **Impact if ignored:** On the first live run where a reviewer raises an out-of-spec `high` finding, the run can block on a concern two reconciler calls judged out of scope, with no way forward but a new run. The operator would meet this as a surprise rather than a known trade.
- **Mitigation:** State the consequence under Assumptions, beside the all-rejected rule. Add it to the section 12 and `CLAUDE.md` wording in Task 10. Add it to Open decisions so the operator acknowledges it. It follows from their "final gate counts every finding" choice, so no redesign is implied. Also state the uneven treatment: a rejected `high` blocks at round 1 for certain when every finding is rejected, but blocks only if re-reported when one other finding is kept.

**Risk:** A failed reconciler dispatch looks like a failed remediation in the audit

- **Why:** `dispatchOnce` writes no `agent_run` row on failure. Its `agent.dispatch.failed` event names actor `implementer` and says "dispatched agent implementer (author)", with no setting. Only the requested model (`claude-haiku-5-5` versus the implementer's Sonnet) tells the two apart. The round record carries the call status, but the record exists only after the round is written, and an aborted stage writes none.
- **Impact if ignored:** When a run blocks later in the round, an operator reading the audit trail cannot tell whether the reconciler or the remediator failed without matching model names (hazard 2).
- **Mitigation:** Have Task 6 write the `code_review.reconcile.done` summary with each call's status (`calls=failed,valid`, not just a count). Have Task 6's `reconcile-exit` test assert that this event names the failed call. Changing `dispatchOnce` itself is outside this plan's scope.

## Medium and low concerns

- **The 2-of-2 rule assumes the two calls are independent.** They use the same model, prompt and input. Under the hazard-7 bullet the plan calls call 2 "a second independent sample", which hazard 14 warns against claiming. The data cannot settle it: 5b's #905 was agreed in 2 of 5 pairs, and the one wrong single reject (#906) gives no pair estimate. Reword to "a second call" and say the protection depends on how often two calls make the same mistake, which no recorded run measures.
- **The dashboard's stage settings miss the new setting.** `STAGE_SETTINGS.code_review` in `src/dashboard/app.js` lists `implementer` and the `code-reviewer-` prefix. The `code-review-` prefix of `code-review-reconciler` does not match it, so the stage's "Configured settings" column never shows Haiku `medium` for the reconciler. Add the name to Task 8 and to Affected areas.
- **Per-agent costs fold the reconciler into the implementer.** `src/operator-state.ts` groups `agent_run` rows by `agent`, so the implementer's row shows both Sonnet and Haiku in `requestedModels`. This matches the `reconciler` precedent. Task 8's legend text should say so.
- **Task 10 misses a cost sentence.** `CLAUDE.md` (Commands, the `driver.mjs` bullet) says "Remediation adds an implementer dispatch and another full three-reviewer panel". With this plan, remediation also adds one or two reconciler calls. Update it in `CLAUDE.md`, `AGENTS.md` and any copy in `.claude/skills/run-buildworks/SKILL.md`.
- **The copied prompt carries a crew-chatter example.** The measured template's basis example is `"plan task: Create the notes API in"`, which every future run would receive. An invalid basis still keeps the finding, so this is harmless. Task 4's doc comment should state that the example stays on purpose, because rewording it needs a new replay.
- **The reject audit embeds free text.** `code_review.reconcile.reject` puts the excerpt inside a `key=value;` summary. Excerpts can contain `;` and line breaks. Nothing parses it today. Put the excerpt last so a future parser can read the fields before it.
- **The report does not explain an early decision.** Task 6 adds the "every finding was rejected" sentence to the block reason only. `report.md` for a round passed or blocked early should carry the same sentence under `### Reconciliation`, so the evidence file explains why round 1 of 2 was final.

## Missing and underspecified areas

- **Which test runs the real all-rejected record end to end.** Task 7 covers only `reconcile-reject-one`. See the critical issue.
- **What `code_review.reconcile.done` records per call.** Task 6 step 4 lists `calls` without saying whether it is a count or a list of statuses. Specify the list.
- **The dashboard wording for a finding that is both rejected and blocking.** Task 8 makes `blocking` outrank `rejected`. The card should still show the recorded rejection, so the operator sees both facts. State whether the card shows the decision fields when the status is `blocking`.

## Suggested improvements

- Add one Open decisions line recording that no live data covers an out-of-spec `high` finding, so the first paid run is also the first measurement of the re-report risk.
- In the Replay section, note that #200 was `medium`. If round 2 had re-reported it, the final gate still would not have blocked on it at the `high` threshold. That keeps the run 6 claim accurate without implying the general case.

---

## Reconciliation

**Date:** 2026-10-13

**Disposition:** 15 accepted, 0 rejected, 0 deferred, 0 open

**Status:** reconciled

The inventory has 15 entries: 1 critical issue, 2 high-risk areas, 7 medium and low concerns, 3 missing areas and 2 suggested improvements. Two missing areas share a fix with a finding above them, so this list has 13 verdicts covering all 15. The session that wrote the plan also reconciled it.

### Verdicts

- **Accepted — A round decided early because every finding was rejected writes a record the projection refuses; Which test runs the real all-rejected record end to end:** Task 6 step 6 now sets `roundRecord.blocking` from the re-decision, the `reconcile-reject-all-high` test checks that the round's `blocking` equals the top-level `blocking`, and a fourth break-it test leaves it unset. Task 8 adds `readRunSnapshot` checks over the stage's own output for `reconcile-reject-all-low` and `reconcile-reject-all-high`. They sit in Task 8 rather than Task 6 because they need Task 8's projection change. Known blockers records the cause.
- **Accepted — A correctly rejected high finding can turn a pass into a block:** a new Assumptions entry states the consequence and the uneven treatment, Task 10 carries it into section 12, and Open decisions gains item 2 for the operator to acknowledge it, plus a note on item 1 that the first paid run is its first measurement. The design is unchanged, because it follows from the operator's "before fixes only" choice.
- **Accepted — A failed reconciler dispatch looks like a failed remediation in the audit; What `code_review.reconcile.done` records per call:** Task 6 step 4 now records `calls=<status>,<status>`, the `exit` and `prose` tests assert `calls=failed` and `calls=unparsed`, and Known blockers and the hazards list (hazard 2) record why.
- **Accepted — The 2-of-2 rule assumes the two calls are independent:** "independent" is removed from the Source line and the hazard-7 entry, and the hazard-14 entry states that the calls are not shown to be independent samples, so the rule's protection is unmeasured.
- **Accepted — The dashboard's stage settings miss the new setting:** Task 8 adds `code-review-reconciler` to `STAGE_SETTINGS.code_review`, with a test using a distinct override pair and a break-it test. The seeded pair duplicates the panel's, so the existing assertion does not change.
- **Accepted — Per-agent costs fold the reconciler into the implementer:** Task 8's legend states it, following the `reconciler` precedent.
- **Accepted — Task 10 misses a cost sentence:** Task 10 now updates the `driver.mjs` bullet in `CLAUDE.md` and `AGENTS.md` and the cost paragraph in `.claude/skills/run-buildworks/SKILL.md` (eight or nine dispatches on the remediated path).
- **Accepted — The copied prompt carries a crew-chatter example:** Task 4's doc comment states that the example stays on purpose and why that is harmless.
- **Accepted — The reject audit embeds free text:** Task 6 step 3 keeps the excerpt as the last field.
- **Accepted — The report does not explain an early decision:** `buildReport` adds the "decided as a final panel" sentence when nothing was kept.
- **Accepted — The dashboard wording for a finding that is both rejected and blocking:** checked `src/dashboard/app.js`. The card renders "Disposition" and "Final panel" as separate rows, and Task 8 now says to keep both.
- **Accepted — Open decisions line on missing live data for an out-of-spec high finding:** merged into Open decisions item 1.
- **Accepted — Replay note that #200 was medium:** the Replay section now says so and limits the claim to run 6.
