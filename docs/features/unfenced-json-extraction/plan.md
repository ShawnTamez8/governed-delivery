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
