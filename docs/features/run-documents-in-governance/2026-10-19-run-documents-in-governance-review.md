# Run documents in governance — review

**Reviewed document:** `plan.md`

**Document type:** Plan

**Review date:** 2026-10-19

**Status:** reconciled

**Reviewer:** a Copilot session that did not draft the plan, reviewing against `src/`, `test/`, `ARCHITECTURE.md` and `scripts/doc-check.mjs` rather than against the plan's prose. Independent of the drafting session but not an independent process in the sense of hazard 14.

**Hazards considered:** 2 (finding 3: the change moves the approval binding's only readable copy of the reviewed spec into the directory `driver.mjs clean` deletes wholesale, so the fix for one evidence-destruction path opens another), 4 (findings 1 and 2: Task 3's expectations were checked against the fixtures that must produce them, not against the plan's description of them), 6 (finding 3: `buildBinding` is a later stage holding a promise the spec stage made about a file nobody is told is load-bearing), 14 (the reviewer label above), 22 (the plan's own citation was re-verified: `checkWorktreeClean` does count ignored entries but runs in the worktree, and `checkIntakeRepository` filters `GOVERNANCE_PREFIX`, so the plan's claim holds — but the same hazard is what breaks Task 3's porcelain assertion in its own fixture). Entries 1, 3, 5, 7–13, 15–21, 23 and 24 were checked against the plan's hazards line and are unaffected: no prompt text, model output shape, reviewer input, remediation input, schema or configuration surface changes, and the declared-artifact refusals keep their current meaning because the projections commit still writes both documents.

---

## Summary

The plan's diagnosis is correct and its central tracing is accurate: I confirmed that the projections commit writes from `specContent`/`planContent` already in memory (`src/implementation-stage.ts:391-397`), that `src/prompts.ts` interpolates no slug-built document path, and that every reader I checked resolves a stage's `output_ref`. The defects are in the mechanics of the change rather than in its design: the stated implementation violates an existing architectural test, the proof task cannot pass in the fixtures it names, and three operator-facing surfaces that name the old location are not in scope.

## Verdict

**Ready for planning after required changes.** For a plan document this means: fix findings 1 to 5 in the plan, then build. Findings 1 and 2 are mechanical and cheap; finding 3 is a design decision the plan should state rather than inherit silently.

## Critical issues — must fix before implementation

**Issue:** 1. The stated implementation fails `test/paths.test.ts`

- **Why it matters:** the Approach writes `join(rootDir, ".governance", "documents", String(runId), "spec.md")` into `src/spec-doc.ts` and `src/plan-doc.ts`. `test/paths.test.ts:74-89` scans every non-comment line of every `.ts` file under `src/` except `src/paths.ts` and fails on any line containing `.governance`: "only src/paths.ts may spell the governance directory; build the path there and import it". Both new lines are code, so both are offenders. `src/paths.ts` and `test/paths.test.ts` appear in neither "Affected areas" nor Task 2's `Files`.
- **Where:** "Approach", first bullet; Task 2, `Files` and first step.
- **Production impact:** none at run time — the failure is in the build. The sequencing is the damage: Task 2's stated expectation is the focused six-file test command plus `npm run typecheck`, both of which pass, so the defect surfaces only at Task 5's full suite, after Tasks 3 and 4 have been written against the wrong shape. `test/paths.test.ts:102-130` also pins every governance location literally ("every location is the one shipped before the module existed"), so the new directory wants an assertion there too.
- **Recommended fix:** add `runDocumentDir(rootDir, runId)` to `src/paths.ts` beside `rawOutputDir` and `promptDir`, have both writers import it, and add `src/paths.ts` and `test/paths.test.ts` to Task 2's files with the new pinned assertion. Decide at the same time whether a repo-relative `runDocumentRef(runId, name)` companion is wanted (see concern 8).

**Issue:** 2. Task 3 Test A cannot pass in the fixtures it names

- **Why it matters:** Test A is "drive a run through spec and plan with the fixture harness, then run `git status --porcelain` in the target root. Expected: empty." In `test/spec-stage.test.ts` the harness calls `openStore(root)` at line 107 — creating `.governance/state.db` — then `git init` at line 119 and `git add -A` at line 126 with no `.gitignore` anywhere in the file. The base commit therefore tracks `.governance/state.db`, every later write makes it ` M`, and `docs/features/demo/design.md` is written after the commit (line 139) and stays `??`. Porcelain is never empty, before or after this change. `test/plan-stage.test.ts` is worse: its root is a bare `mkdtempSync` with no `git` invocation anywhere in the file, so there is no repository to run `git status` in at all.
- **Where:** Task 3, Test A; Task 3 `Files` ("`test/spec-stage.test.ts` and `test/plan-stage.test.ts` (or the stage test that already drives spec and plan through the stand-in harness)" — the hedge is the symptom).
- **Production impact:** the task that proves the fix fails in the fixed state for reasons unrelated to the fix. The predictable repair under time pressure is to weaken the assertion until it passes, which is exactly the fixture-and-code-agreeing failure the plan's own hazard 4 line disclaims.
- **Recommended fix:** name the actual test file and state its setup. Either commit a `.gitignore` containing `.governance/` in the fixture before the base commit — `test/cli-operator.test.ts:80`, `test/code-review-stage.test.ts:222`, `test/dashboard-server.test.ts:42`, `test/guided-command.test.ts:42` and `test/operator-state.test.ts:558` all already do this — or make the assertion specific: `git status --porcelain -z --untracked-files=all` contains no entry under `docs/features/`, plus `existsSync(join(root, "docs", "features", slug, "spec.md")) === false`. The specific assertion is the better one: it survives a fixture that legitimately leaves other residue, and the break-test still names `docs/features/<slug>/spec.md` as the plan requires.

## High-risk areas

**Risk:** 3. The approval binding's only copy of the reviewed spec moves into wipeable state

- **Why:** between the spec stage and the projections commit, `.governance/documents/<run>/spec.md` is the sole copy. `buildBinding` reads it, `approval-request` re-reads it and refuses on a hash mismatch (`src/dashboard-approval.ts:67-76`), `status` resolves it as `operatorActions[].evidenceRef` (`src/operator-state.ts:985,990`), and the dashboard approval route reads it before the one write it is permitted. `.governance/` is documented as machine-local state, and `CLAUDE.md` states plainly that `driver.mjs clean` deletes it wholesale and "`clean` deletes the only record". Today the checkout copy survives a governance wipe; after this change nothing does, and the projections commit that would preserve it happens in `implementation`, strictly after approval.
- **Impact if ignored:** an approved-but-unimplemented or approval-paused run whose governance state is cleaned becomes unapprovable and unresumable with no repair path, and the operator sees `evidence_invalid` with no explanation of what was deleted. This is a new class of loss that the recorded incident did not have.
- **Mitigation:** state the trade in the plan and say where it is recorded. At minimum, add `documents/<run>/` to the `ARCHITECTURE.md` section 15 storage-layout fence with a sentence marking it load-bearing for approval (concern 6), and add one line to the runbook's approval step saying the reviewed spec lives in the run's governance directory and must not be deleted while a run is unapproved. Consider whether `driver.mjs clean` should warn when a run is in `awaiting_approval`.

**Risk:** 4. The design-split refusal still tells the operator to move aside a file that will not exist

- **Why:** `src/spec-decision-stage.ts:366` ends an approved split with "…keep `docs/features/${run.slug}/design.md`, commit or move aside `docs/features/${run.slug}/spec.md`, and start the first feature with `new-run`". After this change no such file is written. The plan lists `src/spec-decision-stage.ts` only for the fold write at line 502, and Task 4 covers the equivalent sentence in the runbook (`docs/runbooks/cli-operator.md:777-778`) and `README.md` but not the one in the source. No test asserts this string, so nothing will catch it.
- **Impact if ignored:** the split path is the one the operator has actually used — crew-chatter run 1 ended this way — and the guidance sends them looking for an absent file while omitting the real location. Worse, it reads as a precondition for `new-run`, so an operator who cannot find the file may reasonably assume the refusal still applies.
- **Mitigation:** add that message to Task 2's files and rewrite the clause. The accurate replacement is to drop the "commit or move aside" instruction entirely, since the tree is now clean, and optionally name the new location.

**Risk:** 5. "`status` already prints `Reviewed specification: <path>`" is conditionally true

- **Why:** the line is produced by `approvalHandoff` in `src/operator-output.ts:156-160`, which returns `[]` unless `snapshot.workflowAction.group === "approval"` **and** `snapshot.workflowAction.eligible` **and** `request.eligible`. Any refusal recorded by `refuse(...)` clears eligibility — writer contention, `run_aged`, `policy_block`, `evidence_invalid` — and the human-readable handoff block disappears entirely. The path does remain in the snapshot JSON that `status` prints after it (`operatorActions[].evidenceRef`, set whenever `buildBinding` succeeds), so it is recoverable, but not from the line the plan points at. The plan also cites "line 92", which is `formatGuidedApproval` — the guided command's step 4 — not `status`.
- **Impact if ignored:** Task 4 replaces a deterministic `$SpecFile = Join-Path $FeatureDirectory 'spec.md'` in `docs/runbooks/cli-operator.md:804` with a reference to a line that is absent in precisely the states where an operator is most likely to be inspecting a stuck run. The runbook would then have no way to locate the reviewed spec.
- **Mitigation:** point the runbook at the field rather than the rendered line — `status --json` and read `.result.operatorActions[] | select(.kind == "approval_request") | .evidenceRef` — or extend the task to print the path unconditionally whenever the approval group is current. Correct the line citation to `src/operator-output.ts:173`.

## Medium and low concerns

- 6. Task 4 updates the `ARCHITECTURE.md` "Active work" fence (line 1412) but not section 15's storage-layout fence (line ~1459), which enumerates `state.db`, `raw/`, `prompts/`, `content/`, `profiles/`, `approval-handoff/`, `verification/`, `proposals/`, `delivery/` and `code-review/`. `scripts/doc-check.mjs:207,494` parses that fence. The new directory belongs there, and section 15's prose "Projections under `docs/features/<slug>/` are committed, because they are what a human reviews in a diff" should say they reach a checkout only through the run branch.
- 7. After the change `slug` is read only by `runDocumentRefusals` in `writeSpecDoc` and by nothing at all in `writePlanDoc`. `tsconfig.json` sets neither `noUnusedLocals` nor `noUnusedParameters`, so an unused parameter will not fail `npm run typecheck`; it will simply rot. Decide explicitly: drop it from `writePlanDoc`, or keep it for symmetry and say why in the signature's comment.
- 8. `output_ref` stays absolute. Every other governance artifact in `src/paths.ts` has a repo-relative `*Ref` companion precisely because "the reference must survive the tree being read from elsewhere" (`rawOutputRef`, `promptRef`, `deliveryEvidenceRef`, `codeReviewEvidenceRef`). `src/dashboard-approval.ts:69` already does `resolve(root, bound.specPath)`, which tolerates either form. Moving the documents inside the repository makes a relative ref newly meaningful. Either make the choice and record it, or state that absolute is retained deliberately and why.
- 9. The blast-radius figure "36 sites in 15 test files" is not reproducible: the plan records neither the pattern nor the command. A naive repeat over `test/*.ts` returns 90 matches in 36 files, most of them this repository's own `docs/features/<feature>/plan.md` citations in comments. Task 2 requires classifying "each of the 36 test sites", so record the exact search in the plan or the classification cannot be audited.
- 10. `src/canonical.ts:38-43` justifies `normalizeText` with "`docs/features/**` is committed, so a checkout under `core.autocrlf=true` would otherwise change a spec's hash". After the change the hashed spec is read from an ignored directory that git never rewrites. Behaviour is unaffected and normalization stays correct for the projections commit, but the stated rationale no longer matches the read it guards.
- 11. A run blocked at `spec_review` or `plan_review` previously left a visible untracked document the operator could open from the checkout. It now sits in an ignored directory, and `status` prints a document path only inside the approval group. Say where it is — one sentence in the runbook's troubleshooting is enough.
- 12. Nothing removes `.governance/documents/<run>/`. That matches `raw/` and `prompts/` and is almost certainly right, but the plan should say so rather than leave accumulation unaddressed.
- 13. Task 5's expectation "no new failures against the 2026-10-18 baseline (1692 tests, 1687 pass, 5 skipped)" will not hold as written while finding 1 is unfixed, and will need restating once Tasks 2 and 3 add assertions. Say whether the baseline is expected to grow and by how many.

## Missing and underspecified areas

- The path helper. Finding 1 aside, the plan never names the function, its module, or whether the directory is `documents` singular-per-run or carries a per-document name. Specify `runDocumentDir(rootDir, runId)` and the two filenames.
- The writers' signatures. "Add the run ID parameter" does not say where it goes relative to `rootDir`, `slug` and `content`, and `writeSpecDoc` already has two optional trailing parameters (`startingCommit`, `derivedPaths`) that constrain the choice. Write both signatures out.
- Task 3 Test B's mechanism. "read the first run's operator state" does not name the entry point (`readRunSnapshot`), the fixture that can create two runs on one slug, or which field carries the limitation being asserted. Test B is the one that proves the per-run separation, so its assertion should be exact: run 1's `operatorActions[].evidenceRef` names `<run 1>`, and `limitations` contains no "the spec has changed since review".
- A run in progress across the upgrade. The plan covers runs created before the change but not one whose spec stage ran before and whose plan stage runs after. Readers follow each stage's own `output_ref`, so this is safe, but the plan should say so — it is the case an operator will actually hit, and silence reads as an unconsidered one.
- Rollback. Nothing states what reverting looks like once runs exist with refs into `.governance/documents/`. Reverting the writers alone leaves those refs valid, because readers follow them; say that explicitly so a revert is not accompanied by a speculative migration.

## Suggested improvements

- Fold the two new tests into one file that already has a git fixture rather than splitting them across `test/spec-stage.test.ts` and `test/plan-stage.test.ts`. The property under test — the checkout is untouched and two runs do not share — is one property, and `test/spec-stage.test.ts` is the only one of the two with a repository.
- Add a negative assertion to Task 2's focused run: no file exists under `docs/features/` in the target root after a spec-plus-plan drive. It is cheaper than the porcelain check, independent of the fixture's git setup, and it is the actual contract.
- Consider recording, in the plan's implementation record, the `git status --short` output of a target after the first post-change run. The recorded incident is the plan's evidence for the problem; the matching clean output is its evidence for the fix, and it costs nothing to capture during the free smoke.

---

## Reconciliation

**Date:** 2026-10-19
**Disposition:** 18 accepted, 2 rejected, 1 deferred, 0 open
**Status:** reconciled

**Hazards considered:** 2, 4, 6, 14 and 22, as the review weighed them. Finding 3 was re-checked against hazard 2, because it argues a new evidence-loss path, and was rejected on its premise. The rest of the review's list is unaffected for the reasons it gives.

Every claim below was checked against the repository on 2026-10-19 before its disposition was recorded:
- `test/paths.test.ts`: lines 74-89 hold the single-module scan, and lines 102-130 hold the pinned locations.
- The `test/spec-stage.test.ts` fixture: `openStore` runs before `git init`, there is no `.gitignore`, and `design.md` is written after the commit. `test/plan-stage.test.ts` makes no git call at all.
- `src/spec-decision-stage.ts` line 366 still tells the operator to "commit or move aside".
- `approvalHandoff` (`src/operator-output.ts` lines 156-173) returns nothing unless the approval actions are eligible.
- The `normalizeText` comment in `src/canonical.ts`.
- `driver.mjs clean` (`.claude/skills/run-buildworks/driver.mjs` line 426) removes the whole scratch base directory.
- Every `output_ref` read resolves against the root.

### Verdicts

- **Accepted — 1. The stated implementation fails `test/paths.test.ts`; Missing: the path helper:** the plan now adds `runDocumentDir` and `runDocumentRef` to `src/paths.ts`, names both files, pins both values in `test/paths.test.ts`, and lists both files in Task 2.
- **Accepted — 2. Task 3 Test A cannot pass in the fixtures it names; Suggested: a negative assertion on `docs/features/`:** Test A now asserts with `existsSync` that no document exists under `docs/features/<slug>/` and that one does exist under the run directory, in each of the two named files. The porcelain check is gone, and the break-test still names the old path.
- **Accepted — 4. The design-split refusal still says move aside:** the message at `src/spec-decision-stage.ts` line 366 is now in Approach and Task 2, and it drops the "commit or move aside" clause.
- **Accepted — 5. "`status` already prints `Reviewed specification:`" is conditionally true:** the runbook now builds the path deterministically from the run ID, as it built the old one from the slug. The citation is corrected to `src/operator-output.ts` line 173.
- **Accepted — 6. Section 15's storage-layout fence:** Task 4 adds `documents/` to the fence, marked load-bearing for approval like `profiles/`, and corrects the section's sentence about committed projections.
- **Accepted — 7. `slug` becomes unused in `writePlanDoc`:** the plan drops it from `writePlanDoc`, keeps it in `writeSpecDoc` for `runDocumentRefusals`, and writes out both signatures.
- **Accepted — 8. `output_ref` stays absolute:** the writers now return the repo-relative `runDocumentRef`, following the `src/paths.ts` convention. Every reader already resolves a ref against the root, and the citations are listed in Assumptions. The only non-file use is the reconciler grounding label at `src/code-review-stage.ts` line 262.
- **Accepted — 9. The 36-site figure is not reproducible:** Blast radius now records the exact search command. Re-running it reproduces 36 sites in 15 files.
- **Accepted — 10. The `src/canonical.ts` rationale:** its comment is in Approach and in Task 2's files.
- **Accepted — 11. A blocked run's documents become invisible:** Task 4 adds one troubleshooting sentence naming the directory.
- **Accepted — 12. Nothing removes `.governance/documents/<run>/`:** Approach states this, and that it matches `raw/` and `prompts/`.
- **Accepted — 13. Task 5's baseline:** the expectation is restated as the baseline plus the three new tests, and assertions added to existing tests do not raise the count.
- **Accepted — Missing: the writers' signatures:** both are written out in Approach.
- **Accepted — Missing: Test B's mechanism:** Test B now creates two runs on one slug in the `test/spec-stage.test.ts` fixture. It asserts distinct `output_ref` values, and that the first run's spec still has the hash its stage recorded, which is the comparison behind run 5's limitation. A full `readRunSnapshot` needs more state than the stage fixture builds.
- **Accepted — Missing: a run in progress across the upgrade:** Assumptions now states why a spec stage before the change and a plan stage after it are safe.
- **Accepted — Missing: rollback:** Approach states that reverting the writers alone is complete and needs no migration.
- **Rejected — 3. The approval binding's only copy moves into wipeable state:**
  - The premise that the checkout copy survives a governance wipe today does not hold. `driver.mjs clean` removes the whole scratch base, checkout included.
  - Deleting `.governance/` by hand also deletes `state.db`, the run's profile under `profiles/<run>/` and its approval handoff, so the run is unusable whether or not a spec copy survives.
  - Losing only `documents/` is the same class of loss as losing only `profiles/<run>/`, which approval already requires.
  - No new loss class is introduced. The documentation part of the mitigation is kept under finding 6. The proposed `driver.mjs clean` warning is not adopted.
- **Rejected — Suggested: fold both tests into one file:** the spec stage writes only `spec.md` and the plan stage writes only `plan.md`, so each writer's negative assertion belongs in the test that drives that writer. With `existsSync`, neither assertion needs the git fixture the suggestion was protecting. Test B, which needs only the spec stage, sits in `test/spec-stage.test.ts` as suggested.
- **Deferred — Suggested: record `git status --short` after the first post-change run:** the free smoke dispatches nothing and never reaches the spec stage, so it cannot produce this evidence. The trigger is the first paid run after the change, which the operator authorizes separately. Its `git status --short` goes into the implementation record.

### Operator decision during implementation

**Date:** 2026-10-19. This supersedes the verdict on finding 8, and the part of finding 1's verdict that adds `runDocumentRef`. Every other verdict stands.

Changing the writers to return a repo-relative ref failed 44 focused tests. Some failed because they read the documents at the old location, and others because they open the writers' returned path directly. The stored ref is also the path `status`, the guided approval display and the dashboard show the operator. Asked to choose, the operator chose "Keep absolute": only the folder moves to `.governance/documents/<run>/`, and the stored `output_ref` stays the absolute path it was before. `runDocumentRef` was removed. Finding 8 is therefore resolved by stating that absolute is kept deliberately, which is the review's second option. The plan's Approach and implementation record carry the decision.
