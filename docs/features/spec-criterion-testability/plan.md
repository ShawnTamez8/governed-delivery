# Spec Criterion Testability Implementation Plan

**Status:** Implemented

**Goal:** The spec author writes every acceptance criterion as a pass/fail check. When the design states a behavior in subjective or unquantified terms, the author writes only the checkable part as a criterion and records the undecided part as an open decision. Subjective guidance with no checkable part (visual tone) goes in an Out of scope note. A vague phrase is never copied into a criterion.

**Source:** Operator question, 2026-09-27, after team-notes run 3 (external target `C:\Users\Shawn-work\repositories\testing-repos\team-notes`, $1.6186, blocked at `spec_review`): "Why is the model providing non-deterministic requirements. 'meaningful content change' is not deterministic. Neither is 'calm, focused, lightweight'." Evidence from run 3:
- Both phrases are verbatim PRD text (`design.md` lines 104, 170, 173); the model did not invent them.
- The author copied line 104 into **AC-041**: "A meaningful content change to a note automatically creates a new version…". It also listed the same gap as OD-001, so the spec both asserts and disclaims one criterion.
- The author wrote nothing for the design-tone lines. A reviewer flagged the gap (finding 19), the reconciler answered with an Out-of-scope note and wrongly claimed it as a normative change, and deterministic validation converted the decision and blocked the run.

A comparison of `buildSpecAuthorPrompt` and `buildSpecSelfCritiquePrompt` on `master` (`e0d7ca6`) and this branch found that neither version asks for a checkable criterion. `master` never uses "testable", "observable", "measurable", "verifiable", "subjective", "deterministic" or "checkable". The branch uses "testable" only inside the `## Open decisions` membership rule. The branch tightened the criterion *format* (line form, IDs, one per line), not its *content*.

**Hazards considered:** `docs/hazards.md` items 3, 4, 13 and 16.
- **3 (constraint stated in the prompt):** a checkable-criterion rule the author is never told about cannot be followed. The rule is stated in both prompts that write a specification, the draft and the self-critique, and each sentence is pinned.
- **13 (specifications inventing obligations):** "make it concrete" can push the author to invent a threshold (for example "a version every 30 seconds"). The rule therefore allows a concrete reading only where the design grounds it, and otherwise sends the undecided part to `## Open decisions`, where the operator decides it through `spec_decision`. It never asks the author to choose a number.
- **16 (upstream routing):** more open decisions mean more disclosed findings and possibly more operator questions per run. That is the intended route: the operator's answer becomes the concrete criterion when the fold runs (run 3's OD-001 recommendation was "coalesce edits within the autosave debounce window"). The routes and gate are unchanged.
- **4 (fixtures agreeing with code):** the expected sentences come from this plan, not from the implementation. Each pin is proven by removing its sentence and confirming the named test fails.

Items 1, 2, 5-12, 14, 15, 17 and 18 do not govern this change: it touches no output shape, parser, retention, delivery, retry, executable resolution, hook, model alias, seeding, configuration, independence claim, sandbox, deletion accounting or code-review gate.

**Scope:** the spec draft and self-critique prompts only, the two places the author writes and then checks its own criteria. Out of scope, each a separate decision:
- **The reviewer prompt.** Reviewers already catch vague criteria; the goal is to reach review with fewer of them.
- **The spec reconcile and decision-fold prompts.** They also write criteria, but from a reviewer finding or an operator answer.
- **Plan prompts.**
- **A deterministic vague-word check in `validateSpecDoc`.** A word list would refuse legitimate criteria ("fast-forward merge") and is not a two-implementation-backed design.
- **Run 3's other defect**, the reconciler claiming an Out-of-scope note as a normative change. This plan removes the path that produced it (tone guidance now goes to Out of scope while drafting, not after a reviewer finding) but does not change the validator.

**Known blockers:**
- **Fixture routing.** `test/fixtures/harness/emit-spec-stage.mjs` routes by prompt substring, so the new text must not contain `self-critique`, `spec reviewer`, `reconcile` or `finding ` followed by a digit.
- **One-line pins.** `CONSTRAINT_STRINGS` scans the source, so each pinned sentence sits on one source line.
- **Baseline failures.** The dashboard SIGTERM test and "nothing under src/ touches a private key" fail today.
- **Full suite.** Parallel `npm test` crashes on the heap limit, at baseline too. Use `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`.
- **Unmeasured until a paid run.** A prompt rule narrows model judgement; it does not settle it (project learnings, 2026-09-27). Whether the author follows it is known only from a separately authorized live run.

**Verification:** `node --test test/prompts.test.ts test/spec-stage.test.ts`, `npm run typecheck`, the serial full suite (no failures beyond the baseline pair; `git log -1` unchanged), `npm run check:docs`, `git diff --check`, and one break-test per new sentence.

---

## Tasks

- **Task 1: State the rule in both spec-writing prompts (`src/prompts.ts`).**
  - Add a shared helper `criterionQualityRule(indent)`, following `openDecisionsSchema`, so the draft and self-critique prompts cannot drift. Call it in each prompt's `## Acceptance criteria` bullet, after the format rules. It states three sentences, each on one source line:
    - `Every acceptance criterion must be decidable by one objective pass/fail check: a specific input, action, value, or observable outcome, never a subjective or unquantified term such as fast, meaningful, intuitive, or clean.`
    - `Where the design states a behavior in subjective or unquantified terms, write only its checkable part as a criterion, and record the undecided part under ## Open decisions instead of choosing a threshold the design does not state.`
    - `Guidance with no checkable part, such as visual tone or typographic feel, belongs in an Out of scope note, not in a criterion.`
  - `buildSpecSelfCritiquePrompt`: in the critique instructions, add `Check every acceptance criterion against that rule and rewrite, split, or move any criterion that fails it.`
  - Verify: `node --test test/prompts.test.ts test/spec-stage.test.ts`. Expected: passes. Existing pins keep their substrings, and the fixture routes the new prompts unchanged.
- **Task 2: Pin the sentences (`test/prompts.test.ts`).**
  - Add the three rule sentences to `CONSTRAINT_STRINGS`. Assert all three in the draft and self-critique prompt tests, and the self-critique check sentence in the self-critique test.
  - Break-test in a scratch mirror: remove each sentence in turn, then the helper call from each prompt. The named test fails by assertion each time. Restore.
  - Verify: `node --test test/prompts.test.ts`. Expected: all pass.
- **Task 3: Record the rule in `ARCHITECTURE.md`.**
  - Section 8 (the specification schema paragraph): an acceptance criterion is a pass/fail check; a design's subjective or unquantified behavior splits into a checkable criterion and an open decision, and guidance with no checkable part is out of scope.
  - Verify: `npm run check:docs`. Expected: exit 0, no new findings.
- **Task 4: Full verification and closure.**
  - `npm run typecheck`, the serial full suite, `git diff --check`. Expected: clean typecheck; no failures beyond the baseline pair; `git log -1` unchanged.
  - Set this plan `Implemented` with an implementation note. The next paid team-notes run is a separate operator decision: with this rule, run 3's design should produce a criterion like "editing a note's title or body adds an entry to its version history" plus OD-001, and an Out of scope line for the tone guidance, with no finding 19.

---

## Implementation note (2026-09-27)

**Shipped:**
- `src/prompts.ts`: `criterionQualityRule(indent)` holds the three sentences. `buildSpecAuthorPrompt` and `buildSpecSelfCritiquePrompt` both call it inside their `## Acceptance criteria` bullet, after the format rules. The self-critique prompt also carries the check sentence.
- `test/prompts.test.ts`: the three sentences are in `CONSTRAINT_STRINGS`. The draft and self-critique tests assert them through `CRITERION_QUALITY_RULE`, and the self-critique test also asserts the check sentence.
- `ARCHITECTURE.md` section 8: one paragraph stating the rule, the split into a criterion plus an open decision, and that nothing parses criterion content.

**Deviations:**
- The check sentence reads "against the pass/fail rule stated with the ## Acceptance criteria schema above" instead of "against that rule". In that paragraph, "that rule" would have pointed to the no-invention rule just before it.
- The format rule before the new sentences now ends with a period ("not inside this section."), so the bullet reads as sentences. The existing pin is a substring and still matches.

**Break-tests** (scratch mirror of `src/` and `test/`; the real file was never changed):
- Deleting any one of the three sentences failed the source scan, the draft test, and the self-critique test.
- Removing the draft helper call failed only the draft test. Removing the self-critique call failed only the self-critique test. Removing the check sentence failed only the self-critique test.
- A first attempt deleted whole source lines, which removed the template delimiters and crashed the file. That was redone as a text-only deletion so each failure is an assertion, not a crash.

**Verification:**
- `node --test test/prompts.test.ts test/spec-stage.test.ts` passed. `npm run typecheck`, `npm run check:docs` and `git diff --check` were clean.
- Serial full suite: 1283 tests, 1275 pass, 2 fail. The failures are the baseline pair (the dashboard SIGTERM test and "nothing under src/ touches a private key"). `git log -1` is still `d2954d9`.

**Unmeasured:** whether the author follows the rule is known only from a separately authorized paid run.
