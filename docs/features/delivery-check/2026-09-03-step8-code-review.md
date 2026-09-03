# Step 8 delivery check — code review

**Reviewed work:** commits `1890503..36a726d` (plan Tasks 1-6 plus the
remediation of this review's own findings)
**Review type:** standalone (`/code-review ultra`, `configured_standalone`)
**Review date:** 2026-09-03
**Disposition date:** 2026-09-03
**Disposition:** 11 accepted (9 full, 2 narrow), 1 deferred, 0 rejected, 0 open
**Status:** reconciled

---

## Summary

The independent review read the full step-8 diff — spec and approval gates,
the implementation-to-verification handoff, the pure coverage module, the
delivery stage, the CLI wiring, the paid driver, and the test fixtures — and
verified its findings by mutating the shipped code and reproducing each
behaviour. It found no findings in the handoff contract, the coverage
module's set math, or the CLI surface, and twelve elsewhere; the sweep
reproduced several end to end through the real verification and delivery
stages. Every accepted finding's fix landed in `36a726d` with a named
regression, and each new guard was broken-and-restored against its test.

**Hazards considered:** 3 (finding F6 made the prompts state the run-document
rule the validator enforces; the prompt scan pins it), 4 (finding F5 is the
fixture-blindness class: every delivery fixture wrote a base equal to the
starting commit, so the range-anchoring regression the patch base exists to
catch was invisible — fixtures now reproduce the real chain's projections
commit), 5 (finding F1's in-range deletion certified a completed run with the
artifact absent, and F6's run-document declaration blocked terminally at the
last stage — both are completion-without-delivery shapes the stage's design
intended to refuse), 14 (this review is `configured_standalone`, separately
spawned and billed). Entries 1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 15, and 16 do
not bear: the stage still parses no model output into a new shape (1),
retains records on both outcomes (2), adds no promise (6), no retry loop (7),
no new spawn semantics beyond the shared git helper (8, 9), matches nothing
against model output (10), the default paid workflow is unchanged in shape
(11), no new configuration (12), no obligation (13), no sandbox claim (15),
and no finding targets an artifact this plan does not change (16).

## Verdict

The diff was ready after remediation. Eleven of twelve findings were fixed or
narrowed in scope within the plan's files; the twelfth is a deferred
extraction. Findings and dispositions:

## Findings and dispositions

1. **F1 — critical — a deletion counts as delivered.** `git diff --name-only`
   lists a deleted path; nothing proved the artifact exists at the verified
   commit, so an in-range deletion completed the run with the declared file
   absent (renames flipped on repository configuration).
   **Accepted.** Delivery now requires every declared artifact to exist as a
   file in the verified commit's tree (`ls-tree` per path). Regressions:
   in-range deletion blocks naming the path; modify-in-range of an
   existing-at-starting file delivers. Guard broken-and-restored.
2. **F2 — high — base equal to the starting commit widens the certified
   range.** `merge-base --is-ancestor` answers yes to equality, so an edited
   record could set the base to the starting commit and pull the run's own
   projections commit into the delivered range.
   **Accepted.** Strict descent: a base equal to the signed starting commit
   refuses by name. Guard broken-and-restored.
3. **F3 — high — the terminal duration refusal is a permanent wedge.** A
   run crossing the frozen duration limit between verify and deliver can
   never reach `completed` or `blocked`, with no CLI path out.
   **Accepted, narrow.** The check stays (it is the approved plan's check and
   matches verification's own ceiling enforcement); the refusal now names the
   repair — the run is stale by the policy frozen at run start, every stage
   refuses it, and a fresh run is the repair with the branch, worktree, and
   verification evidence retained. The architectural question of whether the
   ceiling should bind cost-free stages at all is recorded as deferred with
   the step-9 milestone as its trigger.
4. **F4 — medium — a lost verification record wedges the run
   indistinguishably from tampering.** The record file is unchained and
   cannot be regenerated (`bw verify` refuses a stage that exists).
   **Accepted, narrow.** A missing record now gets its own named refusal
   distinct from an invalid one, each naming the repair. Guard
   broken-and-restored.
5. **F5 — high — no fixture exercises the pre-base projections commit.**
   Every delivery fixture wrote base == starting commit, so a regression
   diffing from the starting commit instead of the recorded base passed the
   whole suite, and the strict-descent refusal branch was unreachable.
   **Accepted.** `withDeliveryRun` and the CLI walk now commit the spec and
   plan projections before the patch, making every fixture the real chain's
   shape; a new test declares a projection path and blocks, which the
   starting-commit-anchoring regression would fail.
6. **F6 — high — declaring the run's own documents is legal and
   undeliverable.** `design.md` (protected) and `spec.md`/`plan.md`
   (projections committed pre-base) can never appear in the patch range, so a
   spec declaring one passed every gate and blocked terminally at delivery.
   **Accepted.** The names refuse at spec writes and again at the approval
   binding; the spec prompts state the rule (hazard 3); regressions cover the
   unit, draft, revision-introduced, and binding paths. Guard
   broken-and-restored.
7. **F7 — medium — ENOBUFS masquerades as a git failure.** The 1 MiB spawn
   buffer kills the changed-path listing on very large runs and the error
   channel was never read, producing a permanent misattributed refusal.
   **Accepted.** The delivery helper reads the spawn error and raises the
   output ceiling to 64 MiB. Not break-tested (needs >64 MiB of path names);
   the reviewer's empirical reproduction at 1,114,112 bytes is the evidence
   for the original defect.
8. **F8 — medium — a run can complete without verification's gate event.**
   Verification completes its stage and appends the event as separate
   writes, so a crash between them left a passed stage with no audit record,
   and delivery never required the event.
   **Accepted.** Delivery refuses a passed verification stage whose
   `verification.gate.pass` event is absent, so no run completes over an
   audit that does not record verification passing. Guard broken-and-restored.
9. **F9 — low — the delivery record mislabels its writer.** The record's
   stage id was the input (verification) stage, unlike every sibling record.
   **Accepted.** The record is written inside the final transaction after the
   stage insert and carries the delivery stage's own id; the pass-path test
   pins it.
10. **F10 — low — the untracked-tolerance comment misdescribes the system.**
    Verification refuses any post-command dirt, untracked included, so the
    "commands may leave them" premise was false.
    **Accepted.** Comment and test name now state the real case: only files
    appearing between verify and deliver can be untracked, and they are
    tolerated because they cannot enter the branch.
11. **F11 — medium — the driver's evidence gate checked only internal
    consistency.** The documented claim "the delivery record covers every
    signed artifact" was not implemented: the record's declared set was never
    compared with the signed approval scope.
    **Accepted.** The driver now reads `approval.scope` from the store and
    compares it with the record's declared set.
12. **F12 — low — the third copy of the stage-local git helper drifts.**
    Three real implementations now exist, so the repo's extraction rule is
    satisfied, and the copies' error handling had already diverged.
    **Deferred.** Extraction touches `implementation-stage.ts` and
    `verification-stage.ts` outside this plan's file scope. Trigger: the next
    stage added, or the next edit of either helper for its own reasons. F7
    made delivery's copy read the error channel in the meantime.

## Evidence

- Fixes: `36a726d` (11 files, 539 insertions).
- Break-and-restore (each mutation failed its named test, then restored
  green): strict descent, existence-at-head recomputation, gate-event
  presence, missing-record refusal, run-document refusal — plus the earlier
  sweep in Task 6 covering the exact-match rule, the patch-range diffing,
  the worktree HEAD check, the tracked-cleanliness check, and the record
  re-read, and the Task 1/2/4 cycles for the trailing-slash and directory
  refusals, the gate-event base, the parse migration, missing-artifact
  blocking, and the completed-run transition.
- Full suite 681/682 (one pre-existing skip), typecheck clean, driver smoke
  12/12, doc-check 0 errors / 36 warnings.
