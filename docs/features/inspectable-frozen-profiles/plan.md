# Inspectable Frozen Profiles Implementation Plan

**Status:** Proposed

**Goal:** A completed run whose frozen profile predates a later execution-only profile field (such as `sandbox`) stays fully inspectable. `status`, the dashboard and `new-run --after` verify its delivery from its own hash-verified profile, while every execution path still refuses it by name.

**Source:**
- Observed 2026-10-20, crew-chatter: `new-run --after 7` refused with `--after: run 7's delivery record does not verify: run 7 cannot be executed: the frozen profile carries no sandbox …`. `status --run 7 --json` reports `phase: completed` but `deliveredCommit: null` and `finalReviewedCommit: null`. Run 7 completed on 2026-10-19, before the sandboxed implementer added `sandbox` to the profile (`docs/features/sandboxed-implementer/plan.md`).
- Operator, 2026-10-20: "lets do both". That meant start crew-chatter feature 3 without `--after` now (run 8), and plan this fix.
- The contract this restores, from `loadVerifiedProfile`'s comment in `src/profile.ts`: "Nothing that only reads the database, the retained evidence, or the audit chain comes through this function, so a refused run stays fully inspectable." `readRunSnapshot` (`src/operator-state.ts`) does come through it. `ARCHITECTURE.md` section 14 says `--after` reads the earlier run "through the same verified snapshot `status` uses". So the fix belongs in the snapshot, and `checkAfter` stays as it is.

**Hazards considered:**
- **5 (completion without delivery):** the link must still require a verified delivery record. This plan keeps every check `readRunSnapshot` makes before it sets `delivery.deliveredCommit`; it only stops an execution-only field from blanking them.
- **4 (fixtures and code agreeing):** the test's predecessor is written by the real verification, code-review and delivery stages (`withDeliveredRun`). The expected delivered commit is read from Git, and the live check reads run 7's own `delivery.gate.pass` event.
- **12 (configuration divergence):** an old profile still never executes. The refusal stays in `loadVerifiedProfile`, which every stage and `run-command` use.
- **Not engaged:** 1 to 3, 6 to 11 and 13 to 24. No prompt, model output, gate rule, retry, executor, sandbox mechanism, review panel or delivery rule changes.

**Assumptions:**
- **[Verified]** Run 7's profile hash-matches its `profile_ref`. The refusal is shape only: `loadVerifiedProfile` compares the hash before `invalidProfileReason`, and the observed reason is the shape refusal, not "has been modified since intake".
- **[Verified]** The snapshot's evidence checks read only these profile fields:
  - `approvalSigner` and `startingCommit` (approval binding);
  - `policy` (`codeReviewMaxRounds`, `codeReviewBlockingSeverity`, `codeReviewPanelSize`, `severities`, `runDurationLimitSeconds`), `agents` and `executor.id` (code review and the run-age check);
  - `dispatchSettings` and `verification.commands` (the inspection block in `readRunSnapshot` and `runConfiguration`).

  `runConfiguration` reads `narrationCheck`, `verification.derived` and the rest through optional chaining with a `null` fallback, and nothing in the snapshot reads `sandbox` or `after`. (`src/operator-state.ts`: `runConfiguration`, `readRunSnapshot`, `interpretBoundary`; the grep for `profile.` and `profile?.` in that file.)
- **[Assumption]** A field added later is execution-only exactly when the snapshot does not read it. The split below makes that a written rule in `src/profile.ts`, not a judgment call each time.
- **Limit:** a profile that fails an inspectable field stays uninspectable, by name, as today. That covers a policy frozen before a policy field existed. This plan does not reach those runs, because doing so would mean reading a superseded shape (hard rule 3).

**Approach:** Split `invalidProfileReason` into two predicates over the one profile schema. They are not two schemas: there is no default, no migration and no version field, so this stays within hard rule 3.
- `invalidInspectableProfileReason` covers the fields the snapshot reads.
- `invalidProfileReason` keeps its name and callers. It becomes the inspectable predicate plus the execution-only fields: `after`, `narrationCheck`, `sandbox` and `verification.derived`.

Add `loadInspectableProfile`, which runs `loadVerifiedProfile`'s hash comparison and then the inspectable predicate. `loadVerifiedProfile` adds the execution-only predicate on top of it. In `readRunSnapshot`, evidence verification uses the inspectable profile. The `profile` it returns, which `run-command` executes and `doctor` reports, stays the executable one, and it stays `null` with the same `profileReason` when execution is refused.

**Affected areas:**
- **Modified:** `src/profile.ts` (`invalidProfileReason`, `loadVerifiedProfile`, plus the new `invalidInspectableProfileReason` and `loadInspectableProfile`) and `src/operator-state.ts` (`readRunSnapshot`).
- **Tests:** `test/profile.test.ts`, `test/operator-state.test.ts`, `test/run-intake.test.ts` and `test/run-command.test.ts`.
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
- Modify: `src/profile.ts`: `invalidProfileReason`, `loadVerifiedProfile`; add `invalidInspectableProfileReason` and `loadInspectableProfile`.
- Modify: `test/profile.test.ts`.

**Steps:**
- Move every check of `invalidProfileReason` except the execution-only ones into a new exported `invalidInspectableProfileReason(profile: unknown): string | null`, in the same order and with the same messages. The execution-only checks are the `after`, `narrationCheck` and `sandbox` presence and shape checks, and the `verification.derived` array check. `invalidProfileReason` returns the inspectable reason when there is one, then runs the execution-only checks in their current order. Its messages and order for every input stay the same. One exception: an input failing both an inspectable and an execution-only check now reports the inspectable one. Today the order is `approvalSigner`, `after`, `narrationCheck`, `sandbox`, `frozenAt`, so a profile missing both `after` and `frozenAt` reports `after` now and will report `frozenAt` after the split. Search `test/` for assertions that depend on that order before changing it, and record what you find.
- Add a comment on both predicates stating the rule: a new frozen field belongs to the inspectable predicate only when `readRunSnapshot` or `interpretBoundary` reads it. Otherwise it is execution-only.
- Move the profile-ref null check, `loadProfile` and the hash comparison out of `loadVerifiedProfile` into one private helper, `loadHashVerifiedProfile`, with their messages unchanged.
- Add `loadInspectableProfile(rootDir, run)`, with the same return type as `loadVerifiedProfile`. It calls the helper, then `invalidInspectableProfileReason`. Its refusal reads `run <id> cannot be inspected: <reason>`.
- `loadVerifiedProfile` calls the helper, then the full `invalidProfileReason`, with today's "cannot be executed … must be replaced by a fresh one" message. It does not go through `loadInspectableProfile`. Every shape refusal it gives, inspectable or execution-only, therefore reads exactly as today. Two tests pin that wording for a policy-shape failure: "a correctly hashed pre-Task-3 profile is refused by name" in `test/profile.test.ts`, and `test/spec-stage.test.ts`'s superseded-policy test (`/cannot be executed/`). Both must pass unchanged.
- Update `loadVerifiedProfile`'s comment, which currently says nothing read-only comes through it, to name `loadInspectableProfile` as the read-only door.
- **Tests** (`test/profile.test.ts`):
  - A profile frozen by `freezeProfile` with `sandbox` deleted, rewritten and re-hashed into `profile_ref` passes `loadInspectableProfile`. `loadVerifiedProfile` refuses it with `/run 1 cannot be executed: the frozen profile carries no sandbox/`.
  - The same profile edited on disk without updating `profile_ref` is refused by both functions with "has been modified since intake".
  - A profile with `policy` deleted (and re-hashed) is refused by `loadInspectableProfile` with `cannot be inspected:` and the policy reason.
- **Break-test:** make `invalidInspectableProfileReason` also require `sandbox`; the first test fails. Restore and compare bytes.
- Verify: `node --test test/profile.test.ts test/spec-stage.test.ts` and `npm run typecheck`. Expected: pass and clean, with the two pinned "cannot be executed" tests unchanged.

**Task completion evidence:** the passing tests, the break-test failure, and the order-dependency search result.

### Task 2: Verify a snapshot's evidence against the inspectable profile

**Depends on:** Task 1.

**Files:**
- Modify: `src/operator-state.ts`: `readRunSnapshot`.
- Modify: `test/operator-state.test.ts`, `test/run-intake.test.ts`, `test/run-command.test.ts`.

**Steps:**
- In `readRunSnapshot`, replace the single `loadVerifiedProfile` call:
  - `inspected = loadInspectableProfile(rootDir, run)`;
  - `executable = loadVerifiedProfile(rootDir, run)`.
  - `evidenceProfile` is `inspected.profile` when `inspected.ok`, else `null`.
  - The existing inspection block (the `runId`, `dispatchSettings` and `verification.commands` checks that set `profileReason`) runs against `evidenceProfile`, and a throw there nulls both profiles, as today.
  - `runConfiguration` and `interpretBoundary` receive `evidenceProfile`.
  - `profileReason` is `executable.ok ? null : executable.reason` (or the inspection block's reason). It is pushed to `limitations` and `workflowAction.reasons` exactly as now.
  - The function returns `profile: executable.ok ? executable.profile : null`. When `executable` is refused, the returned profile is `null` even though evidence used `evidenceProfile`.
- **Tests:**
  - `test/run-intake.test.ts` (with `withDeliveredRun`): merge the delivered branch, then delete `sandbox` from the predecessor's `profile.json`, rewrite it canonically and set `profile_ref` to the new hash (as `withDeliveredRun` already does with `setProfileRef`). `createRunIntake` with `after` then succeeds, and `profile.after.deliveredCommit` equals `git rev-parse HEAD` in the predecessor's worktree. The two existing "no longer verifies" tests still pass unchanged.
  - `test/run-intake.test.ts`: the same predecessor with its `profile.json` edited and `profile_ref` not updated is refused with `/--after: run \d+'s delivery record does not verify: profile for run \d+ has been modified since intake/` and adds no run row.
  - `test/operator-state.test.ts`: build a completed run with the file's own `withBoundary(10, …)` (the source `withDeliveredRun` was copied from), then remove `sandbox` from its profile and re-hash it as above. `readRunSnapshot` returns:
    - `snapshot.delivery.deliveredCommit` and `finalReviewedCommit` equal to the worktree head;
    - `profile === null`;
    - `profileReason` matching `/cannot be executed: the frozen profile carries no sandbox/`;
    - `snapshot.workflowAction.eligible === false`.
  - `test/run-command.test.ts`: an in-progress run whose profile lacks `sandbox` (re-hashed) is refused by `run --yes` with `evidence_invalid` and that reason, and dispatches nothing. First search the file for an existing old-shape refusal test, and extend it if there is one.
- **Break-tests:**
  - Return `evidenceProfile` as the snapshot's `profile`; the `run-command` test fails.
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

## Rollback

Revert the two source files and the tests. The snapshot then refuses old-shape runs again, as before. No stored state, schema or frozen profile changes, so nothing needs restoring.
