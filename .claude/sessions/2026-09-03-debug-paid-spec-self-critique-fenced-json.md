# Debugging Analysis

## Problem

The authorized real BuildWorks check for stable criterion IDs stopped during
the specification stage and never reached the plan review.

## Expected Behavior

The spec self-critique returns one bare JSON `AgentResult`; the stage parses its
revised specification, reviews it, and continues to approval and planning.

## Actual Behavior

The self-critique returned an otherwise well-formed result inside a
`json`-labelled Markdown fence. The deterministic JSON boundary refused it and
blocked the run.

## Reproducibility

Observed once in the single spend-authorized run. It was not retried because an
unchanged retry would violate hazard 7 and require fresh spend authorization.

## Evidence

- Scratch run 1 used a calculator design with 13 acceptance criteria.
- The first dispatch produced a parser-valid spec with `AC-001` through
  `AC-013`.
- The second raw envelope's `result` begins with ```` ```json ```` and ends
  with a matching fence.
- Audit action `spec.selfcritique.invalid` records: `fenced block is not valid
  JSON: Unexpected non-whitespace character after JSON at position 5327 (line
  1 column 5328)`.
- The spec stage and run are blocked; `verify-audit` reports `chain valid`.
- Two dispatches cost exactly $0.0877614.

## Likely Failing Layer

External model integration: output-shape noncompliance at the spec
self-critique boundary.

## Scope Narrowing

The first real spec proves the new acceptance-criterion parser accepts all 13
canonical IDs and the rich Markdown/parenthetical text. The second result
preserved those IDs and was refused before its embedded artifact reached the
parser. The existing prompt explicitly requires bare JSON and forbids Markdown
fences, so no missing prompt constraint was found.

## Hypothesis

The model ignored the existing bare-JSON instruction and formatted its response
as a conventional fenced JSON block.

## Hypothesis Result

Confirmed by the complete retained envelope and the exact parse-boundary audit
event.

## Proposed Fix

None — speculative fix rejected. Accepting fences would introduce a second
output shape and contradict the repository's one-schema rule. Rewording an
already explicit prompt is not justified by one noncompliant sample.

## Validation Plan

If the operator authorizes another paid attempt, first make the input materially
different or select an evidence-backed prompt change, then require the run to
reach plan review with exact `AC-001` through `AC-013` coverage. Do not reuse
this blocked run.

## Regression Coverage

Existing parser tests already assert that fenced JSON is refused. No new code
regression is indicated by this model-output failure.

## Risks

The feature lacks its planned real plan-author envelope and cannot be marked
implemented from this run.

## Open Questions

- Whether a materially revised prompt would reduce fence noncompliance enough
  to justify another paid run.
