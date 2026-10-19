# Run Documents In Governance Implementation Plan

**Status:** Implemented

**Goal:** A run's working copies of its specification and plan live under the target's ignored `.governance/documents/<run>/`, not in the operator's checkout. The checkout then stays clean through and after a run, and two runs of one slug stop sharing, and overwriting, one file. The committed copies the run branch carries (the projections commit) are unchanged, so a merged feature still lands `docs/features/<slug>/spec.md` and `plan.md` exactly as `ARCHITECTURE.md` lays them out.

**Source:**
- Operator request 2026-10-19, after crew-chatter run 7: "draft the plan for the fix". The operator had asked why the untracked `spec.md` and `plan.md` had to be moved aside before merging.
- Crew-chatter runs 3 to 7 (2026-10-18 and 2026-10-19). Every run left both files untracked in `C:\Repositories\testing-repos\crew-chatter`, and each was moved aside by hand before the next `new-run` or merge (`%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-18-run3`, `-run4`, `-2026-10-19-run5`, `-run6`, `-run7`).
- Review `2026-10-19-run-documents-in-governance-review.md`, reconciled into this plan.

**Hazards considered:**
- 2: the shared path destroys evidence. Runs 2 to 6 all wrote `docs/features/crew-chatter-accounts-notes/spec.md`. On 2026-10-19 `status --run 5` reported "the spec has changed since review" and "the recorded approval scope does not match the reviewed specification's declared artifacts", because its `output_ref` now resolves to run 6's merged spec. Run 5's own reviewed spec survives only in the aside directory. A per-run path makes each run's record self-contained. The new directory is removed only with the rest of `.governance/`, which also holds the run row, its profile and its approval state, so deleting it loses nothing that leaves the run usable today.
- 4: the expected behaviour comes from the recorded symptoms above (the porcelain residue after runs 3 to 7, run 5's status refusal), not from values invented with the code. Task 3's assertions were checked against the fixtures that must produce them: `test/spec-stage.test.ts` commits without a `.gitignore`, so its `.governance/state.db` is tracked and porcelain is never empty, and `test/plan-stage.test.ts` has no repository at all. The tests therefore assert on the files themselves.
- 6: the approval binding reads the reviewed spec at the path the spec stage stored. The new directory is recorded in `ARCHITECTURE.md` section 15 as load-bearing for approval, beside `profiles/`, which already is.
- 22: `.governance/` is ignored in every target (intake requires the committed ignore rule). Intake's clean-tree check already excludes governance state (`checkIntakeRepository` filters `GOVERNANCE_PREFIX`), and `checkWorktreeClean` runs in the run's worktree, not the root, so the new files trip neither check.
- 12: does not apply. Nothing here reads configuration.
- 1, 3, 13, 16, 17, 21 and 23: none, because no prompt, model output shape, reviewer input or remediation input changes. The prompts carry the documents' text, not their paths (no `docs/features/${` in `src/prompts.ts`).

**Assumptions:**
- Every reader of a run's spec or plan follows the stage's stored `output_ref` through `resolve(rootDir, ref)`, never a path rebuilt from the slug. Traced 2026-10-19: `src/plan-stage.ts` (line 169), `src/spec-decision-stage.ts` (line 287), `src/implementation-stage.ts` (lines 166 and 214), `src/code-review-stage.ts` (lines 224 and 250), `src/approval-stage.ts` (line 91), `src/dashboard-approval.ts` (line 69) and `src/operator-state.ts` (line 605). `src/code-review-stage.ts` line 262 also records the ref as a reconciler grounding location, a label nothing reads as a file. Task 1 re-verifies this by search before any change.
- Runs created before this change keep their absolute `output_ref` paths and keep working through the same readers, so no migration and no compatibility branch are needed (hard rule 3). Their broken cases, such as run 5, stay broken: the bytes were already overwritten.
- A run whose spec stage ran before the change and whose plan stage runs after it is safe: each stage's reader follows the `output_ref` its predecessor stored, whichever form it has. Its spec stays in the checkout and its plan lands in the governance directory.
- A run paused at `awaiting_decision` across the change is not safe once an answer is folded. The fold writes the folded spec under `.governance/documents/<run>/` while the run's `spec` and `spec_review` stages still name the checkout file. `readRunSnapshot` requires all three to name one file (`src/operator-state.ts` lines 710-711), so it marks both stages `evidence_invalid` and approval is refused. A deny-only pause folds nothing and reuses the reviewed path, so it is unaffected. Hard rule 3 rules out a compatibility branch; the repair is a fresh run. The one such run known on this machine, crew-chatter run 4, is superseded by runs 5 to 7. On 2026-10-19, before any fold, `status --run 4` already reported `evidence_invalid` twice, so this change does not make it any less usable.

**Approach:**
- `src/paths.ts` gains `runDocumentDir(rootDir, runId)`, returning `.governance/documents/<runId>` under the root, beside `rawOutputDir` and `promptDir`. Only `src/paths.ts` may spell the governance directory (`test/paths.test.ts`). The two file names are `spec.md` and `plan.md`.
- The writers take the run ID after the root:
  - `writeSpecDoc(rootDir, runId, slug, content, startingCommit?, derivedPaths = [])`. The slug stays, because `runDocumentRefusals` still needs it.
  - `writePlanDoc(rootDir, runId, content)`. The slug is dropped, since nothing would read it.
  - Each writes into `runDocumentDir` and returns the absolute path of the file it wrote. The stages store that path as `output_ref`, as they stored the old absolute path. The stored form is unchanged by operator decision (2026-10-19, "Keep absolute"). A repo-relative ref was tried first and failed 44 focused tests: tests open the returned path directly, and `status`, the guided approval display and the dashboard show the stored path to the operator.
  - Validation, the tree rule and the derived-artifact refusal are unchanged.
- Their callers pass `run.id`: the author, self-critique and reconciliation writes in `src/spec-stage.ts` (lines 323, 413, 808) and `src/plan-stage.ts` (lines 316, 449, 773), and the fold write in `src/spec-decision-stage.ts` (line 502).
- The approved-split message in `src/spec-decision-stage.ts` (line 366) drops "commit or move aside `docs/features/${run.slug}/spec.md`", because no such file is written any more.
- Guided approval's Modify option in `src/guided-command.ts` told the operator to edit the `design.md` beside the reviewed spec (`join(dirname(bound.specPath), "design.md")`). That folder now holds no design, so the path is built from the run's slug: `docs/features/<slug>/design.md` under the root.
- The projections commit in `src/implementation-stage.ts` keeps writing `docs/features/<slug>/spec.md` and `plan.md` into the worktree from the content it already read. Only its comment changes. That comment says these are "the repo-relative locations `writeSpecDoc`/`writePlanDoc` use in the main tree". The `normalizeText` comment in `src/canonical.ts` (lines 38-43) changes the same way: normalization still protects the committed projections, but the hashed copy is now read from an ignored directory git never rewrites.
- Nothing deletes or moves anything in the operator's checkout. The system simply stops writing there. Nothing removes `.governance/documents/<run>/` either, matching `raw/` and `prompts/`.
- Rollback: reverting the writers alone is complete. Runs whose refs point into `.governance/documents/` keep working, because readers follow the stored ref, so a revert needs no migration. The exception mirrors the decision-pause case in Assumptions: a run whose review wrote under `.governance/documents/` and whose fold runs after the revert ends with mismatched refs, and needs a fresh run.

**Affected areas:**
- `src/paths.ts`, `src/spec-doc.ts`, `src/plan-doc.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/spec-decision-stage.ts`, `src/guided-command.ts`, and comments in `src/implementation-stage.ts` and `src/canonical.ts`.
- `test/paths.test.ts`, the stage tests that assert where a stage writes (Task 2 lists them), and the two new assertions in Task 3.
- `ARCHITECTURE.md` (the "Active work" layout and section 15's storage layout), `docs/runbooks/cli-operator.md` (the split procedure's "commit or move aside" sentence, section 6's `$SpecFile`, and troubleshooting), `README.md` (the matching split sentence), and `.claude/sessions/project-learnings.md` (the diagnostics line about untracked documents).

**Known blockers:** none. The change is free to build and prove; no paid run is part of this plan.

**Blast radius:**
- Seven write call sites, listed above. A missed one would write a document to a path no `output_ref` names, and the next stage's read would fail on a hash or a missing file. Task 1's search makes the list exhaustive.
- Tests: 36 sites in 15 test files spell `docs/features/<slug>/spec.md` or `plan.md`. The search, run from the checkout root on 2026-10-19, was:

  ```bash
  grep -rn '"features", *[a-zA-Z.]*, *"\(spec\|plan\)\.md"\|features/\${[a-zA-Z.]*}/\(spec\|plan\)\.md\|features[\\/]\+[a-z-]*[\\/]\+\(spec\|plan\)\.md"' test/*.ts | grep -v 'docs/features/[a-z0-9-]*/plan.md`'
  ```

  Most of these build a run by hand and store that path as `output_ref`, and they stay valid because readers follow `output_ref`. The tests that assert a stage wrote to that location must change, and Task 2 classifies every site before editing.
- Operator procedure: before signing, the operator opens the reviewed spec. The runbook builds that path deterministically from the run ID, `Join-Path $Target ".governance\documents\$RunId\spec.md"`, just as it built the old one from the slug. It does not point at the `Reviewed specification:` line, because `status` prints that line only when the approval actions are eligible (`approvalHandoff`, `src/operator-output.ts` line 173).
- `status` and audit summaries show the absolute path under `.governance\documents\<run>\` where they showed one under `docs\features\<slug>\`.
- No schema, migration, profile field, CLI flag or dashboard change.

**Verification:** `node --test test/paths.test.ts test/spec-doc.test.ts test/plan-doc.test.ts test/spec-stage.test.ts test/plan-stage.test.ts test/spec-decision-stage.test.ts test/implementation-stage.test.ts`, then `npm run typecheck`, the full serial suite, `npm run check:docs` and the free smoke (`node .claude/skills/run-buildworks/driver.mjs smoke`, 13/13). Each new assertion is proven by breaking it (Task 3): copy the file first, restore, and compare the restored bytes by SHA-256.

---

## The recorded incident

After crew-chatter run 7 completed (2026-10-19), `git status --short` in the target showed:

```
?? docs/features/crew-chatter-folders-tags/plan.md
?? docs/features/crew-chatter-folders-tags/spec.md
```

Both were byte-identical to the run branch's projections commit `887a644` (`git hash-object` against `git rev-parse <branch>:<path>`). A probe in a scratch repository confirmed that `git merge --ff-only` aborts over an untracked file the incoming commit creates, even when its bytes are identical: "The following untracked working tree files would be overwritten by merge". `new-run` also refuses the dirty tree. So every run, completed or blocked, needs a manual move before the next merge or run.

The same path is shared by every run of a slug. On 2026-10-19, `status --repo C:\Repositories\testing-repos\crew-chatter --run 5 --json` listed "the spec has changed since review: gated be2dc479…" and three "the recorded approval scope does not match the reviewed specification's declared artifacts" limitations. Run 5's spec stages stored `output_ref` = `…\docs\features\crew-chatter-accounts-notes\spec.md`, which now holds run 6's merged spec.

## Tasks

### Task 1: Confirm the reader and writer inventory

**Depends on:** None.

**Files:** none changed.

**Steps:**
- Search `src/` for `writeSpecDoc(`, `writePlanDoc(`, `output_ref` and every `join(` or `resolve(` that builds `docs/features/<slug>/spec.md` or `plan.md`.
- Expected: seven write sites, all through the two writers. Every read of a run's spec or plan resolves a stage's `output_ref` against the root. The only slug-built paths outside the writers are the projections commit in `src/implementation-stage.ts` and the approved-split message in `src/spec-decision-stage.ts`.
- If a reader rebuilds the path from the slug, or reads a ref without resolving it against the root, stop and revise this plan before Task 2. That reader would break silently.

**Task completion evidence:** the search output, recorded in this plan's implementation record.

### Task 2: Write run documents under the run's governance directory

**Depends on:** Task 1.

**Files:**
- Modify: `src/paths.ts`, `src/spec-doc.ts`, `src/plan-doc.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/spec-decision-stage.ts`, `src/implementation-stage.ts` (comment only), `src/canonical.ts` (comment only).
- Modify: `test/paths.test.ts`, and the tests this task classifies as asserting the write location.

**Steps:**
- Add `runDocumentDir` to `src/paths.ts`. Pin it in the "every location is the one shipped" test in `test/paths.test.ts`: `runDocumentDir(root, 7)` equals `p("documents", "7")`.
- Change both writers' signatures and target as in Approach, and pass `run.id` at all seven call sites. Rewrite the approved-split message and the two comments.
- Classify each of the 36 test sites from the Blast radius search as either "builds state by hand" (unchanged) or "asserts the stage's write location" (updated to the new reference). Record the classification in the implementation record.
- Expected: the focused test command in Verification passes, including `test/paths.test.ts`'s single-module scan, and `npm run typecheck` is clean.

**Task completion evidence:** the test run and the classification list.

### Task 3: Prove the checkout stays clean and runs stay separate

**Depends on:** Task 2.

**Files:**
- Modify: `test/spec-stage.test.ts` and `test/plan-stage.test.ts`.

**Steps:**
- Test A, in each file: after the existing harness drives the stage to its pass, assert that `existsSync(join(root, "docs", "features", slug, "spec.md"))` (`plan.md` in the plan-stage test) is false, and that the file exists under `runDocumentDir(root, runId)`. These assertions do not depend on the fixture's git setup. Break-test: point the writer back at `join(rootDir, "docs", "features", slug)`. Each test must fail, naming `docs/features/<slug>/spec.md` or `plan.md`. Restore and compare bytes.
- Test B, in `test/spec-stage.test.ts`: insert a second run on the same slug (`demo`) in the same root and drive both through the spec stage. Assert that the two passed spec stages' `output_ref` values differ and each names its own run directory. Then assert that the first run's spec, read through its `output_ref`, still has the SHA-256 its stage recorded. That comparison is the one behind run 5's "the spec has changed since review". Break-test: drop the run ID from `runDocumentDir`. Test B must fail on the equal refs or the changed hash. Restore and compare bytes.

**Task completion evidence:** the new tests passing, and every break-test failure recorded with its message.

### Task 4: Update the design and operator documents

**Depends on:** Task 2.

**Files:**
- Modify: `ARCHITECTURE.md`, `docs/runbooks/cli-operator.md`, `README.md`, `.claude/sessions/project-learnings.md`.

**Steps:**
- `ARCHITECTURE.md`:
  - "Active work": state that `spec.md` and `plan.md` reach `docs/features/<slug>/` through the run branch's projections commit, and that during a run they live in `.governance/documents/<run>/`.
  - Section 15: add `documents/` to the storage-layout fence, which `scripts/doc-check.mjs` parses, with a note that it holds each run's working spec and plan and is load-bearing for approval, like `profiles/`.
  - Section 15 also says projections under `docs/features/<slug>/` are committed. Change it to say they reach a checkout only through the run branch.
- Runbook and README:
  - Remove "commit or move aside the original run's untracked `spec.md`".
  - Set section 6's `$SpecFile` to `Join-Path $Target ".governance\documents\$RunId\spec.md"`.
  - Add one troubleshooting sentence: a run blocked at `spec_review` or `plan_review` leaves its documents in that directory, where the operator can read them.
- Learnings: replace the diagnostics line "A run that stops before delivery leaves … untracked" with the new location, noting that runs created before the change still leave the files behind.
- Expected: `npm run check:docs` is clean.

**Task completion evidence:** the `check:docs` output.

### Task 5: Full validation

**Depends on:** Tasks 3 and 4.

**Files:** none changed.

**Steps:**
- Run the full serial suite (`node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`), `npm run typecheck`, `npm run check:docs` and the free smoke.
- Expected:
  - The suite is the 2026-10-18 baseline (1692 tests, 1687 pass, 0 fail, 5 skipped) plus exactly the tests Task 3 adds: three, so 1695 tests, 1690 pass, 0 fail, 5 skipped. If Task 3 places an assertion inside an existing test instead, the count drops by one for each.
  - `test/paths.test.ts` gains assertions, not tests.
  - The smoke reports 13/13.
- Check `git log -1` afterwards for the empty "moved" commit a full run can leave.

**Task completion evidence:** the suite counts and the smoke summary.

## Implementation record (2026-10-19)

**What shipped.**
- `runDocumentDir` is in `src/paths.ts`.
- `writeSpecDoc(rootDir, runId, slug, content, startingCommit?, derivedPaths = [])` and `writePlanDoc(rootDir, runId, content)` write into it.
- All seven call sites pass `run.id`.
- The approved-split message no longer says "commit or move aside".
- The comments in `src/implementation-stage.ts` and `src/canonical.ts` are rewritten.
- The documents named in Task 4 are updated.

**Deviations from the plan as reconciled.**
- **Stored paths stay absolute (operator decision, 2026-10-19, "Keep absolute").** The plan's `runDocumentRef` was built, then removed after 44 focused tests failed. Approach and the review's reconciliation block record the decision.
- **Guided approval's Modify guidance was a production defect the plan missed.** It built the design path as `dirname(specPath)/design.md`, which now points into the governance directory. `src/guided-command.ts` builds it from the run's slug instead. `test/guided-command.test.ts` asserts the exact path.
- **The runbook said more than Task 4 named.** Besides the listed sentences, two more said projections appear in, or must be set aside from, the original working copy (step 7 and step 9). Both are corrected.
- **`README.md` names the spec's location for the operator.** Its "Review and sign outside the CLI" step now gives the reviewed spec's path.
- **One case the plan's Assumptions missed, found by the code review below.** That is a run paused at `awaiting_decision` across the change whose answers are then folded. Assumptions and Rollback now state it.

**Task 1.** The search found exactly the seven write sites. Every read of a run's spec or plan resolves a stage's `output_ref` against the root. The only slug-built document paths are:
- the projections commit;
- the approved-split message;
- the guided design path above;
- the `design.md` paths, which name the operator's own file and are correct.

**Task 2 classification.**
- The Blast-radius search reproduced the sites. A second search for literal slugs (`"features", "<slug>", "spec.md"`) found more, in `test/cli.test.ts`, `test/cli-operator.test.ts`, `test/dashboard-server.test.ts`, `test/operator-state.test.ts`, `test/relative-evidence.test.ts`, `test/run-intake.test.ts`, `test/spec-doc.test.ts` and `test/spec-stage.test.ts`.
- **Changed — reads of a document a stage wrote:**
  - five sites in `test/spec-stage.test.ts`;
  - three in `test/plan-stage.test.ts` (old lines 1354, 1615 and 1751);
  - the fold assertion and the edited-spec step in `test/guided-command.test.ts`;
  - `parkForApproval` in `test/guided-command.test.ts`, moved to the location the spec stage now writes;
  - the writer tests in `test/spec-doc.test.ts` and `test/plan-doc.test.ts`.
- **Unchanged — no test reads a document from the old location after a stage wrote it.** The remaining sites are:
  - runs built by hand in the store, which write a file and store that path as `output_ref`;
  - scope strings and labels;
  - checks of the projections commit in the worktree (`test/cli.test.ts`, `test/code-review-stage.test.ts`, `test/delivery-stage.test.ts`).

**Task 3 break-tests.** Each mutated file was copied first, then restored and compared byte for byte with `cmp`:

| Break | Failed |
|---|---|
| Writers pointed back at `docs/features/<slug>` | Both Test A tests, naming `docs\features\demo\spec.md` and `plan.md`, and Test B, on equal refs |
| Run ID dropped from `runDocumentDir` | Test B, on equal refs; the pinned value in `test/paths.test.ts` also failed |

**Task 5.**
- The full serial suite ran 1695 tests: 1690 pass, 0 fail, 5 skipped. That matches the expectation exactly.
- `npm run typecheck` and `npm run check:docs` are clean.
- The smoke reports 13/13.
- `git log -1` showed no empty "moved" commit.

**Code review.** An independent reviewer agent read the diff against this plan and its review. It found two things:
- A medium finding: the decision-pause case. It is recorded in Assumptions and Rollback, with no code change, because hard rule 3 rules out a compatibility branch.
- A low finding: this record was missing.

It confirmed the call-site order, the readers, the governance-spelling rule and the documents. It found that each new test fails on the old code.

**Deferred.** The `git status --short` capture after the first post-change run is still pending. The trigger is the next paid run, which needs its own authorization.
