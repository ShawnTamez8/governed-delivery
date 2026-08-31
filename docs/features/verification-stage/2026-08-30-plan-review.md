# Verification Stage Plan Review

**Reviewed document:** `docs/features/verification-stage/plan.md`

**Date:** 2026-08-30

**Verdict:** Not ready for implementation. Seven findings, one critical.

**Hazards considered:** 2 (the overflow finding is an instance of it — bytes discarded above a cap are bytes no diagnosis can recover), 7 (weighed against finding 7's deferral of remediation rounds and found not to bear: with no retry there is no unvaried retry), 8 and 9 (finding 6 — the Windows shell contract and executable resolution, checked against the behaviour `test/harness.test.ts` already records), 11 and 12 (finding 5 — a repository that can create a run it cannot finish is the default-install failure, and the effective configuration must be visible and provably the committed one). Entries 1, 3, 4, 5, 6, 10, 13, and 14 do not bear on these findings: they concern model output shapes, prompt constraints, fixture agreement, delivery, upstream promises, model aliases, invented obligations, and reviewer independence, and no finding here touches an agent dispatch.

---

## Critical

### 1. Verification executes agent-produced code with the full parent environment

`runVerifyCommand` as planned passes no `env` to `spawn`, so the child inherits `process.env` entire. `ARCHITECTURE.md` section 17 requires the opposite — "Pass named environment variables, never the whole environment" — and `src/harness.ts` already implements it from `executor.sandbox.envPassthrough`.

The stage runs code the implementer wrote. Full inheritance puts `BW_APPROVAL_PUBLIC_KEY` into that code's reach, which is the trust anchor `test/executor.test.ts` asserts no spawned executor may receive.

**Recommended fix:** a named passthrough list held in policy and frozen per run, asserted to contain no `BW_` name; an environment canary test proving an unlisted variable does not reach the child and a listed one does. Filesystem and network containment are a separate matter — the repository has no sandbox mechanism, and the plan should state that limitation rather than claim isolation the code does not provide.

## High

### 2. Verification does not prove it tested the committed deliverable

The only worktree precondition is that the directory exists. Nothing checks that HEAD still equals what implementation committed, that the tree is clean before the commands run, or that a command did not modify tracked files or advance HEAD. A snapshot-updating test can pass against uncommitted bytes while the branch — the deliverable under section 4 — holds different content.

**Mitigation:** require the recorded implementation head and a clean worktree at entry, and re-check both after every command. Refuse when the recorded head cannot be read, rather than skipping the check.

### 3. Output overflow is truncated rather than retained, and does not block

The runner caps each stream and discards the remainder; the stage blocks only on non-zero exit, timeout, or spawn error. Section 20 requires refusing above the cap **and** retaining the raw bytes. The plan also reads the live `RESULT_MAX_BYTES` although `Policy` already carries `resultMaxBytes`, which is a hard rule 6 violation. The "four block paths" claim enumerates three.

**Mitigation:** stream complete output to the evidence file, bound only the in-memory copy, take the limit from the frozen profile, block on overflow, and state whether the budget is per stream or combined.

### 4. The handoff loses the worktree and the verified commit

Section 4: "stage N's `output_ref` is literally what stage N+1 was handed." Verification replaces the worktree path with a text report, so `delivery_check` cannot derive the deliverable without walking backward to the implementation row.

**Mitigation:** make `output_ref` a structured record carrying the worktree reference, the verified commit, the per-command results, and the evidence references.

### 5. `governed.yaml` is neither required nor proven committed

Three separate defects. A missing file creates a run guaranteed to block only after the expensive stages, contradicting section 7's precondition that the commands are authored before the first run — and the public-key analogy is not equivalent, because a null signer still permits completion whereas a null verification config cannot. `loadGovernedConfig` reads working-copy bytes without proving they are tracked or match the starting commit. `new-run` enforces no clean-tree precondition at all, although section 7 requires one.

**Mitigation:** refuse absent, malformed, untracked, or dirty configuration before the run row exists; read the file from the resolved starting commit; pass the validated configuration into `freezeProfile` rather than re-reading it.

### 6. The Windows process contract is wrong

The plan expects a nonexistent executable to yield `spawnError` with a null exit code. `test/harness.test.ts` records the actual behaviour: under `shell: true` the shell starts, names the command on stderr, and exits 1. The planned test asserts an expectation invented in the same session as the code it would guard.

The parser also accepts arbitrary non-empty tokens while `shell: true` reinterprets spaces, quotes, and metacharacters — the risk `src/profile.ts` already states for model names, where the audited argv differs from what ran. `CommandOutcome` omits `killError`, and the plan drops the close-grace handling the harness has.

**Mitigation:** match the recorded behaviour, constrain command tokens to a pattern that survives the shell, and carry `killError` and the grace period.

### 7. Remediation is deferred without amending the binding document

`CLAUDE.md` calls the architecture binding; section 12 names bounded remediation rounds for `verification`. A plan-level assumption does not amend it.

Established practice cuts the other way — `ARCHITECTURE.md` has not changed since build order step 2, and step 6 deferred scope fitness, also a section 12 requirement, with a plan assumption alone. The finding is therefore a correction to practice rather than to this plan alone.

**Mitigation:** record the milestone exceptions and their repair semantics in `ARCHITECTURE.md`, covering scope fitness and `status.md` as well as remediation, so one deferral is not documented while two remain silent.

---

## Reconciliation

**Date:** 2026-08-30
**Disposition:** 7 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — Verification executes agent-produced code with the full parent environment:** the runner now builds its environment from `VERIFY_ENV_PASSTHROUGH`, frozen in `Policy` and asserted to contain no `BW_` name; a canary fixture proves in both directions that an unlisted variable does not reach the child and `PATH` does. Filesystem and network containment are recorded as an unbuilt limitation in section 17 with a proposal filed, rather than claimed.
- **Accepted — Verification does not prove it tested the committed deliverable:** the stage reads the head from the implementation stage's own `implementation.gate.pass` audit event, requires the worktree at that commit and clean at entry, and re-checks both after every command. A missing or unparseable event refuses rather than skipping the check. Task 7 adds the audit reader this needs.
- **Accepted — Output overflow is truncated rather than retained, and does not block:** the runner streams complete output to the evidence file as it arrives and bounds only the in-memory copy, the budget is `profile.policy.resultMaxBytes` rather than the live constant, it is combined across both streams, and overflow is now a blocking condition. The block-path count is corrected to six and enumerated.
- **Accepted — The handoff loses the worktree and the verified commit:** `output_ref` is now a JSON record carrying the worktree path, the verified commit, every command's outcome, and its evidence reference, with the report beside it.
- **Accepted — `governed.yaml` is neither required nor proven committed:** `new-run` refuses absent, malformed, uncommitted, or dirty configuration before the run row exists; the file is read from the resolved starting commit with no working-copy fallback; the validated configuration is passed into `freezeProfile` rather than re-read; `Profile.verification` is non-nullable. The clean-tree precondition is an extension beyond step 7 and is flagged as such in the plan so it can be struck.
- **Accepted — The Windows process contract is wrong:** the unresolvable-command expectation is taken from `test/harness.test.ts`'s recorded behaviour — the shell starts, names the command on stderr, and exits 1 — command tokens are constrained to a character set that survives the shell, and `CommandOutcome` carries `killError` with the close-grace period restored.
- **Accepted — Remediation is deferred without amending the binding document:** Task 10 adds a subsection to section 12 recording the milestone deferrals and their repair semantics, covering scope fitness and `status.md` alongside remediation so one is not documented while two stay silent.

**Status line not advanced.** The plan stays `Proposed`. This repository's plans move `Proposed` to `Implemented`, and `reconciled` is not a status it uses; the stamp above is the record.
