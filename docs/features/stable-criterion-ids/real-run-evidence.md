# Stable criterion IDs — real-run evidence

**Run date:** 2026-09-03 America/Chicago (2026-09-04 UTC)
**Outcome:** blocked at spec self-critique; no retry
**Scratch target:** `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788496320620\target`
**Effective model:** `claude-sonnet-5`
**Dispatches:** 2
**Exact recorded cost:** $0.0877614 ($0.08776 at driver precision)

**Hazards considered:** 1 (the retained self-critique arrived in a fenced
shape the JSON boundary refuses), 2 (both complete raw envelopes were retained
before parsing), 3 (the prompt already says to emit bare JSON, so the failure
is not an unstated constraint), 7 (the unchanged paid call was not retried), 8
(the Windows-aware scratch driver successfully launched Claude Code 2.1.260),
and 14 (the failed run never reached a review stage, so it provides no
independence evidence). Entries 4, 5, 6, 9 through 13, and 15 through 17 do not
bear on this pre-review model-shape refusal.

## Design exercised

The scratch-only driver used the calculator failure class from the debugging
analysis. Its design contained 13 acceptance criteria and deliberately retained
Markdown code spans and parenthetical qualifiers. The valid first draft minted
exactly `AC-001` through `AC-013` and preserved those rich criterion texts.

The generated draft specification's normalized SHA-256 was
`2f55e8cbed67d9ccf940a6aaf9b93479395b3e18d9da5fc4163e422713b6de10`.
A plan hash is unavailable because the run never reached planning.

## Stage and audit evidence

- `spec=blocked`; all later stages were absent; run 1 (`calculator`) was
  `blocked`.
- Dispatch 1, spec author: $0.0239702, 10,751 ms. It returned a valid bare JSON
  result and wrote a parser-valid specification with 13 canonical IDs.
- Dispatch 2, spec self-critique: $0.0637912, 47,343 ms. It preserved the full
  specification and every ID, but wrapped its JSON result in a
  ```` ```json ```` fence.
- The deterministic boundary recorded `spec.selfcritique.invalid` with:
  `fenced block is not valid JSON: Unexpected non-whitespace character after
  JSON at position 5327 (line 1 column 5328)`.
- `verify-audit` reported `chain valid` after the block.

## Retained raw evidence

- Valid spec-author envelope:
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788496320620\target\.governance\raw\1\2026-09-04T04-32-14-235Z-965e6e551fcf.json`
- Refused spec-self-critique envelope:
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\1788496320620\target\.governance\raw\1\2026-09-04T04-33-01-923Z-9490bd3e851c.json`
- Required plan-author envelope: unavailable because the run stopped before
  planning.

Both envelopes were inspected locally. They contain the scratch design,
generated specification, model response metadata, and no observed credential
material. Neither is copied into the harness fixtures: they are spec-author
evidence, not the successful plan-author envelope required by the replay test,
and representing either as that fixture would be false evidence.

## Disposition

This run demonstrates that the new spec parser accepts a real 13-criterion
document with stable IDs, but it does not satisfy the planned end-to-end
criterion-ID proof because it never reached `plan_review`. The failure was
model noncompliance with an existing no-fence output instruction. Per hazard 7
and the feature plan, no unchanged paid retry was made.
