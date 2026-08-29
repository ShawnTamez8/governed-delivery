# Approval Gate Hardening Implementation Plan

**Status:** Proposed

**Goal:** Close all twelve findings the step-4 code review left unfixed, so the human approval gate binds the specification a panel actually reviewed, refuses malformed and impossible inputs by name, keeps signing material outside the repository under symlink and junction attack, and commits an approval atomically.

**Source:** The step-4 review findings recorded in the `step4-open-findings` memory (ten open, two accepted-and-deferred by operator decision) and the narrative in `.claude/sessions/project-learnings.md` (the three step-4 entries); `ARCHITECTURE.md` sections 6 (trust boundaries), 9 (risk sizes the panel), 12 (gates, the profile, the scope), 15 (evidence model), 16 (audit), 17 (security and secret handling), 19 (concurrency and resume); `docs/hazards.md` entries 4 and 14; `CLAUDE.md`.

**Assumptions:**

- **The reviewed spec is bound through the audit chain, not a new column.** Finding 3 needs the approval to bind what the panel actually gated. `ARCHITECTURE.md` section 15's `stage` table has no column for a spec hash or a risk, and `test/schema.test.ts` compares migration columns against that block, so adding one would mean editing the design document. The audit chain is already append-only and hash-chained (section 16), which is a stronger place to read a historical fact from than a mutable column. The `spec.gate.pass` event therefore carries a machine-readable `specHash=` and `risk=`, and the approval gate reads them back. **Rejected alternative:** a `stage.spec_hash` column — it churns the schema, requires an `ARCHITECTURE.md` edit, and stores a derived value the audit already records.
- **Risk is computed from the deduplicated scope on both sides.** Findings 3 and 9 are one defect seen twice: `src/spec-stage.ts` sizes the panel from `declaredArtifacts.length` (raw) while `computeScope` deduplicates. They must use the same number, or the risk the panel satisfied and the risk the operator signs can differ for a spec that lists a path twice. Both sides move to `computeScope(...).length`.
- **The signer fingerprint is frozen only when a key is configured at run start.** Freezing it unconditionally would make `bw new-run` fail on every machine without a key, breaking every existing CLI test. The profile records `approvalSigner: string | null`; when non-null the gate requires a match, when null it keeps today's behaviour and the audit event says so. This is a partial guarantee and the plan labels it as one rather than implying the stronger property.
- **Transaction nesting is solved by making `Store.transaction` re-entrant**, not by adding non-transactional duplicates of `insertStage` and `appendAudit`. A depth counter is the smallest change that lets `approveRun` commit its writes as one unit, and it removes the same latent hazard everywhere else in the codebase.
- **Impossible dates are caught by a round-trip comparison.** `Date.parse("2026-02-30T00:00:00.000Z")` returns a valid timestamp — verified at the shell, it rolls into March — so the existing regex plus `Number.isNaN` cannot reject it. Re-serializing the parsed instant and comparing against the input is the check.
- **Containment uses `realpathSync` on the nearest existing ancestor.** A junction or symlink pointing into the repository defeats the lexical `relative()` test (findings 11 and 12). A `keygen --out` target usually does not exist yet, so the helper resolves the closest ancestor that does and rejoins the unresolved tail.
- **No API spend.** Every fix in this plan is deterministic; no test dispatches the `claude` binary and no test makes a network call.

**Approach:** One task per finding, ordered so coupled defects land together and shared machinery lands before its consumers. Each task follows the repository's break-it discipline: write or extend the test, confirm it fails against the current code, apply the fix, confirm it passes. Findings 3 and 9 are fixed as one task because they are the same miscount; findings 11 and 12 are one task because they share a containment helper; the two accepted-deferred findings land last because the trust-anchor freeze extends the profile and the atomicity fix touches step-1 code that everything else depends on.

**Affected areas:** `src/approval.ts` (expiry, payload safety, containment), `src/approval-stage.ts` (bound-spec check, `change_kind` re-check, atomic commit, frozen signer), `src/spec-stage.ts` (risk from deduplicated scope, machine-readable gate event, run-status guard), `src/profile.ts` (sha256 object format, frozen signer), `src/scope.ts` (the shared containment helper), `src/store.ts` (re-entrant transactions, `feature_id` validation), `src/cli.ts` (`new-run` freeze-failure diagnostic), `scripts/sign-approval.mjs` (`--key` containment); tests for each. `ARCHITECTURE.md` is **not** modified by this plan.

**Known blockers:**

- **The `spec.gate.pass` summary is currently prose** — `spec_review gate passed in round ${round}` at [spec-stage.ts:258](src/spec-stage.ts#L258). Task 3 changes it to carry structured fields. Nothing has shipped to a user so no migration is owed, but a developer's existing `.governance/state.db` holds events in the old shape, and the gate must refuse those by name rather than approve past them.
- **Changing that summary does not break the audit chain.** `contentOf` in [audit.ts](src/audit.ts) hashes the summary as stored and `verifyAuditChain` recomputes from stored rows, so events written earlier still verify. Verified by reading the function.
- **Hazard 4 governs every task:** each fix gets a break-it run and the test must be seen failing against the unfixed code first. The step-4 entries in `.claude/sessions/project-learnings.md` record two occasions where a test that passed on first write proved nothing.
- **The step-4 shell-boundary lesson applies to Task 8.** `test/sign-approval.test.ts` feeds `spawnSync`'s `input` byte-exactly, which bypasses the shell the operator types into. A containment test must use the path form a user would supply.
- **Creating a junction or symlink may require privilege.** On Windows `fs.symlinkSync` for a directory needs Developer Mode or elevation; `mklink /J` does not. Task 8 uses a junction on Windows and a symlink elsewhere, and **fails loudly** if neither can be created rather than skipping — a containment guard that is never exercised is the one most likely to be wrong.
- **`git init --object-format=sha256` requires git 2.29 or newer.** Task 7 asserts the init succeeded, so an older git fails the test rather than skipping it.

**Blast radius** (verified by import search across `src/**` and `test/**`):

- `src/store.ts` — imported by `src/audit.ts`, `src/cli.ts`, `src/dispatch.ts`, `src/spec-stage.ts`, `src/approval-stage.ts`, and six test files. Task 10 changes `transaction`'s internals without changing its signature, so every caller compiles unchanged. `insertRun` gains a `feature_id` validation that can reject input it previously accepted; the existing fixtures use `f-1` and `f`, both of which satisfy the new pattern (verified by reading `test/store.test.ts`, `test/cli.test.ts`, `test/spec-stage.test.ts`, and `test/approval-stage.test.ts`).
- `src/spec-stage.ts` — imported by `src/cli.ts` and `test/spec-stage.test.ts`. Tasks 3 and 5 change one audit summary, one `computeRisk` argument, and add one guard.
- `src/approval.ts` — imported by `src/approval-stage.ts`, `src/cli.ts`, `test/approval.test.ts`, `test/sign-approval.test.ts`. `validateExpiry`, `approvalPayload`, and `resolvePublicKeyPath` gain refusals; no signature changes.
- `src/profile.ts` — imported by `src/cli.ts`, `src/approval-stage.ts`, `test/profile.test.ts`, `test/cli.test.ts`. Task 9 adds one field to `Profile`, which changes every frozen profile's hash. Harmless: profiles are machine-local and regenerated per run, and no fixture pins a literal hash — `test/profile.test.ts` and `test/cli.test.ts` both compute the expected hash in-test from the bytes they just read.
- `src/scope.ts` — imported by `src/spec-stage.ts`, `src/approval-stage.ts`, `test/scope.test.ts`, and (after Task 8) `src/approval.ts` and `scripts/sign-approval.mjs`. Adding an exported helper affects no existing caller.
- `scripts/sign-approval.mjs` — spawned by `test/sign-approval.test.ts` only. It already imports `normalizeText` from `src/canonical.ts`, so importing a helper from `src/` is established precedent.
- No consumer of the approval gate exists yet; build order step 5 is the next caller and is planned separately in `docs/features/plan-stage/plan.md`.

**Verification:** `npm run typecheck`, `npm test`, `npm run check:docs`. Completion gate: `npm ci && npm run typecheck && npm test && npm run check:docs` from a clean checkout, plus every break-it run recorded as an observed failure and restoration. The suite stands at 212 passing tests before this plan.

---

### Task 1: `validateExpiry` refuses impossible dates

**Depends on:** None

**Files:**
- Modify: `src/approval.ts` — `validateExpiry`
- Modify: `test/approval.test.ts` — expiry coverage

**Steps:**

- [x] **Step 1: the failing test first**
  - Change: Add to `test/approval.test.ts` a case asserting `validateExpiry("2026-02-30T00:00:00.000Z", now, 86400)` is refused with the malformed-timestamp message, and the same for `"2026-02-29T00:00:00.000Z"` (2026 is not a leap year). Both currently pass validation: `Date.parse` returns a real timestamp that has silently rolled into March.
  - Verify: `node --test test/approval.test.ts`
  - Expected: the new case **fails** against the current code. Record this.

- [x] **Step 2: the round-trip check**
  - Change: In `validateExpiry`, after `Date.parse` succeeds, re-serialize and compare. Build `const round = new Date(at).toISOString()`; when the input matched the no-milliseconds branch of `ISO_UTC`, compare against the input with `.000` inserted before the `Z`, otherwise against the input itself. On mismatch return the existing `--expires must be an ISO 8601 UTC timestamp such as 2026-08-30T12:00:00.000Z, got ${expiresAt}` refusal — from the operator's side an impossible date is a malformed one, and inventing a second message for it would mean two strings to keep in step.
  - Verify: `node --test test/approval.test.ts`
  - Expected: all pass, including the existing at-the-ceiling and expired cases.

**Task completion evidence:** the impossible-date cases fail before the fix and pass after; `2026-02-28T00:00:00Z` (no milliseconds) still validates, proving the normalization did not break the shorter form.

### Task 2: payload fields cannot forge a payload line

**Depends on:** None

**Files:**
- Modify: `src/approval.ts` — `approvalPayload`
- Modify: `src/store.ts` — `insertRun`
- Modify: `test/approval.test.ts`, `test/store.test.ts`

**Steps:**

- [x] **Step 1: the failing test first**
  - Change: In `test/approval.test.ts`, assert that a binding whose `featureId` is `"f-1\nrisk: low"` is refused by `approvalPayload`. Today it is interpolated raw, producing a payload carrying two `risk:` lines that still signs and verifies — the operator reads one risk and a parser could take the other.
  - Verify: `node --test test/approval.test.ts`
  - Expected: **fails** against the current code. Record this.

- [x] **Step 2: refuse at the payload builder**
  - Change: `approvalPayload` throws `approval payload field ${name} contains a line break or control character: ${JSON.stringify(value)}` when `featureId`, `specHash`, `startingCommit`, `profileHash`, `risk`, `expiresAt`, or any scope entry matches the control-character class `/[\u0000-\u001f\u007f]/` (write it with escapes, never literal bytes). A throw rather than a result union: every field is machine-derived by the time it reaches here, so a control character means an upstream validation hole, not operator error.
  - Verify: `node --test test/approval.test.ts`
  - Expected: passes.

- [x] **Step 3: refuse at the source**
  - Change: `src/store.ts`'s `insertRun` validates `featureId` against `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`, throwing `invalid feature_id ${featureId}: must be 1-64 characters of letters, digits, dot, underscore, or hyphen, starting with a letter or digit`. This mirrors the `slug` validation immediately above it. `project` is deliberately not validated: it never enters the payload.
  - Verify: `node --test test/store.test.ts test/cli.test.ts test/spec-stage.test.ts test/approval-stage.test.ts`
  - Expected: all pass — every existing fixture uses `f-1` or `f`.

- [x] **Step 4: cover the refusal**
  - Change: `test/store.test.ts` asserts `insertRun` refuses a `featureId` containing a newline and one of 65 characters, each naming the rule.
  - Verify: `node --test test/store.test.ts`
  - Expected: passes.

**Task completion evidence:** the forged-line test fails before the fix; afterwards the store refuses the input and the payload builder refuses the value, so neither layer alone is load-bearing.

### Task 3: the authorization binds the specification the panel gated

**Depends on:** None

**Files:**
- Modify: `src/spec-stage.ts` — the `computeRisk` call and the `spec.gate.pass` event
- Modify: `src/approval-stage.ts` — `buildBinding`
- Modify: `test/spec-stage.test.ts`, `test/approval-stage.test.ts`, `test/scope.test.ts`

This task closes findings 3 and 9 together: they are the same miscount seen at two boundaries.

**Steps:**

- [x] **Step 1: risk from the deduplicated scope, on both sides**
  - Change: In `src/spec-stage.ts` the `computeRisk` call at [spec-stage.ts:150](src/spec-stage.ts#L150) takes `computeScope(written.doc.declaredArtifacts).length` instead of `written.doc.declaredArtifacts.length`, importing `computeScope` from `./scope.ts` — the file already imports `touchesProtected` from there. Make the identical change in `src/approval-stage.ts`'s `buildBinding`, which currently passes `doc.value.declaredArtifacts.length`. Both sides must count the same set, or the risk the panel satisfied and the risk the operator signs diverge.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 2: prove the miscount mattered**
  - Change: Add a case to `test/scope.test.ts` asserting that a declared-artifact list of eleven entries containing two duplicates produces the same risk as its nine distinct paths, rather than the higher band the raw count of eleven would produce. The `declaredArtifactCount > 10` term in `computeRisk` is what makes this observable.
  - Verify: `node --test test/scope.test.ts`
  - Expected: passes with the fix. Revert the argument to the raw length, confirm this case fails, restore. Record the break-it run.

- [x] **Step 3: the gate event carries what it gated**
  - Change: The passing-gate audit call in `src/spec-stage.ts` becomes `audit(reviewStage.id, "spec.gate.pass", \`spec_review gate passed in round ${round}; specHash=${sha256Hex(normalizeText(specContent))}; risk=${risk}\`)`, importing `sha256Hex` and `normalizeText` from `./canonical.ts`. `specContent` is the variable already holding the content this round's panel reviewed; `risk` is the value from Step 1. Normalizing before hashing matches the gate side, which hashes `normalizeText(content)` — if only one side normalized, a CRLF checkout would break every approval.
  - Verify: `node --test test/spec-stage.test.ts`
  - Expected: the suite passes. If an existing assertion matches the old summary verbatim, update it to the new format rather than weakening it to a substring match.

- [x] **Step 4: the gate reads it back and refuses a mismatch**
  - Change: In `buildBinding`, after the spec validates, read the run's most recent gate event with `SELECT * FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1` and extract both fields with `/specHash=([0-9a-f]{64}); risk=(low|standard|high)/`. Refuse with:
    - `run ${runId} has no spec.gate.pass audit event: the spec_review gate never recorded what it approved` when no row matches;
    - `run ${runId}'s spec.gate.pass event does not record a spec hash and risk` when a row exists but the pattern does not match — this is the path a database written before this change takes;
    - `the spec has changed since review: gated ${gatedHash}, on disk ${specHash}` when the hashes differ;
    - `risk has changed since review: the panel was sized for ${gatedRisk}, the spec now computes ${risk}` when the risks differ.
  - Change: The binding still carries the **recomputed** `specHash` and `risk`, not the gated ones. The comparison is the guard; recomputation stays the source, so the two cannot silently diverge again.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [x] **Step 5: cover every refusal**
  - Change: `test/approval-stage.test.ts`'s fixture completes the `spec_review` stage directly through the store and writes no gate event, so it must gain a helper that appends a well-formed `spec.gate.pass` event — otherwise every existing success-path test now fails for the right reason at the wrong time. Then add cases for: no gate event at all; a gate event in the old prose format; a spec edited after the event was written; and a gate event recording `risk=low` for a spec that now computes `standard`.
  - Change: The existing test named "a spec edited after review fails the signature, because the payload moved" must be updated: the hash comparison now fires **before** signature verification, so the expected message changes. Assert the new message and rename the test — a spec change caught by name is a better diagnostic than a signature failure, and the test should say which one it is proving.
  - Verify: `node --test test/approval-stage.test.ts`
  - Expected: all pass.

**Task completion evidence:** an approval cannot bind a spec other than the one carrying a `spec.gate.pass` event; the duplicate-artifact risk case fails when the raw count is restored.

### Task 4: the gate re-checks `change_kind`

**Depends on:** Task 3

**Files:**
- Modify: `src/approval-stage.ts` — `buildBinding`
- Modify: `test/approval-stage.test.ts`

**Steps:**

- [x] **Step 1: the failing test first**
  - Change: Add a case where the spec on disk declares `change_kind: defect_fix` while the run row says `feature`. The spec stage refuses this at write time (the `written.doc.changeKind !== run.change_kind` guard in `src/spec-stage.ts`), but the gate never re-checks, so a spec edited after review can flip it — and section 14 makes `change_kind` the flag that requires a defect fix to carry regression coverage.
  - Verify: `node --test test/approval-stage.test.ts`
  - Expected: **fails** — the mismatch is not detected. Record this. Note that Task 3's spec-hash check will also fire on an edited spec, so this test must write the mismatched `change_kind` into the spec **before** the `spec.gate.pass` helper records its hash, isolating this guard from that one.

- [x] **Step 2: the check**
  - Change: In `buildBinding`, immediately after `validateSpecDoc` succeeds, refuse with `the approved spec declares change_kind ${doc.value.changeKind}, but run ${runId} is ${run.change_kind}`.
  - Verify: `node --test test/approval-stage.test.ts`
  - Expected: all pass.

**Task completion evidence:** the mismatch fails before the fix and is refused by name after, independently of the spec-hash guard.

### Task 5: `bw spec` refuses a run that is not in progress

**Depends on:** None

**Files:**
- Modify: `src/spec-stage.ts` — `runSpecStage`
- Modify: `test/spec-stage.test.ts`

**Steps:**

- [ ] **Step 1: the failing test first**
  - Change: In `test/spec-stage.test.ts`, create a run, set its status to `blocked` **without** adding any stage, and call `runSpecStage` with the fixture executor. The existing guard only refuses when `existing.length > 0`, so a blocked zero-stage run proceeds to dispatch — real spend against a run that can never complete.
  - Verify: `node --test test/spec-stage.test.ts`
  - Expected: **fails** — the stage runs. Record this. The fixture executor means the failing run costs nothing.

- [ ] **Step 2: the guard, before anything can spawn**
  - Change: In `runSpecStage`, immediately after the `run` lookup and **before** the design document is read, refuse with `run ${runId} is ${run.status}, not in_progress`. Placing it before the file read matches the ordering discipline in `src/cli.ts`'s `dispatch` case, where the stage check precedes the prompt-file read so a bad input cannot reach a spawn.
  - Verify: `node --test test/spec-stage.test.ts`
  - Expected: all pass. The new test additionally asserts no `agent_run` row exists for the run afterwards — the absence-of-spend proof `test/cli.test.ts` already uses in its dispatch cases.

**Task completion evidence:** a blocked zero-stage run is refused before any dispatch, and the absent `agent_run` row is what proves nothing was spent.

### Task 6: the profile-freeze failure path is proven

**Depends on:** None

**Files:**
- Modify: `src/cli.ts` — the `new-run` freeze `catch`
- Modify: `test/cli.test.ts`

**Steps:**

- [ ] **Step 1: force a real freeze failure**
  - Change: Add a `test/cli.test.ts` case that creates one run (so the next id is known), then pre-creates `.governance/profiles/<next-id>` as a **file** rather than a directory so `mkdirSync` throws, then runs `new-run` again. Assert: exit code 1, the run row exists with status `blocked`, a `profile.freeze.failed` audit event exists, and **stdout is empty** — the current code throws before `console.log`, so a caller scripting `bw new-run` receives no id and no explanation of which run was created.
  - Verify: `node --test test/cli.test.ts`
  - Expected: run it and record which assertions hold against the current code. The stdout-empty and blocked-status assertions describe the behaviour being fixed and asserted respectively.

- [ ] **Step 2: make the failure legible to a caller**
  - Change: In the `catch` block, before rethrowing, write `run ${run.id} created but blocked: profile freeze failed` to stderr so the operator can find and inspect the wedged run. Keep the rethrow — the command must still exit non-zero, and the run must stay blocked.
  - Verify: `node --test test/cli.test.ts`
  - Expected: all pass; the test asserts the stderr line names the run id.

**Task completion evidence:** the freeze-failure path is exercised rather than assumed, and a caller can identify the blocked run from the command's own output.

### Task 7: sha256 object-format repositories resolve a starting commit

**Depends on:** None

**Files:**
- Modify: `src/profile.ts` — `resolveStartingCommit`
- Modify: `test/profile.test.ts`

**Steps:**

- [ ] **Step 1: the failing test first**
  - Change: In `test/profile.test.ts`, initialize a repository with `git init -q --object-format=sha256`, make an empty commit, and assert `resolveStartingCommit` returns the 64-character OID. Today the `/^[0-9a-f]{40}$/` test rejects it and returns `null`, so the run freezes `startingCommit: null` and the gate later refuses with "it was not created in a git repository" — a wrong reason for a real repository. Assert the `git init` exited 0 so an older git fails the test loudly instead of passing vacuously.
  - Verify: `node --test test/profile.test.ts`
  - Expected: **fails**, returning `null`. Record this. If the installed git rejects `--object-format=sha256`, stop and report: the fix is still correct, but this environment cannot prove it, and that must be stated rather than worked around.

- [ ] **Step 2: accept both object formats**
  - Change: The pattern becomes `/^([0-9a-f]{40}|[0-9a-f]{64})$/`. Update the doc comment to say both sha1 and sha256 object formats are accepted.
  - Verify: `node --test test/profile.test.ts`
  - Expected: both the sha1 and sha256 cases pass.

**Task completion evidence:** a sha256 repository freezes a real starting commit and becomes approvable.

### Task 8: containment survives symlinks and junctions, and covers `sign --key`

**Depends on:** None

**Files:**
- Modify: `src/scope.ts` — add the shared `isPathInside` helper
- Modify: `src/approval.ts` — use it in `resolvePublicKeyPath`
- Modify: `scripts/sign-approval.mjs` — use it in `keygen`, add it to `sign`
- Modify: `test/approval.test.ts`, `test/sign-approval.test.ts`

**Steps:**

- [ ] **Step 1: the failing tests first**
  - Change: In `test/approval.test.ts`, create a temporary repository root and a key directory outside it, then create a link **inside** the root pointing at that outside directory — a junction on Windows via `spawnSync("cmd", ["/c", "mklink", "/J", link, target])`, a directory symlink elsewhere via `symlinkSync(target, link, "dir")`. Point `BW_APPROVAL_PUBLIC_KEY` at the key through the link and assert `resolvePublicKeyPath` refuses it: the path is reachable from inside the repository, which is what section 17 forbids, and the lexical test today decides on the string alone.
  - Change: In `test/sign-approval.test.ts`, assert `sign --key <path inside the repository>` is refused. Today `sign` applies no containment at all, so a private key may sit in the tracked tree and nothing objects.
  - Verify: `node --test test/approval.test.ts test/sign-approval.test.ts`
  - Expected: both **fail**. Record them. If neither a junction nor a symlink can be created here, stop and report rather than dropping the case — an unexercised containment guard is the one most likely to be wrong.

- [ ] **Step 2: resolve before comparing**
  - Change: Add to `src/scope.ts`: `isPathInside(parent: string, child: string): boolean`, which `realpathSync`-resolves both sides before the `relative` test. Because a `keygen --out` target usually does not exist yet, resolve the child by walking up with `dirname` until `existsSync` is true, `realpathSync` that ancestor, and rejoin the unresolved tail. `src/scope.ts` is the right home: it already owns the path predicates, and both `src/approval.ts` and the signing script import from `src/`.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 3: one containment rule, both tools**
  - Change: `src/approval.ts`'s `resolvePublicKeyPath` calls `isPathInside` and its local lexical `isInside` is deleted. `scripts/sign-approval.mjs` imports `isPathInside` from `../src/scope.ts` — it already imports `normalizeText` from `../src/canonical.ts`, so importing from `src/` is established — and uses it in `keygen` in place of the local `isInside` (keeping the existing `enclosingRepo` check, which catches a repository the cwd is not inside). Add it to `sign`, refusing with `refusing to read signing material from inside the repository: ${resolve(keyPath)}`, checked against `enclosingRepo(keyPath) ?? process.cwd()` so the rule holds wherever the script is run from.
  - Verify: `node --test test/approval.test.ts test/sign-approval.test.ts`
  - Expected: all pass, including the existing keygen containment cases.

**Task completion evidence:** a key reachable through a junction is refused, `sign` refuses an in-repository key, and one helper implements the rule for both tools.

### Task 9: the approving key is bound at run start

**Depends on:** None

**Files:**
- Modify: `src/profile.ts` — `Profile`, `freezeProfile`
- Modify: `src/approval-stage.ts` — `approveRun`
- Modify: `test/profile.test.ts`, `test/approval-stage.test.ts`

This closes accepted-deferred finding 1. It is a **partial** guarantee by construction, and every message and comment must say so.

**Steps:**

- [ ] **Step 1: freeze the fingerprint when one is available**
  - Change: `Profile` gains `approvalSigner: string | null`. `freezeProfile` calls `loadPublicKey(rootDir)` and records `signer` on success, `null` on any failure — a missing key at run start is normal and must not fail run creation. Document on the field that `null` means "no key was configured at intake", not "any key is acceptable by policy". `src/profile.ts` importing `src/approval.ts` introduces no cycle: `approval.ts` imports only node builtins and `./canonical.ts` (verified).
  - Change: **Test-ordering consequence, and it will bite silently.** `loadPublicKey` reads `BW_APPROVAL_PUBLIC_KEY` at the moment `freezeProfile` runs. `test/approval-stage.test.ts`'s fixture currently calls `freezeProfile` *before* it generates the keypair and sets that variable ([approval-stage.test.ts:61](test/approval-stage.test.ts#L61)), so every existing fixture would freeze `approvalSigner: null` and quietly exercise only the unbound path. Reorder the fixture to generate the key and set the variable **before** `freezeProfile`, and give the fixture a switch so the unbound path can still be exercised deliberately.
  - Verify: `npm run typecheck`
  - Expected: exit 0. Every frozen profile's hash changes; no fixture pins a literal hash, so nothing else moves.

- [ ] **Step 2: the gate requires a match when one was frozen**
  - Change: In `approveRun`, after `loadPublicKey` succeeds, refuse with `approval key ${key.signer} is not the key frozen at run start (${profile.approvalSigner})` when `profile.approvalSigner` is non-null and differs. When it is null, proceed and append `; signer not bound at intake` to the `approval.granted` summary so the audit distinguishes a bound approval from an unbound one. This is section 6's rule — record when a guarantee is asserted rather than proven — applied to the approval itself.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 3: cover both paths**
  - Change: `test/approval-stage.test.ts` gains: a run frozen with a key and approved with that same key succeeds, and its `approval.granted` summary does **not** carry the unbound note; the same run approved with a second keypair is refused naming both fingerprints; a run frozen with no key configured is approved and its granted summary **does** carry the note. `test/profile.test.ts` asserts `approvalSigner` is null when no key is configured and equals the loaded key's fingerprint when one is.
  - Verify: `node --test test/profile.test.ts test/approval-stage.test.ts`
  - Expected: all pass.

**Task completion evidence:** substituting a different key after run start is refused; a run created with no key still completes, and its audit records that the signer was never bound.

### Task 10: an approval commits atomically

**Depends on:** Task 3, Task 4, Task 9

**Files:**
- Modify: `src/store.ts` — `transaction`
- Modify: `src/approval-stage.ts` — `approveRun`
- Modify: `test/store.test.ts`, `test/approval-stage.test.ts`

This closes accepted-deferred finding 2. It lands last because it wraps the writes every earlier task may have changed.

**Steps:**

- [ ] **Step 1: make `transaction` re-entrant**
  - Change: `Store` gains a private `#txDepth = 0`. `transaction(fn)` issues `BEGIN IMMEDIATE` only at depth 0 and `COMMIT` only on returning to 0; nested calls increment, run `fn`, and decrement. On a throw at any depth, unwind to 0 and `ROLLBACK` once, then rethrow — a nested failure must abort the whole unit, never half of it. This is what lets `insertStage` and `appendAudit`, each of which opens its own transaction today, compose inside one outer transaction.
  - Verify: `npm run typecheck`
  - Expected: exit 0.

- [ ] **Step 2: prove the nesting**
  - Change: `test/store.test.ts` gains: a nested `transaction` inside an outer one commits once and both writes are visible afterwards; a throw inside the inner transaction rolls back the outer one's writes as well; single-level behaviour is unchanged. Assert by reading rows back, never by inspecting the depth counter — the counter is the mechanism, the visible rows are the contract.
  - Verify: `node --test test/store.test.ts`
  - Expected: all pass.

- [ ] **Step 3: one unit of work for the approval**
  - Change: In `approveRun`, wrap the success path — `insertStage`, the `approval.stage.create` audit, `insertApproval`, `completeStage`, and the `approval.granted` audit — in a single `store.transaction(() => { ... })` returning the ids from the callback. A throw anywhere inside now leaves no stage row at all, which is a state a retry can proceed from, rather than a pending `awaiting_approval` row that permanently refuses one.
  - Verify: `node --test test/approval-stage.test.ts`
  - Expected: all pass unchanged — atomicity must not alter observable success or refusal behaviour.

- [ ] **Step 4: prove the wedge is gone**
  - Change: Add a test that forces a throw between the stage insert and the completion by replacing `insertApproval` on the store instance with a function that throws. Assert afterwards that no `awaiting_approval` stage exists, no approval row exists, and that a subsequent well-formed `approveRun` on the same run **succeeds**. That last assertion is the point: the run is retryable, not wedged.
  - Verify: `node --test test/approval-stage.test.ts`
  - Expected: passes. Revert the re-entrancy change, confirm this test fails because the old code leaves a pending stage and the retry is refused, then restore.

**Task completion evidence:** a mid-approval failure leaves the run exactly as it was and a retry succeeds; the break-it run confirms the old code wedged it.

### Task 11: the gate, and the record of what was proven

**Depends on:** Tasks 1-10

**Files:**
- Modify: `.claude/sessions/project-learnings.md`
- Modify: the `step4-open-findings` memory
- Validate: the whole suite

**Steps:**

- [ ] **Step 1: the completion gate**
  - Verify: `npm ci && npm run typecheck && npm test && npm run check:docs`
  - Expected: all four exit 0 from a clean install. The suite must exceed its current 212 tests; no test spawns the `claude` binary and none makes a network call.

- [ ] **Step 2: record what the break-it runs showed**
  - Change: Append an entry to `.claude/sessions/project-learnings.md` naming, for each of the twelve findings, the test that was seen failing before its fix. Where a break-it run failed a **different** test than expected, record that — the step-4 entries show two occasions where the prediction was wrong and the guard was still sound, and that pattern is worth keeping visible.
  - Change: Update the `step4-open-findings` memory to record that the list is closed, or delete the memory if nothing remains open. Leaving a memory that says twelve findings are open after they are fixed is worse than having no memory.
  - Verify: read the entry back against this plan's task list
  - Expected: twelve findings, twelve named tests, none recorded as fixed without one.

**Task completion evidence:** the full gate is green, and every finding has a named test that was observed failing first.
