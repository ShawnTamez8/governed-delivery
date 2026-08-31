# Verification stage — code review

**Reviewed document:** `docs/features/verification-stage/plan.md`

**Review date:** 2026-08-30

**Effort:** high

**Hazards considered:** 11 bears directly and produced finding 1 — a default
installation that cannot complete a run is exactly what `bw new-run` now is in
any repository that has not gitignored `.governance/`, and the seeded test
helper hides it by writing the ignore rule itself. 2 bears and produced
finding 2 from its opposite side: the plan applied "discarded output is
undiagnosable" without bounding what retention costs, and the measured rate is
about 1 GB per second. 12 bears and produced finding 3 — one policy number
meaning stdout in one caller and both streams in another is configuration
divergence inside the codebase. 8 and 9 were weighed and found sound: the
runner spawns with `shell: true` on Windows for the npm-shim case, the parser
constrains tokens so the audited argv is what runs, and the unresolvable-command
expectation is taken from `test/harness.test.ts`'s recorded behaviour rather
than invented — break-it cycle (n) confirmed the tree-kill is load-bearing. 4
was weighed across the new tests and found satisfied: `governed.yaml`'s
assertions derive from `package.json` read at test time, and all twenty-four
guards were seen failing before being reported as verified. 7 does not apply —
no retry exists in this stage, which is the recorded deferral. 1, 3, 5, 6, 10,
13 and 14 do not apply: they concern model output shapes, prompt constraints,
delivery, unkeepable promises, model aliases, invented obligations and reviewer
independence, and this stage dispatches no agent, resolves no model, and
declares no artifact.

**Scope reviewed:** `git diff HEAD` (modified: `ARCHITECTURE.md`, `CLAUDE.md`,
`README.md`, `src/cli.ts`, `src/policy.ts`, `src/profile.ts`, `src/store.ts`,
`test/approval-stage.test.ts`, `test/cli.test.ts`,
`test/implementation-stage.test.ts`, `test/plan-stage.test.ts`,
`test/policy.test.ts`, `test/profile.test.ts`, `test/spec-stage.test.ts`,
`test/store.test.ts`) plus every untracked file read in full:
`governed.yaml`, `src/governed-config.ts`, `src/verification-stage.ts`,
`src/verify-command.ts`, `test/governed-config.test.ts`,
`test/verification-stage.test.ts`, `test/verify-command.test.ts`,
`test/fixtures/verify/` (seven fixtures),
`docs/proposals/verification-containment.md`, and this feature folder.
`npm run typecheck` clean, `npm test` 427 passed / 1 skipped / 0 failed,
`npm run check:docs` clean.

## Summary

The stage does what the plan set out to do, and the parts the plan review
called critical are genuinely built rather than claimed: the environment
canary is asserted in both directions, the frozen ceilings are read from the
profile rather than from the module constants, the recorded implementation
head is required rather than skipped, and the handoff is a structured record
naming the worktree and the verified commit. All twenty-four break-restore
cycles in `2026-08-30-break-it.md` failed while broken, so every guard here is
verified rather than asserted.

The three findings cluster on **what happens at the edges of a limit** — one
where a precondition fires against the system's own state, one where a limit
was declared for memory and left off disk entirely, and one where a single
policy number means two different things in two callers. None of them is a
logic error inside the stage's decision path, which is the part the plan spent
its care on.

Withheld: the unbounded in-memory `stderr` accumulation in `invokeHarness` —
pre-existing, mirrored rather than introduced, and noted inside finding 3
rather than filed against this diff. Also withheld: the fact that
`Profile.startingCommit` remains `string | null` while `new-run` can no longer
produce a null, leaving the approval gate's "created outside a repository"
refusal unreachable through the only surface. That is dead-branch drift with
no failure scenario, and the plan explicitly flagged the git precondition as
strikeable, so the branch may be deliberate slack. Also withheld: style,
naming, and the stage's `process.stderr.write` progress line — it makes
`src/verification-stage.ts` the only core module that prints, which departs
from every other stage, but the plan reasoned that choice out explicitly and
hard rule 2 is about a second entry point, not about output.

One test-fidelity note that is not a finding: `refreeze` in
`test/verification-stage.test.ts` rewrites `profile.policy` without recomputing
`profile.policyHash`, so the profiles those tests load are internally
inconsistent in a way the approval gate would reject. The property under test —
that the stage reads the frozen value — is still genuinely exercised, because
nothing in the stage's path consults `policyHash`.

## Findings

**Finding 1 — `bw new-run` cannot create a run in any repository that has not
gitignored `.governance/`, and `new-run` itself is what dirties the tree.**

- **Where:** `src/cli.ts`, the `new-run` case (the `git status --porcelain`
  precondition), reached after `openStore()` has already run at the top of
  `main()`. `test/cli.test.ts`'s `tempCwd()` conceals it by writing
  `.gitignore` with `.governance/` before the first CLI call.
- **Why it matters:** `openStore()` runs before the switch, so the first
  `bw new-run` in a fresh repository creates `.governance/state.db`, and the
  clean-tree check then reports `?? .governance/` and refuses. The refusal is
  permanent: every subsequent attempt hits the same directory it created
  itself. A repository that satisfies section 7 exactly — clean tree,
  `governed.yaml` committed — still cannot start a run. This is hazard 11, a
  default installation that cannot complete a run, and the checklist's own
  entry for it asks for a test asserting the opposite. `ARCHITECTURE.md`
  section 15 anticipates the class ("make the ignore rules match") but nothing
  in the refusal tells the operator that is the fix, and nothing enforces it.
- **Reproduced:** CONFIRMED. In a scratch repository: `git init`, commit a
  valid `governed.yaml`, confirm `git status --porcelain` is empty, then run
  `bw new-run --project p --feature f-1 --slug s --change-kind feature
  --model m`. Output: `the working tree is not clean: a run starts from a
  committed state (section 7). 1 path(s), first: ?? .governance/`, with
  `git status --porcelain` afterwards showing `?? .governance/` — created by
  that same invocation. Reproduced twice: once with `bw migrate` first, once
  with `new-run` as the very first command. The scratch repositories were
  outside the working tree and have been removed.

**Finding 2 — the retained evidence file has no ceiling of any kind, so a
command that writes continuously fills the disk before the time ceiling
fires.**

- **Where:** `src/verify-command.ts`, `keep()` — `evidence.write(chunk)` runs
  before and independently of the `maxBytes` budget, and nothing counts or
  caps what reaches the file. The stage passes
  `profile.policy.resultMaxBytes` as the in-memory budget and
  `profile.policy.verifyCommandTimeoutSeconds` (900) as the only other bound.
- **Why it matters:** `ARCHITECTURE.md` section 20 requires that every limit
  define its behaviour on breach. The in-memory limit does. The disk has no
  limit at all, and 900 seconds is a long time at pipe speed. A test suite
  stuck in a logging loop — not an exotic failure, and precisely the kind of
  thing verification exists to catch — writes until the ceiling. The run then
  blocks correctly on `outputOverflow`, but the machine may have run out of
  disk first, which takes down the run store, the audit chain, and anything
  else on that volume. Hazard 2 argues for retaining bytes above the cap; it
  does not argue for retaining an unbounded stream.
- **Reproduced:** CONFIRMED, and measured rather than reasoned. A fixture
  writing 64 KB chunks to stdout continuously, run through `runVerifyCommand`
  with `maxBytes` 1 MB and a 5-second ceiling, produced: in-memory stdout
  exactly 1048576 bytes (the budget held), retained on disk 5972230144 bytes —
  5.7 GB in 5.2 seconds, about 1.1 GB/s. Extrapolated to the frozen
  900-second ceiling that is roughly 955 GB. `outputOverflow` and `timedOut`
  were both true, so the decision path behaved correctly; only the retention
  was unbounded. The 5.7 GB scratch file has been removed.

**Finding 3 — `resultMaxBytes` bounds stdout alone in one caller and both
streams combined in the other, and the plan records the reverse.**

- **Where:** `src/verify-command.ts` `keep()` (one `keptBytes` counter shared
  by both streams) against `src/harness.ts` `invokeHarness`
  (`stdoutBytes` guards `child.stdout` only; `child.stderr`'s handler is
  `stderrChunks.push(d)` with no budget). Both read the same policy value,
  `resultMaxBytes` / `RESULT_MAX_BYTES`.
- **Why it matters:** hazard 12 is configuration divergence between targets,
  and the checklist locates it as "two surfaces enforcing different rules for
  one stage". One policy number now means "the stdout budget" when a harness
  invocation spends it and "the combined budget" when a verification command
  does. An operator raising `RESULT_MAX_BYTES` to give a chatty test suite
  room gets a different effective allowance in each caller, and a stderr-heavy
  command overflows at a threshold the policy value does not describe. The
  plan's own assumption states the combined choice is "matching how
  `invokeHarness` spends one budget across both", which is not what
  `invokeHarness` does — so the divergence is recorded as a similarity, which
  is how it survives review.
- **Reproduced:** CONFIRMED by reading both call sites, which is sufficient
  here because the difference is structural rather than conditional:
  `src/harness.ts:225-239` bounds only `child.stdout`, and
  `src/verify-command.ts`'s `keep()` is called from both stream handlers with
  one shared counter. The unbounded `stderr` accumulation in `invokeHarness`
  is pre-existing and is **not** filed as part of this finding; what is filed
  is that this diff gives the same policy value a second, different meaning
  without naming the difference.

---

## Reconciliation

**Date:** 2026-08-30

**Disposition:** 3 accepted, 0 rejected, 0 deferred, 0 open

**Status:** reconciled

### Verdicts

- **Accepted — `bw new-run` cannot create a run unless `.governance/` is
  gitignored.** The clean-tree check now excludes paths under `.governance/`,
  with a comment naming why: `openStore()` has already created the state
  directory by the time the check runs, so the invocation would be reporting a
  tree only it had dirtied. A genuinely dirty tree is still refused —
  confirmed in a scratch repository in both directions. `test/cli.test.ts`
  gains a regression test that builds a repository with **no** `.gitignore`,
  asserts the tree is clean, creates a run successfully, and then asserts
  `.governance/` is present and untracked, which is the condition the check
  must not treat as operator dirt. That is the assertion hazard 11 asks for
  and the previous helper concealed.

- **Accepted — the retained evidence file has no ceiling.**
  `VERIFY_RETENTION_MAX_BYTES` (64 MB — sixty-four times the result budget)
  is added to policy, frozen in the profile, and passed to the runner as
  `retentionMaxBytes`. On breach the process tree is killed and
  `outputOverflow` is already set, so the refusal still names overflow rather
  than a timeout. `ARCHITECTURE.md` section 20's result-size bullet is amended,
  because "retain the bytes anyway" is a rule written about a bounded result
  and this is where it stops holding. A `flood-forever.mjs` fixture and a test
  cover it; removing the ceiling in a scratch mirror made that test fail with
  `retained 116092370944 bytes, ceiling 2097152` — 116 GB inside a 120-second
  window — which is the guard proven by breaking it.

  **One judgment call for the operator:** 64 MB is chosen, not derived. It is
  large enough that no honest suite is truncated and small enough that a
  runaway command costs seconds of disk rather than a volume. Raise or lower it
  in `src/policy.ts`; it is frozen per run either way.

- **Accepted — `resultMaxBytes` means different things in two callers.** The
  behaviour stands: combined across both streams is right for a verification
  command, whose diagnosis is as likely to be on stderr as stdout. What is
  fixed is that the divergence is now named where a reader will meet it — the
  `maxBytes` doc comment in `src/verify-command.ts` states that
  `invokeHarness` spends the same value on stdout alone and why that is
  correct there — and the plan's assumption, which recorded the divergence as
  a similarity, is corrected in place and marked as corrected during
  implementation. The unbounded in-memory `stderr` accumulation in
  `invokeHarness` remains pre-existing and unfiled.
