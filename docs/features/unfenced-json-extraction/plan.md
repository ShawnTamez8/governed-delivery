# Unfenced JSON extraction Implementation Plan

**Status:** Implemented

**Goal:** `extractJsonBody` accepts a body that carries prose before an unfenced
JSON object, and every refusal it still makes says what the body contained.

**Source:** `docs/proposals/prose-before-unfenced-json-discards-a-valid-result.md`
(remedies 1, 2 and 3; remedy 4 deliberately not taken), the recorded response at
`test/fixtures/recorded/spec-author-web-calculator-prose-before-unfenced-json.json`,
and `ARCHITECTURE.md` section 18.

**Hazards considered:** 1 is the entry this change belongs to — its enumeration
names prose before and after a *fence* but never prose before a bare object, so
a suite working all seven listed shapes passed while the shape blocked a paid
run; its strictness-by-consequence rule is why tolerance is correct here, since
this extractor feeds schema validation and `src/raw-output.ts` retains the bytes
in full. 2 governs the refusal text: "no JSON object found in output" was false
as written, and the fix makes every remaining refusal name what was found. 4 and
hard rule 5 govern the test: the regression is a replay of the committed recorded
response, never a hand-written string. 3 was weighed and found not to apply —
the prompt already states the constraint the model disobeyed, so this is not an
unstated contract. 7 is why the fix is code rather than a fourth paid run: a
repeat varies only the sample. 5, 6, 8–18 do not bear on a change confined to
one parser and its tests.

**Verification:** `npm run typecheck`; `node --test test/parse-output.test.ts`
and `test/reconciliation.test.ts`; the recorded-response test proved by removing
the fallback and watching it fail, then restoring byte-identically;
`npm run check:docs`.

---

## Tasks

- **Task 1: the extractor falls back to the first balanced object.** In
  `src/parse-output.ts`, when the body has no fence, parse from the first `{` to
  the end of the body; refuse only if that fails. A body with one fence, or with
  several, behaves exactly as before.
  - Verify: `node --test test/parse-output.test.ts`
  - Expected: shapes 1–7 unchanged; the committed recorded response extracts
    to the full `AgentResult` the provenance block says it contains.
- **Task 2: every remaining refusal says what was found.** A body with no fence
  and no `{` says so; a body whose tail from the first `{` is not JSON names the
  offset and the parse error. The two fence refusals are unchanged.
  - Verify: `node --test test/parse-output.test.ts`
  - Expected: each refusal's operator-visible message is asserted exactly.
- **Task 3: the catalogue names the shape.** Add item 8, "prose before an
  unfenced object", to the enumeration in `docs/hazards.md` entry 1 and
  `ARCHITECTURE.md` section 18, with the measured paragraph in the hazard entry
  in the form its siblings use.
  - Verify: `npm run check:docs`
  - Expected: clean.
- **Task 4: the fallback is proved by breaking it.** Remove the fallback in a
  working copy, run the recorded-response test, confirm it fails with the old
  refusal, restore, confirm the file hash matches the pre-mutation hash.
  - Verify: SHA-256 of `src/parse-output.ts` before and after.
  - Expected: identical.

## Gate

Tasks 1–4 done; `npm run typecheck` exit 0; `node --test` over
`test/parse-output.test.ts` and `test/reconciliation.test.ts` all pass;
`npm run check:docs` clean. The status advances to `Implemented` on that
evidence — this change is proved against the recorded response, which is the
shape that blocked; a paid run is not part of this gate because the next paid
run belongs to `docs/features/plan-coverage-single-artifact/plan.md` Task 7 and
`docs/features/code-review-stage/plan.md` Task 10, both of which this unblocks.

---

## Implementation note (2026-09-06)

Tasks 1–4 executed on branch `code-review-stage`, same session as the plan.
`npm run typecheck` exit 0; `node --test test/parse-output.test.ts
test/reconciliation.test.ts` 59/59; `npm run check:docs` clean. Task 4:
removing the fallback failed exactly the four new tests — shape 8, the recorded
replay, and the two refusal messages — while shapes 1–7 stayed green, and the
restore was byte-identical (SHA-256 `69419b0e…`). The stage suites that call the
extractor (`code-review-stage`, `spec-stage`, `plan-stage`,
`implementation-stage`) were run afterwards as regression cover; the
`emit-code-review.mjs` prose mode still refuses, because its body carries no `{`.

One incidental correction outside this plan's tasks: `docs/hazards.md` entry 3
still said the coverage refusal appends its rule "when that target does not look
like a single path". That inference was removed from `coverageFitsScope` (the
sibling plan's deviation 1) and the sentence now says the rule is appended
unconditionally.

Not built, by the proposal's own reasoning: prose *after* an unfenced object,
which nobody has measured, and remedy 4.

**The paid run after this fix (2026-09-06, $1.15759) passed stage 1 and every
stage through verification**, then blocked at `code_review` on two correct
findings (`docs/features/code-review-stage/real-run-evidence.md`). Shape 8 did
not recur: the thirteen dispatches returned bare JSON (eight), a fence first
(four), and prose then a fence (one), all already in the enumeration. So the
fallback is proved against the recorded response that blocked and was not
exercised live; the run says only that nothing this change touched broke a
chain of thirteen dispatches.

---

## Amendment (2026-09-14): closing-fence anchoring

**Amendment status:** Implemented. Reviewed retrospectively on 2026-09-15
(`docs/features/unfenced-json-extraction/2026-09-15-code-review.md`); findings
1, 3 and 7 were fixed before the commit, and findings 2, 4, 5 and 6 remain open.

**This section was written after the fact.** The work below shipped without a
plan and without a review; the tasks are a reconstruction of what the working
tree contains, not a specification the implementation was measured against. It
exists so the review has a governing document and so the next reader knows the
ordering. Do not read it as evidence that the change was planned.

**Goal:** `extractJsonBody` accepts a fenced JSON body whose string literals
contain markdown code fences — `docs/hazards.md` entry 1, item 9 — which the
previous non-greedy closing match truncated.

**Source:** the retained implementation-author response of
`simple-game-3`, dispatched `2026-09-14T19:56:37.176Z` at a dispatch cost of
$1.0211774, which blocked run 3 of `C:\Repositories\testing-repos\simple-game-test`
at a cumulative $2.8386176 with `implementation.content.invalid`. It is committed
at `test/fixtures/recorded/implementation-simple-game-embedded-markdown-fence.json`
with a full provenance block.

**Hazards considered:** 1 is the entry this amendment extends — item 9 is the
ninth shape, and the change was made in the one function that owns all nine.
The reasoning it rests on is an invariant rather than a heuristic: a literal
newline cannot appear unescaped inside a JSON string, so a closing fence
required to begin a line cannot terminate a match inside a string value. 2
governs the refusal text and is where the review found the amendment wanting:
a body the new pattern rejects is reported as having no fence. 4 governs both
new tests, which were confirmed failing against the unfixed regex before being
reported as working, and hard rule 5 is satisfied because the authority is the
retained response rather than the synthetic case beside it. 6 bears on the
unrelated timeout change below and is finding 4 of the review. 7 does not apply:
the fix is code written against a retained response, not another paid sample.
5, 8, 9, 11, 13 and 14 do not bear on a change confined to one parser, one
prompt sentence, one constant and their tests. 3, 10 and 12 bear on the two
unrelated changes and are treated in the review rather than here.

**Verification:** `npm run typecheck` clean; `npm test` 1175 passing, 1 failing,
5 skipped, the failure being the known `verify-command.test.ts` EPERM cleanup
race and passing on an isolated rerun; `npm run check:docs` clean.

### Tasks

- **Task A1: the closing fence must begin its own line.** In
  `src/parse-output.ts`, replace `` ```[a-zA-Z]*\n([\s\S]*?)``` `` with a
  pattern requiring the terminator to start a line, so a triple backtick inside
  a JSON string value cannot end the block.
  - Verify: `node --test test/parse-output.test.ts`
  - Expected: shapes 1–8 unchanged; the embedded-fence shape extracts whole.
- **Task A2: commit the response that blocked.** Extract the retained
  implementer result into `test/fixtures/recorded/` with a provenance block
  naming the run, dispatch time, capture date, cost, stage context, the recorded
  refusal, and what was dropped from the harness envelope.
  - Verify: `node --test test/recorded-implementation-response.test.ts`
  - Expected: the 18-file patch extracts and `validateAgentResult` accepts it.
- **Task A3: the catalogue names the shape.** Add item 9 to the enumeration in
  `docs/hazards.md` entry 1, with the measured paragraph in the form its
  siblings use.
  - Verify: `npm run check:docs`
  - Expected: clean.
- **Task A4: the review's accepted findings are closed before the commit.**
  Widen the opening fence to `` ```+ `` so a four-backtick fence still matches
  (finding 1); branch the two fallback refusals on whether a line-anchored
  backtick run is present, so a rejected fence is never reported as an absent
  one (finding 3); remove the trailing blank line at
  `test/recorded-implementation-response.test.ts:79` (finding 7).
  - Verify: `node --test test/parse-output.test.ts test/recorded-implementation-response.test.ts`;
    `git diff --check`
  - Expected: 17/17 passing; `git diff --check` exit 0. Both new guards proved
    by removal, with `src/parse-output.ts` restored byte-identically.

### Unrelated changes that shipped in the same slice

Neither of these touches `extractJsonBody`. They are recorded here because they
were made in the same uncommitted window (2026-09-14 12:37–13:33) and would
otherwise have no written home; filing them here is a bookkeeping decision, not
a claim that they belong to this feature. A reader tracing either one should
expect to find it here only by way of this note.

- **The `normativeChanges` single-claim rule.** `src/prompts.ts:603-610` states
  that each added or removed node is claimed by exactly one decision, that
  duplicating a node across decisions makes the duplicate `cannot_determine`,
  and that the honest form when one document change answers several findings is
  an empty `normativeChanges` array on the other decisions. This describes what
  `src/reconciliation.ts` `convert()` already does; it constrains the model, not
  the code. `test/prompts.test.ts` scans for it on both reconciliation prompts —
  see review finding 6 for what the plan-side scan lost in the process.
- **The idle timeout raised from 600 to 1800 seconds.** `src/executor.ts:77`
  and `ARCHITECTURE.md:483`, plus a new exported
  `LARGE_GENERATION_IDLE_TIMEOUT_SECONDS` applied at
  `src/implementation-stage.ts:387` and `src/code-review-stage.ts:515`. The
  executor runs `--output-format json`, which is non-streaming, so no output
  arrives until generation completes and the idle budget is in practice the
  total generation time; the recorded implementation dispatch ran 780,568 ms
  against the old 600-second budget. `absoluteTimeoutSeconds` stays 3600.
  Review findings 4 and 5 are about the two consequences nobody checked: every
  profile frozen at 600 now fails `requireFrozenBinding`, and the timeout is
  decided in two places that agree only by coincidence.

### Gate

Tasks A1–A4 done; `npm run typecheck` exit 0; the full suite at its known
baseline; `npm run check:docs` clean; `git diff --check` exit 0. The review of
2026-09-15 is `partially reconciled`: findings 1, 3 and 7 are fixed and 2, 4, 5
and 6 remain open with recorded dispositions. Finding 4 is the one a future
editor must not rediscover — changing any field of `CLAUDE_CODE.sandbox` makes
`requireFrozenBinding` refuse every run frozen before the change, and there is
no in-place repair path for an `in_progress` run. Nothing here authorizes a
paid run.
