# Step-6 Trust-Boundary Correction — code review

**Reviewed document:** `docs/features/step6-trust-boundary/plan.md`
**Review date:** 2026-08-31

**Hazards considered:** 3 (the read-only constraint is stated in the prompt and the source scan covers it — finding 1 is this entry's class, a deviation from the stated constraint's exact form), 4 (the new fixture modes derive from the recorded smoke reproductions and every stage-level regression was seen failing before the fix landed, except the two the plan itself records as passing-first), 8 (the executor keeps the one shell-resolved harness; the new flags are constants), 11 (no `--bare`; the implementation capability is declared and tested), 12 (the binding is one helper enforced identically at all four construction sites — the CLI and the stages cannot disagree), 14 (independence recording untouched). Entries 1, 2, 5, 6, 7, 9, 10, and 13 do not bear on this review: parsing and raw-output retention are unchanged, the delivery check is step 8's, no promises or retries changed, no setup-time spawns were added, the model map is unchanged, and no validator invents obligations.

**Scope reviewed:** `git diff e9e56b4 de5bd84` (the implementation commit: 19 files, 921 insertions, 93 deletions) — `src/executor.ts`, `src/profile.ts`, `src/select.ts`, `src/spec-stage.ts`, `src/plan-stage.ts`, `src/implementation-stage.ts`, `src/cli.ts`, `src/prompts.ts`, `ARCHITECTURE.md`, `docs/hazards.md`, and the eight test files plus the fixture. No untracked files at review time (the working tree was clean after the commits; `git status --porcelain` empty).

## Summary

The implementation matches the governing plan closely: every guard the plan specified is present at the specified site, the six break-restore cycles were recorded in Task 7, and the full gate (typecheck, 384 tests, doc-check) is green. One real defect found: a meta-comment about the system's own enforcement leaked into the delivered implementer prompt, deviating from the plan's exact sentence. One mechanism deviation from the plan (the fixture-freeze call site) is functionally equivalent and proven by the suite; it is recorded here so the implementation note can name it. Withheld: the test-setup updates the new binding forced (`cli.test.ts`'s `--agent a` became a real agent id; the standalone spec-stage test gained a freeze line) — these are necessitated consequences of the enforcement, not defects.

## Findings

**Finding 1 — the implementer prompt delivers a meta-comment about the system's enforcement**

- **Where:** `src/prompts.ts` (`buildImplementationAuthorPrompt`), the read-only sentence block.
- **Why it matters:** the plan (Task 6, Step 2) specifies the sentence exactly: `This checkout is read-only for you: do not create, modify, or delete any file. Only the patch content you return is considered.` The delivered prompt appends a parenthetical that was meant as a code comment: `(This sentence is UX, not a guard: the session runs without write tools and the system checks the worktree before and after dispatch.)`. The model receives unplanned content that reveals the backstop — the plan's framing is that the sentence is UX precisely because enforcement must not be a matter the model negotiates, and telling the model the worktree is checked afterwards invites the "they'll discard it anyway" reading the whole correction exists to close. It is also a plan divergence on its own: the governing document specified the exact sentence, and the checklist treats divergence from the plan as a finding even when the code works.
- **Reproduced:** confirmed by direct comparison — the plan's sentence in `docs/features/step6-trust-boundary/plan.md` Task 6 Step 2 against the delivered string in `src/prompts.ts:213-218`. The prompt tests pass because they assert `includes`, not exact equality — which is why the leak survived the suite.
- **Fix:** move the parenthetical to a code comment above the `return` statement; deliver exactly the plan's sentence.

**Finding 2 — the fixture-freeze mechanism deviates from the plan's specified option**

- **Where:** `test/spec-stage.test.ts` and `test/plan-stage.test.ts` (the scratch-executor call sites).
- **Why it matters:** the plan (Task 2, Step 1) specifies that the run-setup helpers gain `opts.executor?: ExecutorDefinition` and every scratch test passes its executor through the option. The implementation instead freezes the default fixture in the helper and adds an explicit `freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch))` call at each scratch site. The contract is identical — every test freezes exactly the executor it hands, which the binding enforcement and the green suite prove — so this is a mechanism deviation, not a behaviour one.
- **Reproduced:** confirmed by reading both files; the binding regressions and the full suite (384 tests) demonstrate the contract holds.
- **Fix:** none required; record the deviation in the plan's implementation note so the plan and the code do not silently disagree about the mechanism.

## Checks

- `npm run typecheck` — clean.
- `npm test` — 384 tests, 383 pass, 1 recorded skip, 0 fail (on master's tree before the review file).
- `npm run check:docs` — clean (the pre-existing historical path warnings remain).
- The rebased `step7` tree (correction + verification stage): 446 tests, typecheck and doc-check clean.

---

## Reconciliation

**Date:** 2026-08-31
**Disposition:** 2 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — Finding 1: the implementer prompt delivers a meta-comment about the system's enforcement:** `src/prompts.ts` now carries the comment above the `return` statement and the delivered prompt holds exactly the plan's sentence; the prompts suite passes and the fix is committed on master (`f55dbd4`).
- **Accepted — Finding 2: the fixture-freeze mechanism deviates from the plan's specified option:** no code change — the contract (every test freezes exactly the executor it hands) is proven by the binding regressions and the green suite; the deviation is recorded in the plan's implementation note.
