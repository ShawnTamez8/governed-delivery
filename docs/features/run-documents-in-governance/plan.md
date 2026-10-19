# Run Documents In Governance Implementation Plan

**Status:** Proposed

**Goal:** A run's working copies of its specification and plan live under the target's ignored `.governance/documents/<run>/`, not in the operator's checkout. The checkout then stays clean through and after a run, and two runs of one slug stop sharing, and overwriting, one file. The committed copies the run branch carries (the projections commit) are unchanged, so a merged feature still lands `docs/features/<slug>/spec.md` and `plan.md` exactly as `ARCHITECTURE.md` lays them out.

**Source:**
- Operator request 2026-10-19, after crew-chatter run 7: "draft the plan for the fix". The operator had asked why the untracked `spec.md` and `plan.md` had to be moved aside before merging.
- Crew-chatter runs 3 to 7 (2026-10-18 and 2026-10-19). Every run left both files untracked in `C:\Repositories\testing-repos\crew-chatter`, and each was moved aside by hand before the next `new-run` or merge (`%LOCALAPPDATA%\Temp\crew-chatter-aside-2026-10-18-run3`, `-run4`, `-2026-10-19-run5`, `-run6`, `-run7`).

**Hazards considered:**
- 2: the shared path destroys evidence. Runs 2 to 6 all wrote `docs/features/crew-chatter-accounts-notes/spec.md`. On 2026-10-19 `status --run 5` reported "the spec has changed since review" and "the recorded approval scope does not match the reviewed specification's declared artifacts", because its `output_ref` now resolves to run 6's merged spec. Run 5's own reviewed spec survives only in the aside directory. A per-run path makes each run's record self-contained.
- 4: the expected behaviour comes from the recorded symptoms above (the porcelain residue after runs 3 to 7, run 5's status refusal), not from values invented with the code.
- 22: `.governance/` is ignored in every target (intake requires the committed ignore rule). Intake's clean-tree check already excludes governance state, and `checkWorktreeClean` runs in the run's worktree, not the root, so the new files trip neither check. Task 3 proves the first by test.
- 12: does not apply. Nothing here reads configuration.
- 1, 3, 13, 16, 17, 21 and 23: none, because no prompt, model output shape, reviewer input or remediation input changes. The prompts carry the documents' text, not their paths (no `docs/features/${` in `src/prompts.ts`).

**Assumptions:**
- Every reader of a run's spec or plan follows the stage's stored `output_ref`, never a path rebuilt from the slug. Traced 2026-10-19: `src/plan-stage.ts` (spec, line 166), `src/spec-decision-stage.ts` (line 283), `src/implementation-stage.ts` (lines 166 and 214), `src/code-review-stage.ts` (lines 224 and 250), `src/approval-stage.ts` (`bound.specPath` from `output_ref`, line 187), `src/dashboard-approval.ts` (line 69) and `src/operator-state.ts` (lines 605 and 700). Task 1 re-verifies this by search before any change.
- `output_ref` is stored as an absolute path for these stages (run 7's rows, queried 2026-10-19). Runs created before this change keep their paths and keep working through the same readers, so no migration and no compatibility branch are needed (hard rule 3). Their broken cases, such as run 5, stay broken: the bytes were already overwritten.

**Approach:**
- `writeSpecDoc` (`src/spec-doc.ts`) and `writePlanDoc` (`src/plan-doc.ts`) take the run ID and write to `join(rootDir, ".governance", "documents", String(runId), "spec.md")` and `plan.md`. The slug stays a parameter of `writeSpecDoc` for `runDocumentRefusals`. Validation, the tree rule and the derived-artifact refusal are unchanged.
- Their callers pass `run.id`: the author, self-critique and reconciliation writes in `src/spec-stage.ts` (lines 323, 413, 808) and `src/plan-stage.ts` (lines 316, 449, 773), and the fold write in `src/spec-decision-stage.ts` (line 502).
- The projections commit in `src/implementation-stage.ts` keeps writing `docs/features/<slug>/spec.md` and `plan.md` into the worktree from the content it already read. Only its comment, which says these are "the repo-relative locations `writeSpecDoc`/`writePlanDoc` use in the main tree", changes.
- Nothing deletes or moves anything in the operator's checkout. The system simply stops writing there.

**Affected areas:**
- `src/spec-doc.ts`, `src/plan-doc.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/spec-decision-stage.ts`, and a comment in `src/implementation-stage.ts`.
- Tests that assert where a stage writes (Task 2 lists them).
- `ARCHITECTURE.md` (the "Active work" layout), `docs/runbooks/cli-operator.md` (the split procedure's "commit or move aside" sentence and section 6's `$SpecFile`), `README.md` (the matching split sentence), and `.claude/sessions/project-learnings.md` (the diagnostics line about untracked documents).

**Known blockers:** none. The change is free to build and prove; no paid run is part of this plan.

**Blast radius:**
- Seven write call sites, listed above. A missed one would write a document to a path no `output_ref` names, and the next stage's read would fail on a hash or a missing file. Task 2's search makes the list exhaustive.
- Tests: 36 sites in 15 test files spell `docs/features/<slug>/spec.md` or `plan.md` (search 2026-10-19). Most build a run by hand and store that path as `output_ref`; they stay valid, because readers follow `output_ref`. The ones that assert a stage wrote to that location change. Task 2 classifies every site before editing.
- Operator procedure: before signing, the operator opens the reviewed spec. `status` already prints `Reviewed specification: <path>` at the approval pause (`src/operator-output.ts`, line 92), so the runbook points there instead of building the path from the slug.
- No schema, migration, profile field, CLI flag or dashboard change.

**Verification:** `node --test test/spec-doc.test.ts test/plan-doc.test.ts test/spec-stage.test.ts test/plan-stage.test.ts test/spec-decision-stage.test.ts test/implementation-stage.test.ts`, then `npm run typecheck`, the full serial suite, `npm run check:docs` and the free smoke (`node .claude/skills/run-buildworks/driver.mjs smoke`, 13/13). Each new test is proven by breaking it (Task 3): copy the file first, restore, and compare the restored bytes by SHA-256.

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
- Expected: seven write sites, all through the two writers. Every read of a run's spec or plan goes through a stage's `output_ref`, and the only slug-built path outside the writers is the projections commit in `src/implementation-stage.ts`.
- If a reader rebuilds the path from the slug, stop and revise this plan before Task 2. That reader would break silently.

**Task completion evidence:** the search output, recorded in this plan's implementation record.

### Task 2: Write run documents under the run's governance directory

**Depends on:** Task 1.

**Files:**
- Modify: `src/spec-doc.ts`, `src/plan-doc.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/spec-decision-stage.ts`, `src/implementation-stage.ts` (comment only).
- Modify: the tests Task 2 classifies as asserting the write location.

**Steps:**
- Add the run ID parameter to both writers and change their target directory as in Approach. Pass `run.id` at all seven call sites.
- Classify each of the 36 test sites as "builds state by hand" (unchanged) or "asserts the stage's write location" (updated to the new path). Record the classification in the implementation record.
- Expected: the focused test command in Verification passes, and `npm run typecheck` is clean.

**Task completion evidence:** the test run and the classification list.

### Task 3: Prove the checkout stays clean and runs stay separate

**Depends on:** Task 2.

**Files:**
- Modify: `test/spec-stage.test.ts` and `test/plan-stage.test.ts` (or the stage test that already drives spec and plan through the stand-in harness).

**Steps:**
- Test A: drive a run through spec and plan with the fixture harness, then run `git status --porcelain` in the target root. Expected: empty. Break-test: point `writeSpecDoc` back at the old path. Test A must fail and name `docs/features/<slug>/spec.md`. Restore and compare bytes.
- Test B: create two runs on one slug, drive both through spec, then read the first run's operator state. Expected: no "the spec has changed since review" limitation, and each run's `output_ref` names its own run directory. Break-test: drop the run ID from the path. Test B must fail with the limitation run 5 showed. Restore and compare bytes.

**Task completion evidence:** both tests passing, and both break-test failures recorded with their messages.

### Task 4: Update the design and operator documents

**Depends on:** Task 2.

**Files:**
- Modify: `ARCHITECTURE.md`, `docs/runbooks/cli-operator.md`, `README.md`, `.claude/sessions/project-learnings.md`.

**Steps:**
- `ARCHITECTURE.md` "Active work": state that `spec.md` and `plan.md` reach `docs/features/<slug>/` through the run branch's projections commit, and that during a run they live in `.governance/documents/<run>/`.
- Runbook and README: remove "commit or move aside the original run's untracked `spec.md`", and point section 6's `$SpecFile` at the `Reviewed specification:` path that `status` prints.
- Learnings: replace the diagnostics line "A run that stops before delivery leaves … untracked" with the new location, noting that runs created before the change still leave the files behind.
- Expected: `npm run check:docs` is clean.

**Task completion evidence:** the `check:docs` output.

### Task 5: Full validation

**Depends on:** Tasks 3 and 4.

**Files:** none changed.

**Steps:**
- Run the full serial suite (`node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`), `npm run typecheck`, `npm run check:docs` and the free smoke.
- Expected: no new failures against the 2026-10-18 baseline (1692 tests, 1687 pass, 5 skipped), and smoke 13/13.
- Check `git log -1` afterwards for the empty "moved" commit a full run can leave.

**Task completion evidence:** the suite counts and the smoke summary.
