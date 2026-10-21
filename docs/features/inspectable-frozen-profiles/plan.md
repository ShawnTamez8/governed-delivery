# Inspectable Frozen Profiles Implementation Plan

**Status:** Implemented

**Goal:** A completed run whose frozen profile predates a later execution-only profile field (such as `sandbox`) stays fully inspectable. `status`, the dashboard and `new-run --after` verify its delivery from its own hash-verified profile, while every execution path still refuses it by name.

**Source:**
- Observed 2026-10-20, crew-chatter: `new-run --after 7` refused with `--after: run 7's delivery record does not verify: run 7 cannot be executed: the frozen profile carries no sandbox …`. `status --run 7 --json` reports `phase: completed` but `deliveredCommit: null` and `finalReviewedCommit: null`. Run 7 completed on 2026-10-19, before the sandboxed implementer added `sandbox` to the profile (`docs/features/sandboxed-implementer/plan.md`).
- Operator, 2026-10-20: "lets do both". That meant start crew-chatter feature 3 without `--after` now (run 8), and plan this fix.
- The contract this restores, from `loadVerifiedProfile`'s comment in `src/profile.ts`: "Nothing that only reads the database, the retained evidence, or the audit chain comes through this function, so a refused run stays fully inspectable." `readRunSnapshot` (`src/operator-state.ts`) does come through it. `ARCHITECTURE.md` section 14 says `--after` reads the earlier run "through the same verified snapshot `status` uses". So the fix belongs in the snapshot, and `checkAfter` stays as it is.

**Hazards considered:**
- **5 (completion without delivery):** the link must still require a verified delivery record. This plan keeps every check `readRunSnapshot` makes before it sets `delivery.deliveredCommit`; it only stops an execution-only field from blanking them.
- **4 (fixtures and code agreeing):** the test's predecessor is written by the real verification, code-review and delivery stages (`withDeliveredRun`). The expected delivered commit is read from Git, and the live check reads run 7's own `delivery.gate.pass` event.
- **12 (configuration divergence):** an old profile still never executes. The refusal stays in `loadVerifiedProfile`, which every stage and `run-command` use. Every field the snapshot projects keeps its present-value validation, so a hash-matching profile still cannot put a value into `status --json` or the dashboard that breaks `RunConfiguration`.
- **Not engaged:** 1 to 3, 6 to 11 and 13 to 24. No prompt, model output, gate rule, retry, executor, sandbox mechanism, review panel or delivery rule changes.

**Assumptions:**
- **[Verified]** Run 7's profile hash-matches its `profile_ref`. The refusal is shape only: `loadVerifiedProfile` compares the hash before `invalidProfileReason`, and the observed reason is the shape refusal, not "has been modified since intake".
- **[Verified]** The snapshot reads only these profile fields:
  - `approvalSigner` and `startingCommit` (approval binding);
  - `policy` (`codeReviewMaxRounds`, `codeReviewBlockingSeverity`, `codeReviewPanelSize`, `severities`, `runDurationLimitSeconds`, the panel and specialty fields), `agents` and `executor` (code review through `parsePassedCodeReviewRecord`, `frozenGroupReasons` through `requireFrozenBinding`, and the run-age check);
  - `dispatchSettings` and `verification.commands` (the inspection block in `readRunSnapshot` and `runConfiguration`);
  - `narrationCheck` and `verification.derived`, which `runConfiguration` copies into the snapshot unchanged (`src/operator-state.ts:294,301`). Their optional chaining handles only absence, not a present value of the wrong shape, and the dashboard calls `.map` on `derivedArtifacts` (`src/dashboard/app.js:3448`). Both are therefore inspectable fields.

  Nothing in the snapshot reads `sandbox` or `after`, and neither `requireFrozenBinding` (`src/profile.ts`) nor `parsePassedCodeReviewRecord` (`src/code-review.ts`) reads either one. (`src/operator-state.ts`: `runConfiguration`, `readRunSnapshot`, `interpretBoundary`, `frozenGroupReasons`; the grep for `profile.` and `profile?.` in those files.)
- **[Verified]** Run 7's stored profile carries `after`, a non-null `narrationCheck` and a one-entry `verification.derived`, and lacks `sandbox` (read-only read of `C:\Repositories\testing-repos\crew-chatter\.governance\profiles\7\profile.json`, 2026-10-20). Every crew-chatter profile, runs 1 to 8, carries `after`.
- **[Verified during the build, correcting the line above]** Lacking `sandbox` is not run 7's only difference. Change 1 also removed the policy field `verifyEnvPassthrough` (`src/policy.ts` at `44a0d3a`), and runs 5, 6 and 7 all still carry it. The first refusal named only `sandbox` because that check runs first. The earlier line came from comparing top-level keys, not from running the predicate. Running `invalidInspectableProfileReason` on the stored profiles showed that this obsolete policy field is their only remaining difference. Their `policyHash` still describes their own policy.
- **Rule (operator, 2026-10-20):** a field added later is execution-only exactly when nothing on the snapshot path reads it: `readRunSnapshot`, `runConfiguration`, `interpretBoundary` and the helpers they call. Today that means `after` and `sandbox`, plus, from the live check, a policy field the current `Policy` no longer has (operator: "Extend the rule to policy"). Inspection tolerates such a field and still refuses a missing one; execution refuses both. The split below makes that a written rule in `src/profile.ts` and `src/policy.ts`, not a judgment call each time.
- **Limit:** a profile that fails an inspectable field stays uninspectable, by name, as today. That covers a policy frozen before a policy field existed, and crew-chatter runs 1 to 4, whose profiles carry no `verification.derived`. This plan does not reach those runs, because doing so would mean reading a superseded shape (hard rule 3).

**Approach:** Split `invalidProfileReason` into two predicates over the one profile schema. They are not two schemas: there is no default, no migration and no version field, so this stays within hard rule 3.
- `invalidInspectableProfileReason` covers the fields the snapshot reads.
- `invalidProfileReason` keeps its name and callers. It becomes the inspectable predicate plus the execution-only checks: `after`, `sandbox`, and the policy's exact shape. `invalidInspectablePolicyReason` in `src/policy.ts` tolerates an obsolete policy field; `invalidPolicyReason` still refuses it.

Add `loadInspectableProfile`, which runs `loadVerifiedProfile`'s hash comparison and then the inspectable predicate. It returns an `InspectableProfile`, a read-only type over the one stored schema with `after` and `sandbox` omitted (`Readonly<Omit<Profile, "after" | "sandbox">>`). The result therefore cannot reach a parameter that expects an executable `Profile`. This is a type over the same bytes, not a second schema, a union, a default or a migration. `loadVerifiedProfile` adds the execution-only predicate on top of it. In `readRunSnapshot`, evidence verification uses the inspectable profile. The `profile` it returns, which `run-command` executes and `doctor` reports, stays the executable one, and it stays `null` with the same `profileReason` when execution is refused.

**Affected areas:**
- **Modified:** `src/profile.ts` (`invalidProfileReason`, `loadVerifiedProfile`, `requireFrozenBinding`'s parameter type, plus the new `InspectableProfile`, `invalidInspectableProfileReason` and `loadInspectableProfile`), `src/operator-state.ts` (`readRunSnapshot`, and the parameter types of `runConfiguration`, `interpretBoundary` and `frozenGroupReasons`), `src/code-review.ts` (`parsePassedCodeReviewRecord`'s parameter type), and `src/policy.ts` (the new `invalidInspectablePolicyReason`, added during the build).
- **Tests:** `test/profile.test.ts`, `test/policy.test.ts`, `test/operator-state.test.ts`, `test/run-intake.test.ts` and `test/run-command.test.ts`.
- **Documents:** the `loadVerifiedProfile` comment, and this plan's record. `ARCHITECTURE.md` section 14 is already correct once the snapshot is fixed, so it does not change.

**Known blockers:** None in the repository. The PowerShell transport test in `test/cli-operator.test.ts` fails from the assistant's shell and passes in the operator's terminal (auto memory `powershell-transport-test-env-specific`). Read a failure there against that note before diagnosing it.

**Blast radius** (searched 2026-10-20):
- **`readRunSnapshot` callers:**
  - `src/cli.ts` (`doctor`: reads `snapshot`, `profile` and `profileReason`; `frozen_profile` fails when `profile` is null, which is unchanged);
  - `src/operator-read.ts` (`status` and the dashboard: `snapshot` only);
  - `src/guided-command.ts` (`snapshot` only);
  - `src/run-command.ts` (three calls; executes `observed.profile` and refuses when it is null, which is unchanged);
  - `src/run-intake.ts` (`checkAfter`: `snapshot` only).
- **`loadVerifiedProfile` callers:** every stage entry and `src/cli.ts`'s low-level commands (`approval-stage`, `spec-stage`, `spec-decision-stage`, `plan-stage`, `implementation-stage`, `verification-stage`, `code-review-stage`, `delivery-stage`). Its behaviour is unchanged.
- **`invalidProfileReason`** keeps its behaviour, so the existing shape tests in `test/profile.test.ts` (e.g. "carries no sandbox") still pass unchanged.
- **`requireFrozenBinding` and `parsePassedCodeReviewRecord`:** 11 call sites under `src/` pass them an executable `Profile`. Widening the parameter to `InspectableProfile` keeps every one of them assignable, and `npm run typecheck` proves it. Neither function reads `after` or `sandbox`.
- **Integration boundary:** the snapshot JSON that `status --json` and the dashboard emit. For an old-shape run it gains real `delivery.*` commits and `available` evidence marks, and `workflowAction` is still not eligible, with the same reason.

**Verification:**
- **Component:** the four test files above. Each new guard is proven by breaking it: copy the file, mutate it, watch the test fail, restore, and compare SHA-256.
- **Regression:** `npm run typecheck`, `npm run check:docs`, and the full serial no-engine suite (`DOCKER_HOST=tcp://127.0.0.1:1 node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`) with 0 failures and the named skips.
- **Live, free:** `status --run 7 --json` on crew-chatter reports `deliveredCommit` equal to the commit in run 7's `delivery.gate.pass` summary, and still lists the "cannot be executed" reason.

---

## Tasks

### Task 1: Split the profile predicate into inspectable and executable

**Depends on:** None.

**Files:**
- Modify: `src/profile.ts`: `invalidProfileReason`, `loadVerifiedProfile`, `requireFrozenBinding`; add `InspectableProfile`, `invalidInspectableProfileReason` and `loadInspectableProfile`.
- Modify: `src/code-review.ts`: `parsePassedCodeReviewRecord`.
- Modify: `test/profile.test.ts`.

**Steps:**
- Move every check of `invalidProfileReason` except the execution-only ones into a new exported `invalidInspectableProfileReason(profile: unknown): string | null`, in the same order and with the same messages. The execution-only checks are the `after` and `sandbox` presence and shape checks (the `"after" in p` and `isAfterLink` pair, and the `"sandbox" in p` and `invalidSandboxReason` pair). The `narrationCheck` presence and shape checks and the `verification.derived` array check stay in the inspectable predicate, because the snapshot projects both values. `invalidProfileReason` returns the inspectable reason when there is one, then runs the execution-only checks in their current order. Its messages and order for every input stay the same. One exception: an input failing both an inspectable and an execution-only check now reports the inspectable one. Today the order is `approvalSigner`, `after`, `narrationCheck`, `sandbox`, `frozenAt`, so a profile missing both `after` and `frozenAt` reports `after` now and will report `frozenAt` after the split. Search `test/` for assertions that depend on that order before changing it, and record what you find.
- Add a comment on both predicates stating the rule: a new frozen field belongs to the inspectable predicate when anything on the snapshot path reads or projects it (`readRunSnapshot`, `runConfiguration`, `interpretBoundary` and the helpers they call). Otherwise it is execution-only. A projected field keeps its present-value validation as well as its presence check.
- Export `type InspectableProfile = Readonly<Omit<Profile, "after" | "sandbox">>`, with a comment saying it is the read-only view of the one stored profile schema that the snapshot may use, not a second schema.
- Widen the `profile` parameter of `requireFrozenBinding` (`src/profile.ts`) and `parsePassedCodeReviewRecord` (`src/code-review.ts`) from `Profile` to `InspectableProfile`. Their bodies do not change.
- Move the profile-ref null check, `loadProfile` and the hash comparison out of `loadVerifiedProfile` into one private helper, `loadHashVerifiedProfile`, with their messages unchanged.
- Add `loadInspectableProfile(rootDir, run)`, returning `{ ok: true; profile: InspectableProfile; hash: string } | { ok: false; reason: string }`. It calls the helper, then `invalidInspectableProfileReason`. Its refusal reads `run <id> cannot be inspected: <reason>`.
- `loadVerifiedProfile` calls the helper, then the full `invalidProfileReason`, with today's "cannot be executed … must be replaced by a fresh one" message. It does not go through `loadInspectableProfile`. Every shape refusal it gives, inspectable or execution-only, therefore reads exactly as today. Two tests pin that wording for a policy-shape failure: "a correctly hashed pre-Task-3 profile is refused by name" in `test/profile.test.ts`, and `test/spec-stage.test.ts`'s superseded-policy test (`/cannot be executed/`). Both must pass unchanged.
- Update `loadVerifiedProfile`'s comment, which currently says nothing read-only comes through it, to name `loadInspectableProfile` as the read-only door.
- **Tests** (`test/profile.test.ts`):
  - A profile frozen by `freezeProfile` with `sandbox` deleted, rewritten and re-hashed into `profile_ref` passes `loadInspectableProfile`. `loadVerifiedProfile` refuses it with `/run 1 cannot be executed: the frozen profile carries no sandbox/`.
  - The same profile edited on disk without updating `profile_ref` is refused by both functions with "has been modified since intake".
  - A profile with `policy` deleted (and re-hashed) is refused by `loadInspectableProfile` with `cannot be inspected:` and the policy reason.
  - A present, malformed projected field is refused. A re-hashed profile whose `verification.derived` is `{}` is refused by `loadInspectableProfile` with `/cannot be inspected: the frozen profile carries no verification.derived/`. A re-hashed profile whose `narrationCheck` is `{}` is refused with `/cannot be inspected: the frozen profile narrationCheck must be null or/`.
- **Break-tests:**
  - Make `invalidInspectableProfileReason` also require `sandbox`; the first test fails.
  - Move the `verification.derived` array check from the inspectable predicate to the execution-only checks; the malformed-`derived` test fails.
  - Restore each and compare bytes.
- Verify: `node --test test/profile.test.ts test/spec-stage.test.ts` and `npm run typecheck`. Expected: pass and clean, with the two pinned "cannot be executed" tests unchanged.

**Task completion evidence:** the passing tests, the two break-test failures, and the order-dependency search result.

### Task 2: Verify a snapshot's evidence against the inspectable profile

**Depends on:** Task 1.

**Files:**
- Modify: `src/operator-state.ts`: `readRunSnapshot`, `runConfiguration`, `interpretBoundary`, `frozenGroupReasons`.
- Modify: `test/operator-state.test.ts`, `test/run-intake.test.ts`, `test/run-command.test.ts`.

**Steps:**
- Change the profile parameter of `runConfiguration` to `InspectableProfile | null`, of `interpretBoundary` to `InspectableProfile | null`, and of `frozenGroupReasons` to `InspectableProfile`. Their bodies do not change.
- In `readRunSnapshot`, replace the single `loadVerifiedProfile` call:
  - `inspected = loadInspectableProfile(rootDir, run)`;
  - `executable = loadVerifiedProfile(rootDir, run)`.
  - `evidenceProfile` is `inspected.profile` when `inspected.ok`, else `null`.
  - The existing inspection block (the `runId`, `dispatchSettings` and `verification.commands` checks that set `profileReason`) runs against `evidenceProfile`, and a throw there nulls both profiles, as today.
  - `runConfiguration` and `interpretBoundary` receive `evidenceProfile`.
  - `profileReason` is `executable.ok ? null : executable.reason` (or the inspection block's reason). It is pushed to `limitations` and `workflowAction.reasons` exactly as now.
  - The function returns `profile: executable.ok ? executable.profile : null`. When `executable` is refused, the returned profile is `null` even though evidence used `evidenceProfile`.
- **The historical fixture.** Both helpers below insert the approval with `profileHash` set to the `profile_ref` of that moment, and `interpretBoundary` compares `approval.profile_hash` with `run.profile_ref` once a profile reaches it (`src/operator-state.ts:723`). Removing `sandbox` after the run completes therefore needs one test-only transformation that keeps every hash binding coherent:
  - delete `sandbox` from the completed run's `profile.json`;
  - rewrite it with `canonicalJson`;
  - set `profile_ref` to its sha256 with `store.setProfileRef`;
  - set the approval's `profile_hash` to the same hash with `store.exec("UPDATE approval SET profile_hash = ? WHERE run_id = ?", …)`. The "profile binding" case in `test/operator-state.test.ts` uses the same `UPDATE`.

  The approval then binds exactly the bytes under inspection, as run 7's does. These are temporary test stores only. Never edit a real stored run to produce this condition.
- **Tests:**
  - `test/run-intake.test.ts` (with `withDeliveredRun`): merge the delivered branch, then apply the historical-fixture transformation to the predecessor.
    - Before `createRunIntake`, `readRunSnapshot` on the predecessor reports exactly one entry in `workflowAction.reasons`: code `evidence_invalid`, reason matching `/cannot be executed: the frozen profile carries no sandbox/`. No evidence reference has availability `inconsistent`. This proves there is no approval or handoff mismatch.
    - `createRunIntake` with `after` then succeeds, and `profile.after.deliveredCommit` equals `git rev-parse HEAD` in the predecessor's worktree.
    - The two existing "no longer verifies" tests still pass unchanged.
  - `test/run-intake.test.ts`: the same predecessor with its `profile.json` edited and `profile_ref` not updated is refused with `/--after: run \d+'s delivery record does not verify: profile for run \d+ has been modified since intake/` and adds no run row.
  - `test/operator-state.test.ts`: build a completed run with the file's own `withBoundary(10, …)` (the source `withDeliveredRun` was copied from), then apply the historical-fixture transformation. `readRunSnapshot` returns:
    - `snapshot.delivery.deliveredCommit` and `finalReviewedCommit` equal to the worktree head;
    - `profile === null`;
    - `profileReason` matching `/cannot be executed: the frozen profile carries no sandbox/`;
    - `snapshot.workflowAction.eligible === false`, with `workflowAction.reasons` holding exactly that one `evidence_invalid` reason;
    - no evidence reference with availability `inconsistent`.
  - `test/operator-state.test.ts`: the same transformation without the approval `UPDATE` adds the approval-mismatch reason ("the recorded approval does not match this run's feature, frozen profile, starting commit, or signer binding"). This proves the binding check now reaches an old-shape run's approval.
  - `test/run-command.test.ts`: an in-progress run whose profile lacks `sandbox` (re-hashed) is refused by `run --yes` with `evidence_invalid` and that reason, and dispatches nothing. First search the file for an existing old-shape refusal test, and extend it if there is one. This is no-dispatch evidence, not the guard for the returned profile. `boundaryResult()` refuses on the ineligible boundary before `run-command` reads `observed.profile` (`src/run-command.ts:142-144`), so this test passes whichever profile the snapshot returns.
- **Break-tests:**
  - Return `evidenceProfile` as the snapshot's `profile`; the `operator-state` assertion `profile === null` fails.
  - Pass `executable`'s profile, not `evidenceProfile`, to `interpretBoundary`; the `--after` and snapshot tests fail.
  - Restore each and compare bytes.
- Verify: `node --test test/profile.test.ts test/operator-state.test.ts test/run-intake.test.ts test/run-command.test.ts` and `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the passing tests and the two break-test failures.

### Task 3: Free validation, the live read, and the records

**Depends on:** Task 2.

**Files:**
- Modify: this plan (Status and an implementation record), `docs/features/sandboxed-implementer/plan.md` (one dated line under its implementation record naming this fix), and `.claude/sessions/project-learnings.md`.

**Steps:**
- `npm run typecheck`, `npm run check:docs`, then the full serial no-engine suite in the background, then `git log -1`. Expected: 0 failures, the named skips unchanged, and the head unchanged.
- **Live, free:** run `node src/cli.ts status --repo C:\Repositories\testing-repos\crew-chatter --run 7 --json`, and read run 7's `delivery.gate.pass` summary from its store, read-only. Expected:
  - `deliveredCommit` and `finalReviewedCommit` are not null;
  - `deliveredCommit` equals the commit after `..` in that summary;
  - the limitations still include "run 7 cannot be executed".

  Do not run `new-run --after 7` against crew-chatter: it would create a run. The `--after` path is proven by Task 2's test.
- Record the result, set Status to `Implemented`, and add the dated line to the sandboxed-implementer plan's record.

**Task completion evidence:** the suite counts, the `status` output, and the records.

## Implementation record (2026-10-20)

**What shipped.** All three tasks were built as planned on `sandboxed-delivery` above `ff260eb`, in their own commit after change 1's. The changes:
- `src/profile.ts` gains `InspectableProfile`, `invalidInspectableProfileReason`, `loadInspectableProfile` and the private `loadHashVerifiedProfile`.
- `invalidProfileReason` is now the inspectable predicate followed by `after`, `sandbox` and the strict policy check.
- `src/policy.ts` gains `invalidInspectablePolicyReason`.
- `readRunSnapshot` verifies evidence against the inspectable profile, and it still returns the executable profile, or `null` with the execution refusal.
- `requireFrozenBinding`, `parsePassedCodeReviewRecord`, `runConfiguration`, `interpretBoundary` and `frozenGroupReasons` take `InspectableProfile`, and their bodies are unchanged.

**Deviation (operator decision).** The first live read still returned `deliveredCommit: null`, because run 7's policy carries `verifyEnvPassthrough`, which change 1 removed (see the corrected assumption above). The build stopped there and the operator chose "Extend the rule to policy". Inspection now tolerates a policy field the current `Policy` no longer has, and still refuses a missing one; execution refuses both. This added `src/policy.ts` and `test/policy.test.ts` to the change.

**Order-dependency search (Task 1).** No test in `test/` depends on the order of the shape checks: each test breaks one field of an otherwise valid profile. The order still changes in two cases. A profile that fails both an inspectable check and an execution-only check now names the inspectable one. A profile with an obsolete policy field that also fails another check now names that other check first, because the strict policy check runs last.

**Tests added:**
- `test/profile.test.ts`:
  - a sandbox-less profile is inspectable, and execution refuses it;
  - a pre-change-1 profile, with no `sandbox` and with `verifyEnvPassthrough`, is inspectable, and execution refuses each difference by name;
  - both doors refuse a tampered profile;
  - a missing policy, a malformed `derived: {}` and a malformed `narrationCheck: {}` are refused with "cannot be inspected".
- `test/policy.test.ts`: inspection tolerates an obsolete policy field.
- `test/run-intake.test.ts`:
  - `--after` accepts a pre-sandbox predecessor (exactly one reason, no inconsistent reference, delivered commit equal to `git rev-parse HEAD`);
  - `--after` refuses a tampered predecessor;
  - `--after` names a pre-sandbox predecessor's broken delivery record rather than its execution refusal.
- `test/operator-state.test.ts`: the completed old-shape snapshot keeps its delivery record with `profile === null`, and the approval binding is still checked.
- `test/run-command.test.ts`: `run --yes` refuses a run frozen before sandbox existed, by name, and dispatches nothing. The file had no old-shape refusal test to extend.

**Break-tests.** Each break-test copied the file, mutated it, ran the tests, restored the copy, and compared SHA-256; every restore was byte-identical.

| Mutation | Result |
| --- | --- |
| Inspectable predicate requires `sandbox` | 2 failures |
| `verification.derived` check moved to execution-only | malformed-`derived` test fails |
| Snapshot returns `evidenceProfile` as `profile` | operator-state `profile === null` fails; run-command passes, as the plan predicted |
| Executable profile passed to `interpretBoundary` | 3 failures |
| Strict policy check in the inspectable predicate | 4 failures |
| No policy check on the execution side | profile test fails |
| Execution refusal pushed before the boundary's reasons | the new run-intake test fails |

**Review.** An independent review found no high findings, one medium and three low.
- Medium, fixed: for an old-shape predecessor whose delivery evidence is also broken, `--after` named the execution refusal instead of the broken record. The snapshot now adds the execution refusal after `interpretBoundary`'s reasons, and only when that exact reason is not already there. The new run-intake test covers this case.
- Low, deferred: an old-shape run that is in progress at the approval boundary can list the execution refusal twice. Eligibility does not change, and no stored run is in that state.
- Low, fixed: the stale `loadVerifiedProfile` docstring.
- Low, fixed: a comment in `src/policy.ts` that overstated what the tolerance covers.

**Validation:**
- Task 1: `test/profile.test.ts` and `test/spec-stage.test.ts`, 126/126, with the two pinned "cannot be executed" tests unchanged.
- Task 2: the five files, 268/268.
- After the policy extension: 134/134.
- After the review fixes: the nine touched and dependent files, 372 tests, 368 pass, 0 fail, 4 skipped.
- `npm run typecheck` is clean.
- Full serial no-engine suite, first run: 1757 tests, 1738 pass, 1 fail, 18 skipped. The failure was `test/cli-operator.test.ts` "doctor retains the bounded read-only wait", a timing bound of under 5000 ms. It passed 3 of 3 in isolation (about 14 s per run).
- Full suite rerun after the review fixes: 1758 tests, 1740 pass, 0 fail, 18 skipped. HEAD is unchanged at `ff260eb`.

**Live, free.** `status --repo C:\Repositories\testing-repos\crew-chatter --run 7 --json` reports `deliveredCommit` and `finalReviewedCommit` as `c5d2ff361dfa9b364eb7985953f122490f65d98f`. That equals the commit after `..` in run 7's `delivery.gate.pass` summary (`887a6448…..c5d2ff36…`). The output lists 12 delivered paths and no inconsistent reference. Its only reason is "run 7 cannot be executed: the frozen profile carries no sandbox". `new-run --after 7` was not run.

## Rollback

Revert the four source files and the tests. The snapshot then refuses old-shape runs again, as before. No stored state, schema or frozen profile changes, so nothing needs restoring.
