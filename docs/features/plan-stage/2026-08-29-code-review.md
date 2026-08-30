# Plan Stage Implementation — code review

**Reviewed document:** `C:\Users\Shawn-work\repositories\governed-delivery\docs\features\plan-stage\plan.md`
**Document type:** Code review of the implementation of that plan (build order step 5), not of the plan text. Findings name source locations; the reconciliation below records what changed in code. The plan document is named as the reviewed document because it is what governs the implementation and what the reconciliation must stay consistent with.
**Review date:** 2026-08-29
**Hazards considered:** `docs/hazards.md` 4 (fixtures and code agreeing while both are wrong — every accepted fix here was seen failing against the unfixed code before it landed), 5 (completion without delivery — finding 4 is the plan-time half of this; the delivery half stays with step 6), 6 (promises a later stage cannot keep — finding 4's disposition turned on which half of this hazard the plan gate owns), 10 (exact-match model acceptance against moving aliases — findings 3 and 6 are both about how far the run-start model snapshot reaches), 12 (configuration divergence between targets — finding 3 exactly: two surfaces enforcing different rules for one stage), 14 (independence that cannot be proven — finding 1: an unverified profile hash makes the frozen configuration asserted rather than proven). Entries 1 and 3 do not apply: no finding concerns model-output parse shapes or a constrained field missing from a prompt, both of which the step's own tests already cover. Entries 2, 7, 8, 9, 11 and 13 bear on code this review did not find fault with.

**Scope reviewed:** `git diff HEAD` plus the untracked new files (`src/plan-stage.ts`, `src/plan-doc.ts`, `src/plan-gate.ts`, `src/agents/plan-author.ts`, their tests, and the fixture harness). `npm run typecheck`, `npm test` (302 pass at review time), and `npm run check:docs` were clean.

---

## Summary

The `plan` / `plan_review` orchestration is a faithful mirror of the shipped spec stage, and the three critical issues the design review raised were all actually implemented: frozen-map enforcement on `bw dispatch`, `requireRunInProgress` on `stage-add` and `dispatch`, and spec re-verification against the `spec.gate.pass` hash. Defects that are exact mirrors of the already-shipped `runSpecStage` pattern — findings accumulating across rounds, the revision written to disk before validation — were not re-reported: they are pre-existing, not introduced here.

Six findings. Three concern the frozen profile and the model map; one concerns what the coverage gate actually enforces; one is a usage-error regression on `--model`; one is a forward-compatibility question about the map's shape.

## Findings

**Finding 1 — the frozen profile is read without verifying its hash**

- **Where:** `src/plan-stage.ts` (profile load), `src/spec-stage.ts` (same), `src/cli.ts` (the `dispatch` case).
- **Why it matters:** `loadProfile` returns the hash and leaves the comparison to its caller — its own doc comment says so. Three callers read `.profile` and discard `.hash`, so the model map is enforced but not tamper-evident: editing `.governance/profiles/<run>/profile.json` changes which model a run may use and nothing objects. `buildBinding` does make the comparison, so the same rule was enforced at one site and skipped at three.
- **Reproduced:** editing `modelMap.spec` on disk let `bw spec --model tampered-model` pass the frozen-map check.

**Finding 2 — the plan stage does not check the approval's expiry**

- **Where:** `src/plan-stage.ts`, where the approval row is read for its scope.
- **Why it matters:** the approval carries `expires_at` and the plan stage never reads it, so an authorization could fund a full author-plus-panel spend long after it was signed. `validateExpiry` already exists with refusal wording and is used only at `bw approval-request` and `bw approve`.

**Finding 3 — the review panel's model is never resolved from its own map entry**

- **Where:** `src/plan-stage.ts` and `src/spec-stage.ts`: only the author's stage kind (`"plan"` / `"spec"`) was resolved, and that model was reused for every reviewer dispatch.
- **Why it matters:** the `plan_review` and `spec_review` entries were never consulted by the stages, while `bw dispatch` resolves by `stage.kind` and would enforce them. The values coincide today, so nothing breaks — but the map exists precisely so they need not coincide, and the moment they diverge two surfaces disagree about one stage. This is hazard 12 inside a single codebase.

**Finding 4 — the coverage gate never checks that every acceptance criterion is covered**

- **Where:** `src/plan-stage.ts`, after the content write; `src/plan-gate.ts`.
- **Why it matters:** `coverageFitsScope` answers "may the plan promise this artifact". Nothing answered "did the plan promise anything for this criterion at all". A plan covering one of five criteria satisfies scope perfectly and passes the gate with `gate_result=pass`, even though the author prompt states one line per acceptance criterion. `specDoc.value.acceptanceCriteria` is already parsed in the same function.

**Finding 5 — `--model` supplied without a value became a confusing runtime error**

- **Where:** `src/cli.ts`, the `spec`, `plan`, and `dispatch` cases.
- **Why it matters:** making the flag optional replaced `required()` with `args.get()`. `parse()` records a valueless flag as `""` specifically so it can be reported by name, so `bw spec --run 1 --model` became the empty-string model and failed downstream as a frozen-map mismatch — exit 1 with `--model  does not match the model frozen at run start (…)` instead of a usage error naming the option. The `approval-request` case handles the same situation explicitly; these three did not.
- **Reproduced.** Introduced by this step, not pre-existing.

**Finding 6 — `modelMap` freezes four of the eight stage kinds**

- **Where:** `src/profile.ts`.
- **Why it matters:** `ARCHITECTURE.md` section 5 names eight stage kinds; the map freezes `spec`, `spec_review`, `plan`, `plan_review`. Once step 6 lands `implementation`, a run created now can never dispatch it, and the profile is frozen with no repair path. It fails loudly at configuration time, which is correct, but unrecoverably for that run.

---

## Reconciliation

**Date:** 2026-08-29
**Disposition:** 4 accepted, 1 rejected, 1 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — the frozen profile is read without verifying its hash:** added `loadVerifiedProfile` to `src/profile.ts`, which refuses a missing `profile_ref`, a missing file, and a hash that differs from the one frozen at intake. All four consumers now go through it — the two stages, the `dispatch` case, and `buildBinding`, whose inline comparison it replaces — so the rule lives in one place and cannot be remembered at one site and forgotten at another. `buildBinding` now takes `profileHash` from the verified hash rather than the nullable column.
- **Rejected — the plan stage does not check the approval's expiry:** the expiry is the *human signing window*. It bounds `bw approval-request` → operator signs → `bw approve`, and `validateExpiry` runs at both ends of exactly that span. Re-checking it at the plan stage would silently repurpose it as an authorization lifetime and strand a run whenever planning happened later than the signing window — with no in-place repair, which is hazard 6's failure shape. Operator decision: an approval that takes thirteen hours is a slow approval, not an invalid one. The `awaiting_approval` row is the durable authorization. **Related change made instead:** the one-hour default was too short for a human gate and was a literal in `src/cli.ts`. It is now `APPROVAL_DEFAULT_LIFETIME_SECONDS` in `src/policy.ts` at eight hours, part of `buildPolicy()` and therefore frozen per run and recorded in the profile, so a run states the window its approval was granted under. The 24-hour ceiling is unchanged and the default stays inside it.
- **Accepted — the review panel's model is never resolved from its own map entry:** both stages now resolve `plan_review` / `spec_review` separately and dispatch reviewers with that model. An unmapped review kind fails at configuration time like any other, before an invocation.
- **Accepted — the coverage gate never checks that every acceptance criterion is covered:** added `coverageMeetsCriteria` to `src/plan-gate.ts`, run immediately after `coverageFitsScope` and before the panel, blocking with `plan.coverage.incomplete` and naming the uncovered criteria in both the reason and the audit event. The comparison normalizes case and collapses whitespace, deliberately unlike `coverageFitsScope`'s exact-string test: a scope entry is a path the operator signed, so its spelling is load-bearing, while a criterion is prose restated by a model that nobody signs. **Known limit, unchanged:** this is still the plan-time half. Hazard 5's "every declared artifact appears in the changed paths of an applied patch" belongs to step 6 and is not claimed here.
- **Accepted — `--model` supplied without a value became a confusing runtime error:** added `optional()` beside `required()` in `src/cli.ts`, which returns `undefined` for an absent flag and raises `option --<name> was given without a value` for one supplied empty. Used by all three cases that read `--model`.
- **Deferred — `modelMap` freezes four of the eight stage kinds:** trigger is build order step 6. The plan decided one entry per stage kind that exists today, and section 10 has a stage name what it needs; pre-freezing `implementation`, `verification`, and `delivery_check` would assert a model for three stages whose requirements nobody knows. Nothing has shipped, so no migration is owed and no existing run is stranded by waiting. Step 6 extends the map with knowledge of what the implementation stage actually needs.

### Verification

`npm run typecheck`, `npm test` (311 pass, up from 302), and `npm run check:docs` all clean after reconciliation. Each accepted fix was seen failing against the unfixed code first: finding 1 against a new tampered-profile test *and* the pre-existing `a profile altered after freezing is refused naming both hashes`, which confirms the `buildBinding` refactor preserved its behaviour; finding 3 against a profile with `plan_review` removed; finding 4 against a plan omitting two of three criteria; finding 5 against `bw spec --model` with no value.

---

## Second review pass — independent high-effort review

**Date:** 2026-08-29
**Disposition:** 15 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — revision round skips `coverageMeetsCriteria`:** the revision path now re-runs the completeness gate on the parsed candidate before the write; proven by a test that drops a criterion's coverage line in round 2 — seen failing when the gate was removed from the revision path, exactly that test and no other.
- **Accepted — plan-doc parser split defects:** coverage splits at the last `->`; `not_applicable` splits at the last ` / `; the decision form is `not_applicable\s*:`, so `not_applicable.test.ts` is an artifact and a bare or spaced `not_applicable` stays refused. Four new parser tests.
- **Accepted — no model-name validation:** `validateModelName`, shared by `freezeProfile` and `new-run`, refuses names the Windows spawn argv cannot carry; the CLI refuses before the run row exists, so a typo cannot create a blocked run.
- **Accepted — rejected revisions overwrite `plan.md`:** all three checks run on the parsed candidate before the write; the revision-drop test asserts the gated document is still the file on disk.
- **Accepted — `stage-add` usage-error ordering and valueless `--input`:** arguments evaluate before the run-status guard; `numericOptional` holds the same valueless-flag convention as `optional()`.
- **Accepted — `plan.gate.pass` omits `planFor`:** the event records it, and the gate-record test pins the full summary exactly, including `risk=low` and a panel of one (distinct reviewers, not dispatch rows).
- **Accepted — four missing test guards:** the panel-size refusal is proven through the new `deps.selectPanel` seam (seen failing when the seam was bypassed, exactly one test); the fixture's scope scrape throws instead of falling back to a literal path; the wedge-guard catch is exercised by a forced `insertFinding` throw; the fixture's fallback removal makes scope-binding degradation loud.
- **Accepted — stale `Profile` doc comment:** the model map is now described as present, the verification config as the remaining absence.
- **Accepted — `coverageMeetsCriteria` unrecorded in `plan.md`:** Task 4 Step 1 names the three gate functions, Task 5 Step 3 records the completeness gate on first write and every revision, Task 5 Step 6 lists its break-it run, and the panel-size deviation is superseded by the seam.

### Verification

`npm run typecheck`, `npm test` (322 pass, up from 311), and `npm run check:docs` all clean. Two break-it runs observed live: the panel seam bypassed (only the unstaffable-panel test failed) and the revision completeness gate removed (only the revision-drop test failed).
