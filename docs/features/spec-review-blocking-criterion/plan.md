# Spec Review Blocking Criterion Implementation Plan

**Status:** Implemented

**Goal:** A `spec_review` finding blocks only when the design cannot be implemented without the missing decision; questions about going beyond a baseline the design already states become non-blocking follow-ups, and the spec author stops listing them as open decisions.

**Source:** Operator decision, 2026-09-27, after team-notes run 1 (external target `C:\Users\Shawn-work\repositories\testing-repos\team-notes`, $1.4078) blocked at `spec_review` on OD-001 (extra access control for the full-collection export) and OD-003 (password-reset token properties). The operator's reasoning: designs added to BuildWorks will often be less detailed than this PRD, and questions like OD-001 are not necessary to build the feature. `ARCHITECTURE.md` section 13 already states the test: `upstream_blocking` blocks "because filing a missing decision does not make the approved input implementable". No prompt states that test, so the reconciler chooses a disposition on how serious a question sounds (run 1 rationales: "higher-value target", "primary account-takeover vector"). Note-keeper run history (runs 1-6, 2026-09-26) shows the same pattern: runs 1 and 6 blocked on security questions the design never raised, runs 4 and 5 passed.

**Hazards considered:** `docs/hazards.md` items 3, 4, 13 and 16.
- **16 (upstream routing):** this is the entry under change. The routes, proposal storage and gate are unchanged; only the stated criterion for choosing `upstream_blocking` over `upstream_follow_up` is new. A follow-up still writes a proposal, so no concern is dropped.
- **13 (specifications inventing obligations):** hardening beyond the design must not become an acceptance criterion either. The new sentences route it to a follow-up proposal and tell the author not to list it, rather than inviting a criterion.
- **3 (constraint stated in the prompt):** the criterion is stated in the prompt that makes the choice (spec reconcile), and the membership rule for `## Open decisions` in every prompt that writes the section. Each is pinned in `CONSTRAINT_STRINGS` and in per-prompt assertions.
- **4 (fixtures agreeing with code):** the expected wording comes from this plan and the architecture sentence it quotes, not from the implementation. Each new pin is proven by removing its sentence and confirming the test fails.

Items 1, 2, 5-12, 14, 15, 17 and 18 do not govern this change: it touches no output shape, parser, retention, delivery, retry, executable resolution, hook, model alias, seeding, configuration, independence claim, sandbox, deletion accounting or code-review gate.

**Scope:** `spec_review` prompts only, matching the scope of `docs/features/disclosed-open-decisions/plan.md`. The shared decision contract (`reconciliationDecisionContract`) and the plan-side prompts are unchanged; whether `plan_review` needs the same criterion is a separate decision. No deterministic gate change: the gate still reads dispositions only (`specReviewGate`, `src/spec-stage.ts`).

**Known blockers:**
- **Fixture routing.** `test/fixtures/harness/emit-spec-stage.mjs` routes by prompt substring, so new text must not contain `self-critique`, `spec reviewer`, `reconcile` (in the draft prompt, which carries `openDecisionsSchema`) or `finding ` followed by a digit.
- **One-line pins.** `CONSTRAINT_STRINGS` scans the source, so each pinned phrase sits on one source line.
- **Baseline failures.** Two unrelated tests fail today: the dashboard SIGTERM test (SQLite `ExperimentalWarning` on stderr) and "nothing under src/ touches a private key".
- **No paid run.** The behaviour change is unmeasured until a separately authorized live run.

**Verification:** `node --test test/prompts.test.ts`, `npm run typecheck`, `npm test` (no new failures against the baseline), `npm run check:docs`, `git diff --check`, and one break-test per new pin.

---

## Tasks

- **Task 1: State the criterion in the spec prompts (`src/prompts.ts`).**
  - `openDecisionsSchema`: after the ID/severity line, add `List only a decision the design needs and does not make: one without which a behavior the design states cannot be written as a testable acceptance criterion. Protection, limits, or policy beyond what the design asks for is not an open decision; leave it out.` This reaches the draft, self-critique and reconcile prompts.
  - `buildSpecSelfCritiquePrompt`: "Where the design leaves a decision open, record it" becomes "Where the design needs a decision it does not make, record it".
  - `buildSpecReviewPrompt`: "Report a question the design leaves open that the section omits" becomes "Report a decision the design needs but does not make that the section omits", so reviewers do not report every omitted hardening question as a missing disclosure.
  - `buildSpecReconcilePrompt`: after the author-disclosure paragraph, add the blocking criterion: `upstream_blocking` only when the design states a behavior and leaves a decision without which no acceptance criterion for it can be written; a question about adding protection, limits or policy beyond a workable baseline the design states is `upstream_follow_up`; severity or how serious a risk sounds does not by itself make a finding blocking. It applies to every finding, reviewer-raised or disclosed.
  - Verify: `node --test test/prompts.test.ts`. Expected: passes (existing pins keep their substrings).
- **Task 2: Pin the sentences (`test/prompts.test.ts`).**
  - Add the new phrases to `CONSTRAINT_STRINGS`, and to the per-prompt assertions for the draft, self-critique, reviewer and spec reconcile prompts.
  - Break-test in a scratch mirror: remove each new sentence in turn; the named test fails by assertion. Restore.
  - Verify: `node --test test/prompts.test.ts`. Expected: all pass.
- **Task 3: Record the criterion in `ARCHITECTURE.md`.**
  - Section 8 (open-decisions paragraph): an entry is a decision the design needs and does not make, not a question about exceeding it.
  - Section 13 (upstream routing paragraph): the test for `upstream_blocking` is implementability, not severity; a question about going beyond a baseline the design states is a follow-up, and the spec reconcile prompt states this.
  - Verify: `npm run check:docs`. Expected: exit 0, no new findings.
- **Task 4: Full verification and plan closure.**
  - `npm run typecheck`, `npm test`, `git diff --check`. Expected: clean typecheck; no failures beyond the two baseline tests.
  - Set this plan's status to `Implemented` with an implementation note.

## Implementation note (2026-09-27)

- **Shipped as planned, with no deviations.** Four prompt changes in `src/prompts.ts`, pins in `test/prompts.test.ts`, and two clarifying sentences in `ARCHITECTURE.md` (sections 8 and 13).
- **Verification.**
  - `test/prompts.test.ts` and `test/spec-stage.test.ts` pass 77 of 77.
  - `npm run typecheck` is clean and `npm run check:docs` reports clean.
  - The full suite passes 1216 of 1224; the 2 failures are the baseline pair named under Known blockers.
- **Break-tests.** Removing each of the five new sentences, or reverting either reworded sentence, failed the named tests by assertion. The mirror was deleted afterwards.
- **Coverage gap.** Removing the "Protection, limits, or policy" sentence does not fail the reconcile prompt's own test, only the draft and self-critique prompts' tests and the whole-file scan. That prompt carries the sentence through the shared schema.
- **Test leak.** The full-suite run left an empty "moved" commit (author `t`) on the branch, the known test-suite leak. It changed no files and was removed with `git reset --soft d2954d9`.
- **Unmeasured.** Whether a live reconciler follows the stated criterion is unknown until a separately authorized paid run. Against team-notes run 1's design, the criterion predicts OD-001 and OD-003 become `upstream_follow_up`, and spec review passes.
- **Not done.** `plan_review` has no equivalent criterion. That is out of scope and a separate decision.
