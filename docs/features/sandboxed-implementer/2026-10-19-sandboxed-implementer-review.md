# Sandboxed implementer - review

**Reviewed document:** `plan.md`

**Document type:** Plan

**Review date:** 2026-10-19

**Status:** reconciled

**Reviewer:** Copilot, separate from the drafting session; source-grounded document review, not a live containment certification.

**Hazards considered:** 2 (preserving command evidence), 4 (independent Git reproductions and stand-in coverage), 8 and 9 (direct executable launch and the tool-server interpreter), 12 (frozen image identity), 15 (quiescence before the mutation gate), 19 (command and output ceilings), 20 (preserving deletion refusal), and 22 (derived-file restoration and container cleanup). The review preserves the operator's adopted tool mode, Node-only scope, cost cap and configuration choices.

---

## Summary

The plan uses the spike evidence appropriately, but its proposed workspace boundary admits deletions and blocks valid first-time generation. Container ownership, teardown and command-outcome contracts also need correction before this plan supports implementation without inventing material behavior. No earlier review exists in this feature directory.

## Verdict

**Ready for planning after required changes.** Resolve findings 1-5 before implementation. The two Git reproductions confirm defects in the written algorithm; the remaining findings identify reachable lifecycle and evidence failures, not failures measured against the unbuilt system.

## Critical issues - must fix before implementation

**Issue:** 1. Rename detection bypasses the deletion refusal

- **Why it matters:** Task 5 reads `git diff --cached --raw <base>` and rejects status `D`. Git's rename detection represents deleting one file and adding an identical file as `R100`, with no `D` record. A disposable repository reproduces exactly `R100 old.ts new.ts`; adding `--no-renames` exposes the separate addition and deletion.
- **Where:** Task 5, step 5; "Decisions this plan takes," deletion refusal.
- **Production impact:** A rename between signed scope paths removes an existing file despite the explicit no-deletion contract. Checking the committed path set against the staged set does not detect the violation.
- **Recommended fix:** Require `--no-renames` and NUL-delimited raw records, or explicitly reject every rename's removed source. Gate every affected path. Add an identical-content rename case whose source and destination both fit scope, and prove that disabling deletion enforcement makes it pass.

**Issue:** 2. Derived-file restoration assumes the base contains the file

- **Why it matters:** Task 5 restores every changed derived path with `git checkout <base> -- <path>`. The configuration contract in `src/governed-config.ts` validates the declaration but does not require that file to exist in the starting tree. An agent's first install can create it. A disposable Git probe returns exit 1 and `pathspec ... did not match any file(s) known to git` for this case.
- **Where:** Task 5, step 3 and its derived-discard test.
- **Production impact:** A valid first-time generated artifact blocks the phase before harness regeneration, contrary to the operator's discard-and-regenerate decision.
- **Recommended fix:** Define discard as restoring the base's complete state: restore existing paths and remove agent-created paths absent from the base, including staged additions. Use literal pathspecs. Require tests for absent, modified and agent-deleted derived files alongside a valid source edit.

## High-risk areas

**Risk:** 3. A failed work-container teardown leaves a writer across the gate

- **Why:** "Error handling and diagnostics" and Task 9 preserve the outcome after every teardown failure. A command can leave background processes in the work container. If removing that container fails, those processes retain the writable bind mount while host Git stages, gates and commits. `finally` alone does not establish quiescence.
- **Impact if ignored:** Subsequent verification inherits an active writer that can change files while commands read them or after clean-tree checks. Passing commands then do not reliably attest to the committed checkout.
- **Mitigation:** Separate harmless proxy/network leftovers from failure to stop the work container. Require confirmed writer quiescence before any host boundary operation; block when it cannot be established while retaining the primary error. Add a teardown-failure case with a surviving background writer and assert that no commit follows.

**Risk:** 4. Docker names collide across repositories

- **Why:** Task 2 specifies `bw-<run>-<label>` names in a host-global Docker namespace. Run IDs belong to repository-local stores, and `ARCHITECTURE.md` section 19 and `src/lock.ts` serialize writers per repository, not per workstation. Two repositories can both execute run 1, phase 1. The promoted prototype also tears down by name after partial creation fails.
- **Impact if ignored:** One valid run fails on another's names, and its failure cleanup can remove the other run's containers or network.
- **Mitigation:** Include repository identity and a unique sandbox-instance token in names. Track ownership of successfully created objects and clean up only those objects, preferably by returned IDs. Test simultaneous sandboxes with equal run IDs and labels but different repository roots, including partial startup failure.

**Risk:** 5. The promoted Docker helper does not preserve verification outcomes

- **Why:** Task 2 makes every nonzero Docker exit throw `ContainerError` with a stderr tail. For `docker exec`, a failing test also produces a nonzero Docker exit. Task 8 deletes host command execution and promises unchanged evidence, but does not define the replacement command-outcome and streaming-retention contract. The promoted `scripts/sandbox-spike/docker-sandbox.ts` buffers synchronously with a 64 MiB `maxBuffer`; it does not implement the independent memory and disk budgets in `src/verify-command.ts`.
- **Impact if ignored:** Ordinary test failures can bypass structured verification records or lose stdout diagnostics. Noisy commands can hit a process buffer instead of the frozen output policy.
- **Mitigation:** Specify how exec distinguishes infrastructure failures from command exits and preserves full bounded evidence before either outcome branches. Preserve `exitCode`, timeout/kill diagnostics, combined-stream overflow and retention-ceiling behavior through verification and regeneration. Require failing-stdout, mixed-stream overflow and retention-kill cases against the replacement path.

## Medium and low concerns

- **6. Task dependencies and checkpoints disagree.** Task 5's tests require Task 4's stand-in but declare only Task 2. Task 6 orders deletion of patch contracts while Tasks 7-9 still replace their consumers, yet requires a clean typecheck. Add the actual dependency and defer removal until the consuming stages and tests move coherently.
- **7. The image is not a reproducible toolchain build.** The adopted Dockerfile pins its base but installs unpinned Git from mutable Debian repositories. The "same toolchain" claim in Decisions exceeds that guarantee, and rebuilding does not guarantee recovery of an absent frozen image ID. State the actual guarantee and an exact-image retention/recovery procedure, or pin the remaining package inputs.
- **8. The program check proves only top-level executable availability.** `command -v npm` passes when `npm run build` invokes an absent compiler or tool. Scope currently promises refusal before spend for every target needing anything beyond Node/npm/Git, while acknowledging only service dependencies as undetectable. Include transitive script tools and native build dependencies in that limitation rather than expanding this build into a stack detector.

## Missing and underspecified areas

Findings 3-5 identify the missing lifecycle and outcome contracts. No additional blocking specification gaps appear in this review.

## Suggested improvements

Retain the explicit distinction between free validation and separately consented paid evidence. This review runs neither Docker nor a provider dispatch; its reproductions use owned disposable Git repositories and remove them afterward.

---

## Reconciliation

**Date:** 2026-10-19

**Disposition:** 8 accepted, 0 rejected, 0 deferred, 0 open

**Status:** reconciled

**Hazards considered:** 2, 12, 15, 19, 20, 22 and 24, as the review names them. The checks came from the repository, not the review's account: `git diff --cached --raw` printed `R100 old.ts new.ts` for an identical-content rename, and `--no-renames -z` printed separate `A` and `D` records. `git checkout <base> -- <path>` for a path absent at the base exited 1 with `pathspec ... did not match`. `docker exec` against a missing container exited 1 with `No such container`, the same code as a failing command. The others were not engaged.

### Verdicts

- **Accepted — 1. Rename detection bypasses the deletion refusal:** Task 5 step 5 now reads `git diff --cached --raw --no-renames -z <base>` and gates every path of every record. Task 5 adds an identical-content rename test and a break-test that drops `--no-renames`. The Decisions bullet now says a rename counts as a deletion.
- **Accepted — 2. Derived-file restoration assumes the base contains the file:** Task 5 step 3 returns each derived path to its state at the base, using literal pathspecs. A path present at the base is restored, and a path absent at the base is removed. Tests cover created, modified and agent-deleted derived files beside a valid source edit, with a break-test.
- **Accepted — 3. A failed work-container teardown leaves a writer across the gate:** "Error handling and diagnostics" now requires `workContainerGone` (a successful `rm -f`, then `inspect` reporting no such container) before any commit, recorded result or next-stage read. Otherwise the stage blocks with `<stage>.sandbox.quiescence.failed`. A proxy or network left behind is only recorded. This is applied in Tasks 8 and 9 and the blast-radius vocabulary. Tests: a real-Docker background-writer test (Task 3), and stand-in unremovable-container cases for verification (Task 8) and a phase (Task 10).
- **Accepted — 4. Docker names collide across repositories:** Task 2 names objects `bw-<repoKey>-<run>-<label>-<instance>` and adds the `bw.repo`, `bw.run` and `bw.instance` labels. It records the IDs it created and cleans up by ID only. Task 7's `doctor` lists leftovers by repository label, and the Rollback text matches. Task 3 tests side-by-side sandboxes with equal run IDs from different roots, plus a partial-start failure, with a break-test.
- **Accepted — 5. The promoted Docker helper does not preserve verification outcomes:** `ContainerError` is now limited to control operations. Commands run through an exit-status wrapper. Their output streams through the kept `runVerifyCommand`, so its memory and retention ceilings apply, and an absent status file is an infrastructure failure. Task 8 keeps `src/verify-command.ts` and tests failing stdout, mixed-stream overflow, retention kill and the infrastructure case. Task 4's stand-in emulates the wrapper.
- **Accepted — 6. Task dependencies and checkpoints disagree:** Task 5 now depends on Tasks 2 and 4. Removing the old patch path moved from Task 6 to Task 9, after its consumers are replaced.
- **Accepted — 7. The image is not a reproducible toolchain build:** the Decisions bullet now states that only the base is pinned and `git` is not. The frozen image ID is the identity, and a rebuild does not recover it. A missing frozen image refuses the run, and recovery is a fresh run. Task 7's refusal and its `doctor` prune warning match, and Task 11 documents it.
- **Accepted — 8. The program check proves only top-level executable availability:** the Scope text now says the check proves only the top-level program and cannot see tools a script calls, native build dependencies, downloaded browsers or services. Task 11 documents that limit.
